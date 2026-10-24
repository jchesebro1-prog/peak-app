# Ports — what your system supplies

**Confidential — Peak Systems Group.**

The prototype is Quartzite's Estimator with Quartzite itself taken away. Everything Quartzite's server
did that is *not* estimating goes through a small set of **ports**. Each port is an interface your own
software implements. The prototype ships a fake for each, so the Estimator runs on its own.

| Port | What it is in Quartzite | The prototype's fake |
|---|---|---|
| `users` | Google sign-in, the `users` table, roles → permissions | the **Acting as** picker over the bundled roster |
| `customers` | the companies / venues / contacts tables, pricing tiers, routed travel distances | `data/customers.js`, read-only |
| `numbering` | one database counter for estimate numbers | a counter in the browser, starting after the highest bundled number |
| `email` | sends the estimate from the sender's own Gmail and threads it | records the message; Activity reads *Sent (simulated)* |
| `onWon` | creates the install project, the bonus record and the pipeline moves | logs *Would create install project for …* |
| `clock` | the server clock, Chicago time | `Date.now()`, `America/Chicago` |

Quotes themselves are stored the way `data-model.md` describes. In the prototype they live in a local
IndexedDB copy, on top of the read-only snapshot. In your rebuild they come from, and save to, your own
system. The Estimator's server actions (save, status moves, review, comments…) become calls into that
store under the same names. The prototype's versions are ports of Quartzite's own and keep its rules:
the approval gate, revisions, the server-side recomputation of value, the bonus lines. One rule is
switched off: **Rewards**. The prototype has no Rewards ledger, so applying a customer's credit is off,
and reopening a Won estimate at the version that won restores it with a credit of 0 (Quartzite puts the
customer's credit line back). Your rebuild's Rewards, if any, plug in where the credit line is priced
(`pricing.md`).

Below are the contracts exactly as the prototype's source declares them. The text is generated from
`handoff/estimator/runtime/ports.ts` when the package is built. Read "Quartzite:" as *what the real
system does* and "Prototype:" as *what the fake does instead*.

## The ports

<!-- @api handoff/estimator/runtime/ports.ts users customers numbering email onWon clock -->

## Types the ports use

### `TeamUser` (a roster member, `data/team.js`)

<!-- @fields handoff/estimator/runtime/seed.ts SeedTeamUser -->

### `TravelLite` (what `customers.travelFor` returns)

<!-- @fields src/lib/estimating-core/types.ts TravelLite -->

### `EmailActivity` (what `email.send` records)

<!-- @fields handoff/estimator/runtime/ports.ts EmailActivity -->

## The rules behind `customers`

The customer port is more than a lookup. These pure functions carry Quartzite's rules for tiers, travel
and numbering. Your implementation should give the same answers.

<!-- @api handoff/estimator/runtime/ports.ts resolveTierFor tierMarkupOf travelFromParts nextEstNoFrom -->

## Permissions

`users.can(perm)` answers from Quartzite's role table (`data-model.md` → *Roles*). The four permissions
are `manage_users`, `approve`, `create` and `send`. The Estimator asks for `create` to build and save,
`approve` to approve or send back, and `send` to send to the customer. The roster's `roles` are Peak's
four: Admin, Manager, Estimator, Reviewer.
