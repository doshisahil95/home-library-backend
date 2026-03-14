# home-library-backend

REST API for the Home Library app. Built with Node.js, Express, and MongoDB Atlas. Handles authentication, book management, dashboard stats, and password reset via email OTP.

---

## Features

- JWT authentication with 4-hour token expiry
- Login brute-force protection — account locked for 15 minutes after 5 failed attempts
- Full book CRUD — add, edit, delete, fetch with sorting and offset pagination
- Atlas Search integration for relevance-ranked book search with cursor pagination
- Filter by house, genre, and reading status
- Dashboard stats — total books, books by house, books by genre, per-user reading status, recently added
- Password reset via email OTP (hashed with SHA-256, 10-minute expiry, 5-attempt brute force limit)
- Per-user reading status per book — read, reading, want to read
- Per-user theme preference (light/dark) persisted to the database
- Input sanitisation — HTML tags stripped from all free-text fields before DB write
- Two-tier rate limiting — tight limit on auth endpoints, broader limit on all other traffic
- HTTPS enforcement with HSTS, CORS configuration, Helmet security headers, request body size limit

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
│   │   ├── login.controller.js       # Login + OTP password reset + brute force lockout
│   │   └── user.controller.js        # Theme preference
│   ├── middleware/
│   │   └── auth.middleware.js        # JWT verification
│   ├── models/
│   │   ├── book.model.js             # Book schema + indexes
│   │   └── user.model.js             # User schema + bcrypt hook + lockout fields
│   └── routes/
│       └── app.routes.js             # All route definitions
├── add-users.js                      # One-time user seeding script
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

4. Seed users:
   ```bash
   node add-users.js
   ```

5. Start the development server:
   ```bash
   node server.js
   ```
   The API will be available at `http://localhost:3000`.

---

## Environment Variables

Create a `.env` file in the project root with the following variables. Never commit this file — it is already covered by `.gitignore`.

| Variable | Description | Example |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string | `mongodb+srv://user:pass@cluster.mongodb.net` |
| `DATABASE_NAME` | Database name in Atlas | `homeLibrary` |
| `APP_NAME` | Identifier shown in Atlas monitoring | `HomeLibrary` |
| `JWT_SECRET` | Secret used to sign JWT tokens — must be 32+ characters | `a8f3k...` |
| `EMAIL_USER` | Gmail address used to send OTP emails | `you@gmail.com` |
| `EMAIL_PASS` | Gmail App Password (not your regular password) | `xxxx xxxx xxxx xxxx` |
| `CORS_ORIGIN` | Allowed frontend origin — comma-separated for multiple | `http://localhost:5173` |
| `PORT` | Port the server listens on | `3000` |
| `NODE_ENV` | Environment — controls error detail in responses | `development` |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in milliseconds | `900000` (15 min) |
| `RATE_LIMIT_MAX` | Max requests per window (global limiter) | `300` |

### Generating a strong JWT_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

The server will refuse to start if `JWT_SECRET` is missing or shorter than 32 characters.

### Gmail App Password Setup

Standard Gmail passwords won't work with Nodemailer. You need to generate an App Password:

1. Go to your Google Account → Security → 2-Step Verification (must be enabled).
2. At the bottom of that page, click **App passwords**.
3. Create a new app password, name it anything (e.g. "Home Library").
4. Copy the 16-character password (no spaces) and use it as `EMAIL_PASS`.

---

## Atlas Search Index

Create a Search index named `bookSearch` on your books collection in the Atlas UI with the following mapping:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "title":  { "type": "autocomplete" },
      "author": { "type": "autocomplete" },
      "house":  { "type": "token" },
      "genre":  { "type": "token" },
      "statuses": {
        "type": "embeddedDocuments",
        "fields": {
          "userId": { "type": "token" },
          "status": { "type": "token" }
        }
      }
    }
  }
}
```

---

## API Reference

All routes except login and OTP reset require a `Bearer` token in the `Authorization` header.

### Auth (rate-limited — 10 requests per 15 minutes per IP)

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/login` | No | Log in with email and password |
| POST | `/send-reset-otp` | No | Send a password reset OTP to the given email |
| POST | `/reset-password` | No | Reset password using a valid OTP |

### Books

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/fetchAllBooks` | Yes | Fetch paginated books. Params: `limit`, `page`, `sortBy`, `sortOrder`, `filterHouse`, `filterGenre`, `filterStatus` |
| GET | `/searchBooks` | Yes | Atlas Search. Params: `q`, `limit`, `searchAfter`, `filterHouse`, `filterGenre`, `filterStatus` |
| POST | `/addBook` | Yes | Add a new book |
| PUT | `/updateBook/:id` | Yes | Update an existing book by ID |
| DELETE | `/deleteBook/:id` | Yes | Delete a book by ID |

### Dashboard

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/dashboard` | Yes | Returns total books, books by house, books by genre, per-user reading status, recently added |

### User

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| PATCH | `/users/theme` | Yes | Update the authenticated user's theme preference |

---

## Security

- **HTTPS enforced** — plain HTTP requests are redirected to HTTPS in production via `x-forwarded-proto` (Railway edge)
- **HSTS** — browsers are instructed to use HTTPS for 1 year via `Strict-Transport-Security`
- **Login brute force** — 5 failed attempts locks the account for 15 minutes; lockout is cleared on successful login or password reset
- **OTP brute force** — 5 failed OTP attempts invalidates the session; a new OTP must be requested
- **JWT scoped** — `req.user` only exposes `{ id, role }`, not the full token payload
- **Input sanitisation** — HTML tags stripped from `title`, `author`, and `description` before DB write
- **ObjectId validation** — all `:id` params validated before DB queries to prevent malformed-ID errors
- **Rate limiting** — auth endpoints limited to 10 req/15min per IP; all other traffic limited to 300 req/15min
- **JWT_SECRET length check** — server exits at startup if secret is missing or under 32 characters

---

## Deployment (Railway)

1. Push your code to GitHub.
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo → select `home-library-backend`.
3. If no repositories appear, go to [github.com/settings/installations](https://github.com/settings/installations) → Configure Railway → grant access to your repo.
4. Go to the service → **Variables** tab and add all environment variables from the table above. Set `NODE_ENV` to `production` and `CORS_ORIGIN` to your Vercel frontend URL.
5. Go to **Settings** → **Networking** → **Generate Domain** to get your public API URL. Leave Root Directory blank.
6. Railway redeploys automatically on every `git push`.
7. Set a spending limit under **Settings → Usage** to cap costs (recommended: $5).

### Production environment variables

```
MONGODB_URI          = mongodb+srv://...
DATABASE_NAME        = homeLibrary
APP_NAME             = HomeLibrary
JWT_SECRET           = (32+ char random hex)
EMAIL_USER           = you@gmail.com
EMAIL_PASS           = (Gmail app password, 16 chars no spaces)
CORS_ORIGIN          = https://your-app.vercel.app
NODE_ENV             = production
RATE_LIMIT_WINDOW_MS = 900000
RATE_LIMIT_MAX       = 300
PORT                 = 3000
```