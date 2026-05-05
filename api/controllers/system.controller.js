const { ObjectId } = require("mongodb");
const { getGenres, getHouses, getLanguages, getBooks } = require("../db.js");
const { validateObjectId, validateReferenceName, toTitleCase } = require("../utils/validate.js");

const COLLECTION_MAP = {
    genres: { getter: getGenres, label: "Genre", bookField: "genre", isArray: true },
    houses: { getter: getHouses, label: "House", bookField: "house", isArray: false },
    languages: { getter: getLanguages, label: "Language", bookField: "language", isArray: false },
};

function getCollection(type) { return COLLECTION_MAP[type] || null; }

function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// ─── GET all ──────────────────────────────────────────────────────────────────

exports.getAll = async (req, res) => {
    try {
        const col = getCollection(req.params.type);
        if (!col) return res.status(404).json({ message: "Unknown reference type" });
        const items = await col.getter().find({}).sort({ name: 1 }).toArray();
        res.json({ data: items });
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch reference data", error: process.env.NODE_ENV === "development" ? error.message : undefined });
    }
};

// ─── POST (create) ────────────────────────────────────────────────────────────

exports.create = async (req, res) => {
    try {
        const col = getCollection(req.params.type);
        if (!col) return res.status(404).json({ message: "Unknown reference type" });
        const nv = validateReferenceName(req.body.name);
        if (!nv.valid) return res.status(400).json({ message: nv.message });
        const name = toTitleCase(req.body.name);
        const collection = col.getter();
        const existing = await collection.findOne({ name: { $regex: `^${escapeRegex(name)}$`, $options: "i" } });
        if (existing) return res.status(400).json({ message: `${col.label} "${name}" already exists` });
        const now = new Date();
        const result = await collection.insertOne({ name, createdAt: now, updatedAt: now });
        const created = await collection.findOne({ _id: result.insertedId });
        res.status(201).json({ data: created });
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ message: "This name already exists" });
        res.status(500).json({ message: "Failed to create entry", error: process.env.NODE_ENV === "development" ? error.message : undefined });
    }
};

// ─── PUT (update) ─────────────────────────────────────────────────────────────
// After updating the reference document, propagates the name change to all books:
//   Genres   — array field, uses $[elem] + arrayFilters to update only the matching element
//   Houses   — scalar field, plain $set
//   Languages — scalar field, plain $set

exports.update = async (req, res) => {
    try {
        const { type, id } = req.params;
        const col = getCollection(type);
        if (!col) return res.status(404).json({ message: "Unknown reference type" });
        const idv = validateObjectId(id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });
        const nv = validateReferenceName(req.body.name);
        if (!nv.valid) return res.status(400).json({ message: nv.message });

        const newName = toTitleCase(req.body.name);
        const collection = col.getter();
        const docId = new ObjectId(id);

        // Read old name before updating — needed for propagation query
        const existing = await collection.findOne({ _id: docId });
        if (!existing) return res.status(404).json({ message: `${col.label} not found` });
        const oldName = existing.name;

        // Duplicate check excluding self
        const duplicate = await collection.findOne({
            name: { $regex: `^${escapeRegex(newName)}$`, $options: "i" },
            _id: { $ne: docId },
        });
        if (duplicate) return res.status(400).json({ message: `${col.label} "${newName}" already exists` });

        const result = await collection.findOneAndUpdate(
            { _id: docId },
            { $set: { name: newName, updatedAt: new Date() } },
            { returnDocument: "after" }
        );
        if (!result) return res.status(404).json({ message: `${col.label} not found` });

        // Propagate to books only if name actually changed
        if (oldName !== newName) {
            const books = getBooks();
            if (col.isArray) {
                // Genre is stored as an array — update only the matching element
                await books.updateMany(
                    { [col.bookField]: oldName },
                    { $set: { [`${col.bookField}.$[elem]`]: newName, updatedAt: new Date() } },
                    { arrayFilters: [{ "elem": oldName }] }
                );
            } else {
                // House / Language — scalar field
                await books.updateMany(
                    { [col.bookField]: oldName },
                    { $set: { [col.bookField]: newName, updatedAt: new Date() } }
                );
            }
        }

        res.json({ data: result });
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ message: "This name already exists" });
        res.status(500).json({ message: "Failed to update entry", error: process.env.NODE_ENV === "development" ? error.message : undefined });
    }
};

// ─── DELETE ───────────────────────────────────────────────────────────────────
// Blocked if the value is mapped to any book. User must unmap from books first.

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
        const usageCount = await getBooks().countDocuments({ [col.bookField]: item.name });
        if (usageCount > 0) {
            return res.status(400).json({
                message: `Cannot delete "${item.name}" — it is used by ${usageCount} ${usageCount === 1 ? "book" : "books"}. Remove it from all books first.`,
            });
        }
        await collection.deleteOne({ _id: docId });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: "Failed to delete entry", error: process.env.NODE_ENV === "development" ? error.message : undefined });
    }
};