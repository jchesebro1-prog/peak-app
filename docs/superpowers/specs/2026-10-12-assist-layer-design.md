# Assist layer — design (punch #334, D869–D880)

Brief: `2026-10-12-assist-layer-brief.md` (Jeff's decisions are locked there).
This spec turns the brief into code-level design. It reverses D89's posture
**as an opt-in trial**: D89's deleted features stay deleted, and every
deterministic path keeps working unchanged when Assist is off.

## 1. Goals / non-goals

**Goals.** Three Inbox-reader actions on an email thread:

1. **Suggest tasks** (Haiku 5.5). The user ticks suggestions, which become
   tasks through the existing #215 path.
2. **Draft reply** (Sonnet 5.5). Text goes into the inline reply composer and
   never sends on its own.
3. **Draft estimate** (Haiku 5.5 extracts, then Opus 5.5 drafts). The result is
   a new draft Estimator system quote, priced by the existing pricing helpers.

Every call is logged to `assist_runs` together with its outcome. Settings →
Beta gains an Assist pilot card with the allow-list, feature toggles, the
monthly cap and a report.

**Non-goals.** No chat or Q&A, no tool use or agents, no auto-send, auto-link
or status changes, no portal surface, no rewrite of any deterministic feature,
no flame/inspection/Grid drafting, and no streaming UI.

## 2. Gate (D869)

A button renders, and its action runs, only when **all** of the following
hold:

- `ASSIST_DISABLED !== "true"`.
- A provider is configured: `ANTHROPIC_API_KEY` is set, or
  `ASSIST_PROVIDER=local` **and** `ASSIST_LOCAL_URL` is set.
- `settings.assistUsers` includes the user's id. **An empty list means
  nobody** (the opposite of `recordingsBetaUsers`).
- `settings.assistFeatures[feature] !== false`. Missing keys count as on.
- The thread is an email thread (`vm.isEmail`) the user can see
  (`visibleTo`).

The action re-checks all of this on the server. When the gate fails, the
action returns `{ ok:false, error }` and makes no network call.

`assistGate(feature, user, settings)` is a pure function returning
`{ ok:true } | { ok:false, reason }`.

`assistUiFlags(user, settings)` returns `{ tasks, reply, estimate }` booleans,
which the Inbox page passes to the reader.

## 3. Module layout

```
src/lib/assist/
  types.ts        AssistFeature, AssistStep, AssistRequest, AssistResult, ProviderUsage
  models.ts       per-feature model defaults + env overrides; MODEL_PRICES; costUsd()
  config.ts       assistConfigured(), assistGate(), assistUiFlags(), monthKeyChicago()
  provider.ts     interface AssistProvider; pickProvider()
  anthropic.ts    Claude provider (@anthropic-ai/sdk 0.128.0, beta messages)
  local.ts        OpenAI-compatible HTTP provider (Ollama / LM Studio / MLX)
  run.ts          runAssist(): gate → cap → rate limit → provider → validate → log
  outcome.ts      pure: editRatio(), replyOutcome(), estimateKeep()
  features/
    task-suggest.ts    prompt + zod schema + sanitizeTaskSuggestions()
    reply-draft.ts     prompt builder + style examples + cleanReplyText()
    estimate-draft.ts  extract prompt/schema, draft prompt/schema, candidate builder, buildDraftSections()
src/lib/stores/assist-runs.ts   doc-table store (create, setOutcome, listMonth, listSince)
src/app/(app)/inbox/assist-actions.ts   three server actions + outcome actions
src/app/(app)/inbox/assist-tasks-dialog.tsx   client dialog
src/app/(app)/settings/groups/assist-pilot.tsx  Beta card (client)
```

Feature modules are **store-decoupled** (as in D41). They take typed context
and return prompt material and validators. The actions in
`assist-actions.ts` read stores, call `runAssist`, and write through the
existing store paths.

## 4. Models, routing, cost (D870)

| Feature/step | Default model | Effort | max_tokens | Timeout / retries | Call | Fallbacks |
|---|---|---|---|---|---|---|
| `tasks` | `claude-haiku-5-5` | low | 4000 | 60 s / 1 | create | none (Haiku has none) |
| `reply` | `claude-sonnet-5-5` | low | 4000 | 60 s / 1 | create | `"default"` |
| `estimate:extract` | `claude-haiku-5-5` | low | 4000 | 45 s / 0 | create | none |
| `estimate:draft` | `claude-opus-5-5` | medium | 32000 | 210 s / 0 | stream | `"default"` |

- **Env overrides:** `ASSIST_MODEL_TASKS`, `ASSIST_MODEL_REPLY`,
  `ASSIST_MODEL_ESTIMATE` (the draft step) and `ASSIST_MODEL_EXTRACT`.
- **Fallbacks.** When `fallbacks:"default"` is sent, the request also carries
  `betas:["server-side-fallback-2026-07-01"]` and goes through
  `client.beta.messages.create`. Every request uses the beta path, so there is
  one code shape.
- **Thinking.** The `thinking` param is never sent: all three models run
  adaptive by default, and `disabled` 400s on Sonnet and Opus. Effort goes in
  `output_config.effort`.
- **Structured output.** When a feature has a schema, it is sent as
  `output_config.format = { type:"json_schema", schema }`. The schema is built
  with `z.toJSONSchema(zodSchema)` from `z.strictObject` schemas and carries no
  length or size keywords; those limits are enforced server-side in
  `sanitize*`. The response text is parsed with `JSON.parse` and validated
  again with zod. Forced `tool_choice` is never used.
- **Stop reasons.** Before reading content, check `stop_reason`:
  `refusal` → `{ok:false, error:"declined"}`, `max_tokens` →
  `{ok:false, error:"too long"}`. Otherwise concatenate the `text` blocks.
- **Prompt caching.** The system prompt is one text block with
  `cache_control:{type:"ephemeral"}`. Volatile content goes in the user
  message.
- **Request budget.** Each slot's `timeoutMs` / `maxRetries` (`SLOT_SETTINGS`,
  read through the pure `requestOptionsFor(slot)`) go to the SDK **per
  request** — `client.beta.messages.create(params, { timeout, maxRetries })` —
  never on the client, so the cached client carries no timeout and there is no
  `ASSIST_TIMEOUT_MS`. The SDK retries timeouts too, so a slot's worst case is
  timeout × (retries + 1). Extract + draft (45 s + 210 s) fit the Inbox page's
  `maxDuration = 300`.
