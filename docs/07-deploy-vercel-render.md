# Converge: Deploying to Vercel and Render (free tier)

A step-by-step checklist for putting Converge online at no cost.

```text
Browser ──HTTPS──> Vercel            (React frontend, static files)
   │
   └──HTTPS + WSS──> Render          (Go server, Docker web service)
                        │
                        └──────────> Render PostgreSQL (operation log)
```

Do the steps in this order. Each part needs a value from the part before it.

| Step | Where | You end up with |
|---|---|---|
| 1 | GitHub | The code pushed to `main` |
| 2 | Render | A database and its two connection URLs |
| 3 | Your computer | Tables created in that database |
| 4 | Render | The backend URL, `https://<backend>.onrender.com` |
| 5 | Vercel | The frontend URL, `https://<frontend>.vercel.app` |
| 6 | Render | The backend allowing the frontend URL |
| 7 | Browser | A working two-window test |

Button and field names on Vercel and Render change from time to time. If a
label differs slightly from what is written here, look for the nearest match.

---

## 1. Push the code to GitHub

Vercel and Render both deploy from the GitHub repository, so they only see
what is pushed. They deploy the `main` branch unless you choose another.

```bash
git status                # confirm what is about to be committed
git add -A
git commit -m "Shared text box"
git push origin <branch>
```

If the work is on a branch other than `main`, either merge it into `main`
first or select that branch when creating the services in steps 4 and 5.

Check before pushing:

- `apps/server/.env` is **not** in the commit. It is git-ignored; keep it so.
- `npm run typecheck`, `npm test` and `npm run build:web` pass locally.

## 2. Create the database on Render

1. Sign in at <https://dashboard.render.com> with your GitHub account.
2. **New → Postgres**.
3. Fill in:
   - **Name:** `converge-db`
   - **Database** and **User:** leave empty (Render generates them)
   - **Region:** pick one and remember it. The backend must use the same one.
   - **PostgreSQL version:** 17
   - **Plan:** Free
4. **Create Database** and wait until its status is *Available*.
5. Open the database page and find the **Connections** section. Copy both:
   - **Internal Database URL**: used by the backend in step 4.
   - **External Database URL**: used from your computer in step 3.

Treat both URLs as passwords. Do not paste them into the repository.

