/* The app sends no email (removal stage 2): an estimate is marked sent by hand — "Send to customer →" in the Status
   card (sendQuoteToCustomer) or the status select (setStatus). These checks pin that the manual path does the
   record-keeping an emailed send used to do: status → sent, the sent revision cut (frozen spec + printed header,
   who and when), the client link mintable on it, bidders stamped with that revision by Mark submitted, and a box
   goods sale that still carries labor refused.
   Needs a scratch database: `TEST_DB=$(mktemp -d) && PGLITE_PATH="$TEST_DB" tsx scripts/test-mark-sent.ts`. */
import { readFileSync } from "node:fs";
import { like } from "drizzle-orm";
import type { Ok } from "./ok-type";
import { getDb } from "../src/db";
import { companies } from "../src/db/schema";
import { saveCompany } from "../src/lib/identity/companies";
import { createFixture, dropFixtures, fixtureId, registerFixture } from "./test-fixtures";
import { buildQuote, get as getQuote, setStatus, type Quote } from "../src/lib/stores/quotes";
import { approveQuoteReview, sendQuoteToCustomer, submitQuoteForApproval } from "../src/lib/quote-review-ops";
import { latestSentRevision } from "../src/lib/quote-pdf/state";
import { ensureShareLink } from "../src/lib/quote-share/links";
import { addBidder, listBidders, markSubmitted } from "../src/lib/stores/bids";
import { listFor } from "../src/lib/stores/parties";
import { currentRev, needsRev } from "../src/lib/parties/bids";
import { BOX_SALE_LABOR_MESSAGE, boxSaleSendProblem } from "../src/lib/estimate-box-sale/rules";
import { sendStepLayout } from "../src/lib/estimate-steps/send-layout";

const SCOPE = 902;
/** The estimate's owner (sends it) and an approver (the approval gate wants an approval on record first). */
const ADMIN = { name: "Mark Sent Estimator", roles: ["Estimator"] };
const APPROVER = { name: "Jeff Chesebro", roles: ["Admin"] };
/** Submit + approve, as the Estimator's next-step control does before Send to customer. Best effort on a re-approve. */
async function approve(id: string): Promise<void> {
  await submitQuoteForApproval(id, ADMIN, null);
  await approveQuoteReview(id, APPROVER);
}
const SPEC = { sections: [{ id: "s1", name: "Rigging", items: [{ id: 1, sku: "TEST902:PART", desc: "Batten clamp", qty: 2, unit: "ea", cost: 10, price: 15 }] }] };
const LABOR_SPEC = { sections: [{ id: "s1", name: "Install", kind: "labor", items: [] }] };

