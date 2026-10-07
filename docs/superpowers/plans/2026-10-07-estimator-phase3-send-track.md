# Estimator — Phase 3 (Send & track) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send the estimate email from the Estimator's Send & track step through the sender's own Gmail — Estimate PDF (+ optional Cover PDF) attached, client link in the body, quote marked sent, follow-up task created — and then track that email's replies, the link's opens and client responses in the same tab.

**Architecture:** One ordered server action (`sendEstimateEmailAction`) reuses the existing pieces: PDF storage, the signed cover print render, `sendQuoteToCustomer` (approval gate + revision), `ensureShareLink`, the comms draft→send path (Gmail bridge), the tasks store. A store-owned `Quote.estimateEmails[]` remembers which comms threads belong to the estimate; `sendTrackAction` reads them back with their messages. Pure helpers own defaults, the body/link templating, the attachment cap and the thread summaries.

**Tech Stack:** Next.js 16 server actions, React 19, TypeScript; comms store `src/lib/stores/comms.ts`; Gmail bridge `src/lib/gmail/*`; spec harness `scripts/test-review-and-spec.ts` (sync blocks + the async chain for DB checks).

**Spec:** `docs/superpowers/specs/2026-10-07-estimator-four-steps-design.md` §10.

## Global Constraints

- Order inside `sendEstimateEmailAction` is fixed: preflight → build attachments → mark sent (draft only, via `sendQuoteToCustomer` with `asOf`) → `ensureShareLink` → create + send the comms thread → record `estimateEmails` → follow-up task. Nothing is marked or sent when preflight/attachments fail; a gate refusal emails nothing.
- Mailbox: `mailbox: "personal"`, `mailboxUser:` the acting user's name; `link: { type: "quote", id: <quote id>, label: <EST number · project name> }`.
- Attachment cap: Σ raw bytes ≤ 15 MB (`ESTIMATE_EMAIL_ATTACH_MAX = 15 * 1024 * 1024`); over → refuse `Too large to attach — send the link only.`
- Body placeholder `{link}`; if absent at send time the link is appended on its own line.
- Follow-up options `Off`, 2, 3, 5, 7, 14 days; default 5; assignee = Lead estimator (`owner`), else the sender.
- Re-send allowed when status `sent` (emails the current sent revision; no status change); refused for `won`/`lost`.
- New store-owned field `Quote.estimateEmails?: Array<{ threadId: string; rev: number; at: number; by: string; to: string }>` written ONLY by a quotes-store function (like `recordShareOpen`); never through the Estimator save (`saveQuoteAction` must not overwrite it).
- Copy (exact): primary `Send & mark sent →` (status draft) / `Send email →` (status sent); hatches `Open in Inbox`, `Mark sent without emailing`, `Copy link only`; Inbox warning `This marks the estimate sent now.`; partial failure `Marked sent, but the email didn't go out — open it in Inbox.`; activity card title `Activity`; reply button `Reply`; `Mark read`.
- Local dev / Gmail off: the send creates a local outbound message (existing behaviour) — the UI shows `Sent locally (Gmail not connected)` when the message has no `gmailId`.
- Gates per task: `npx tsc --noEmit` 0; scoped eslint clean (`npx eslint "src/app/(app)/estimator" "src/app/(app)/inbox" src/lib/stores/comms.ts src/lib/stores/quotes.ts src/lib/estimate-output src/lib/estimate-email src/lib/quote-share src/lib/gmail` + touched dirs; never `npm run lint`); `npm run test:specs` FAIL 0 (report PASS); `npx next build` when client components change. Never `git stash`; never touch `.data/`; never send real email (no Gmail connection exists in scratch DBs — keep it that way). Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Numbers assigned in Task 6.

---

### Task 1: Pure helpers + store field

