# Inbox organization — design

Date: 2026-10-13 · Status: approved in brainstorm (Jeff, 2026-10-13) · Punch # and D-numbers: assigned at build (recheck `origin/main`).

Piece 1 of Jeff's AI roadmap: Inbox organization → pop-out windows → AI daily brief → estimate suggestion → AI sidebar. It builds on Assist (#334: `src/lib/assist/`, `runAssist`, the gate, `assist_runs`, and the Claude key stored in Settings, D881).

## Goals

- Every email thread gets a **filing suggestion**: a customer plus an optional quote, project, lead or venue, or "noise". Suggestions come from free rules first and Haiku only for what is left. You approve them in batches.
- **Replying files the thread and takes it out of the inbox.** It comes back when the ball is in your court again.
- **Noise** (newsletters, promotions, notifications, auto-replies) leaves the inbox and goes to a Noise tab that you skim in batches.
- Every thread knows **whose court it is**: me, a named teammate, the customer, or nobody. A teammate's reply no longer counts against you. A hand-off ("Jeff will be in touch") does count against you.
- **Promises become tasks automatically**, with due dates. This covers my promises, a teammate's, and vague ones ("someone will be in touch").
- **Corrections teach**: "Always file mail from this sender here", "Never mark as noise".
- All of it is logged so the prompts and rules can be tuned during the pilot.

## Non-goals

- Pop-out windows. That is the next spec. This work must be **pop-out-ready**: see §9.
- The AI brief. It will *report on* this feature (counts, a link to Organize).
- Auto-sending anything.
- Creating customers or records from email. A filing can only point at existing records; the existing quick-add actions remain the way to create one.
- Shared mailboxes. They were retired (`SHARED_BOXES = []`).

## Who gets what (Jeff)

| Part | Everyone | Assist pilot users |
|---|---|---|
| Archive-on-reply (per-user off switch in Account, default on) | ✓ | ✓ |
| Rule pipeline (sender rules, identity, numbers, noise rules, court rules, forward parsing) | ✓ | ✓ |
| Noise held out of the inbox | tag only ("Looks like noise") | ✓ moved to the Noise tab |
| Haiku filing suggestions | | ✓ |
| Haiku court/promise reading + automatic promise-tasks | | ✓ |
| "Organize my inbox" 90-day cleanup | | ✓ |

The pilot gate is the existing `assistGate`. It gains two new feature keys, `file` and `promise`, each with its own switch on the Assist pilot card. The court-reading AI runs under `promise`.

## 1. Filing pipeline (per thread; first match wins)

The pipeline runs in two places. The first is inside the existing Gmail import (`pollInbound` / `bridge.ts`), after `applyResolution`, for each thread that gained a message. It is time-boxed (§8). The second is the 90-day cleanup (§6).

1. **Sender rules.** Saved rules match on the exact address first, then the domain. A rule either says "file under X" or "noise / never noise". Personal rules win over company-wide ones. Strong.
2. **Identity.** This is the existing `resolveSender`/`applyResolution`. A contact-email match is strong. A domain match is weak and only a suggestion.
3. **Number match.** A display estimate number (`EST|FLM|RIG|REP|RNT|CON|OPP-####`, including `-2`/`-3` suffixes) is searched for in the subject, then the body. Then project ids, then lead numbers. A match links that exact record and its customer. Numbers that do not resolve to a live record are ignored. Strong.
4. **Noise rules.** Never applied if the sender is a known customer contact or the thread is internal-only. Any of these makes a thread noise:
   - the message carries Gmail `CATEGORY_PROMOTIONS`, `CATEGORY_SOCIAL` or `CATEGORY_FORUMS` (`gmailLabelIds`);
   - a `List-Unsubscribe` header or `Precedence: bulk|list` (**the import starts storing these** as `bulk: true` per message);
   - the local part matches `no-?reply|notifications?|mailer-daemon|bounce`;
   - an `Auto-Submitted` header other than `no`, or an out-of-office subject.
