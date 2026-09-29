# Punch #254 — Customer pricing tiers re-price the quote when the customer changes

Date: 2026-09-28 · Branch `feat/tier-reprice` (from origin/main b3d4af56).

Jeff (2026-09-28): "How do we get it so the pricing tiers automatically apply to the customer when we are quoting?"
→ proposed: when the customer or contact changes, re-price every line still at the previous tier's margin; keep
hand-priced lines; say what happened, with Undo. Jeff: "Yes, build it for both" (Estimator + service builders).

## Today
- Tiers: `src/lib/pricing-tiers.ts` (`resolveTier`: contact's own tier → company tier → Base; margins in Estimating
  Rules → Customer tiers, `tiers.<key>`). D87/D88: the stamp SEEDS pricing and never rewrites existing lines.
- Estimator: `updateQuoteMetaAction` (estimator/actions.ts ~716-760) re-resolves on a customer/contact change and
  returns `{ pricingTier, tierMargin }`; the client sets `tierMargin` (estimator-client.tsx ~779) and uses it only for
  lines added afterwards (addPart ~1327, CSV import ~1346, labor `freshLabor` ~635/1453/1496, curtains ~1740, vendor
  quotes ~1633/2021, …). Existing lines keep their prices.
- Service builders (flame ~403-409, and the repair / inspection equivalents): picking a customer seeds the margin knob
  from `primary?.tierMargin ?? c?.tierMargin`; a customer with no tier leaves the knob at the PREVIOUS customer's
  value; a contact change never re-seeds; a hand-set knob is overwritten on a customer change.

## Change
### Estimator (D87 amended: a tier change re-prices lines that are still at the previous tier margin)
- When a customer/contact change returns a `tierMargin` different from the one in effect (`prev`, the quote's stamped
  tierMargin, or the 0.30 fallback the client used when none was stamped), re-price **tier-seeded lines**: every
  line whose sell still equals what `prev` would give — `|price − round2(cost ÷ (1 − prev))| ≤ $0.01`, cost > 0 —
  to `round2(cost ÷ (1 − new))`. This covers catalog parts, CSV-imported parts, vendor-quote lines and options.
  Labor and curtain lines follow the same rule if they are stored as cost + sell seeded from the tier margin; if
  either is stored differently (rate fields, computed at render), re-seed it the way it was created, and only when it
  still matches its `prev`-seeded value. Lines with an ext-sell override, POR / no cost, or a sell that doesn't match
  the `prev` seed are **hand-priced and kept**.
- One pure function does the classification and re-pricing (`repriceForTier(sections, prev, next)` →
  `{ sections, repriced, kept }`), unit-tested; the client applies it to its state and the normal save/autosave path
  persists it (server recomputes the value, #242).
- A banner under the header: "Re-priced 14 lines to Gold (20%) · kept 2 hand-priced lines · Undo". Undo restores the
  exact previous sections (the new tier stamp stays — it describes the customer). The banner clears on the next edit
  or after Undo. No lines at the prev margin → no banner (just the silent stamp, as today).
- Internal only: nothing about tiers ever prints on the customer document (D87 "never shown to customers").

### Service builders (flame test, repair, inspection)
- On a customer change **and** on a contact change, resolve the new seed: contact's own tier margin → company tier
  margin → the builder's own default margin (`baseRates.margin`, the Estimating Rules default for that service — not
  tier Base's 30 %).
- If the knob is still at the previous seed (untouched), move it to the new seed. If it was hand-set, keep it and show
  "Kept your 25% margin — Gold is 20% · Use Gold" (one click applies it). A new customer still clears a typed total
  (unchanged behaviour); a contact change does not.
- Rentals: apply the same rule only if the rental builder already seeds from tiers; otherwise out of scope.
  Consulting has no tiers (unchanged).

## Testing
Pure: `repriceForTier` — seeded vs hand-priced vs override vs POR vs zero-cost, rounding tolerance, options, labor and
curtain lines per their storage, prev = null (0.30 fallback), identical margins → no change. Service seed rule:
untouched knob moves; hand-set kept with the prompt; no-tier customer → service default; contact tier wins; contact
change re-seeds. Structural: the Estimator applies the helper on the stamp response, Undo restores, no tier text on
the customer document. Four gates + `next build`.
