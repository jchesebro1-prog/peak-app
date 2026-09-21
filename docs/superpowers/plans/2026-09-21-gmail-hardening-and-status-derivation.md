# Gmail Hardening + Status Derivation Implementation Plan (PUNCHLIST #95, #96 §6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production Gmail connect flow self-healing and visible, fix the Inbox address fallback, and replace the per-message status stamp with a derived rule so a reply clears "Waiting on us".

**Architecture:** Four independent, small changes plus docs. Pure helpers (`deriveStatus`, `safeCallbackPath`) live in `src/lib/` and are covered by `scripts/test-review-and-spec.ts`; the call sites are one-line swaps. No schema changes.

**Tech Stack:** Next.js 16 App Router, Auth.js v5, Drizzle doc-store (`patchDoc`), `tsx` spec harness (`npm run test:specs`).

## Global Constraints

- Node lives at `~/.local/node/bin` — `export PATH=$HOME/.local/node/bin:$PATH` before any `npx`/`npm`.
- **Never run two PGlite processes at once.** `npm run test:specs` is pure (no DB). `npm run test:smoke` boots its own throwaway DB — never run it while `next dev` or a `tsx` script is alive (`ps aux | grep -E 'tsx|next'` first).
- Timestamps are epoch-ms numbers. Keep prototype field names.
- No emoji in UI copy (PUNCHLIST #3).
- Commit each task separately; `git add` only the files named in the task (28-dirty-file trap, see venue-assessments HANDOFF).
- Spec test helper: `ok(condition, message)` in `scripts/test-review-and-spec.ts`; add new blocks **before** the `asyncChecks()` call at the bottom, in the synchronous section (the file's existing pattern).

---

### Task 1: `deriveStatus()` — status from the latest message

**Files:**
- Modify: `src/lib/stores/comms.ts` (add export after `statusFromDirection`, ~line 122)
- Modify: `src/lib/gmail/bridge.ts:157-159` (remove `threadStatusFor`), `:196-210` (existing-thread patch), `:230` (new-thread status)
- Modify: `src/lib/stores/comms.ts:1167` (`addMessage` status line)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces: `export function deriveStatus(t: Pick<CommThread, "status" | "messages">): ThreadStatus`

- [ ] **Step 1: Write the failing spec tests**

The harness already imports from comms.ts (`import { participantsFor } from "@/lib/stores/comms";`, ~line 1464). Change that line to `import { participantsFor, deriveStatus } from "@/lib/stores/comms";` and add this block directly after the `participantsFor` checks that follow it (synchronous section):

```ts
/* ---- #96 §6 — thread status derives from the latest message ---- */
{
  const m = (direction: "in" | "out", at: number) => ({
    id: "m" + at, at, direction, channel: "email" as const, author: "", body: "",
  });
  // reply imported BEFORE the original (Gmail lists newest first) still ends "waiting_them"
  ok(
    deriveStatus({ status: "waiting_us", messages: [m("out", 200), m("in", 100)] }) === "waiting_them",
    "deriveStatus: latest-by-timestamp wins regardless of array order"
  );
  ok(
    deriveStatus({ status: "waiting_them", messages: [m("out", 100), m("in", 200)] }) === "waiting_us",
    "deriveStatus: newest inbound → waiting_us"
  );
  ok(
    deriveStatus({ status: "draft", messages: [m("in", 100)] }) === "draft",
    "deriveStatus: never overrides a draft"
  );
  ok(
    deriveStatus({ status: "closed", messages: [m("in", 100), m("out", 200)] }) === "closed",
    "deriveStatus: closed stays closed after an outbound"
  );
  ok(
    deriveStatus({ status: "closed", messages: [m("out", 100), m("in", 200)] }) === "waiting_us",
    "deriveStatus: closed reopens on a new inbound"
  );
  ok(
    deriveStatus({ status: "waiting_us", messages: [] }) === "waiting_us",
    "deriveStatus: no messages → status unchanged"
  );
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsx scripts/test-review-and-spec.ts 2>&1 | tail -5`
Expected: tsx fails to compile/import — `deriveStatus` is not exported (exit 1).

- [ ] **Step 3: Implement `deriveStatus`**

In `src/lib/stores/comms.ts`, directly after `statusFromDirection` (~line 122):

```ts
/**
 * Thread status DERIVED from the newest message (#96 §6). Replaces the
 * per-message stamp that let an older inbound overwrite a newer reply when
 * Gmail's newest-first listing recorded them out of order.
 *   - draft is never touched by an import
 *   - closed stays closed until a NEW inbound arrives
 *   - otherwise waiting_us if the newest message is inbound, else waiting_them
 */
export function deriveStatus(
  t: Pick<CommThread, "status" | "messages">
): ThreadStatus {
  const msgs = t.messages || [];
  if (!msgs.length) return t.status;
  let latest = msgs[0];
  for (const m of msgs) if ((m.at || 0) > (latest.at || 0)) latest = m;
  if (t.status === "draft") return "draft";
  if (t.status === "closed" && latest.direction === "out") return "closed";
  return statusFromDirection(latest.direction);
}
```

- [ ] **Step 4: Use it at the three write sites**

`src/lib/gmail/bridge.ts` — delete the `threadStatusFor` function (lines 157–159) and its `Direction` import if now unused. In the existing-thread branch replace

```ts
      d.status = threadStatusFor(dir);
```
with
```ts
      d.messages.sort((a, b) => (a.at || 0) - (b.at || 0));
      d.status = deriveStatus(d);
```
In the new-thread record replace `status: threadStatusFor(dir),` with `status: statusFromDirection(dir),` (a single message — the derivation is trivially the direction). Add `deriveStatus, statusFromDirection` to the existing `@/lib/stores/comms` import in bridge.ts.

`src/lib/stores/comms.ts` `addMessage` (~line 1167): replace

```ts
    t.status = m.status || statusFromDirection(dir);
```
with
```ts
    t.status = m.status || deriveStatus(t);
```
(`t.messages` was concatenated on the line above, and app-side messages are appended in time order.)

- [ ] **Step 5: Run the spec suite and typecheck**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -E 'deriveStatus|ALL PASSED|FAILED'`
Expected: six `PASS deriveStatus…` lines and `ALL PASSED`.
Run: `npx tsc --noEmit -p . 2>&1 | tail -3` — Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/comms.ts src/lib/gmail/bridge.ts scripts/test-review-and-spec.ts
git commit -m "fix(inbox): derive thread status from the newest message, not the last imported one (#96 §6)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: One-off re-derive on sync so existing threads self-correct

**Files:**
- Modify: `src/lib/gmail/bridge.ts` — `syncMailbox` (~line 488)
- Test: `scripts/test-review-and-spec.ts` (pure helper only)

**Interfaces:**
- Consumes: `deriveStatus` from Task 1.
- Produces: `async function rederiveStatuses(key: MailboxKey): Promise<number>` (module-private in bridge.ts; returns the count of threads changed).

- [ ] **Step 1: Add the pass**

In `src/lib/gmail/bridge.ts`, after `reconcileInboxState` (before the `/* ---- label cache` comment):

```ts
/* ---- status re-derive (#96 §6) ------------------------------------------- */

/** Recompute every bridged thread's status from its newest message. Cheap
 *  (one listDocs + patch only on change) and idempotent, so it runs on every
 *  sync: it is what corrects threads stamped by the old per-message rule. */
async function rederiveStatuses(key: MailboxKey): Promise<number> {
  const all = await listDocs<CommThread>("comms");
  let changed = 0;
  for (const t of all) {
    if (t.gmailAccountKey !== key) continue;
    const next = deriveStatus(t);
    if (next === t.status) continue;
    await patchDoc<CommThread>("comms", t.id, (d) => {
      d.status = deriveStatus(d);
    });
    changed++;
  }
  return changed;
}
```

In `syncMailbox`, after the `reconcileInboxState` try/catch:

```ts
  try {
    flips += await rederiveStatuses(key);
  } catch (err) {
    console.error("[gmail] status re-derive failed for", key, err);
  }
```

(`flips` is already `let`; a changed status counts as "something changed" so callers refresh.)

- [ ] **Step 2: Typecheck**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit -p . 2>&1 | tail -3` — Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/gmail/bridge.ts
git commit -m "fix(inbox): re-derive bridged thread statuses on every sync so mis-stamped threads self-correct

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `/login` honours a same-origin `callbackUrl`

**Files:**
- Create: `src/lib/auth-redirect.ts`
- Modify: `src/app/login/page.tsx` (read `searchParams.callbackUrl`, pass `next`)
- Modify: `src/app/login/login-buttons.tsx:26,84` (use `next`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces: `export function safeCallbackPath(raw: string | undefined, origin: string): string` — returns a same-origin path+query starting with `/` (never `//`), or `/`.

- [ ] **Step 1: Write the failing spec tests** (synchronous section, before `asyncChecks()`; this helper is pure and can be imported at the top of the file with the other static imports: `import { safeCallbackPath } from "@/lib/auth-redirect";`)

```ts
/* ---- #95 — login honours a same-origin callbackUrl ---- */
const O = "https://quartzite-six.vercel.app";
ok(safeCallbackPath(undefined, O) === "/", "safeCallbackPath: missing → /");
ok(safeCallbackPath("", O) === "/", "safeCallbackPath: empty → /");
ok(
  safeCallbackPath(O + "/api/gmail/callback?code=x&state=y", O) === "/api/gmail/callback?code=x&state=y",
  "safeCallbackPath: same-origin absolute → path+query"
);
ok(
  safeCallbackPath("/settings?gmail=connected", O) === "/settings?gmail=connected",
  "safeCallbackPath: relative path kept"
);
ok(safeCallbackPath("https://evil.example/steal", O) === "/", "safeCallbackPath: foreign origin → /");
ok(safeCallbackPath("//evil.example/steal", O) === "/", "safeCallbackPath: protocol-relative → /");
ok(safeCallbackPath("/login?callbackUrl=/x", O) === "/", "safeCallbackPath: never loops back to /login");
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5`
Expected: module-not-found error for `@/lib/auth-redirect`.

- [ ] **Step 3: Implement the helper**

`src/lib/auth-redirect.ts`:

```ts
/**
 * Where to land after sign-in (#95). The OAuth callback routes bounce an
 * unauthenticated request to /login?callbackUrl=<their own URL>; honouring it
 * lets a Gmail connect that lost its cookie mid-hop still complete. Only a
 * same-origin path is ever returned — anything else is the app root — so this
 * cannot become an open redirect. /login itself is refused to avoid a loop.
 */
export function safeCallbackPath(raw: string | undefined, origin: string): string {
  if (!raw) return "/";
  let u: URL;
  try {
    u = new URL(raw, origin);
  } catch {
    return "/";
  }
  if (u.origin !== new URL(origin).origin) return "/";
  if (u.pathname.startsWith("//")) return "/";
  if (u.pathname === "/login") return "/";
  return u.pathname + u.search;
}
```

- [ ] **Step 4: Thread it through the page and buttons**

`src/app/login/page.tsx`:

```ts
import { headers } from "next/headers";
import { safeCallbackPath } from "@/lib/auth-redirect";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  const params = await searchParams;
  const h = await headers();
  const origin =
    (h.get("x-forwarded-proto") || "https") + "://" + (h.get("x-forwarded-host") || h.get("host") || "localhost:3000");
  const next = safeCallbackPath(
    Array.isArray(params.callbackUrl) ? params.callbackUrl[0] : params.callbackUrl,
    origin
  );
  if (session?.user?.active) redirect(next);
  …
          <LoginButtons
            google={googleConfigured()}
            devLogin={devLogin}
            roster={roster}
            next={next}
          />
```

`src/app/login/login-buttons.tsx`: add `next: string` to the props type, and replace both `callbackUrl: window.location.origin + "/"` with `callbackUrl: window.location.origin + next`. (Auth.js's `redirect` callback in `src/auth.ts` returns any `/`-prefixed URL as-is, so the path survives.)

- [ ] **Step 5: Run tests + typecheck**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -E 'safeCallbackPath|ALL PASSED|FAILED'`
Expected: seven PASS lines + `ALL PASSED`. Then `npx tsc --noEmit -p . | tail -3` → empty.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth-redirect.ts src/app/login/page.tsx src/app/login/login-buttons.tsx scripts/test-review-and-spec.ts
git commit -m "fix(auth): /login honours a same-origin callbackUrl so an OAuth hop that lost its cookie can finish (#95)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Inbox address fallback order

**Files:**
- Modify: `src/app/(app)/inbox/page.tsx:157-169`

- [ ] **Step 1: Swap the order and fix the comment**

Replace the comment + expression at lines 157–169 with:

```ts
  // Whose mailbox this is, in order of how much we actually know:
  //   1. the address Google authorized for this user's Gmail connection,
  //   2. their roster (company) email — what they sign in as since D126,
  //   3. the alternate Google account on their roster row (googleEmail is a
  //      sign-in fallback, e.g. a personal Gmail — never the mailbox).
  // Never the name+company-domain guess comms.ts falls back to — that invents
  // an address for anyone who isn't first-initial+lastname@company.
  const myKey = personalKey(user.id);
  const [connection, myRow] = await Promise.all([
    getConnectionInfo(myKey),
    getUser(user.id),
  ]);
  const myAddress =
    connection?.address || myRow?.email || myRow?.googleEmail || user.email;
```

- [ ] **Step 2: Typecheck and commit**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsc --noEmit -p . | tail -3` → empty.

```bash
git add "src/app/(app)/inbox/page.tsx"
git commit -m "fix(inbox): mailbox address falls back to the roster email before the alternate Google account (#95)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Settings shows the redirect URI and warns on a host mismatch

**Files:**
- Modify: `src/lib/gmail/config.ts` (add `redirectHostMismatch()` after `callbackUrl()`)
- Modify: `src/app/(app)/settings/page.tsx:34-35,130`
- Modify: `src/app/(app)/settings/settings-client.tsx:145,1019-1055`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces: `export function redirectHostMismatch(env?: { GMAIL_REDIRECT_BASE?: string; AUTH_URL?: string; NEXTAUTH_URL?: string }): string | null` — returns a human warning when both an override and an auth URL are set and their hosts differ, else `null`.
- Settings `gmail` prop gains `redirectUri: string` and `redirectWarning: string | null`.

- [ ] **Step 1: Write the failing spec tests** (synchronous section; add `import { redirectHostMismatch } from "@/lib/gmail/config";` — config.ts has no DB imports, safe for the pure harness)

```ts
/* ---- #95 — Settings warns when GMAIL_REDIRECT_BASE drifts from AUTH_URL ---- */
ok(redirectHostMismatch({}) === null, "redirectHostMismatch: nothing set → null");
ok(
  redirectHostMismatch({ AUTH_URL: "https://quartzite-six.vercel.app" }) === null,
  "redirectHostMismatch: no override → null"
);
ok(
  redirectHostMismatch({
    GMAIL_REDIRECT_BASE: "https://quartzite-six.vercel.app",
    AUTH_URL: "https://quartzite-six.vercel.app/",
  }) === null,
  "redirectHostMismatch: same host (trailing slash) → null"
);
ok(
  (redirectHostMismatch({
    GMAIL_REDIRECT_BASE: "https://peak-app-six.vercel.app",
    AUTH_URL: "https://quartzite-six.vercel.app",
  }) || "").includes("peak-app-six.vercel.app"),
  "redirectHostMismatch: different host → warning names the stale host"
);
```

- [ ] **Step 2: Run to verify it fails**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsx scripts/test-review-and-spec.ts 2>&1 | head -5`
Expected: error — `redirectHostMismatch` is not exported.

- [ ] **Step 3: Implement**

`src/lib/gmail/config.ts`, after `callbackUrl()`:

```ts
/**
 * #95: a stale GMAIL_REDIRECT_BASE (set before a domain rename) sends Google's
 * auth code to a host that has no session cookie, and the connect silently
 * never saves. Surface it in Settings instead of letting it hide.
 */
export function redirectHostMismatch(
  env: { GMAIL_REDIRECT_BASE?: string; AUTH_URL?: string; NEXTAUTH_URL?: string } = process.env
): string | null {
  const override = env.GMAIL_REDIRECT_BASE;
  const authBase = env.AUTH_URL || env.NEXTAUTH_URL;
  if (!override || !authBase) return null;
  try {
    const a = new URL(override).host;
    const b = new URL(authBase).host;
    if (a === b) return null;
    return (
      "GMAIL_REDIRECT_BASE points at " + a + " but the app runs at " + b +
      " — Google will send the sign-in back to the wrong host and the mailbox won't connect. " +
      "Remove GMAIL_REDIRECT_BASE (or set it to the app's URL) and redeploy."
    );
  } catch {
    return null;
  }
}
```

`src/app/(app)/settings/page.tsx`: import `callbackUrl, redirectHostMismatch` from `@/lib/gmail/config`; in the component after `const gmailOn = gmailEnabled();` add

```ts
  const redirectUri = callbackUrl();
  const redirectWarning = gmailOn ? redirectHostMismatch() : null;
```
and change the prop to `gmail={{ enabled: gmailOn, mailboxes: mailboxVMs, redirectUri, redirectWarning }}`.

`src/app/(app)/settings/settings-client.tsx`: extend the prop type at line 145 to
`gmail: { enabled: boolean; mailboxes: MailboxVM[]; redirectUri: string; redirectWarning: string | null };`
and insert directly after the `{!gmail.enabled && (…)}` block (~line 1055):

```tsx
        {gmail.enabled && (
          <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 12, lineHeight: 1.6 }}>
            Google sends sign-ins back to{" "}
            <span style={{ fontFamily: "var(--font-mono)", color: "#5b616e" }}>{gmail.redirectUri}</span>
            {" "}— this exact URL must be listed under the OAuth client’s Authorized redirect URIs.
          </div>
        )}
        {gmail.redirectWarning && (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              lineHeight: 1.5,
              color: "#b4543a",
              background: "#f9ece8",
              border: "1px solid #f0d6cd",
              borderRadius: 8,
              padding: "8px 11px",
            }}
          >
            {gmail.redirectWarning}
          </div>
        )}
```

- [ ] **Step 4: Tests + typecheck**

Run: `export PATH=$HOME/.local/node/bin:$PATH && npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -E 'redirectHostMismatch|ALL PASSED|FAILED'` → four PASS + `ALL PASSED`. `npx tsc --noEmit -p . | tail -3` → empty.

- [ ] **Step 5: Commit**

```bash
git add src/lib/gmail/config.ts "src/app/(app)/settings/page.tsx" "src/app/(app)/settings/settings-client.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(settings): show the Gmail redirect URI and warn when GMAIL_REDIRECT_BASE drifts from AUTH_URL (#95)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: DEPLOY.md §5 — four scopes, Calendar, CRON_SECRET reality

**Files:**
- Modify: `DEPLOY.md:107-112` (scope list), the cron paragraph (~line 150)

- [ ] **Step 1: Edit the scope list**

Replace the three-item list under step 2 with:

```markdown
   - `.../auth/gmail.send`
   - `.../auth/gmail.readonly`
   - `.../auth/gmail.modify` (two-way archive + `Peak/` labels — requested on every connect)
   - `.../auth/userinfo.email`

   If you also want the calendar opt-in (Settings → Mailboxes → Enable calendar), enable the
   **Google Calendar API** in the Library and add `.../auth/calendar.events` here too. Gmail
   works without it.

   Any scope the app requests that is NOT listed here makes Google reject the consent, so keep
   this list in step with `GMAIL_SCOPES` in `src/lib/gmail/config.ts`.
```

- [ ] **Step 2: Add the rename warning to step 3**

After the redirect-URI bullets add:

```markdown
   **If the Vercel project or domain is ever renamed:** add the new
   `https://NEW-DOMAIN/api/gmail/callback` here AND check Vercel for a `GMAIL_REDIRECT_BASE`
   env var — if it still names the old domain, delete it (the app derives the callback from
   `AUTH_URL`). Settings → Mailboxes shows the URI the app will send and warns on a mismatch.
   (This is what broke connect from July to September 2026 — PUNCHLIST #95.)
```

- [ ] **Step 3: Make the cron note honest**

In the server-side sync paragraph, change the Vercel bullet's lead sentence to:

```markdown
- On Vercel (serverless — no long-running process) **nothing syncs in the background until you
  add `CRON_SECRET`** (as of 2026-09-21 it is not set — the Inbox only syncs while a tab is
  open). Add ONE env var:
```

- [ ] **Step 4: Commit**

```bash
git add DEPLOY.md
git commit -m "docs(deploy): Gmail §5 lists all four scopes, the rename trap, and the CRON_SECRET gap (#95)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Verify end to end, then close #95 in the punch list

**Files:**
- Modify: `PUNCHLIST.md` (#95 status line + hardening bullets)

- [ ] **Step 1: Full local verification**

```bash
export PATH=$HOME/.local/node/bin:$PATH
ps aux | grep -E 'tsx|next dev' | grep -v grep   # must be empty
npx tsc --noEmit -p . | tail -3                  # empty
npx eslint 2>&1 | tail -2                        # 0 errors (warnings unchanged: 84)
npx tsx scripts/test-review-and-spec.ts | tail -2   # ALL PASSED, count ≥ 977
npm run test:smoke 2>&1 | tail -2                # ALL PASSED
```

- [ ] **Step 2: Update PUNCHLIST.md #95**

Change the heading to `## 95. … — DONE 2026-09-21 (config + code hardening)` and under **Code hardening** change `OPEN, next batch` to `DONE 2026-09-21` with the commit hashes from Tasks 1–6. Leave the Jeff follow-up (Calendar API + scope) as the one open bullet.

- [ ] **Step 3: Commit and push**

```bash
git add PUNCHLIST.md
git commit -m "docs(punchlist): close #95 Gmail hardening

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin main
```

Production redeploys from `main` automatically; after it is Ready, open the Inbox once (any tab) so a sync runs — the Curt/Brenda threads flip to "Waiting on them" and the Needs-reply count drops.
