const loginController = require("../controllers/login.controller.js");
const bookController = require("../controllers/book.controller.js");
const userController = require("../controllers/user.controller.js");
const dashboardController = require("../controllers/dashboard.controller.js");
const auth = require("../middleware/auth.middleware.js");

module.exports = function (app) {
    // Auth-specific rate limiter — set in server.js, applied here only to
    // public endpoints that are the primary targets for credential attacks
    const authLimiter = app.locals.authLimiter;

    // ─── Auth (public, rate-limited tightly) ───────────────────────────────
    app.post("/login", authLimiter, loginController.login);
    app.post("/send-reset-otp", authLimiter, loginController.sendResetOTP);
    app.post("/reset-password", authLimiter, loginController.resetPassword);

    // ─── Books (protected) ─────────────────────────────────────────────────
    app.get("/fetchAllBooks", auth, bookController.fetchAllBooks);
    app.get("/searchBooks", auth, bookController.searchBooks);
    app.post("/addBook", auth, bookController.addBook);
    app.put("/updateBook/:id", auth, bookController.updateBook);
    app.delete("/deleteBook/:id", auth, bookController.deleteBook);

    // ─── Dashboard (protected) ─────────────────────────────────────────────
    app.get("/dashboard", auth, dashboardController.getDashboardStats);

    // ─── User (protected) ──────────────────────────────────────────────────
    app.patch("/users/theme", auth, userController.updateTheme);
    app.get("/discover", auth, userController.getDiscoverData);
};