/**
 * Can a catalog part be re-priced through the customer's tier margin, or must
 * it keep its plain list price? (punch #63 / #76)
 *
 * **Why this lives here and not in the Grid's actions.ts.** Two reasons, both
 * learned the hard way on 2026-08-01:
 *
 * 1. `actions.ts` is a `"use server"` module, and Next requires EVERY export
 *    from such a file to be an async function. A plain synchronous `export
 *    function` there is a build error — one that `tsc --noEmit` does not catch,
 *    because it is a framework constraint rather than a type error.
 * 2. The DB-free spec suite must be able to assert this predicate directly.
 *    Importing it from `actions.ts` would drag `@/lib/session` and the doc
 *    store into a script that must never touch a database, so the test had been
 *    keeping a hand-copied duplicate "in sync by hand" — which tests the copy,
 *    not the code, and passes happily once the two drift.
 *
 * So: dependency-free module, imported by both the action and the test. Same
 * remedy as `@/lib/fixture-rates` and `@/lib/review-line`.
 *
 * The rule itself: a part needs a real positive cost to derive a sell price
 * from, and a margin strictly inside (0, 1) — at 0 the division is a no-op, at
 * 1 it divides by zero. Anything else keeps `list`, and #76 requires that
 * fallback be MARKED on the quote rather than applied silently.
 */
export function isTierPriced(cost: number, margin: number): boolean {
  return typeof cost === "number" && cost > 0 && margin > 0 && margin < 1;
}
