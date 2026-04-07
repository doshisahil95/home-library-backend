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
// Railway terminates TLS at the edge and forwards via x-forwarded-proto.
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

// ─── Cookie parsing ───────────────────────────────────────────────────────────

app.use(cookieParser());

// ─── Body parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ limit: "50kb", extended: true }));

// ─── Rate limiting ────────────────────────────────────────────────────────────

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
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