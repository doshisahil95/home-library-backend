# home-library-backend

REST API for the Home Library app. Built with Node.js, Express, and MongoDB Atlas (native driver — no Mongoose). Handles authentication, book management, user management, dashboard stats, and password reset flows.

---

## Features

- JWT authentication via HttpOnly cookie with configurable token expiry
- Login brute-force protection — account locked for 15 minutes after 5 failed attempts
- Full book CRUD — add, edit, delete, fetch with sorting and offset pagination
- Atlas Search integration for relevance-ranked book search with cursor pagination
- Filter by house, genre (multi-select AND), language, and reading status
- Dashboard stats — total books, books by house, books by genre, recently added
- Three-tier role system: `user`, `admin`, `superadmin` (set directly in DB)
- User management (superadmin only) — add users, change roles, remove users
- Per-user password reset flows:
  - Superadmin: OTP sent via email (10-minute expiry, 5-attempt brute-force limit)
  - Other users: admin approves via admin panel, user sets password on login page
  - New users: no password set at creation, set on first login
- Per-user reading status per book — read, reading, want to read with one-way transition enforcement
- Per-user public book sharing — books can be made visible on a public unauthenticated page
- Bulk CSV import with validation, error reporting, and `makePublic` support
- Per-user theme preference (light/dark) persisted to the database
- Input sanitisation — HTML tags stripped from all free-text fields before DB write
- Two-tier rate limiting — tight limit on auth endpoints, broader limit on all other traffic
- HTTPS enforcement with HSTS, CORS configuration, Helmet security headers, 50kb request body limit

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express |
| Database | MongoDB Atlas (native driver v6) |
| Authentication | JWT (`jsonwebtoken`) + HttpOnly cookies |
| Password hashing | bcrypt |
| Email | Resend |
| Security | Helmet, express-rate-limit, cors |
| Logging | Morgan |

---

## Folder Structure

```
home-library-backend/
├── api/
│   ├── controllers/
│   │   ├── admin.controller.js      # User CRUD, password reset approval, CSV import
│   │   ├── book.controller.js       # Book CRUD + Atlas Search
│   │   ├── dashboard.controller.js  # Dashboard aggregations
│   │   ├── login.controller.js      # Login, OTP, password reset flows
│   │   ├── public.controller.js     # Public book page (no auth)
│   │   ├── system.controller.js     # Reference data CRUD (genres, houses, languages)
│   │   └── user.controller.js       # Theme, profile, public sharing
│   ├── middleware/
│   │   ├── auth.middleware.js            # JWT cookie verification
│   │   ├── requireAdmin.middleware.js    # Allows admin + superadmin
│   │   └── requireSuperAdmin.middleware.js # Allows superadmin only
│   ├── routes/
│   │   └── app.routes.js            # All route definitions
│   ├── utils/
│   │   ├── user.utils.js            # hashPassword, comparePassword, isLocked
│   │   └── validate.js              # All input validation functions
│   └── db.js                        # MongoDB connection, indexes
├── .env                             # Environment variables (never commit)
├── .gitignore
├── package.json
└── server.js                        # Entry point — startup validation, middleware, server
```

---

## Local Setup

### Prerequisites
- Node.js 18+
- A MongoDB Atlas cluster with a `bookSearch` Atlas Search index on the books collection (see below)
- A free Resend account for sending OTP emails to the superadmin

### Steps

1. Clone the repo and install:
   ```bash
   git clone https://github.com/your-username/home-library-backend.git
   cd home-library-backend
   npm install
   ```

2. Create a `.env` file (see Environment Variables section below).

3. Set your superadmin user directly in MongoDB Atlas:
   ```js
   db.users.insertOne({
     name: "Your Name",
     email: "you@example.com",
     password: null,
     firstLogin: true,
     role: "superadmin",
     theme: "light",
     loginAttempts: 0,
     createdAt: new Date(),
     updatedAt: new Date()
   })
   ```
   Then use "First time logging in?" on the login page to set your password.

4. Start the server:
   ```bash
   node server.js
   ```
   The API will be available at `http://localhost:3000`.

---

## Environment Variables

Create a `.env` file in the project root. The server will refuse to start if any required variable is missing or invalid.

| Variable | Description | Example |
|---|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string | `mongodb+srv://user:pass@cluster.mongodb.net` |
| `DATABASE_NAME` | Database name in Atlas | `homeLibrary` |
| `JWT_SECRET` | Secret for signing JWT tokens — must be 32+ characters | *(generate below)* |
| `JWT_EXPIRY` | Token expiry duration | `4h` |
| `RESEND_API_KEY` | API key from resend.com | `re_xxxxxxxxxx` |
| `CORS_ORIGIN` | Allowed frontend origin | `http://localhost:5173` |
| `NODE_ENV` | Environment — controls error detail in responses | `development` |
| `LOGIN_MAX_ATTEMPTS` | Failed attempts before lockout | `5` |
| `LOGIN_LOCKOUT_MS` | Lockout duration in milliseconds | `900000` |
| `OTP_MAX_ATTEMPTS` | Wrong OTP attempts before rejection | `5` |
| `OTP_EXPIRY_MS` | OTP validity window in milliseconds | `600000` |
| `AUTH_RATE_LIMIT_WINDOW_MS` | Auth rate limit window in milliseconds | `900000` |
| `AUTH_RATE_LIMIT_MAX` | Max auth requests per window | `30` |
| `GLOBAL_RATE_LIMIT_WINDOW_MS` | Global rate limit window in milliseconds | `900000` |
| `GLOBAL_RATE_LIMIT_MAX` | Max global requests per window | `300` |
| `PORT` | Port the server listens on | `3000` |

