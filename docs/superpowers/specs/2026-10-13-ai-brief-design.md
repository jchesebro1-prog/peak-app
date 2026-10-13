# AI daily brief — design

**Date:** 2026-10-13
**Status:** approved in brainstorm (Jeff, 2026-10-13)
**Punch / D-numbers:** assigned at build; recheck `origin/main`.

Roadmap piece 2. It builds on:
- Assist #334: `runAssist`, the gate, `assist_runs`, the D881 key.
- Inbox organization #335: court, Organize counts, promise-tasks, `runAiPass`.
- Morning triage #324: snapshots, Start here.
- Pop-outs #336: `LiveSync` and the change channel.

## Decisions (Jeff)

| Question | Answer |
|---|---|
| Shape | Written summary above Start here **plus pre-made drafts** |
| Times | **6:45 am and 1:45 pm Central**. Triage snapshots move to match. |
| Who | **Assist pilot users**, with a new **Daily brief** switch (opt-in, default off) |
| Models | **Haiku** for the brief, task suggestions and quote nudges. **Sonnet** for pre-made customer replies. |
| How many drafts | **Every thread the sweep puts on me** (court `me`). Many at first, fewer as the inbox is kept up. Bounded per run by time and the monthly cap. |
| Draft kinds | Replies, task suggestions, quote follow-up note + nudge email. Estimate requests get a link only (estimate suggestion is a later piece). |
| Phone | Big-text summary plus a **Listen** button (device speech, free) |
| Notification | **Scheduled on the phone**: Capacitor local notifications at 6:45 and 1:45, generic text, tap opens the brief. Needs an app rebuild. Per-user off switch in Account. |

## 1. Slots and building

**Slots.** Morning is `06:45` and afternoon is `13:45`, America/Chicago.
- `src/lib/triage/clock.ts` `slotAt(ms)` becomes minute-precise. At or after 13:45 the slot is `midday`; otherwise it is `morning`. The stored slot names `morning`/`midday` are kept for compatibility.
- The first view after 6:45 lazily builds the morning slot, as triage already does.

**Crons** (`vercel.json`, daily only; Vercel runs them in UTC with no DST fix, and the lazy build covers drift):
- `/api/gmail/sync` moves to `45 11 * * *`, which is 6:45 CDT. It already builds the morning triage and will also build briefs.
- `/api/triage/build?slot=midday` moves to `45 18 * * *`, which is 13:45 CDT. It will also build the afternoon briefs.
- Both keep their 60 s budgets. Brief summaries are one Haiku call per pilot user, about 3–6 s each, so the job builds as many as fit and the rest build lazily.

**Brief record.** No migration. Stored as the blob `brief:<userId>:<day>:<slot>` via `getBlob`/`setBlob`:

```ts
type Brief = {
  userId; day; slot: "morning" | "midday"; builtAt; builtBy: "cron" | "lazy" | "rebuild";
  summary: string;                      // ≤ 900 chars, plain text
  doFirst: Array<{ key: string; why: string }>;   // 3–5 keys from the snapshot rows
  organize: { toFile: number; strong: number; noise: number };
  newPromiseTasks: Array<{ taskId: string; title: string; due: number | null }>;
  today: { visits: number; firstVisitAt: number | null; driveMin: number | null; tasksDue: number };
  quiet: Array<{ quoteId: string; number: string; name: string; customer: string; sentAt: number; days: number }>;
  approvals: number;
  since?: { done: number; open: number; new: number };   // afternoon only, vs the morning brief
  runId: string | null; error?: string;
}
```

**Builder.** `buildBrief(me, slot, now, opts)` in `src/lib/brief/build.ts` (server):
1. Run `runAiPass({ ownerIds: [me.id], deadlineMs })` with a short slice, so court and filing are fresh.
2. Load the triage snapshot via `loadTriageView` (it builds lazily if missing).
3. Gather the inputs:
   - Organize counts: `toFileThreads` + strong + noise.
   - Promise-tasks (`T-prm-` assigned to me, created since the previous brief).
   - Today: `todayRows` from `loadTaskPlans`, plus the visit count and drive minutes from `planDriveDays` in `"cache"` mode.
   - Approvals waiting: `quoteAwaitsApprovalBy`.
   - Quiet quotes (§3).
