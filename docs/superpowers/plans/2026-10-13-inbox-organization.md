# Inbox Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the Inbox organization feature from `docs/superpowers/specs/2026-10-13-inbox-organization-design.md`:
- a filing pipeline (rules first, Haiku for leftovers)
- the Organize view (To file / Noise / Filed)
- "whose court" logic, including teammate replies and forwards
- automatic promise-tasks
- archive-on-reply
- sender rules
- the 90-day cleanup
- pilot settings and the report

**Architecture:**
- Pure rule modules live in `src/lib/inbox-org/` and know nothing about stores. A server pipeline module (`pipeline.ts`) reads stores and writes three new thread fields (`filing`, `court`, `noise`) through `patchDoc`. It runs after each Gmail import write and again after replies.
- AI steps reuse `runAssist` (new features `file` and `promise`) and run in a time-boxed pass at the end of each mailbox sync, so the import itself never waits on a model.
- The UI copies the Meetings box pattern (`src/app/(app)/inbox/meetings/*`).

**Tech stack:** Next.js 16, TypeScript, Drizzle doc tables (`comms`, `tasks`, blobs), `@anthropic-ai/sdk` via `runAssist`, zod, and the tsx harness (`scripts/test-assist.ts` style).

## Global Constraints

- **Spec** = `docs/superpowers/specs/2026-10-13-inbox-organization-design.md`. Read it; every rule there is a requirement.
- **Never auto-send.** Model output is untrusted. AI ids must come from a server-built candidate list, and team ids must be real. Thread text goes through the existing `<email_thread>` wrapper (`src/lib/assist/features/thread-text.ts`), and names are cleaned.
- **Who gets what:**
  - Pilot-only (via `assistGate`): AI steps, noise moved out of the inbox, promise-tasks, and the 90-day cleanup.
  - Everyone: rules, court rules, archive-on-reply (per-user opt-out), and the "Looks like noise" tag.
- **Archive and un-archive** always go through `comms.archive`/`unarchive` (or the same `dispatchInboxState` push), so Gmail stays in step.
- **Linking** reuses `linkThread` / `setLink` / `setThreadSite`, so `queueLabelSync` keeps mirroring Peak labels.
- **Tasks:**
  - Promise-tasks use `createTaskOnce` with id `T-prm-<shortHash(threadId|messageId|text)>`.
  - Due date is 5:00 pm Chicago. When no due phrase is given, it is 2 business days after the message.
  - Promise-tasks are never created during the 90-day backlog cleanup, only for mail that arrives after launch.
  - Tasks are never auto-closed.
