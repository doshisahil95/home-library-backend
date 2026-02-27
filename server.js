// DEPENDENCIES CALL
require('dotenv').config();
const express = require('express');
const app = express();
const router = express.Router();
const mongoose = require("mongoose");
const helmet = require("helmet");
const http = require("http");
const cors = require("cors");
const rateLimit = require("express-rate-limit");

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

// BODY PARSER
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ limit: "5mb", extended: true }));

// HELMET CONFIGURATION
app.use(helmet());

// CORS CONFIGURATION
// Use app-level CORS middleware to avoid path-to-regexp errors with '*' patterns
app.use(cors({
    origin: ["http://localhost:5173"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true
}));

// RATE LIMITER
const RateLimit = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // limit each IP to 100 requests per windowMs
    message: "You have exceeded the request limit!",
    headers: true,
});
app.use(RateLimit);

app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
});

require("./api/routes/app.routes.js")(router);
app.use(router);

app.get("/", (req, res) => {
    res.send("Welcome to Home Library API");
});

const Server = http.createServer(app);

Server.listen(process.env.PORT, () => {
    console.log("Server is listening at port " + process.env.PORT);
});