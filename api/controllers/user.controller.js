const { ObjectId } = require("mongodb");
const { getUsers, getBooks } = require("../db.js");
const validate = require("../utils/validate.js");

// ─── Update theme ─────────────────────────────────────────────────────────────

exports.updateTheme = async (req, res) => {
    try {
        const { theme } = req.body;

        const tv = validate.validateTheme({ theme });
        if (!tv.valid) return res.status(400).json({ message: tv.message });

        const users = getUsers();
        const result = await users.findOneAndUpdate(
            { _id: new ObjectId(req.user.id) },
            { $set: { theme, updatedAt: new Date() } },
            { returnDocument: "after" }
        );

        if (!result) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json({ message: "Theme updated", theme: result.theme });

    } catch (err) {
        res.status(500).json({ message: "Failed to update theme" });
    }
};


// ─── Get discover data ────────────────────────────────────────────────────────

exports.getDiscoverData = async (req, res) => {
    try {
        const idv = validate.validateObjectId(req.user.id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const userId = new ObjectId(req.user.id);
        const books = getBooks();

        const [
            myStatus,
            myGenreBreakdown,
            recentlyFinishedByOthers,
            recommendations,
            readingTimeline,
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

            // 3. Recently finished by others
            books.aggregate([
                { $unwind: "$statuses" },
                { $match: { "statuses.status": "read", "statuses.userId": { $ne: userId } } },
                { $sort: { "statuses.finishedAt": -1 } },
                { $limit: 10 },
                {
                    $lookup: {
                        from: "users",
                        localField: "statuses.userId",
                        foreignField: "_id",
                        as: "readerInfo",
                    }
                },
                {
                    $project: {
                        _id: 1,
                        title: 1,
                        author: 1,
                        finishedAt: "$statuses.finishedAt",
                        rating: "$statuses.rating",
                        readerName: { $arrayElemAt: ["$readerInfo.name", 0] },
                    }
                },
            ]).toArray(),

            // 4. Recommendations
            books.aggregate([
                { $match: { "statuses.userId": { $ne: userId } } },
                { $unwind: "$genre" },
                {
                    $lookup: {
                        from: "books",
                        let: { g: "$genre" },
                        pipeline: [
                            { $match: { statuses: { $elemMatch: { userId, status: { $in: ["read", "reading"] } } } } },
                            { $unwind: "$genre" },
                            { $match: { $expr: { $eq: ["$genre", "$$g"] } } },
                            { $count: "c" },
                        ],
                        as: "genreMatch",
                    }
                },
                { $match: { "genreMatch.0": { $exists: true } } },
                {
                    $group: {
                        _id: "$_id",
                        title: { $first: "$title" },
                        author: { $first: "$author" },
                        house: { $first: "$house" },
                        genre: { $push: "$genre" },
                        matchScore: { $sum: { $arrayElemAt: ["$genreMatch.c", 0] } },
                    }
                },
                { $sort: { matchScore: -1 } },
                { $limit: 5 },
                { $project: { title: 1, author: 1, house: 1, genre: 1, matchScore: 1 } },
            ]).toArray(),

            // 5. Reading timeline
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
                        _id: 1,
                        title: 1,
                        author: 1,
                        finishedAt: "$statuses.finishedAt",
                        rating: "$statuses.rating",
                        year: { $year: "$statuses.finishedAt" },
                        month: { $month: "$statuses.finishedAt" },
                    }
                },
            ]).toArray(),
        ]);

        res.json({
            data: { myStatus, myGenreBreakdown, recentlyFinishedByOthers, recommendations, readingTimeline },
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch discover data",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};