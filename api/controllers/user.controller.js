const { ObjectId } = require("mongodb");
const { getUsers, getBooks, getSeries } = require("../db.js");
const validate = require("../utils/validate.js");

// ─── Update theme ─────────────────────────────────────────────────────────────

exports.updateTheme = async (req, res) => {
    try {
        const tv = validate.validateTheme({ theme: req.body.theme });
        if (!tv.valid) return res.status(400).json({ message: tv.message });
        const result = await getUsers().findOneAndUpdate(
            { _id: new ObjectId(req.user.id) },
            { $set: { theme: req.body.theme, updatedAt: new Date() } },
            { returnDocument: "after" }
        );
        if (!result) return res.status(404).json({ message: "User not found" });
        res.json({ message: "Theme updated", theme: result.theme });
    } catch (err) {
        res.status(500).json({ message: "Failed to update theme" });
    }
};

// ─── Update profile ───────────────────────────────────────────────────────────

exports.updateProfile = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ message: "Name is required" });
        if (name.trim().length > 100) return res.status(400).json({ message: "Name must be 100 characters or fewer" });
        const result = await getUsers().findOneAndUpdate(
            { _id: new ObjectId(req.user.id) },
            { $set: { name: name.trim(), updatedAt: new Date() } },
            { returnDocument: "after" }
        );
        if (!result) return res.status(404).json({ message: "User not found" });
        res.json({ message: "Profile updated", name: result.name });
    } catch (err) {
        res.status(500).json({ message: "Failed to update profile" });
    }
};

// ─── Make all books private ───────────────────────────────────────────────────

exports.makeAllPrivate = async (req, res) => {
    try {
        const userId = new ObjectId(req.user.id);
        const result = await getBooks().updateMany(
            { publicByUsers: userId },
            { $pull: { publicByUsers: userId } }
        );
        res.json({ message: "All books made private", updated: result.modifiedCount });
    } catch (err) {
        res.status(500).json({ message: "Failed to make books private" });
    }
};

// ─── Get public book count ────────────────────────────────────────────────────

exports.getPublicCount = async (req, res) => {
    try {
        const count = await getBooks().countDocuments({ publicByUsers: new ObjectId(req.user.id) });
        res.json({ count });
    } catch (err) {
        res.status(500).json({ message: "Failed to get public count" });
    }
};

// ─── Reading goal ─────────────────────────────────────────────────────────────
// Goal is stored as { target, year } on the user document.
// The year is stored so we can always know if the goal is for the current year.

exports.setReadingGoal = async (req, res) => {
    try {
        const { target } = req.body;
        const v = validate.validateReadingGoal(target);
        if (!v.valid) return res.status(400).json({ message: v.message });
        const year = new Date().getFullYear();
        const result = await getUsers().findOneAndUpdate(
            { _id: new ObjectId(req.user.id) },
            { $set: { readingGoal: { target: Number(target), year }, updatedAt: new Date() } },
            { returnDocument: "after" }
        );
        if (!result) return res.status(404).json({ message: "User not found" });
        res.json({ data: result.readingGoal });
    } catch (err) {
        res.status(500).json({ message: "Failed to set reading goal" });
    }
};

exports.getReadingGoal = async (req, res) => {
    try {
        const userId = new ObjectId(req.user.id);
        const user = await getUsers().findOne({ _id: userId }, { projection: { readingGoal: 1 } });
        if (!user) return res.status(404).json({ message: "User not found" });

        const currentYear = new Date().getFullYear();
        const goal = user.readingGoal?.year === currentYear ? user.readingGoal : null;

        // Count books read this year
        const startOfYear = new Date(`${currentYear}-01-01T00:00:00.000Z`);
        const booksReadThisYear = await getBooks().countDocuments({
            statuses: {
                $elemMatch: {
                    userId,
                    status: "read",
                    finishedAt: { $gte: startOfYear },
                },
            },
        });

        res.json({ data: { goal, booksReadThisYear, year: currentYear } });
    } catch (err) {
        res.status(500).json({ message: "Failed to get reading goal" });
    }
};

// ─── Book notes ───────────────────────────────────────────────────────────────
// Notes are stored as an array on the book: notes: [{ userId, text, updatedAt }]
// Private — only the owning user can read/write their note.

