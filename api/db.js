const { MongoClient, ServerApiVersion } = require("mongodb");

// ─── Client ───────────────────────────────────────────────────────────────────
// Single MongoClient instance shared across the whole process.
// compressors: "zstd" matches the existing Mongoose config.

const client = new MongoClient(process.env.MONGODB_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
    compressors: ["zstd"],
});

let db;

// ─── Connect ──────────────────────────────────────────────────────────────────
// Called once from server.js on startup.
// Stores the db reference so collection accessors below work immediately.

async function connectDB() {
    await client.connect();
    db = client.db(process.env.DATABASE_NAME);
    console.log("Connected to MongoDB");
    return db;
}

// ─── Disconnect ───────────────────────────────────────────────────────────────
// Called on SIGINT / SIGTERM for a clean shutdown.

async function disconnectDB() {
    await client.close();
    console.log("MongoDB disconnected.");
}

// ─── Collection accessors ─────────────────────────────────────────────────────
// Each returns the live collection handle.
// Centralised here so a collection rename only requires one change.

function getBooks() { return db.collection("books"); }
function getUsers() { return db.collection("users"); }

module.exports = { connectDB, disconnectDB, getBooks, getUsers };