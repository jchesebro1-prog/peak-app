# Portal curtain configurator — priced curtains, still confirmed by Peak

Date: 2026-09-28 · Branch `feat/portal-curtains` (off `origin/main` dad6e5e8) · Punch **#250** (provisional —
recompute from `origin/main` right before writing docs).

Jeff (2026-09-27, #245 brainstorm): *"long term we will just build out the curtain portion to include it like the
fixture so we will always just use the same module"* — and curtains were the one line he wanted Peak to review
("the only thing I am having a hiccup on is curtains"). 2026-09-28: *"go ahead with the curtain configurator"*.
Decisions below were made without asking (Jeff: "you are all fine to just continue") and are logged in DECISIONS.

## Picks

1. **The existing "Request curtain pricing" panel becomes a priced configurator** — same inputs (name, fabric, qty,
   width ft, height ft, fullness Flat/50/75/100), now with a live price per curtain and extended, computed on the
   server. No new inputs: hang/bottom don't affect price anywhere (curtain pricing rebuild).
2. **One curtain price = the Estimator's.** `src/lib/design/curtain-pricing.ts` `curtainCost(input, rates)` +
   `curtainPrice(costEach, margin)` at the customer's tier margin, with the live sewing % (`loadCurtainSewingPct`)
   — exactly what `computeCurtain` does in the Estimator, so a portal curtain opened in the Estimator shows the same
   number. The browser never computes it (no client-side sell rates): the panel asks a server action, debounced.
3. **Curtains still go to Peak for review — priced.** A curtain line carries its price but also `review: true`; any
   such line makes the quote a review quote with the reason "Curtains are confirmed by Peak (measurements and
   fabric)". A review quote now can be fully priced — staff confirm and send instead of typing prices. The cart and
   the review quote's PDF show the curtain prices, under the standing "subject to Peak review and approval" line.
4. **"Not sure — recommend one"** (no fabric) stays price on request, as today.
5. **The review flag clears on send, not on save.** An Estimator save clears `portalReview` only when no
   price-on-request item AND no curtain-to-confirm item remains; `setStatus(…, "sent")` already clears it (#245 final
   fix). Staff "confirm" a curtain simply by sending the quote (or by editing the line, which is normal Estimator
   editing — the `portalConfirm` marker then no longer blocks the flag once the quote is sent).

## Changes

- `src/lib/portal-quote-mode.ts`: `ModeLine = { por: boolean; review?: boolean }`; `quoteMode` → review when any
  `por` or `review`; reason: POR text as today; if only review lines → "Curtains are confirmed by Peak (measurements
  and fabric)"; both → "<N lines are price on request>; curtains are confirmed by Peak". `clearPricedPor` also
  reports `anyConfirm` (items with `portalConfirm`); the Estimator save clears `portalReview` only when
  `!anyPor && !anyConfirm`.
- `src/lib/portal-pricing.ts` `priceCurtain`: fabric known → unit price via the Estimator functions at
  `ctx.margin` and live sewing %, `extPrice = unit × qty`, `por: false`, `review: true`, detail "30'W × 18'H, 50%
  fullness — <fabric>"; staff SpecItem `{ sku: "CRT-P", desc: "<name> — <fabric>, <W>'W × <H>'H, <F>% fullness",
  qty, unit: "ea", cost: costEach, price: priceEach, curtain: true, portalConfirm: true, curtainInputs }` (add
  `portalConfirm?: boolean` to `SpecItem`). Fabric blank → today's POR line. `SellLine` gains `review?: boolean`.
  `sellView` carries `review` (not cost).
- New server action `priceCurtainOptions(input, previewCid?)` (pattern: `priceFixtureOptions`, rate-limited
  240/min per grant) → `{ unitPrice: number | null; extPrice: number | null }` (sell only; null when no fabric).
- `src/app/portal/catalog/curtain-request.tsx`: header copy "Configure a curtain", live "$X each · $Y total" (or
  "We'll recommend a fabric and price it" when not sure), the line "Curtains are confirmed by Peak before your
  quote is final.", Add button unchanged.
- Cart page + portal quote rows: a curtain line shows its price plus a small "Confirmed by Peak" tag; the badge
  reason uses the new copy.
- Staff Portal panel: the review banner lists POR items (today) **and** "Curtain to confirm: <desc> ×<qty>" for
  `portalConfirm` items.

## Tests

`quoteMode` (review-only, POR-only, both, neither); `priceCurtain` parity: same inputs through the Estimator's
`computeCurtain` → same `priceEach`; not-sure fabric → POR; sell view has no `cost`; `clearPricedPor` + Estimator
save leave `portalReview` while a `portalConfirm` item remains; generate with a priced curtain → draft review quote
with the priced curtain item; `priceCurtainOptions` validation (reuses `cleanCurtainRequest`) and rate limit.

## Out of scope

Hang/bottom options, custom fabrics, making curtains firm (Jeff wants review), the department tree (next spec).