exports.upsertNote = async (req, res) => {
    try {
        const { bookId } = req.params;
        const { text } = req.body;

        const idv = validate.validateObjectId(bookId);
        if (!idv.valid) return res.status(400).json({ message: idv.message });
        if (text && text.length > 1000) return res.status(400).json({ message: "Note must be 1000 characters or fewer" });

        const userId = new ObjectId(req.user.id);
        const bookObjId = new ObjectId(bookId);
        const books = getBooks();

        const book = await books.findOne({ _id: bookObjId }, { projection: { _id: 1 } });
        if (!book) return res.status(404).json({ message: "Book not found" });

        if (!text || !text.trim()) {
            // Empty text = delete the note
            await books.updateOne({ _id: bookObjId }, { $pull: { notes: { userId } } });
            return res.json({ success: true, deleted: true });
        }

        // Upsert: remove old note then push new one atomically
        await books.updateOne({ _id: bookObjId }, { $pull: { notes: { userId } } });
        await books.updateOne(
            { _id: bookObjId },
            { $push: { notes: { userId, text: text.trim(), updatedAt: new Date() } } }
        );

        res.json({ success: true, data: { text: text.trim(), updatedAt: new Date() } });
    } catch (err) {
        res.status(500).json({ message: "Failed to save note", error: process.env.NODE_ENV === "development" ? err.message : undefined });
    }
};

// ─── Get discover data ────────────────────────────────────────────────────────

