module.exports = function (app) {
    const loginController = require("../controllers/login.controller.js");
    const mainController = require("../controllers/main.controller.js");
    const userController = require("../controllers/user.controller.js");
    const auth = require("../controllers/middleware/auth.middleware.js");

    app.get("/books", auth, mainController.getBooks);
    app.post("/books", auth, mainController.addBook);
    app.put("/books/:id", auth, mainController.updateBook);
    
    app.patch("/users/theme", auth, userController.updateSettings);

    app.post("/login", loginController.login);
    app.post("/send-reset-otp", loginController.sendResetOTP);
    app.post("/reset-password", loginController.resetPassword);
}