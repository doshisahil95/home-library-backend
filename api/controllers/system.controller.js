const { ObjectId } = require("mongodb");
const { getGenres, getHouses, getLanguages, getBooks } = require("../db.js");
const { validateObjectId, validateReferenceName, toTitleCase } = require("../utils/validate.js");

// ─── Collection picker ────────────────────────────────────────────────────────
// Maps the route type param to the correct collection accessor and label.
// Keeps all three resource types in one controller without repetition.

const COLLECTION_MAP = {
    genres: { getter: getGenres, label: "Genre", bookField: "genre", isArray: true },
    houses: { getter: getHouses, label: "House", bookField: "house", isArray: false },
    languages: { getter: getLanguages, label: "Language", bookField: "language", isArray: false },
};

function getCollection(type) {
    return COLLECTION_MAP[type] || null;
}


// ─── GET all ──────────────────────────────────────────────────────────────────
// Accessible to all authenticated users — needed for modal and filter panel.
// Returns documents sorted alphabetically by name.

exports.getAll = async (req, res) => {
    try {
        const { type } = req.params;
        const col = getCollection(type);
        if (!col) return res.status(404).json({ message: "Unknown reference type" });

        const items = await col.getter()
            .find({})
            .sort({ name: 1 })
            .toArray();

        res.json({ data: items });

    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch reference data",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


// ─── POST (create) ────────────────────────────────────────────────────────────
// Admin only. Normalises to title case, checks for duplicates, then inserts.

exports.create = async (req, res) => {
    try {
        const { type } = req.params;
        const col = getCollection(type);
        if (!col) return res.status(404).json({ message: "Unknown reference type" });

        const nv = validateReferenceName(req.body.name);
        if (!nv.valid) return res.status(400).json({ message: nv.message });

        const name = toTitleCase(req.body.name);
        const collection = col.getter();

        // Case-insensitive duplicate check
        const existing = await collection.findOne(
            { name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } }
        );
        if (existing) {
            return res.status(400).json({ message: `${col.label} "${name}" already exists` });
        }

        const now = new Date();
        const result = await collection.insertOne({ name, createdAt: now, updatedAt: now });
        const created = await collection.findOne({ _id: result.insertedId });

        res.status(201).json({ data: created });

    } catch (error) {
        // Catch duplicate key from unique index as final safety net
        if (error.code === 11000) {
            return res.status(400).json({ message: "This name already exists" });
        }
        res.status(500).json({
            message: "Failed to create entry",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


// ─── PUT (update) ─────────────────────────────────────────────────────────────
// Admin only. Normalises to title case, checks for duplicates excluding self.

exports.update = async (req, res) => {
    try {
        const { type, id } = req.params;
        const col = getCollection(type);
        if (!col) return res.status(404).json({ message: "Unknown reference type" });

        const idv = validateObjectId(id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const nv = validateReferenceName(req.body.name);
        if (!nv.valid) return res.status(400).json({ message: nv.message });

        const name = toTitleCase(req.body.name);
        const collection = col.getter();
        const docId = new ObjectId(id);

        // Duplicate check — exclude the document being updated
        const existing = await collection.findOne({
            name: { $regex: `^${escapeRegex(name)}$`, $options: "i" },
            _id: { $ne: docId },
        });
        if (existing) {
            return res.status(400).json({ message: `${col.label} "${name}" already exists` });
        }

        const result = await collection.findOneAndUpdate(
            { _id: docId },
            { $set: { name, updatedAt: new Date() } },
            { returnDocument: "after" }
        );

        if (!result) return res.status(404).json({ message: `${col.label} not found` });

        res.json({ data: result });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: "This name already exists" });
        }
        res.status(500).json({
            message: "Failed to update entry",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


// ─── DELETE ───────────────────────────────────────────────────────────────────
// Admin only. Rejects if the value is in use on any book to prevent orphaned data.

exports.remove = async (req, res) => {
    try {
        const { type, id } = req.params;
        const col = getCollection(type);
        if (!col) return res.status(404).json({ message: "Unknown reference type" });

        const idv = validateObjectId(id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const collection = col.getter();
        const docId = new ObjectId(id);

        const item = await collection.findOne({ _id: docId });
        if (!item) return res.status(404).json({ message: `${col.label} not found` });

        // Delete protection — check if any book uses this value
        const books = getBooks();
        const bookFilter = col.isArray
            ? { [col.bookField]: item.name }          // genre is an array field — $in not needed, direct match works
            : { [col.bookField]: item.name };          // house/language is a scalar field

        const usageCount = await books.countDocuments(bookFilter);
        if (usageCount > 0) {
            return res.status(400).json({
                message: `Cannot delete "${item.name}" — it is used by ${usageCount} ${usageCount === 1 ? "book" : "books"}`,
            });
        }

        await collection.deleteOne({ _id: docId });

        res.json({ success: true });

    } catch (error) {
        res.status(500).json({
            message: "Failed to delete entry",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


// ─── Helpers ──────────────────────────────────────────────────────────────────
// Escapes special regex characters in user input before using in a $regex query.
// Prevents regex injection — e.g. a name like "C++" would break the pattern.

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}