- **Streaming draft.** The estimate draft runs through
  `client.beta.messages.stream(params, opts).finalMessage()` (SDK 0.128.0
  accepts `betas` and `fallbacks` on the stream params) at 32 000 max_tokens,
  so adaptive thinking can't push it into "too long". The SDK timeout only
  covers the response headers on a stream, so the stream gets its own
  wall-clock abort at the slot timeout ("timed out").
- **Time budget.** `draftEstimateFromThread` records its start; before the draft
  call it refuses with "Assist ran out of time before drafting" when less than
  `DRAFT_MIN_REMAINING_MS` (220 s) of `ESTIMATE_BUDGET_MS` (300 s) is left,
  logs the refusal and stamps `draftSkipped:"time budget"` on the extract run.

**Cost.** `MODEL_PRICES` maps each model to $/MTok for input, output, cache
read and cache write:

| Model | Input | Output | Cache read | Cache write |
|---|---|---|---|---|
| `claude-haiku-5-5` | 0.10 | 0.50 | 0.01 | 0.125 |
| `claude-sonnet-5-5` | 2 | 10 | 0.20 | 2.50 |
| `claude-opus-5-5` | 4 | 20 | 0.20 | 5.00 |
| `claude-opus-5` | 5 | 25 | 0.50 | 6.25 |
| `claude-fable-5-1` | 10 | 50 | 1.00 | 12.50 |

