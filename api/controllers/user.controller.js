const userModel = require("../models/user.model.js");
const validate = require("../utils/validate.js");

// FIX 20: Renamed from updateSettings to updateTheme to be accurate about what it does
exports.updateTheme = async (req, res) => {
    try {
        const { theme } = req.body;

        const tv = validate.validateTheme({ theme });
        if (!tv.valid) return res.status(400).json({ message: tv.message });

        // FIX 21: Check that user still exists before accessing result
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