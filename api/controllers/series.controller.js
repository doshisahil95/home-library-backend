const { ObjectId } = require("mongodb");
const { getSeries, getBooks } = require("../db.js");
const validate = require("../utils/validate.js");

function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/* ═══════════════════════ LIST ALL SERIES ═══════════════════════════════════ */

exports.listSeries = async (req, res) => {
    try {
        const [allSeries, seriesBooks] = await Promise.all([
            getSeries().find({}).sort({ name: 1 }).toArray(),
            getBooks().find(
                { "series.id": { $exists: true } },
                { projection: { title: 1, author: 1, "series.id": 1, "series.name": 1, "series.order": 1, statuses: 1 } }
            ).toArray(),
        ]);

        const booksBySeries = new Map();
        for (const book of seriesBooks) {
            const sid = book.series.id.toString();
            if (!booksBySeries.has(sid)) booksBySeries.set(sid, []);
            booksBySeries.get(sid).push({
                _id: book._id,
                title: book.title,
                author: book.author,
                order: book.series.order ?? null,
                readByMe: (book.statuses || []).some(
                    (s) => s.userId.toString() === req.user.id && s.status === "read"
                ),
            });
        }

        for (const arr of booksBySeries.values()) {
            arr.sort((a, b) => (a.order ?? 9999) - (b.order ?? 9999));
        }

        const data = allSeries.map((s) => {
            const bks = booksBySeries.get(s._id.toString()) || [];
            return {
                ...s,
                books: bks,
                readCount: bks.filter((b) => b.readByMe).length,
                totalCount: bks.length,
                nextToRead: bks.find((b) => !b.readByMe) || null,
            };
        });

        res.json({ data });
    } catch (error) {
        res.status(500).json({ message: "Failed to fetch series", error: process.env.NODE_ENV === "development" ? error.message : undefined });
    }
};

/* ═══════════════════════ CREATE SERIES ═════════════════════════════════════ */

exports.createSeries = async (req, res) => {
    try {
        const { name, description } = req.body;
        const v = validate.validateSeriesBody({ name, description });
        if (!v.valid) return res.status(400).json({ message: v.message });

        const seriesCol = getSeries();
        const existing = await seriesCol.findOne({ name: { $regex: `^${escapeRegex(name.trim())}$`, $options: "i" } });
        if (existing) return res.status(400).json({ message: `Series "${name.trim()}" already exists` });

        const now = new Date();
        const result = await seriesCol.insertOne({ name: name.trim(), description: (description || "").trim(), createdAt: now, updatedAt: now });
        const created = await seriesCol.findOne({ _id: result.insertedId });
        res.status(201).json({ data: { ...created, books: [], readCount: 0, totalCount: 0, nextToRead: null } });
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ message: "A series with this name already exists" });
        res.status(500).json({ message: "Failed to create series", error: process.env.NODE_ENV === "development" ? error.message : undefined });
    }
};

/* ═══════════════════════ UPDATE SERIES ═════════════════════════════════════ */

exports.updateSeries = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, description } = req.body;
        const idv = validate.validateObjectId(id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });
        const v = validate.validateSeriesBody({ name, description });
        if (!v.valid) return res.status(400).json({ message: v.message });

        const seriesCol = getSeries();
        const docId = new ObjectId(id);

        const duplicate = await seriesCol.findOne({
            name: { $regex: `^${escapeRegex(name.trim())}$`, $options: "i" },
            _id: { $ne: docId },
        });
        if (duplicate) return res.status(400).json({ message: `Series "${name.trim()}" already exists` });

        const result = await seriesCol.findOneAndUpdate(
            { _id: docId },
            { $set: { name: name.trim(), description: (description || "").trim(), updatedAt: new Date() } },
            { returnDocument: "after" }
        );
        if (!result) return res.status(404).json({ message: "Series not found" });

        // Propagate name change to all linked books
        await getBooks().updateMany(
            { "series.id": docId },
            { $set: { "series.name": name.trim(), updatedAt: new Date() } }
        );

        res.json({ data: result });
    } catch (error) {
        if (error.code === 11000) return res.status(400).json({ message: "A series with this name already exists" });
        res.status(500).json({ message: "Failed to update series", error: process.env.NODE_ENV === "development" ? error.message : undefined });
    }
};

