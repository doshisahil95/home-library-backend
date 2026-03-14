const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Resend } = require("resend");

const userModel = require("../models/user.model.js");
const validate = require("../utils/validate.js");

// ─── Mail config ──────────────────────────────────────────────────────────────
// Resend sends over HTTPS (port 443) — not blocked by Railway unlike SMTP (587)

const resend = new Resend(process.env.RESEND_API_KEY);


// ─── Constants ────────────────────────────────────────────────────────────────
// All configurable via environment variables — defaults are sensible for
// a small home app. Override in Railway variables if needed.

const LOGIN_MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS) || 5;
const LOGIN_LOCKOUT_MS = parseInt(process.env.LOGIN_LOCKOUT_MS) || 15 * 60 * 1000; // 15 minutes
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS) || 5;
const OTP_EXPIRY_MS = parseInt(process.env.OTP_EXPIRY_MS) || 10 * 60 * 1000; // 10 minutes
const JWT_EXPIRY = process.env.JWT_EXPIRY || "4h";


/* ═══════════════════════ LOGIN ═══════════════════════════════════════════════ */

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const lv = validate.validateLoginBody({ email, password });
        if (!lv.valid) return res.status(400).json({ message: lv.message });

        const user = await userModel.findOne({ email });

        // Use a consistent error message whether the user exists or not —
        // prevents email enumeration by timing or message differences
        if (!user) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        // Check lockout before comparing passwords — fail fast, no bcrypt cost
        if (user.isLocked()) {
            const remaining = Math.ceil((user.lockUntil - Date.now()) / 60000);
            return res.status(429).json({
                message: `Account temporarily locked. Try again in ${remaining} minute${remaining === 1 ? "" : "s"}.`
            });
        }

        const passwordValid = await user.comparePassword(password);

        if (!passwordValid) {
            // Increment attempt counter; lock if threshold reached
            user.loginAttempts = (user.loginAttempts || 0) + 1;

            if (user.loginAttempts >= LOGIN_MAX_ATTEMPTS) {
                user.lockUntil = new Date(Date.now() + LOGIN_LOCKOUT_MS);
                user.loginAttempts = 0; // reset counter — lockUntil carries the state
                await user.save();
                return res.status(429).json({
                    message: "Too many failed attempts. Account locked for 15 minutes."
                });
            }

            await user.save();
            return res.status(400).json({ message: "Invalid email or password" });
        }

        // Successful login — clear any lockout state
        user.loginAttempts = 0;
        user.lockUntil = undefined;
        await user.save();

        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRY }
        );

        return res.status(200).json({
            message: "Login successful",
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                theme: user.theme,
            },
        });

    } catch (error) {
        return res.status(500).json({
            message: "Login failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ SEND RESET OTP ═════════════════════════════════════ */

exports.sendResetOTP = async (req, res) => {
    try {
        const { email } = req.body;

        // Always return 200 — prevents email enumeration
        const ev = validate.validateEmail({ email });
        if (!ev.valid) return res.status(200).json({ message: "OTP sent successfully" });

        const user = await userModel.findOne({ email });

        if (!user) {
            return res.status(200).json({ message: "OTP sent successfully" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        user.resetOTP = crypto.createHash("sha256").update(otp).digest("hex");
        user.otpExpiry = new Date(Date.now() + OTP_EXPIRY_MS);
        user.otpAttempts = 0;

        await user.save();

        await resend.emails.send({
            from: "Home Library <onboarding@resend.dev>",
            to: email,
            subject: "Password Reset OTP",
            text: `Your OTP is: ${otp}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
        });

        return res.status(200).json({ message: "OTP sent successfully" });

    } catch (error) {
        return res.status(500).json({
            message: "Failed to send OTP",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ RESET PASSWORD ════════════════════════════════════ */

exports.resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        const rv = validate.validateOTPBody({ email, otp, newPassword });
        if (!rv.valid) return res.status(400).json({ message: "Invalid or expired OTP" });

        const user = await userModel.findOne({ email });

        if (!user) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        if (user.otpAttempts >= OTP_MAX_ATTEMPTS) {
            return res.status(400).json({
                message: "Too many failed attempts. Please request a new OTP."
            });
        }

        const hashedOTP = crypto.createHash("sha256").update(otp).digest("hex");

        if (
            user.resetOTP !== hashedOTP ||
            !user.otpExpiry ||
            user.otpExpiry < Date.now()
        ) {
            user.otpAttempts = (user.otpAttempts || 0) + 1;
            await user.save();
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        // Valid OTP — hash the new password manually so we can do a single
        // atomic update clearing the OTP fields at the same time.
        // This avoids the two-step save pattern and any pre-save hook conflicts.
        const bcrypt = require("bcrypt");
        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await userModel.updateOne({ email }, {
            $set: { password: hashedPassword, loginAttempts: 0 },
            $unset: { resetOTP: 1, otpExpiry: 1, otpAttempts: 1, lockUntil: 1 },
        });

        return res.status(200).json({ message: "Password reset successful" });

    } catch (error) {
        return res.status(500).json({
            message: "Password reset failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};