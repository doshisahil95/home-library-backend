require('dotenv').config();
const express = require('express');
const mongoose = require("mongoose");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

const app = express();

// ─── Startup validation ───────────────────────────────────────────────────────

if (!process.env.JWT_SECRET) {
    console.error("FATAL: JWT_SECRET is not set");
    process.exit(1);
}
if (!process.env.MONGODB_URI) {
    console.error("FATAL: MONGODB_URI is not set");
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

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ limit: "50kb", extended: true }));
app.use(helmet());

// CORS — reject unknown origins silently (callback(null, false)) so the
// browser receives a proper CORS block instead of a 500 from a thrown error
const allowedOrigins = (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((o) => o.trim());

app.use(cors({
    origin: (origin, callback) => {
        if (!origin) return callback(null, true); // curl, Postman, server-to-server
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(null, false); // silently reject — browser shows CORS error
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
}));

// Rate limiter
const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 300,
    message: "You have exceeded the request limit.",
    headers: true,
});
app.use(limiter);

// Disable response caching for all API responses
app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────

require("./api/routes/app.routes.js")(app);

app.get("/", (req, res) => {
    res.send("Welcome to Home Library API");
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