const mongoose = require("mongoose");

const bookSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    genre: [{ type: String, trim: true }],
    house: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
}, { timestamps: true, versionKey: false });

// Indexes on sortable fields so MongoDB doesn't do a full collection scan
// Each index includes _id as a tiebreaker to match the sort used in fetchAllBooks
bookSchema.index({ title: 1, _id: 1 });
bookSchema.index({ title: -1, _id: -1 });
bookSchema.index({ author: 1, _id: 1 });
bookSchema.index({ author: -1, _id: -1 });
bookSchema.index({ house: 1, _id: 1 });
bookSchema.index({ house: -1, _id: -1 });

module.exports = mongoose.model("Book", bookSchema);