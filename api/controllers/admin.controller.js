const { ObjectId } = require("mongodb");
const crypto = require("crypto");
const { Resend } = require("resend");

const { getUsers } = require("../db.js");
const validate = require("../utils/validate.js");
const { hashPassword } = require("../utils/user.utils.js");

const resend = new Resend(process.env.RESEND_API_KEY);

// 24-hour expiry for admin-triggered resets — user may not act immediately
const ADMIN_OTP_EXPIRY_MS = 24 * 60 * 60 * 1000;


/* ═══════════════════════ LIST USERS ════════════════════════════════════════ */

exports.listUsers = async (req, res) => {
    try {
        const users = getUsers();
        const list = await users
            .find({}, {
                projection: {
                    password: 0,
                    resetOTP: 0,
                    otpExpiry: 0,
                    otpAttempts: 0,
                    loginAttempts: 0,
                    lockUntil: 0,
                },
            })
            .sort({ createdAt: 1 })
            .toArray();

        res.json({ data: list });

    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch users",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ ADD USER ══════════════════════════════════════════ */

exports.addUser = async (req, res) => {
    try {
        const { name, email, password, role } = req.body;

        // Reuse existing validators
        const nv = validate.validateName({ name });
        if (!nv.valid) return res.status(400).json({ message: nv.message });

        const ev = validate.validateEmail({ email });
        if (!ev.valid) return res.status(400).json({ message: ev.message });

        const pv = validate.validateNewPassword({ password });
        if (!pv.valid) return res.status(400).json({ message: pv.message });

        const rv = validate.validateRole({ role });
        if (!rv.valid) return res.status(400).json({ message: rv.message });

        const users = getUsers();

        // Duplicate email check
        const existing = await users.findOne({ email: email.toLowerCase().trim() });
        if (existing) {
            return res.status(400).json({ message: "A user with this email already exists" });
        }

        const now = new Date();
        const result = await users.insertOne({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            password: await hashPassword(password),
            role,
            theme: "light",
            loginAttempts: 0,
            createdAt: now,
            updatedAt: now,
        });

        const created = await users.findOne(
            { _id: result.insertedId },
            { projection: { password: 0, resetOTP: 0, otpExpiry: 0, otpAttempts: 0, loginAttempts: 0, lockUntil: 0 } }
        );

        res.status(201).json({ data: created });

    } catch (error) {
        res.status(500).json({
            message: "Failed to add user",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ CHANGE ROLE ═══════════════════════════════════════ */

exports.changeRole = async (req, res) => {
    try {
        const { id } = req.params;
        const { role } = req.body;

        const idv = validate.validateObjectId(id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const rv = validate.validateRole({ role });
        if (!rv.valid) return res.status(400).json({ message: rv.message });

        // Admins cannot change their own role
        if (req.user.id.toString() === id) {
            return res.status(403).json({ message: "You cannot change your own role" });
        }

        const users = getUsers();
        const result = await users.findOneAndUpdate(
            { _id: new ObjectId(id) },
            { $set: { role, updatedAt: new Date() } },
            {
                returnDocument: "after",
                projection: { password: 0, resetOTP: 0, otpExpiry: 0, otpAttempts: 0, loginAttempts: 0, lockUntil: 0 },
            }
        );

        if (!result) return res.status(404).json({ message: "User not found" });

        res.json({ data: result });

    } catch (error) {
        res.status(500).json({
            message: "Failed to change role",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ SEND RESET OTP (admin-triggered) ═════════════════ */
// Generates a 24-hour OTP and sends it to the target user's registered email.
// The admin does not see the OTP — it goes directly to the user.

exports.sendUserResetOTP = async (req, res) => {
    try {
        const { id } = req.params;

        const idv = validate.validateObjectId(id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        // Admins cannot trigger a reset for themselves via this endpoint
        if (req.user.id.toString() === id) {
            return res.status(403).json({ message: "Use the standard forgot password flow to reset your own password" });
        }

        const users = getUsers();
        const user = await users.findOne({ _id: new ObjectId(id) });
        if (!user) return res.status(404).json({ message: "User not found" });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        await users.updateOne(
            { _id: user._id },
            {
                $set: {
                    resetOTP: crypto.createHash("sha256").update(otp).digest("hex"),
                    otpExpiry: new Date(Date.now() + ADMIN_OTP_EXPIRY_MS),
                    otpAttempts: 0,
                },
            }
        );

        await resend.emails.send({
            from: "Home Library <onboarding@resend.dev>",
            to: user.email,
            subject: "Password Reset OTP",
            text: `Your password reset OTP is: ${otp}\n\nThis code expires in 24 hours. Do not share it with anyone.\n\nIf you did not request this, please contact your admin.`,
        });

        res.json({ message: `Reset OTP sent to ${user.email}` });

    } catch (error) {
        res.status(500).json({
            message: "Failed to send reset OTP",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};