- Haiku's rates step to 0.50 / 2.50 when a prompt's total input is over
  100 000 tokens.
- Cache-write rates are an assumed 1.25× input. Haiku's cache-read rate is an
  assumed 0.1× input. The report labels all costs "estimated".
- A local run costs $0.
- A Claude run is priced by `claudeCostUsd(response.model, requestedModel,
  usage)` (pure): the answering model's row; when `response.model` isn't in
  the table (a server-side fallback or a dated alias), the requested model's
  row; when that is unknown too, the dearest row in the table — never $0.

## 5. Providers (D871)

```ts
interface AssistProvider {
  name: "anthropic" | "local";
  complete(req: ProviderRequest): Promise<ProviderResult>;
}
type ProviderRequest = { model: string; system: string; user: string; jsonSchema?: object;
  effort: "low"|"medium"|"high"; maxTokens: number; fallbacks: boolean;
  timeoutMs?: number; maxRetries?: number; stream?: boolean };   // from SLOT_SETTINGS
type ProviderResult =
  | { ok: true; text: string; model: string; usage: ProviderUsage; stopReason: string }
  | { ok: false; error: string; model: string; usage: ProviderUsage | null; stopReason: string | null };
```

- **`anthropic.ts`** constructs `new Anthropic({ apiKey })` lazily, once per
  key; timeout and retries come per request from `anthropicRequestOptions(req)`
  (§4). Typed SDK errors become short messages: 429 → "rate limited", 401 →
  "API key rejected", a timeout (or the stream's own abort) → "timed out",
  5xx/connection → "service unavailable".
- **`local.ts`** sends `POST {ASSIST_LOCAL_URL}/v1/chat/completions` with
  `Authorization: Bearer ASSIST_LOCAL_TOKEN`, body
  `{ model, messages:[system,user], response_format?: {type:"json_schema", json_schema:{name:"out", schema}} , max_tokens }`
  and an AbortController timeout of `ASSIST_LOCAL_TIMEOUT_MS` (default 60 000).
  The model comes from `ASSIST_LOCAL_MODEL` and overrides the Claude model id.
  Usage comes from `usage.prompt_tokens` / `completion_tokens`, and cost is 0.
- **`pickProvider(env)`.** With `ASSIST_PROVIDER=local`, it returns the local
  provider, with the Anthropic provider as a fallback when an API key exists.
  The fallback runs on **Haiku 5.5** for every feature, per Jeff's decision.
  Otherwise it returns the Anthropic provider.
- **Fallback path.** `runAssist` handles it. If the local result is
  `ok:false` with a network or timeout error and a fallback is configured, it
  re-runs once on Anthropic with model `claude-haiku-5-5` and logs
  `provider:"anthropic", fellBack:true`.
- **Tests** inject a `FakeProvider` through `runAssist(..., { provider })`.

## 6. `runAssist` and `assist_runs` (D872)

```ts
runAssist<T>(args: {
  feature: AssistFeature; step?: AssistStep; user: {id:string; name:string};
  system: string; userText: string; schema?: z.ZodType<T>;
  contextRef: string;            // "thread:C-1234"
  extraDetail?: Record<string, unknown>;
}, deps?: { provider?: AssistProvider; now?: number; settings?: AppSettingsLike })
: Promise<{ ok: true; runId: string; value: T | string } | { ok: false; runId: string | null; error: string }>
```

The steps run in this order:

1. **Gate.** `assistGate`. A failure returns with no log row.
2. **Cap.** `monthSpend(monthKeyChicago(now)) >= settings.assistMonthlyCapUsd`
   (default 200) → `{ok:false, error:"Assist paused for the month (cap reached)"}`,
   with no log row.
3. **Rate limit.** `rateLimit("assist:"+feature+":"+user.id, LIMIT[feature], 3_600_000)`.
   The limits are tasks 60, reply 60, estimate 20 (counted once per button press, on the extract step; the draft step passes `countRate:false`).
4. **Provider call.** Uses the model and settings from §4, including the
   slot's timeout, retries and stream flag.
5. **Validate.** With a schema, run `JSON.parse` then `schema.safeParse`. A
   failure gives `ok:false, error:"unreadable answer"`, and the row is still
   logged.
6. **Log.** Write an `assist_runs` row whether the call succeeded or failed,
   then return. `costUsd` is `claudeCostUsd(response.model, requested, usage)`
   for Claude and 0 for a local run (§4).

The three Inbox actions also check `assistGate` **first**, before loading the
thread, quotes or comms (full-table loads), and return `{ok:false, error}` on a
refusal; `runAssist` keeps its own gate. The Suggest tasks, Draft reply and
Draft estimate buttons carry a `useRef` in-flight guard against a double
click.

**`assist_runs` doc table** (migration `0039_assist_runs`, idempotent per
D141). The doc shape:

```ts
type AssistRun = {
  id: string;               // "AR-" + Date.now().toString(36) + random 4
  feature: AssistFeature; step: AssistStep | null;
  userId: string; userName: string;
  provider: "anthropic" | "local"; model: string; requestedModel: string; fellBack: boolean;
  inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number;
  costUsd: number; latencyMs: number;
  inputHash: string;         // sha256 of system+"\n"+user, hex
  output: string;            // raw text, capped at 20 000 chars
  ok: boolean; error: string | null; stopReason: string | null;
  contextRef: string; monthKey: string;   // "2026-10" (America/Chicago)
  outcome: "accepted" | "edited" | "discarded" | null; outcomeDetail: Record<string, unknown> | null;
  outcomeAt: number | null; createdAt: number;
};
```

- **Store** (`src/lib/stores/assist-runs.ts`):
  - `createRun(run)`
  - `setRunOutcome(id, userId, outcome, detail)` — first write wins, and only
    the run's own user may set it.
  - `listRunsByMonth(monthKey)`, using `listDocsByField("assist_runs","monthKey",[k])`.
  - `monthSpend(monthKey)`.
  - `getRun(id)`.
- **Registration.** `assist_runs` is registered in `DOC_TABLES` and listed in
  `CONFIG_COLLECTIONS`, so the go-live wipe keeps the trial's history and its
  spend.

## 7. Feature: Suggest tasks

**Context** (built in the action):

- Thread subject, plus the last 8 messages oldest-first, each as
  `direction · author · date` and the body trimmed to 2 000 chars.
- Today's date (Chicago, `YYYY-MM-DD`, weekday).
- The team as `{id, name}`.
- Link candidates from `threadTaskLinkCandidates`, as `{key, label}`.

**Schema** (zod `strictObject`):

```
{ tasks: Array<{ title: string; notes: string; dueDate: string; assigneeUserId: string;
                 linkKeys: string[]; tier: "high"|"normal"|"low"; size: "s"|"m"|"l" }> }
```

The system prompt asks for 0–5 concrete follow-ups that the Peak staff member
(not the customer) must do, uses empty strings when unknown, and never invents
people or dates the thread doesn't support.

**`sanitizeTaskSuggestions(raw, ctx)`** (pure) applies these rules:

- Keep at most 5 tasks.
- Trim the title to 200 chars and drop a task whose title is empty.
- Trim notes to 1 000 chars.
- `dueDate` must match `^\d{4}-\d{2}-\d{2}$` and be ≥ today, else `""`.
- `assigneeUserId` must be in the team, else `""` (which means "me").
- Keep only `linkKeys` that are in the candidate set. `"thread"` is always
  included.
- Drop duplicate titles, compared case-insensitively.
- Clamp `tier` and `size` with `cleanTier` / `cleanSize`, defaulting to
  `DEFAULT_TIER` / `DEFAULT_SIZE`.

**UI.** A "Suggest tasks" button sits in the reader's status row, next to the
existing Task control. It opens `AssistTasksDialog`, which lists the
suggestions as editable rows: checkbox, title, due date, assignee select, tier
and size chips, and link chips. "Create N tasks" calls the existing
`createTaskFromThreadAction` once per ticked row, in order.

**Outcome.** On close, the dialog calls
`recordAssistOutcomeAction(runId, outcome, detail)`:

- `accepted` — every suggestion was ticked and none was edited.
- `edited` — at least one was created and at least one was edited or
  unticked.
- `discarded` — none were created.

The detail is `{ suggested, created, edited }`.

## 8. Feature: Draft reply

**Context:**

- The thread's last 10 messages, oldest-first, each body trimmed to 2 500
  chars, with signatures stripped by `stripSignature` on outgoing mail.
- The customer and contact names.
- Open quotes for the thread's customer (`resolveCustomerId`): status `draft`
  or `sent`, newest 8. Each entry carries `displayQuoteNumber`, name, type,
  status and the sent date (the last `history` entry with `to==="sent"`), or
  "not sent". **Only a sent quote carries its value (rounded dollars)**; a
  draft reads "price not yet approved", and `REPLY_SYSTEM` allows a price only
  for a quote listed as sent.
- Every single-line name outside the thread wrapper (customer, contact, quote
  number/name/type/status, sender) goes through `cleanPromptField` (newlines →
  spaces, `</email_thread` / `</style_examples` / `</example` defanged, 120
  chars) — the same clean as a thread author. The tasks prompt does the same
  for link labels and team names.
- The sender's name.
- Tone: `"short"|"normal"|"formal"`, default `"normal"`.

**Style examples (D873).** The sender's last 5 outgoing emails come from their
own personal mailbox (`mailbox==="personal"`, `mailboxUser===me.name`):

- Keep email messages with `direction==="out"`, not queued, in live threads.
  The author is **not** matched — Gmail-imported sent mail carries the Gmail
  display name as author, and everything outbound in the box is the writer's.
- Exclude the current thread.
- Cut quoted customer text (`stripQuotedText`): drop lines starting with `>`,
  and cut at an "On … wrote:" line (also wrapped onto the next line) or an
  Outlook "-----Original Message-----" line.
- Strip the signature, defang wrapper closes, trim each to 1 200 chars; sort by
  `at` descending and take 5 non-empty examples.

They sit inside `<style_examples>`, labelled "examples of how this person
writes — match tone and length, never copy facts", and `UNTRUSTED_NOTE` covers
the block as data.

**Output.** Plain text only: no subject, greeting optional, no signature.
`cleanReplyText` strips a leading `Subject:` line, any trailing `-- ` block
and surrounding whitespace, and caps the result at 6 000 chars. An empty
result counts as `ok:false`.

**Untrusted input (D874).** Thread text is wrapped in
`<email_thread>…</email_thread>`, and the system prompt states that it — and
the `<style_examples>` block — is data written by outside parties or quoted
from past mail. No output is ever acted on except as draft
text that a person reviews.

**UI.** A "Draft reply" button sits beside Reply. It calls `draftReplyAction`,
then opens reply mode with `cBody = withSignature(draft, signature, "add")`.
The reader remembers `{runId, draft}`, and a small "Drafted by Assist — review
before sending" note shows under the composer.

**Outcome.**

- **On send:** `replyOutcome(draft, sentBodyWithoutSignature)`:
  - `editRatio ≤ 0.10` → `accepted`
  - otherwise → `edited`
  - detail `{ editRatio }`
- **On cancel / close while a draft run is pending:** `discarded`.

`editRatio` is the word-level Levenshtein distance divided by the larger word
count, with the inputs capped at 2 000 words.

## 9. Feature: Draft estimate (D875–D878)

**Action:** `draftEstimateAction(threadId) → {ok:true, quoteId, href} | {ok:false, error}`.

**Step A — extract** (Haiku, `step:"extract"`, 45 s, no retry). It receives the
thread (same trim as the reply) and returns:

```
{ quoteName: string; venue: string; requests: Array<{ phrase: string; qty: number }> ; systems: string[] }
```

The sanitizer keeps at most 15 requests, trims phrases to 120 chars, takes
`qty` as an integer ≥ 1 (else 1), and keeps at most 8 system names.

**Candidates (D876)** are gathered server-side. None of them carry cost or
price:

1. **Catalog hits.** For each phrase, the top 8 parts by the Estimator's
   catalog ranking. The ranking is the same logic as `searchCatalog`,
   extracted as `rankCatalogParts(parts, query, limit)` so it can run without
   a request scope; `searchCatalog` calls the shared function.
2. **Similar past systems.** `searchSystemLibrary(await systemLibraryIndex(), phrases.join(" ") , {limit:5})`
   with per-token matching, falling back to each system name. For each entry,
   read its quote's section items (sku, desc, qty), skipping labor sections.
3. **This customer's past quotes.** `listDocsByField<Quote>("quotes","customerId",[cid])`,
   keeping `quoteType==="system"` and source not `daylite`, newest 5, with
   their materials sections' items (sku, desc, qty).
4. **System categories.** `getSystemCategories()`: each category's items
   (sku, qty, note) and its id and name.

**Resolution.** Every SKU from 1–4 is resolved with `getManyBySku`, which
follows renames. A SKU with no live part is dropped. The candidate list given
to the model is
`{ sku, desc, mfr, unit, category }`, capped at 400 parts. **Category items and
example lines (4, then 2, then 3) take their seats in the cap first; catalog
hits (1) fill the rest** (pure `selectCandidateParts`). The examples (2 and 3)
and category items are shown as `system name: sku×qty, …` under each line's
**live (renamed) SKU**; a line whose SKU didn't resolve or didn't make the cap
is dropped (pure `remapExampleLines`), so the model never sees a SKU it may not
use.

**Step B — draft** (Opus, `step:"draft"`, streamed, 32 000 max_tokens, 210 s,
no retry; it starts only with ≥ 220 s of the 300 s budget left — §4). The input
is the request summary,
the thread, the categories, the examples and the candidate parts. The output
schema:

```
{ quoteName: string;
  systems: Array<{ name: string; categoryId: string;
    lines: Array<{ sku: string; qty: number; desc: string; reason: string }> }>;
  notes: string }
```

The rules, stated in the prompt and **enforced in `buildDraftSections`**:

- `sku` must be a candidate SKU or `""`. An empty SKU makes a custom line
  using `desc`.
- `qty` is an integer from 1 to 9999.
- Keep at most 12 systems and 60 lines per system.
- Never output prices.

**`buildDraftSections(draft, ctx)`** is pure. Its context is:

```
ctx = { parts: Map<string, CatalogPart>, candidateSkus: Set<string>, tierMargin: number,
        firstLineId: number, newSectionId: () => string, freightPct: number, priceRound: ... ,
        categories: SystemCategory[] }
```

It produces `SpecSection[]` with `kind:"materials"`. Each system's
`discipline` comes from its matching category when `categoryId` matches.

- **Catalog line:** `{ id, sku, desc: part.desc, qty, unit: part.unit, cost: part.cost, price: catalogAddPrice(part.cost, part.list, tierMargin) }`.
- **Unmatched or empty SKU:** `{ id, sku:"", desc, qty, unit:"ea", cost:0, price:0, custom:true, internalNote:"Assist: needs a part and price" }`.
- An empty system is dropped.
- It returns `{ sections, reasons: Record<lineId, string>, lines, dropped, unresolved }`: `dropped` counts blank lines removed; `unresolved` counts SKUs outside the candidate set, kept only as custom lines.
- Line ids are unique across the whole drafted quote (the Estimator finds and removes a line by id alone), and each system gets `priceRound` of $25, like the Estimator's own new-system path.
- Freight and price rounding use the same defaults the Estimator applies to a
  new section. The plan reads those from `freight-default.ts` and the section
  factory.

**Create (D877).** The quote is created through the same chain as the
new-estimate branch of `placeSystemInEstimate`:

```
resolveTier(cid, contactName) → canonicalBonusSections({source:"estimator",status:"draft"}, sections)
→ totals(sections, 0) → create({ name, customer, customerId, contactName, source:"estimator",
  quoteType:"system", spec:{sections, mobs:[]}, value, margin, owner:me.name, preparedBy:me.name,
  pricingTier, tierMargin }) → update(q.id, { assistDraft }) → scheduleQuotePdf(q.id)
```

- **No `leadId`**, even when the thread is linked to a lead: it would carry the
  lead's estimate number (#223) onto a throw-away draft and stretch "no
  auto-link". The thread reference lives in `assistDraft.threadId` only.
- Once `create` has returned, the rest is best-effort: a failing
  `assistDraft` write is logged, `mergeRunDetail(runId, { quoteId: q.id, … })`
  still runs (in a `finally`), and the action returns ok with the quote — a
  retry would only create a duplicate.

- `source` stays `"estimator"`, so bonuses, approval, the library and
  everything else behave exactly as they do for a hand-built estimate. The
  Assist origin is recorded only in the new optional `Quote.assistDraft`:
  `{ runId, threadId, at, notes, reasons, dismissedAt? }`.
- The thread's link is **not** changed (guardrail: no auto-link).
- The action returns `href = quoteBuilderHref(q)`, and the client navigates
  there.

**Banner (D878).** `EstimatorProps.assistDraft` comes from the loaded quote.
`AssistDraftBanner` shows:

- "Drafted from an email by Assist — check every line before submitting".
- A link to `/inbox?thread=<threadId>`.
- The model's `notes`.
- A collapsible "Why these parts" list (line desc → reason) for lines that
  still exist.
- A "Dismiss" button. It calls `dismissAssistDraftAction(quoteId)`, which sets
  `assistDraft.dismissedAt` through the quotes store's `update` (a shallow
  merge of the `assistDraft` object).

