const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
    const token = req.cookies?.token;

    if (!token) {
        return res.status(401).json({ message: "Access denied. No session found." });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = { id: decoded.id, role: decoded.role };
        next();
    } catch {
        return res.status(401).json({ message: "Invalid or expired session" });
    }
};