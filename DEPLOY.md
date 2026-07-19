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

## 5) Gmail integration (optional — do this after sign-in works)

The app runs fine without this: the Inbox stays in *simulated* mode (sends
are logged, "Get mail" drops demo messages). Turn on real Gmail only when
you want the Inbox to send and receive actual email. Uses the **same Google
Cloud project** from step 4.

1. **Enable the Gmail API:** console.cloud.google.com → **APIs & Services →
   Library** → search **Gmail API** → **Enable**.
2. **OAuth consent screen → Data access → Add or remove scopes**, add these
   three, then Save:
   - `.../auth/gmail.send`
   - `.../auth/gmail.readonly`
   - `.../auth/userinfo.email`

   (These are "sensitive/restricted" scopes. While your app is in **Testing**
   they work immediately for accounts you add under **Audience → Test users**;
   Google only requires verification once you **Publish** to the public. For a
   handful of company mailboxes, staying in Testing with those mailboxes as
   test users is fine.)
3. **APIs & Services → Credentials → your OAuth client → Authorized redirect
   URIs**, add (replace with your real domain):
   - `https://YOUR-APP.vercel.app/api/gmail/callback`
   - `http://localhost:3000/api/gmail/callback` (for local testing)
4. **Vercel → Settings → Environment Variables**, add:

   | Name | Value |
   | --- | --- |
   | `GMAIL_ENABLED` | `true` |

   Redeploy. (`AUTH_SECRET`, already set, also encrypts the stored mailbox
   tokens — nothing else to add.)
5. In the app: **Settings → Mailboxes** now shows **Gmail enabled**. Click
   **Connect** on your own inbox and on each shared box (Sales / Installs /
   Info), signing in with that mailbox's Google account and granting access.
6. In the **Inbox**, click **Send / Receive** once — it imports the last 90
   days of that mailbox's history, then keeps pulling new mail on each click.
   Emails sent from the app now appear in the mailbox's Gmail **Sent** too.

**Who can connect what:** you (admin) can connect any box from Settings.
Each teammate can connect their own inbox from the same **Connect** link.
Shared boxes are plain Gmail accounts you (or the team) hold the password to
— connect each one once.

To stop using Gmail, set `GMAIL_ENABLED` blank (or **Disconnect** a mailbox
in Settings) — the app falls back to simulated mode; no data is lost.

**Server-side sync (D74) — the inbox stays current with no tab open.** Three
triggers, all safe together (each funnels into the same per-mailbox claim
throttle):

- Opening the Inbox syncs automatically (built in, nothing to configure).
- Any long-running server (`next start`, the LAN box, `next dev`) starts a
  built-in sync timer at boot — nothing to configure.
- On Vercel (serverless — no long-running process), add ONE more env var:

  | Name | Value |
  | --- | --- |
  | `CRON_SECRET` | any long random string (`openssl rand -hex 32`) |

  The repo's `vercel.json` schedules `/api/gmail/sync` every 5 minutes and
  Vercel sends the secret automatically. **Note:** minute-level cron needs a
  Vercel Pro plan; on the free Hobby plan crons run at most daily — either
  rely on the open-tab sync, or point a free external pinger (e.g.
  cron-job.org) at `https://YOUR-APP.vercel.app/api/gmail/sync` with header
  `Authorization: Bearer <CRON_SECRET>` every few minutes.

**Two-way archive (D74):** archiving in Peak archives in Gmail and vice versa.
Mailboxes connected before this feature need a one-time **Reconnect** in
Settings → Mailboxes (the row says "reconnect to enable two-way archive") to
grant the extra permission.

## Afterwards

- **Updates:** every `git push` to `main` redeploys automatically
  (migrations run during the build).
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
