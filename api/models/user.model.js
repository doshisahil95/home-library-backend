const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

console.log("user.model.js loaded — pre-save has next:", true); // ADD THIS


const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        match: [/^\S+@\S+\.\S+$/, "Invalid email format"],
    },
    password: { type: String, required: true },
    role: { type: String, enum: ["user", "admin"], default: "user" },

    // OTP reset fields
    resetOTP: { type: String },
    otpExpiry: { type: Date },
    otpAttempts: { type: Number, default: 0 },

    // Login brute-force protection
    loginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date },

    theme: { type: String, enum: ["light", "dark"], default: "light" },
}, { timestamps: true, versionKey: false });

userSchema.pre("save", async function (next) {
    if (!this.isModified("password")) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

userSchema.methods.comparePassword = function (password) {
    return bcrypt.compare(password, this.password);
};

// True when a lockout is currently active
userSchema.methods.isLocked = function () {
    return !!(this.lockUntil && this.lockUntil > Date.now());
};

module.exports = mongoose.model("User", userSchema);