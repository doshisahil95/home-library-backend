// MODELS
const bookModel = require("../models/book.model.js");

exports.fetchAllBooks = async (req, res) => {
    try {
        const books = await bookModel.find({});

        return res.status(200).json({
            message: "Books retrieved successfully",
            data: books
        });

    } catch (error) {
        return res.status(500).json({
            message: "Internal server error",
            error: error.message
        });
    }
};

exports.addBook = async (req, res) => {
    try {
        const { title, author, genre, house, description } = req.body;

        const book = await bookModel.create({
            title,
            author,
            genre,
            house,
            description,
        });

        return res.status(201).json({
            message: "Book added successfully",
            data: book
        });

    } catch (error) {
        return res.status(500).json({
            message: "Failed to add book",
            error: error.message
        });
    }
};

exports.updateBook = async (req, res) => {
    try {
        const { id } = req.params;

        const updatedBook = await bookModel.findByIdAndUpdate(
            id,
            req.body,
            { new: true, runValidators: true }
        );

        if (!updatedBook) {
            return res.status(404).json({ message: "Book not found" });
        }

        return res.status(200).json({
            message: "Book updated successfully",
            data: updatedBook
        });

    } catch (error) {
        return res.status(500).json({
            message: "Failed to update book",
            error: error.message
        });
    }
};

exports.deleteBook = async (req, res) => {

    try {

        const { id } = req.params;

        const deleted = await bookModel.findByIdAndDelete(id);

        if (!deleted) {

            return res.status(404).json({
                success: false,
                message: "Book not found",
            });

        }

        res.json({
            success: true,
            message: "Book deleted successfully",
        });

    } catch (error) {

        res.status(500).json({
            success: false,
            message: "Failed to delete book",
        });

    }

};

exports.searchBooks = async (req, res) => {
    try {
        const { q, field } = req.query;

        if (!q) {
            return res.status(400).json({
                success: false,
                message: "Search query is required",
            });
        }

        let pipeline = [];

        // TITLE OR AUTHOR (autocomplete)
        if (field === "title" || field === "author") {
            pipeline.push({
                $search: {
                    index: "bookSearch",
                    autocomplete: {
                        query: q,
                        path: field,
                        tokenOrder: "sequential",
                    },
                },
            });
        }

        // HOUSE OR GENRES (text search in Atlas)
        else if (field === "house" || field === "genres" || field === "genre") {
            pipeline.push({
                $search: {
                    index: "bookSearch",
                    text: {
                        query: q,
                        path: field === "genre" ? "genres" : field,
                    },
                },
            });
        }

        // DEFAULT (title + author)
        else {
            pipeline.push({
                $search: {
                    index: "bookSearch",
                    compound: {
                        should: [
                            {
                                autocomplete: {
                                    query: q,
                                    path: "title",
                                    tokenOrder: "sequential",
                                },
                            },
                            {
                                autocomplete: {
                                    query: q,
                                    path: "author",
                                    tokenOrder: "sequential",
                                },
                            },
                        ],
                    },
                },
            });
        }

        // LIMIT RESULTS
        pipeline.push({ $limit: 20 });

        const results = await bookModel.aggregate(pipeline);

        res.json({
            success: true,
            data: results,
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Failed to search books",
        });
    }
};