const bookModel = require("../models/book.model.js");

exports.getDashboardStats = async (req, res) => {
    try {
        // Run all aggregations in parallel for efficiency
        const [totals, byHouse, byGenre, recentBooks] = await Promise.all([

            // 1. Total books
            bookModel.estimatedDocumentCount(),

            // 2. Books per house
            bookModel.aggregate([
                { $group: { _id: "$house", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $project: { _id: 0, house: "$_id", count: 1 } }
            ]),

            // 3. Books per genre — unwind so each genre tag is counted individually
            bookModel.aggregate([
                { $unwind: "$genre" },
                { $group: { _id: "$genre", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $project: { _id: 0, genre: "$_id", count: 1 } }
            ]),

            // 4. Last 5 recently added books
            bookModel
                .find()
                .sort({ createdAt: -1 })
                .limit(5)
                .select("title author house createdAt")
        ]);

        res.json({
            data: {
                totalBooks: totals,
                byHouse,
                byGenre,
                recentBooks
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch dashboard stats",
            error: error.message
        });
    }
};