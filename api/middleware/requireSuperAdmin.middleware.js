// Applied after the auth middleware — req.user is already populated.
// Returns 403 if the authenticated user is not a superadmin.
// Used for routes that only the superadmin can access: user management, password resets.

module.exports = (req, res, next) => {
    if (req.user?.role !== "superadmin") {
        return res.status(403).json({ message: "Super admin access required" });
    }
    next();
};