const userModel = require("../models/user.model.js");
const validate = require("../utils/validate.js");

// FIX 20: Renamed from updateSettings to updateTheme to be accurate about what it does
exports.updateTheme = async (req, res) => {
    try {
        const { theme } = req.body;

        const tv = validate.validateTheme({ theme });
        if (!tv.valid) return res.status(400).json({ message: tv.message });

        // FIX 21: Check that user still exists before accessing result
        const user = await userModel.findByIdAndUpdate(
            req.user.id,
            { theme },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json({ message: "Theme updated", theme: user.theme });

    } catch (err) {
        res.status(500).json({ message: "Failed to update theme" });
    }
};

const bookModel = require("../models/book.model.js");
const mongoose = require("mongoose");

exports.getDiscoverData = async (req, res) => {
    try {
        const idv = validate.validateObjectId(req.user.id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const userId = new mongoose.Types.ObjectId(req.user.id);

        const [
            myStatus,
            myGenreBreakdown,
            recentlyFinishedByOthers,
            recommendations,
            readingTimeline,
        ] = await Promise.all([

            // 1. My reading status counts
            bookModel.aggregate([
                { $unwind: "$statuses" },
                { $match: { "statuses.userId": userId } },
                { $group: { _id: "$statuses.status", count: { $sum: 1 } } },
                { $project: { _id: 0, status: "$_id", count: 1 } },
            ]),

            // 2. My genre breakdown — genres of books I've read or am reading
            bookModel.aggregate([
                { $match: { statuses: { $elemMatch: { userId, status: { $in: ["read", "reading"] } } } } },
                { $unwind: "$genre" },
                { $group: { _id: "$genre", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $project: { _id: 0, genre: "$_id", count: 1 } },
            ]),

            // 3. Recently finished by others — last 10 "read" entries by other users
            bookModel.aggregate([
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
            ]),

            // 4. Recommendations — books not yet touched by current user, ranked by genre overlap
            bookModel.aggregate([
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
            ]),

            // 5. Reading timeline — individual books I finished, grouped by month
            //    Returns books sorted newest first so the timeline shows recent activity at top
            bookModel.aggregate([
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
            ]),
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