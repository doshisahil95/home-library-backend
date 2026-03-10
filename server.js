// DEPENDENCIES CALL
require('dotenv').config();
const express = require('express');
const app = express();
const mongoose = require("mongoose");
const helmet = require("helmet");
const http = require("http");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

if (!process.env.JWT_SECRET) {
    console.error("FATAL: JWT_SECRET is not set");
    process.exit(1);
}
if (!process.env.MONGODB_URI) {
    console.error("FATAL: MONGODB_URI is not set");
    process.exit(1);
}

// MONGOOSE CONNECTION TO MONGODB
mongoose.connect(process.env.MONGODB_URI, {
    dbName: process.env.DATABASE_NAME,
    appName: process.env.APP_NAME,
    compressors: "zstd",
}).then(() => {
    console.log('Connected to MongoDB');
}).catch((err) => {
    console.error('Error connecting to MongoDB:', err);
});

process.on("SIGINT", async () => {
    await mongoose.disconnect();
    console.log("MongoDB disconnected. Shutting down.");
    process.exit(0);
});

process.on("SIGTERM", async () => {
    await mongoose.disconnect();
    console.log("MongoDB disconnected. Shutting down.");
    process.exit(0);
});

app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ limit: "50kb", extended: true }));

// HELMET CONFIGURATION
app.use(helmet());

// CORS CONFIGURATION
app.use(cors({
    origin: ["http://localhost:5173"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));

// RATE LIMITER
const RateLimit = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    message: "You have exceeded the request limit!",
    headers: true,
});
app.use(RateLimit);

app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});


require("./api/routes/app.routes.js")(app);
app.get("/", (req, res) => {
    res.send("Welcome to Home Library API");
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ message: "Internal server error" });
});

const Server = http.createServer(app);

Server.listen(process.env.PORT || 3000, () => {
    console.log("Server is listening at port " + (process.env.PORT || 3000));
});