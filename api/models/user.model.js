const mongoose = require("mongoose");
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    // FIX 23: Added trim and lowercase so "User@Gmail.com" and "user@gmail.com" are the same account
    // FIX 24: Added basic email format validation
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        match: [/^\S+@\S+\.\S+$/, "Invalid email format"]
    },
    password: { type: String, required: true },
    // FIX 25: Added enum constraint so only valid roles can be stored
    role: { type: String, enum: ["user", "admin"], default: "user" },
    resetOTP: { type: String },
    otpExpiry: { type: Date },
    // FIX 9: Track failed OTP attempts to prevent brute force
    otpAttempts: { type: Number, default: 0 },
    theme: { type: String, enum: ["light", "dark"], default: "light" }
}, { timestamps: true, versionKey: false });

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

userSchema.methods.comparePassword = function (password) {
    return bcrypt.compare(password, this.password);
};

module.exports = mongoose.model('User', userSchema);