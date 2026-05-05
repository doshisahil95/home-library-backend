const { MongoClient } = require("mongodb");

const client = new MongoClient(process.env.MONGODB_URI, { compressors: ["zstd"] });
let db;

async function connectDB() {
    await client.connect();
    db = client.db(process.env.DATABASE_NAME);
    console.log("Connected to MongoDB");
    await ensureIndexes();
    return db;
}

async function disconnectDB() {
    await client.close();
    console.log("MongoDB disconnected.");
}

async function ensureIndexes() {
    const books = db.collection("books");
    await books.createIndex({ title: 1, _id: 1 });
    await books.createIndex({ author: 1, _id: 1 });
    await books.createIndex({ house: 1, _id: 1 });
    await books.createIndex({ createdAt: -1 });
    await books.createIndex({ "statuses.userId": 1, "statuses.status": 1 });
    await books.createIndex({ language: 1 });
    await books.createIndex({ publicByUsers: 1 });
    await books.createIndex({ title: 1, author: 1 }, { unique: true });
    await books.createIndex({ "series.id": 1 });

    const collation = { locale: "en", strength: 2 };
    await db.collection("genres").createIndex({ name: 1 }, { unique: true, collation });
    await db.collection("houses").createIndex({ name: 1 }, { unique: true, collation });
    await db.collection("languages").createIndex({ name: 1 }, { unique: true, collation });
    await db.collection("series").createIndex({ name: 1 }, { unique: true, collation });
    await db.collection("users").createIndex({ email: 1 }, { unique: true });

    // Wishlist — one entry per user, fast lookup by userId
    await db.collection("wishlist").createIndex({ userId: 1 });

    console.log("Indexes ensured.");
}

function getBooks() { return db.collection("books"); }
function getUsers() { return db.collection("users"); }
function getGenres() { return db.collection("genres"); }
function getHouses() { return db.collection("houses"); }
function getLanguages() { return db.collection("languages"); }
function getSeries() { return db.collection("series"); }
function getWishlist() { return db.collection("wishlist"); }

module.exports = {
    connectDB, disconnectDB,
    getBooks, getUsers, getGenres, getHouses, getLanguages, getSeries, getWishlist,
};