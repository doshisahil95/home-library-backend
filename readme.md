
# home-library-backend

Node.js + Express REST API for the Home Library app. Backed by MongoDB Atlas (native driver, no ODM), JWT auth via HttpOnly cookies, Resend for transactional email, Helmet for security headers, and an Atlas Search index for full-text book search.

Multi-tenant per household: every authenticated user shares the same `books` collection, but reading status, ratings, dates, notes (visible to the household), reading goals, and wishlists are scoped per user.

---

## Features

### Books
- Browse with filtering (house, genre multi-AND, language, status), sorting, offset pagination
- Atlas Search full-text query on title + author with cursor pagination
- Default browse order is `_id` ascending (oldest added first)
- Per-user reading status (`read`, `reading`, `want to read`) — one-way transitions enforced
- Per-user `startedAt` / `finishedAt` dates with manual-edit locking
- Per-user 1–5 star rating, locked after first save
- Per-user public sharing toggle (independent of reading status) — surfaces on a public unauthenticated page
- Per-user notes per book — visible to all household members, stripped from the public unauthenticated page

### Series tracking
- Dedicated `series` collection with case-insensitive uniqueness
- Books carry a `series` reference + integer `seriesOrder`
- Per-house uniqueness on `(house, seriesId, seriesOrder)` — one "Book #1" per house
- Renaming a series cascades to all books holding it
- Deleting a series is blocked while books reference it

### Reading goals
- Private per-user yearly target (number of books to finish)
- Auto-resets each January (logic keyed on the calendar year)
- Read/written via `/users/reading-goal` — no separate auth surface

