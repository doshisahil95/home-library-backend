const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const { Resend } = require("resend");
const { ObjectId } = require("mongodb");

const { getUsers } = require("../db.js");
const validate = require("../utils/validate.js");
const { comparePassword, isLocked, hashPassword } = require("../utils/user.utils.js");

// ─── Mail config ──────────────────────────────────────────────────────────────

const resend = new Resend(process.env.RESEND_API_KEY);

// ─── Constants ────────────────────────────────────────────────────────────────

const LOGIN_MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS) || 5;
const LOGIN_LOCKOUT_MS = parseInt(process.env.LOGIN_LOCKOUT_MS) || 15 * 60 * 1000;
const OTP_MAX_ATTEMPTS = parseInt(process.env.OTP_MAX_ATTEMPTS) || 5;
const OTP_EXPIRY_MS = parseInt(process.env.OTP_EXPIRY_MS) || 10 * 60 * 1000; // 10 min — admin self-reset only
const JWT_EXPIRY = process.env.JWT_EXPIRY || "4h";

// ─── Cookie helper ────────────────────────────────────────────────────────────

function cookieOptions() {
    const isProd = process.env.NODE_ENV === "production";
    return {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "none" : "lax",
        maxAge: 4 * 60 * 60 * 1000,
        path: "/",
    };
}


