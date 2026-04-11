const { ObjectId } = require("mongodb");
const { getBooks, getUsers } = require("../db.js");
const { validateObjectId } = require("../utils/validate.js");

// ─── GET /public/:userId ──────────────────────────────────────────────────────
// No authentication required — this is the public-facing endpoint.
// Returns only books where the specified user is in the publicByUsers array. Strips all private data (other users' statuses, locationInHouse,
// reading dates, ratings) before responding.

exports.getPublicBooks = async (req, res) => {
    try {
        const { userId } = req.params;

        const idv = validateObjectId(userId);
        if (!idv.valid) return res.status(404).json({ message: "Page not found" });

        const users = getUsers();
        const user = await users.findOne(
            { _id: new ObjectId(userId) },
            { projection: { name: 1 } }
        );

        if (!user) return res.status(404).json({ message: "Page not found" });

        const books = getBooks();
        const userObjectId = new ObjectId(userId);

        // Find all books where this user is in the publicByUsers array
        const results = await books.find({
            publicByUsers: userObjectId,
        })
            .sort({ title: 1 })
            .toArray();

        // Strip private fields — only return what the public should see
        const data = results.map((book) => ({
            _id: book._id,
            title: book.title,
            author: book.author,
            house: book.house,
            genre: book.genre || [],
            language: book.language || "",
            description: book.description || "",
            // locationInHouse intentionally excluded
        }));

        res.json({
            data,
            owner: { name: user.name },
        });

    } catch (error) {
        res.status(500).json({
            message: "Failed to fetch public books",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};