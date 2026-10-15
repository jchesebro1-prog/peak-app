/* #348 slice 2a — bids harness checks. `bidChecks` is pure; `bidDbChecks` needs the test DB (Task 2 fills it).
   Run the pure half alone with `npx tsx scripts/test-bids.ts`. */
import type { Ok } from "./test-inbox-org";
import {
  BID_RESULTS, BID_RESULT_LABEL, EMPTY_BID, sanitizeBidDetails, sanitizeBidSiteUrl, sanitizeBidderPatch, newBidderState, applyBidderPatch,
  markSubmittedState, currentRev, needsRev, awardPlan, undoAwardPlan, canAward, canUndoAward, bidderStatusText, bidDueText, bidDueDays, isOpenBid,
} from "../src/lib/parties/bids";
import type { BidderState } from "../src/lib/parties/rules";
import { like } from "drizzle-orm";
import { getDb } from "../src/db";
import { companies, contacts as contactsTable } from "../src/db/schema";
import { saveCompany } from "../src/lib/identity/companies";
import { saveContact } from "../src/lib/identity/contacts";
import { createFixture, dropFixtures, fixtureId, registerFixture } from "./test-fixtures";
import { buildQuote, get as getQuote, setStatus } from "../src/lib/stores/quotes";
import { getProjectByQuote } from "../src/lib/stores/projects";
import { autoTaskId } from "../src/lib/stores/tasks";
import { listFor } from "../src/lib/stores/parties";
import { addBidder, awardBid, listBidders, markSubmitted, setBidDetails, undoAward, updateBidder } from "../src/lib/stores/bids";

const T1 = Date.UTC(2026, 9, 1);
const B = (over: Partial<BidderState> = {}): BidderState => ({ ...newBidderState("email"), ...over });

