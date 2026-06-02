require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

const { connectDB, disconnectDB } = require("./api/db.js");

const app = express();

// ─── Startup validation ───────────────────────────────────────────────────────
// Every environment variable the app depends on is validated here before
// anything else runs. Each entry has:
//   check  — a function that returns true if the value is acceptable
//   hint   — shown in the console log if the check fails, so the cause is
//             immediately obvious without reading the source code
//
// isPositiveInt checks that a value parses to a finite positive integer —
// used for numeric config like rate limit counts and windows.

const isPositiveInt = (v) => {
    const n = parseInt(v);
    return Number.isFinite(n) && n > 0;
};

const REQUIRED_ENV = {
    // ── Database ──────────────────────────────────────────────────────────────
    MONGODB_URI: { check: (v) => !!v, hint: "MongoDB Atlas connection string" },
    DATABASE_NAME: { check: (v) => !!v, hint: "Database name in Atlas e.g. homeLibrary" },

    // ── Auth ──────────────────────────────────────────────────────────────────
    JWT_SECRET: { check: (v) => v?.length >= 32, hint: "Must be at least 32 characters — generate with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"" },
    JWT_EXPIRY: { check: (v) => !!v, hint: "JWT expiry e.g. 4h" },

    // ── Email ─────────────────────────────────────────────────────────────────
    RESEND_API_KEY: { check: (v) => !!v, hint: "API key from resend.com" },

    // ── CORS ──────────────────────────────────────────────────────────────────
    CORS_ORIGIN: { check: (v) => !!v, hint: "Frontend URL e.g. https://your-app.vercel.app" },

    // ── Login brute-force protection ──────────────────────────────────────────
    LOGIN_MAX_ATTEMPTS: { check: isPositiveInt, hint: "Max failed login attempts before lockout e.g. 5" },
    LOGIN_LOCKOUT_MS: { check: isPositiveInt, hint: "Lockout duration in ms e.g. 900000 (15 min)" },

    // ── OTP ───────────────────────────────────────────────────────────────────
    OTP_MAX_ATTEMPTS: { check: isPositiveInt, hint: "Max wrong OTP attempts before rejection e.g. 5" },
    OTP_EXPIRY_MS: { check: isPositiveInt, hint: "OTP validity window in ms e.g. 600000 (10 min)" },

    // ── Rate limiting ─────────────────────────────────────────────────────────
    AUTH_RATE_LIMIT_WINDOW_MS: { check: isPositiveInt, hint: "Auth rate limit window in ms e.g. 900000 (15 min)" },
    AUTH_RATE_LIMIT_MAX: { check: isPositiveInt, hint: "Max auth requests per window e.g. 30" },
    GLOBAL_RATE_LIMIT_WINDOW_MS: { check: isPositiveInt, hint: "Global rate limit window in ms e.g. 900000 (15 min)" },
    GLOBAL_RATE_LIMIT_MAX: { check: isPositiveInt, hint: "Max global requests per window e.g. 300" },
};

const missing = Object.entries(REQUIRED_ENV).filter(([key, { check }]) =>
    !check(process.env[key])
);

if (missing.length > 0) {
    missing.forEach(([key, { hint }]) =>
        console.error(`FATAL: ${key} is not set or invalid — ${hint}`)
    );
    process.exit(1);
}

// ─── MongoDB ──────────────────────────────────────────────────────────────────

connectDB().catch((err) => {
    console.error("Error connecting to MongoDB:", err);
    process.exit(1);
});

const gracefulShutdown = async (signal) => {
    console.log(`${signal} received. Shutting down.`);
    await disconnectDB();
    process.exit(0);
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ─── HTTPS enforcement ────────────────────────────────────────────────────────
// Render terminates TLS at the edge and forwards via x-forwarded-proto.
// Redirect any plain HTTP request to HTTPS in production.

app.set("trust proxy", 1);

app.use((req, res, next) => {
    if (
        process.env.NODE_ENV === "production" &&
        req.headers["x-forwarded-proto"] !== "https"
    ) {
        return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
});

// ─── Request logging (Morgan) ─────────────────────────────────────────────────

app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ─── Helmet ───────────────────────────────────────────────────────────────────

app.use(helmet({
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
    },
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim());

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
}));

// ─── Health check ─────────────────────────────────────────────────────────────
// Lightweight endpoint used by the Login page to warm a cold instance before
// the user submits credentials. Placed BEFORE rate limiting and body/cookie
// parsing so it stays fast and doesn't consume the rate-limit budget. Does
// not touch MongoDB — the goal is to wake the Node process.
app.get("/health", (req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
});

// ─── Cookie parsing ───────────────────────────────────────────────────────────

app.use(cookieParser());

// ─── Body parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ limit: "50kb", extended: true }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Two tiers — both fully driven by env vars, no hardcoded fallbacks.
// Validation above guarantees these parse to valid positive integers.
//
// authLimiter   — tight limit on login / OTP / reset endpoints
// globalLimiter — broader limit applied to all traffic

const authLimiter = rateLimit({
    windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS),
    max: parseInt(process.env.AUTH_RATE_LIMIT_MAX),
    message: "Too many attempts. Please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
});

const globalLimiter = rateLimit({
    windowMs: parseInt(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS),
    max: parseInt(process.env.GLOBAL_RATE_LIMIT_MAX),
    message: "You have exceeded the request limit.",
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(globalLimiter);

// Auth-specific limiter stored in app.locals so routes can apply it selectively
app.locals.authLimiter = authLimiter;

// ─── Cache control ────────────────────────────────────────────────────────────

app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

require("./api/routes/app.routes.js")(app);

app.get("/", (req, res) => {
    res.send("Home Library API");
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});