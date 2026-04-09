// Migration: add language field to existing books
//
// Safe to run multiple times — only updates documents where language is missing.
// Run with: node migrate.js
//
// Reads MONGODB_URI and DATABASE_NAME from .env (or environment variables on Railway).

require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");

async function migrate() {
    const client = new MongoClient(process.env.MONGODB_URI, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        },
    });

    try {
        await client.connect();
        const db = client.db(process.env.DATABASE_NAME);
        const books = db.collection("books");

        // ── Migration 1: backfill language field ──────────────────────────────
        // Adds language: "" to every book that doesn't have the field yet.
        // Books added after Phase 3 will already have it — $exists: false
        // ensures we only touch documents that genuinely need it.

        const langResult = await books.updateMany(
            { language: { $exists: false } },
            { $set: { language: "" } }
        );

        console.log(`Migration 1 — language field: ${langResult.modifiedCount} books updated.`);

        // ── Add any future migrations below this line ─────────────────────────
        // Pattern: always use a filter that matches only affected documents
        // so re-running is safe and fast.

        console.log("Migration complete.");

    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    } finally {
        await client.close();
    }
}

migrate();