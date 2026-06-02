const { ObjectId } = require("mongodb");
const { getBooks, getUsers } = require("../db.js");
const validate = require("../utils/validate.js");

// Strip HTML tags from free-text input to neutralise any injected markup.
function sanitizeText(str) {
    return str ? str.replace(/<[^>]*>/g, "").trim() : "";
}

const ALLOWED_STATUSES = ["read", "reading", "want to read"];

// Extracts the current user's full status entry from a book's statuses array.
// Returns a flat object with status, dates, locks, rating and isPublic.
// isPublic is derived from the top-level publicByUsers array — independent of reading status.
function extractUserStatus(book, userId) {
    const userIdStr = userId.toString();
    const entry = (book.statuses || []).find(
        (s) => s.userId.toString() === userIdStr
    );
    // isPublic lives on the book's publicByUsers array, not inside the status entry
    const isPublic = (book.publicByUsers || []).some(
        (id) => id.toString() === userIdStr
    );
    if (!entry) return {
        userStatus: null, startedAt: null, startedAtLocked: false,
        finishedAt: null, finishedAtLocked: false, rating: null, isPublic,
    };
    return {
        userStatus: entry.status,
        startedAt: entry.startedAt || null,
        startedAtLocked: entry.startedAtLocked || false,
        finishedAt: entry.finishedAt || null,
        finishedAtLocked: entry.finishedAtLocked || false,
        rating: entry.rating ?? null,
        isPublic,
    };
}

// Notes are stored as { userId, text, updatedAt } per entry. The frontend needs
// to display the author's name alongside each note, so we resolve userId -> name
// in a single query for the whole page of books rather than N round trips.
async function enrichBooksWithNoteAuthors(books) {
    const ids = new Set();
    for (const b of books) {
        for (const n of (b.notes || [])) {
            if (n?.userId) ids.add(n.userId.toString());
        }
    }
    if (ids.size === 0) {
        return books.map((b) => ({ ...b, notes: (b.notes || []).map(normaliseNote) }));
    }
    const users = await getUsers().find(
        { _id: { $in: Array.from(ids).map((id) => new ObjectId(id)) } },
        { projection: { name: 1 } }
    ).toArray();
    const nameById = {};
    for (const u of users) nameById[u._id.toString()] = u.name;
    return books.map((b) => ({
        ...b,
        notes: (b.notes || []).map((n) => ({
            ...normaliseNote(n),
            userName: nameById[n.userId.toString()] || "Unknown",
        })),
    }));
}

function normaliseNote(n) {
    return {
        userId: n.userId?.toString() || null,
        text: n.text || "",
        updatedAt: n.updatedAt || null,
    };
}

