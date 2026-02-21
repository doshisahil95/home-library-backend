// MODELS
const bookModel = require("../models/book.model.js");

exports.getBooks = async (req, res) => {
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
        const { title, author, genre, house, description, tags } = req.body;

        const book = await bookModel.create({
            title,
            author,
            genre,
            house,
            description,
            tags
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