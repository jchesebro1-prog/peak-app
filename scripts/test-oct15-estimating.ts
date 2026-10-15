/* Jeff's 2026-10-15 decisions — Batch 2 (Estimating & client output) harness checks
   (docs/decisions/2026-10-15-jeff-decisions.md items 2, 3, 4, 6, 12–15, 17–22).
   `oct15PureChecks` needs no database; `oct15DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-oct15-estimating.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { evaluateReviewLimit, largestAlternateTotal, reviewAmount, autoSnapshotUnchanged } from "../src/lib/review-limits";
import { addendaAdded, addendumRevisedNote } from "../src/lib/parties/bids";
import { bidderSendPlan, BID_SEND_COPY } from "../src/lib/parties/bid-send";
import { like } from "drizzle-orm";
import { getDb } from "../src/db";
import { companies, contacts as contactsTable } from "../src/db/schema";
import { saveContact, setEmails } from "../src/lib/identity/contacts";
import { saveCompany } from "../src/lib/identity/companies";
import { createFixture, dropFixtures, fixtureId, registerFixture } from "./test-fixtures";
import { buildQuote, get as getQuote, setStatus } from "../src/lib/stores/quotes";
import { listFor } from "../src/lib/stores/parties";
import { addBidder, setBidDetails, recordBidderSend } from "../src/lib/stores/bids";
import { loadBidPanel } from "../src/lib/parties/bid-panel-server";
import { appendResponseTo, MAX_CLIENT_RESPONSES, responseQuoteLimitKey, type ClientResponse } from "../src/lib/estimate-output/responses";

const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PTY = "pty_0123456789abcdef";
const PTY2 = "pty_fedcba9876543210";

export async function oct15PureChecks(ok: Ok) {
  oct15ReviewAmountChecks(ok);
  /* ---- #3 / #4 (pure + pins) ---- */
  {
    ok(JSON.stringify(addendaAdded([{ no: 1 }], [{ no: 1 }, { no: 3 }, { no: 2 }])) === "[2,3]" && addendaAdded(null, []).length === 0 && addendaAdded([{ no: 1 }, { no: 2 }], [{ no: 1 }]).length === 0,
      "oct15 #3: addendaAdded lists only new numbers (a removal adds none)");
    ok(addendumRevisedNote([2]).startsWith("Addendum 2 added — the estimate is back in Draft.") && addendumRevisedNote([2, 3]).startsWith("Addenda 2, 3 added"), "oct15 #3: the chip's note");
    const B = (revSent: number | null) => ({ result: "pending", submitVia: "email", revSent, failed: null }) as never;
    const revs = { status: "draft", revisions: [{ rev: 1, reason: "sent" }] };
    const plan = bidderSendPlan(revs, [{ id: "a", bid: B(1), email: "a@e.test" }, { id: "b", bid: B(null), email: "b@e.test" }]);
    ok(plan.label === "Send revision to all bidders" && plan.label === BID_SEND_COPY.sendRevision && plan.ids.join() === "a,b", "oct15 #3: a revising bid sends the revision to every bidder (new ones too)");
    const st = rd("src/lib/stores/bids.ts");
    ok(/q\.status === "sent" && added\.length > 0\) \{\s*\/\/[^\n]*\n\s*await setStatus\(quoteId, "draft"/.test(st) && st.indexOf("withQuoteRowLock(quoteId") < st.indexOf('await setStatus(quoteId, "draft"'),
      "oct15 #3: the revise is the normal setStatus(\"draft\") under the bid's row lock");
    const chip = rd("src/app/(app)/estimator/bid-chip.tsx");
    ok(chip.includes('"peak:bid-revised"') && chip.includes("onRevised?.()") && rd("src/app/(app)/estimator/steps/bidders-card.tsx").includes('"peak:bid-revised"'),
      "oct15 #3: the chip tells the Bidders card and the Estimator's status to follow");
    // #4 — already so: the first bidder send of a draft marks the estimate Sent through the normal path.
    const ss = rd("src/lib/estimate-email/send-server.ts");
    const mark = ss.slice(ss.indexOf("async function markAndLink("), ss.indexOf("async function attachmentsFor("));
    ok(mark.includes('if (p.q.status === "draft")') && mark.includes("deps.sendQuote(p.q.id, actor") && ss.includes("sendQuote: (id, actor, asOf) => sendQuoteToCustomer(id, actor, asOf)")
      && ss.slice(ss.indexOf("export function liveBidderEmailDeps("), ss.indexOf("export function liveBidderEmailDeps(") + 400).includes("...liveEstimateEmailDeps(opts)")
      && rd("src/lib/quote-review-ops.ts").includes('const gate = await checkApprovalGate(q, "sent", actor.name);'),
      "oct15 #4 (already so): a bidder send on a Draft runs sendQuoteToCustomer — the approval gate, then setStatus(\"sent\")");
  }
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

const FIX = "O15B2";
const CO = { own: fixtureId(FIX, "own"), gc: fixtureId(FIX, "gc"), ct: fixtureId(FIX, "ct") };

async function dropCompanies() {
  const db = await getDb();
  await db.delete(contactsTable).where(like(contactsTable.id, `TEST${FIX}:%`));
  await db.delete(companies).where(like(companies.id, `TEST${FIX}:%`));
}

export async function oct15DbChecks(ok: Ok) {
  try {
    await dropCompanies();
    await saveCompany({ id: CO.own, name: "O15 Owner", type: "customer", lifecycle: "active", deleted: false });
    await saveCompany({ id: CO.gc, name: "O15 GC", type: "customer", lifecycle: "active", deleted: false });
    await saveContact({ id: CO.ct, firstName: "Gee", lastName: "Cee", homeCompanyId: CO.gc });
    await setEmails(CO.ct, [{ value: "gee@o15.test", label: "work", isPrimary: true }] as never);
    await oct15BidDbChecks(ok);
  } finally {
    await dropFixtures(FIX);
    await dropCompanies();
  }
}

/* ---- #3 / #4 — an addendum after a send → Draft; Send revision goes to every bidder ---- */
async function oct15BidDbChecks(ok: Ok) {
  const qid = fixtureId(FIX, "bidq");
  const NOW = Date.now();
  await createFixture("quotes", buildQuote(qid, { name: "O15 bid", customer: "O15 Owner", customerId: CO.own, value: 1000 } as never, "system", null, NOW) as never);
  const a = await addBidder({ quoteId: qid, companyId: CO.gc, contactId: CO.ct, role: "gc" }, "u");
  for (const p of await listFor("quote", qid)) registerFixture("record_parties", p.id);
  if (!a.ok) throw new Error("oct15: bidder not added");
  const A1 = { no: 1, receivedAt: Date.UTC(2026, 9, 1, 17), note: "" };
  const A2 = { no: 2, receivedAt: Date.UTC(2026, 9, 3, 17), note: "" };
  const d0 = await setBidDetails(qid, { addenda: [A1] }, "Pat");
  ok(d0.ok && !d0.revised && (await getQuote(qid))?.status === "draft", "oct15 #3: an addendum on a draft just saves");
  await setStatus(qid, "sent", "Pat", { bypassApprovalGate: "engine-owned-flow" });
  await recordBidderSend(qid, a.party.id, { threadId: "C-o15", rev: 1, at: NOW, by: "Pat", to: "gc@e.test" }, { kind: "sent" }, "u1");
  const d1 = await setBidDetails(qid, { dueAt: NOW + 86_400_000 }, "Pat");
  ok(d1.ok && !d1.revised && (await getQuote(qid))?.status === "sent", "oct15 #3: a due-date change on a sent bid leaves it Sent");
  const d2 = await setBidDetails(qid, { addenda: [A1, A2] }, "Pat");
  const q2 = await getQuote(qid);
  ok(d2.ok && JSON.stringify(d2.revised) === "[2]" && q2?.status === "draft" && q2.history?.at(-1)?.from === "sent" && q2.history?.at(-1)?.to === "draft",
    "oct15 #3: a new addendum on a sent bid puts it back to Draft through setStatus (history sent → draft)");
  ok((q2?.revisions || []).filter((r) => r.reason === "sent").length === 1, "oct15 #3: the revise cuts no revision — the next send does");
  const panel = await loadBidPanel(qid, { canEdit: true, canSend: true, canLink: true });
  ok(panel.ok && panel.panel.plan.label === "Send revision to all bidders" && panel.panel.bidders[0]?.sendLabel === "Send revision",
    "oct15 #3: the Bidders card then offers \"Send revision to all bidders\": " + (panel.ok ? String(panel.panel.plan.label) : panel.error));
  const d3 = await setBidDetails(qid, { addenda: [A1, A2] }, "Pat");
  ok(d3.ok && !d3.revised, "oct15 #3: re-saving the same addenda changes nothing");
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
