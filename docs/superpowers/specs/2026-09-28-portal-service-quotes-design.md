# Portal service quotes — customers get firm flame-test and inspection quotes themselves

Date: 2026-09-28 · Branch `feat/portal-service` (off `origin/main` fd50ef40) · Punch **#248** (proposed —
recompute from `origin/main` right before writing docs).

Follow-up named in PUNCHLIST #245 ("Self-serve service quotes — a separate spec, reuses this build's firm/review
split and Accept/Approve flow"). Jeff (2026-09-27): *"Auto quotes are good and should be quotable"* — firm — and
2026-09-28 *"I think you are all fine to just continue"*: every choice below was made without asking and is logged in
DECISIONS at build time.

## Picks (decided, not asked)

1. **Firm self-serve: flame tests and inspections (L1 annual, L2 five-year).** They are priced end to end by the
   existing engines (`src/lib/flametest-engine.ts`, `src/lib/inspection-engine.ts`) — the same math the staff
   builders and one-click renewals (D65–D69) run — so a customer gets the number Peak's own builder would produce.
2. **Repairs stay a request.** The repair engine prices only hours and parts a person has estimated
   (`src/lib/repair-engine.ts`; no priced issue/parts library). "Request a repair" opens the existing
   `/portal/request` form with Repair and the venue pre-filled (D63 path: unassigned lead, 48 h SLA).
3. **Scope comes from the venue's last record, adjustable.** Venues store no curtain or line-set counts; staff type
   them per quote. The form pre-fills each venue's count from its most recent completed job/record or its most
   recent quote of that type (the renewal-outreach source order), and the customer may change it. No history →
   the customer enters it. Counts are whole numbers 1–200 (curtains) / 1–300 (line sets).
4. **Several venues, one quote.** The engines price one shared trip over all venues (office → v1 … vn → office),
   so a multi-venue quote is cheaper per venue — the form lets the customer tick any of their venues.