**Outcome.** The estimate outcome is computed when the report is built, not
stored. `estimateKeep(draftLines, quote)` compares the run's
`outcomeDetail.lines` (`[{sku, qty}]`, saved on the draft run) with the
quote's current materials lines:

- `kept` — same sku and same qty.
- `changed` — same sku, different qty.
- `removed` — missing.

The outcome follows from those counts:

- `accepted` when kept/total ≥ 0.9.
- `discarded` when the quote is gone or kept + changed is under 10 %.
- `edited` otherwise.

`estimateOutcomeFor(detail, quote)` wraps it: a run whose detail has an
explicit `quoteId: null` (no systems built, or the create failed) is
`discarded`; a run with no `quoteId` key yet stays pending. `loadAssistVM`
fetches the runs' quotes with `Promise.all` and never throws — on a DB error
(a preview deploy can reach the shared database before migration 0039) the
card shows an empty report.

## 10. Settings → Beta: Assist pilot (D879)

These go in the `app_settings` main row:

```ts
assistUsers: string[];                       // default []
assistFeatures: { tasks?: boolean; reply?: boolean; estimate?: boolean };  // default {}
assistMonthlyCapUsd: number;                 // default 200, clamp 0..10000
```

The card sits in the Beta section of `groups/data.tsx` and saves through
`setAssistSettingsAction(patch)` (`requirePerm("manage_users")`, unknown user
ids filtered out). It contains:

