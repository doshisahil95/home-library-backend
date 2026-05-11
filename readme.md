
# home-library-backend

Node.js + Express REST API for the Home Library app. Backed by MongoDB Atlas (native driver, no ODM), JWT auth via HttpOnly cookies, Resend for transactional email, Helmet for security headers, and an Atlas Search index for full-text book search.

Multi-tenant per household: every authenticated user shares the same `books` collection, but reading status, ratings, dates, notes, reading goals, and wishlists are scoped per user.

---

## Features

### Books
- Browse with filtering (house, genre multi-AND, language, status), sorting, offset pagination
- Atlas Search full-text query on title + author with cursor pagination
- Per-user reading status (`read`, `reading`, `want to read`) — one-way transitions enforced
- Per-user `startedAt` / `finishedAt` dates with manual-edit locking
- Per-user 1–5 star rating, locked after first save
- Per-user public sharing toggle (independent of reading status) — surfaces on a public unauthenticated page
- Per-user private notes per book (markdown-safe text, sanitised)

### Series tracking
- Dedicated `series` collection with case-insensitive uniqueness
- Books carry a `series` reference + `seriesOrder` integer
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
- Recommendations — weighted by genre overlap, average rating, series progression (book N+1 if you finished book N), and recency
- Recently finished by others, reading timeline

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
- Auto-creates unknown genres / houses / languages / series during import
- Supports per-row `makePublic` flag and series assignment via `series` + `seriesOrder` columns

### Admin / superadmin
- User management (list, add, delete, role change) — superadmin-gated
- Admin-approved password reset, OTP-based reset (via Resend), revoke pending reset
- All admin write routes protected by `requireAdmin` / `requireSuperAdmin` middleware

### Auth & session
- JWT issued in HttpOnly cookie (CSRF-safe, JS-inaccessible)
- `/me` returns user + ms remaining on token; `/refresh-token` re-issues
- Auth rate-limiter on login + reset endpoints

### Public (no auth)
- `/public/:userId` returns only books that user has explicitly shared

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express |
| Database | MongoDB Atlas (native `mongodb` driver) |
| Search | Atlas Search index `bookSearch` (autocomplete on title + author, embeddedDocument on statuses) |
| Auth | JSON Web Tokens via HttpOnly cookie |
| Email | Resend |
| Security | Helmet, express-rate-limit, CORS allow-list |

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
│   │   ├── system.controller.js     # Reference data (genres, houses, languages) with cascading rename
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
│   └── db.js                        # Mongo connection + collection accessors + indexes
├── server.js                        # Entry point — Helmet, CORS, rate limiter, route mount
├── package.json
└── .env                             # Never commit
```

---

## Local Setup

### Prerequisites
- Node.js 18+
- A MongoDB Atlas cluster (free tier is fine) with the `bookSearch` Atlas Search index created on the `books` collection
- A Resend account (for password reset emails) — optional in dev if you skip OTP flows

### Steps

1. Clone and install:
   ```bash
   git clone https://github.com/your-username/home-library-backend.git
   cd home-library-backend
   npm install
   ```

2. Create a `.env` file:
   ```env
   MONGO_URI=mongodb+srv://...
   DB_NAME=home_library
   JWT_SECRET=<long-random-string>
   COOKIE_DOMAIN=localhost
   CORS_ORIGIN=http://localhost:5173
   RESEND_API_KEY=re_...
   FROM_EMAIL=no-reply@yourdomain.com
   PUBLIC_BASE_URL=http://localhost:5173
   NODE_ENV=development
   PORT=3000
   ```

3. Create the Atlas Search index `bookSearch` on the `books` collection with autocomplete mappings on `title` and `author`, plus an embeddedDocument mapping on `statuses` for status-filter searches.

4. Start the server:
   ```bash
   npm start
   ```

The API listens on `http://localhost:3000`.

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `MONGO_URI` | Atlas connection string |
| `DB_NAME` | Mongo database name |
| `JWT_SECRET` | Signing secret for auth tokens |
| `COOKIE_DOMAIN` | Cookie domain (`localhost` in dev, your apex domain in prod) |
| `CORS_ORIGIN` | Comma-separated allow-list of frontend origins |
| `RESEND_API_KEY` | Resend API key for password reset emails |
| `FROM_EMAIL` | Verified sender address |
| `PUBLIC_BASE_URL` | Frontend URL used inside email links |
| `NODE_ENV` | `development` exposes error messages in responses |
| `PORT` | Server port (default 3000) |