/* ═══════════════════════ LOGIN ═══════════════════════════════════════════════ */

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const lv = validate.validateLoginBody({ email, password });
        if (!lv.valid) return res.status(400).json({ message: lv.message });

        const users = getUsers();
        const user = await users.findOne({ email });

        if (!user) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        if (isLocked(user)) {
            const remaining = Math.ceil((new Date(user.lockUntil) - Date.now()) / 60000);
            return res.status(429).json({
                message: `Account temporarily locked. Try again in ${remaining} minute${remaining === 1 ? "" : "s"}.`
            });
        }

        // New users have no password yet — redirect them to set one
        if (user.firstLogin || !user.password) {
            return res.status(400).json({
                message: "Please set your password first. Use \"First time logging in?\" on the login page."
            });
        }

        const passwordValid = await comparePassword(password, user.password);

        if (!passwordValid) {
            const attempts = (user.loginAttempts || 0) + 1;

            if (attempts >= LOGIN_MAX_ATTEMPTS) {
                await users.updateOne(
                    { _id: user._id },
                    { $set: { loginAttempts: 0, lockUntil: new Date(Date.now() + LOGIN_LOCKOUT_MS) } }
                );
                return res.status(429).json({
                    message: "Too many failed attempts. Account locked for 15 minutes."
                });
            }

            await users.updateOne(
                { _id: user._id },
                { $set: { loginAttempts: attempts } }
            );
            return res.status(400).json({ message: "Invalid email or password" });
        }

        // Successful login — clear lockout state
        await users.updateOne(
            { _id: user._id },
            { $set: { loginAttempts: 0 }, $unset: { lockUntil: "" } }
        );

        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRY }
        );

        res.cookie("token", token, cookieOptions());

        return res.status(200).json({
            message: "Login successful",
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


/* ═══════════════════════ CHECK RESET METHOD ════════════════════════════════ */
// Determines which password reset method applies for this email:
//   "otp"           — superadmin, OTP sent via email
//   "approved"      — admin has pre-approved this reset, no OTP needed
//   "contact_admin" — regular user with no approval, must contact superadmin
//
// Always returns 200 — never reveals whether the email exists.

exports.sendResetOTP = async (req, res) => {
    try {
        const { email } = req.body;

        const ev = validate.validateEmail({ email });
        if (!ev.valid) return res.status(200).json({ method: "contact_admin" });

        const users = getUsers();
        const user = await users.findOne({ email: email.toLowerCase().trim() });

        // Unknown email — return contact_admin silently (don't reveal user existence)
        if (!user) {
            return res.status(200).json({ method: "contact_admin" });
        }

        // Superadmin — OTP flow via email (Resend account owner, delivery works)
        if (user.role === "superadmin") {
            const otp = Math.floor(100000 + Math.random() * 900000).toString();

            await users.updateOne(
                { _id: user._id },
                {
                    $set: {
                        resetOTP: crypto.createHash("sha256").update(otp).digest("hex"),
                        otpExpiry: new Date(Date.now() + OTP_EXPIRY_MS),
                        otpAttempts: 0,
                    },
                }
            );

            await resend.emails.send({
                from: "Home Library <onboarding@resend.dev>",
                to: email,
                subject: "Password Reset OTP",
                text: `Your OTP is: ${otp}\n\nThis code expires in 10 minutes. Do not share it with anyone.`,
            });

            return res.status(200).json({ method: "otp" });
        }

        // New user who hasn't set a password yet — first login flow
        if (user.firstLogin) {
            return res.status(200).json({ method: "first_login" });
        }

        // Superadmin has pre-approved this user's reset — no OTP needed
        if (user.passwordResetApproved) {
            return res.status(200).json({ method: "approved" });
        }

        // User has already set a password — different message from unknown email
        if (user.password) {
            return res.status(200).json({ method: "already_registered" });
        }

        // All other users — must contact superadmin to get approval
        return res.status(200).json({ method: "contact_admin" });

    } catch (error) {
        return res.status(500).json({
            message: "Failed to process reset request",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ RESET PASSWORD ════════════════════════════════════ */
// Handles two flows:
//   OTP flow      — superadmin with valid OTP (otp field present)
//   Approved flow — user with passwordResetApproved: true (no otp needed)

exports.resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        // Validate new password strength (shared for both flows)
        const pv = validate.validateOTPBody({ email, otp: otp || "000000", newPassword });
        if (!pv.valid) return res.status(400).json({ message: pv.message });

        const users = getUsers();
        const user = await users.findOne({ email: email?.toLowerCase().trim() });

        if (!user) {
            return res.status(400).json({ message: "Invalid or expired request" });
        }

        // ── OTP flow (superadmin) ─────────────────────────────────────────────
        if (otp) {
            if ((user.otpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
                return res.status(400).json({
                    message: "Too many failed attempts. Please request a new OTP."
                });
            }

            const hashedOTP = crypto.createHash("sha256").update(otp).digest("hex");

            if (
                user.resetOTP !== hashedOTP ||
                !user.otpExpiry ||
                new Date(user.otpExpiry) < new Date()
            ) {
                await users.updateOne(
                    { _id: user._id },
                    { $inc: { otpAttempts: 1 } }
                );
                return res.status(400).json({ message: "Invalid or expired OTP" });
            }

            const hashedPassword = await hashPassword(newPassword);

            await users.updateOne(
                { _id: user._id },
                {
                    $set: { password: hashedPassword, loginAttempts: 0 },
                    $unset: { resetOTP: "", otpExpiry: "", otpAttempts: "", lockUntil: "" },
                }
            );

            return res.status(200).json({ message: "Password reset successful" });
        }

        // ── First login flow (new user, no password set yet) ─────────────────
        if (user.firstLogin) {
            const hashedPassword = await hashPassword(newPassword);
            await users.updateOne(
                { _id: user._id },
                {
                    $set: { password: hashedPassword, loginAttempts: 0 },
                    $unset: { firstLogin: "", lockUntil: "" },
                }
            );
            return res.status(200).json({ message: "Password set successfully" });
        }

        // ── Approved flow (admin pre-approved) ────────────────────────────────
        if (!user.passwordResetApproved) {
            return res.status(403).json({ message: "Password reset not approved. Contact your admin." });
        }

        const hashedPassword = await hashPassword(newPassword);

        await users.updateOne(
            { _id: user._id },
            {
                $set: { password: hashedPassword, loginAttempts: 0, passwordResetApproved: false },
                $unset: { lockUntil: "" },
            }
        );

        return res.status(200).json({ message: "Password reset successful" });

    } catch (error) {
        return res.status(500).json({
            message: "Password reset failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


/* ═══════════════════════ GET ME ════════════════════════════════════════════ */

exports.getMe = (req, res) => {
    try {
        const decoded = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
        const msRemaining = decoded.exp * 1000 - Date.now();
        return res.json({ valid: true, msRemaining });
    } catch {
        return res.status(401).json({ valid: false, msRemaining: 0 });
    }
};


/* ═══════════════════════ REFRESH TOKEN ════════════════════════════════════ */

exports.refreshToken = (req, res) => {
    try {
        const token = jwt.sign(
            { id: req.user.id, role: req.user.role },
            process.env.JWT_SECRET,
            { expiresIn: JWT_EXPIRY }
        );
        res.cookie("token", token, cookieOptions());
        return res.json({ message: "Session extended" });
    } catch {
        return res.status(500).json({ message: "Failed to refresh session" });
    }
};


/* ═══════════════════════ LOGOUT ════════════════════════════════════════════ */

exports.logout = (req, res) => {
    res.clearCookie("token", { path: "/" });
    return res.json({ message: "Logged out" });
};