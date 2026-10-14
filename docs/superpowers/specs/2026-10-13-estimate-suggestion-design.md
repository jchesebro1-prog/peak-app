# Estimate suggestion — design

Date: 2026-10-13 · Status: approved in brainstorm (Jeff, 2026-10-13) · Punch #/D-numbers assigned at build (recheck `origin/main`).

Roadmap piece 3. This replaces #334's "Draft estimate", which created a priced draft quote, with a **suggestion**. The suggestion opens a new, unsaved Estimator with the header filled in and a **Suggested BOM** panel beside it. The rep builds the estimate from the panel.

## Decisions (Jeff)

| Question | Answer |
|---|---|
| Sources | Email thread, lead, site visit / venue assessment, Krisp meeting |
| Panel | Side panel grouped by system; **+ Add system** and **+** per line, priced at the customer's tier like a manual add; nothing is in the estimate until clicked |
| Old button | **Replaced**. Existing drafts keep their banner. |
| Model | **Opus** for the draft step (Haiku extract stays) |
| Prefill | **Header only**: customer, contact, venue, lead. No lines. Unsaved until saved. |

## 1. Pipeline (server)

`suggestEstimate(source, me, deps)` lives in `src/lib/assist/estimate-suggest-server.ts`. `source` is `{ kind: "thread" | "lead" | "survey" | "meeting"; id }`. The function generalises `draftEstimateFromThread`:

1. **Load the source with access checks.**
   - **thread:** `loadThreadFor`.
   - **lead:** any signed-in user can open leads today. Mirror the leads page's own access rule.
   - **survey:** the venue-assessments access rule.
   - **meeting:** visible per the meetings rules. A filed meeting is visible to staff; an unfiled one only to its owner.
2. **Build source text.** These are pure builders in `src/lib/assist/features/suggest-sources.ts`, and all text is wrapped untrusted.
   - **thread:** the existing `threadBlock`.
   - **lead:** org, contact, interest, timeline, value, message, address, plus the last messages of threads where `link.type==="lead" && link.id===lead.id` (max 3 threads, 6 messages each).
   - **survey:** `scopeOfWork`, `notes`, `measurements`, per-discipline `goals` and findings, plus inventory summary lines. `surveyFindings` moves out of `estimator/actions.ts` into `src/lib/` and is shared.
   - **meeting:** `renderMeeting` summary + key points, then the speaker-relabelled transcript trimmed to about 12,000 characters, newest-weighted by keeping the end.
3. **Extract (Haiku)** with the existing `ExtractSchema`.
4. **Candidates.** Same as before: `gatherEstimateCandidates({phrases, systems, customerId})`. The customer comes from the source: the thread's resolved customer, the lead's `customerId`/`convertedCustomerId`, the survey's `customerId`, or the meeting's `links.customerId`.
5. **Draft (Opus)** with the existing `DraftSchema` and prompt. The prompt says "suggest; a person builds the estimate".
6. **Sanitize into a suggestion.** No pricing happens at this step.
   - **Line rules:** each line keeps `sku` only if it is in the candidate set (otherwise it becomes a custom line with `desc`). `qty` is an integer from 1 to 9999. Cap at 12 systems and 60 lines.
   - **Record shape:**
     ```
     EstimateSuggestion = { id: "ES-<base36>", source: {kind,id,label}, createdBy:{id,name}, createdAt,
       customerId|null, contactName|null, venueId|null, leadId|null, quoteName,
       systems: [{ key, name, categoryId, discipline?, lines: [{ key, sku|"" , desc, qty, reason, custom: boolean }] }],
       notes, runIds: {extract, draft}, quoteId: null }
     ```
7. **Store.** Blobs only, so there are no record or schema changes:
   - `estsugg:<id>` holds the suggestion.
   - `estsugg-src:<kind>:<sourceId>` maps to the latest id. A re-run replaces it.
8. **Return** `{ ok, suggestionId, href }`, where `href` is `/estimator?suggestion=<id>&customer=…&venue=…&contact=…&lead=…`.

**Runtime.** Use a POST route handler, `src/app/api/assist/suggest-estimate/route.ts`, with `maxDuration = 300`. It calls `requireUser`, takes the assist `estimate` gate, and validates the body. The client calls it with `fetch` from all four sources and from the brief, so no page's `maxDuration` matters. Keep the existing time budget logic (`estimateBudgetFits`, `OUT_OF_TIME`).

