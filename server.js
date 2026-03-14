require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();

// ─── Startup validation ───────────────────────────────────────────────────────

const REQUIRED_ENV = {
    MONGODB_URI: { check: (v) => !!v, hint: "MongoDB Atlas connection string" },
    JWT_SECRET: { check: (v) => v?.length >= 32, hint: "Must be at least 32 characters" },
    CORS_ORIGIN: { check: (v) => !!v, hint: "Frontend URL e.g. https://your-app.vercel.app" },
    RESEND_API_KEY: { check: (v) => !!v, hint: "API key from resend.com" },
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

mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.DATABASE_NAME,
    appName: process.env.APP_NAME,
    compressors: "zstd",
}).then(() => {
    console.log("Connected to MongoDB");
}).catch((err) => {
    console.error("Error connecting to MongoDB:", err);
    process.exit(1);
});

const gracefulShutdown = async (signal) => {
    console.log(`${signal} received. Shutting down.`);
    await mongoose.disconnect();
    console.log("MongoDB disconnected.");
    process.exit(0);
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// ─── HTTPS enforcement ────────────────────────────────────────────────────────
// Railway terminates TLS at the edge and forwards via x-forwarded-proto.
// Redirect any plain HTTP request to HTTPS in production.

app.set("trust proxy", 1); // trust Railway's reverse proxy

app.use((req, res, next) => {
    if (
        process.env.NODE_ENV === "production" &&
        req.headers["x-forwarded-proto"] !== "https"
    ) {
        return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
});

// ─── Helmet (security headers + HSTS) ────────────────────────────────────────

app.use(helmet({
    hsts: {
        maxAge: 31536000, // 1 year in seconds
        includeSubDomains: true,
    },
    // contentSecurityPolicy left at Helmet's secure defaults —
    // tighten per-environment via vercel.json on the frontend
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim());

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true); // curl, Postman, server-to-server
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(null, false); // reject — browser receives a proper CORS block
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ limit: "50kb", extended: true }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Two tiers:
//   authLimiter  — tight limit on unauthenticated endpoints (login, OTP, reset)
//   globalLimiter — broader limit on all other traffic

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10,              // 10 attempts per IP per window
    message: "Too many attempts. Please try again later.",
    standardHeaders: true,
    legacyHeaders: false,
});

const globalLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 300,
    message: "You have exceeded the request limit.",
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(globalLimiter);

// Auth-specific limiter applied in routes — exported so app.routes.js can use it
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