export function markSentPureChecks(ok: Ok) {
  const draft = sendStepLayout("draft", true), sent = sendStepLayout("sent", true);
  ok(draft[0] === "status" && draft.includes("clientLink") && draft.includes("bidders") && draft.includes("vendors") && draft.includes("pipeline"), "mark sent: a draft's Send & track leads with the Status card (the next step marks it sent)");
  ok(!(draft as string[]).includes("composer") && !(sent as string[]).includes("activity") && !(sent as string[]).includes("composer"), "mark sent: no email composer or email Activity card in any status");
  ok(!sendStepLayout("draft", false).includes("pipeline") && sendStepLayout("won", true).includes("status"), "mark sent: the Pipeline card only when the stage bar applies; Status always");
  ok(boxSaleSendProblem({ boxSale: true, quoteType: "system", source: "estimator", spec: LABOR_SPEC } as never) === BOX_SALE_LABOR_MESSAGE, "mark sent: a box goods sale with labor is refused, with the save's own sentence");
  ok(boxSaleSendProblem({ boxSale: true, quoteType: "system", source: "estimator", spec: SPEC } as never) === null && boxSaleSendProblem({ boxSale: false, quoteType: "system", spec: LABOR_SPEC } as never) === null, "mark sent: a box sale without labor, and an ordinary estimate with labor, are not refused");
  const rd = (p: string) => readFileSync(p, "utf8");
  const step = rd("src/app/(app)/estimator/steps/send-step.tsx"), row = rd("src/app/(app)/estimator/steps/bidder-row.tsx");
  ok(!step.includes("SendComposer") && !step.includes("SendActivity") && step.includes("<QuoteNextStep") && step.includes("<ClientLinkPanel"), "mark sent (source): the Send step keeps the next-step control and the client link, without the email cards");
  ok(/\{b\.result === "pending" && \(\s*<button type="button" aria-label=\{`Mark submitted/.test(row), "mark sent (source): Mark submitted is offered on every pending bidder, not only bid-website rows");
  const ops = rd("src/lib/quote-review-ops.ts"), store = rd("src/lib/stores/quotes.ts");
  ok(ops.indexOf("boxSaleSendProblem(q)") > 0 && ops.indexOf("boxSaleSendProblem(q)") < ops.indexOf('checkApprovalGate(q, "sent", actor.name)'), "mark sent (source): Send to customer checks the box-sale rule before the approval gate");
  ok(store.includes('pushRevision(doc, by || DEFAULT_ACTOR, "sent", "Sent to customer");') && store.includes("if (out && sentCut.value) await copySentPdfSafely(id);") && store.includes("await scheduleRevisePdfSafely(id);"),
    "mark sent (source): moving to Sent cuts the sent revision, copies the current PDF onto it, and schedules a render when the file is behind");
}

async function dropCompanies() {
  const db = await getDb();
  await db.delete(companies).where(like(companies.id, `TEST${SCOPE}:%`));
}

export async function markSentDbChecks(ok: Ok) {
  process.env.AUTH_SECRET ||= "quartzite-test-secret-not-for-production";
  const own = fixtureId(SCOPE, "own"), gc = fixtureId(SCOPE, "gc");
  const q1 = fixtureId(SCOPE, "q1"), q2 = fixtureId(SCOPE, "q2"), q3 = fixtureId(SCOPE, "q3"), q4 = fixtureId(SCOPE, "qbox");
  const NOW = Date.now();
  const draftOf = (id: string, extra: Partial<Quote> = {}) =>
    buildQuote(id, { name: "Mark sent " + id, customer: "Mark Sent Owner", customerId: own, value: 30, owner: ADMIN.name, source: "estimator", spec: SPEC, ...extra } as never, "system", null, NOW);
  const regParties = async () => {
    for (const id of [q1, q2, q3, q4]) for (const p of await listFor("quote", id)) registerFixture("record_parties", p.id);
  };
  try {
    await dropCompanies();
    await saveCompany({ id: own, name: "Mark Sent Owner", type: "customer", lifecycle: "active", deleted: false });
    await saveCompany({ id: gc, name: "Mark Sent GC", type: "customer", lifecycle: "active", deleted: false });
    for (const id of [q1, q2, q3]) await createFixture("quotes", draftOf(id) as never);
    await createFixture("quotes", draftOf(q4, { boxSale: true, spec: LABOR_SPEC } as never) as never);

    // 1 — Send to customer → (the Status card's next step)
    const unapproved = await sendQuoteToCustomer(q1, ADMIN);
    ok(!unapproved.ok && (await getQuote(q1))?.status === "draft", "mark sent db: an unapproved estimate is not marked sent (the approval gate still applies)");
    await approve(q1);
    const before = (await getQuote(q1))!;
    ok(before.status === "draft" && before.review?.state === "approved" && !(before.revisions || []).some((r) => r.reason === "sent"), "mark sent db: the fixture is an approved draft with no sent revision");
    const noPerm = await sendQuoteToCustomer(q1, { name: "Nobody", roles: [] }, before.updatedAt);
    const stale = await sendQuoteToCustomer(q1, ADMIN, before.updatedAt - 1);
    ok(!noPerm.ok && !stale.ok && (await getQuote(q1))?.status === "draft", "mark sent db: no permission, or a stale version, is refused and nothing moves");
    const t0 = Date.now();
    const sent = await sendQuoteToCustomer(q1, ADMIN, before.updatedAt);
    const a = (await getQuote(q1))!;
    const rev = latestSentRevision(a.revisions) as unknown as { rev: number; at: number; by: string; reason: string; spec?: unknown; docFields?: unknown } | null;
    ok(sent.ok && a.status === "sent", "mark sent db: Send to customer moves the draft to Sent");
    ok(!!rev && (a.revisions || []).filter((r) => r.reason === "sent").length === 1 && rev.reason === "sent" && rev.by === ADMIN.name && rev.at >= t0 && rev.at <= Date.now(), "mark sent db: one sent revision is cut — who and when (the revision's time is the sent time)");
    ok(!!rev && JSON.stringify(rev.spec) === JSON.stringify(a.spec) && !!rev.docFields && currentRev(a) === rev.rev, "mark sent db: the sent revision freezes the spec and the printed header, and is the current revision");
    const again = await sendQuoteToCustomer(q1, ADMIN);
    ok(!again.ok && ((await getQuote(q1))?.revisions || []).filter((r) => r.reason === "sent").length === 1, "mark sent db: an estimate already sent is not sent (or re-cut) twice");

    // 2 — the status select (setStatus) does the same record-keeping
    await approve(q2);
    await setStatus(q2, "sent", ADMIN.name);
    const b = (await getQuote(q2))!;
    const revB = latestSentRevision(b.revisions) as unknown as { rev: number; by: string } | null;
    ok(b.status === "sent" && !!revB && revB.by === ADMIN.name && (b.revisions || []).filter((r) => r.reason === "sent").length === 1, "mark sent db: the status select cuts the same sent revision");

    // 3 — the client link is minted on the sent revision (Copy client link)
    const draftLink = await ensureShareLink(q3, ADMIN.name);
    const link = await ensureShareLink(q1, ADMIN.name);
    ok(!draftLink.ok && link.ok, "mark sent db: the client link is refused on a draft and minted once the estimate is marked sent");

    // 4 — bidders: Mark submitted stamps the sent revision, for an email bidder too
    const add = await addBidder({ quoteId: q1, companyId: gc, role: "gc", submitVia: "email" }, ADMIN.name);
    ok(add.ok && needsRev(add.ok ? add.party.bid : null, rev!.rev), "mark sent db: a new email bidder needs the current revision");
    if (add.ok) {
      const ms = await markSubmitted(add.party.id, ADMIN.name, "CONF-1");
      const bid = (await listBidders(q1)).find((p) => p.id === add.party.id)?.bid;
      ok(ms.ok && !!bid && bid.revSent === rev!.rev && bid.sentBy === ADMIN.name && typeof bid.sentAt === "number" && bid.confirmation === "CONF-1" && !needsRev(bid, rev!.rev),
        "mark sent db: Mark submitted stamps the bidder with the sent revision, who, when and the confirmation");
      // a revise + re-send cuts Rev 2: the bidder needs it until marked submitted again
      await setStatus(q1, "draft", ADMIN.name);
      await approve(q1);
      await setStatus(q1, "sent", ADMIN.name);
      const c = (await getQuote(q1))!;
      const rev2 = latestSentRevision(c.revisions) as unknown as { rev: number } | null;
      const stale2 = (await listBidders(q1)).find((p) => p.id === add.party.id)?.bid ?? null;
      ok(!!rev2 && rev2.rev > rev!.rev && needsRev(stale2, rev2.rev), "mark sent db: after a revise and re-send the bidder needs the new revision");
      await markSubmitted(add.party.id, ADMIN.name, "");
      const fresh = (await listBidders(q1)).find((p) => p.id === add.party.id)?.bid;
      ok(!!rev2 && fresh?.revSent === rev2.rev, "mark sent db: Mark submitted again stamps the new revision");
    }

    // 5 — a box goods sale that still carries labor is never marked sent by Send to customer
    const box = (await getQuote(q4))!;
    const boxSend = await sendQuoteToCustomer(q4, ADMIN, box.updatedAt);
    ok(!boxSend.ok && boxSend.error === BOX_SALE_LABOR_MESSAGE && (await getQuote(q4))?.status === "draft", "mark sent db: a box goods sale with labor is refused and stays a draft");
  } finally {
    try { await regParties(); } catch {}
    await dropFixtures(SCOPE);
    await dropCompanies();
  }
}

if (process.argv[1] && /test-mark-sent\.ts$/.test(process.argv[1])) {
  let fail = 0, pass = 0;
  const ok: Ok = (c, m) => {
    if (c) pass++;
    else { fail++; console.log("FAIL " + m); }
  };
  if (process.env.DATABASE_URL) {
    console.error("Refusing to run: DATABASE_URL is set; unset it (this suite writes to the DB).");
    process.exit(1);
  }
  if (!process.env.PGLITE_PATH) {
    console.error("Refusing to run: PGLITE_PATH is not set — use a scratch datadir, never the dev DB.");
    process.exit(1);
  }
  (async () => {
    markSentPureChecks(ok);
    await markSentDbChecks(ok);
    console.log(fail ? `\n${pass} passed, ${fail} FAILED` : `\nall ${pass} mark-sent checks passed`);
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}
