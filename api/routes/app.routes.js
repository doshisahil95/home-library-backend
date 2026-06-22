const loginController = require("../controllers/login.controller.js");
const bookController = require("../controllers/book.controller.js");
const userController = require("../controllers/user.controller.js");
const dashboardController = require("../controllers/dashboard.controller.js");
const systemController = require("../controllers/system.controller.js");
const adminController = require("../controllers/admin.controller.js");
const seriesController = require("../controllers/series.controller.js");
const wishlistController = require("../controllers/wishlist.controller.js");
const publicController = require("../controllers/public.controller.js");
const auth = require("../middleware/auth.middleware.js");
const requireAdmin = require("../middleware/requireAdmin.middleware.js");
const requireSuperAdmin = require("../middleware/requireSuperAdmin.middleware.js");

module.exports = function (app) {
    const authLimiter = app.locals.authLimiter;

    // ─── Auth ──────────────────────────────────────────────────────────────
    app.post("/login", authLimiter, loginController.login);
    app.post("/send-reset-otp", authLimiter, loginController.sendResetOTP);
    app.post("/reset-password", authLimiter, loginController.resetPassword);
    app.post("/logout", loginController.logout);

    // ─── Session ───────────────────────────────────────────────────────────
    app.get("/me", auth, loginController.getMe);
    app.post("/refresh-token", auth, loginController.refreshToken);

    // ─── Books ─────────────────────────────────────────────────────────────
    app.get("/fetchAllBooks", auth, bookController.fetchAllBooks);
    app.get("/searchBooks", auth, bookController.searchBooks);
    app.post("/addBook", auth, bookController.addBook);
    app.put("/updateBook/:id", auth, bookController.updateBook);
    app.delete("/deleteBook/:id", auth, bookController.deleteBook);

    // ─── Book notes (per-user, private) ────────────────────────────────────
    app.put("/books/:bookId/note", auth, userController.upsertNote);

    // ─── Dashboard ─────────────────────────────────────────────────────────
    app.get("/dashboard", auth, dashboardController.getDashboardStats);

    // ─── User ──────────────────────────────────────────────────────────────
    app.patch("/users/theme", auth, userController.updateTheme);
    app.patch("/users/profile", auth, userController.updateProfile);
    app.post("/users/make-all-private", auth, userController.makeAllPrivate);
    app.get("/users/public-count", auth, userController.getPublicCount);
    app.get("/discover", auth, userController.getDiscoverData);

    // ─── Reading goal ───────────────────────────────────────────────────────
    app.get("/users/reading-goal", auth, userController.getReadingGoal);
    app.put("/users/reading-goal", auth, userController.setReadingGoal);

    // ─── Reference data ────────────────────────────────────────────────────
    app.get("/reference-data/:type", auth, systemController.getAll);
    app.post("/reference-data/:type", auth, requireAdmin, systemController.create);
    app.put("/reference-data/:type/:id", auth, requireAdmin, systemController.update);
    app.delete("/reference-data/:type/:id", auth, requireAdmin, systemController.remove);

    // ─── Series ────────────────────────────────────────────────────────────
    app.get("/series", auth, seriesController.listSeries);
    app.post("/series", auth, requireAdmin, seriesController.createSeries);
    app.put("/series/:id", auth, requireAdmin, seriesController.updateSeries);
    app.delete("/series/:id", auth, requireAdmin, seriesController.deleteSeries);
    app.post("/books/:bookId/series", auth, seriesController.assignBookToSeries);
    app.delete("/books/:bookId/series", auth, seriesController.removeBookFromSeries);

    // ─── Wishlist (private per user) ────────────────────────────────────────
    app.get("/wishlist", auth, wishlistController.getWishlist);
    app.post("/wishlist", auth, wishlistController.addItem);
    app.put("/wishlist/:itemId", auth, wishlistController.updateItem);
    app.delete("/wishlist/:itemId", auth, wishlistController.deleteItem);

    // ─── Admin — book bulk import ───────────────────────────────────────────
    app.post("/admin/csv/validate", auth, requireAdmin, adminController.validateCSV);
    app.post("/admin/csv/import", auth, requireAdmin, adminController.importCSV);
    app.get("/admin/csv/export", auth, requireAdmin, adminController.exportBooksCSV);

    // ─── Admin — reference data CSV import/export ───────────────────────────
    app.post("/admin/ref-csv/validate", auth, requireAdmin, adminController.validateRefCSV);
    app.post("/admin/ref-csv/import", auth, requireAdmin, adminController.importRefCSV);
    app.get("/admin/ref-csv/export/:type", auth, requireAdmin, adminController.exportRefCSV);

    // ─── Admin — user management ────────────────────────────────────────────
    app.get("/admin/users", auth, requireSuperAdmin, adminController.listUsers);
    app.post("/admin/users", auth, requireSuperAdmin, adminController.addUser);
    app.delete("/admin/users/:id", auth, requireSuperAdmin, adminController.deleteUser);
    app.patch("/admin/users/:id/role", auth, requireAdmin, adminController.changeRole);

    // ─── Admin — password reset ─────────────────────────────────────────────
    app.post("/admin/users/:id/approve-reset", auth, requireSuperAdmin, adminController.approvePasswordReset);
    app.post("/admin/users/:id/revoke-reset", auth, requireSuperAdmin, adminController.revokePasswordReset);

    // ─── Public (no auth) ──────────────────────────────────────────────────
    app.get("/public/:userId", publicController.getPublicBooks);
};  