- **Status line:** the provider ("Claude API" / "Mac mini (local), Claude
  fallback" / "Not configured — set ANTHROPIC_API_KEY"), the models per
  feature, and "Kill switch on" when `ASSIST_DISABLED`.
- **Pilot users:** checkbox list.
- **Features:** three toggles.
- **Monthly cap ($):** a number field.
- **Report (estimated costs):** this month's spend against the cap. A table
  per feature: runs, ok %, accepted / edited / discarded / no outcome, and
  cost. A per-person row and a per-model row. Data comes from
  `assistReport(monthKey)`, a pure aggregation over `listRunsByMonth` plus
  `estimateKeep` for estimate runs. A month picker covers the current month
  and the 2 before it.

## 11. Env (`.env.example`)

The stale "AI features (Phase 8)" block is replaced with:

```
# ---- Assist (D869–D880) — off unless a key / local URL is set ----
ANTHROPIC_API_KEY=
# ASSIST_DISABLED=true          # kill switch
# ASSIST_MODEL_TASKS=claude-haiku-5-5
# ASSIST_MODEL_REPLY=claude-sonnet-5-5
# ASSIST_MODEL_EXTRACT=claude-haiku-5-5
# ASSIST_MODEL_ESTIMATE=claude-opus-5-5
# ASSIST_PROVIDER=local         # Mac mini phase
# ASSIST_LOCAL_URL=https://mini.example/   ASSIST_LOCAL_TOKEN=   ASSIST_LOCAL_MODEL=
# ASSIST_LOCAL_TIMEOUT_MS=60000
```

The Inbox page exports `maxDuration = 300` so the estimate action (two model
calls) fits in one server-action budget.

## 12. Testing

- **Pure checks** in a new `scripts/test-assist.ts`, wired into `test:specs`:
  - models/cost math, including the Haiku >100K step
  - gate truth table and `monthKeyChicago`
  - `sanitizeTaskSuggestions`, `cleanReplyText` and the style-example picker
  - `editRatio`, `replyOutcome` and `estimateKeep`
  - the extract sanitizer and `buildDraftSections`: candidate-only SKUs,
    custom lines for unknowns, prices from `catalogAddPrice`, never from
    model output
  - zod → JSON-schema emits `additionalProperties:false`
  - the report aggregation
- **DB checks** (scratch PGlite) with `FakeProvider`:
  - `runAssist` logs rows, enforces the cap (no row at the cap), a failed
    gate makes no call, and the schema failure path still logs
  - `setRunOutcome` is first-write-wins and own-user only
  - a migration file exists, and the table is in `DOC_TABLES` and
    `CONFIG_COLLECTIONS`
  - the draft-estimate creation chain on a seeded customer, using a fake
    provider: a `draft` system quote, `source:"estimator"`, with
    `assistDraft` set and the thread link unchanged
- **The provider SDK shape is not live-tested** (no key in dev). `anthropic.ts`
  is checked by a request-builder unit test: `buildAnthropicParams(req)`
  returns the exact params object, so the beta headers, `fallbacks`,
  `output_config` and `cache_control` are asserted. A live call is the
  Jeff-gated pilot step.
- **Gates:** tsc, test:specs, test:smoke, eslint against a baseline, and
  `next build`.

## 13. Decisions

- **D869:** gate and empty-means-nobody allow-list.
- **D870:** per-feature routing, cost table, beta-path-only.
- **D871:** provider interface, local OpenAI-compatible endpoint, Haiku
  fallback.
- **D872:** `runAssist` order; `assist_runs` doc table kept through go-live.
- **D873:** style examples from the sender's own sent mail.
- **D874:** thread text treated as untrusted data.
- **D875:** two-step estimate (Haiku extract → Opus draft).
- **D876:** candidates from four sources, no prices to the model.
- **D877:** `source:"estimator"` and `Quote.assistDraft`, no auto-link.
- **D878:** banner and dismiss; outcome computed at report time.
- **D879:** Beta-card settings and report.
- **D880:** the SDK supersedes D39 for this layer; D89's deletions stay
  deleted.

## 14. Jeff-gated after merge

1. Create a Console API key with billing and a $200 Console spend limit.
2. Set `ANTHROPIC_API_KEY` in Vercel production.
3. Tick Jeff and one estimator in Settings → Beta → Assist pilot.
4. Try each button on a real thread.
5. Read the report after 30 days.