**Files:** Create `src/lib/estimate-email/compose.ts` (pure); modify `src/lib/stores/quotes.ts` (`estimateEmails` field + `recordEstimateEmail(id, entry)` store function + make sure the Estimator save path can't clobber it — check how `shareOpens`/`clientResponses` are protected and mirror it); modify `src/lib/stores/comms.ts` only if a pure `threadSummary(thread)` belongs next to the types (else in compose.ts); harness `#P3 compose` (+ an async DB check for `recordEstimateEmail`).

**Produces (compose.ts):**
```ts
export const ESTIMATE_EMAIL_ATTACH_MAX = 15 * 1024 * 1024;
export const FOLLOW_UP_CHOICES = [0, 2, 3, 5, 7, 14] as const; // 0 = Off
export type EstimateEmailDefaults = { to: string; cc: string; subject: string; body: string };
export function estimateEmailDefaults(i: { projectName: string; estimateNumber: string; contactName: string; contactEmail: string; senderName: string; senderEmail: string; leadName: string; leadEmail: string }): EstimateEmailDefaults;
export function withLink(body: string, url: string): string;           // replaces every {link}; appends "\n\n" + url when none
export function parseRecipients(raw: string): { ok: true; list: string[] } | { ok: false; bad: string[] }; // comma/semicolon/newline separated, trimmed, deduped (case-insensitive), simple RFC-ish check
export function attachmentsFit(sizes: number[]): boolean;              // Σ ≤ cap
export type ThreadSummary = { threadId: string; subject: string; to: string; sentAt: number; delivered: boolean; unread: number; messages: Array<{ direction: "in" | "out"; from: string; at: number; snippet: string; unread: boolean }> };
export function summarizeThread(t: /* CommThread structural subset */ unknown): ThreadSummary | null; // snippet = plain text ≤ 280 chars, html stripped; delivered = any out message has gmailId
```
- [ ] Step 1 failing tests (each function, incl. defaults: Cc blank when lead = sender or no lead email; subject format `<project> — estimate <EST>`; body contains `{link}` once and the contact's first name; first name falls back to "there"), Step 2 RED, Step 3 implement, Step 4 gates, Step 5 commit `feat(estimator): Phase 3 email compose helpers and Quote.estimateEmails`.

---

### Task 2: `sendEstimateEmailAction` + `openEstimateInInboxAction` + `estimateEmailDefaultsAction`

**Files:** Create `src/app/(app)/estimator/send-actions.ts` (`"use server"`) with a server-only core in `src/lib/estimate-email/send-server.ts` (testable with injected deps like `package-zip-server.ts` / `responses-server.ts` do); harness `#P3 send` (DB-level async checks with fakes for PDF read + cover render + comms send).

- Core: `sendEstimateEmail(deps, input)` implementing §10.1 steps 1–7 exactly, returning `{ ok: true; threadId; delivered: boolean; status: QuoteStatus; next?: QuoteNextStepView } | { ok: false; error: string; markedSent?: boolean }`. `deps` = `{ readEstimatePdf(q): Promise<Buffer | null>; renderCoverPdf(q): Promise<Buffer>; sendQuote(id, actor, asOf); ensureLink(id): Promise<string /* absolute URL */>; createAndSendThread(spec): Promise<{ threadId; delivered }>; createDraftThread(spec): Promise<{ threadId }>; recordEmail(id, entry); addFollowUpTask(spec) }`. The action wires real deps: PDF via `pdfStorage().read(teamPdfPath(q))` (refuse `Save the estimate first — its PDF is out of date.` when not current — use the same "pdf current" rule the preview uses), cover via the same render the `/api/quotes/[id]/cover-pdf` route uses (extract a shared server function rather than calling the route), link via `ensureShareLink` + origin from `headers()` (reuse whatever `getShareLinkAction` uses to build absolute URLs), comms via `saveDraft` → `updateDraft` → `sendDraft` (mirror `composeSendAction` in `src/app/(app)/inbox/actions.ts`), tasks via the tasks store's create used by `addQuoteTaskAction`.
- `openEstimateInInboxAction(quoteId, input)` — steps 1–4 + 6 then `createDraftThread` and return `{ ok: true; href: "/inbox?draft=<id>" }` (check the Inbox's `?draft=` param handling and the current mailbox/folder params; the shared boxes are retired — use the personal box).
- `estimateEmailDefaultsAction(quoteId)` — returns `estimateEmailDefaults(...)` from the quote, its customer contact email (customers store `email` fields), the current user and the Lead estimator user's email, plus `{ gmailConnected: boolean }` (`getConnectionInfo(personalKey(user.id))`).
- Tests: preflight refusals (permission, won/lost, stale PDF, bad recipients, blank subject/body, over cap) leave nothing changed; gate refusal emails nothing; happy path order (record of dep calls), link substituted, follow-up due date, `Off` creates no task; re-send on a sent quote doesn't call `sendQuote`; partial failure after mark-sent returns `markedSent: true`; Inbox path creates a draft (no send).
- Commit `feat(estimator): Phase 3 send the estimate email from the tab (ordered server action)`.

---

### Task 3: `sendTrackAction` + reply/mark-read

**Files:** `src/app/(app)/estimator/send-actions.ts` (+ server core), comms store helpers if needed (`markThreadRead`, existing `reply`); harness `#P3 track`.
- `sendTrackAction(quoteId)` → `{ emails: ThreadSummary[] (newest first, threads that no longer exist skipped); opens: { total; byRev } ; newReplies: number }` (opens from `Quote.shareOpens` via `opensFor`). Permission: anyone who can view the estimate.
- `replyToEstimateEmailAction(threadId, body)` — only for a thread recorded on a quote the user can access; uses comms `reply(threadId, { body, me })` (Gmail when connected); returns the fresh summary. `markEstimateEmailReadAction(threadId)` clears unread on that thread (use the comms store's existing read/unread mutation).
- Tests with a scratch DB in the async chain: summaries from seeded threads (in/out, unread, delivered flag), unknown/foreign thread refused, reply appends an out message, mark read clears unread.
- Commit `feat(estimator): Phase 3 track replies and opens for the sent estimate`.

---

### Task 4: Send & track step UI

**Files:** `steps/send-step.tsx`, new `steps/send-composer.tsx` and `steps/send-activity.tsx`, hook additions in `use-estimator-state.ts` only if needed (e.g. a `trackData` state + fetch on Send step mount/focus), harness `#P3 send UI`.
- Before send (status `draft`): composer card — To, Cc, Subject, Body (textarea, shows the `{link}` hint), attachments checkboxes (`Estimate PDF` checked; `Cover PDF` checked), Follow-up select (`Off`, `2 days` … default `5 days`), Gmail state line (`From <address>` or `Gmail not connected — it will be saved as sent here; connect Gmail in Settings → Mailboxes`), primary `Send & mark sent →` (saves first when dirty like the next-step control, passes `asOf`), and the escape-hatch row: `Open in Inbox`, `Mark sent without emailing` (the existing status/next-step path), `Copy link only` (scrolls to the Client link card). Show a gate message inline when the action returns one; on success move nothing (stay on Send & track) and refresh track data + next view (`applySync`).
- After send (status `sent`/`won`/`lost`): `Activity` card first (emails newest first; each shows to, time, delivered/local state, and its messages; inbound unread highlighted; `Reply` inline box; `Mark read`), then the existing Client link (revisions + opens), Client responses, Tasks, Pipeline, Status cards. For `sent`, a collapsed `Send another email` composer (re-send).
- Keep exact copy from the constraints; no forbidden strings in Estimator files (`.components`, `customerLines(`, `window.print`, `est-doc`, `reviewBarOpen`, store/db value imports); keep existing send-step pins (`changeStatus(`, `stageBarPipeline`, `<ClientLinkPanel quoteId={loadedId} withPackage={false} />`, `section="responses"`, `<TasksCard`).
- Commit `feat(estimator): Phase 3 Send & track — composer, activity, replies`.

---

### Task 5: Send badge — opens and new replies

**Files:** `src/lib/estimate-steps/readiness.ts` (`ReadinessInput.track?: { opens: number; newReplies: number }`; Send badge when sent: `Sent · Rev N` + ` · 👁 N` when opens > 0 + ` · N new reply|replies` when > 0), `estimator-client.tsx` (pass track data), harness `#P3 badge`. Existing exact-label tests stay valid (no track → unchanged).
- Commit `feat(estimator): Phase 3 Send badge shows opens and new replies`.

---

### Task 6: Verification + docs

- Controller browser pass on a scratch DB (no Gmail connection → local send): compose defaults, send a draft (marked sent, link in body, PDF attached on the thread, follow-up task, Activity shows the email as local), re-send on a sent quote, Open in Inbox (draft created, quote sent), reply inline, mark read, badge.
- `npm run test:smoke`; docs (DECISIONS: ordered action + failure semantics; mailbox + link + record; attachments + cap + cover render; escape hatches; track/reply/badge + no new bell group; "Revise with these scopes" parked), PUNCHLIST item, AGENTS entry 42. Final gates; commit `docs: Estimator Phase 3 — Send & track`.
