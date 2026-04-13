# Deployment Guide — Home Library App

## Overview

| Service | Platform | Cost |
|---|---|---|
| Frontend | Vercel | Free |
| Backend | Railway | ~$0–3/month |
| Database | MongoDB Atlas | Free tier (existing) |

---

## Step 1 — Prepare your backend repo

1. Make sure `.env` is in `.gitignore` and has never been committed.
2. Push all changes to GitHub.

---

## Step 2 — Deploy the backend on Railway

1. Go to [railway.app](https://railway.app) and sign up / log in with GitHub.

2. Click **New Project** → **Deploy from GitHub repo** → select your backend repo.

   > **If no repositories appear** — go to [github.com/settings/installations](https://github.com/settings/installations) → find Railway → **Configure** → under Repository access, select your repos → Save. Then retry in Railway.

3. Railway will auto-detect Node.js and start deploying.

4. Go to your service → **Variables** tab and add every variable below. Enter raw values — no surrounding quotes.

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | Your Atlas connection string |
   | `DATABASE_NAME` | Your database name in Atlas |
   | `JWT_SECRET` | A random 32+ character string (see below) |
   | `JWT_EXPIRY` | `4h` |
   | `RESEND_API_KEY` | Your Resend API key (see below) |
   | `CORS_ORIGIN` | Leave blank for now — fill in after Step 5 |
   | `NODE_ENV` | `production` |
   | `LOGIN_MAX_ATTEMPTS` | `5` |
   | `LOGIN_LOCKOUT_MS` | `900000` |
   | `OTP_MAX_ATTEMPTS` | `5` |
   | `OTP_EXPIRY_MS` | `600000` |
   | `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` |
   | `AUTH_RATE_LIMIT_MAX` | `30` |
   | `GLOBAL_RATE_LIMIT_WINDOW_MS` | `900000` |
   | `GLOBAL_RATE_LIMIT_MAX` | `300` |
   | `PORT` | `3000` |

   > **JWT_SECRET** — generate a strong one:
   > ```bash
   > node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   > ```

   > **RESEND_API_KEY** — sign up at [resend.com](https://resend.com) → API Keys → Create API Key → name it `HomeLibrary` → copy immediately (shown once only). The free tier gives 3,000 emails/month. Note: Resend free tier only delivers to the email address that owns the account — this is used for the superadmin's OTP flow only.

5. Go to **Settings** → **Networking** → **Generate Domain** to get your public backend URL (e.g. `https://home-library-backend-production.up.railway.app`). Copy it — you need it in Steps 3 and 5.

   > Leave **Root Directory** blank in Railway Settings → Build.

   > Set a spending limit under **Settings → Usage** (recommended: $5) to cap costs.

---

## Step 3 — Prepare your frontend repo

1. Make sure `.env.local` is in `.gitignore` and has never been committed.

2. Your `.env.local` for local development should contain:
   ```
   VITE_API_BASE=http://localhost:3000
   ```

3. Update `vercel.json` — replace the placeholder in the `connect-src` directive with your actual Railway URL from Step 2:
   ```
   connect-src 'self' https://your-railway-url.up.railway.app
   ```

4. Delete `src/App.css` if it still exists — it is unused boilerplate from the Vite starter template.

5. Push all changes to GitHub.

---

## Step 4 — Deploy the frontend on Vercel

1. Go to [vercel.com](https://vercel.com) and sign up / log in with GitHub.

2. Click **Add New Project** → select your frontend repo.

3. Vercel will auto-detect Vite. Leave all build settings as default.

4. Before clicking Deploy, go to **Environment Variables** and add:

   | Variable | Value |
   |---|---|
   | `VITE_API_BASE` | Your Railway URL from Step 2 — must include `https://` prefix |

   > The `https://` prefix is required. Without it, Vite will treat it as a relative path and append it to the Vercel domain instead.

5. Click **Deploy**. Copy your Vercel URL (e.g. `https://home-library.vercel.app`) — you need it for the next step.

---

## Step 5 — Set CORS_ORIGIN on Railway

1. Go back to Railway → your backend service → **Variables** tab.
2. Set `CORS_ORIGIN` to your Vercel URL (raw value, no quotes):
   ```
   https://home-library.vercel.app
   ```
3. Railway will automatically redeploy.

---

## Step 6 — Create the superadmin user

Connect to your Atlas cluster and insert the superadmin user directly:

```javascript
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

Then open your Vercel URL, click **First time logging in?**, enter your email, and set your password.

> The superadmin's email must match the email address that owns your Resend account for OTP delivery to work.

---

## Step 7 — Verify everything works

1. Open your Vercel URL and log in.
2. Open browser DevTools → **Network** tab — confirm API calls go to your Railway URL over `https://` and return 200.
3. Check a response header — `Strict-Transport-Security` should be present.
4. Run through this checklist:
   - [ ] Login works and reaches Dashboard
   - [ ] Books page loads, add/edit/delete a book
   - [ ] Search by title and author works
   - [ ] Filters work — try house, genre (multi-select AND), status
   - [ ] Wrong password 5 times → account locked with message
   - [ ] Forgot password (superadmin email) → OTP arrives → reset works
   - [ ] Theme toggle saves and persists on refresh
   - [ ] Settings modal opens — name edit, public link copy work
   - [ ] Admin panel → Reference Data tab works for adding/editing/deleting
   - [ ] Admin panel → Add User → new user can log in via "First time logging in?"
   - [ ] Mobile — cards render instead of table, sidebar opens/closes, modals fit screen

---

## Ongoing deployments

```bash
git add .
git commit -m "describe your change"
git push
```

Both Vercel and Railway watch your GitHub repos and redeploy automatically within about a minute.

---

## Troubleshooting

**Server refuses to start on Railway**
Check Railway logs. The startup validation will print which env var is missing or invalid. The most common cause is a missing variable or one wrapped in quotes (Railway stores values literally).

**No repositories found in Railway**
Go to [github.com/settings/installations](https://github.com/settings/installations) → Configure Railway → grant access to your repos → Save.

**404 on all API calls after deploying frontend**
`VITE_API_BASE` is missing the `https://` prefix. Vite embeds this at build time — add the prefix in Vercel environment variables and redeploy.

**CORS errors in the browser**
`CORS_ORIGIN` in Railway has a typo or extra quotes. It must be the raw Vercel URL with no surrounding punctuation. Removing and re-adding it in Railway fixes this.

**500 on login**
Check Railway logs. Set `NODE_ENV` to `development` temporarily to see the full error in the Network tab. Common causes:
- `JWT_SECRET` missing or under 32 characters
- `MONGODB_URI` wrong or Atlas cluster not reachable

**Atlas not reachable from Railway**
In Atlas → Network Access → Add IP Address → `0.0.0.0/0` (allow all). This is safe for a personal app since MongoDB still requires username and password.

**OTP emails not arriving**
Check your Resend dashboard → Emails section for delivery status. The OTP flow only works if the target email matches the email that owns the Resend account (the superadmin's email). All other users reset via the admin-approval flow.

**Vercel build fails**
`VITE_API_BASE` must be set in Vercel environment variables before the build runs. Vite embeds env vars at build time — they must exist when you click Deploy, not after.

**API calls going to the wrong URL**
DevTools → Network → click a failing request → check the full Request URL. If it starts with `https://your-vercel-app.vercel.app/https://...` then the `VITE_API_BASE` value in Vercel includes an extra `https://` or something similar.

---

## Environment Variable Reference

### Backend (Railway)

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `DATABASE_NAME` | Database name in Atlas |
| `JWT_SECRET` | Secret for signing JWT tokens — must be 32+ characters |
| `JWT_EXPIRY` | Token expiry e.g. `4h` |
| `RESEND_API_KEY` | API key from resend.com |
| `CORS_ORIGIN` | Your Vercel frontend URL — raw value, no quotes |
| `NODE_ENV` | `production` in prod, `development` to expose error details |
| `LOGIN_MAX_ATTEMPTS` | Failed login attempts before lockout |
| `LOGIN_LOCKOUT_MS` | Lockout duration in milliseconds |
| `OTP_MAX_ATTEMPTS` | Wrong OTP attempts before rejection |
| `OTP_EXPIRY_MS` | OTP validity window in milliseconds |
| `AUTH_RATE_LIMIT_WINDOW_MS` | Auth rate limit window in milliseconds |
| `AUTH_RATE_LIMIT_MAX` | Max auth requests per window |
| `GLOBAL_RATE_LIMIT_WINDOW_MS` | Global rate limit window in milliseconds |
| `GLOBAL_RATE_LIMIT_MAX` | Max global requests per window |
| `PORT` | Port Railway listens on (Railway sets this automatically) |

### Frontend (Vercel)

| Variable | Description |
|---|---|
| `VITE_API_BASE` | Your Railway backend URL — must include `https://` prefix |