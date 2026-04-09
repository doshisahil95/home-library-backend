// Applied after the auth middleware — req.user is already populated.
// Returns 403 if the authenticated user is not an admin.

module.exports = (req, res, next) => {
    if (req.user?.role !== "admin") {
        return res.status(403).json({ message: "Admin access required" });
    }
    next();
};