5. **Pricing = the builder's defaults, no overrides.** Margin from `resolveTier(customerId, grant name)`; live
   rates blobs; travel mode Auto (flights over drive, #208); $25 rounding (#217); no typed totals, no per-venue
   testing overrides, no travel override. The customer never sees rates, hours, margin or the travel breakdown —
   only per-venue lines, one travel line and the total (§3).
6. **Same lifecycle as catalog quotes (#245).** Generate → numbered quote, `status: "sent"` via the existing
   `portal-firm` gate bypass (`sendPortalFirm`, `src/lib/portal-quotes.ts`), 30-day `portalFirm.validUntil`, saved
   PDF (the service proposal letter), Accept (purchase method / notes / PO file), expiry → Refresh pricing (re-run
   the engine over the stored scope at today's rates, as a new revision), staff Approve / Decline.
7. **Approve runs the builder's own approve step**, so a won portal service quote spawns its flame job /
   inspection record exactly like a staff-built one (`approveFlameQuote` / `approveInspectionQuote`, engine-owned
   flow).
8. **Source `portal-service`**, with the real `quoteType` (`flame_test` / `inspection`) so every existing link,
   estimate-number prefix (FLM / RIG) and builder works. A staff save in a builder keeps `portal-service` (the
   builders currently stamp their own source — preserve it, as D416 did for the Estimator).

## 1. Entry points (portal home)

`src/app/portal/page.tsx` "Your venues & compliance" already renders, per venue, chips for Flame test and
Inspection L1/L2 with due/overdue state. Add:

- A header button **Get a service quote** on that card → `/portal/service`.
- Per chip, a small link **Quote it** → `/portal/service?type=flame&venue=<id>` (or `type=inspection&level=1|2`),
  pre-selecting that venue and service. Overdue / due-soon chips show the link prominently; "ok" chips show it
  muted.
- **Request a repair** link → `/portal/request?service=Repair&venue=<id>` (the request form reads both params to
  pre-select; if the form's `SERVICES` list has no exact "Repair" value, map to its closest existing value and log
  it).
- Portal nav gains **Service** (Home · Catalog · Service · Quote (N)).

## 2. `/portal/service` form

Server-rendered page + small client form; preview mode renders read-only (the #245 preview pattern).

- **Service**: Flame test · Inspection — Annual (L1) · Inspection — Five-year (L2). One service per quote.
- **Venues**: the customer's venues as a checklist, each with its count input (Curtains / Line sets), pre-filled per
  pick 3 with a hint ("From your 2025 test" / "From your last inspection" / "Enter the number of …"). At least one
  venue ticked.
- **Live estimate**: debounced server action re-prices on change and shows per-venue lines, one "Travel" line (no
  miles or mode detail beyond "Travel" — the letter prints the same single line the builders print) and the total.
  Nothing else.
- Standing line "All quotes are subject to Peak review and approval." and "Plus applicable sales tax." (verbatim,
  #245).
- **Generate quote** → `/portal?generated=firm&q=<id>` (the #245 banner).
- Rate limits: price 240/min per grant, generate 10/h per grant (#245 values).

## 3. Server pieces

- `src/lib/portal-service-scope.ts` (server): `serviceScopeFor(customerId, service, level?)` → per venue
  `{ venueId, label, count: number | null, source: "job" | "quote" | null, sourceYear?: number }` from, in order,
  the latest completed flame job / inspection record (same venue, same level) and the latest quote of that type for
  the venue (its saved `flameTest.venues[].curtains` / `inspection.venues[].lineSets`). Pure helpers where
  possible; tested.
- `src/lib/portal-service-pricing.ts` (server-only): `priceServiceRequest(session, request)` builds the engine
  input exactly like the builders' `persist()` (venue coords via `coordsOf`, `travelMiles` fallback, office via
  `quoteOrigin`, travel rates) with tier margin, calls the engine's pure `compute`/`computeEstimate` with live rates,
  and returns `{ customerView, subdoc, total, margin, tier }` where `customerView` = `{ lines: [{label, amount}],
  travel: number, total }` (sell only) and `subdoc` is what the builder would save (`flameTest` / `inspection`).
  One code path with the builders' — extract the shared "venue inputs + office + rates → engine opts" step into a
  helper both use rather than copying it (if the builders' code is too tangled to share safely, say so and copy
  with a test that pins parity: same inputs → same total as the builder's `compute`).
- `src/lib/portal-service-quotes.ts` (server): `generateServiceQuote(session, request)` → guards (preview refused,
  expired grant, no venues, counts in range, venue ids ∈ customer's), price, `createQuote({ quoteType, source:
  "portal-service", name: "Flame test — <venues>" | "Inspection (Annual|Five-year) — <venues>", customer,
  customerId, locationId: first venue, contactName, value, margin, pricingTier, tierMargin, flameTest|inspection:
  subdoc })`, owner = company owner or "", `scheduleQuotePdf`, `sendPortalFirm(id, validityDays, now)`. Same
  "once the quote exists, report success" rule as #245.
- **Refresh** (`src/lib/portal-quotes.ts` `refreshPortalQuote`): branch on `source === "portal-service"` → re-price
  the stored subdoc's venues/counts/level through `priceServiceRequest` at today's rates; write value + subdoc; cut
  the revision; re-send (the #245 firm refresh path). There is no review flip for service quotes (nothing can become
  price-on-request).
- **Copy to new quote** is catalog-only; service quote rows instead show **Quote again** → the form pre-filled from
  that quote's scope.
- **Accept / Decline** reuse #245 unchanged (`canAcceptPortal`, `acceptPortal`, `declinePortalAcceptance` —
  widen its `source === "portal-catalog"` check to either portal source).

## 4. Documents

The service proposal letters (flame / inspection) print, for `source === "portal-service"`: the standing review line,
"Plus applicable sales tax.", and "Valid until <date>" when `portalFirm`. Nothing else changes in the letter.

## 5. Staff side

- The Portal panel (`src/app/(app)/estimator/portal-panel.tsx`) is shared into the flame and inspection quote
  builders for `portal-service` quotes: acceptance details, **Approve** (calls that builder's approve action — the
  engine-owned-flow path that marks Won and spawns the job/record), **Decline with note**. Firm-quote validity
  shown.
- The builders' `persist()` keeps `source: "portal-service"` when the loaded quote already has it.
- Quotes hub Portal badge and the "New portal quotes" bell group include `portal-service`.
- Company "Portal activity" counts both portal sources.

## 6. Security, errors, tests

- Every action takes the customer from `portalSession()`; venue ids must belong to that customer; counts validated
  server-side; the customer never receives rates, hours, margin, tier, travel mode/crew/airfare, or cost.
- Errors: empty venue list → "Pick at least one venue."; count out of range → "Enter the number of curtains
  (1–200)." / "Enter the number of line sets (1–300)."; a venue that can't be located still prices (engines fall
  back to `travelMiles`, else no travel — log if the engine yields zero travel for an unlocated venue and consider
  flagging for staff in the panel).
- Tests: scope source order (job > quote > none; level-specific for inspections); pricing parity with the builder
  engines for the same inputs; customer view whitelist (no rate/margin/hours keys); generate firm → sent, FLM/RIG
  number, validUntil, subdoc saved, owner; venue-ownership refusal; refresh re-prices at new rates as a new revision;
  approve from the panel spawns a flame job / inspection record; builder resave keeps `portal-service`; smoke GETs
  `/portal/service`.

## 7. Out of scope

Repair auto-pricing (needs a priced issue/parts library), rigging-inspection add-ons beyond line sets, customer
choice of travel mode, scheduling/date requests (the job scheduler stays staff-side), the priced curtain
configurator and department tree (their own specs).
