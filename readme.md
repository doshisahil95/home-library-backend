# home-library-backend

REST API for the Home Library app. Built with Node.js, Express, and MongoDB Atlas. Handles authentication, book management, dashboard stats, and password reset via email OTP.

---

## Features

- JWT authentication with 1-day token expiry
- Full book CRUD — add, edit, delete, fetch with sorting and offset pagination
- Atlas Search integration for relevance-ranked book search with cursor pagination
- Dashboard stats — total books, books by house, books by genre, recently added
- Password reset via email OTP (hashed with SHA-256, 10-minute expiry, 5-attempt brute force limit)
- Per-user theme preference (light/dark) persisted to the database
- Rate limiting, CORS configuration, Helmet security headers, request body size limit

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Framework | Express |
| Database | MongoDB Atlas |
| ODM | Mongoose |
| Authentication | JSON Web Tokens (jsonwebtoken) |
| Password hashing | bcrypt |
| Email | Nodemailer (Gmail SMTP) |
| Security | Helmet, express-rate-limit, cors |

---

## Folder Structure

```
home-library-backend/
├── api/
│   ├── controllers/
│   │   ├── book.controller.js        # Book CRUD + search
│   │   ├── dashboard.controller.js   # Dashboard aggregations
│   │   ├── login.controller.js       # Login + OTP password reset
│   │   └── user.controller.js        # Theme preference
│   ├── middleware/
│   │   └── auth.middleware.js        # JWT verification
│   ├── models/
│   │   ├── book.model.js             # Book schema + indexes
│   │   └── user.model.js             # User schema + bcrypt hooks
│   └── routes/
│       └── app.routes.js             # All route definitions
├── .env                              # Environment variables (never commit)
├── .gitignore
├── package.json
└── server.js                         # Entry point
```

---

## Local Setup

### Prerequisites
- Node.js 18+
- A MongoDB Atlas cluster with a database and a `bookSearch` Atlas Search index on the books collection
- A Gmail account with an App Password for sending OTP emails

### Steps

1. Clone the repo:
   ```bash
   git clone https://github.com/your-username/home-library-backend.git
   cd home-library-backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the project root (see Environment Variables below).

4. Start the development server:
   ```bash
   node server.js
   ```
   The API will be available at `http://localhost:3000`.

---

## Environment Variables

Create a `.env` file in the project root with the following variables. Never commit this file to GitHub — it should already be covered by `.gitignore`.

| Variable | Description | Example |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string | `mongodb+srv://user:pass@cluster.mongodb.net` |
| `DATABASE_NAME` | Database name in Atlas | `home-library` |
| `APP_NAME` | Identifier shown in Atlas monitoring | `home-library-api` |
| `JWT_SECRET` | Secret used to sign JWT tokens — use a long random string | `a8f3k...` |
| `EMAIL_USER` | Gmail address used to send OTP emails | `you@gmail.com` |
| `EMAIL_PASS` | Gmail App Password (not your regular password) | `xxxx xxxx xxxx xxxx` |
| `CORS_ORIGIN` | Allowed frontend origin — comma-separated for multiple | `http://localhost:5173` |
| `PORT` | Port the server listens on | `3000` |
| `NODE_ENV` | Environment — controls error detail in responses | `development` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in milliseconds | `900000` (15 min) |
| `RATE_LIMIT_MAX` | Max requests per window | `300` |

### Gmail App Password Setup

Standard Gmail passwords won't work with Nodemailer. You need to generate an App Password:

1. Go to your Google Account → Security → 2-Step Verification (must be enabled).
2. At the bottom of that page, click **App passwords**.
3. Create a new app password, name it anything (e.g. "Home Library").
4. Copy the 16-character password and use it as `EMAIL_PASS`.

---

## API Reference

All routes except login and OTP reset require a `Bearer` token in the `Authorization` header.

### Auth

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/login` | No | Log in with email and password |
| POST | `/send-reset-otp` | No | Send a password reset OTP to the given email |
| POST | `/reset-password` | No | Reset password using a valid OTP |

### Books

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/fetchAllBooks` | Yes | Fetch paginated books. Query params: `limit`, `page`, `sortBy`, `sortOrder` |
| GET | `/searchBooks` | Yes | Atlas Search. Query params: `q`, `field`, `limit`, `searchAfter` |
| POST | `/addBook` | Yes | Add a new book |
| PUT | `/updateBook/:id` | Yes | Update an existing book by ID |
| DELETE | `/deleteBook/:id` | Yes | Delete a book by ID |

### Dashboard

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/dashboard` | Yes | Returns total books, books by house, books by genre, recently added |

### User

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| PATCH | `/users/theme` | Yes | Update the authenticated user's theme preference |

---

## Deployment (Railway)

1. Push your code to GitHub.
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → select `home-library-backend`.
3. Go to the service → **Variables** tab and add all environment variables from the table above. Set `NODE_ENV` to `production` and `CORS_ORIGIN` to your deployed frontend URL.
4. Go to **Settings** → **Networking** → **Generate Domain** to get your public API URL.
5. Railway will redeploy automatically on every `git push`.

See `DEPLOYMENT.md` for the full end-to-end deployment guide including the frontend.