export async function bidChecks(ok: Ok) {
  ok(BID_RESULTS.join() === "pending,awarded,lost,withdrew,no_bid", "bids: result keys");
  ok(BID_RESULT_LABEL.lost === "Lost the award" && BID_RESULT_LABEL.no_bid === "No bid", "bids: result labels");
  ok(EMPTY_BID.dueAt === null && EMPTY_BID.addenda.length === 0 && EMPTY_BID.awardedPartyId === null, "bids: empty bid");

  const d = sanitizeBidDetails({ dueAt: 1_800_000_000_000, addenda: [{ no: 2, receivedAt: Date.UTC(2026, 9, 5), note: " b " }, { no: 1, receivedAt: Date.UTC(2026, 9, 4), note: "a" }] });
  ok(d.ok && d.value.dueAt === 1_800_000_000_000 && d.value.addenda.map((a) => a.no).join() === "1,2" && d.value.addenda[1].note === "b", "bids: details sanitized, addenda sorted + trimmed");
  ok(sanitizeBidDetails({ dueAt: null, addenda: [] }).ok, "bids: no due date is fine");
  const dupe = sanitizeBidDetails({ dueAt: null, addenda: [{ no: 1, receivedAt: T1, note: "" }, { no: 1, receivedAt: T1 + 1, note: "" }] });
  ok(!dupe.ok && dupe.error === "Addendum 1 is listed twice.", "bids: duplicate addendum refused");
  ok(!sanitizeBidDetails({ dueAt: -5, addenda: [] }).ok, "bids: bad due date refused");
  ok(!sanitizeBidDetails({ dueAt: null, addenda: [{ no: 100, receivedAt: T1, note: "" }] }).ok, "bids: addendum number range 1–99");
  ok(!sanitizeBidDetails({ dueAt: null, addenda: Array.from({ length: 31 }, (_, i) => ({ no: i + 1, receivedAt: T1, note: "" })) }).ok, "bids: ≤ 30 addenda");
  const longNote = sanitizeBidDetails({ dueAt: null, addenda: [{ no: 1, receivedAt: T1, note: "x".repeat(201) }] });
  ok(!longNote.ok && longNote.error === "Keep each addendum note under 200 characters.", "bids: addendum note ≤ 200");
  ok(!sanitizeBidDetails(null).ok && !sanitizeBidDetails("x").ok, "bids: non-object refused");

  const u = sanitizeBidSiteUrl(" https://app.buildingconnected.com/x ");
  ok(u.ok && u.value === "https://app.buildingconnected.com/x", "bids: https bid-site url kept, trimmed");
  ok(sanitizeBidSiteUrl("").ok && (sanitizeBidSiteUrl("") as { value: unknown }).value === null, "bids: blank url clears");
  const bad = sanitizeBidSiteUrl("javascript:alert(1)");
  ok(!bad.ok && bad.error === "Use a link that starts with http:// or https://.", "bids: non-http url refused");
  ok(!sanitizeBidSiteUrl("https://" + "a".repeat(500)).ok, "bids: url ≤ 500");

  const p = sanitizeBidderPatch({ submitVia: "website", gcBidNo: " 24-117 ", result: "withdrew", bidSiteUrl: "https://x.test/b" });
  ok(p.ok && p.value.submitVia === "website" && p.value.gcBidNo === "24-117" && p.value.result === "withdrew" && p.value.bidSiteUrl === "https://x.test/b", "bids: bidder patch sanitized");
  ok(!sanitizeBidderPatch({ result: "awarded" }).ok, "bids: awarded only via award");
  ok(!sanitizeBidderPatch({ result: "lost" }).ok, "bids: lost only via award");
  ok(!sanitizeBidderPatch({ submitVia: "fax" }).ok, "bids: submitVia email|website");
  ok(!sanitizeBidderPatch({ gcBidNo: "x".repeat(61) }).ok, "bids: gcBidNo ≤ 60");
  const cleared = sanitizeBidderPatch({ bidSiteUrl: "" });
  ok(cleared.ok && cleared.value.bidSiteUrl === undefined && "bidSiteUrl" in cleared.value, "bids: blank bid-site url clears the field");

  const nb = newBidderState("website");
  ok(nb.result === "pending" && nb.submitVia === "website" && nb.revSent === null && nb.sentAt === null && nb.failed === null, "bids: new bidder state");
  ok(newBidderState().submitVia === "email", "bids: default submit via email");
  const applied = applyBidderPatch(B({ bidSiteUrl: "https://old.test" }), { bidSiteUrl: undefined, gcBidNo: "7" });
  ok(applied.bidSiteUrl === undefined && applied.gcBidNo === "7" && applied.result === "pending", "bids: patch applies, undefined clears");

  const ms = markSubmittedState(B({ failed: { at: T1, error: "x" } }), 2, "u1", "  CONF-9  ", 1234);
  ok(ms.revSent === 2 && ms.sentAt === 1234 && ms.sentBy === "u1" && ms.confirmation === "CONF-9" && ms.failed === null, "bids: mark submitted stamps rev/time/by/confirmation");
  ok(markSubmittedState(B(), 1, "u", "y".repeat(200), T1).confirmation!.length === 120, "bids: confirmation capped at 120");

  ok(currentRev({}) === 1 && currentRev({ revisions: [] }) === 1 && currentRev({ revisions: [1, 2, 3] }) === 3, "bids: current rev = max(1, revisions)");
  ok(needsRev(B(), 1) && !needsRev(B({ revSent: 1 }), 1) && needsRev(B({ revSent: 1 }), 2), "bids: needsRev by revSent");
  ok(!needsRev(B({ result: "withdrew" }), 3) && !needsRev(null, 1), "bids: only pending bidders need a rev");

  const rows = [
    { id: "a", bid: B() },
    { id: "b", bid: B() },
    { id: "c", bid: B({ result: "no_bid" }) },
  ];
  const aw = awardPlan(rows, "a");
  ok(aw.ok && aw.updates.length === 2, "bids: award touches the winner + pending others only");
  if (aw.ok) {
    const byId = new Map(aw.updates.map((u) => [u.id, u.bid]));
    ok(byId.get("a")!.result === "awarded" && byId.get("b")!.result === "lost" && byId.get("b")!.lostByAward === true && !byId.has("c"), "bids: winner awarded, pending → lost (lostByAward), no_bid untouched");
  }
  ok(!awardPlan(rows, "zzz").ok, "bids: award needs a bidder of this estimate");
  const twice = awardPlan([{ id: "a", bid: B({ result: "awarded" }) }, { id: "b", bid: B() }], "b");
  ok(!twice.ok && twice.error === "This bid is already awarded — undo that first.", "bids: one award at a time");
  const wd = awardPlan([{ id: "a", bid: B({ result: "withdrew" }) }], "a");
  ok(!wd.ok && wd.error === "That bidder withdrew or didn't bid.", "bids: can't award a withdrawn bidder");
  const undo = undoAwardPlan([{ id: "a", bid: B({ result: "awarded" }) }, { id: "b", bid: B({ result: "lost", lostByAward: true }) }, { id: "c", bid: B({ result: "withdrew" }) }]);
  ok(undo.length === 2 && undo.every((u) => u.bid.result === "pending" && !u.bid.lostByAward), "bids: undo returns winner + award-lost to pending");

  ok(canAward("draft") && canAward("sent") && !canAward("won") && !canAward("lost"), "bids: award while draft/sent");
  ok(canUndoAward("sent") && canUndoAward("lost") && !canUndoAward("won"), "bids: undo until won");

  const OCT21_2PM = Date.UTC(2026, 9, 21, 19, 0); // 2:00 PM CDT
  ok(bidDueText(OCT21_2PM) === "Oct 21, 2:00 PM", "bids: due text in Chicago");
  ok(bidderStatusText(B(), 1) === "Not submitted", "bids: status — not submitted");
  ok(bidderStatusText(B({ revSent: 1, sentAt: OCT21_2PM }), 1) === "Submitted Rev 1 · Oct 21", "bids: status — submitted");
  ok(bidderStatusText(B({ revSent: 1, sentAt: OCT21_2PM }), 2) === "Needs Rev 2", "bids: status — needs rev");
  ok(bidderStatusText(B({ result: "lost" }), 2) === "Lost the award" && bidderStatusText(B({ result: "awarded" }), 2) === "Awarded", "bids: status — result wins");

  const NOW = Date.UTC(2026, 9, 20, 15, 0); // Oct 20 10 AM CDT
  ok(bidDueDays(OCT21_2PM, NOW) === 1 && bidDueDays(NOW + 3600_000, NOW) === 0 && bidDueDays(NOW - 86_400_000, NOW) === -1, "bids: due days in Chicago calendar days");

  const pend = [{ bid: B() }];
  ok(isOpenBid({ status: "sent", bid: EMPTY_BID }, pend), "bids: open = draft/sent, a pending bidder, no award");
  ok(!isOpenBid({ status: "sent", bid: { ...EMPTY_BID, awardedPartyId: "a" } }, pend), "bids: awarded is not open");
  ok(!isOpenBid({ status: "won", bid: EMPTY_BID }, pend) && !isOpenBid({ status: "draft", bid: null }, []), "bids: won / no bidders not open");
  ok(!isOpenBid({ status: "sent" }, [{ bid: B({ result: "withdrew" }) }]), "bids: no pending bidder → not open");

  // review round 1: bounds, mistyped edits, DST, round trips
  ok(!sanitizeBidDetails({ dueAt: 1e16, addenda: [] }).ok, "bids: out-of-range due date refused");
  ok(!sanitizeBidDetails({ dueAt: NaN, addenda: [] }).ok && !sanitizeBidDetails({ dueAt: Infinity, addenda: [] }).ok, "bids: NaN/Infinity due date refused");
  ok(!sanitizeBidDetails({ dueAt: null, addenda: [{ no: 1, receivedAt: 1e16, note: "" }] }).ok, "bids: out-of-range addendum date refused");
  ok(bidDueText(1e16) === "", "bids: due text empty out of range");
  ok(bidDueDays(1e16, Date.UTC(2026, 9, 20, 15, 0)) === Infinity, "bids: due days infinite out of range");
  ok(bidderStatusText(B({ revSent: 1, sentAt: 1e16 }), 1) === "Submitted Rev 1", "bids: status omits an out-of-range date");
  ok(bidDueDays(Date.UTC(2026, 9, 21, 4, 30), Date.UTC(2026, 9, 20, 15, 0)) === 0, "bids: late-evening Chicago due date is still today");
  ok(bidDueDays(Date.UTC(2026, 10, 2, 18, 0), Date.UTC(2026, 10, 1, 15, 0)) === 1, "bids: due days across the DST change");
  const upper = sanitizeBidSiteUrl("HTTPS://X.TEST/A");
  ok(upper.ok && upper.value === "HTTPS://X.TEST/A", "bids: uppercase scheme accepted");
  ok(!sanitizeBidSiteUrl("https://x.test/a b").ok, "bids: url with inner whitespace refused");
  ok(!sanitizeBidderPatch({ gcBidNo: 7 }).ok && !sanitizeBidderPatch({ bidSiteUrl: 7 }).ok, "bids: non-text bidder values refused");
  ok(sanitizeBidderPatch({ gcBidNo: null }).ok, "bids: null gcBidNo clears");
  const badAdd = sanitizeBidDetails({ dueAt: null, addenda: "x" });
  ok(!badAdd.ok && badAdd.error === "Addenda must be a list.", "bids: non-array addenda refused");
  const noAdd = sanitizeBidDetails({ dueAt: null });
  ok(noAdd.ok && noAdd.value.addenda.length === 0, "bids: omitted addenda means none");
  ok(markSubmittedState(B(), 1, "u", 5 as unknown as string, T1).confirmation === undefined, "bids: non-string confirmation ignored");
  const orig = [{ id: "a", bid: B() }, { id: "b", bid: B() }, { id: "c", bid: B({ result: "no_bid" }) }];
  const plan = awardPlan(orig, "a");
  if (plan.ok) {
    const upd = new Map(plan.updates.map((x) => [x.id, x.bid]));
    const after = orig.map((r) => ({ id: r.id, bid: upd.get(r.id) ?? r.bid }));
    const back = new Map(undoAwardPlan(after).map((x) => [x.id, x.bid]));
    ok(["a", "b"].every((id) => back.get(id)?.result === "pending" && !("lostByAward" in back.get(id)!)) && !back.has("c"), "bids: undo restores every bidder to pending");
    ok(orig.every((r) => r.bid.result === (r.id === "c" ? "no_bid" : "pending")), "bids: award plan doesn't mutate its input");
  } else ok(false, "bids: round-trip plan");
  const frozen = Object.freeze(B({ gcBidNo: "1" }));
  const patched = applyBidderPatch(frozen, { gcBidNo: undefined, submitVia: "website" });
  ok(frozen.gcBidNo === "1" && frozen.submitVia === "email" && patched.gcBidNo === undefined && patched.submitVia === "website", "bids: applyBidderPatch doesn't mutate its input");
}