- **Chicago time** everywhere. Reuse `src/lib/triage/clock.ts` and `src/lib/task-plan/due.ts`.
- **AI pass budget:** about 20 s per sync pass, oldest first. Unfinished threads stay `pendingAi` and resume on the next sync.
- **Pop-out ready:** every filing, court, noise or archive change from the UI posts `{type:"inbox-changed", threadId}` on `new BroadcastChannel("peak")`, inside a try/catch so browsers without it don't break.
- **Process rules** (as #334):
  - No `server-only` import, and a client component never imports a store (only `next build` catches this).
  - PGlite is single-process.
  - Never `git stash`.
  - Never `git add .superpowers/`.
  - Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Numbering:** punch #335 and D882–D890, but recheck `origin/main` at docs time.

## File structure

| File | Responsibility |
|---|---|
| `src/lib/inbox-org/types.ts` | `Filing`, `Court`, `NoiseFlag`, `SenderRule`, `CourtOwner` types |
| `src/lib/inbox-org/numbers.ts` | pure: find estimate / project / lead numbers in free text |
| `src/lib/inbox-org/noise.ts` | pure: noise-by-rules |
| `src/lib/inbox-org/forward.ts` | pure: forward detection + original-sender parse + FYI note |
| `src/lib/inbox-org/signoff.ts` | pure: sign-off-only detection |
| `src/lib/inbox-org/internal.ts` | pure: internal-address checker + own-domain derivation |
| `src/lib/inbox-org/court.ts` | pure: court by rules |
| `src/lib/inbox-org/due.ts` | pure: due-phrase → 5 pm Chicago ms; default 2 business days |
| `src/lib/inbox-org/sender-rules.ts` | pure: rule matching + precedence |
| `src/lib/inbox-org/ids.ts` | pure: `promiseTaskId` |
| `src/lib/stores/inbox-org.ts` | blobs: `inbox_sender_rules`, `inbox_filing_log`, `inbox_org_settings` (own-domain override); per-user `keepInInbox` pref (`notif_prefs` key) |
| `src/lib/inbox-org/pipeline.ts` | server: `organizeThread(threadId, opts)` (rules filing + court + noise), team/internal context loader |
| `src/lib/inbox-org/ai-filing.ts` | Haiku filing: candidate builder (server), prompt, schema, sanitizer |
| `src/lib/inbox-org/ai-court.ts` | Haiku court/promise reading: prompt, schema, sanitizer, promise → task |
| `src/lib/inbox-org/ai-pass.ts` | time-boxed AI pass over `pendingAi` threads |
| `src/lib/inbox-org/apply.ts` | server: approve / change / noise / not-noise / skip / undo / approve-all-strong / archive-after-reply |
| `src/lib/inbox-org/cleanup.ts` | 90-day cleanup batch runner (resumable state blob) |
| `src/app/(app)/inbox/organize/*` | `format.ts`, `load.ts`, `actions.ts`, `organize-box.tsx` (Meetings pattern) |
| `scripts/test-inbox-org.ts` | checks; `npm run test:inbox-org`; chained into `test:specs` |

---

### Task 1: Pure rules core

**Files:** create every pure module above (`types`, `numbers`, `noise`, `forward`, `signoff`, `internal`, `court`, `due`, `sender-rules`, `ids`), `scripts/test-inbox-org.ts`, and the `package.json` script `test:inbox-org` (same mktemp + cleanup pattern as `test:assist`). Wire the checks into `scripts/test-review-and-spec.ts` (import + `.then` chain after the assist checks).

**Interfaces (produce exactly):**

```ts
// types.ts
export type CourtOwner = "me" | "teammate" | "customer" | "nobody";
export type FilingSource = "rule" | "identity" | "number" | "noise-rule" | "ai";
export type Filing = {
  customerId: string | null; work: { type: "quote"|"lead"|"project"|"survey"|"inspection"; id: string; label?: string } | null;
  siteId?: string | null; noise: boolean; source: FilingSource; reason: string; strength: "strong" | "weak";
  needsReply: boolean; runId?: string; state: "suggested" | "filed" | "skipped" | "dismissed";
  at: number; filedBy?: "approved" | "reply" | "rule" | "teammate-reply"; filedAt?: number; pendingAi?: boolean;
};
export type Promise_ = { text: string; ownerUserId: string; due: number | null; taskId?: string; messageId: string };
export type Court = { owner: CourtOwner; teammateId?: string; reason: string; source: "rule" | "ai" | "override"; at: number; promise?: Promise_; pendingAi?: boolean };
export type NoiseFlag = { flagged: boolean; reason: string; moved: boolean; rescued?: boolean };
export type SenderRule = { id: string; scope: "user" | "company"; userId?: string; match: { email?: string; domain?: string };
  action: { type: "file"; customerId: string; work?: Filing["work"] } | { type: "noise" } | { type: "never-noise" }; createdBy: string; createdAt: number };
// numbers.ts
export function findEstimateNumbers(text: string): Array<{ raw: string; estNo: number; suffix: number | null; prefix: string }>; // EST|FLM|RIG|REP|RNT|CON|OPP-#### with optional -N; word-bounded; dedup; order of appearance
export function findRecordIds(text: string): { projects: string[]; leads: string[] }; // P-####, S-####, L-#### word-bounded
// noise.ts
export function noiseByRules(m: { labelIds?: string[]; bulk?: boolean; autoSubmitted?: boolean; fromEmail: string; subject: string },
  ctx: { knownContact: boolean; internalOnly: boolean }): { reason: string } | null;
// forward.ts
export function parseForward(subject: string, body: string): { isForward: boolean; original: { fromEmail: string; fromName: string; subject: string; date: string } | null; note: string; fyi: boolean };
// signoff.ts
export function isSignOff(body: string): boolean; // ≤ ~8 words after stripping quoted text/signature, no "?", matches the sign-off list
// internal.ts
export function ownDomainsFrom(teamEmails: string[], override?: string | null): string[];
export function makeInternalChecker(teamEmails: string[], ownDomains: string[]): (email: string) => boolean;
// court.ts
export type CourtMessage = { id: string; direction: "in" | "out"; fromEmail: string; body: string; subject: string; at: number };
export function courtByRules(msgs: CourtMessage[], ctx: { ownerEmails: string[]; isInternal: (e: string) => boolean; teamByEmail: Map<string, string> /* email→userId */ }): Omit<Court, "at" | "source">;
// due.ts
export function resolveDue(dueText: string, messageAt: number): number; // 5 pm Chicago; default +2 business days
// sender-rules.ts
export function matchSenderRule(rules: SenderRule[], sender: { email: string; userId: string }): SenderRule | null; // user>company, email>domain
// ids.ts
export function promiseTaskId(threadId: string, messageId: string, text: string): string; // "T-prm-" + short stable hash
```

**Behavior:** the spec's §1 steps 3–4 and §3 rules, verbatim.

- **`courtByRules` precedence:**
  1. If the last message is a forward from a teammate to the owner: `fyi` → nobody; otherwise → me.
  2. Last inbound from a non-internal sender: sign-off → nobody; otherwise → me.
  3. Last from the owner → customer.
  4. Last from an internal teammate → customer, `teammateId` set.
  5. Internal-only threads follow the same rules between teammates. A teammate's question to the owner → me.
- **Inbound internal mail:** treat inbound mail from an internal address as a teammate unless it is the owner's own address.

- [ ] **Tests:** write `innerChecks` covering every bullet in the spec §10 "Pure checks" list. Then confirm they fail (missing modules), implement, and confirm they pass. Include, at minimum:
  - an estimate number with suffix and a dead number (pure: just parse);
  - Gmail and Outlook forward formats (`---------- Forwarded message ---------` and `From: … Sent: … To: … Subject:`);
  - "Thanks!" vs "Thanks, can you resend?";
  - the internal checker with an override domain;
  - every due phrase on Mon/Fri/Sat anchors (Friday + 2 business days = Tuesday);
  - rule precedence;
  - id stability.
- [ ] Gates: `npm run test:inbox-org`, `npx tsc --noEmit -p .`. Commit `feat(inbox-org): pure rules core`.

### Task 2: Data fields, import headers, stores

**Files:** `src/lib/stores/comms.ts` (types only, plus a `setOrg(threadId, patch)` writer), `src/lib/gmail/mime.ts` (`ParsedInbound` + `parseInbound`), `src/lib/gmail/bridge.ts` (`recordMessage` copies the new message fields), and `src/lib/stores/inbox-org.ts`.

- `CommThread` gains `filing?: Filing; court?: Court; noise?: NoiseFlag`. `CommMessage` gains `bulk?: boolean; autoSubmitted?: boolean; fromEmail` (it already exists; confirm).
- `parseInbound` sets:
  - `bulk = !!List-Unsubscribe || /^(bulk|list|junk)$/i.test(Precedence)`;
  - `autoSubmitted = !!Auto-Submitted && !/^no$/i.test(Auto-Submitted)`.
- `recordMessage` copies them onto the message (both the new-thread and existing-thread paths).
- **`src/lib/stores/inbox-org.ts`:**
  - `getSenderRules()`, `addSenderRule(rule)` (cap 2,000, dedupe the same match + scope + user), `removeSenderRule(id, by)`.
  - `appendFilingLog(entry)` (cap 2,000, newest last).
  - `getOwnDomainOverride()` / `setOwnDomainOverride(v)`.
  - `keepInInbox(userName)` / `setKeepInInbox(userName, on)`, using the `notif_prefs` key pattern of `crmModeOn`/`setCrmMode`.
- `setOrg(threadId, patch: { filing?; court?; noise? })` is a `patchDoc` that merges only these three keys and **does not** bump `updatedAt` via `touch` (organization is metadata).
- **Tests (DB):**
  - the new header fields parse from a fake `GmailFullMessage`;
  - rules add, remove, cap and dedupe;
  - `setOrg` leaves other fields untouched;
  - the `keepInInbox` round trip.
- Gates + commit `feat(inbox-org): thread org fields, bulk/auto headers, sender-rule + log stores`.

### Task 3: Rule pipeline + import hook + court in the inbox

**Files:** `src/lib/inbox-org/pipeline.ts`, `bridge.ts` (hook), `comms.ts` (folder filters), `src/lib/triage/feeds/email.ts`.

- **`loadOrgContext()`**:
  - `teamEmails`: `activeUsers` email + googleEmail, plus `listConnections` addresses.
  - `ownDomains`: `ownDomainsFrom(teamEmails, override)`, which should yield `peaksystemsgroup.com`. Keep `INTERNAL_DOMAIN` in `inbox-identity.ts` consistent; export the shared checker and use it there.
  - `teamByEmail`, the sender rules, and pilot users (`assistSettingsOf(getSettings())` + `assistGate(...,"file")` and `"promise"`).
- **`organizeThread(threadId, opts: { ctx?; backlog?: boolean })`**:
  - Load the thread. Skip drafts and deleted threads.
  - **Filing:** skip when the existing filing is `filed`. Otherwise compute the rules filing in order:
    1. sender rule;
    2. identity (the thread's existing `resolution`/`customerId`: linked → strong, suggested → weak);
    3. numbers (forward-aware: use the original-sender content when `parseForward` finds one), resolved through `resolveQuoteInput` / `listDocsByField("leads","estNo")` / `getProject`, giving work + customer, strong;
    4. noise rules, with `knownContact` coming from an identity contact match.
  - **`needsReply`:** court owner === "me".
  - If the result is unresolved or only weak and the owner is pilot (`file`), set `pendingAi: true`.
  - **Noise:** pilot owners get `moved: true` and the thread is archived via `comms.archive`. Non-pilot owners get `moved: false` (tag only).
  - **Court:** `courtByRules` over the thread's messages. If the owner is pilot (`promise`), the latest message isn't a sign-off, and `!opts.backlog`, set `pendingAi: true`. Keep an override until a newer message arrives.
  - **Sync `status`:** me → `waiting_us`, customer → `waiting_them`, nobody → `closed`. Write via `comms.setStatus`, which queues the label sync, only when it differs.
  - **Un-archive:** if the thread is archived and the new court is me because of a message newer than the archive, unarchive.
  - Write through `setOrg`. Append to the filing log for rule-sourced suggestions.
- **Hook:** in `recordMessage`, after a successful write on both paths, call `organizeThread(id)` in a try/catch that never fails the import.
- **Teammate-reply archiving (everyone):** when the court changes to customer/nobody because of a **teammate's** message (not the owner's), run the archive-after-reply rule (Task 5 helper; stub it here behind a TODO-free call that Task 5 fills, or do it in Task 5 and only compute here; choose the latter).
- **Folder filters:** `noise.moved` threads are archived, so they already leave the inbox. Add a `noise` folder query `threadsIn(...,"noise")` (flagged && moved && !deleted) for the Organize tab.
- **Triage email feed:** select by `court?.owner === "me"`. Fall back to `status === "waiting_us"` when `court` is absent. Keep the existing assignedTo/visible rules.
- **Tests (DB, fake threads):**
  - a number in the subject links the quote (strong);
  - a sender rule wins;
  - a known contact is never noise;
  - pilot noise is moved and archived; non-pilot noise is tagged only;
  - a teammate's last message → court customer and status `waiting_them`;
  - forward from a teammate → me; FYI forward → nobody;
  - the triage feed respects court;
  - `organizeThread` errors never break `recordMessage`.
- Gates + commit `feat(inbox-org): rule pipeline on import, court-driven status + triage`.

### Task 4: AI steps (Haiku) + time-boxed pass

**Files:** `src/lib/assist/types.ts` + `config.ts` + `run.ts` + `report.ts` (add features `file`, `promise`), `ai-filing.ts`, `ai-court.ts`, `ai-pass.ts`, and the `bridge.ts` call at the end of `syncMailbox`.

- **Features:** add `file` and `promise` to `AssistFeature`, `ASSIST_FEATURES`, `RATE_LIMITS` (file 600/h, promise 600/h; they run in background passes), `assistSettingsOf` defaults (on), the pilot card toggles (Task 7) and `featureKey` in the report. Model slot `file` = `promise` = Haiku (`DEFAULT_MODELS` gains `file`, `promise` → `claude-haiku-5-5`, effort low, `maxTokens` 2000; env `ASSIST_MODEL_FILE` / `ASSIST_MODEL_PROMISE`).
- **`ai-filing.ts`:**
  - **`buildFilingCandidates(thread)`**:
    - the likely customer (thread customerId / suggestedCustomerId / domain owner);
    - that customer's open quotes (draft/sent), active projects and open leads, newest 15;
    - top 5 company matches for organisation names (use the company search behind `searchLinkTargetsAction`'s `companies`, extracted into a pure-input helper if needed).
    - Format each as `id | type | label | customer`.
  - **Schema:** `{ target: string, confidence: "strong"|"weak", reason: string, needsReply: boolean }`.
  - **`sanitizeFiling(raw, candidates, matchedCustomerId)`**:
    - Accept `target ∈ candidate ids ∪ {"none","noise"}`.
    - `strength` = strong only if the model said strong **and** the target belongs to the matched customer (or is that customer itself).
- **`ai-court.ts`:**
  - **Input:** the last 3 messages (wrapper), the team list `id — name`, the thread owner, today.
  - **Schema:** `{ owner, teammateId, reason, promises: [{ text, ownerUserId, dueText }] }`.
  - **Sanitize:** drop unknown ids, cap at 3 promises, trim the text.
  - **`applyPromises(thread, msg, promises, nowMs)`:** for each promise,
    - owner = sanitized `ownerUserId` || (internal author's userId) || thread owner;
    - due = `resolveDue(dueText, msg.at)`;
    - `createTaskOnce({ id: promiseTaskId(...), title, section: "Email", assigneeUserId, dueAt: due, threadId, customerId, siteId, quoteId/projectId/leadId from filing.work, notes: "From email: " + text }, owner)`.
    - Set `court.promise`. Only for messages that arrived after launch (`!backlog`).
- **`ai-pass.ts` → `runAiPass({ budgetMs = 20_000, onlyUserId? })`:**
  - Select visible, non-deleted threads with `filing.pendingAi || court.pendingAi`, oldest message first.
  - For each: filing → `runAssist(feature "file")`; court → `runAssist(feature "promise")`.
  - Write via `setOrg`, clear `pendingAi`, and stop at the budget.
  - When AI is gated off for the owner, clear `pendingAi` without a call.
  - Errors are logged and leave `pendingAi` set for the next pass (max 3 attempts tracked by an `aiAttempts` counter on the field).
  - Call it at the end of `syncMailbox` in its own try. Also export `runAiPassAction` for the Organize "Sync now"-style button.
- **Tests (fake providers via `RunDeps`):**
  - a strong pick inside the candidates;
  - an out-of-list id dropped;
  - strong downgraded to weak when off-customer;
  - "noise" moves the thread for a pilot owner;
  - court: hand-off to a named teammate → me; "someone will be in touch" → promise owned by the internal author;
  - an unknown name is dropped;
  - a promise-task is created once (re-run idempotent) with the correct due date;
  - backlog → no task;
  - the budget stops the pass;
  - gated-off owner → no call.
- Gates + commit `feat(inbox-org): Haiku filing + court/promise reading, time-boxed AI pass`.

### Task 5: Apply actions + archive-on-reply

**Files:** `src/lib/inbox-org/apply.ts`, `comms.ts` (reply / addMessage / setStatus hooks), `src/app/(app)/inbox/actions.ts` (Mark replied / Close).

- **`apply.ts`** (all take `me: {id, name}`; check `visibleTo`; write through existing link/archive functions; log outcomes):
  - `approveFiling(threadId, me)`:
    - Link the customer (`linkThread`), the work (`setLink`) and the site (`setThreadSite`).
    - `filing.state = "filed"`, `filedBy: "approved"`.
    - Archive if `!needsReply || court.owner !== "me"`.
    - Record the `assist_runs` outcome `accepted` for an AI source.
  - `changeFiling(threadId, target, me)`: same as approve, but the outcome is `edited`. Return a `ruleOffer` for the sender (email + domain).
  - `markNoise(threadId, me)` / `notNoise(threadId, me)`: notNoise unarchives, sets `rescued`, and returns a `ruleOffer`.
  - `skipFiling`.
  - `undoFiling(threadId, me)`: unlink (setLink null, customer link cleared only if it was set by this filing), remove the label via the existing sync, unarchive, and set `state: "suggested"`.
  - `approveAllStrong(ids | "all-visible", me)`.
  - `acceptRuleOffer(offer, scope, me)`: company scope requires `manage_users`. It adds the rule, then re-sweeps that sender's unfiled threads via `organizeThread`.
  - `archiveAfterReply(threadId, by: "reply" | "teammate-reply", me?)`:
    - Do nothing if the owner's `keepInInbox`.
    - If the thread is linked or has a strong suggestion, file it (`filedBy`).
    - Then archive.
  - `overrideCourt(threadId, owner, me)`.
- **`comms.reply`** (and `replyAll`/`forward` to the same thread): after `addMessage` succeeds, `organizeThread` (court → customer), then `archiveAfterReply(id, "reply")`.
- **`addMessage` un-archive rule:** stop un-archiving on **outbound** messages. Inbound still un-archives as today; `organizeThread` re-archives teammate replies via `archiveAfterReply(id, "teammate-reply")` when the court is customer/nobody. Check the Inbox's draft and outbox behavior is unchanged.
- **Mark replied / Close** (`setStatusAction` with `"replied"`/`"closed"`): also `archiveAfterReply`.
- **Tests (DB):**
  - approve links + labels queued + archives only when no reply is needed;
  - undo restores;
  - reply archives (setting off → stays);
  - a teammate reply archives and the court is customer;
  - a hand-off un-archives;
  - the rule offer → rule → re-sweep files a second thread from the same sender;
  - a company rule needs admin;
  - approve-all-strong only touches strong rows.
- Gates + commit `feat(inbox-org): approve/undo/rules + archive-on-reply`.

### Task 6: Organize view + reader UI

**Files:** `src/app/(app)/inbox/organize/{format.ts,load.ts,actions.ts,organize-box.tsx}`, `inbox/page.tsx` (route `?view=organize` like meetings, nav row with the To file count), `inbox-shell.tsx`, `thread-reader.tsx`, `types.ts` (`ReaderVM` additions).

- **Tabs:** To file / Noise / Filed (last 14 days, cap 200), with rows, buttons and confirms per spec §2.
  - Change… reuses the existing link search. Add quotes/projects/leads for the thread's customer as a second group, fed from `buildFilingCandidates`' customer records.
  - The rule-offer banner appears after Change/Not noise.
  - "Organize my inbox" is pilot-only (Task 7 runner) and shows progress.
- **Reader:**
  - A court chip: "On you: …" / "On Dana" / "Waiting on customer" / "Done".
  - "Not on me" / "On me" override buttons.
  - A "Looks like noise" tag (non-pilot) with Not noise.
  - "Task created: … · due Thu · Undo" for `court.promise.taskId`; Undo soft-deletes the task and logs `discarded`.
  - A filing line with an Approve button when `state === "suggested"`.
  - Composer: when an open promise-task exists, an unticked "Mark '…' done?" checkbox above Send. On send, if ticked, complete the task via the existing task status action.
- **BroadcastChannel:** post on every change. The Inbox shell and Home listen and call `router.refresh()`.
- **Client-bundle rule:** client files import only actions and pure modules.
- **Tests:** source pins (Organize route exists; no store import in client files), plus action-level checks via the Task 5 functions. Run `next build`.
- Gates + commit `feat(inbox-org): Organize view + reader court/noise/promise UI`.

### Task 7: 90-day cleanup, settings, report

**Files:** `cleanup.ts`, the Organize actions, the account page (keep-in-inbox toggle + my sender rules list with delete), the settings assist card (`file` / `promise` toggles, company sender rules list with delete, own-domain override field), and `settings/assist-data.ts` + `src/lib/assist/report.ts` (filing / court rows).

- **`runCleanupBatch(me, budgetMs = 40_000)`:**
  - The state blob `inbox_cleanup:<userId>` holds `{ startedAt, cursor, checked, total, done }`.
  - It walks the user's visible inbox threads with last activity ≤ 90 days that aren't filed.
  - It calls `organizeThread(id, { backlog: true })`, then the AI filing for `pendingAi` threads within budget (AI court is skipped for backlog).
  - It is resumable and re-runnable (it skips filed threads and threads already suggested in this run).
- **Report rows:**
  - filings by source;
  - % approved as suggested (from `assist_runs` outcomes + the filing log);
  - corrections;
  - noise rescues;
  - promise-tasks created / undone.
- **Tests:**
  - the cleanup is resumable across two batches, makes no tasks and only suggests;
  - the report math;
  - the account toggle persists;
  - the rules list delete.
- Gates + commit `feat(inbox-org): 90-day cleanup, settings, report`.

### Task 8: Docs + full gates + push prep

- DECISIONS D882–D890 (recheck numbering), PUNCHLIST #335, AGENTS phase 54, MASTER-HOWTO section, `.env.example` (`ASSIST_MODEL_FILE`/`PROMISE`).
- Full gates: `test:inbox-org`, `test:assist`, tsc, eslint (changed files), next build, `test:specs` (0 FAIL; update any stale pins this branch breaks, keeping their intent), `test:smoke` (free disk first; clean temp dirs older than 60 min; `lsof :3000`).
- Commit docs. Pushing is done by the controller after the final review.
