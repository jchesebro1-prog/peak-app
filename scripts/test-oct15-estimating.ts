/* Jeff's 2026-10-15 decisions — Batch 2 (Estimating & client output) harness checks
   (docs/decisions/2026-10-15-jeff-decisions.md items 2, 3, 4, 6, 12–15, 17–22).
   `oct15PureChecks` needs no database; `oct15DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-oct15-estimating.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { appendResponseTo, MAX_CLIENT_RESPONSES, responseQuoteLimitKey, type ClientResponse } from "../src/lib/estimate-output/responses";

const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PTY = "pty_0123456789abcdef";
const PTY2 = "pty_fedcba9876543210";

export async function oct15PureChecks(ok: Ok) {
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
