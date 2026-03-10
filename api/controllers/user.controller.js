const userModel = require("../models/user.model.js");

exports.updateTheme = async (req, res) => {
    try {
        const { theme } = req.body;

        if (!["light", "dark"].includes(theme)) {
            return res.status(400).json({ message: "Invalid theme value" });
        }

        const user = await userModel.findByIdAndUpdate(
            req.user.id,
            { theme },
            { new: true }
        );

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json({ message: "Theme updated", theme: user.theme });

    } catch (err) {
        res.status(500).json({ message: "Failed to update theme" });
    }
};