**Removed:**
- `draftEstimateFromThread`, which created a quote.
- `draftEstimateAction`.
- The reader's Draft estimate button.

Keep `AssistDraftBanner` and `assistDraftViewOf` so existing drafts still show their banner.

## 2. Estimator

- **Handoff.** `readHandoff` gains `lead` (→ `leadId`) and `suggestion`. The Estimator state and `SavePayload` gain `leadId`, which is saved on create via `create({... leadId})`.
- **Server page.** When `suggestion` is present, it loads the blob. The viewer must be signed in; suggestions are staff-visible, like quotes. It then:
  - resolves live part data for all suggestion SKUs (`getManyBySku` → `{sku, desc, unit, cost, list}`; missing → custom);
  - passes `suggestion` + `parts` into `EstimatorProps`.
- **Saved quote.** When a saved quote has a linked suggestion (blob `estsugg-quote:<quoteId>` → id), it does the same, and the panel starts hidden behind a "Suggested BOM" toggle.
- **`SuggestedBomPanel`** (client): a right-side column on the Build step, collapsible.
  - Each system shows name, discipline and lines (qty × part desc · why). Missing parts show "needs a part".
  - **+ Add system** calls a new hook function, `addSuggestedSystem(systemKey)`. It builds a section with a pure `systemFromSuggestion(system, parts, ctx)`, where `ctx` is `{nextId, tierMargin, price: catalogAddPrice, groupId?, freightPct, priceRound}`, the same as `systemFromCategory`. Unknown parts become unpriced custom lines with `internalNote: "Suggested: needs a part and price"`.
  - **+** on a line adds it to a chosen system: a select of current sections, defaulting to the last one added from this suggestion system. It goes through `addPart`, or the custom-line equivalent.
  - **✓ added** is derived by matching SKU (custom lines by desc) against the current sections. It is pure and needs no stored state.
  - The header shows the source ("From email: …" / "From lead …" / "From site visit …" / "From meeting …") with a link back, and the estimator notes.
- **Linking on first save.** When an estimate opened with `?suggestion=` is saved the first time, write `estsugg-quote:<newQuoteId>` = id and set `suggestion.quoteId`. This happens server-side in the save action, which receives `suggestionId` in the payload and ignores ids it can't load.

## 3. Entry points (pilot + `estimate` feature)

- **Inbox reader:** "Suggest estimate" replaces Draft estimate.
- **Lead drawer:** a footer action, "Suggest estimate".
- **Venue assessment editor:** a header action.
- **Meeting reader:** a header action, shown only when the meeting has a customer link or a work link.
- **Brief card:** the lead cue becomes "Suggest estimate", which calls the route.

**Shared behaviour:**
- Every entry point uses one client helper, `startSuggestion(source)`. It runs a busy state ("Suggesting… can take a minute or two"), then a POST, then `router.push(href)`. On an error, it shows the message inline.
- When the source already has a suggestion (`estsugg-src`), the entry point also shows "Suggestion ready → Open", alongside a "Suggest again" action.

## 4. Logging, report, settings

- Runs keep `feature: "estimate"` with steps `extract` and `draft`. The draft run's `outcomeDetail` gets `{ suggestionId, lines }`.
- The report computes the outcome from the linked quote, using the existing `estimateKeep` against the suggestion's catalog lines:
  - **accepted:** ≥ 90% kept.
  - **edited:** some kept.
  - **discarded:** none kept.
  - **pending:** no quote yet.
- The pilot card label "Draft estimate" becomes "Suggest estimate".

## Non-goals

- Auto-creating quotes.
- Pricing in the suggestion.
- Grid designs, curtains math, racks.
- Flame/inspection suggestions.
- Editing the suggestion itself; regenerating it is the only way to change it.

## Testing

**Pure checks:**
- source text builders for each kind, including transcript trimming and the untrusted wrapper
- the suggestion sanitizer (candidate-only SKUs, caps)
- `systemFromSuggestion` pricing via `catalogAddPrice` and custom lines
- added-state matching
- handoff parsing (`lead`, `suggestion`)

**Fake-provider DB checks:**
- each source kind produces a stored suggestion with the right header fields
- access is refused for a thread or meeting the user can't see
- a re-run replaces the source index
- the save links the quote and suggestion
- no quote is created by suggesting

**Pins:**
- the old `draftEstimateAction` and `createQuote` path is gone
- the route has `maxDuration` 300
- client files import no stores

**Gates:** test:specs, smoke, tsc, eslint, next build.
