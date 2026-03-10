const bookModel = require("../models/book.model.js");
const mongoose = require("mongoose");

exports.fetchAllBooks = async (req, res) => {
    try {
        const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 10, 100));
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const skip = (page - 1) * limit;

        const allowedSortFields = ["title", "author", "house"];
        const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : null;
        const sortOrder = req.query.sortOrder === "desc" ? -1 : 1;

        const sortStage = sortBy
            ? { [sortBy]: sortOrder, _id: sortOrder }
            : { _id: -1 };

        const [results, total] = await Promise.all([
            bookModel.find().sort(sortStage).skip(skip).limit(limit),
            bookModel.countDocuments()
        ]);

        const totalPages = Math.ceil(total / limit);

        res.json({
            data: results,
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


exports.searchBooks = async (req, res) => {
    try {
        const { q, field } = req.query;
        const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 10, 100));

        let searchAfter;
        try {
            searchAfter = req.query.searchAfter
                ? JSON.parse(req.query.searchAfter)
                : undefined;
        } catch {
            return res.status(400).json({ message: "Invalid searchAfter value" });
        }

        if (!q) {
            return res.status(400).json({ message: "Search query required" });
        }

        const allowedFields = ["title", "author", "house", "genre"];
        if (field && !allowedFields.includes(field)) {
            return res.status(400).json({ message: "Invalid search field" });
        }

        let searchStage;

        if (allowedFields.includes(field)) {
            searchStage = {
                autocomplete: {
                    query: q,
                    path: field,
                    tokenOrder: "sequential"
                }
            };
        } else {
            searchStage = {
                compound: {
                    should: [
                        {
                            autocomplete: {
                                query: q,
                                path: "title",
                                tokenOrder: "sequential"
                            }
                        },
                        {
                            autocomplete: {
                                query: q,
                                path: "author",
                                tokenOrder: "sequential"
                            }
                        }
                    ]
                }
            };
        }

        const pipeline = [
            {
                $search: {
                    index: "bookSearch",
                    ...searchStage,
                    sort: {
                        createdAt: -1,
                        _id: -1
                    },
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

        res.json({
            data: results,
            pagination: {
                nextCursor,
                hasMore: !!nextCursor
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            message: "Search failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
};

exports.addBook = async (req, res) => {
    try {
        const { title, author, genre, house } = req.body;

        if (!title || !author || !house || !genre?.length) {
            return res.status(400).json({
                message: "All fields required"
            });
        }

        const book = await bookModel.create({
            title,
            author,
            genre,
            house
        });

        res.status(201).json({
            data: book
        });

    } catch (error) {
        res.status(500).json({
            message: "Failed to add book",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
};


exports.updateBook = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ message: "Invalid book ID" });
        }

        const { title, author, genre, house, description } = req.body;

        if (!title || !author || !house || !genre?.length) {
            return res.status(400).json({ message: "All fields required" });
        }

        const updated = await bookModel.findByIdAndUpdate(
            id,
            { title, author, genre, house, description },
            { new: true }
        );

        if (!updated) {
            return res.status(404).json({ message: "Book not found" });
        }

        res.json({
            data: updated
        });

    } catch (error) {
        res.status(500).json({
            message: "Update failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
};


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

        res.json({
            success: true
        });

    } catch (error) {
        res.status(500).json({
            message: "Delete failed",
            error: process.env.NODE_ENV === "development" ? error.message : undefined
        });
    }
};