4. Call Haiku (`feature "brief"`, slot `brief`) with the snapshot rows rendered as `key | source | title | reason` plus the gathered facts.
   - Schema: `{ summary, doFirst: [{ key, why }] }`.
   - The sanitizer keeps only keys present in the snapshot (3–5), trims text and caps lengths.
   - **Fallback:** on refusal, error, or when Assist is off, use a rule-built brief: the summary is composed from the counts, and `doFirst` is the top 3 snapshot rows.
5. Afternoon only: `since` is computed by diffing the morning brief's `doFirst` keys and morning snapshot keys against the current snapshot and marks (pure).

**Lazy and rebuild paths:**
- `loadBriefView(me, now)` reads the current slot's blob. If it is missing and the user is pilot + brief, it builds inline with a 20 s deadline, rendered behind Suspense as "Preparing your brief…". If the build fails, it falls back to the rule-built brief.
- **Rebuild** (button) builds with `builtBy: "rebuild"`. It is rate-limited to 3 per hour per user.

## 2. Pre-made drafts

**Queue** (`src/lib/brief/drafts.ts`). Runs as `runDraftQueue({ ownerId, deadlineMs })` in `after()` from:
- the Home page,
- the Inbox auto-sync/send-receive (alongside `scheduleAiPass`),
- right after a cron brief build, within that route's remaining budget.

Work order is oldest first, until the deadline:
1. **Replies.** For each of my court-`me` threads (`onMyCourt`) without a fresh pre-draft, draft a reply with **Sonnet** via a new reusable `draftReplyForThread(threadId, me, deps)` in `src/lib/assist/reply-server.ts`. `draftReplyAction` becomes a thin wrapper around it. Then suggest tasks via `suggestTasksForThread` (Haiku, `src/lib/assist/tasks-server.ts`). Store both on the thread as `CommThread.preDraft = { body, runId, taskSuggestions, taskRunId, basis /* newest inbound msg id */, at }` using a key-level write (`patchDocKey`).
2. **Quiet quotes.** Draft a follow-up (Haiku): `{ note, emailSubject, emailBody }`. Store on the quote as `Quote.assistNudge = { …, runId, basis: sentAt, at }` with a key-level write.

**Fresh** means `preDraft.basis` equals the thread's newest inbound message id. When the reader opens a thread whose pre-draft is stale, it drafts live (the existing Draft reply path).

**Gating.** The owner must be pilot + `reply` for replies, `tasks` for task suggestions, and `brief` for nudges. Each call goes through `runAssist`, so the cap, rate limits and logging all apply. Use background rate-limit keys (`countRate: false`) so pre-drafting never uses up the person's interactive limits; the monthly cap is the bound.

## 3. Quiet quotes (pure selector)

`selectQuietQuotes(quotes, threads, me, now)` picks quotes that meet all of these:
- `owner` (or `preparedBy`) is me;
- `status === "sent"`;
- the last `history` entry has `to === "sent"` and is ≥ 5 business days old (Chicago, `businessDaysBetween`);
- there is no inbound message after that sent date on any thread with `link.type === "quote" && link.id === q.id`, or on a thread whose `customerId` is the quote's customer and whose subject contains the estimate number.

At most 8, oldest sent first.

## 4. Home card (`src/components/brief/brief-card.tsx`)