---

## API Reference

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
| GET | `/fetchAllBooks` | Browse mode — filter / sort / paginate |
| GET | `/searchBooks` | Atlas Search mode — text query + cursor pagination |
| POST | `/addBook` | Create a book (status optional at create time) |
| PUT | `/updateBook/:id` | Update core fields + per-user status |
| DELETE | `/deleteBook/:id` | Delete a book |
| PUT | `/books/:bookId/note` | Upsert per-user note for a book |

### Reading goal
| Method | Path | Description |
|---|---|---|
| GET | `/users/reading-goal` | Current year's goal + progress |
| PUT | `/users/reading-goal` | Set / update target |

### Discover
| Method | Path | Description |
|---|---|---|
| GET | `/discover` | Personal stats, genre breakdown, currently reading widget, activity feed, recommendations, wishlist summary |

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
| GET | `/public/:userId` | Returns only books that user has shared |

---

## Data Model

### `users`
```
{ _id, email, passwordHash, displayName, theme, role, createdAt, ... }
```

### `books`
```
{
  _id, title, author, house, genre: [String], language,
  locationInHouse, description,
  seriesId?: ObjectId, seriesOrder?: Number,
  notes?: { [userIdString]: { text, updatedAt } },
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

### `readingGoals`
```
{ _id, userId, year, target, createdAt, updatedAt }
```
Unique compound on `(userId, year)`.

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

**Cascading rename for reference data** — When a genre / house / language / series is renamed, the rename happens in two steps inside `system.controller.js` (or `series.controller.js`): update the ref-data document, then `updateMany` on `books` to propagate the new value. For genres (an array field) this uses an aggregation pipeline update with `$map` so only the matching string in the array is replaced.

**Cascading delete protection** — A ref-data delete first checks `books.countDocuments({ <bookField>: name })`. If any book still references the value, the request is rejected with a clear error. Users must unmap first.

**CSV auto-create** — During book CSV import, unknown genres / houses / languages / series are created on the fly and reused for subsequent rows in the same import (deduped within the file using case-insensitive matching). This avoids the user having to pre-seed ref data before importing.

**Series uniqueness per house** — `(house, seriesId, seriesOrder)` is enforced both at single-book write paths and inside CSV import (intra-file plus DB check). Two physical houses can each have their own copy of "Book #1", but the same house cannot.

**Status transitions** — `validateStatusTransition` enforces a one-way state machine: `null → want to read → reading → read`. Any attempt to go backwards returns a 400.

**Date and rating locking** — On update, if a user supplies a `startedAt` or `finishedAt` that differs from the previously stored value, the corresponding `*Locked` flag flips to `true` and the field is permanently frozen. Ratings lock immediately after the first non-null save.

**Atlas Search cursor pagination** — `searchBooks` uses `$search` with `searchAfter` and emits `paginationToken: { $meta: "searchSequenceToken" }`. The token is opaque base64 and must be passed back verbatim. The endpoint fetches `limit + 1` to know if a next page exists, then strips the extra row.

**Response shape for books** — Every book response is augmented by `extractUserStatus()` which flattens the current user's status entry to top-level fields (`userStatus`, `startedAt`, `rating`, `isPublic`, etc.). Other users' statuses are still on `statuses[]` for the Discover endpoint.

**Public sharing** — Stored as `publicByUsers: [ObjectId]` on the book — independent of reading status. The public endpoint returns only books the requested user has explicitly shared.

**Notes** — Stored on the book document under `notes[userIdString]` so they ride along with the book payload and require no extra round-trip. The note write goes through `PUT /books/:bookId/note`, which uses a dotted-path `$set` so only that user's note is touched.

**Reading goal auto-reset** — There is no scheduled job. The endpoint reads the current `year` and looks up the goal for that year — January 1 naturally returns "no goal for this year yet".

---

## Deployment (Railway)

1. Push to GitHub.
2. Create a new Railway project from the repo.
3. Add all environment variables listed above.
4. Set `CORS_ORIGIN` to your deployed frontend URL (Vercel).
5. Deploy. Railway gives you a `*.up.railway.app` URL — use it as `VITE_API_BASE` in the frontend.
6. Whitelist the Railway egress IP in MongoDB Atlas (or `0.0.0.0/0` for simplicity, locked behind the connection-string credentials).

# home-library-backend

Node.js + Express REST API for the Home Library app. Backed by MongoDB Atlas (native driver, no ODM), JWT auth via HttpOnly cookies, Resend for transactional email, Helmet for security headers, and an Atlas Search index for full-text book search.

Multi-tenant per household: every authenticated user shares the same `books` collection, but reading status, ratings, dates, notes, reading goals, and wishlists are scoped per user.

---

## Features

### Books
- Browse with filtering (house, genre multi-AND, language, status), sorting, offset pagination
- Atlas Search full-text query on title + author with cursor pagination
- Per-user reading status (`read`, `reading`, `want to read`) — one-way transitions enforced
- Per-user `startedAt` / `finishedAt` dates with manual-edit locking
- Per-user 1–5 star rating, locked after first save
- Per-user public sharing toggle (independent of reading status) — surfaces on a public unauthenticated page
- Per-user private notes per book (markdown-safe text, sanitised)

### Series tracking
- Dedicated `series` collection with case-insensitive uniqueness
- Books carry a `series` reference + `seriesOrder` integer
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
- Recommendations — weighted by genre overlap, average rating, series progression (book N+1 if you finished book N), and recency
- Recently finished by others, reading timeline

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
- Auto-creates unknown genres / houses / languages / series during import
- Supports per-row `makePublic` flag and series assignment via `series` + `seriesOrder` columns

### Admin / superadmin
- User management (list, add, delete, role change) — superadmin-gated
- Admin-approved password reset, OTP-based reset (via Resend), revoke pending reset
- All admin write routes protected by `requireAdmin` / `requireSuperAdmin` middleware

### Auth & session
- JWT issued in HttpOnly cookie (CSRF-safe, JS-inaccessible)
- `/me` returns user + ms remaining on token; `/refresh-token` re-issues
- Auth rate-limiter on login + reset endpoints

### Public (no auth)
- `/public/:userId` returns only books that user has explicitly shared

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express |
| Database | MongoDB Atlas (native `mongodb` driver) |
| Search | Atlas Search index `bookSearch` (autocomplete on title + author, embeddedDocument on statuses) |
| Auth | JSON Web Tokens via HttpOnly cookie |
| Email | Resend |
| Security | Helmet, express-rate-limit, CORS allow-list |

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
│   │   ├── system.controller.js     # Reference data (genres, houses, languages) with cascading rename
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
│   └── db.js                        # Mongo connection + collection accessors + indexes
├── server.js                        # Entry point — Helmet, CORS, rate limiter, route mount
├── package.json
└── .env                             # Never commit
```

