module.exports = function (app) {
    const loginController = require("../controllers/login.controller.js");
    const bookController = require("../controllers/book.controller.js");
    const userController = require("../controllers/user.controller.js");
    const auth = require("../controllers/middleware/auth.middleware.js");

    app.get("/fetchAllBooks", auth, bookController.fetchAllBooks);
    app.post("/addBook", auth, bookController.addBook);
    app.put("/updateBook/:id", auth, bookController.updateBook);
    app.delete("/deleteBook/:id", auth, bookController.deleteBook);
    app.get("/searchBooks", auth, bookController.searchBooks);

    app.patch("/users/theme", auth, userController.updateSettings);

    app.post("/login", loginController.login);
    app.post("/send-reset-otp", loginController.sendResetOTP);
    app.post("/reset-password", loginController.resetPassword);
}