5. **Haiku** (pilot only; feature `file`). It runs only if steps 1–4 left the thread unresolved, or the only result is a weak domain match.
   - **Input:** the thread inside the untrusted `<email_thread>` wrapper (as today), plus a **server-built candidate list**:
     - the likely customer's open quotes, projects and leads (the customer comes from a domain or identity guess);
     - the top 5 company matches for organisation names found by the existing company search;
     - each candidate is shown as `id | type | label | customer`.
   - **Output (zod):** `{ target: candidateId | "none" | "noise", confidence: "strong" | "weak", reason: string, needsReply: boolean }`.
   - Any id that is not in the candidate list is discarded. A result counts as strong only if the model says so **and** the target is a record of the matched customer.

**Suggestion stored on the thread** (`CommThread.filing`):

```ts
{ customerId: string | null; work: CommLink | null; siteId?: string | null;
  noise: boolean; source: "rule" | "identity" | "number" | "noise-rule" | "ai";
  reason: string; strength: "strong" | "weak"; needsReply: boolean;
  runId?: string;                // assist_runs id when source === "ai"
  state: "suggested" | "filed" | "skipped" | "dismissed";
  at: number; filedBy?: "approved" | "reply" | "rule" | "teammate-reply"; filedAt?: number }
```

New mail on the thread resets `skipped` to `suggested` and recomputes the suggestion. A `filed` thread keeps its filing; new mail only updates the court.

## 2. Organize view (Inbox `?view=organize`)

There are three tabs. Each user sees only their own threads (`visibleTo`).

- **To file.** Every inbox thread whose `filing.state === "suggested"` and which is not noise.
  - Each row shows: sender, subject, the suggestion ("Lincoln HS → EST-1042 Main curtain"), the reason line, a Strong/Weak chip, and a needs-reply dot.
  - Row actions:
    - **Approve**
    - **Change…**: opens the existing link search (`searchLinkTargetsAction`) for a company, venue, quote, project or lead
    - **Noise**
    - **Skip**
  - **Approve all strong** at the top, with a confirm that shows the count.
- **Noise.** Newest first, each with its reason.
  - **Not noise** returns the thread to the inbox and To file.
  - **Archive all shown**.
- **Filed.** The last 14 days. Each row says how it was filed (approved / on reply / sender rule / teammate reply).
  - **Undo** unlinks the thread, removes its Peak label and un-archives it if it had been archived.

**Approve** links the thread through the existing link actions and store functions (`linkThread`, `setLinkAction`/`setThreadSiteAction`). The existing `syncPeakLabels` mirror then applies the Gmail labels. After linking:
- if `needsReply` is false, or the court is not me, **archive** (app + Gmail, `pushInboxState`);
- otherwise the thread stays until the reply.

**Corrections.** **Change…** or **Not noise** shows a one-line offer:
- "Always file mail from **addr** / **@domain** under X?"
- or "Never / Always treat **sender** as noise".

An accepted offer becomes a sender rule (§5). Every approve, change, rescue, skip and undo is logged against the suggestion: `assist_runs` outcome for AI suggestions, and a filing log for rule suggestions (§7).

## 3. Whose court is it? (`CommThread.court`)

```ts
{ owner: "me" | "teammate" | "customer" | "nobody"; teammateId?: string;
  reason: string; source: "rule" | "ai" | "override"; at: number;
  promise?: { text: string; ownerUserId: string; due: number | null; taskId?: string } }
```

The court is recomputed on every new message. "Me" means the thread's mailbox owner.