---

## Local Setup

### Prerequisites
- Node.js 18+
- A MongoDB Atlas cluster (free tier is fine) with the `bookSearch` Atlas Search index created on the `books` collection
- A Resend account (for password reset emails) — optional in dev if you skip OTP flows

### Steps

1. Clone and install:
   ```bash
   git clone https://github.com/your-username/home-library-backend.git
   cd home-library-backend
   npm install
   ```

2. Create a `.env` file:
   ```env
   MONGO_URI=mongodb+srv://...
   DB_NAME=home_library
   JWT_SECRET=<long-random-string>
   COOKIE_DOMAIN=localhost
   CORS_ORIGIN=http://localhost:5173
   RESEND_API_KEY=re_...
   FROM_EMAIL=no-reply@yourdomain.com
   PUBLIC_BASE_URL=http://localhost:5173
   NODE_ENV=development
   PORT=3000
   ```

3. Create the Atlas Search index `bookSearch` on the `books` collection with autocomplete mappings on `title` and `author`, plus an embeddedDocument mapping on `statuses` for status-filter searches.

4. Start the server:
   ```bash
   npm start
   ```

The API listens on `http://localhost:3000`.

---

## Environment Variables

| Variable | Purpose |
|---|---|
| `MONGO_URI` | Atlas connection string |
| `DB_NAME` | Mongo database name |
| `JWT_SECRET` | Signing secret for auth tokens |
| `COOKIE_DOMAIN` | Cookie domain (`localhost` in dev, your apex domain in prod) |
| `CORS_ORIGIN` | Comma-separated allow-list of frontend origins |
| `RESEND_API_KEY` | Resend API key for password reset emails |
| `FROM_EMAIL` | Verified sender address |
| `PUBLIC_BASE_URL` | Frontend URL used inside email links |
| `NODE_ENV` | `development` exposes error messages in responses |
| `PORT` | Server port (default 3000) |

