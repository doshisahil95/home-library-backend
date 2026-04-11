// Applied after the auth middleware — req.user is already populated.
// Returns 403 if the authenticated user is not an admin or superadmin.
// Both roles can manage reference data and bulk import.

module.exports = (req, res, next) => {
    if (req.user?.role !== "admin" && req.user?.role !== "superadmin") {
        return res.status(403).json({ message: "Admin access required" });
    }
    next();
};