const bookModel = require("../models/book.model.js");
const mongoose = require("mongoose");

const ALLOWED_STATUSES = ["read", "reading", "want to read"];

// Extracts the current user's status from a book's statuses array and
// returns it as a plain string (or null). Called before sending any book
// to the frontend so the client never has to dig through the array.
function extractUserStatus(book, userId) {
    const entry = book.statuses?.find(
        (s) => s.userId.toString() === userId.toString()
    );
    return entry?.status || null;
}


// ─── Fetch all books ──────────────────────────────────────────────────────────

exports.fetchAllBooks = async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 10, 100));
        const page  = Math.max(1, parseInt(req.query.page) || 1);
        const skip  = (page - 1) * limit;

        const allowedSortFields = ["title", "author", "house"];
        const sortBy    = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : null;
        const sortOrder = req.query.sortOrder === "desc" ? -1 : 1;

        const sortStage = sortBy
            ? { [sortBy]: sortOrder, _id: sortOrder }
            : { _id: -1 };

        // Build filter — only add conditions that are actually present
        const filter = {};

        if (req.query.filterHouse) {
            filter.house = req.query.filterHouse;
        }

        if (req.query.filterGenre) {
            filter.genre = req.query.filterGenre;
        }

        if (req.query.filterStatus) {
            if (!ALLOWED_STATUSES.includes(req.query.filterStatus)) {
                return res.status(400).json({ message: "Invalid status filter" });
            }
            filter.statuses = {
                $elemMatch: {
                    userId: req.user.id,
                    status: req.query.filterStatus
                }
            };
        }

        const [results, total] = await Promise.all([
            bookModel.find(filter).sort(sortStage).skip(skip).limit(limit),
            bookModel.countDocuments(filter)
        ]);

        const totalPages = Math.ceil(total / limit) || 1;

        // Inject userStatus so the frontend gets a flat field instead of
        // having to search through the statuses array on every render
        const data = results.map((book) => ({
            ...book.toObject(),
            userStatus: extractUserStatus(book, req.user.id)
        }));

        res.json({
            data,
            pagination: {
                total,
                totalPages,
                currentPage: page,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });

    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch books",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
};


// ─── Search books ─────────────────────────────────────────────────────────────

exports.searchBooks = async (req, res) => {
    try {
        const { q, filterHouse, filterGenre, filterStatus } = req.query;
        const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 10, 100));

        // Must have at least a text query or one active filter
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

        // Build the compound query
        // — should:  autocomplete on title/author (only when text query present)
        // — filter:  exact match on house, genre, status (only when set)
        const compound = {};

        if (q) {
            compound.should = [
                { autocomplete: { query: q, path: "title",  tokenOrder: "sequential" } },
                { autocomplete: { query: q, path: "author", tokenOrder: "sequential" } }
            ];
            compound.minimumShouldMatch = 1;
        }

        const filters = [];

        if (filterHouse) {
            filters.push({ equals: { path: "house", value: filterHouse } });
        }

        if (filterGenre) {
            filters.push({ equals: { path: "genre", value: filterGenre } });
        }

        if (filterStatus) {
            // embeddedDocuments lets Atlas treat each { userId, status } entry
            // as a unit — prevents false matches from mixing fields across entries
            filters.push({
                embeddedDocument: {
                    path: "statuses",
                    operator: {
                        compound: {
                            filter: [
                                { equals: { path: "statuses.userId", value: req.user.id } },
                                { equals: { path: "statuses.status", value: filterStatus } }
                            ]
                        }
                    }
                }
            });
        }

        if (filters.length > 0) {
            compound.filter = filters;
        }

        const pipeline = [
            {
                $search: {
                    index: "bookSearch",
                    compound,
                    sort: { createdAt: -1, _id: -1 },
                    ...(searchAfter && { searchAfter })
                }
            },
            { $limit: limit + 1 }
        ];

        const results = await bookModel.aggregate(pipeline);

        let nextCursor = null;
        if (results.length > limit) {
            const last = results[limit - 1];
            nextCursor = [last.createdAt, last._id];
            results.pop();
        }

        // Inject userStatus into each result
        const userId = req.user.id.toString();
        const data = results.map((book) => {
            const entry = book.statuses?.find(
                (s) => s.userId.toString() === userId
            );
            return { ...book, userStatus: entry?.status || null };
        });

        res.json({
            data,
            pagination: { nextCursor, hasMore: !!nextCursor }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Search failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
};


// ─── Add book ─────────────────────────────────────────────────────────────────

exports.addBook = async (req, res) => {
    try {
        const { title, author, genre, house } = req.body;

        if (!title || !author || !house || !genre?.length) {
            return res.status(400).json({ message: "All fields required" });
        }

        const book = await bookModel.create({ title, author, genre, house });

        res.status(201).json({ data: { ...book.toObject(), userStatus: null } });

    } catch (error) {
        res.status(500).json({
            message: "Failed to add book",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
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

        if (!title || !author || !house || !genre?.length) {
            return res.status(400).json({ message: "All fields required" });
        }

        if (userStatus !== undefined && userStatus !== null && !ALLOWED_STATUSES.includes(userStatus)) {
            return res.status(400).json({ message: "Invalid status value" });
        }

        // Update the core book fields first
        const updated = await bookModel.findByIdAndUpdate(
            id,
            { title, author, genre, house, description },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: "Book not found" });
        }

        // Handle status update separately:
        // — If userStatus is null/undefined, remove the user's entry entirely
        // — Otherwise upsert: update in place if exists, push new entry if not
        const userId = new mongoose.Types.ObjectId(req.user.id);

        if (userStatus === null || userStatus === undefined) {
            updated.statuses = updated.statuses.filter(
                (s) => s.userId.toString() !== req.user.id.toString()
            );
        } else {
            const idx = updated.statuses.findIndex(
                (s) => s.userId.toString() === req.user.id.toString()
            );
            if (idx !== -1) {
                updated.statuses[idx].status = userStatus;
            } else {
                updated.statuses.push({ userId, status: userStatus });
            }
        }

        await updated.save();

        res.json({
            data: {
                ...updated.toObject(),
                userStatus: extractUserStatus(updated, req.user.id)
            }
        });

    } catch (error) {
        res.status(500).json({
            message: "Update failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
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
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
};