Rendered above `StartHereCard` on Home, only for pilot + brief users.
- **Header:** "Morning brief · 6:45" / "Afternoon brief · 1:45", a collapse toggle (remembered per brief id in localStorage), and **Rebuild**.
- **Summary** paragraph.
- **Do these first:** each item links to its source (`href` from the snapshot row). Chips: **Draft ready** when a fresh pre-draft or nudge exists, **Tasks ready**.
- **Inbox organization:** "N to file (M strong) · K noise → Review", linking to `/inbox?view=organize`. Hidden when all counts are zero.
- **New tasks from promises** since the last brief (title · due).
- **Today:** visits (first one at hh:mm), drive time, tasks due.
- **Quiet quotes:** each with its note, **Send nudge** and **Open estimate**. Send nudge links to `/inbox?nudge=<quoteId>`: the Inbox reads the quote's stored nudge on the server (only when it is fresh and the viewer's quote), caps it, and opens the composer prefilled with `emailSubject`/`emailBody` to the quote's contact (matched by name among the customer's people; To stays blank when unknown). Only the id travels in the URL, and nothing sends by itself.
- **Leads:** a lead row in Do these first adds "Ready to quote? → **Open lead**", linking to the lead's own page (`/leads?lead=<id>`), where it converts. There is no pricing-request classifier, so no row is labelled one.
- **Afternoon** adds the line "Since this morning: X done · Y still open · Z new".
- **Reader integration.** When a thread has a fresh pre-draft, the reader shows "Draft reply ready · prepared 6:45 · **Use it**". Use it opens the reply composer with the draft and signature, and records outcomes exactly like Draft reply (runId; the edit-ratio outcome on send; discarded on cancel). Pre-made task suggestions open the existing Suggest-tasks dialog without a new model call.
- **Phone / under 900 px:** the card renders the **big-text** variant: larger type, summary plus Do these first plus counts, and no drafts. A **Listen** button reads `briefSpeech(brief)` (pure: short sentences, numbers spelled naturally) through `window.speechSynthesis`, with a Stop button. It is hidden when speechSynthesis is unavailable.

## 5. Phone reminders (Capacitor local notifications)

- Add `@capacitor/local-notifications` (pinned, a version at least 2 weeks old). Add `NativeBriefReminders`, a client component mounted in the `(app)` layout, active only when `isNativePlatform()`.
  - It requests permission once.
  - When the user is pilot + brief and their Account pref is on, it schedules two daily repeating notifications: 06:45 and 13:45 device-local time ("Your morning brief is ready" / "Your afternoon brief is ready").
  - Otherwise it cancels them.
  - Tapping a notification opens `/?brief=1`. Use the `localNotificationActionPerformed` listener plus `router.push`, which scrolls to the brief card on Home.
- **Account:** "Brief reminders on this phone" toggle, default on, stored as a `notif_prefs` key.
- **Jeff-gated:** `npx cap sync` and rebuild/reinstall the iOS and Android apps.

## 6. Settings and report

- **Assist feature `brief`:** opt-in (`OPT_IN_FEATURES`, default off), toggle on the pilot card, report label "Daily brief", model slot `brief` = Haiku, env `ASSIST_MODEL_BRIEF`.
- **Report:** briefs built (cron / lazy / rebuild), pre-drafts made / used (Use it clicked) / stale-discarded, nudges sent.

## Non-goals

- Server push (APNs/FCM).
- Emailing the brief.
- Briefs for non-pilot users.
- Estimate suggestions (next roadmap piece).
- Changing the triage ranking.

## Testing

- **Pure checks:**
  - minute-precise `slotAt`: anything before 13:45 Chicago is the same day's `morning` slot (as today), and 13:45 or later is `midday`. Pin 13:44 → morning and 13:45 → midday.
  - brief sanitizer (keys only from the snapshot)
  - rule-built fallback
  - afternoon diff
  - quiet-quote selector (business days, inbound after sent, linked thread)
  - `briefSpeech`
  - draft freshness
- **Fake-provider DB checks:**
  - `buildBrief` stores a blob
  - lazy build
  - rebuild rate limit
  - the draft queue drafts court-me threads only, respects the deadline, skips fresh ones, and redrafts stale ones
  - nudges are written on quiet quotes only
  - `draftReplyForThread` matches the old action output
- **Gates:** test:specs, smoke (Home renders with and without a brief), tsc, eslint, next build.
