const bookModel = require("../models/book.model.js");
const mongoose = require("mongoose");

exports.fetchAllBooks = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;

        // SORT: validate and read sort params
        const allowedSortFields = ["title", "author", "house"];
        const sortBy = allowedSortFields.includes(req.query.sortBy) ? req.query.sortBy : null;
        const sortOrder = req.query.sortOrder === "desc" ? -1 : 1;

        const sortStage = sortBy
            ? { [sortBy]: sortOrder, _id: sortOrder }
            : { _id: -1 };

        // Run query and total count in parallel for efficiency
        const [results, total] = await Promise.all([
            bookModel.find().sort(sortStage).skip(skip).limit(limit),
            bookModel.estimatedDocumentCount()
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
            error: error.message
        });
    }
};


exports.searchBooks = async (req, res) => {
    try {
        const { q, field } = req.query;
        const limit = parseInt(req.query.limit) || 10;

        const searchAfter = req.query.searchAfter
            ? JSON.parse(req.query.searchAfter)
            : undefined;

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
        res.status(500).json({ message: "Search failed", error: error.message });
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
            message: "Failed to add book"
        });
    }
};


exports.updateBook = async (req, res) => {
    try {
        const { id } = req.params;

        const updated = await bookModel.findByIdAndUpdate(
            id,
            req.body,
            { new: true }
        );

        res.json({
            data: updated
        });

    } catch (error) {
        res.status(500).json({
            message: "Update failed"
        });
    }
};


exports.deleteBook = async (req, res) => {
    try {
        await bookModel.findByIdAndDelete(req.params.id);

        res.json({
            success: true
        });

    } catch (error) {
        res.status(500).json({
            message: "Delete failed"
        });
    }
};