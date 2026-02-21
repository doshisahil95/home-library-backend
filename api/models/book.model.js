const mongoose = require("mongoose");

const bookSchema = new mongoose.Schema({
    title: { type: String, required: true },
    author: { type: String, required: true },
    genre: [{ type: String }],
    house: { type: String, required: true },
    description: { type: String },
    tags: [{ type: String }],
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model("Book", bookSchema);