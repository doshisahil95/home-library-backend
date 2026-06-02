
const { MongoClient } = require("mongodb");

const client = new MongoClient(process.env.MONGODB_URI, { compressors: ["zstd"] });
let db;

const BOOK_SEARCH_INDEX_NAME = "bookSearch";

const BOOK_SEARCH_INDEX_DEFINITION = {
    mappings: {
        dynamic: false,
        fields: {
            _id: { type: "objectId" },
            title: [
                {
                    type: "autocomplete",
                    tokenization: "edgeGram",
                    minGrams: 2,
                    maxGrams: 15,
                    foldDiacritics: true,
                },
            ],
            author: [
                {
                    type: "autocomplete",
                    tokenization: "edgeGram",
                    minGrams: 2,
                    maxGrams: 15,
                    foldDiacritics: true,
                },
            ],
            house: { type: "token" },
            language: { type: "token" },
            genre: { type: "token" },
            createdAt: { type: "date" },
            statuses: {
                type: "embeddedDocuments",
                dynamic: false,
                fields: {
                    userId: { type: "objectId" },
                    status: { type: "token" },
                },
            },
        },
    },
};

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

    await ensureBookSearchIndex(books);

    console.log("Indexes ensured.");
}

async function ensureBookSearchIndex(booksCollection) {
    try {
        const existing = await booksCollection.listSearchIndexes().toArray();
        const alreadyExists = existing.some(
            (idx) => idx.name === BOOK_SEARCH_INDEX_NAME
        );
        if (alreadyExists) {
            console.log(`Atlas Search index "${BOOK_SEARCH_INDEX_NAME}" already exists.`);
            return;
        }
        await booksCollection.createSearchIndex({
            name: BOOK_SEARCH_INDEX_NAME,
            definition: BOOK_SEARCH_INDEX_DEFINITION,
        });
        console.log(
            `Created Atlas Search index "${BOOK_SEARCH_INDEX_NAME}" — may take 10-60s to become queryable.`
        );
    } catch (err) {
        // listSearchIndexes / createSearchIndex throw on local Mongo or unsupported clusters.
        // Don't crash the server — search just won't work until the index is created manually.
        console.warn(`Skipping Atlas Search index setup: ${err.message}`);
    }
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