# Estimate Suggestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement `docs/superpowers/specs/2026-10-13-estimate-suggestion-design.md`.

## Global Constraints

- **The spec is binding.** Its key values:
  - Suggestion blob `estsugg:<id>` (id `ES-<base36>`).
  - Source index `estsugg-src:<kind>:<sourceId>` and quote index `estsugg-quote:<quoteId>`.
  - POST `/api/assist/suggest-estimate` with `maxDuration = 300`.
  - Haiku extract, then Opus draft.
  - Header-only prefill: `customer`, `venue`, `contact`, `lead`, `suggestion`.
  - Nothing creates a quote until the rep saves.
- **Model text is untrusted.** Keep the wrapper. Only candidate SKUs are allowed; no prices in or from the model.
- **Pricing of added lines goes only through the Estimator's own paths** (`catalogAddPrice` at the current tier). A suggestion never stores a price.
- **No record schema changes** for leads, surveys, meetings or threads. Use the blobs.
  - Surveys are whole-doc synced.
  - Meetings normalise away unknown keys.
  - Quote `update()` drops store-owned keys.
- **Client components** import only actions, pure modules and types.
- **Process rules (as before):**
  - Don't use `server-only`.
  - PGlite is single-process; never touch `.data/pglite`.
  - Never run `git stash`, and never `git add .superpowers/`.
  - Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Use targeted Edits only in `scripts/test-review-and-spec.ts`.
  - Set `export PATH=$HOME/.local/node/bin:$PATH`.
- **Tests** go in `scripts/test-suggest.ts` (`npm run test:suggest`, using the mktemp/cleanup pattern), chained into test:specs. Update `scripts/test-assist.ts` where it covered the removed quote-creating path.

---

### Task 1: Pure core + storage
- `src/lib/assist/features/suggest-sources.ts`: `leadText`, `surveyText`, `meetingText`, plus a re-export of `threadBlock` usage.
  - Move `surveyFindings` from `estimator/actions.ts` into `src/lib/` and keep the action working.
- `src/lib/assist/features/suggestion.ts`:
  - the `EstimateSuggestion` type;
  - `sanitizeSuggestion(draft, candidates)` → systems/lines with `custom` flags, no prices;
  - `systemFromSuggestion(system, parts, ctx)` (mirrors `systemFromCategory`, using `catalogAddPrice`);
  - `addedState(suggestion, sections)`;
  - the `suggestionHref` builder.
- `src/lib/stores/estimate-suggestions.ts`: `saveSuggestion`, `getSuggestion`, `suggestionForSource(kind, id)`, `linkSuggestionToQuote(id, quoteId)`, `suggestionForQuote(quoteId)`. All are blob-based.
- Estimator handoff `readHandoff` gains `lead` and `suggestion`.
- Tests, then gates: test:suggest, test:assist, tsc.

### Task 2: Server pipeline + route; remove the quote-creating path
- `src/lib/assist/estimate-suggest-server.ts` `suggestEstimate(source, me, deps)`, as in spec §1.
  - Access checks per kind (verify each kind's real rule).
  - Customer and header resolution per kind.
  - Extract, then candidates, then draft, then sanitize, then store.
  - Time budget kept.
- `src/app/api/assist/suggest-estimate/route.ts` POST:
  - `maxDuration = 300`;
  - `requireUser`, plus the `estimate` gate via `getAssistEnv`;
  - zod body `{kind, id}`;
  - JSON result.
  - Check that the middleware/auth handles `/api/assist/*` correctly for a signed-in fetch.
- Remove `draftEstimateFromThread` (quote creation), `draftEstimateAction` and its reader button.
  - Keep the banner code for old drafts.
  - Update `test-assist` checks and pins accordingly.
  - Inbox `maxDuration` can stay at 300; it is also used by the AI pass.
- DB checks with fake providers for each kind, then gates.

### Task 3: Estimator panel + leadId + first-save link
- `EstimatorProps.suggestion` + `parts`. Load them in `estimator/page.tsx` for `?suggestion=` and for saved quotes with a linked suggestion.
- State: `leadId` (from handoff), saved on create (SavePayload, `create`). `suggestionId` goes in the save payload, and the server links the quote to the suggestion on first save.
- `SuggestedBomPanel` client component on the Build step, with hook functions `addSuggestedSystem(systemKey)` and `addSuggestedLine(systemKey, lineKey, targetSecId)`. Use `systemFromSuggestion` / `addPart` / custom line.
  - ✓ state via `addedState`.
  - Source link and notes.
  - Collapsible; starts hidden on a saved quote.
- Pure tests, pins, then gates (including `next build`).

### Task 4: Entry points + brief + report/settings
- `startSuggestion(source)` client helper (fetch → push).
- Buttons, with "Suggestion ready → Open" / "Suggest again" when a suggestion already exists:
  - Inbox reader (replacing the old one)
  - lead drawer footer
  - venue assessment editor header
  - meeting reader header (only when linked)
- Brief lead cue → Suggest estimate.
- Pilot card label "Suggest estimate".
- Report outcome from the linked quote via `estimateKeep` (pending if no quote).
- Pins, then gates.

### Task 5: Docs + full gates
- DECISIONS (next free D after D929, rechecked), PUNCHLIST #338, AGENTS phase 57, MASTER-HOWTO section.
- Full gates: test:suggest/assist/brief/inbox-org/popout, tsc, eslint, next build, test:specs (0 FAIL), test:smoke.
