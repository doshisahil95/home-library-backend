module.exports = function (app) {
    const loginController = require("../controllers/login.controller.js");
    const bookController = require("../controllers/book.controller.js");
    const userController = require("../controllers/user.controller.js");
    const auth = require("../controllers/middleware/auth.middleware.js");

    app.get("/books", auth, bookController.getBooks);
    app.post("/books", auth, bookController.addBook);
    app.put("/books/:id", auth, bookController.updateBook);
    app.delete("/books/:id", auth, bookController.deleteBook);

    app.patch("/users/theme", auth, userController.updateSettings);

    app.post("/login", loginController.login);
    app.post("/send-reset-otp", loginController.sendResetOTP);
    app.post("/reset-password", loginController.resetPassword);
}