> **Free database expiry.** Render deletes a free PostgreSQL database some
> weeks after it is created (30 days at the time of writing; see
> <https://render.com/docs/free>). When that happens, all rooms are lost and
> you repeat steps 2, 3 and the `DATABASE_URL` part of step 4. If you want the
> demo to outlive that, create the database on Neon (<https://neon.com>)
> instead and use its connection string wherever this guide says
> "Database URL". Nothing else changes.

## 3. Create the tables

The server does not create its own tables. Run both migration files once,
in order, against the **External Database URL**.

`psql` is not installed on the development machine, so use the one inside the
PostgreSQL Docker image. From the repository root:

```bash
export PROD_DB='<External Database URL>'

docker run --rm -i postgres:17-alpine psql "$PROD_DB" -v ON_ERROR_STOP=1 \
  < apps/server/migrations/001_initial.sql

docker run --rm -i postgres:17-alpine psql "$PROD_DB" -v ON_ERROR_STOP=1 \
  < apps/server/migrations/002_set_text.sql
```

Verify:

```bash
docker run --rm -i postgres:17-alpine psql "$PROD_DB" -c '\dt'
```

Expected: two tables, `documents` and `operations`.

If the connection is refused with an SSL error, append `?sslmode=require` to
the URL. Both files are safe to run again.

Whenever a new file is added to `apps/server/migrations/`, run it here the
same way before deploying the backend that needs it.

## 4. Deploy the Go server on Render

1. **New → Web Service**, then connect the `Converge` GitHub repository.
   The first time, Render asks for permission to read the repository.
2. Fill in:

   | Field | Value |
   |---|---|
   | Name | `converge-server` (this becomes part of the URL) |
   | Language / Runtime | **Docker** |
   | Branch | `main` |
   | Region | the same region as the database |
   | Root Directory | `apps/server` |
   | Dockerfile Path | `./Dockerfile` |
   | Instance Type | **Free** |

3. Add environment variables:

   | Key | Value |
   | --- | --- |
   | `DATABASE_URL` | the **Internal Database URL** from step 2 |
   | `ALLOWED_ORIGINS` | `http://localhost:5173` for now; replaced in step 6 |

   Do **not** set `PORT`. Render provides it and the server reads it.

4. Under **Advanced**, set **Health Check Path** to `/health`.
5. **Create Web Service**. The first build takes a few minutes.
6. When the status is *Live*, copy the service URL shown at the top of the
   page, for example `https://converge-server.onrender.com`.

Verify from your computer:

```bash
curl https://<backend>.onrender.com/health     # {"status":"ok"}
curl https://<backend>.onrender.com/ready      # {"status":"ready"}
```

`/ready` also checks the database connection. If `/health` works and `/ready`
does not, `DATABASE_URL` is wrong or the database is in a different region
from the service (the internal URL only works within one region).

## 5. Deploy the frontend on Vercel

1. Sign in at <https://vercel.com> with your GitHub account.
2. **Add New → Project**, then import the `Converge` repository.
3. Fill in:

   | Field | Value |
   |---|---|
   | Root Directory | `apps/web` |
   | Framework Preset | Vite |
   | Build Command | `npm run build` (the default) |
   | Output Directory | `dist` (the default) |
   | Install Command | leave as the default |

   Keep **"Include files outside the root directory in the Build Step"**
   switched on (it is on by default). The frontend imports
   `packages/sync-core`, which lives outside `apps/web`.

4. Add environment variables. Use your backend URL from step 4, with no
   trailing slash:

   | Key | Value |
   |---|---|
   | `VITE_API_URL` | `https://<backend>.onrender.com` |
   | `VITE_WS_URL` | `wss://<backend>.onrender.com` |

   Note `https` for the first and `wss` for the second.

5. **Deploy**.
6. After the first deployment, open **Settings → Build and Deployment →
   Node.js Version** and choose **24.x** if it is not already selected. The
   project is developed on Node 24.
7. Copy the production URL, for example `https://converge.vercel.app`.

These two variables are read when the site is **built**, not when it runs.
If you change either of them later, you must redeploy: **Deployments → ⋯ →
Redeploy**.

`apps/web/vercel.json` already sends every path to `index.html`, so opening
or refreshing a `/rooms/<id>` link works.

## 6. Allow the frontend on the backend

The server refuses browser requests from any origin not on its list.

1. In Render, open `converge-server` → **Environment**.
2. Set `ALLOWED_ORIGINS` to your Vercel production URL:

   ```text
   https://<frontend>.vercel.app
   ```

   It must match exactly: `https://`, no trailing slash, no path. To allow
   more than one origin, separate them with commas and no spaces.

3. Save. Render redeploys the service by itself; wait for *Live*.

## 7. Test the deployment

1. Open `https://<frontend>.vercel.app`.
2. **Create a room**. You should land on `/rooms/<id>` with the text box and a
   green connection badge.
3. **Share room**, then open the copied link in a second window.
4. Type in one window. The text should appear in the other within a second.
5. In one window, open DevTools → Network → set throttling to **Offline**.
   Type something. Refresh the page; the text should still be there.
6. Set throttling back to **No throttling**. The other window should receive
   the text, and *Pending operations* should return to 0.

## 8. What to expect on the free tier

- **The backend sleeps.** Render stops a free service after about 15 minutes
  without traffic. The next visitor waits up to a minute while it starts.
  During that time the page shows *offline* or an error and retries by itself;
  **Refresh connection** retries at once. Typing still works and is sent once
  the server is awake.
- **Restarts drop connections.** Every deploy or restart closes open
  WebSockets. The frontend reconnects and catches up; no edits are lost.
- **One instance only.** Live updates are relayed inside one server process,
  so do not scale the backend beyond a single instance.
- **The database expires.** See the note in step 2.
- **Preview deployments cannot reach the backend.** Vercel gives each branch
  or pull request its own URL, which is not in `ALLOWED_ORIGINS`. Only the
  production URL works unless you add the preview URL to the list.

## 9. Deploying a change later

1. Push to `main`.
2. Vercel rebuilds the frontend and Render rebuilds the backend by themselves.
3. If the change added a migration file, run it as in step 3 **before** the
   push, so the new backend finds the tables it expects.

## 10. When something does not work

| What you see | Likely cause | Fix |
|---|---|---|
| "Could not create room", and the browser console shows a CORS error | `ALLOWED_ORIGINS` does not match the site's URL exactly | Step 6. Check for a trailing slash or `http` instead of `https` |
| Console shows requests going to `localhost:8080` | The `VITE_` variables were missing when the site was built | Set them in Vercel, then redeploy (step 5) |
| Console shows "Mixed Content" or the WebSocket fails immediately | `VITE_WS_URL` uses `ws://`, or `VITE_API_URL` uses `http://` | Use `wss://` and `https://`, then redeploy |
| First load hangs for up to a minute, then works | The free backend was asleep | Expected. See step 8 |
| Render deploy fails with "DATABASE_URL is required" | The variable is not set on the web service | Step 4.3 |
| Render logs show "ping PostgreSQL" errors | Wrong URL, or database and service are in different regions | Use the Internal URL and the same region |
| Typing gives "Could not submit operation" and Render logs mention `operations_kind_check` | Migration `002` was not run | Step 3 |
| Render logs say relation `documents` does not exist | Migration `001` was not run | Step 3 |
| Vercel build fails to find `@converge/sync-core` | Files outside the root directory are excluded | Step 5.3 |
| Refreshing `/rooms/<id>` gives a Vercel 404 | Root Directory is not `apps/web`, so `vercel.json` is not used | Step 5.3 |
| A new tab stays on "Loading local replica…" or asks you to close other tabs | An older tab of the site is still open | Close or reload the older tab |

Where to look:

- **Backend logs:** Render → `converge-server` → **Logs**.
- **Frontend build logs:** Vercel → project → **Deployments** → pick one.
- **Browser:** DevTools → **Console** and **Network**.
