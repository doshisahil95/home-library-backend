const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ message: "Access denied. Invalid token format." });
    }

    const token = authHeader.split(" ")[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        // Expose only the fields controllers need — prevents future payload fields
        // from leaking into req.user unexpectedly
        req.user = { id: decoded.id, role: decoded.role };
        next();
    } catch {
        return res.status(401).json({ message: "Invalid or expired token" });
    }
};