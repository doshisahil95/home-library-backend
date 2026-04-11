const { MongoClient } = require("mongodb");

// ─── Client ───────────────────────────────────────────────────────────────────

const client = new MongoClient(process.env.MONGODB_URI, {
    compressors: ["zstd"],
});

let db;

// ─── Connect ──────────────────────────────────────────────────────────────────

async function connectDB() {
    await client.connect();
    db = client.db(process.env.DATABASE_NAME);
    console.log("Connected to MongoDB");
    await ensureIndexes();
    await seedReferenceData();
    return db;
}

// ─── Disconnect ───────────────────────────────────────────────────────────────

async function disconnectDB() {
    await client.close();
    console.log("MongoDB disconnected.");
}

// ─── Indexes ──────────────────────────────────────────────────────────────────
// Unique indexes on reference collections use collation strength 2 (case-insensitive).
// The application also normalises to title case on write — the index is the hard guarantee.

async function ensureIndexes() {
    // Books
    const books = db.collection("books");
    await books.createIndex({ title: 1, _id: 1 });
    await books.createIndex({ author: 1, _id: 1 });
    await books.createIndex({ house: 1, _id: 1 });
    await books.createIndex({ createdAt: -1 });
    await books.createIndex({ "statuses.userId": 1, "statuses.status": 1 });
    await books.createIndex({ language: 1 });
    await books.createIndex({ title: 1, author: 1 }, { unique: true });

    // Reference data — case-insensitive unique index on name
    const collation = { locale: "en", strength: 2 };
    await db.collection("genres").createIndex({ name: 1 }, { unique: true, collation });
    await db.collection("houses").createIndex({ name: 1 }, { unique: true, collation });
    await db.collection("languages").createIndex({ name: 1 }, { unique: true, collation });

    const users = db.collection("users");
    await users.createIndex({ email: 1 }, { unique: true });

    console.log("Indexes ensured.");
}

// ─── Seed reference data ──────────────────────────────────────────────────────
// Runs on every startup but only inserts if the collection is empty.
// Values match the current static JSON files so existing books are unaffected.

async function seedReferenceData() {
    const now = new Date();

    const genreSeeds = [
        "Fiction", "Fantasy", "Biography", "Science",
    ];

    const houseSeeds = [
        "Brahma Courts", "Marvel",
    ];

    const languageSeeds = [
        "English", "Hindi", "Gujarati", "Marathi",
        "Tamil", "Telugu", "Kannada", "Bengali",
        "French", "German", "Spanish",
    ];

    const seedCollection = async (collectionName, names) => {
        const col = db.collection(collectionName);
        const count = await col.countDocuments();
        if (count > 0) return; // already seeded — skip
        await col.insertMany(
            names.map((name) => ({ name, createdAt: now, updatedAt: now }))
        );
        console.log(`Seeded ${collectionName} with ${names.length} entries.`);
    };

    await seedCollection("genres", genreSeeds);
    await seedCollection("houses", houseSeeds);
    await seedCollection("languages", languageSeeds);
}

// ─── Collection accessors ─────────────────────────────────────────────────────

function getBooks() { return db.collection("books"); }
function getUsers() { return db.collection("users"); }
function getGenres() { return db.collection("genres"); }
function getHouses() { return db.collection("houses"); }
function getLanguages() { return db.collection("languages"); }

module.exports = { connectDB, disconnectDB, getBooks, getUsers, getGenres, getHouses, getLanguages };