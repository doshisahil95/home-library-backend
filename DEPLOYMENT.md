# Deployment Guide — Home Library App

## Overview

| Service | Platform | Cost |
|---|---|---|
| Frontend | Vercel | Free |
| Backend | Railway | ~$0–3/month |
| Database | MongoDB Atlas | Free tier (existing) |

---

## Step 1 — Prepare your backend repo

1. Make sure your `.env` file is listed in `.gitignore` and has never been committed to GitHub.

2. Push all changes to GitHub.

---

## Step 2 — Deploy the backend on Railway

1. Go to https://railway.app and sign up / log in with GitHub.

2. Click **New Project** → **Deploy from GitHub repo** → select `home-library-backend`.

   > **If no repositories appear** — Railway needs permission to access your GitHub repos. Go to [github.com/settings/installations](https://github.com/settings/installations) → find Railway → click **Configure** → under Repository access, select your repos → Save. Then go back to Railway and try again.

3. Railway will auto-detect it as a Node.js app and start deploying.

4. Once deployed, go to your service → **Variables** tab and add every variable below. Enter raw values only — do not wrap values in quotes.

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | Your Atlas connection string |
   | `DATABASE_NAME` | Your database name in Atlas |
   | `APP_NAME` | `HomeLibrary` |
   | `JWT_SECRET` | A random 32+ character string (see below) |
   | `EMAIL_USER` | Your Gmail address |
   | `EMAIL_PASS` | Your Gmail App Password (16 chars, no spaces) |
   | `CORS_ORIGIN` | Leave blank for now — fill in after Step 5 |
   | `NODE_ENV` | `production` |
   | `RATE_LIMIT_WINDOW_MS` | `900000` |
   | `RATE_LIMIT_MAX` | `300` |
   | `PORT` | `3000` |

   > **JWT_SECRET** must be at least 32 characters — the server will refuse to start if it is shorter. Generate one by running this in your terminal:
   > ```bash
   > node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   > ```

   > **EMAIL_PASS** must be a Gmail App Password, not your regular Gmail password. Go to Google Account → Security → 2-Step Verification → App passwords to generate one. Copy the 16-character password with no spaces.

5. Go to **Settings** → **Networking** → **Generate Domain** to get your public backend URL (e.g. `https://home-library-backend-production.up.railway.app`). Copy this — you need it in the next steps.

   > **Root Directory** — leave this blank in Railway Settings → Build. Do not set it to `/`.

   > **Spending limit** — go to Railway → Settings → Usage and set a spending limit of $5 to cap costs.

---

## Step 3 — Prepare your frontend repo

1. Make sure `.env.local` is listed in `.gitignore` and has never been committed to GitHub.

2. Create `.env.local` in your frontend root for local development:
   ```
   VITE_API_BASE=http://localhost:3000
   ```

3. Update `vercel.json` — replace `your-railway-domain.up.railway.app` in the `connect-src` directive with your actual Railway URL from Step 2.

4. Push all changes to GitHub.

---

## Step 4 — Deploy the frontend on Vercel

1. Go to https://vercel.com and sign up / log in with GitHub.

2. Click **Add New Project** → select `home-library-frontend`.

3. Vercel will auto-detect Vite. Leave all build settings as default.

4. Before clicking Deploy, go to **Environment Variables** and add:

   | Variable | Value |
   |---|---|
   | `VITE_API_BASE` | Your Railway URL from Step 2 — must include `https://` prefix |

   > The `https://` prefix is required. Without it, API calls will be treated as relative paths and appended to the Vercel domain instead of going to Railway.

5. Click **Deploy**. Vercel will give you a URL like `https://home-library-frontend.vercel.app`. Copy this — you need it for the next step.

---

## Step 5 — Set CORS_ORIGIN on Railway

Now that you have your Vercel URL, go back to Railway:

1. Open your backend service → **Variables** tab.
2. Set `CORS_ORIGIN` to your Vercel URL (raw value, no quotes):
   ```
   CORS_ORIGIN=https://home-library-frontend.vercel.app
   ```
3. Railway will automatically redeploy with the new variable.

---

## Step 6 — Seed users

Run the user seeding script against your production MongoDB:

```bash
MONGODB_URI="your-atlas-uri" DATABASE_NAME="homeLibrary" node add-users.js
```

Or if you have a `.env` file locally:

```bash
node add-users.js
```

---

## Step 7 — Verify everything works

1. Open your Vercel URL in a browser.
2. Log in with a seeded user — you should reach the Dashboard without errors.
3. Open browser DevTools → **Network** tab — confirm all API calls are going to your Railway URL over `https://` and returning 200 responses.
4. Check the response headers on any request — `Strict-Transport-Security` should be present.
5. Run through this checklist:
   - [ ] Login works
   - [ ] Books page loads
   - [ ] Add / edit / delete a book
   - [ ] Search by title or author works
   - [ ] Filter by house / genre / status works
   - [ ] Wrong password 5 times — account locks with a message
   - [ ] Forgot password OTP email arrives
   - [ ] Theme toggle saves and persists on refresh

---

## Ongoing deployments

After the initial setup, deploying any change is just:

```bash
git add .
git commit -m "describe your change"
git push
```

Both Vercel and Railway watch your GitHub repos and redeploy automatically within about a minute.

---

## Troubleshooting

**No repositories found in Railway**
Railway needs GitHub access. Go to [github.com/settings/installations](https://github.com/settings/installations) → Configure Railway → grant access to your repos → Save.

**404 on login after deploying frontend**
Check `VITE_API_BASE` in Vercel — it must include the `https://` prefix. Without it the URL becomes a relative path appended to your Vercel domain. Redeploy after fixing.

**CORS errors in the browser**
Railway stores env var values literally — make sure there are no quote marks around the value of `CORS_ORIGIN`. It should be the raw URL with no surrounding punctuation.

**500 on login**
Check Railway logs immediately after the failed attempt. Change `NODE_ENV` to `development` temporarily — the full error will appear in the browser Network tab under the failed request's Response. Common causes:
- `JWT_SECRET` missing or under 32 characters
- MongoDB connection string wrong after a password reset
- Mongoose pre-save hook issue

**API calls going to wrong URL**
Open DevTools → Network → click the failed request → check the full Request URL. If it shows `https://your-vercel-app.vercel.app/your-railway-domain...` then `VITE_API_BASE` is missing `https://`.

**OTP emails not arriving**
Railway blocks outbound SMTP (port 587). If you see `Email server error: Connection timeout` in Railway logs, switch to a transactional email service that sends over HTTPS such as Resend (resend.com — free tier, 3,000 emails/month). Replace the nodemailer block in `login.controller.js` with the Resend SDK.

**Railway shows server running but app doesn't work**
Check Railway logs for `Error connecting to MongoDB`. This usually means `MONGODB_URI` is wrong or your Atlas cluster's IP access list is blocking Railway. In Atlas → Network Access, add `0.0.0.0/0` to allow all IPs (acceptable for a personal app since MongoDB still requires username and password).

**Vercel build fails**
Make sure `VITE_API_BASE` is set in Vercel's environment variables before the build runs. Vite embeds these values at build time — changing them requires a redeploy.

---

## Environment Variable Reference

### Backend (Railway)

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `DATABASE_NAME` | Database name in Atlas |
| `APP_NAME` | Identifier shown in Atlas monitoring |
| `JWT_SECRET` | Secret used to sign JWT tokens — must be 32+ characters |
| `EMAIL_USER` | Gmail address used to send OTP emails |
| `EMAIL_PASS` | Gmail App Password (16 chars, no spaces) |
| `CORS_ORIGIN` | Your Vercel frontend URL — raw value, no quotes |
| `NODE_ENV` | `production` in production, `development` to expose error details |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in milliseconds (default: 900000) |
| `RATE_LIMIT_MAX` | Max requests per window for global limiter (default: 300) |
| `PORT` | Port the server listens on (Railway sets this automatically) |

### Frontend (Vercel)

| Variable | Description |
|---|---|
| `VITE_API_BASE` | Your Railway backend URL — must include `https://` prefix |