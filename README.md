# Page Tracker

Shows every Facebook profile you connect, all of its pages, and how many posts each page made
today, yesterday, in the last 7 / 30 days, the previous week (Mon–Sun) and the previous month.
Each page refreshes every 2 hours; **Sync now** refreshes everything immediately.
New/removed pages on a profile are picked up automatically (within ~1 hour).

Runs in two places from the same code:

| | Local (your PC) | Vercel (shareable link) |
|---|---|---|
| Entry point | `server.js` | `api/*.js` + `public/` |
| Settings | `.env` file | Vercel → Settings → Environment Variables |
| Storage | `data/` folder | Upstash Redis (Vercel Storage) |
| Auto-refresh | built-in timer | cron-job.org calling `/api/sync?key=SYNC_SECRET` |

## Settings

| Name | Required | Meaning |
|---|---|---|
| `TOKEN`, `TOKEN_<NAME>` … | yes | One long-lived Facebook user token per profile. Any key starting with `TOKEN` counts. |
| `APP_ID`, `APP_SECRET` | recommended | Meta app credentials – used to show token expiry dates |
| `DASHBOARD_PASSWORD` | on Vercel | Password for the dashboard. Not set ⇒ no login (fine locally) |
| `SYNC_SECRET` | on Vercel | Secret key for the cron URL |
| `SYNC_INTERVAL_HOURS` | no | Default `2` |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | on Vercel | Added automatically when the Upstash database is connected |
| `PORT` | no | Local only, default `3000` |

Local `.env` example (both `KEY=value` and `Key : value` work):

```
token: "EAA...profile 1..."
token_clara: "EAA...profile 2..."
App Id : 1234567890
App Secret : abcdef...
```

## Run locally

Double-click **`start.bat`** → opens <http://localhost:3000>. Keep the window open.
Auto-start with Windows: right-click **`add-to-startup.ps1`** → *Run with PowerShell* (once).

## Deploy to Vercel

1. `npx vercel link` → `npx vercel deploy --prod`
2. Vercel → project → **Storage** → create **Upstash for Redis** (Free) → connect to the project
3. Add the environment variables above (Production), then redeploy
4. cron-job.org → new job → URL `https://<your-app>.vercel.app/api/sync?key=<SYNC_SECRET>`,
   every 15 minutes (each call only refreshes pages older than 2 h, so it scales to 500+ pages)

Adding a profile on Vercel: add `TOKEN_<NAME>` in Environment Variables → Redeploy → **Sync now**.

## Getting a long-lived token for a profile

1. The profile needs a role on the Meta app (Admin/Developer/Tester) while the app is in Development mode.
2. Graph API Explorer → select the app → logged in as that profile → **Get User Access Token** with
   `pages_show_list, pages_read_engagement, pages_read_user_content, business_management, read_insights`.
   When asked, choose **all current and future Pages** (otherwise new pages won't be detected).
3. Access Token Debugger → **Extend Access Token** (~60 days).

Page tokens derived from it don't expire and are cached, so if a profile token expires its known
pages keep updating; only page list changes stop until a fresh token is added. The dashboard warns
10 days before a token expires.

## Security

- Tokens never reach the browser; the dashboard only receives page data.
- Vercel: all data endpoints require the password (signed HttpOnly cookie, 30 days); sync requires
  login or `SYNC_SECRET`. Locally the server listens on localhost only.
- Never commit `.env`, `data/`, `cron-url.txt` (already in `.gitignore`).
