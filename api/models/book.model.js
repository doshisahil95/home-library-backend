const mongoose = require("mongoose");

const statusSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
    status: { type: String, enum: ["read", "reading", "want to read"], required: true }
}, { _id: false });

const bookSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    author: { type: String, required: true, trim: true },
    genre: [{ type: String, trim: true }],
    house: { type: String, required: true, trim: true },
    description: { type: String, trim: true, maxlength: 1000 },
    statuses: { type: [statusSchema], default: [] }
}, { timestamps: true, versionKey: false });

// Indexes on sortable fields — each includes _id as a tiebreaker to match
// the sort stage used in fetchAllBooks
bookSchema.index({ title: 1, _id: 1 });
bookSchema.index({ author: 1, _id: 1 });
bookSchema.index({ house: 1, _id: 1 });
bookSchema.index({ createdAt: 1 });

// Index for status filtering in fetchAllBooks — covers the $elemMatch query
// on { userId, status } so Mongoose doesn't scan every book's statuses array
bookSchema.index({ "statuses.userId": 1, "statuses.status": 1 });

module.exports = mongoose.model("Book", bookSchema);