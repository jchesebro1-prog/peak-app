# Punch #242 — Quote review limits: per-person self-approval, auto-approved

Date: 2026-09-27 · Branch `feat/punch-inbox-tasks`.

Jeff (2026-09-27):

> We need to be able to set review tiers on quotes, so if someone creates a quote under certain points that are
> definable they can just approve their own quotes.
>
> I think the approved status could be auto so if the quote is in the status that they could approve their own
> quote it just gets approved.

Picks (chat): **per-person limits**; limits differ **by quote type and by what's on the quote** — for system
estimates the split is **labor lines or not** (custom items, allowances and discounts don't change it); for flame
tests / repairs / inspections the split is **auto-priced vs a hand-typed total** (#217 `priceOverride`); above the
limit **any approver, as today** (in-app queue or the #60 attested path); approval is **automatic** when the quote
fits. Confirmed: rentals and consulting get one limit each; the limit used is the **quote owner's**.

## Today (for reference)
- `ROLE_PERMS` (`src/lib/team.ts`): Admin/Manager/Reviewer have `approve`; Estimator has `create`/`send`.
- `QuoteReview` (`src/lib/stores/quotes.ts` ~136): `state` none/in_review/approved/changes, `method` in_app /
  attested. `hasApproval(review)` = state approved. `resolveStatusGate` (~894) requires approval to move a quote to
  `sent` or `won` (engine-owned service flows and historical import bypass `won`).

## Design

### 1. Review limits (Settings → Team, Admin / `manage_users` only)
A table: one row per teammate (the `users` roster), one column per **review kind**:

| kind key | column |
|---|---|
| `system_plain` | System estimate — no labor |
| `system_labor` | System estimate — with labor |
| `flame_auto` / `flame_typed` | Flame test — auto-priced / typed total |
| `repair_auto` / `repair_typed` | Repair — auto-priced / typed total |
| `inspection_auto` / `inspection_typed` | Inspection — auto-priced / typed total |
| `rental` | Rental |
| `consulting` | Consulting |

Each cell is **blank** (always needs review — the default, so nothing changes until Jeff fills it in), a **dollar
amount** (auto-approve at or under it), or **No limit**. Stored as one settings blob (e.g. `reviewLimits`:
`{ [userId]: { [kind]: number | "none" } }`, a missing key = blank), sanitized server-side (non-negative, capped,
unknown users/kinds dropped). Saved through a server action gated by `requirePerm("manage_users")`.

### 2. Review kind of a quote (pure)
`reviewKindOf(quote)`:
- `quoteType` flame_test / repair / inspection → `<type>_typed` when the quote carries a hand-typed total (the
  #217 price override on its service subdoc), else `<type>_auto`.
- rental → `rental`; consulting → `consulting`.
- system / unknown / missing → `system_labor` when the quote has **any labor line** (Estimator labor rows, the
  Grid's per-system labor lines (#232), Quick Design / promoted-design labor), else `system_plain`. The plan pins
  the exact fields; the rule must be one pure function shared by the chip and the gate.

### 3. Auto-approval
- At the approval gate — every path that moves a quote to `sent` or `won` through `setStatus`/`resolveStatusGate`
  and `sendToCustomerAction` — when the quote has no live approval: look up the **quote owner's** limit for
  `reviewKindOf(quote)`; if the quote's current total (`value`) is at or under it (or the limit is No limit), stamp
  the review `state: "approved"`, `method: "auto_limit"`, `decidedBy` = the owner, `decidedAt` = now, and a
  snapshot `{ kind, limit, value }`, then let the transition proceed. Otherwise the existing refusal message stands
  (review queue or attest).
- **No stale auto-approval:** an `auto_limit` approval only counts while the quote still fits — `hasApproval` (or the
  gate) re-checks kind + value against the owner's CURRENT limit; if the quote was edited over the limit, gained
  labor, or the limit was lowered, it is not approved and needs review. In-app and attested approvals behave exactly
  as today.
- Approvers (Admin/Manager/Reviewer) are unchanged; engine-owned service flows and historical import keep their
  bypass.
- The owner is the quote's `owner` (fall back to `preparedBy`); an owner not on the roster, or with no limit for the
  kind → needs review.

### 4. Visibility
- A chip on each builder (Estimator, flame/repair/inspection/rental/consulting quote builders) and on quotes-hub
  rows: "Within your limit — approves automatically" / "Over your $25,000 limit — needs review" / nothing when the
  owner has no limit for the kind. It reads the same pure rule. Client components get the evaluated result as props
  (never import a store).
- The approval banner / Reviews history reads "Auto-approved — within Nic's $25,000 limit for system estimates
  without labor" for `auto_limit`.

## Testing
Pure: `reviewKindOf` across every type and the labor / typed-total splits; limit sanitizer; eligibility (at, under,
over, No limit, blank, unknown owner). Store/gate: send and won auto-approve within the limit and stamp the record;
refuse over it with today's message; a stale auto approval (value raised, labor added, limit lowered) no longer
passes; in-app/attested unchanged; engine-owned bypass unchanged. Settings action is `manage_users`-gated. Four gates
+ `next build`.