const BID_FIX = { gc1: fixtureId(348, "bgc1"), gc2: fixtureId(348, "bgc2"), own: fixtureId(348, "bown"), ct1: fixtureId(348, "bct1") };
async function dropBidIdentityFixtures() {
  const db = await getDb();
  await db.delete(contactsTable).where(like(contactsTable.id, "TEST348:b%"));
  await db.delete(companies).where(like(companies.id, "TEST348:b%"));
}

export async function bidDbChecks(ok: Ok) {
  const { gc1, gc2, own, ct1 } = BID_FIX;
  const q = fixtureId(348, "bq"), qWon = fixtureId(348, "bqwon"), lead = fixtureId(348, "blead");
  const regAll = async () => {
    for (const [t, id] of [["quote", q], ["quote", qWon], ["lead", lead]] as const) for (const p of await listFor(t, id)) registerFixture("record_parties", p.id);
    const proj = await getProjectByQuote(q).catch(() => null);
    if (proj) {
      registerFixture("projects", proj.id);
      registerFixture("tasks", autoTaskId(`item16:sold:${proj.id}`));
      for (const p of await listFor("project", proj.id)) registerFixture("record_parties", p.id);
    }
  };
  try {
    await dropBidIdentityFixtures();
    await saveCompany({ id: gc1, name: "Bid GC One", type: "customer", lifecycle: "active", deleted: false });
    await saveCompany({ id: gc2, name: "Bid GC Two", type: "customer", lifecycle: "active", deleted: false });
    await saveCompany({ id: own, name: "Bid Owner", type: "customer", lifecycle: "active", deleted: false });
    await saveContact({ id: ct1, firstName: "Gee", lastName: "Ceeone", homeCompanyId: gc1 });
    const NOW = Date.now();
    await createFixture("leads", { id: lead, org: "Bid lead", contact: "Pat", stage: "new", source: "web", customerId: own, value: 0, activities: [], createdAt: NOW, updatedAt: NOW, lastActivityAt: NOW } as never);
    await createFixture("quotes", buildQuote(q, { name: "Bid quote", customer: "Bid Owner", customerId: own, value: 1000, leadId: lead } as never, "system", null, NOW) as never);
    await createFixture("quotes", { ...buildQuote(qWon, { name: "Bid won", customer: "Bid Owner", customerId: own, value: 1000 }, "system", null, NOW), status: "won" } as never);

    // details
    const T = Date.UTC(2026, 9, 28, 19, 0), T0 = Date.UTC(2026, 9, 20, 15, 0);
    const d = await setBidDetails(q, { dueAt: T, addenda: [{ no: 1, receivedAt: T0, note: "a" }] });
    const q1 = await getQuote(q);
    ok(d.ok && q1?.bid?.dueAt === T && q1.bid.addenda.length === 1 && q1.bid.awardedPartyId === null, "bids db: bid details saved on the quote");
    const bad = await setBidDetails(q, { dueAt: -1, addenda: [] });
    ok(!bad.ok && (await getQuote(q))?.bid?.dueAt === T, "bids db: bad details refused and nothing written");
    ok(!(await setBidDetails(fixtureId(348, "bmissing"), { dueAt: null, addenda: [] })).ok, "bids db: details on a missing estimate refused");

    // bidders
    const a1 = await addBidder({ quoteId: q, companyId: gc1, contactId: ct1, role: "gc" }, "u");
    ok(a1.ok && a1.party.bid?.result === "pending" && a1.party.bid.submitVia === "email" && a1.party.contactId === ct1, "bids db: add a GC bidder (pending, email)");
    const a1b = await addBidder({ quoteId: q, companyId: gc1, role: "gc" }, "u");
    ok(a1.ok && a1b.ok && a1b.party.id === a1.party.id && (await listBidders(q)).length === 1, "bids db: adding the same bidder again keeps one row");
    const a2 = await addBidder({ quoteId: q, companyId: gc2, role: "gc", submitVia: "website" }, "u");
    ok(a2.ok && a2.party.bid?.submitVia === "website", "bids db: a bidder can submit via website");
    await regAll();
    const onQuote = await listFor("quote", q), onLead = await listFor("lead", lead);
    ok(onQuote.filter((p) => p.role === "owner").length === 1 && onQuote.find((p) => p.role === "owner")?.companyId === own, "bids db: the owner party was added to the estimate");
    ok(onLead.filter((p) => p.role === "gc").length === 2 && onLead.every((p) => p.bid === null), "bids db: the lead lists both GCs, without bid state");
    const arch = await addBidder({ quoteId: q, companyId: gc1, role: "architect" as never }, "u");
    ok(!arch.ok && arch.error === "Bidders are GCs or ECs.", "bids db: only GCs or ECs bid");
    const closed = await addBidder({ quoteId: qWon, companyId: gc1, role: "gc" }, "u");
    ok(!closed.ok && closed.error === "This estimate is closed.", "bids db: a won estimate takes no new bidders");

    if (!a1.ok || !a2.ok) throw new Error("bidders missing");
    const g1 = a1.party.id, g2 = a2.party.id;
    const up = await updateBidder(g2, { gcBidNo: "24-117", bidSiteUrl: "https://bc.test/x" });
    ok(up.ok && up.party.bid?.gcBidNo === "24-117" && up.party.bid.bidSiteUrl === "https://bc.test/x", "bids db: bidder details stored");
    ok(!(await updateBidder(g2, { result: "awarded" })).ok, "bids db: awarded can't be typed in");
    const ms = await markSubmitted(g2, "u", "CONF-1");
    ok(ms.ok && ms.party.bid?.revSent === 1 && ms.party.bid.confirmation === "CONF-1" && ms.party.bid.sentBy === "u", "bids db: mark submitted stamps rev, confirmation, sender");

    // award
    const before = await getQuote(q);
    const aw = await awardBid(q, g1);
    const after = await getQuote(q);
    const bidders = await listBidders(q);
    ok(aw.ok && after?.bid?.awardedPartyId === g1, "bids db: award stamps the quote");
    ok(bidders.find((b) => b.id === g1)?.bid.result === "awarded" && bidders.find((b) => b.id === g2)?.bid.result === "lost" && bidders.find((b) => b.id === g2)?.bid.lostByAward === true, "bids db: winner awarded, the rest lost by award");
    ok(after?.customerId === before?.customerId && after?.pricingTier === before?.pricingTier && after?.tierMargin === before?.tierMargin && after?.customer === before?.customer, "bids db: award never changes the customer or tier");
    const again = await awardBid(q, g1);
    ok(!again.ok && /already awarded/.test(again.error), "bids db: a second award is refused");
    const wd = await updateBidder(g1, { result: "withdrew" });
    ok(!wd.ok && wd.error === "Undo the award first.", "bids db: an awarded bidder can't be edited to withdrew");

    // undo
    const un = await undoAward(q);
    const afterUndo = await listBidders(q);
    ok(un.ok && afterUndo.every((b) => b.bid.result === "pending" && !("lostByAward" in b.bid)) && (await getQuote(q))?.bid?.awardedPartyId === null, "bids db: undo returns every bidder to pending");

    // won → project Bill to, undo refused
    ok((await awardBid(q, g1)).ok, "bids db: award again");
    await setStatus(q, "won", "Test", { bypassApprovalGate: "engine-owned-flow" });
    await regAll();
    const proj = await getProjectByQuote(q);
    ok(!!proj && proj.billToCompanyId === gc1 && proj.customerId === own, "bids db: the project bills the awarded GC; the customer stays the owner");
    const noUndo = await undoAward(q);
    ok(!noUndo.ok && noUndo.error === "The estimate is won — the award can't be undone.", "bids db: a won estimate's award can't be undone");
  } finally {
    try { await regAll(); } catch {}
    await dropFixtures(348);
    await dropBidIdentityFixtures();
  }
}

if (process.argv[1]?.endsWith("test-bids.ts")) {
  let pass = 0, fail = 0;
  bidChecks((c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } }).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}
