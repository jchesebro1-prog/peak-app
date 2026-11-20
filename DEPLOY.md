# DEPLOY.md — putting Peak Backend on the internet

Written for Jeff (no coding). Three accounts get created once; after that,
every update is “push code → it deploys itself.” Budget: **$0/mo to start**
(free tiers), ~$20/mo later if usage grows (QUESTIONS.md #3).

You'll create, in order:
1. **GitHub** — where the code lives (deploys trigger from here)
2. **Neon** — the shared Postgres database
3. **Vercel** — the host that serves the app at a URL
4. **Google Cloud OAuth** — the “Sign in with Google” credentials

Have Claude Code nearby: after each step, paste back the value it asks for
and it will wire everything up and verify. Anything that says `TERMINAL ▸`
you can also just ask Claude Code to run.

---

## 1) GitHub (10 min)

1. Create an account at github.com (or sign in).
2. Create a **new private repository** named `peak-app`. Don't add any
   files it suggests (no README/gitignore — the project already has them).
3. Tell Claude Code the repository URL (looks like
   `https://github.com/YOURNAME/peak-app.git`). It will run:

   ```
   TERMINAL ▸ git remote add origin <that URL>
   TERMINAL ▸ git push -u origin main
   ```

   (GitHub will ask you to sign in in the browser the first time.)

## 2) Neon — the database (5 min)

1. Go to neon.tech → **Sign up with Google** (use the business Google
   account you want to own the infrastructure — QUESTIONS.md #4).
2. Create a project. Name: `peak-backend`. Region: **US East (Ohio)** or
   whatever's closest to Wisconsin.
3. On the project dashboard, find **Connection string**, choose the
   **Pooled** connection, and copy it (starts with `postgresql://`).
4. Keep it handy for the Vercel step — it becomes `DATABASE_URL`.

## 3) Vercel — the host (10 min)

1. Go to vercel.com → **Sign up with GitHub** (this links the two).
2. **Add New → Project → Import** the `peak-app` repository.
3. Before clicking Deploy, open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the Neon pooled connection string from step 2 |
   | `AUTH_SECRET` | a fresh random secret — ask Claude Code to generate one, or click “generate” if Vercel offers it |
   | `QUOTE_PDF_ORIGIN` | **required in production** — the app's own public URL, e.g. `https://quartzite-six.vercel.app` (Production scope only; see §7) |
   | `BLOB_READ_WRITE_TOKEN` | the Vercel Blob store's token (Storage → the Blob store) — datasheets, catalog photos, documents, drawings and quote PDFs live there |
   | `CRON_SECRET` | any long random string — it lets Vercel run the one daily job (`/api/drive/sync`: venue address stamp + ETC price sync) |

   (Google sign-in vars come in step 4 — the app deploys fine without them,
   it just shows “Google sign-in isn't configured yet.”)
4. Click **Deploy**. When it finishes you get a URL like
   `https://peak-app-xxxx.vercel.app`. **That's the live app.**
5. One-time: load the starter data (team roster + settings). Tell Claude
   Code the deployment succeeded and it will run:

   ```
   TERMINAL ▸ DATABASE_URL="<neon string>" npm run db:seed
   ```

## 4) Google sign-in credentials (10 min)

1. Go to console.cloud.google.com (same Google account) → create a
   project named `Peak Backend`.
2. **APIs & Services → OAuth consent screen**:
   - User type: **External** is fine (Internal if you have Google
     Workspace and want company-only at the Google level).
   - App name `Peak Backend`, your email for the contact fields. Save
     through the steps (no scopes to add).
   - If it offers a “Publish app” / “In production” button, click it —
     otherwise sign-ins expire weekly while in “Testing.”
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**, name `peak-app`.
   - **Authorized redirect URIs** — add exactly (replace with your real
     Vercel URL):
     - `https://YOUR-APP.vercel.app/api/auth/callback/google`
     - `http://localhost:3000/api/auth/callback/google` (for local testing)
4. Copy the **Client ID** and **Client secret** into Vercel → your project
   → **Settings → Environment Variables**:

   | Name | Value |
   | --- | --- |
   | `AUTH_GOOGLE_ID` | the Client ID (ends in `.apps.googleusercontent.com`) |
   | `AUTH_GOOGLE_SECRET` | the Client secret |

5. **Deployments → ⋯ on the latest → Redeploy** so the new variables load.
6. Sign in at your URL with Google. **Who gets in:** anyone whose email is
   on Settings → Team and active. Your row is pre-seeded with
   `jchesebro1@gmail.com`; add teammates' emails (their real sign-in
   addresses) in Settings → Team before inviting them.

## 5) After the 2026-11-20 shrink — clean-up

The app was cut down to CRM, the Estimator, Catalog, Quotes hub, Reports,
Settings and Import / Export (see `docs/removal-log.md`). The Inbox, the Gmail
connection, Google Calendar / Tasks / Drive access, the Assist (AI) layer, the
customer portal and the Design tab are gone. Nothing of theirs needs configuring
any more. If this deployment had them on, clean up:

- Vercel env: delete `GMAIL_ENABLED`, `GMAIL_REDIRECT_BASE`, `ANTHROPIC_API_KEY`,
  every `ASSIST_*` variable and `INBOX_ORG_DISABLED`. **Keep `CRON_SECRET`** — the
  daily `/api/drive/sync` cron (venue address stamp + ETC price sync) still uses it —
  and keep `AUTH_SECRET` unchanged (it decrypts the stored MyETC key).
- Google Cloud: remove the `/api/gmail/callback` redirect URI and the Gmail,
  Calendar, Tasks and Drive scopes from the OAuth consent screen. Google
  sign-in (section 4) is unchanged.
- Revoke what is still stored encrypted in the database and no longer used: each
  person's Google connection (Google Account → Security → Third-party access),
  the Krisp API keys, and the Anthropic key.

## 6) Native apps after the shrink

In-app recording and the Krisp meeting matcher were removed with the Inbox, and
offline capture now carries trade-show booth captures only. The recorder,
foreground-service, local-notification, filesystem and preferences plugins are
gone from `package.json` and from the native plugin lists; run `npx cap sync`
and rebuild both native apps before the next release (the microphone /
notification permission strings can then be dropped). Make sure every phone
and tablet has synced before the release goes out — see `docs/removal-log.md`.

The web app's offline cache was renamed (`quartzite-shell-v3` in
`public/sw.js`), so a browser drops its cached copies of removed screens the
first time it loads the new release.

The build no longer seeds the Spec Library: `npm run build` is
`node scripts/migrate.mjs && next build`.

## 7) Saved quote PDFs (#222)

A saved system estimate renders its customer document to a PDF after the
response (headless Chromium, `@sparticuz/chromium` on Vercel) and keeps it in
Blob. A draft that saves itself as you type renders on the way into Customer
review or Send & track.

- **`QUOTE_PDF_ORIGIN` — required in production.** The address the headless
  browser prints from, e.g. `https://quartzite-six.vercel.app` (scheme + host,
  no path). Set it in the **Production** scope. Without it, Vercel and local
  dev fall back to the request's own `Host`/`X-Forwarded-Host` (Vercel's
  router picked this project by that host); a production server anywhere
  else refuses to render and every PDF reads "failed — Set QUOTE_PDF_ORIGIN",
  because no proxy there vouches for those headers. Pinning it means the
  signed print link is never built on an address a request made up.
  Leave it unset for **Preview** so each preview prints from its own URL.
