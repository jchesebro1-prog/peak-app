# Brief — Assist layer (Claude API now, Mac mini later)

**Status:** brief, not yet a spec · 2026-10-12 · reverses D89's "no AI" posture *as a trial*.
Jeff's decisions from 2026-10-12 are folded in below.

## Why now

D89 (2026-07-19) removed every model call because none of the four old features
(thread summary, customer summary, import extraction, Q&A) earned their keep.
Jeff's call today is that drafting **email replies, tasks and estimates** is
different: it saves typing every day. The plan is to try it on the Claude API,
measure whether people actually use the drafts, and if they do, move the same
jobs to a local model on a Mac mini.

D89 said a return "would be a fresh build, not a re-enable", and this is that
fresh build. Nothing from the old `src/lib/ai/` comes back as-is. One rule from
D40 does come back: **the model drafts, a person sends or saves.**

## Decisions (Jeff, 2026-10-12)

| Topic | Decision |
|---|---|
| Trial users | Jeff + one estimator (a per-user allow-list in Settings → Beta) |
| Spend cap | **$200 / month**, as API spend. Note: a Claude Max subscription does **not** cover API calls. The API is billed separately through the Claude Console with its own key. |
| Customer data to Anthropic | Yes, for the trial |
| Model per feature | **Haiku 5.5** for task suggestions · **Sonnet 5.5** for reply drafts · **Opus 5.5** for estimate drafts |
| Estimate scope (v1) | Estimator system quotes only |
| Estimate reference context | All four: similar past sent/won systems, this customer's past quotes, System-category typical items, per-phrase catalog search hits |
| Client library | Official `@anthropic-ai/sdk` (supersedes D39's plain-fetch rule for this layer) |
| Reply style | Each sender's own last ~5 sent replies as style examples |
| Success bar | Jeff's gut call after 30 days, informed by the Assist report |
| Mac mini phase | Move **everything** local if phase 1 works, accepting lower quality |
| Mac mini offline | Fall back to the API (Haiku 5.5) |

## Models and cost

| Feature | Model | ID | $/M in · out | Est. per call |
|---|---|---|---|---|
| Suggest tasks | Claude Haiku 5.5 | `claude-haiku-5-5` | $0.10 · $0.50 (≤100K prompt) | ~$0.0005 |
| Draft reply | Claude Sonnet 5.5 | `claude-sonnet-5-5` | $2 · $10 | ~$0.01–0.02 |
| Draft estimate | Claude Opus 5.5 | `claude-opus-5-5` | $4 · $20 | ~$0.15–0.30 (30–60K in with BOM context) |

At trial volume (two people), expect **well under $100 a month**. The $200 cap
is a ceiling that should never be reached.

Per-model settings (from the current API rules):

- **Haiku 5.5:** set `effort: "low"` and use structured output. It has no
  server-side refusal fallback, so a refusal means "no suggestions".
- **Sonnet 5.5:** set `effort: "low"` for replies and send
  `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`). Don't send
  `thinking: {type: "disabled"}`, because it returns a 400.
- **Opus 5.5:** thinking can't be turned off, and effort defaults to `medium`,
  so set it explicitly (`medium` to start, measure before raising). Send
  `fallbacks: "default"`. Use structured output (`output_config.format`)
  rather than forced `tool_choice`, which also returns a 400.
- For every model, check `stop_reason` before reading content. A `refusal`,
  `max_tokens` or error result means "no draft — write it yourself". Prompt
  caching goes on the fixed system prompt plus the System-category and catalog
  context, so repeat estimate drafts cost less.

## The seam (what makes the Mac mini swap a config change)

`src/lib/assist/` is the only code that talks to any model:

```
assist/
  provider.ts      interface AssistProvider { complete(req) → AssistResult }
  anthropic.ts     Claude provider (@anthropic-ai/sdk)
  local.ts         Mac mini provider (HTTP to Ollama / LM Studio / MLX server)
  config.ts        enabled(feature, user), provider + model per feature, spend cap
  runs.ts          logs every call (see "Measuring")
  features/        taskSuggest.ts · replyDraft.ts · estimateDraft.ts
```

- `AssistRequest` is `{ feature, system, input, schema?, maxTokens }`, and
  `AssistResult` is `{ ok, text | json, usage, costUsd, latencyMs, provider, model }`.
  Feature code never knows which provider or model ran.
- **Routing:** each feature has a provider and model entry, set by env or
  Settings (`ASSIST_MODEL_TASKS`, `ASSIST_MODEL_REPLY`,
  `ASSIST_MODEL_ESTIMATE`). `ASSIST_PROVIDER=anthropic|local` picks the
  backend, and `local` falls back to Haiku 5.5 on the API when the Mac mini
  times out or is unreachable. The run log records which one actually
  answered.
- Features are **store-decoupled** (as in D41). Each server action gathers its
  own context, calls the feature, validates the output and does the write
  through the existing store path.
- Env: `ANTHROPIC_API_KEY`, the three model vars, `ASSIST_LOCAL_URL` +
  `ASSIST_LOCAL_TOKEN`, and `ASSIST_DISABLED=true` as the kill switch.