exports.getDiscoverData = async (req, res) => {
    try {
        const idv = validate.validateObjectId(req.user.id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const userId = new ObjectId(req.user.id);
        const books = getBooks();
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const [
            myStatus,
            myGenreBreakdown,
            recentlyFinishedByOthers,
            readingTimeline,
            currentlyReading,
            activityFeed,
            allUsers,
            seriesList,
        ] = await Promise.all([

            // 1. My reading status counts
            books.aggregate([
                { $unwind: "$statuses" },
                { $match: { "statuses.userId": userId } },
                { $group: { _id: "$statuses.status", count: { $sum: 1 } } },
                { $project: { _id: 0, status: "$_id", count: 1 } },
            ]).toArray(),

            // 2. My genre breakdown
            books.aggregate([
                { $match: { statuses: { $elemMatch: { userId, status: { $in: ["read", "reading"] } } } } },
                { $unwind: "$genre" },
                { $group: { _id: "$genre", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $project: { _id: 0, genre: "$_id", count: 1 } },
            ]).toArray(),

            // 3. Recently finished by others (for recs score later)
            books.aggregate([
                { $unwind: "$statuses" },
                { $match: { "statuses.status": "read", "statuses.userId": { $ne: userId } } },
                { $sort: { "statuses.finishedAt": -1 } },
                { $limit: 10 },
                { $lookup: { from: "users", localField: "statuses.userId", foreignField: "_id", as: "readerInfo" } },
                {
                    $project: {
                        _id: 1, title: 1, author: 1,
                        finishedAt: "$statuses.finishedAt",
                        rating: "$statuses.rating",
                        readerName: { $arrayElemAt: ["$readerInfo.name", 0] },
                        isRecent: { $gte: ["$statuses.finishedAt", thirtyDaysAgo] },
                    }
                },
            ]).toArray(),

            // 4. Reading timeline
            books.aggregate([
                { $unwind: "$statuses" },
                {
                    $match: {
                        "statuses.userId": userId,
                        "statuses.status": "read",
                        "statuses.finishedAt": { $exists: true, $ne: null },
                    }
                },
                { $sort: { "statuses.finishedAt": -1 } },
                {
                    $project: {
                        _id: 1, title: 1, author: 1,
                        finishedAt: "$statuses.finishedAt",
                        rating: "$statuses.rating",
                        year: { $year: "$statuses.finishedAt" },
                        month: { $month: "$statuses.finishedAt" },
                    }
                },
            ]).toArray(),

            // 5. Currently reading — all users
            books.aggregate([
                { $unwind: "$statuses" },
                { $match: { "statuses.status": "reading" } },
                { $lookup: { from: "users", localField: "statuses.userId", foreignField: "_id", as: "readerInfo" } },
                {
                    $project: {
                        _id: 1, title: 1, author: 1,
                        startedAt: "$statuses.startedAt",
                        readerId: "$statuses.userId",
                        readerName: { $arrayElemAt: ["$readerInfo.name", 0] },
                    }
                },
                { $sort: { startedAt: -1 } },
            ]).toArray(),

            // 6. Activity feed — other users, last 30 days
            // Covers: status changes (reading = started, read = finished, want to read = added)
            books.aggregate([
                { $unwind: "$statuses" },
                {
                    $match: {
                        "statuses.userId": { $ne: userId },
                        $or: [
                            { "statuses.status": "reading", "statuses.startedAt": { $gte: thirtyDaysAgo } },
                            { "statuses.status": "read", "statuses.finishedAt": { $gte: thirtyDaysAgo } },
                            // want to read: no date field — use updatedAt on the book as proxy
                        ],
                    }
                },
                { $lookup: { from: "users", localField: "statuses.userId", foreignField: "_id", as: "readerInfo" } },
                {
                    $project: {
                        _id: 1, title: 1, author: 1,
                        status: "$statuses.status",
                        eventDate: {
                            $cond: {
                                if: { $eq: ["$statuses.status", "read"] },
                                then: "$statuses.finishedAt",
                                else: "$statuses.startedAt",
                            }
                        },
                        readerName: { $arrayElemAt: ["$readerInfo.name", 0] },
                    }
                },
                { $match: { eventDate: { $gte: thirtyDaysAgo } } },
                { $sort: { eventDate: -1 } },
                { $limit: 20 },
            ]).toArray(),

            // 7. All users (for currently reading widget — show everyone incl. those not reading)
            getUsers().find({}, { projection: { name: 1 } }).toArray(),

            // 8. Series list — for series progression in recommendations
            getSeries().find({}).toArray(),
        ]);

        // ── Enhanced recommendations ────────────────────────────────────────
        // Factors: genre match score + rating bonus + recency bonus + series progression

        // Get my read/reading book IDs and genres
        const myBooks = await books.find(
            { statuses: { $elemMatch: { userId, status: { $in: ["read", "reading"] } } } },
            { projection: { genre: 1, series: 1, "statuses.$": 1 } }
        ).toArray();

        const myGenreCounts = {};
        const mySeriesIds = new Set();
        for (const b of myBooks) {
            (b.genre || []).forEach((g) => { myGenreCounts[g] = (myGenreCounts[g] || 0) + 1; });
            if (b.series?.id) mySeriesIds.add(b.series.id.toString());
        }

        // Get unread books (books I haven't read or am reading)
        const myBookIds = await books.find(
            { statuses: { $elemMatch: { userId } } },
            { projection: { _id: 1 } }
        ).toArray().then((arr) => arr.map((b) => b._id));

        const candidates = await books.find(
            { _id: { $nin: myBookIds } },
            { projection: { title: 1, author: 1, house: 1, genre: 1, series: 1, statuses: 1 } }
        ).toArray();

        // Build a set of recently finished book IDs by others
        const recentlyFinishedIds = new Set(
            recentlyFinishedByOthers.filter((b) => b.isRecent).map((b) => b._id.toString())
        );

        // Build avg rating map from recentlyFinishedByOthers
        const ratingMap = {};
        for (const b of recentlyFinishedByOthers) {
            if (b.rating) {
                if (!ratingMap[b._id.toString()]) ratingMap[b._id.toString()] = [];
                ratingMap[b._id.toString()].push(b.rating);
            }
        }

        // Get series book order info — for progression bonus
        // If I've read book N in a series, book N+1 gets a bonus
        const seriesBooks = await books.find(
            { "series.id": { $exists: true } },
            { projection: { _id: 1, "series.id": 1, "series.order": 1, statuses: 1 } }
        ).toArray();

        // Map: seriesId -> highest order I've read
        const myHighestOrderInSeries = {};
        for (const b of seriesBooks) {
            const sid = b.series?.id?.toString();
            if (!sid || b.series.order == null) continue;
            const iRead = (b.statuses || []).some((s) => s.userId.toString() === req.user.id && s.status === "read");
            if (iRead) {
                myHighestOrderInSeries[sid] = Math.max(myHighestOrderInSeries[sid] || 0, b.series.order);
            }
        }

        // Score each candidate
        const scored = candidates.map((book) => {
            let score = 0;

            // Genre match
            (book.genre || []).forEach((g) => { score += myGenreCounts[g] || 0; });

            // Rating bonus — avg rating of others × 2
            const ratings = ratingMap[book._id.toString()];
            if (ratings?.length) {
                const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
                score += avg * 2;
            }

            // Recency bonus — recently finished by others
            if (recentlyFinishedIds.has(book._id.toString())) score += 3;

            // Series progression bonus — next book in a series I've started
            if (book.series?.id && book.series?.order != null) {
                const sid = book.series.id.toString();
                const myHighest = myHighestOrderInSeries[sid];
                if (myHighest != null && book.series.order === myHighest + 1) score += 10;
            }

            return { ...book, matchScore: score };
        });

        // Filter to only books with some relevance, sort by score
        const recommendations = scored
            .filter((b) => b.matchScore > 0)
            .sort((a, b) => b.matchScore - a.matchScore)
            .slice(0, 5);

        // ── Currently reading widget ────────────────────────────────────────
        // Show all users; those not currently reading show as empty
        const readingByUserId = {};
        for (const entry of currentlyReading) {
            const uid = entry.readerId.toString();
            if (!readingByUserId[uid]) readingByUserId[uid] = [];
            readingByUserId[uid].push(entry);
        }

        const currentlyReadingByUser = allUsers.map((u) => ({
            userId: u._id,
            name: u.name,
            books: readingByUserId[u._id.toString()] || [],
        }));

        res.json({
            data: {
                myStatus,
                myGenreBreakdown,
                recentlyFinishedByOthers,
                recommendations,
                readingTimeline,
                currentlyReadingByUser,
                activityFeed,
            },
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch discover data",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};