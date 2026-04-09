const { ObjectId } = require("mongodb");
const { getBooks } = require("../db.js");
const validate = require("../utils/validate.js");

// Strip HTML tags from free-text input to neutralise any injected markup.
function sanitizeText(str) {
    return str ? str.replace(/<[^>]*>/g, "").trim() : "";
}

const ALLOWED_STATUSES = ["read", "reading", "want to read"];

// Extracts the current user's full status entry from a book's statuses array.
// Returns a flat object with status, dates, locks and rating — or nulls if not set.
function extractUserStatus(book, userId) {
    const entry = (book.statuses || []).find(
        (s) => s.userId.toString() === userId.toString()
    );
    if (!entry) return {
        userStatus: null, startedAt: null, startedAtLocked: false,
        finishedAt: null, finishedAtLocked: false, rating: null,
    };
    return {
        userStatus: entry.status,
        startedAt: entry.startedAt || null,
        startedAtLocked: entry.startedAtLocked || false,
        finishedAt: entry.finishedAt || null,
        finishedAtLocked: entry.finishedAtLocked || false,
        rating: entry.rating ?? null,
    };
}


// ─── Fetch all books (browse + filter mode, offset pagination) ────────────────

exports.fetchAllBooks = async (req, res) => {
    try {
        const { limit, page } = validate.parsePaginationParams(req.query);
        const skip = (page - 1) * limit;

        const { sortBy, sortOrder } = validate.parseSortParams(req.query);
        const sortStage = sortBy ? { [sortBy]: sortOrder, _id: sortOrder } : { _id: -1 };

        const filter = {};

        if (req.query.filterHouse) filter.house = req.query.filterHouse;
        if (req.query.filterLanguage) {
            const lv = validate.validateLanguageFilter(req.query.filterLanguage);
            if (!lv.valid) return res.status(400).json({ message: lv.message });
            filter.language = req.query.filterLanguage;
        }

        const genres = validate.parseGenreFilter(req.query.filterGenre);
        if (genres.length) filter.genre = { $all: genres };

        if (req.query.filterStatus) {
            const v = validate.validateStatusFilter(req.query.filterStatus);
            if (!v.valid) return res.status(400).json({ message: v.message });
            if (req.query.filterStatus === "no-status") {
                filter.statuses = {
                    $not: { $elemMatch: { userId: new ObjectId(req.user.id) } },
                };
            } else {
                filter.statuses = {
                    $elemMatch: {
                        userId: new ObjectId(req.user.id),
                        status: req.query.filterStatus,
                    },
                };
            }
        }

        const books = getBooks();

        const [results, total] = await Promise.all([
            books.find(filter).sort(sortStage).skip(skip).limit(limit).toArray(),
            books.countDocuments(filter),
        ]);

        const totalPages = Math.ceil(total / limit) || 1;

        const data = results.map((book) => ({
            ...book,
            ...extractUserStatus(book, req.user.id),
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
        const { q, filterHouse, filterGenre, filterStatus, filterLanguage } = req.query;
        const { limit } = validate.parsePaginationParams(req.query);

        if (!q && !filterHouse && !filterGenre && !filterStatus && !filterLanguage) {
            return res.status(400).json({ message: "Provide a search query or at least one filter" });
        }

        const sv = validate.validateStatusFilter(filterStatus);
        if (!sv.valid) return res.status(400).json({ message: sv.message });

        if (filterStatus === "no-status") {
            return res.status(400).json({ message: "The 'No status' filter cannot be combined with a text search" });
        }

        const sa = validate.parseSearchAfter(req.query.searchAfter);
        if (!sa.valid) return res.status(400).json({ message: sa.message });
        const searchAfter = sa.value;

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
        if (filterLanguage) filters.push({ equals: { path: "language", value: filterLanguage } });

        validate.parseGenreFilter(filterGenre).forEach((g) =>
            filters.push({ equals: { path: "genre", value: g } })
        );

        if (filterStatus) {
            filters.push({
                embeddedDocument: {
                    path: "statuses",
                    operator: {
                        compound: {
                            filter: [
                                { equals: { path: "statuses.userId", value: new ObjectId(req.user.id) } },
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

        const books = getBooks();
        const results = await books.aggregate(pipeline).toArray();

        let nextCursor = null;
        if (results.length > limit) {
            const last = results[limit - 1];
            nextCursor = [last.createdAt, last._id];
            results.pop();
        }

        const data = results.map((book) => ({
            ...book,
            ...extractUserStatus(book, req.user.id),
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
        const { title, author, genre, house, language, locationInHouse, description, userStatus } = req.body;

        const av = validate.validateBookBody({ title, author, house, genre, description, language, locationInHouse, userStatus });
        if (!av.valid) return res.status(400).json({ message: av.message });

        const books = getBooks();
        const now = new Date();

        const newBook = {
            title: sanitizeText(title),
            author: sanitizeText(author),
            genre,
            house,
            language: language || "",
            locationInHouse: sanitizeText(locationInHouse),
            description: sanitizeText(description),
            statuses: [],
            createdAt: now,
            updatedAt: now,
        };

        // If a status was provided at add time, build the full status entry
        if (userStatus && ALLOWED_STATUSES.includes(userStatus)) {
            const userId = new ObjectId(req.user.id);
            const { startedAt, finishedAt, rating } = req.body;

            const dv = validate.validateReadingDates({ startedAt, finishedAt });
            if (!dv.valid) return res.status(400).json({ message: dv.message });
            const rv = validate.validateRating(rating);
            if (!rv.valid) return res.status(400).json({ message: rv.message });

            const statusEntry = { userId, status: userStatus };

            if (userStatus === "reading" || userStatus === "read") {
                statusEntry.startedAt = startedAt ? new Date(startedAt) : now;
            }
            if (userStatus === "read") {
                statusEntry.finishedAt = finishedAt ? new Date(finishedAt) : now;
                if (rating !== undefined && rating !== null) statusEntry.rating = Number(rating);
            }

            newBook.statuses.push(statusEntry);
        }

        const result = await books.insertOne(newBook);
        const created = await books.findOne({ _id: result.insertedId });

        res.status(201).json({ data: { ...created, ...extractUserStatus(created, req.user.id) } });

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

        const idv = validate.validateObjectId(id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const { title, author, genre, house, language, locationInHouse, description, userStatus } = req.body;

        const uv = validate.validateBookBody({ title, author, house, genre, description, userStatus });
        if (!uv.valid) return res.status(400).json({ message: uv.message });

        const userId = new ObjectId(req.user.id);
        const userIdStr = req.user.id.toString();
        const bookId = new ObjectId(id);

        const { startedAt, finishedAt, rating } = req.body;

        const dv = validate.validateReadingDates({ startedAt, finishedAt });
        if (!dv.valid) return res.status(400).json({ message: dv.message });
        const rv = validate.validateRating(rating);
        if (!rv.valid) return res.status(400).json({ message: rv.message });

        const books = getBooks();
        const existing = await books.findOne({ _id: bookId });
        if (!existing) return res.status(404).json({ message: "Book not found" });

        const existingEntry = (existing.statuses || []).find(
            (s) => s.userId.toString() === userIdStr
        );

        const currentStatus = existingEntry?.status || null;
        const tv = validate.validateStatusTransition(currentStatus, userStatus);
        if (!tv.valid) return res.status(400).json({ message: tv.message });

        // Build new status entry respecting lock flags
        let statusEntry = null;
        if (userStatus) {
            const now = new Date();
            statusEntry = { userId, status: userStatus };

            if (userStatus === "reading" || userStatus === "read") {
                if (existingEntry?.startedAtLocked) {
                    statusEntry.startedAt = existingEntry.startedAt;
                    statusEntry.startedAtLocked = true;
                } else if (startedAt !== undefined && startedAt !== null) {
                    statusEntry.startedAt = new Date(startedAt);
                    statusEntry.startedAtLocked = true;
                } else if (existingEntry?.startedAt) {
                    statusEntry.startedAt = existingEntry.startedAt;
                    statusEntry.startedAtLocked = false;
                } else {
                    statusEntry.startedAt = now;
                    statusEntry.startedAtLocked = false;
                }
            }

            if (userStatus === "read") {
                if (existingEntry?.finishedAtLocked) {
                    statusEntry.finishedAt = existingEntry.finishedAt;
                    statusEntry.finishedAtLocked = true;
                } else if (finishedAt !== undefined && finishedAt !== null) {
                    statusEntry.finishedAt = new Date(finishedAt);
                    statusEntry.finishedAtLocked = true;
                } else if (existingEntry?.finishedAt) {
                    statusEntry.finishedAt = existingEntry.finishedAt;
                    statusEntry.finishedAtLocked = false;
                } else {
                    statusEntry.finishedAt = now;
                    statusEntry.finishedAtLocked = false;
                }

                if (existingEntry?.rating !== undefined && existingEntry?.rating !== null) {
                    statusEntry.rating = existingEntry.rating;
                } else if (rating !== undefined && rating !== null) {
                    statusEntry.rating = Number(rating);
                }
            }
        }

        // Pull old status entry and update core fields atomically
        await books.updateOne(
            { _id: bookId },
            {
                $set: {
                    title: sanitizeText(title),
                    author: sanitizeText(author),
                    genre,
                    house,
                    language: language || "",
                    locationInHouse: sanitizeText(locationInHouse),
                    description: sanitizeText(description),
                    updatedAt: new Date(),
                },
                $pull: { statuses: { userId } },
            }
        );

        // Push new status entry if status is set
        if (statusEntry) {
            await books.updateOne(
                { _id: bookId },
                { $push: { statuses: statusEntry } }
            );
        }

        const updated = await books.findOne({ _id: bookId });

        res.json({
            data: {
                ...updated,
                ...extractUserStatus(updated, userIdStr),
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

        const dv = validate.validateObjectId(id);
        if (!dv.valid) return res.status(400).json({ message: dv.message });

        const books = getBooks();
        const result = await books.deleteOne({ _id: new ObjectId(id) });

        if (result.deletedCount === 0) {
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