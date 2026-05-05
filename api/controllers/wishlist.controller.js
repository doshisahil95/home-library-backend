const { ObjectId } = require("mongodb");
const { getWishlist } = require("../db.js");
const validate = require("../utils/validate.js");

// Wishlist is stored as one document per user:
// { userId, items: [{ _id, title, author, note, addedAt }] }

async function getDoc(userId) {
    return getWishlist().findOne({ userId });
}

/* ═══════════════════════ GET WISHLIST ══════════════════════════════════════ */

exports.getWishlist = async (req, res) => {
    try {
        const userId = new ObjectId(req.user.id);
        const doc = await getDoc(userId);
        res.json({ data: doc?.items || [] });
    } catch (err) {
        res.status(500).json({ message: "Failed to fetch wishlist", error: process.env.NODE_ENV === "development" ? err.message : undefined });
    }
};

/* ═══════════════════════ ADD ITEM ══════════════════════════════════════════ */

exports.addItem = async (req, res) => {
    try {
        const { title, author, note } = req.body;
        const v = validate.validateWishlistItem({ title, author, note });
        if (!v.valid) return res.status(400).json({ message: v.message });

        const userId = new ObjectId(req.user.id);
        const item = {
            _id: new ObjectId(),
            title: title.trim(),
            author: author.trim(),
            note: (note || "").trim(),
            addedAt: new Date(),
        };

        await getWishlist().updateOne(
            { userId },
            { $push: { items: item }, $setOnInsert: { userId } },
            { upsert: true }
        );

        res.status(201).json({ data: item });
    } catch (err) {
        res.status(500).json({ message: "Failed to add wishlist item", error: process.env.NODE_ENV === "development" ? err.message : undefined });
    }
};

/* ═══════════════════════ UPDATE ITEM ═══════════════════════════════════════ */

exports.updateItem = async (req, res) => {
    try {
        const { itemId } = req.params;
        const { title, author, note } = req.body;

        const idv = validate.validateObjectId(itemId);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const v = validate.validateWishlistItem({ title, author, note });
        if (!v.valid) return res.status(400).json({ message: v.message });

        const userId = new ObjectId(req.user.id);
        const itemObjId = new ObjectId(itemId);

        const result = await getWishlist().updateOne(
            { userId, "items._id": itemObjId },
            {
                $set: {
                    "items.$.title": title.trim(),
                    "items.$.author": author.trim(),
                    "items.$.note": (note || "").trim(),
                },
            }
        );

        if (result.matchedCount === 0) return res.status(404).json({ message: "Item not found" });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: "Failed to update wishlist item", error: process.env.NODE_ENV === "development" ? err.message : undefined });
    }
};

/* ═══════════════════════ DELETE ITEM ═══════════════════════════════════════ */

exports.deleteItem = async (req, res) => {
    try {
        const { itemId } = req.params;
        const idv = validate.validateObjectId(itemId);
        if (!idv.valid) return res.status(400).json({ message: idv.message });

        const userId = new ObjectId(req.user.id);
        const result = await getWishlist().updateOne(
            { userId },
            { $pull: { items: { _id: new ObjectId(itemId) } } }
        );

        if (result.matchedCount === 0) return res.status(404).json({ message: "Item not found" });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ message: "Failed to delete wishlist item", error: process.env.NODE_ENV === "development" ? err.message : undefined });
    }
};