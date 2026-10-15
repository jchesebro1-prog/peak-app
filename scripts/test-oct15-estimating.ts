/* Jeff's 2026-10-15 decisions — Batch 2 (Estimating & client output) harness checks
   (docs/decisions/2026-10-15-jeff-decisions.md items 2, 3, 4, 6, 12–15, 17–22).
   `oct15PureChecks` needs no database; `oct15DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-oct15-estimating.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { evaluateReviewLimit, largestAlternateTotal, reviewAmount, autoSnapshotUnchanged } from "../src/lib/review-limits";
import { appendResponseTo, MAX_CLIENT_RESPONSES, responseQuoteLimitKey, type ClientResponse } from "../src/lib/estimate-output/responses";

const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PTY = "pty_0123456789abcdef";
const PTY2 = "pty_fedcba9876543210";

export async function oct15PureChecks(ok: Ok) {
  oct15ReviewAmountChecks(ok);
  /* ---- #2 — each bidder gets its own client-link response budget ---- */
  {
    ok(responseQuoteLimitKey("Q-1") === "share-respond-quote:Q-1" && responseQuoteLimitKey("Q-1", null) === "share-respond-quote:Q-1",
      "oct15 #2: the owner's link keeps the quote's own rate-limit key");
    ok(responseQuoteLimitKey("Q-1", PTY) === `share-respond-quote:Q-1:${PTY}` && responseQuoteLimitKey("Q-1", PTY) !== responseQuoteLimitKey("Q-1", PTY2),
      "oct15 #2: each bidder's v3 link counts on its own key");
    ok(responseQuoteLimitKey("Q-1", "pty_bad") === "share-respond-quote:Q-1", "oct15 #2: a malformed party id falls back to the quote's key");
    const r = (i: number, partyId?: string): ClientResponse => ({
      id: "CR-" + i.toString(16).padStart(12, "0"), kind: "question", rev: 1, at: i, name: "n", email: "", message: "m", sectionIds: [], sectionNames: [], total: 0, ...(partyId ? { partyId } : {}),
    });
    const bidderFull = Array.from({ length: MAX_CLIENT_RESPONSES }, (_, i) => r(i + 1, PTY));
    ok(appendResponseTo(bidderFull, r(9001, PTY)) === null, "oct15 #2: a bidder at its stored cap is refused");
    ok(appendResponseTo(bidderFull, r(9002))?.length === MAX_CLIENT_RESPONSES + 1 && appendResponseTo(bidderFull, r(9003, PTY2))?.length === MAX_CLIENT_RESPONSES + 1,
      "oct15 #2: one bidder's full budget never closes the owner's or another bidder's");
    const ownerFull = Array.from({ length: MAX_CLIENT_RESPONSES }, (_, i) => r(i + 1));
    ok(appendResponseTo(ownerFull, r(9004)) === null && !!appendResponseTo(ownerFull, r(9005, PTY)), "oct15 #2: the owner's cap is its own too");
    const srv = rd("src/lib/estimate-output/responses-server.ts");
    ok(srv.includes("rateLimit(responseQuoteLimitKey(hit.q.id, bidder?.partyId), RESPONSE_QUOTE_LIMIT, RESPONSE_QUOTE_WINDOW_MS)") && !srv.includes("`share-respond-quote:${hit.q.id}`"),
      "oct15 #2: submitClientResponse spends the bidder's own daily slot");
  }
}

/* ---- #6 — the review limit counts base bid + the largest alternate ---- */
export function oct15ReviewAmountChecks(ok: Ok) {
  const it = (id: number, price: number) => ({ id, sku: "S" + id, desc: "d", qty: 1, unit: "ea", cost: 0, price });
  const sec = (id: string, price: number, extra: Record<string, unknown> = {}) => ({ id, name: id, kind: "materials", mfr: "", freightPct: 0, items: [it(1, price)], ...extra });
  const spec = { sections: [
    sec("base", 10_000),
    sec("a1", 3_000, { alternate: true, groupId: "gA" }),
    sec("a2", 2_500, { alternate: true, groupId: "gA" }),
    sec("b1", 4_000, { alternate: true, groupId: "gB" }),
    sec("c1", 1_000, { alternate: true }),
  ] };
  ok(largestAlternateTotal(spec) === 5_500, "oct15 #6: the largest alternate group is summed per group (A 3,000 + 2,500 beats B 4,000): " + largestAlternateTotal(spec));
  ok(largestAlternateTotal({ sections: [sec("base", 10_000)] }) === 0 && largestAlternateTotal(null) === 0 && largestAlternateTotal({ lines: [] }) === 0, "oct15 #6: no alternates → 0");
  ok(reviewAmount({ value: 10_000, spec }) === 15_500 && reviewAmount({ value: Number.NaN, spec }) === null, "oct15 #6: reviewAmount = base + largest alternate; a bad value is null");
  const ctx = { limits: { u1: { system_plain: 12_000 } }, roster: [{ id: "u1", name: "Pat", status: "active" }] };
  const q = { value: 10_000, owner: "Pat", quoteType: "system", spec };
  const ev = evaluateReviewLimit(q, ctx);
  ok(ev.value === 15_500 && ev.fits === false, "oct15 #6: a $10,000 base with a $5,500 alternate is over a $12,000 limit");
  ok(evaluateReviewLimit({ ...q, spec: { sections: [sec("base", 10_000)] } }, ctx).fits === true, "oct15 #6: the same base with no alternate fits");
  const stamped = { ...q, review: { state: "approved", method: "auto_limit", decidedBy: "Pat", auto: { kind: "system_plain" as const, limit: 20_000, value: 15_500 } } };
  ok(autoSnapshotUnchanged(stamped) === true && autoSnapshotUnchanged({ ...stamped, spec: { sections: [...spec.sections, sec("d1", 9_000, { alternate: true, groupId: "gD" })] } }) === false,
    "oct15 #6: an auto approval holds while base + largest alternate stays at its snapshot; a bigger alternate re-checks it");
}

export async function oct15DbChecks(ok: Ok) {
  void ok;
}

if (process.argv[1]?.endsWith("test-oct15-estimating.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  oct15PureChecks(okf)
    .then(() => (db ? oct15DbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