---

## API Reference

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
| GET | `/fetchAllBooks` | Browse mode — filter / sort / paginate |
| GET | `/searchBooks` | Atlas Search mode — text query + cursor pagination |
| POST | `/addBook` | Create a book (status optional at create time) |
| PUT | `/updateBook/:id` | Update core fields + per-user status |
| DELETE | `/deleteBook/:id` | Delete a book |
| PUT | `/books/:bookId/note` | Upsert per-user note for a book |

### Reading goal
| Method | Path | Description |
|---|---|---|
| GET | `/users/reading-goal` | Current year's goal + progress |
| PUT | `/users/reading-goal` | Set / update target |

### Discover
| Method | Path | Description |
|---|---|---|
| GET | `/discover` | Personal stats, genre breakdown, currently reading widget, activity feed, recommendations, wishlist summary |

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
| GET | `/public/:userId` | Returns only books that user has shared |

---

## Data Model

### `users`
```
{ _id, email, passwordHash, displayName, theme, role, createdAt, ... }
```

### `books`
```
{
  _id, title, author, house, genre: [String], language,
  locationInHouse, description,
  seriesId?: ObjectId, seriesOrder?: Number,
  notes?: { [userIdString]: { text, updatedAt } },
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

### `readingGoals`
```
{ _id, userId, year, target, createdAt, updatedAt }
```
Unique compound on `(userId, year)`.

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

**Cascading rename for reference data** — When a genre / house / language / series is renamed, the rename happens in two steps inside `system.controller.js` (or `series.controller.js`): update the ref-data document, then `updateMany` on `books` to propagate the new value. For genres (an array field) this uses an aggregation pipeline update with `$map` so only the matching string in the array is replaced.

**Cascading delete protection** — A ref-data delete first checks `books.countDocuments({ <bookField>: name })`. If any book still references the value, the request is rejected with a clear error. Users must unmap first.

**CSV auto-create** — During book CSV import, unknown genres / houses / languages / series are created on the fly and reused for subsequent rows in the same import (deduped within the file using case-insensitive matching). This avoids the user having to pre-seed ref data before importing.

**Series uniqueness per house** — `(house, seriesId, seriesOrder)` is enforced both at single-book write paths and inside CSV import (intra-file plus DB check). Two physical houses can each have their own copy of "Book #1", but the same house cannot.

**Status transitions** — `validateStatusTransition` enforces a one-way state machine: `null → want to read → reading → read`. Any attempt to go backwards returns a 400.

**Date and rating locking** — On update, if a user supplies a `startedAt` or `finishedAt` that differs from the previously stored value, the corresponding `*Locked` flag flips to `true` and the field is permanently frozen. Ratings lock immediately after the first non-null save.

**Atlas Search cursor pagination** — `searchBooks` uses `$search` with `searchAfter` and emits `paginationToken: { $meta: "searchSequenceToken" }`. The token is opaque base64 and must be passed back verbatim. The endpoint fetches `limit + 1` to know if a next page exists, then strips the extra row.

**Response shape for books** — Every book response is augmented by `extractUserStatus()` which flattens the current user's status entry to top-level fields (`userStatus`, `startedAt`, `rating`, `isPublic`, etc.). Other users' statuses are still on `statuses[]` for the Discover endpoint.

**Public sharing** — Stored as `publicByUsers: [ObjectId]` on the book — independent of reading status. The public endpoint returns only books the requested user has explicitly shared.

**Notes** — Stored on the book document under `notes[userIdString]` so they ride along with the book payload and require no extra round-trip. The note write goes through `PUT /books/:bookId/note`, which uses a dotted-path `$set` so only that user's note is touched.

**Reading goal auto-reset** — There is no scheduled job. The endpoint reads the current `year` and looks up the goal for that year — January 1 naturally returns "no goal for this year yet".

---

## Deployment (Railway)

1. Push to GitHub.
2. Create a new Railway project from the repo.
3. Add all environment variables listed above.
4. Set `CORS_ORIGIN` to your deployed frontend URL (Vercel).
5. Deploy. Railway gives you a `*.up.railway.app` URL — use it as `VITE_API_BASE` in the frontend.
6. Whitelist the Railway egress IP in MongoDB Atlas (or `0.0.0.0/0` for simplicity, locked behind the connection-string credentials).