/* ═══════════════════════ DELETE SERIES ═════════════════════════════════════ */

exports.deleteSeries = async (req, res) => {
    try {
        const { id } = req.params;
        const idv = validate.validateObjectId(id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const seriesCol = getSeries();
        const docId = new ObjectId(id);
        const series = await seriesCol.findOne({ _id: docId });
        if (!series) return res.status(404).json({ message: "Series not found" });

        // Unlink all books before deleting
        await getBooks().updateMany(
            { "series.id": docId },
            { $unset: { series: "" }, $set: { updatedAt: new Date() } }
        );

        await seriesCol.deleteOne({ _id: docId });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: "Failed to delete series", error: process.env.NODE_ENV === "development" ? error.message : undefined });
    }
};

/* ═══════════════════════ ASSIGN BOOK TO SERIES ═════════════════════════════ */

exports.assignBookToSeries = async (req, res) => {
    try {
        const { bookId } = req.params;
        const { seriesId, order } = req.body;

        const bidv = validate.validateObjectId(bookId);
        if (!bidv.valid) return res.status(400).json({ message: bidv.message });
        const sidv = validate.validateObjectId(seriesId);
        if (!sidv.valid) return res.status(400).json({ message: "Invalid series ID" });
        if (order !== undefined && order !== null && order !== "") {
            const ov = validate.validateSeriesOrder(order);
            if (!ov.valid) return res.status(400).json({ message: ov.message });
        }

        const series = await getSeries().findOne({ _id: new ObjectId(seriesId) });
        if (!series) return res.status(404).json({ message: "Series not found" });

        const book = await getBooks().findOne({ _id: new ObjectId(bookId) }, { projection: { _id: 1 } });
        if (!book) return res.status(404).json({ message: "Book not found" });

        // If an order number is provided, check no other book in this series already has it
        if (order !== undefined && order !== null && order !== "") {
            const conflict = await getBooks().findOne({
                "series.id": series._id,
                "series.order": Number(order),
                _id: { $ne: new ObjectId(bookId) },   // exclude the book being updated
            }, { projection: { _id: 1, title: 1 } });
            if (conflict) {
                return res.status(400).json({
                    message: `Order ${Number(order)} is already taken by another book in this series`,
                });
            }
        }

        const seriesEntry = {
            id: series._id,
            name: series.name,
            ...(order !== undefined && order !== null && order !== "" ? { order: Number(order) } : {}),
        };

        await getBooks().updateOne(
            { _id: new ObjectId(bookId) },
            { $set: { series: seriesEntry, updatedAt: new Date() } }
        );

        res.json({ data: seriesEntry });
    } catch (error) {
        res.status(500).json({ message: "Failed to assign book to series", error: process.env.NODE_ENV === "development" ? error.message : undefined });
    }
};

/* ═══════════════════════ REMOVE BOOK FROM SERIES ═══════════════════════════ */

exports.removeBookFromSeries = async (req, res) => {
    try {
        const { bookId } = req.params;
        const idv = validate.validateObjectId(bookId);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const book = await getBooks().findOne({ _id: new ObjectId(bookId) }, { projection: { _id: 1, series: 1 } });
        if (!book) return res.status(404).json({ message: "Book not found" });
        if (!book.series) return res.status(400).json({ message: "Book is not part of any series" });

        await getBooks().updateOne(
            { _id: new ObjectId(bookId) },
            { $unset: { series: "" }, $set: { updatedAt: new Date() } }
        );
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ message: "Failed to remove book from series", error: process.env.NODE_ENV === "development" ? error.message : undefined });
    }
};