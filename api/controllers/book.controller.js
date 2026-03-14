const bookModel = require("../models/book.model.js");
const mongoose = require("mongoose");

const ALLOWED_STATUSES = ["read", "reading", "want to read"];

// Strip HTML tags from free-text input to neutralise any injected markup.
// React escapes output by default so XSS via the browser is already blocked,
// but sanitising at write-time protects any future non-React consumers
// (exports, emails, server-side rendering) that may render the raw DB value.
function sanitizeText(str) {
    return str ? str.replace(/<[^>]*>/g, "").trim() : "";
}

// Extracts the current user's status from a book's statuses array and returns
// it as a plain string (or null). Single source of truth — used by all handlers.
function extractUserStatus(book, userId) {
    const entry = (book.statuses || []).find(
        (s) => s.userId.toString() === userId.toString()
    );
    return entry?.status || null;
}


// ─── Fetch all books (browse + filter mode, offset pagination) ────────────────

exports.fetchAllBooks = async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 10, 100));
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const skip = (page - 1) * limit;

        const allowedSortFields = ["title", "author", "house"];
        const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : null;
        const sortOrder = req.query.sortOrder === "desc" ? -1 : 1;
        const sortStage = sortBy ? { [sortBy]: sortOrder, _id: sortOrder } : { _id: -1 };

        const filter = {};

        if (req.query.filterHouse) filter.house = req.query.filterHouse;

        // filterGenre may be a single string or an array of strings (repeated params).
        // $all enforces AND semantics — book must have every selected genre.
        if (req.query.filterGenre) {
            const genres = Array.isArray(req.query.filterGenre)
                ? req.query.filterGenre
                : [req.query.filterGenre];
            filter.genre = { $all: genres };
        }

        if (req.query.filterStatus) {
            if (!ALLOWED_STATUSES.includes(req.query.filterStatus)) {
                return res.status(400).json({ message: "Invalid status filter" });
            }
            filter.statuses = {
                $elemMatch: {
                    userId: new mongoose.Types.ObjectId(req.user.id),
                    status: req.query.filterStatus,
                },
            };
        }

        const [results, total] = await Promise.all([
            bookModel.find(filter).sort(sortStage).skip(skip).limit(limit).lean(),
            bookModel.countDocuments(filter),
        ]);

        const totalPages = Math.ceil(total / limit) || 1;

        const data = results.map((book) => ({
            ...book,
            userStatus: extractUserStatus(book, req.user.id),
        }));

        res.json({
            data,
            pagination: {
                total,
                totalPages,
                currentPage: page,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1,
            },
        });

    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch books",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


// ─── Search books (Atlas Search, cursor pagination) ───────────────────────────

