# Deployment Guide — Home Library App

## Overview

| Service | Platform | Cost |
|---|---|---|
| Frontend | Vercel | Free |
| Backend | Railway | ~$0–2/month |
| Database | MongoDB Atlas | Free tier (existing) |

---

## Step 1 — Prepare your backend repo

1. Make sure your `.env` file is listed in `.gitignore` and has never been committed to GitHub.

2. Push all changes to GitHub.

---

## Step 2 — Deploy the backend on Railway

1. Go to https://railway.app and sign up / log in with GitHub.

2. Click **New Project** → **Deploy from GitHub repo** → select `home-library-backend`.

3. Railway will auto-detect it as a Node.js app and start deploying.

4. Once deployed, go to your service → **Variables** tab and add every variable below:

   | Variable | Value |
   |---|---|
   | `MONGODB_URI` | Your Atlas connection string |
   | `DATABASE_NAME` | Your database name in Atlas |
   | `APP_NAME` | `home-library` |
   | `JWT_SECRET` | A long random secret string |
   | `EMAIL_USER` | Your Gmail address |
   | `EMAIL_PASS` | Your Gmail App Password |
   | `CORS_ORIGIN` | Leave blank for now — fill in after Step 3 |
   | `NODE_ENV` | `production` |
   | `RATE_LIMIT_WINDOW_MS` | `900000` |
   | `RATE_LIMIT_MAX` | `300` |
   | `PORT` | `3000` |

   > **JWT_SECRET** should be a long, random string. You can generate one by running `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` in your terminal.

   > **EMAIL_PASS** must be a Gmail App Password, not your regular Gmail password. Go to Google Account → Security → 2-Step Verification → App passwords to generate one.

5. Go to **Settings** → **Networking** → **Generate Domain**.
   Copy the URL (e.g. `https://home-library-backend.railway.app`).
   You will need this in the next step.

---

## Step 3 — Prepare your frontend repo

1. Make sure `.env.local` is listed in `.gitignore` and has never been committed to GitHub.

2. Create `.env.local` in your frontend root for local development:
   ```
   VITE_API_BASE=http://localhost:3000
   ```

3. Push all changes to GitHub.

---

## Step 4 — Deploy the frontend on Vercel

1. Go to https://vercel.com and sign up / log in with GitHub.

2. Click **Add New Project** → select `home-library-frontend`.

3. Vercel will auto-detect Vite. Leave all build settings as default.

4. Before clicking Deploy, go to **Environment Variables** and add:

   | Variable | Value |
   |---|---|
   | `VITE_API_BASE` | Your Railway URL from Step 2, e.g. `https://home-library-backend.railway.app` |

5. Click **Deploy**. Vercel will give you a URL like `https://home-library-frontend.vercel.app`.
   Copy this URL — you need it for the next step.

---

## Step 5 — Set CORS_ORIGIN on Railway

Now that you have your Vercel URL, go back to Railway:

1. Open your backend service → **Variables** tab.
2. Set `CORS_ORIGIN` to your Vercel URL:
   ```
   CORS_ORIGIN=https://home-library-frontend.vercel.app
   ```
3. Railway will automatically redeploy with the new variable.

---

## Step 6 — Verify everything works

1. Open your Vercel URL in a browser.
2. Log in — you should reach the Dashboard without errors.
3. Open browser DevTools → **Network** tab — confirm API calls are going to your Railway URL and returning 200 responses.
4. Test the following to confirm everything is wired up correctly:
   - [ ] Login works
   - [ ] Books page loads
   - [ ] Add / edit / delete a book
   - [ ] Search works
   - [ ] Theme toggle saves and persists on refresh
   - [ ] Forgot password OTP email arrives

---

## Ongoing deployments

After the initial setup, deploying any change is just three commands:

```bash
git add .
git commit -m "describe your change"
git push
```

Both Vercel and Railway watch your GitHub repos and redeploy automatically within about a minute. You never need to touch their dashboards again for routine updates.

---

## Troubleshooting

**CORS errors in the browser**
Make sure `CORS_ORIGIN` on Railway exactly matches your Vercel URL — no trailing slash, correct protocol (`https://`).

**API calls returning 401 after deploy**
Check that `JWT_SECRET` is set correctly in Railway. If it was changed after users logged in, existing tokens will be invalid and users will need to log in again.

**OTP emails not arriving**
Check Railway logs for `Email error:` on startup. The most common cause is an incorrect `EMAIL_PASS` — make sure you're using a Gmail App Password, not your regular password.

**Railway shows server running but the app doesn't work**
Check Railway logs for `Error connecting to MongoDB`. This means the `MONGODB_URI` or `DATABASE_NAME` is incorrect, or your Atlas cluster's IP access list is blocking Railway. In Atlas, go to **Network Access** and add `0.0.0.0/0` to allow all IPs (acceptable for a personal app).

**Vercel build fails**
Make sure `VITE_API_BASE` is set in Vercel's environment variables before the build runs. Vite embeds these values at build time — they cannot be changed without redeploying.

---

## Environment Variable Reference

### Backend (Railway)

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `DATABASE_NAME` | Database name in Atlas |
| `APP_NAME` | Identifier shown in Atlas monitoring |
| `JWT_SECRET` | Secret used to sign JWT tokens — keep this private |
| `EMAIL_USER` | Gmail address used to send OTP emails |
| `EMAIL_PASS` | Gmail App Password |
| `CORS_ORIGIN` | Your Vercel frontend URL |
| `NODE_ENV` | Set to `production` on Railway |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window in milliseconds (default: 900000) |
| `RATE_LIMIT_MAX` | Max requests per window (default: 300) |
| `PORT` | Port the server listens on (Railway sets this automatically) |

### Frontend (Vercel)

| Variable | Description |
|---|---|
| `VITE_API_BASE` | Your Railway backend URL |