- **`BLOB_READ_WRITE_TOKEN`** — required for PDFs on Vercel. Without it the
  save still succeeds, and the PDF reads "failed" with the reason.
- **`VERCEL_AUTOMATION_BYPASS_SECRET`** — only if preview deployments sit
  behind Deployment Protection, so the headless browser can reach the print
  page.
- Pages whose saves render a PDF set `maxDuration = 120` (the render runs in
  `after()` inside that budget, after a 4 s wait that lets a burst of saves
  settle so only the latest one launches Chrome).

## 8) App icon (Batch 6, #356)

- **App icon (#67).** The web app's icons — the favicon, the iPhone
  home-screen icon and the installed-app (PWA) icons — are drawn from the
  logo in **Settings → Branding** (`/icons/app/*.png`, `src/app/manifest.ts`).
  Upload a new logo and the web icons change on the next page load; a phone
  that already installed the web app may keep the old icon until it is
  removed and added to the home screen again. **The native iOS and Android
  apps have their own icons, built into the app**: they do not follow the
  Branding logo. To change them, replace the icon sets in
  `ios/App/App/Assets.xcassets/AppIcon.appiconset` and
  `android/app/src/main/res/mipmap-*`, run `npx cap sync`, then rebuild and
  reinstall both apps.

## Afterwards

- **Updates:** every `git push` to `main` redeploys automatically
  (migrations run during the build).
- **Never roll back past the markup change (#367)** — older code would read
  the converted settings and quotes as margins. Roll forward with a fix. (The
  2026-11-20 shrink changed no table and converted no data, so rolling back
  across it is possible; see `docs/removal-log.md` for what a rollback would
  bring back.)
- **Never use Vercel's Instant Rollback to a deploy older than migration
  0030 (estimate numbers, #223).** Code from before it writes quote/lead
  documents with no `estNo`, and the next document created after that
  rollback re-numbers from the counter as if those records never had one —
  it does not restore their old numbers. If a bad deploy needs undoing, roll
  forward with a fix instead of rolling back past 0030.
- **Custom domain** (optional, QUESTIONS.md #2): Vercel → Settings →
  Domains → add e.g. `app.peaksystemsgroup.com`, follow its DNS
  instructions, then add the matching
  `https://app.peaksystemsgroup.com/api/auth/callback/google` redirect URI
  in Google Cloud.
- **Backups:** Neon keeps point-in-time restore on all plans; scheduled
  exports get set up in the go-live phase (QUESTIONS.md #31).
- **Never set** `AUTH_DEV_LOGIN=true` in Vercel — that's the local
  passwordless dev sign-in.

## If something breaks

Copy whatever error you see (Vercel build log, browser message) and paste
it to Claude Code — it can read these files and fix the code, or tell you
exactly which dashboard field to change.