- Off by default and allow-listed. Without a key, or for a user not on the
  list, no buttons render. The deterministic paths that exist today (D75
  renewal drafts, D86 scope assembly, the signature reader, the meeting
  matcher, triage) keep working exactly as they do now. The assist layer only
  adds to them.

## v1 features

### 1. Suggest tasks (Inbox reader) — Haiku 5.5

- Returns `{ title, dueHint, assigneeHint, linkHints }[]`. The user ticks the
  ones to keep, and those go through the **existing** email-task path (#221),
  which carries the contact, customer, site, lead and thread links.
- The server checks every hint: dates are parsed into Chicago business days,
  and assignees and links must resolve to real ids or they're dropped. Ticked
  tasks get the #327 defaults, so they land on the auto calendar.

### 2. Draft reply (Inbox reader) — Sonnet 5.5

- Puts a draft into the existing composer. It never sends.
- Context passed in: the thread (last N messages, trimmed), the linked
  company, lead or contact, and that customer's open quotes (number, type,
  status, total, sent date).
- **Style:** the sender's own last ~5 sent replies from their connected Gmail
  box, sorted by date so the cached prefix stays stable. Only that sender's
  mail is used. A tone pick (short / normal / formal) overrides it.
- **Prompt injection:** email text is untrusted. The model has no tools and
  can only return text into a draft that a person reads before sending.

### 3. Draft estimate from a request (Inbox reader → draft Estimator quote) — Opus 5.5

- **The model never sets a price.** It picks parts from ids the server has
  already gathered and sets quantities.
- **Reference context, built server-side and never fetched by the model:**
  1. **Similar past systems:** the closest sent or won systems from #293's
     system library, as part + qty lists **with no prices**.
  2. **This customer's past quotes:** the same company's prior Estimator BOMs
     (part + qty, no prices), so repeat customers get consistent gear.
  3. **System-category typical items** from Estimating Rules → System
     categories (#311).
  4. **Catalog search hits:** the top-N parts for each equipment phrase pulled
     from the request.
- **Output:** systems (name, category, group) with lines that each reference
  a part id from the candidate set, plus a qty and a one-line reason. Lines
  it can't match become **custom lines with no price**. The server drops any
  id outside the candidate set.
- The result lands as a **draft** Estimator quote, priced by the existing
  engine at the customer's tier, then goes through submit-for-approval (#284).
  It shows a "Drafted from email — check every line" banner, links back to
  the thread, and shows each line's reason in Build until the line is edited.
- Out of v1: flame and inspection quotes, Grid designs, curtain math, racks,
  and sending anything.

## Guardrails (all structural, none in the prompt)

1. Nothing auto-sends, auto-saves, auto-links or changes status. Every output
   is a draft or a suggestion a person accepts.
2. No dollar figure comes from model output, and past BOMs are sent to the
   model without prices.
3. Every id in the output is checked against the database or the candidate
   set, and anything that fails is dropped.
4. Per-user allow-list, per-feature toggles, and a $200 monthly cap computed
   from `assist_runs`. When the cap is hit, buttons show "Assist paused for
   the month".

## Measuring

- A new `assist_runs` table (one migration) logs: feature, user, provider,
  model, input/output/cache tokens, cost, latency, a hash of the input, the
  output, and the **outcome** (`accepted` / `edited` / `discarded`, plus edit
  distance for replies, ticked suggestions for tasks, and lines kept for
  estimates).
- Settings → Beta → **Assist report**: runs, acceptance, cost to date, per
  feature, per person and per model. This is what Jeff reads to make the
  30-day call. There's no fixed threshold.

## Phase 2 — Mac mini (everything moves local)

- Run an open-weight instruct model on a Mac mini (Apple silicon; 64 GB+ RAM
  to hold a 30B-class model) with Ollama, LM Studio or an MLX server, then flip
  `ASSIST_PROVIDER=local`. All three features move, and lower quality is
  accepted. Expect estimate drafts to fall the furthest below Opus.
- **Reachability:** the app runs on Vercel, so it needs a Cloudflare Tunnel or
  Tailscale Funnel plus a bearer token. Calls get a short timeout, and the API
  takes over (Haiku 5.5) when the Mac mini is offline.
- **Before switching:** replay the logged `assist_runs` inputs (the accepted
  and edited ones are the test set) through the local model, so the drop in
  quality is a known number instead of a surprise.

## Non-goals

A chat assistant or "ask your data" (deleted in D89 and staying deleted),
agents or tool-calling, the customer portal, auto-triage, and rewriting any
deterministic feature to use a model.

## When this becomes a build

Pick the next free punch number and D-number range from `origin/main` right
before writing docs. Log D-entries for: this supersedes D89's posture (the
assist layer is opt-in, and D89's deletions stay deleted), the SDK supersedes
D39 for this layer, and per-feature model routing. Update the AGENTS.md Phase 8
note. Then go spec → plan → subagent build per the usual heavy-build workflow.
Before the build, Jeff creates a Claude Console API key with billing and a
Console-side spend limit to match the $200 cap.