// ─── Fetch all books (browse + filter mode, offset pagination) ────────────────
exports.fetchAllBooks = async (req, res) => {
    try {
        const { limit, page } = validate.parsePaginationParams(req.query);
        const skip = (page - 1) * limit;
        const { sortBy, sortOrder } = validate.parseSortParams(req.query);
        const sortStage = sortBy
            ? { [sortBy]: sortOrder, _id: sortOrder }
            : { _id: 1 };

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
        const enriched = await enrichBooksWithNoteAuthors(results);
        const data = enriched.map((book) => ({
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
        // searchAfter is the opaque base64 token from $meta: "searchSequenceToken" on the previous page.
        // Pass it directly as a string — never parse or transform it.
        const searchAfter = req.query.searchAfter || null;

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
                    sort: { _id: 1 },
                    ...(searchAfter && { searchAfter }),
                },
            },
            // $project must come before $limit so $meta: "searchSequenceToken" is still in scope.
            // The token is an opaque base64 string issued by Atlas Search for cursor pagination.
            {
                $project: {
                    _id: 1,
                    title: 1,
                    author: 1,
                    genre: 1,
                    house: 1,
                    language: 1,
                    locationInHouse: 1,
                    description: 1,
                    statuses: 1,
                    publicByUsers: 1,
                    notes: 1,
                    series: 1,
                    createdAt: 1,
                    updatedAt: 1,
                    paginationToken: { $meta: "searchSequenceToken" },
                },
            },
            { $limit: limit + 1 },
        ];

        const books = getBooks();
        const results = await books.aggregate(pipeline).toArray();

        let nextCursor = null;
        if (results.length > limit) {
            // paginationToken is the opaque base64 string from $meta: "searchSequenceToken"
            nextCursor = results[limit - 1].paginationToken;
            results.pop();
        }

        // Strip paginationToken from the response — it's internal pagination state only
        const stripped = results.map(({ paginationToken, ...book }) => book);
        const enriched = await enrichBooksWithNoteAuthors(stripped);
        const data = enriched.map((book) => ({
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
        const { title, author, genre, house, language, locationInHouse, description, userStatus, isPublic } = req.body;
        const av = validate.validateBookBody({ title, author, house, genre, description, language, locationInHouse, userStatus });
        if (!av.valid) return res.status(400).json({ message: av.message });

        const books = getBooks();
        const now = new Date();
        const userId = new ObjectId(req.user.id);
        const isPublicBool = isPublic === true || isPublic === "true";

        const newBook = {
            title: sanitizeText(title),
            author: sanitizeText(author),
            genre,
            house,
            language: language || "",
            locationInHouse: sanitizeText(locationInHouse),
            description: sanitizeText(description),
            statuses: [],
            publicByUsers: isPublicBool ? [userId] : [],
            createdAt: now,
            updatedAt: now,
        };

        // If a status was provided at add time, build the full status entry
        if (userStatus && ALLOWED_STATUSES.includes(userStatus)) {
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
        if (error.code === 11000) {
            return res.status(400).json({ message: "A book with this title and author already exists" });
        }
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

        const { title, author, genre, house, language, locationInHouse, description, userStatus, isPublic } = req.body;
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
                    // Already locked — preserve, ignore incoming value
                    statusEntry.startedAt = existingEntry.startedAt;
                    statusEntry.startedAtLocked = true;
                } else if (startedAt !== undefined && startedAt !== null) {
                    const incoming = new Date(startedAt);
                    const existing = existingEntry?.startedAt ? new Date(existingEntry.startedAt) : null;
                    // Only lock if the user actually changed the date (or there was no existing date)
                    const isRealEdit = !existing || incoming.getTime() !== existing.getTime();
                    statusEntry.startedAt = incoming;
                    statusEntry.startedAtLocked = isRealEdit;
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
                    // Already locked — preserve, ignore incoming value
                    statusEntry.finishedAt = existingEntry.finishedAt;
                    statusEntry.finishedAtLocked = true;
                } else if (finishedAt !== undefined && finishedAt !== null) {
                    const incomingF = new Date(finishedAt);
                    const existingF = existingEntry?.finishedAt ? new Date(existingEntry.finishedAt) : null;
                    const isRealEditF = !existingF || incomingF.getTime() !== existingF.getTime();
                    statusEntry.finishedAt = incomingF;
                    statusEntry.finishedAtLocked = isRealEditF;
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

        const isPublicBool = isPublic === true || isPublic === "true";

        // Atomic update: core fields + pull old status entry + update publicByUsers
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
                // Toggle public visibility — $addToSet / $pull are separate ops so we do it after
            }
        );

        // Handle publicByUsers — independent of reading status
        if (isPublicBool) {
            await books.updateOne({ _id: bookId }, { $addToSet: { publicByUsers: userId } });
        } else {
            await books.updateOne({ _id: bookId }, { $pull: { publicByUsers: userId } });
        }

        // Push new status entry if status is set
        if (statusEntry) {
            await books.updateOne(
                { _id: bookId },
                { $push: { statuses: statusEntry } }
            );
        } else if (existingEntry) {
            // No status change — re-push the existing entry unchanged
            await books.updateOne(
                { _id: bookId },
                { $push: { statuses: existingEntry } }
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
        if (error.code === 11000) {
            return res.status(400).json({ message: "A book with this title and author already exists" });
        }
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
