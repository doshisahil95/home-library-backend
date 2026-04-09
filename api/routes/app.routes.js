const loginController = require("../controllers/login.controller.js");
const bookController = require("../controllers/book.controller.js");
const userController = require("../controllers/user.controller.js");
const dashboardController = require("../controllers/dashboard.controller.js");
const systemController = require("../controllers/system.controller.js");
const adminController = require("../controllers/admin.controller.js");
const publicController = require("../controllers/public.controller.js");
const auth = require("../middleware/auth.middleware.js");
const requireAdmin = require("../middleware/requireAdmin.middleware.js");

module.exports = function (app) {
    const authLimiter = app.locals.authLimiter;

    // ─── Auth (public, rate-limited tightly) ───────────────────────────────
    app.post("/login", authLimiter, loginController.login);
    app.post("/send-reset-otp", authLimiter, loginController.sendResetOTP);
    app.post("/reset-password", authLimiter, loginController.resetPassword);
    app.post("/logout", loginController.logout);

    // ─── Session (protected) ───────────────────────────────────────────────
    app.get("/me", auth, loginController.getMe);
    app.post("/refresh-token", auth, loginController.refreshToken);

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

    // ─── Reference data ────────────────────────────────────────────────────
    // GET — all authenticated users (needed for modal + filter panel)
    // POST / PUT / DELETE — admin only
    app.get("/reference-data/:type", auth, systemController.getAll);
    app.post("/reference-data/:type", auth, requireAdmin, systemController.create);
    app.put("/reference-data/:type/:id", auth, requireAdmin, systemController.update);
    app.delete("/reference-data/:type/:id", auth, requireAdmin, systemController.remove);

    // ─── Admin (protected, admin only) ────────────────────────────────────
    app.get("/admin/users", auth, requireAdmin, adminController.listUsers);
    app.post("/admin/users", auth, requireAdmin, adminController.addUser);
    app.patch("/admin/users/:id/role", auth, requireAdmin, adminController.changeRole);
    app.post("/admin/users/:id/reset-otp", auth, requireAdmin, adminController.sendUserResetOTP);

    // ─── Public (no auth) ─────────────────────────────────────────────────
    app.get("/public/:userId", publicController.getPublicBooks);

};