exports.searchBooks = async (req, res) => {
    try {
        const { q, filterHouse, filterGenre, filterStatus } = req.query;
        const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 10, 100));

        if (!q && !filterHouse && !filterGenre && !filterStatus) {
            return res.status(400).json({ message: "Provide a search query or at least one filter" });
        }

        if (filterStatus && !ALLOWED_STATUSES.includes(filterStatus)) {
            return res.status(400).json({ message: "Invalid status filter" });
        }

        let searchAfter;
        try {
            searchAfter = req.query.searchAfter
                ? JSON.parse(req.query.searchAfter)
                : undefined;
        } catch {
            return res.status(400).json({ message: "Invalid searchAfter value" });
        }

        const compound = {};

        if (q) {
            compound.should = [
                { autocomplete: { query: q, path: "title", tokenOrder: "sequential" } },
                { autocomplete: { query: q, path: "author", tokenOrder: "sequential" } },
            ];
            compound.minimumShouldMatch = 1;
        }

        const filters = [];
        if (filterHouse) filters.push({ equals: { path: "house", value: filterHouse } });

        // Multiple genres use AND semantics — each genre becomes a separate must clause.
        // Atlas Search $search doesn't support $all, so we push one equals per genre.
        if (filterGenre) {
            const genres = Array.isArray(filterGenre) ? filterGenre : [filterGenre];
            genres.forEach((g) => filters.push({ equals: { path: "genre", value: g } }));
        }
        if (filterStatus) {
            filters.push({
                embeddedDocument: {
                    path: "statuses",
                    operator: {
                        compound: {
                            filter: [
                                { equals: { path: "statuses.userId", value: new mongoose.Types.ObjectId(req.user.id) } },
                                { equals: { path: "statuses.status", value: filterStatus } },
                            ],
                        },
                    },
                },
            });
        }

        if (filters.length > 0) compound.filter = filters;

        const pipeline = [
            {
                $search: {
                    index: "bookSearch",
                    compound,
                    sort: { createdAt: -1, _id: -1 },
                    ...(searchAfter && { searchAfter }),
                },
            },
            { $limit: limit + 1 },
        ];

        const results = await bookModel.aggregate(pipeline);

        let nextCursor = null;
        if (results.length > limit) {
            const last = results[limit - 1];
            nextCursor = [last.createdAt, last._id];
            results.pop();
        }

        const data = results.map((book) => ({
            ...book,
            userStatus: extractUserStatus(book, req.user.id),
        }));

        res.json({
            data,
            pagination: { nextCursor, hasMore: !!nextCursor },
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Search failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


// ─── Add book ─────────────────────────────────────────────────────────────────

exports.addBook = async (req, res) => {
    try {
        const { title, author, genre, house, description, userStatus } = req.body;

        if (!title?.trim() || !author?.trim() || !house || !genre?.length) {
            return res.status(400).json({ message: "All fields required" });
        }

        if (description && description.length > 1000) {
            return res.status(400).json({ message: "Description must be 1000 characters or fewer" });
        }

        const book = await bookModel.create({
            title: sanitizeText(title),
            author: sanitizeText(author),
            genre,
            house,
            description: sanitizeText(description),
        });

        // If a status was provided at add time, attach it immediately
        if (userStatus && ALLOWED_STATUSES.includes(userStatus)) {
            const userId = new mongoose.Types.ObjectId(req.user.id);
            await bookModel.findByIdAndUpdate(book._id, {
                $push: { statuses: { userId, status: userStatus } },
            });
        }

        const created = await bookModel.findById(book._id).lean();
        res.status(201).json({ data: { ...created, userStatus: userStatus || null } });

    } catch (error) {
        res.status(500).json({
            message: "Failed to add book",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


// ─── Update book ──────────────────────────────────────────────────────────────

exports.updateBook = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid book ID" });
        }

        const { title, author, genre, house, description, userStatus } = req.body;

        if (!title?.trim() || !author?.trim() || !house || !genre?.length) {
            return res.status(400).json({ message: "All fields required" });
        }

        if (description && description.length > 1000) {
            return res.status(400).json({ message: "Description must be 1000 characters or fewer" });
        }

        if (userStatus !== undefined && userStatus !== null && !ALLOWED_STATUSES.includes(userStatus)) {
            return res.status(400).json({ message: "Invalid status value" });
        }

        const userId = new mongoose.Types.ObjectId(req.user.id);
        const userIdStr = req.user.id.toString();

        const coreUpdate = {
            title: sanitizeText(title),
            author: sanitizeText(author),
            genre,
            house,
            description: sanitizeText(description),
        };

        // Atomic status update — $pull existing entry, then $push new one if set
        await bookModel.findByIdAndUpdate(id, {
            $set: coreUpdate,
            $pull: { statuses: { userId } },
        });

        if (userStatus) {
            await bookModel.findByIdAndUpdate(id, {
                $push: { statuses: { userId, status: userStatus } },
            });
        }

        const updated = await bookModel.findById(id).lean();

        if (!updated) {
            return res.status(404).json({ message: "Book not found" });
        }

        res.json({
            data: {
                ...updated,
                userStatus: extractUserStatus(updated, userIdStr),
            },
        });

    } catch (error) {
        res.status(500).json({
            message: "Update failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


// ─── Delete book ──────────────────────────────────────────────────────────────

exports.deleteBook = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid book ID" });
        }

        const deleted = await bookModel.findByIdAndDelete(id);

        if (!deleted) {
            return res.status(404).json({ message: "Book not found" });
        }

        res.json({ success: true });

    } catch (error) {
        res.status(500).json({
            message: "Delete failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};