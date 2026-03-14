const bookModel = require("../models/book.model.js");
const mongoose = require("mongoose");
const validate = require("../utils/validate.js");

exports.getDashboardStats = async (req, res) => {
    try {
        // Validate userId before using it in an aggregation — a malformed id
        // would throw inside the pipeline with a confusing error
        const idv = validate.validateObjectId(req.user.id);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const userId = new mongoose.Types.ObjectId(req.user.id);

        const [totalBooks, byHouse, byGenre, recentBooks, byStatus] = await Promise.all([

            // 1. Total books
            bookModel.countDocuments(),

            // 2. Books per house — sorted descending by count
            bookModel.aggregate([
                { $group: { _id: "$house", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $project: { _id: 0, house: "$_id", count: 1 } },
            ]),

            // 3. Books per genre — unwind so each genre tag is counted individually
            bookModel.aggregate([
                { $unwind: "$genre" },
                { $group: { _id: "$genre", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 50 }, // cap at 50 genres to avoid unbounded payloads
                { $project: { _id: 0, genre: "$_id", count: 1 } },
            ]),

            // 4. Last 5 recently added — .lean() skips Mongoose document overhead
            //    since we only read these fields
            bookModel
                .find()
                .sort({ createdAt: -1 })
                .limit(5)
                .select("title author house createdAt")
                .lean(),

            // 5. Current user's books by reading status
            bookModel.aggregate([
                { $unwind: "$statuses" },
                { $match: { "statuses.userId": userId } },
                { $group: { _id: "$statuses.status", count: { $sum: 1 } } },
                { $project: { _id: 0, status: "$_id", count: 1 } },
            ]),
        ]);

        res.json({
            data: { totalBooks, byHouse, byGenre, recentBooks, byStatus },
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch dashboard stats",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};