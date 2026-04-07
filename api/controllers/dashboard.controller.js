const { getBooks } = require("../db.js");

exports.getDashboardStats = async (req, res) => {
    try {
        const books = getBooks();

        const [totalBooks, byHouse, byGenre, recentBooks] = await Promise.all([

            // 1. Total books
            books.countDocuments(),

            // 2. Books per house
            books.aggregate([
                { $group: { _id: "$house", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $project: { _id: 0, house: "$_id", count: 1 } },
            ]).toArray(),

            // 3. Books per genre
            books.aggregate([
                { $unwind: "$genre" },
                { $group: { _id: "$genre", count: { $sum: 1 } } },
                { $sort: { count: -1 } },
                { $limit: 50 },
                { $project: { _id: 0, genre: "$_id", count: 1 } },
            ]).toArray(),

            // 4. Last 5 recently added
            books
                .find({}, { projection: { title: 1, author: 1, house: 1, createdAt: 1 } })
                .sort({ createdAt: -1 })
                .limit(5)
                .toArray(),
        ]);

        res.json({
            data: { totalBooks, byHouse, byGenre, recentBooks },
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Failed to fetch dashboard stats",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};