### Discover (per-user, household-aware)
- Personal stats (books in each status, finished this year, average rating)
- Genre breakdown
- Currently Reading widget — what other household members are reading right now (excludes self)
- 30-day Activity Feed — status changes (started / finished) by other household members, newest first
- Recommendations — weighted by genre overlap, signed rating adjustment, series progression (book N+1 if you finished book N), and recency (gated on average rating ≥ 3 so poorly-rated books don't get a recency boost). Books with a net-negative score are filtered out entirely
- Recently finished by others — includes the reader's note text inline when available
- Reading timeline

### Wishlist
- Private per-user list (`title`, `author`, optional `note`)
- Separate from the main library — does not show up to other household members
- Convertible into a real library book

### Reference data (genres, houses, languages, series)
- CRUD via `/reference-data/:type` (and `/series` for series-specific actions)
- Case-insensitive unique names
- Renaming cascades to all books that reference the value
- Deleting is blocked while any book references the value
- Bulk CSV import / export per ref type

### Bulk book CSV import
- Two-step flow: `validate` (returns row-level errors) then `import`
- Auto-creates unknown genres / houses / languages / series during import (deduped intra-file)
- Supports per-row `makePublic` flag and series assignment via `series` + `seriesOrder` columns

### Admin / superadmin
- User management (list, add, delete, role change) — superadmin-gated
- Admin-approved password reset, OTP-based reset (via Resend), revoke pending reset
- All admin write routes protected by `requireAdmin` / `requireSuperAdmin` middleware

### Auth & session
- JWT issued in HttpOnly cookie (CSRF-safe, JS-inaccessible)
- `/me` returns user + ms remaining on token; `/refresh-token` re-issues
- Auth rate-limiter on login + reset endpoints
- Global rate-limiter on all routes

### Health
- `/health` — lightweight no-auth endpoint used by the frontend Login page to warm a cold instance before the user submits credentials. Returns `{ ok: true, uptime: <seconds> }`. Does not touch MongoDB.

### Public (no auth)
- `/public/:userId` returns only books that user has explicitly shared — notes are stripped from this response

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express |
| Database | MongoDB Atlas (native `mongodb` driver v7+) |
| Search | Atlas Search index `bookSearch` (autocomplete on title + author, token on house / genre / language, embeddedDocument on statuses, objectId on `_id` for sortable cursor pagination, date on `createdAt`). Auto-created by `db.js` on first boot |
| Auth | JSON Web Tokens via HttpOnly cookie |
| Email | Resend |
| Security | Helmet, express-rate-limit, CORS allow-list, HTTPS redirect in production |

---

## Folder Structure

```
home-library-backend/
├── api/
│   ├── controllers/
│   │   ├── admin.controller.js      # User management, CSV bulk import/export
│   │   ├── book.controller.js       # CRUD, browse, Atlas Search
│   │   ├── dashboard.controller.js  # Aggregate collection stats
│   │   ├── login.controller.js      # Auth flows, password reset, /me, refresh
│   │   ├── public.controller.js     # Unauthenticated public library view
│   │   ├── series.controller.js     # Series CRUD + book assignment
│   │   ├── system.controller.js     # Reference data with cascading rename
│   │   ├── user.controller.js       # Profile, theme, notes, reading goal, discover
│   │   └── wishlist.controller.js   # Per-user wishlist CRUD
│   ├── middleware/
│   │   ├── auth.middleware.js
│   │   ├── requireAdmin.middleware.js
│   │   └── requireSuperAdmin.middleware.js
│   ├── routes/
│   │   └── app.routes.js            # All routes wired here
│   ├── utils/
│   │   ├── user.utils.js            # JWT issue/verify, cookie helpers
│   │   └── validate.js              # All input validators
│   └── db.js                        # Mongo connection + collection accessors + indexes + Atlas Search index
├── server.js                        # Entry point — env validation, Helmet, CORS, /health, rate limiter, routes
├── package.json
└── .env                             # Never commit
```

---

## Local Setup

### Prerequisites
- Node.js 18+
- A MongoDB Atlas cluster (free tier is fine). The `bookSearch` Atlas Search index is created automatically by `db.js` on first boot — no manual setup required, but it takes 10-60s to become queryable the first time.
- A Resend account (for password reset emails) — optional in dev if you skip OTP flows

### Steps

1. Clone and install:
   ```bash
   git clone https://github.com/doshisahil95/home-library-backend.git
   cd home-library-backend
   npm install
   ```

2. Create a `.env` file (see the full table below for all required vars).

3. Start the server:
   ```bash
   npm start
   ```

The API listens on `http://localhost:3000`.

On first boot you'll see:
```
Connected to MongoDB
Created Atlas Search index "bookSearch" — may take 10-60s to become queryable.
Indexes ensured.
Server listening on port 3000
```

On subsequent boots:
```
Atlas Search index "bookSearch" already exists.
```

---

## Environment Variables

All of these are required — `server.js` validates them at boot and exits with a clear error if any are missing or malformed.

### Database
| Variable | Purpose |
|---|---|
| `MONGODB_URI` | Atlas connection string |
| `DATABASE_NAME` | Mongo database name |

### Auth
| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Signing secret for auth tokens — must be at least 32 chars |
| `JWT_EXPIRY` | JWT lifetime, e.g. `4h` |

### Email
| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key for password reset emails |

### CORS
| Variable | Purpose |
|---|---|
| `CORS_ORIGIN` | Comma-separated allow-list of frontend origins |

### Login brute-force protection
| Variable | Purpose |
|---|---|
| `LOGIN_MAX_ATTEMPTS` | Failed logins before lockout (e.g. `5`) |
| `LOGIN_LOCKOUT_MS` | Lockout duration in ms (e.g. `900000` for 15 min) |

### OTP
| Variable | Purpose |
|---|---|
| `OTP_MAX_ATTEMPTS` | Wrong OTP attempts before rejection (e.g. `5`) |
| `OTP_EXPIRY_MS` | OTP validity window (e.g. `600000` for 10 min) |

### Rate limiting
| Variable | Purpose |
|---|---|
| `AUTH_RATE_LIMIT_WINDOW_MS` | Auth window in ms (e.g. `900000`) |
| `AUTH_RATE_LIMIT_MAX` | Max auth requests per window (e.g. `30`) |
| `GLOBAL_RATE_LIMIT_WINDOW_MS` | Global window in ms (e.g. `900000`) |
| `GLOBAL_RATE_LIMIT_MAX` | Max global requests per window (e.g. `300`) |

### Optional
| Variable | Purpose |
|---|---|
| `NODE_ENV` | `production` enables HTTPS enforcement and hides error details |
| `PORT` | Server port — Render assigns automatically; default `3000` locally |

---

## API Reference

### Health
| Method | Path | Description |
|---|---|---|
| GET | `/health` | No-auth liveness check used by frontend warm-up. Does not touch DB |

### Auth (rate-limited)
| Method | Path | Description |
|---|---|---|
| POST | `/login` | Email + password login, sets HttpOnly JWT cookie |
| POST | `/send-reset-otp` | Triggers reset flow — returns `method`: `otp` / `first_login` / `approved` / `already_registered` / `contact_admin` |
| POST | `/reset-password` | Completes password reset (OTP-verified or admin-approved) |
| POST | `/logout` | Clears cookie |

### Session
| Method | Path | Description |
|---|---|---|
| GET | `/me` | Current user + ms remaining on token |
| POST | `/refresh-token` | Re-issues JWT cookie |

### Books
| Method | Path | Description |
|---|---|---|
| GET | `/fetchAllBooks` | Browse mode — filter / sort / paginate. Default order `_id` ascending |
| GET | `/searchBooks` | Atlas Search mode — text query + cursor pagination. Default order `_id` ascending (matches browse) |
| POST | `/addBook` | Create a book (status optional at create time) |
| PUT | `/updateBook/:id` | Update core fields + per-user status |
| DELETE | `/deleteBook/:id` | Delete a book |
| PUT | `/books/:bookId/note` | Upsert per-user note for a book — empty text deletes |

### Reading goal
| Method | Path | Description |
|---|---|---|
| GET | `/users/reading-goal` | Current year's goal + progress |
| PUT | `/users/reading-goal` | Set / update target |

### Discover
| Method | Path | Description |
|---|---|---|
| GET | `/discover` | Personal stats, genre breakdown, currently reading widget, activity feed, recommendations (with low-rating penalty), recently finished by others (with notes) |

### User
| Method | Path | Description |
|---|---|---|
| PATCH | `/users/theme` | Persist light/dark preference |
| PATCH | `/users/profile` | Update display name |
| POST | `/users/make-all-private` | Strip current user from every book's `publicByUsers` |
| GET | `/users/public-count` | Count of books currently shared by this user |

### Reference data (genres, houses, languages)
| Method | Path | Description |
|---|---|---|
| GET | `/reference-data/:type` | List entries |
| POST | `/reference-data/:type` | Create (admin) |
| PUT | `/reference-data/:type/:id` | Rename — cascades to all books |
| DELETE | `/reference-data/:type/:id` | Delete (admin) — blocked if any book references it |

### Series
| Method | Path | Description |
|---|---|---|
| GET | `/series` | List all series |
| POST | `/series` | Create (admin) |
| PUT | `/series/:id` | Rename (admin) — cascades to all books |
| DELETE | `/series/:id` | Delete (admin) — blocked if any book references it |
| POST | `/books/:bookId/series` | Assign book to a series at a given order |
| DELETE | `/books/:bookId/series` | Remove book from its series |

### Wishlist (private per user)
| Method | Path | Description |
|---|---|---|
| GET | `/wishlist` | List current user's items |
| POST | `/wishlist` | Add item |
| PUT | `/wishlist/:itemId` | Edit item |
| DELETE | `/wishlist/:itemId` | Remove item |

### Admin — book CSV
| Method | Path | Description |
|---|---|---|
| POST | `/admin/csv/validate` | Dry run — returns row-level errors and a preview |
| POST | `/admin/csv/import` | Persist parsed rows; auto-creates missing ref values |

### Admin — reference data CSV
| Method | Path | Description |
|---|---|---|
| POST | `/admin/ref-csv/validate` | Validate a ref-data CSV |
| POST | `/admin/ref-csv/import` | Import a ref-data CSV |
| GET | `/admin/ref-csv/export/:type` | Download a ref-data CSV |

### Admin — users
| Method | Path | Description |
|---|---|---|
| GET | `/admin/users` | List all users (superadmin) |
| POST | `/admin/users` | Add user (superadmin) |
| DELETE | `/admin/users/:id` | Remove user (superadmin) |
| PATCH | `/admin/users/:id/role` | Promote / demote (admin) |
| POST | `/admin/users/:id/approve-reset` | Pre-approve password reset (superadmin) |
| POST | `/admin/users/:id/revoke-reset` | Revoke pending approval (superadmin) |

### Public (no auth)
| Method | Path | Description |
|---|---|---|
| GET | `/public/:userId` | Returns only books that user has shared. Notes are stripped from this response |

---

## Data Model

### `users`
```
{ _id, email, passwordHash, name, theme, role, readingGoal?: { target, year }, createdAt, ... }
```

### `books`
```
{
  _id, title, author, house, genre: [String], language,
  locationInHouse, description,
  series?: { id: ObjectId, name: String, order: Number },
  notes?: [{ userId: ObjectId, text: String, updatedAt: Date }],
  statuses: [{
    userId, status, startedAt?, startedAtLocked?,
    finishedAt?, finishedAtLocked?, rating?
  }],
  publicByUsers: [ObjectId],
  createdAt, updatedAt
}
```

### `series`
```
{ _id, name, createdAt, updatedAt }
```
Unique index on `name` (case-insensitive collation strength 2).

### `wishlist`
```
{ _id, userId, title, author, note?, createdAt, updatedAt }
```

### `genres`, `houses`, `languages`
```
{ _id, name, createdAt, updatedAt }
```
Unique case-insensitive on `name`.

### `passwordResets`
```
{ _id, userId, otp?, approvedBy?, expiresAt, ... }
```

---

## Key Implementation Notes

**Atlas Search index in `db.js`** — The `bookSearch` index definition lives in `db.js` (`BOOK_SEARCH_INDEX_DEFINITION`) and is created on first boot via `createSearchIndex()`. Fields mapped: `_id` (objectId, for sortable cursor pagination), `title` and `author` (autocomplete with edgeGram tokenization and foldDiacritics), `house` / `language` / `genre` (token), `createdAt` (date), and `statuses` as `embeddedDocuments` with nested `userId` (objectId) and `status` (token). The ensure logic skips creation if the index already exists, and silently no-ops on environments where Atlas Search isn't available (local Mongo).

**Cascading rename for reference data** — When a genre / house / language / series is renamed, the rename happens in two steps inside `system.controller.js` (or `series.controller.js`): update the ref-data document, then `updateMany` on `books` to propagate the new value. For genres (an array field) this uses an aggregation pipeline update with `$map` so only the matching string in the array is replaced.

**Cascading delete protection** — A ref-data delete first checks `books.countDocuments({ <bookField>: name })`. If any book still references the value, the request is rejected with a clear error. Users must unmap first.

**CSV auto-create** — During book CSV import, unknown genres / houses / languages / series are created on the fly and reused for subsequent rows in the same import (deduped within the file using case-insensitive matching). This avoids the user having to pre-seed ref data before importing.

**Series uniqueness per house** — `(house, seriesId, seriesOrder)` is enforced both at single-book write paths and inside CSV import (intra-file plus DB check). Two physical houses can each have their own copy of "Book #1", but the same house cannot.

**Status transitions** — `validateStatusTransition` enforces a one-way state machine: `null → want to read → reading → read`. Any attempt to go backwards returns a 400.

**Date and rating locking** — On update, if a user supplies a `startedAt` or `finishedAt` that differs from the previously stored value, the corresponding `*Locked` flag flips to `true` and the field is permanently frozen. Ratings lock immediately after the first non-null save.

**Atlas Search cursor pagination** — `searchBooks` uses `$search` with `searchAfter` and emits `paginationToken: { $meta: "searchSequenceToken" }`. The token is opaque base64 and must be passed back verbatim. The endpoint fetches `limit + 1` to know if a next page exists, then strips the extra row. Sort is `{ _id: 1 }` to match browse mode default — ensures predictable ordering for series and other naturally-ordered content.

**Response shape for books** — Every book response is augmented by `extractUserStatus()` which flattens the current user's status entry to top-level fields (`userStatus`, `startedAt`, `rating`, `isPublic`, etc.). Other users' statuses are still on `statuses[]` for the Discover endpoint.

**Public sharing** — Stored as `publicByUsers: [ObjectId]` on the book — independent of reading status. The public endpoint returns only books the requested user has explicitly shared, and strips the `notes` array from the response.

**Notes** — Stored on the book document as an array `notes: [{ userId, text, updatedAt }]`. Visible to all household members — when responses are returned to authenticated users, each note is enriched with `userName` via a single batched lookup on `users` (so the frontend can render "Note from Alice" without N+1 round trips). Empty text on the upsert endpoint deletes the note.

**Recommendations scoring** — Final score per candidate book is:
```
genreOverlap + ratingAdjustment(avg) + recencyBonus + seriesProgressionBonus
```
where `ratingAdjustment` is signed: `+6` for avg ≥ 4.5, `+3` for ≥ 3.5, `0` for ≥ 2.5, `-3` for ≥ 1.5, `-6` below. Recency bonus (`+3`) only applies when the book has either no ratings yet or avg ≥ 3, so a 1-star recently-finished book never gets a recency boost. Books with net-negative scores are filtered out — recommending nothing beats recommending something the household disliked.

**Reading goal auto-reset** — There is no scheduled job. The endpoint reads the current `year` and looks up the goal for that year — January 1 naturally returns "no goal for this year yet".

**HTTPS enforcement** — `server.js` redirects `http://` to `https://` in production based on `x-forwarded-proto` (Render terminates TLS at the edge and forwards via this header).

**Env validation at boot** — All env vars are validated upfront with concrete hints. Missing or malformed values cause `process.exit(1)` with one line per missing var explaining what's expected.

---

## Deployment (Render)

1. Push to GitHub.
2. [render.com](https://render.com) → New + → **Web Service** → connect this repo.
3. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
4. Add every environment variable listed above.
5. `CORS_ORIGIN` — set to your deployed Vercel frontend URL exactly (https://, no trailing slash).
6. Skip `COOKIE_DOMAIN` — Render and Vercel are different root domains, so the default cookie behavior with `sameSite: "none", secure: true` is what you want.
7. Deploy. Render gives you a `*.onrender.com` URL — use it as `VITE_API_BASE` in the frontend.
8. Whitelist `0.0.0.0/0` in MongoDB Atlas Network Access (Render uses dynamic egress IPs on the free tier).

**Cold start behavior** — Render's free tier sleeps the service after 15 min of no traffic. First request after sleep takes ~30s. The frontend mitigates this by pinging `/health` from the Login page on mount so the backend warms up while the user is typing credentials.