**Generating a strong JWT_SECRET:**
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Resend API Key:** Sign up at [resend.com](https://resend.com) → API Keys → Create API Key. OTP emails are only delivered to the email address that owns the Resend account (the superadmin's email). All other password resets go through the admin-approval flow.

---

## Atlas Search Index

Create a Search index named `bookSearch` on your books collection in the Atlas UI:

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "title": {
        "type": "autocomplete",
        "tokenization": "edgeGram",
        "minGrams": 1,
        "maxGrams": 5
      },
      "author": {
        "type": "autocomplete",
        "tokenization": "edgeGram",
        "minGrams": 1,
        "maxGrams": 5
      },
      "house":    { "type": "token" },
      "genre":    { "type": "token" },
      "language": { "type": "token" },
      "createdAt": { "type": "date" },
      "_id": { "type": "objectId" },
      "statuses": {
        "type": "embeddedDocuments",
        "fields": {
          "userId": { "type": "objectId" },
          "status": { "type": "token" }
        }
      }
    }
  }
}
```

---

## Role System

| Capability | user | admin | superadmin |
|---|---|---|---|
| Use app (books, dashboard, discover) | ✓ | ✓ | ✓ |
| Manage reference data (genres, houses, languages) | ✗ | ✓ | ✓ |
| Bulk CSV import | ✗ | ✓ | ✓ |
| Manage users (add, remove, change role) | ✗ | ✗ | ✓ |
| Approve/revoke password resets | ✗ | ✗ | ✓ |
| Change superadmin role | ✗ | ✗ | ✗ |

The `superadmin` role is set directly in MongoDB — it cannot be assigned or removed via the API.

---

## API Reference

All routes except login, reset, and public endpoints require a valid JWT cookie.

### Auth (rate-limited)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/login` | Login with email and password |
| POST | `/send-reset-otp` | Check which reset method applies for this email |
| POST | `/reset-password` | Reset password (OTP, approved, or first-login flow) |
| POST | `/logout` | Clear session cookie |
| GET | `/me` | Check session validity and time remaining |
| POST | `/refresh-token` | Extend session |

### Books

| Method | Endpoint | Description |
|---|---|---|
| GET | `/fetchAllBooks` | Paginated book list. Params: `limit`, `page`, `sortBy`, `sortOrder`, `filterHouse`, `filterGenre`, `filterLanguage`, `filterStatus` |
| GET | `/searchBooks` | Atlas Search. Params: `q`, `limit`, `searchAfter`, `filterHouse`, `filterGenre`, `filterLanguage`, `filterStatus` |
| POST | `/addBook` | Add a new book |
| PUT | `/updateBook/:id` | Update a book |
| DELETE | `/deleteBook/:id` | Delete a book |

### Dashboard & Discover

| Method | Endpoint | Description |
|---|---|---|
| GET | `/dashboard` | Total books, by house, by genre, recently added |
| GET | `/discover` | Per-user stats, recommendations, reading timeline |

### User

| Method | Endpoint | Description |
|---|---|---|
| PATCH | `/users/theme` | Update theme preference |
| PATCH | `/users/profile` | Update profile (name) |
| POST | `/users/make-all-private` | Remove user from all publicByUsers arrays |
| GET | `/users/public-count` | Count of books user has made public |

### Reference Data (admin+)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/reference-data/:type` | List genres, houses, or languages |
| POST | `/reference-data/:type` | Create a new entry |
| PUT | `/reference-data/:type/:id` | Update an entry |
| DELETE | `/reference-data/:type/:id` | Delete (blocked if in use by books) |

### Admin (superadmin only)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/admin/users` | List all users |
| POST | `/admin/users` | Add a new user (no password — set on first login) |
| DELETE | `/admin/users/:id` | Remove user and clean up their book data |
| PATCH | `/admin/users/:id/role` | Change role (admin or superadmin can call this) |
| POST | `/admin/users/:id/approve-reset` | Approve password reset for a user |
| POST | `/admin/users/:id/revoke-reset` | Revoke password reset approval |
| POST | `/admin/csv/validate` | Validate a CSV before import |
| POST | `/admin/csv/import` | Import validated CSV |

### Public (no auth)

| Method | Endpoint | Description |
|---|---|---|
| GET | `/public/:userId` | Public book page for a user |

---

## Security

- **HTTPS enforced** — plain HTTP redirected to HTTPS via `x-forwarded-proto` (Railway edge)
- **HSTS** — 1-year max-age via `Strict-Transport-Security`
- **HttpOnly cookies** — JWT never accessible to JavaScript
- **Login brute force** — 5 failures locks account for 15 minutes
- **OTP brute force** — 5 wrong attempts invalidates the OTP
- **JWT scoped** — `req.user` only exposes `{ id, role }`
- **Input sanitisation** — HTML stripped from title, author, description, locationInHouse
- **ObjectId validation** — all `:id` params validated before DB queries
- **Two-tier rate limiting** — auth endpoints: 30 req/15min per IP; all traffic: 300 req/15min
- **Startup validation** — server exits if any required env var is missing or invalid