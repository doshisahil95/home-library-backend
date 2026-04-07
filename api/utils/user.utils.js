
const bcrypt = require("bcrypt");

// ─── Password hashing ─────────────────────────────────────────────────────────
// Used on registration and password reset — always 10 salt rounds.

async function hashPassword(plaintext) {
    return bcrypt.hash(plaintext, 10);
}

// ─── Password comparison ──────────────────────────────────────────────────────
// Compares a plaintext candidate against the stored bcrypt hash.
// Returns a boolean — never throws on mismatch.

async function comparePassword(plaintext, hash) {
    return bcrypt.compare(plaintext, hash);
}

// ─── Lockout check ────────────────────────────────────────────────────────────
// Returns true when a lockout is currently active.
// Accepts the raw user document from MongoDB.

function isLocked(user) {
    return !!(user.lockUntil && new Date(user.lockUntil) > new Date());
}

module.exports = { hashPassword, comparePassword, isLocked };