**Internal sender.** An address belongs to a Peak user (the team list, users' emails, and connected Gmail addresses), or is on Peak's own domain. The domain comes from the team's addresses, with an optional admin setting.

**Rules** (everyone):
- Last message from the customer → **me**. This is today's `waiting_us`.
- Last message from me → **customer**.
- Last message from a **teammate** → **customer**. This is the fix: it stops counting against me.
- A customer message that is only a sign-off (a short list: "thanks", "thank you", "got it", "sounds good", "perfect", "will do"; at most about 8 words; no question mark) → **nobody**.

**Forwards.**
- Detection: a `Fwd:`/`FW:` subject, or a forwarded-message header block in the body.
- The forwarded `From` / `Subject` / `Date` are parsed, and filing (§1 steps 1–3) runs on the **original sender and content**.
- A teammate forwarding to me makes the court **me**: a hand-off. If the forward note is FYI-only ("FYI", "for your records", "no action", with no question), the court is **nobody**, and the thread is filed and archived.

**Internal-only threads** (every participant is internal):
- They are never marked noise.
- They are filed only by a mention of a customer or a number. Otherwise they are left unfiled, with no nagging suggestion.
- The court follows the rules above between teammates.

**My forward out** (to a vendor) does not move the original customer thread's court.

**AI reading** (pilot only; feature `promise`; Haiku). It runs on the newest message unless that message is a pure sign-off.
- **Input:** the last 3 messages (untrusted wrapper), the team list (id — name), the thread owner, and today's Chicago date.
- **Output (zod):** `{ owner: "me"|"teammate"|"customer"|"nobody", teammateId: string, reason: string, promises: Array<{ text: string; ownerUserId: string; dueText: string }> }`.
- `teammateId` and `ownerUserId` must be real team ids, or they are dropped.
- The AI result **overrides the rule court only for hand-offs and asks**: a named teammate or "me", or a customer request.

**Overrides.** "Not on me" / "On me" in the reader sets `source: "override"`. The override sticks until the next message and is logged.

**What the court drives:**
- **Inbox membership.** Court customer or nobody after my reply or a teammate's reply → archive-on-reply (§4). Court me → stays in, or returns to, the inbox, tagged "On you: …".
- **Morning triage.** The email feed (`src/lib/triage/feeds/email.ts`) uses the court ("me") instead of the raw `status === "waiting_us"`.
- **Status.** `status` keeps its current meaning for older readers. A small mapping keeps the two in step: me ↔ `waiting_us`, customer ↔ `waiting_them`, nobody ↔ `closed`.

## 4. Archive-on-reply (everyone)

- When I send a reply (`comms.reply`), or a teammate's reply arrives that makes the court customer or nobody, the thread is archived in the app and in Gmail.
- It is filed first if it already has a link or a **strong** suggestion. A strong suggestion is applied as `filedBy: "reply"`. A weak or missing suggestion waits in To file.
- Any message that makes the court **me** un-archives the thread. That covers new customer mail and a hand-off. (`addMessage` already un-archives on new mail; a teammate's reply must not un-archive it unless the court becomes me.)
- **Per-user setting:** Settings → Account "Keep threads in my inbox after I reply". Default off, which means archive-on-reply is on.
- **Fix:** manual "Mark replied" / "Close" now also archive, subject to the same setting.

## 5. Sender rules

- **Storage:** a settings blob `inbox_sender_rules`: `{ rules: Array<{ id; scope: "user"|"company"; userId?; match: { email?: string; domain?: string }; action: { type: "file"; customerId: string; work?: CommLink } | { type: "noise" } | { type: "never-noise" }; createdBy; createdAt }> }`, capped at 2,000.
- **Precedence:** user beats company; email beats domain.
- **Where you see them:**
  - Settings → Account → **Sender rules** lists and deletes your own rules.
  - The Assist pilot card has an admin company-wide list.
- **Applying a new rule re-sweeps** that sender's unfiled inbox threads, the same pattern as `resweepThreads`.

## 6. 90-day cleanup (pilot users)

- An **Organize my inbox** button in Organize starts the cleanup. It covers the user's inbox threads that were last active within 90 days and are not filed.
- It runs the full pipeline in resumable batches with a 40 s budget each (the photo-sheet and Drive-sync pattern), with progress like "212 of 480 checked".
- It **only suggests**: nothing is linked or archived until approved. Noise moves to the Noise tab.
- It runs the **court rules only**. The AI court reading and promise-tasks are **not** run on backlog mail, so old commitments don't flood the task list.
- It can be re-run; already-suggested and filed threads are skipped.

## 7. Promise tasks (pilot users; mail that arrives after launch)

- **Trigger:** the AI reading (§3) returns promises, either on a message I or a teammate sent, or a forward note addressed to me.
- **Owner:**
  - the named team member;
  - else, for "we will…" / "someone will…", the message author if internal;
  - else the thread owner.
- **Due date** (pure resolver, America/Chicago):
  - "today", "tomorrow", a weekday name (the next occurrence), "end of (the) week" → Friday, "next week" → next Monday, "end of month", or an explicit date;
  - otherwise **2 business days** after the message;
  - always stamped **5:00 pm**, matching the task calendar's due stamp.
- **Creation:**
  - It goes through the existing `createTask`, with `section: "Email"`.
  - Links: thread, customer, site, and the quote/project/lead from the filing.
  - Tier normal, size per the existing defaults. It is not `waitingOn`.
  - **Deterministic id** `T-prm-<hash(threadId, messageId, promiseText)>`, so a re-sync never duplicates the task.
- **Visibility:**
  - The thread shows "Task created: … · due Thu" with **Undo**, which soft-deletes the task and logs `discarded`.
  - The next brief lists new promise-tasks.
- **On reply:** while a thread has an open promise-task, the composer shows "Mark '…' done?" as an **unticked** checkbox. Tasks are never auto-closed.

## 8. Data, logging, failure modes

- **Thread fields** on `CommThread` (in the comms doc; no new table):
  - `filing`, `court`, `noise` (`noise: { flagged: boolean; reason: string; rescued?: boolean }`);
  - per-message `bulk?: boolean`, `autoSubmitted?: boolean` (new import fields).
- **Logging:**
  - AI calls go to the existing `assist_runs` with features `file` and `promise`. The outcome is set on approve / change / rescue / undo.
  - Rule-based filings append to a small capped log, the `inbox_filing_log` blob, last 2,000 entries, so the report can compare sources.
- **Report** (Assist pilot card): filings by source, % approved as suggested, corrections, noise rescues, and promise-tasks created / undone.
- **Failure modes:**
  - With no key, a non-pilot user, the cap reached, a refusal or an error, the pipeline stops after the free rules.
  - AI work runs **after** the import commits, time-boxed (about 20 s per sync pass, oldest unprocessed first). It is marked `pending-ai` and resumes on the next sync, so the Gmail sync never fails or slows past its budget because of AI.
- **Safety:**
  - Thread text is untrusted (the existing wrapper; names are cleaned).
  - Only candidate ids are accepted, and only real team ids.
  - Nothing sends.
  - Filing uses the same link and archive actions a person would, so permissions and visibility hold.

## 9. Pop-out readiness (for the next spec)

- The Organize view and the reader take no dependency on the app shell or nav being present.
- Every filing, court, noise or archive change posts `{ type: "inbox-changed", threadId }` on a `BroadcastChannel("peak")`. The receiver lands in the pop-out spec; for now the current window just `router.refresh()`es.

## 10. Testing

- **Pure checks:**
  - number matching, including suffixes and dead numbers
  - noise rules, including the known-contact and internal exemptions
  - forward parsing (Gmail and Outlook forward formats)
  - sign-off detection
  - court rules: me / teammate / customer / forward / FYI / internal-only
  - due-date resolution: every phrase, plus the default of 2 business days at 5 pm across a weekend
  - sender-rule precedence
  - deterministic promise-task ids
  - candidate filtering of AI output
- **Fake-provider checks:** AI filing (strong/weak, out-of-list id dropped) and AI court/promise reading (hand-off to a named teammate, a vague "someone", an unknown name dropped).
- **Database checks:**
  - approve links and archives only when no reply is needed
  - undo restores
  - archive-on-reply respects the per-user setting
  - a teammate reply archives and doesn't count against me
  - a hand-off un-archives
  - promise-task creation is idempotent
  - the 90-day cleanup is resumable and makes no tasks
- **Gates:** test:assist, tsc, eslint, next build, test:specs, test:smoke.

## Small defaults taken in this spec

- **Peak's own domain:** derived from the team's addresses, with an optional admin override on the Assist pilot card.
- **Rule-only noise for non-pilot users:** tagged "Looks like noise", not moved. Jeff approved this split in section 2 of the brainstorm.
