// DEPENDENCIES
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

// MODELS
const userModel = require("../models/user.model.js");

// MAIL CONFIG
const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

transporter.verify((err) => {
    if (err) console.log("Email error:", err);
    else console.log("Email server ready");
});


/* ================= LOGIN ================= */

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        const user = await userModel.findOne({ email });

        if (!user || !(await user.comparePassword(password))) {
            return res.status(400).json({ message: "Invalid email or password" });
        }

        const token = jwt.sign(
            { id: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        return res.status(200).json({
            message: "Login successful",
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            }
        });

    } catch (error) {
        return res.status(500).json({
            message: "Login failed",
            error: error.message
        });
    }
};


/* ================= SEND RESET OTP ================= */

exports.sendResetOTP = async (req, res) => {
    try {
        const { email } = req.body;

        const user = await userModel.findOne({ email });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();

        user.resetOTP = crypto.createHash("sha256").update(otp).digest("hex");
        user.otpExpiry = Date.now() + 10 * 60 * 1000; // 10 minutes

        await user.save();

        await transporter.sendMail({
            to: email,
            subject: "Password Reset OTP",
            text: `Your OTP is: ${otp}`,
        });

        return res.status(200).json({
            message: "OTP sent successfully"
        });

    } catch (error) {
        return res.status(500).json({
            message: "Failed to send OTP",
            error: error.message
        });
    }
};


/* ================= RESET PASSWORD ================= */

exports.resetPassword = async (req, res) => {
    try {
        const { email, otp, newPassword } = req.body;

        const user = await userModel.findOne({ email });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const hashedOTP = crypto.createHash("sha256").update(otp).digest("hex");

        if (
            user.resetOTP !== hashedOTP ||
            !user.otpExpiry ||
            user.otpExpiry < Date.now()
        ) {
            return res.status(400).json({
                message: "Invalid or expired OTP"
            });
        }

        user.password = newPassword; // auto-hashed via pre-save hook
        user.resetOTP = undefined;
        user.otpExpiry = undefined;

        await user.save();

        return res.status(200).json({
            message: "Password reset successful"
        });

    } catch (error) {
        return res.status(500).json({
            message: "Password reset failed",
            error: error.message
        });
    }
};