/* #348 slice 2a — bids harness checks. `bidChecks` is pure; `bidDbChecks` needs the test DB (Task 2 fills it).
   Run the pure half alone with `npx tsx scripts/test-bids.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import {
  BID_RESULTS, BID_RESULT_LABEL, EMPTY_BID, sanitizeBidDetails, sanitizeBidSiteUrl, sanitizeBidderPatch, newBidderState, applyBidderPatch,
  markSubmittedState, currentRev, needsRev, awardPlan, undoAwardPlan, canAward, canUndoAward, bidderStatusText, bidDueText, bidDueDays, isOpenBid,
} from "../src/lib/parties/bids";
import type { BidderState } from "../src/lib/parties/rules";
import { bidderSentState, bidderFailedState, nextBidderOpens, bidderOpensText } from "../src/lib/parties/bids";
import {
  isPartyId, latestSentRev, bidderPdfRev, bidderEmailNeed, bidderSendPlan, bidderAlreadyHas, addendaSinceRow, addendaAfterLatestSend,
  bidderSubject, bidWalkSummary, BID_SEND_COPY, type SendRow,
} from "../src/lib/parties/bid-send";
import { signShareTokenV3, verifyShareTokenV3, signShareTokenV2, verifyShareTokenV2, signShareToken, verifyShareToken, parseShareToken, isPackageToken, isShareTokenV2, SHARE_TOKEN_V3_RE } from "../src/lib/quote-share/token";
import { bidderCanAct, packageBanner, PACKAGE_COPY } from "../src/lib/quote-share/package-view";
import { responseNoteText, responseTaskTitle, responseRows, cleanClientResponses } from "../src/lib/estimate-output/responses";
import { fmt } from "../src/app/(app)/estimator/pricing";
import { bidderEmailDefaults, isBidderFileName, bidderFileOf } from "../src/lib/estimate-email/compose";
import { addressedHeader, bidDocLine, bidderPdfFileName, ownerNameFromLine, sendDefaultsContact, type DocAddressee } from "../src/lib/parties/addressee";
import { quoteAsOfRevision } from "../src/lib/quote-share/view";
import { coverDocumentPropsFor } from "../src/lib/estimate-output/cover";
import { packageViewModel } from "../src/lib/estimate-output/package-model";
import { loadQuoteDocumentProps } from "../src/lib/quote-pdf/document-loader";
import { quoteMatchesSearch } from "../src/lib/estimate-number";
import { selectBidDue } from "../src/lib/triage/feeds/quotes";
import { closedKeys } from "../src/lib/triage/liveness";
import type { SnapshotRow } from "../src/lib/triage/types";
import { factLabel, pointsFor } from "../src/lib/triage/rank";
import type { Quote } from "../src/lib/stores/quotes";
import { like } from "drizzle-orm";
import { getDb } from "../src/db";
import { companies, contactEmails, contacts as contactsTable } from "../src/db/schema";
import { saveCompany } from "../src/lib/identity/companies";
import { saveContact, setEmails } from "../src/lib/identity/contacts";
import { createFixture, dropFixtures, fixtureId, registerFixture } from "./test-fixtures";
import { addQuoteRevision, buildQuote, get as getQuote, revisionDocFields, setStatus, type QuoteRevision } from "../src/lib/stores/quotes";
import { getProjectByQuote } from "../src/lib/stores/projects";
import { autoTaskId } from "../src/lib/stores/tasks";
import { addParty, listFor, setPartyBid, setPartyContact } from "../src/lib/stores/parties";
import { awardedRecipient, bidderRecipient, documentAddressee, touchAwardedAddressee } from "../src/lib/parties/addressee-server";
import { renderBidderPdf } from "../src/lib/quote-pdf/bidder-pdf-server";
import { signPrintToken, verifyPrintToken } from "../src/lib/quote-pdf/token";
import { quoteDocumentDataFor } from "../src/lib/quote-pdf/quote-document-data";
import { addBidder, awardBid, listBidders, markBidderSendFailed, markSubmitted, recordBidderOpen, recordBidderSend, setBidDetails, undoAward, updateBidder } from "../src/lib/stores/bids";
import { recordEstimateEmail } from "../src/lib/stores/quotes";

const T1 = Date.UTC(2026, 9, 1);
const B = (over: Partial<BidderState> = {}): BidderState => ({ ...newBidderState("email"), ...over });

export async function bidChecks(ok: Ok) {
  // 2b-i: the print route's token binding — a bidder variant verifies `${id}~${bidder}`, and the check runs before any quote read.
  const printPage = readFileSync(join(process.cwd(), "src/app/print/quote/[id]/page.tsx"), "utf8");
  const tokenAt = printPage.indexOf("if (!tokenOk(t, \"quote\", bidder ? (rev ? `${id}~${bidder}~r${rev}` : `${id}~${bidder}`) : id)) notFound();"), readAt = printPage.indexOf("getQuote(");
  ok(tokenAt > 0 && readAt > 0 && tokenAt < readAt && printPage.includes("documentAddressee(src, bidder, { strict: true })"), "bids: the print route verifies the `${id}~${bidder}[~r${rev}]` token before getQuote( and loads a bidder strictly (on the revision's source)");
  ok(/rawBidder !== undefined && \(typeof rawBidder !== "string"[^\n]*\) notFound\(\);/.test(printPage), "bids: a present-but-malformed bidder param 404s instead of falling through");
  ok(BID_RESULTS.join() === "pending,awarded,lost,withdrew,no_bid", "bids: result keys");
  ok(BID_RESULT_LABEL.lost === "Lost the award" && BID_RESULT_LABEL.no_bid === "No bid", "bids: result labels");
  ok(EMPTY_BID.dueAt === null && EMPTY_BID.addenda.length === 0 && EMPTY_BID.awardedPartyId === null, "bids: empty bid");

  const d = sanitizeBidDetails({ dueAt: 1_800_000_000_000, addenda: [{ no: 2, receivedAt: Date.UTC(2026, 9, 5), note: " b " }, { no: 1, receivedAt: Date.UTC(2026, 9, 4), note: "a" }] });
  ok(d.ok && d.value.dueAt === 1_800_000_000_000 && d.value.addenda?.map((a) => a.no).join() === "1,2" && d.value.addenda?.[1]?.note === "b", "bids: details sanitized, addenda sorted + trimmed");
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
  ok(bidderStatusText(B({ submitVia: "website" }), 1) === "Not submitted", "bids: status — not submitted");
  ok(bidderStatusText(B({ submitVia: "website", revSent: 1, sentAt: OCT21_2PM }), 1) === "Submitted Rev 1 · Oct 21", "bids: status — submitted");
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
  ok(bidderStatusText(B({ submitVia: "website", revSent: 1, sentAt: 1e16 }), 1) === "Submitted Rev 1", "bids: status omits an out-of-range date");
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
  ok(noAdd.ok && noAdd.value.addenda === undefined && noAdd.value.dueAt === null, "bids: omitted addenda means keep (explicit null due clears)");
  const noDue = sanitizeBidDetails({ addenda: [] });
  ok(noDue.ok && !("dueAt" in noDue.value) && noDue.value.addenda?.length === 0, "bids: omitted due date means keep");
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
  // Task 5 — search by bidder name, and the Morning triage bid-due fact
  const bq = { id: "Q-1", name: "Gym", customer: "MPSD" };
  ok(quoteMatchesSearch({ ...bq, bidders: ["Miron Construction"] }, "miron"), "bids: a quote answers to a bidder's company name");
  ok(!quoteMatchesSearch(bq, "miron") && !quoteMatchesSearch({ ...bq, bidders: [] }, "miron"), "bids: without bidders the name doesn't match");
  const tctx = { me: { id: "u-t", name: "Dana Tester", canApprove: false }, now: NOW };
  const tq = (over: Record<string, unknown> = {}) =>
    ({ id: "Q-9", name: "Gym", customer: "MPSD", owner: "Dana Tester", status: "sent", updatedAt: 1, bid: { dueAt: OCT21_2PM, addenda: [], awardedPartyId: null }, ...over }) as unknown as Quote;
  const two = new Map([["Q-9", [{ bid: B() }, { bid: B() }]]]);
  const due = selectBidDue([tq()], two, tctx);
  const f = due[0]?.facts.find((x) => x.kind === "bid_due");
  ok(due.length === 1 && !!f && f.kind === "bid_due" && f.days === 1 && f.missing === 2, "bids: due tomorrow with 2 unsubmitted → bid_due {days:1, missing:2}");
  ok(f?.kind === "bid_due" && pointsFor(f) === 25 && factLabel(f) === "Bid due tomorrow · 2 bidders not submitted", "bids: bid_due tomorrow points + label");
  ok(factLabel({ kind: "bid_due", days: 0, missing: 1 }) === "Bid due today · 1 bidder not submitted" && pointsFor({ kind: "bid_due", days: 0, missing: 1 }) === 35, "bids: bid_due today points + label");
  ok(factLabel({ kind: "bid_due", days: -1, missing: 1 }) === "Bid past due" && pointsFor({ kind: "bid_due", days: -1, missing: 1 }) === 35, "bids: bid_due past due label");
  const past = selectBidDue([tq({ bid: { dueAt: NOW - 86_400_000, addenda: [], awardedPartyId: null } })], two, tctx);
  const pf = past[0]?.facts.find((x) => x.kind === "bid_due");
  ok(pf?.kind === "bid_due" && pf.days === -1, "bids: past due → days -1");
  ok(selectBidDue([tq({ bid: { dueAt: NOW - 20 * 86_400_000, addenda: [], awardedPartyId: null } })], two, tctx).length === 0, "bids: due 20 days ago with a pending unsubmitted bidder → no fact");
  ok(selectBidDue([tq({ bid: { dueAt: NOW + 3 * 86_400_000, addenda: [], awardedPartyId: null } })], two, tctx).length === 0, "bids: due in 3 days → no fact");
  ok(selectBidDue([tq({ bid: { dueAt: OCT21_2PM, addenda: [], awardedPartyId: "p" } })], two, tctx).length === 0, "bids: awarded → no fact");
  ok(selectBidDue([tq({ owner: "Someone Else" })], two, tctx).length === 0, "bids: not mine → no fact");
  ok(selectBidDue([tq()], new Map([["Q-9", [{ bid: B({ revSent: 1 }) }]]]), tctx).length === 0, "bids: every bidder submitted → no fact");
  ok(selectBidDue([tq({ revisions: [{}, {}] })], new Map([["Q-9", [{ bid: B({ revSent: 1 }) }]]]), tctx).length === 1, "bids: a bidder on an older revision still counts as missing");

  // Final review fix 1 — a frozen bid-due row stays visible while the rule still fires.
  const srow = (key: string): SnapshotRow => ({ key, source: "quote", title: key, sub: "", href: "/", score: 1, reason: "", callLine: null, also: [] });
  const awardedQ = tq({ id: "Q-10", bid: { dueAt: OCT21_2PM, addenda: [], awardedPartyId: "p" } });
  const doneQ = tq({ id: "Q-11" });
  const liveClosed = closedKeys(
    [srow("quote:Q-9"), srow("quote:Q-10"), srow("quote:Q-11")],
    {
      tasks: new Map(), assignments: new Map(), threads: new Map(), recordings: new Map(),
      quotes: new Map([["Q-9", tq()], ["Q-10", awardedQ], ["Q-11", doneQ]]),
      bidders: new Map([["Q-9", [{ bid: B() }]], ["Q-10", [{ bid: B({ result: "awarded" }) }]], ["Q-11", [{ bid: B({ revSent: 1 }) }]]]),
    },
    tctx.me, NOW, { id: tctx.me.id, name: tctx.me.name, nameUnique: true }
  );
  ok(!liveClosed.has("quote:Q-9"), "bids: a bid_due-only row survives closedKeys while the bid is still due");
  ok(liveClosed.has("quote:Q-10") && liveClosed.has("quote:Q-11"), "bids: an awarded (or fully submitted) bid's row is hidden");

  // addressee helpers (slice 2b-i task 1)
  const dueMs = Date.UTC(2026, 9, 21, 19, 0); // Oct 21 2:00 PM CDT
  const ad = (no: number) => ({ no, receivedAt: T1, note: "" });
  ok(bidDocLine({ dueAt: dueMs, addenda: [ad(2), ad(1)], awardedPartyId: null }) === "Bid due Oct 21, 2:00 PM · Addenda acknowledged: 1, 2", "addressee: bid line with due + addenda ascending");
  ok(bidDocLine({ dueAt: null, addenda: [ad(1)], awardedPartyId: null }) === "Addenda acknowledged: 1", "addressee: addenda only");
  ok(bidDocLine({ dueAt: dueMs, addenda: [], awardedPartyId: null }) === "Bid due Oct 21, 2:00 PM", "addressee: due only");
  ok(bidDocLine({ dueAt: null, addenda: [], awardedPartyId: null }) === "" && bidDocLine(null) === "" && bidDocLine(undefined) === "", "addressee: empty bid line");
  ok(bidderPdfFileName("Lincoln HS: Rigging/Curtains", "ABC  Construction", 2) === "Peak \u2013 Lincoln HS RiggingCurtains \u2013 ABC Construction \u2013 Rev 2.pdf", "addressee: file name sanitized");
  const longName = bidderPdfFileName("P", "x".repeat(100), 1);
  ok(longName === `Peak \u2013 P \u2013 ${"x".repeat(60)} \u2013 Rev 1.pdf`, "addressee: bidder name cut to 60");
  ok(bidderPdfFileName("", "ABC", 3) === "Peak \u2013 ABC \u2013 Rev 3.pdf" && bidderPdfFileName("P", " ", 3) === "Peak \u2013 P \u2013 Rev 3.pdf", "addressee: empty parts omitted");
  const base = { custName: "Owner Co", hasAttn: true, attnLine: "Pat" };
  const h0 = addressedHeader(base, null);
  ok(h0.custName === "Owner Co" && h0.hasAttn && h0.attnLine === "Pat" && h0.ownerLine === "" && h0.bidLine === "", "addressee: null addressee keeps the base header");
  const a: DocAddressee = { companyName: "ABC GC", contactName: "Sam Lee", contactRole: "Estimator", ownerName: "Owner Co", bidLine: "Bid due Oct 21, 2:00 PM" };
  const h1 = addressedHeader(base, a);
  ok(h1.custName === "ABC GC" && h1.hasAttn && h1.attnLine === "Sam Lee \u00b7 Estimator" && h1.ownerLine === "Owner: Owner Co" && h1.bidLine === "Bid due Oct 21, 2:00 PM", "addressee: header switches to the bidder");
  const h2 = addressedHeader(base, { ...a, contactName: "", contactRole: "", ownerName: "", bidLine: "" });
  ok(!h2.hasAttn && h2.attnLine === "" && h2.ownerLine === "" && h2.bidLine === "", "addressee: blank contact has no attn");
  ok(addressedHeader(base, { ...a, contactRole: "" }).attnLine === "Sam Lee", "addressee: attn without a role");

  // 2b-i final review: owner name, Send defaults, frozen award + bid on revisions
  ok(ownerNameFromLine("Owner: Acme ISD") === "Acme ISD" && ownerNameFromLine("") === "" && ownerNameFromLine(undefined) === "" && ownerNameFromLine("Acme") === "", "addressee: the owner name reads back from the owner line");
  const ownerC = { name: "Pat Owner", email: "pat@owner.test" };
  ok(JSON.stringify(sendDefaultsContact(null, ownerC)) === JSON.stringify({ contactName: "Pat Owner", contactEmail: "pat@owner.test" }), "send defaults: nothing awarded → the owner's contact");
  ok(JSON.stringify(sendDefaultsContact({ name: "Gee Ceeone", firstName: "Gee", email: " gee@gc.test " }, ownerC)) === JSON.stringify({ contactName: "Gee", contactEmail: "gee@gc.test" }), "send defaults: awarded → To is the bidder's contact, the greeting its first name");
  ok(sendDefaultsContact({ name: "Gee Ceeone", firstName: "Gee", email: "" }, ownerC).contactEmail === "pat@owner.test" && sendDefaultsContact({ name: "Gee Ceeone", firstName: "Gee", email: "" }, ownerC).contactName === "Pat Owner", "send defaults: an awarded contact with no email falls back to the owner's");
  ok(sendDefaultsContact({ name: "Gee Ceeone", firstName: "", email: "g@gc.test" }, ownerC).contactName === "Gee Ceeone", "send defaults: no first name → the display name");
  const rq = { id: "Q-1", customer: "", status: "sent", bid: { dueAt: dueMs, addenda: [ad(1)], awardedPartyId: "pty_x" } } as unknown as Quote;
  const rdf = revisionDocFields(rq);
  ok(rdf.awardedPartyId === "pty_x" && rdf.bid?.dueAt === dueMs && rdf.bid.addenda.length === 1 && rdf.bid.addenda !== rq.bid?.addenda, "revisions: docFields freeze the awarded party and a copy of the bid");
  const rdf0 = revisionDocFields({ id: "Q-2", customer: "", status: "draft" } as unknown as Quote);
  ok(rdf0.awardedPartyId === null && !("bid" in rdf0), "revisions: no bid → awardedPartyId null, no bid frozen");
  const liveQ = { ...rq, bid: { dueAt: dueMs + 86_400_000, addenda: [], awardedPartyId: null }, revisions: [] } as unknown as Quote;
  const asOf = quoteAsOfRevision(liveQ, { rev: 1, at: 1, by: "t", reason: "sent", note: "", name: "x", value: 0, docFields: rdf } as unknown as QuoteRevision);
  ok(asOf.bid?.dueAt === dueMs && bidDocLine(asOf.bid) === "Bid due Oct 21, 2:00 PM · Addenda acknowledged: 1" && !("awardedPartyId" in asOf), "revisions: the as-sent quote prints the frozen bid line; the frozen award never spreads onto the quote");
  const asOfLegacy = quoteAsOfRevision(liveQ, { rev: 1, at: 1, by: "t", reason: "sent", note: "", name: "x", value: 0, docFields: { customer: "" } } as unknown as QuoteRevision);
  ok(asOfLegacy.bid?.dueAt === dueMs + 86_400_000, "revisions: an older revision without a frozen bid keeps the live one");
}

const BID_FIX = { gc1: fixtureId(348, "bgc1"), gc2: fixtureId(348, "bgc2"), own: fixtureId(348, "bown"), ct1: fixtureId(348, "bct1") };
const F_FIX = { ct2: fixtureId(348, "fct2"), ct3: fixtureId(348, "fct3") };
async function dropBidIdentityFixtures() {
  const db = await getDb();
  for (const pre of ["TEST348:b%", "TEST348:f%"]) {
    await db.delete(contactEmails).where(like(contactEmails.contactId, pre));
    await db.delete(contactsTable).where(like(contactsTable.id, pre));
  }
  await db.delete(companies).where(like(companies.id, "TEST348:b%"));
}

export async function bidSendChecks(ok: Ok) {
  const R = (rev: number, reason: string) => ({ rev, reason, at: 1, by: "u" });
  const OCT21_2PM = Date.UTC(2026, 9, 21, 19, 0);
  ok(currentRev({ revisions: [R(1, "sent"), R(2, "manual")] }) === 1, "bid-send: currentRev = latest sent rev (1)");
  ok(currentRev({ revisions: [R(1, "manual"), R(2, "sent"), R(3, "manual")] }) === 2, "bid-send: currentRev = latest sent rev (2)");
  ok(currentRev({ revisions: [R(1, "manual"), R(2, "manual")] }) === 2, "bid-send: currentRev before any send = revisions.length");
  ok(currentRev({ revisions: [1, 2, 3] }) === 3, "bid-send: currentRev non-object revisions fall back to length");
  ok(bidderPdfRev({ status: "draft", revisions: [R(1, "sent")] }) === null, "bid-send: draft renders live");
  ok(bidderPdfRev({ status: "sent", revisions: [R(1, "sent"), R(2, "manual")] }) === 1, "bid-send: sent pdf rev = latest sent");
  ok(bidderPdfRev({ status: "won", revisions: [R(1, "sent"), R(3, "sent")] }) === 3, "bid-send: won pdf rev = latest sent");
  ok(bidderPdfRev({ status: "sent", revisions: [] }) === null, "bid-send: sent with no revisions → null");
  const row = (id: string, over: Partial<BidderState> = {}, email = "a@x.test"): SendRow => ({ id, bid: B(over), email });
  const dq = { status: "draft", revisions: [] as unknown[] };
  ok(bidderEmailNeed(dq, row("a")) === "send", "bid-send: draft never sent → send");
  ok(bidderEmailNeed(dq, row("a", { revSent: 1 })) === "revision", "bid-send: draft revSent 1 → revision");
  ok(bidderEmailNeed(dq, row("a", { failed: { at: 1, error: "x" } })) === "retry", "bid-send: failed → retry");
  ok(bidderEmailNeed(dq, row("a", { submitVia: "website" })) === null, "bid-send: website → null");
  ok(bidderEmailNeed(dq, row("a", {}, "  ")) === null, "bid-send: blank email → null");
  ok(bidderEmailNeed(dq, row("a", { result: "withdrew" })) === null, "bid-send: withdrew → null");
  ok(bidderEmailNeed({ status: "won", revisions: [] }, row("a")) === null, "bid-send: won → null");
  const sq = { status: "sent", revisions: [R(1, "sent"), R(2, "sent")] };
  ok(bidderEmailNeed(sq, row("a", { revSent: 2 })) === null, "bid-send: sent, up to date → null");
  ok(bidderEmailNeed(sq, row("a", { revSent: 1 })) === "revision", "bid-send: sent, behind → revision");
  const rows = [row("a"), row("b", { revSent: 1 }), row("c", { submitVia: "website" }), row("d", {}, ""), row("e", { failed: { at: 1, error: "t", unknown: true } })];
  const plan = bidderSendPlan(sq, rows);
  ok(plan.ids.join() === "a,b" && plan.label === "Send revision to bidders" && plan.noEmail === 1, "bid-send: plan ids/label/noEmail");
  ok(bidderSendPlan(dq, [row("a")]).label === "Send to all bidders", "bid-send: plan label on a first send");
  const done = bidderSendPlan(sq, [row("a", { revSent: 2 })]);
  ok(done.ids.length === 0 && done.label === null, "bid-send: nothing to send → null label");
  ok(bidderAlreadyHas(sq, B({ revSent: 2 })) === true && bidderAlreadyHas({ status: "draft", revisions: sq.revisions }, B({ revSent: 2 })) === false, "bid-send: already has");
  const fr = (rev: number, addenda: number[] | null) => ({ rev, reason: "sent", at: 1, by: "u", ...(addenda ? { docFields: { bid: { dueAt: null, awardedPartyId: null, addenda: addenda.map((no) => ({ no, receivedAt: 1, note: "" })) } } } : {}) });
  const live = (nos: number[]) => ({ dueAt: null, awardedPartyId: null, addenda: nos.map((no) => ({ no, receivedAt: 1, note: "" })) });
  ok(addendaSinceRow({ bid: live([1, 2]), revisions: [fr(1, [1])] }, B({ revSent: 1 })).join() === "2", "bid-send: addenda since row");
  ok(addendaSinceRow({ bid: live([1, 2]), revisions: [fr(1, [1])] }, B({ revSent: null })).length === 0, "bid-send: never sent → no addenda since");
  const nb = { bid: { dueAt: null, awardedPartyId: null, addenda: [{ no: 3, receivedAt: 50, note: "" }] }, revisions: [fr(1, null)] };
  ok(addendaSinceRow(nb, B({ revSent: 1, sentAt: 40 })).join() === "3" && addendaSinceRow(nb, B({ revSent: 1, sentAt: 60 })).length === 0, "bid-send: fallback by receivedAt vs sentAt");
  const dirty = { bid: { dueAt: null, awardedPartyId: null, addenda: [null, { no: 4, receivedAt: "x" }, { no: 3, receivedAt: 50, note: "" }] }, revisions: [fr(1, null)] };
  let dthrew = false, dres = "";
  try { dres = addendaSinceRow(dirty as never, B({ revSent: 1, sentAt: 40 })).join(); } catch { dthrew = true; }
  ok(!dthrew && dres === "3", "bid-send: fallback skips malformed addenda entries");
  ok(addendaAfterLatestSend({ bid: live([1, 2]), revisions: [fr(1, [1])] }).join() === "2", "bid-send: addenda after latest send");
  ok(addendaAfterLatestSend({ bid: live([1, 2]), revisions: [] }).length === 0 && addendaAfterLatestSend({ bid: live([1, 2]), revisions: [fr(1, null)] }).length === 0, "bid-send: no sent revision / no frozen bid → none");
  const base = "Bid — Gym (EST-1042)";
  ok(bidderSubject(base, "Gym", []) === base, "bid-send: subject unchanged");
  ok(bidderSubject(base, "Gym", [2]) === "Revised bid — Gym (Addendum 2)", "bid-send: subject one addendum");
  ok(bidderSubject(base, "Gym", [2, 3]) === "Revised bid — Gym (Addenda 2, 3)", "bid-send: subject several addenda");
  ok(bidderSubject(base, "x".repeat(400), [2]).length <= 300, "bid-send: subject ≤ 300");
  const d = bidderEmailDefaults({ projectName: "Gym", estimateNumber: "EST-1042", senderName: "Sam Mills" });
  ok(d.subject === "Bid — Gym (EST-1042)", "bid-send: bidder subject default");
  ok(d.body === "Hello,\n\nAttached is our bid for Gym (EST-1042).\n\nYou can also view the full package online here: {link}\n\nLet me know if you have any questions.\n\nThanks,\nSam Mills", "bid-send: bidder body default");
  ok(bidderEmailDefaults({ projectName: "", estimateNumber: "EST-1042", senderName: "Sam Mills" }).subject === "Bid — EST-1042", "bid-send: blank project subject");
  const ss = bidderSentState(B({ failed: { at: 1, error: "x" } }), 4, "u1", "C-1", 99);
  ok(ss.revSent === 4 && ss.sentAt === 99 && ss.sentBy === "u1" && ss.threadId === "C-1" && ss.failed === null, "bid-send: sent state");
  const fs = bidderFailedState(B({ revSent: 2 }), { at: 5, error: "e", unknown: true }, "C-2");
  ok(fs.revSent === 2 && fs.failed?.unknown === true && fs.threadId === "C-2", "bid-send: failed state keeps revSent");
  ok(bidderFailedState(B(), { at: 5, error: "x".repeat(400) }).failed!.error.length === 300 && !("unknown" in bidderFailedState(B(), { at: 5, error: "e" }).failed!), "bid-send: failed error capped, no unknown key");
  const o1 = nextBidderOpens(null, 10), o2 = nextBidderOpens({ count: 2, lastAt: 20 }, 15);
  ok(o1?.count === 1 && o1.lastAt === 10 && o2?.count === 3 && o2.lastAt === 20 && nextBidderOpens(null, NaN) === null, "bid-send: opens counter");
  ok(bidderOpensText({ count: 3, lastAt: OCT21_2PM }) === "Opened 3×" && bidderOpensText(null) === "", "bid-send: opens text");
  ok(bidderStatusText(B(), 1) === "Not sent" && bidderStatusText(B({ submitVia: "website" }), 1) === "Not submitted", "bid-send: not sent / not submitted");
  ok(bidderStatusText(B({ revSent: 1, sentAt: OCT21_2PM }), 1) === "Sent Rev 1 · Oct 21" && bidderStatusText(B({ submitVia: "website", revSent: 1, sentAt: OCT21_2PM }), 1) === "Submitted Rev 1 · Oct 21", "bid-send: sent / submitted text");
  ok(bidderStatusText(B({ revSent: 1, failed: { at: 1, error: "x" } }), 2) === "Send failed", "bid-send: send failed");
  ok(bidWalkSummary({ total: 3, sent: 3, failed: 0, local: 0 }) === "Sent to 3 bidders." && bidWalkSummary({ total: 1, sent: 1, failed: 0, local: 0 }) === "Sent to 1 bidder.", "bid-send: walk summary all sent");
  ok(bidWalkSummary({ total: 4, sent: 3, failed: 1, local: 0 }) === "Sent to 3 of 4 bidders — 1 failed. Retry it below.", "bid-send: walk summary one failed");
  ok(bidWalkSummary({ total: 4, sent: 2, failed: 2, local: 2 }) === "Sent to 2 of 4 bidders — 2 failed. Retry them below. Saved locally — Gmail isn’t connected.", "bid-send: walk summary local");
  ok(bidWalkSummary({ total: 4, sent: 1, failed: 0, local: 0, stoppedError: "Needs approval." }) === "Stopped after 1 of 4: Needs approval.", "bid-send: walk summary stopped");
  const f1 = "bidder-0123456789abcdef-r2-1760000000000.pdf";
  ok(isBidderFileName(f1) && isBidderFileName("bidder-0123456789abcdef-r2-1760000000000-AbC123.pdf"), "bid-send: bidder file names");
  ok(!isBidderFileName("bidder-0123-r2-1760000000000.pdf") && !isBidderFileName("../" + f1) && !isBidderFileName("cover-1760000000000.pdf"), "bid-send: bad bidder file names");
  const bf = bidderFileOf(f1);
  ok(bf?.partyId === "pty_0123456789abcdef" && bf.rev === 2 && bidderFileOf("x") === null, "bid-send: bidderFileOf");
  ok(isPartyId("pty_0123456789abcdef") && !isPartyId("pty_xyz") && !isPartyId(5), "bid-send: isPartyId");
  ok(latestSentRev({ revisions: [R(1, "sent"), R(2, "manual")] }) === 1 && latestSentRev({ revisions: [] }) === null, "bid-send: latestSentRev");
  ok(BID_SEND_COPY.progress(2, 5) === "Sending 2 of 5…" && BID_SEND_COPY.sendN(1) === "Send to 1 bidder" && BID_SEND_COPY.recipients(["A", "B"]) === "To: A, B (2 bidders)", "bid-send: copy functions");

  // 2b-ii Task 2 — v3 bidder token, bidder-aware package + responses
  {
    const S = "s3cret", P = "pty_0123456789abcdef", Qp = "pty_fedcba9876543210";
    const L3 = { nonce: "N".repeat(43), expiresAt: 2_000_000_000_000 }, NOW = 1_999_000_000_000;
    const t = signShareTokenV3(S, "Q-1", 2, P, L3.nonce, L3.expiresAt);
    const v2t = signShareTokenV2(S, "Q-1", 2, L3.nonce, L3.expiresAt);
    const v1t = signShareToken(S, "Q-1", L3.nonce, L3.expiresAt);
    ok(SHARE_TOKEN_V3_RE.test(t), "v3 token: shape");
    const got = verifyShareTokenV3(S, t, "Q-1", L3, NOW);
    ok(got?.rev === 2 && got.partyId === P, "v3 token: verifies to rev + party");
    ok(verifyShareTokenV3(S, t, "Q-2", L3, NOW) === null, "v3 token: another quote → null");
    ok(verifyShareTokenV3(S, t, "Q-1", { ...L3, nonce: "M".repeat(43) }, NOW) === null, "v3 token: rotated nonce → null");
    ok(verifyShareTokenV3(S, t, "Q-1", L3, L3.expiresAt + 1) === null, "v3 token: expired → null");
    ok(verifyShareTokenV3(S, t, "Q-1", L3, NaN) === null, "v3 token: NaN clock → null");
    ok(verifyShareTokenV3(S, t, "Q-1", { ...L3, expiresAt: L3.expiresAt + 1 }, NOW) === null, "v3 token: stored expiry mismatch → null");
    ok(verifyShareTokenV3(S, t, "Q-1", null, NOW) === null, "v3 token: no stored link → null");
    const parts = t.split(".");
    ok(verifyShareTokenV3(S, [parts[0], parts[1], Qp.slice(4), parts[3]].join("."), "Q-1", L3, NOW) === null, "v3 token: swapped party hex → null");
    ok(verifyShareTokenV3(S, [parts[0], "3", parts[2], parts[3]].join("."), "Q-1", L3, NOW) === null, "v3 token: changed rev → null");
    ok(verifyShareTokenV2(S, t, "Q-1", L3, NOW) === null && verifyShareToken(S, t, "Q-1", L3, NOW) === false, "v3 token: not a valid v1 or v2");
    ok(verifyShareTokenV3(S, v2t, "Q-1", L3, NOW) === null && verifyShareTokenV3(S, v1t, "Q-1", L3, NOW) === null, "v3 verify: v1/v2 tokens → null");
    const pt = parseShareToken(t);
    ok(pt?.v === 3 && pt.exp === L3.expiresAt && pt.rev === 2 && pt.partyId === P, "v3 token: parse");
    ok(isPackageToken(t) && isPackageToken(v2t) && !isPackageToken(v1t) && !isShareTokenV2(t), "v3 token: isPackageToken / isShareTokenV2");
    let threw = false;
    try { signShareTokenV3(S, "Q-1", 2, "pty_XYZ", L3.nonce, L3.expiresAt); } catch { threw = true; }
    ok(threw, "v3 token: a bad party id throws to sign");
    ok(bidderCanAct(null) && bidderCanAct(undefined) && bidderCanAct("pending") && bidderCanAct("awarded"), "bidderCanAct: owner / pending / awarded");
    ok(!bidderCanAct("lost") && !bidderCanAct("withdrew") && !bidderCanAct("no_bid"), "bidderCanAct: lost / withdrew / no_bid");
    const sup = { kind: "superseded", rev: { rev: 1 }, latestRev: 2, sentAt: 1 } as never;
    ok(packageBanner(sup, "/x", true)?.text === "This bid is closed." && PACKAGE_COPY.bidClosed === "This bid is closed.", "packageBanner: bidClosed wins");
    ok(packageBanner({ kind: "ok", rev: { rev: 1 }, closed: false, won: false } as never, null, false) === null, "packageBanner: open → null");
    const r = { kind: "accept" as const, sectionNames: ["Rigging", "Curtains"], total: 12500, name: "Pat", email: "pat@x.test", message: "", sectionIds: [] as string[] };
    ok(responseNoteText(r, "EST-1042", 2, "Miron Construction").startsWith(`Miron Construction (bidder) selected scopes on EST-1042 Rev 2 (bid link): Rigging, Curtains — ${fmt(12500)} before any Rewards credit.`), "responses: bidder accept note");
    ok(responseNoteText({ ...r, kind: "question", message: "Hi" }, "EST-1042", 2, "Miron Construction").startsWith("Question from Miron Construction (bidder) on EST-1042 Rev 2 (bid link)."), "responses: bidder question note");
    ok(responseTaskTitle(r, "EST-1042", 2, "Miron Construction") === `Miron Construction accepted EST-1042 Rev 2 — Rigging, Curtains (${fmt(12500)})`, "responses: bidder accept task title");
    ok(responseTaskTitle({ ...r, kind: "question" }, "EST-1042", 2, "Miron Construction") === "Bidder question — EST-1042 · Miron Construction", "responses: bidder question task title");
    ok(responseNoteText(r, "EST-1042", 2, "") === responseNoteText(r, "EST-1042", 2) && responseNoteText(r, "EST-1042", 2).startsWith("Client selected scopes"), "responses: blank bidder keeps the client wording");
    ok(responseTaskTitle(r, "EST-1042", 2, "") === `Client accepted EST-1042 Rev 2 — Rigging, Curtains (${fmt(12500)})` && responseTaskTitle({ ...r, kind: "question" }, "EST-1042", 2, "") === "Client question — EST-1042", "responses: blank bidder keeps the client task titles");
    const rv = { id: "CR-0123456789ab", kind: "accept", rev: 1, at: 5, name: "Pat", email: "pat@x.test", message: "", sectionIds: [], sectionNames: [], total: 1 };
    ok(cleanClientResponses([{ ...rv, partyId: P }])[0].partyId === P, "responses: partyId kept");
    ok(cleanClientResponses([{ ...rv, partyId: "x" }])[0].partyId === undefined && cleanClientResponses([rv])[0].partyId === undefined, "responses: bad partyId dropped");
    ok(responseRows([{ ...rv, partyId: P }], (n) => n, (id) => (id === P ? "Miron" : ""))[0].who.startsWith("Miron (bidder) · Pat"), "responseRows: bidder prefix");
    ok(responseRows([{ ...rv, partyId: P }], (n) => n, () => "")[0].who === "Pat · pat@x.test" && responseRows([{ ...rv, partyId: P }], (n) => n)[0].who === "Pat · pat@x.test", "responseRows: no name → no prefix");
    const nullAdd = { bid: { dueAt: null, awardedPartyId: null, addenda: [{ no: 1, receivedAt: 1, note: "" }, { no: 2, receivedAt: 1, note: "" }] }, revisions: [{ rev: 1, reason: "sent", at: 1, by: "u", docFields: { bid: { dueAt: null, awardedPartyId: null, addenda: [null, { no: 1, receivedAt: 1, note: "" }] } } }] };
    let nthrew = false, nres = "";
    try { nres = addendaAfterLatestSend(nullAdd as never).join(); } catch { nthrew = true; }
    ok(!nthrew && nres === "2", "bid-send: a frozen addenda list with null doesn't throw");
  }
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
    const q0 = await getQuote(q);
    const d = await setBidDetails(q, { dueAt: T, addenda: [{ no: 1, receivedAt: T0, note: "a" }] });
    const q1 = await getQuote(q);
    ok(d.ok && q1?.bid?.dueAt === T && q1.bid.addenda.length === 1 && q1.bid.awardedPartyId === null, "bids db: bid details saved on the quote");
    const bad = await setBidDetails(q, { dueAt: -1, addenda: [] });
    ok(!bad.ok && (await getQuote(q))?.bid?.dueAt === T, "bids db: bad details refused and nothing written");
    ok(!(await setBidDetails(fixtureId(348, "bmissing"), { dueAt: null, addenda: [] })).ok, "bids db: details on a missing estimate refused");
    const keepAdd = await setBidDetails(q, { dueAt: T + 3600_000 });
    const q2 = await getQuote(q);
    ok(keepAdd.ok && q2?.bid?.dueAt === T + 3600_000 && q2.bid.addenda.length === 1, "bids db: a missing addenda key keeps the stored addenda");
    ok(q2?.updatedAt === q1?.updatedAt && q2?.updatedAt === q0?.updatedAt, "bids db: a bid edit doesn't bump updatedAt (no version bump)");
    ok(q0?.contentChangedAt == null && q1?.contentChangedAt === q0?.contentChangedAt && q2?.contentChangedAt === q0?.contentChangedAt, "bids db: a pre-award bid edit leaves contentChangedAt unchanged (nothing prints, no stale PDF)");
    await setBidDetails(q, { addenda: q2?.bid?.addenda ?? [] });
    ok((await getQuote(q))?.bid?.dueAt === T + 3600_000, "bids db: a missing dueAt key keeps the stored due date");
    await setBidDetails(q, { dueAt: T });
    const wonDetails = await setBidDetails(qWon, { dueAt: T });
    ok(!wonDetails.ok && wonDetails.error === "This estimate is closed." && !(await getQuote(qWon))?.bid, "bids db: a won estimate's bid details can't be edited");

    // bidders
    const a1 = await addBidder({ quoteId: q, companyId: gc1, contactId: ct1, role: "gc" }, "u");
    ok(a1.ok && a1.party.bid?.result === "pending" && a1.party.bid.submitVia === "email" && a1.party.contactId === ct1, "bids db: add a GC bidder (pending, email)");
    const a1b = await addBidder({ quoteId: q, companyId: gc1, role: "gc" }, "u");
    ok(a1.ok && a1b.ok && a1b.party.id === a1.party.id && (await listBidders(q)).length === 1, "bids db: adding the same bidder again keeps one row");
    ok(a1.ok && !a1.existed && a1b.ok && a1b.existed, "bids db: a second add reports the bidder already existed");
    const selfBid = await addBidder({ quoteId: q, companyId: own, role: "gc" }, "u");
    ok(!selfBid.ok && selfBid.error === "The customer can't bid on its own estimate.", "bids db: the customer can't bid on its own estimate");
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

    // closed (won) estimate: a bidder there can't be awarded or edited
    const wp = await addParty({ recordType: "quote", recordId: qWon, companyId: gc1, role: "gc" }, "u");
    if (!wp.ok) throw new Error("won-quote bidder missing");
    const wpId = wp.party.id;
    await setPartyBid(wp.party.id, newBidderState("email"));
    await regAll();
    const awWon = await awardBid(qWon, wp.party.id);
    ok(!awWon.ok && awWon.error === "Only an open estimate can be awarded.", "bids db: a won estimate can't be awarded");
    const upWon = await updateBidder(wp.party.id, { gcBidNo: "1" });
    ok(!upWon.ok && upWon.error === "This estimate is closed.", "bids db: a won estimate's bidder can't be edited");
    const msWon = await markSubmitted(wp.party.id, "u", "");
    ok(!msWon.ok && msWon.error === "This estimate is closed.", "bids db: a won estimate's bidder can't be marked submitted");

    // addressee (2b-i)
    const qa = await getQuote(q);
    if (!qa) throw new Error("quote missing");
    const settings = { companyName: "Peak", logoDark: null };
    ok((await documentAddressee(qa)) === null, "addressee db: no bidder awarded and none named → null (today's document)");
    const ad1 = await documentAddressee(qa, g1);
    ok(!!ad1 && ad1.companyName === "Bid GC One" && ad1.contactName === "Gee Ceeone" && ad1.ownerName === "Bid Owner" && ad1.bidLine === bidDocLine(qa.bid) && ad1.bidLine.startsWith("Bid due "), "addressee db: an explicit bidder → company, contact, owner and bid line");
    const ad2 = await documentAddressee(qa, g2);
    ok(!!ad2 && ad2.companyName === "Bid GC Two" && ad2.contactName === "", "addressee db: a bidder with no contact and none at the company → no contact");
    await saveContact({ id: F_FIX.ct2, firstName: "Aaron", lastName: "Alpha", homeCompanyId: gc2 });
    ok((await documentAddressee(qa, g2))?.contactName === "", "addressee db: a bidder company's non-primary contact is never the Attn fallback (not the alphabetically first)");
    await saveContact({ id: F_FIX.ct3, firstName: "Zed", lastName: "Primary", homeCompanyId: gc2, isPrimary: true });
    ok((await documentAddressee(qa, g2))?.contactName === "Zed Primary", "addressee db: with no party contact the bidder company's primary contact is the Attn");
    const adOther = await documentAddressee(qa, wpId);
    const ownerRow = (await listFor("quote", q)).find((p) => p.role === "owner");
    ok(!!ownerRow && (await documentAddressee(qa, "pty_nope")) === null && (await documentAddressee(qa, ownerRow.id)) === null && adOther === null, "addressee db: a non-bidder, the owner row, another quote's party or an unknown id → null");
    ok((await documentAddressee(qa, g1, { strict: true }))?.companyName === "Bid GC One" && (await documentAddressee(qa, null, { strict: true })) === null && (await documentAddressee(qa, "pty_nope", { strict: true })) === null && (await documentAddressee(qa, wpId, { strict: true })) === null && (await documentAddressee(qa, ownerRow?.id, { strict: true })) === null, "addressee db: strict returns the explicit bidder only — an unknown id, none, another quote's party or the owner row → null");
    const dN = quoteDocumentDataFor(qa as never, null, settings), dNull = quoteDocumentDataFor(qa as never, null, settings, null), dA = quoteDocumentDataFor(qa as never, null, settings, ad1);
    ok(JSON.stringify(dN) === JSON.stringify(dNull) && dN.ownerLine === "" && dN.bidLine === "", "addressee db: a null addressee is byte-identical to the 3-arg call");
    ok(dA.custName === "Bid GC One" && dA.ownerLine === "Owner: Bid Owner" && dA.venueLabel === dN.venueLabel && dA.hasAttn && dA.attnLine === "Gee Ceeone" && dA.bidLine === ad1?.bidLine, "addressee db: the document is addressed to the bidder; the venue still resolves from the owner");

    // per-bidder PDF (2b-i task 3): every 404 path returns before any render / secret check
    const rb = async (qid: string, pid: string) => renderBidderPdf(qid, pid, "localhost:3000", "http");
    const rNoParty = await rb(q, "pty_0000000000000000"), rOther = await rb(q, wpId), rOwner = ownerRow ? await rb(q, ownerRow.id) : null, rNoQuote = await rb(fixtureId(348, "bmissing"), g1), rTooLong = await rb(q, "x".repeat(65));
    ok([rNoParty, rOther, rOwner, rNoQuote, rTooLong].every((r) => !!r && !r.ok && r.status === 404 && r.error === "Not found"), "bidder pdf db: unknown party, another quote's bidder, the owner row, an unknown quote and an over-long id all 404 before any render");
    const tPlain = signPrintToken("s3cret", "quote", q, 1_000_000), tBidder = signPrintToken("s3cret", "quote", `${q}~${g1}`, 1_000_000);
    ok(!verifyPrintToken("s3cret", tPlain, "quote", `${q}~${g1}`, 1_000_000) && !verifyPrintToken("s3cret", tBidder, "quote", q, 1_000_000) && verifyPrintToken("s3cret", tBidder, "quote", `${q}~${g1}`, 1_000_000) && !verifyPrintToken("s3cret", tBidder, "quote", `${q}~${g2}`, 1_000_000), "bidder pdf db: a plain-id token can't unlock a bidder variant, nor the reverse, nor another bidder's");

    const noAward = await undoAward(q);
    ok(!noAward.ok && noAward.error === "Nothing is awarded.", "bids db: undo with nothing awarded refused");

    // a revision cut before any award (2b-i final review)
    const revPre = await addQuoteRevision(q, { by: "Test", reason: "sent", note: "pre-award" });
    ok(!!revPre && revPre.docFields?.awardedPartyId === null, "revisions db: a revision cut before the award freezes no addressee");

    // award
    const before = await getQuote(q);
    const aw = await awardBid(q, g1);
    const after = await getQuote(q);
    const bidders = await listBidders(q);
    ok(aw.ok && after?.bid?.awardedPartyId === g1, "bids db: award stamps the quote");
    ok(typeof after?.contentChangedAt === "number" && after.contentChangedAt !== before?.contentChangedAt && after.updatedAt === before?.updatedAt, "bids db: award advances contentChangedAt and leaves updatedAt unchanged");
    const awAd = await documentAddressee(after as never);
    ok(awAd?.companyName === "Bid GC One" && (await documentAddressee(after as never, "pty_nope"))?.companyName === "Bid GC One" && (await documentAddressee(after as never, g2))?.companyName === "Bid GC Two", "addressee db: the awarded bidder is the default; an invalid id falls back to it; an explicit bidder wins");
    ok((await documentAddressee(after as never, "pty_nope", { strict: true })) === null && (await documentAddressee(after as never, g2, { strict: true }))?.companyName === "Bid GC Two", "addressee db: with an awarded bidder, strict still never falls back to it");
    ok(bidders.find((b) => b.id === g1)?.bid.result === "awarded" && bidders.find((b) => b.id === g2)?.bid.result === "lost" && bidders.find((b) => b.id === g2)?.bid.lostByAward === true, "bids db: winner awarded, the rest lost by award");
    ok(after?.customerId === before?.customerId && after?.pricingTier === before?.pricingTier && after?.tierMargin === before?.tierMargin && after?.customer === before?.customer, "bids db: award never changes the customer or tier");
    const postAwardAt = after?.contentChangedAt ?? 0;
    await new Promise((r) => setTimeout(r, 5));
    ok((await setBidDetails(q, { dueAt: T + 7200_000 })).ok && ((await getQuote(q))?.contentChangedAt ?? 0) > postAwardAt, "bids db: a post-award bid edit advances contentChangedAt");
    await setBidDetails(q, { dueAt: T });
    const again = await awardBid(q, g1);
    ok(!again.ok && /already awarded/.test(again.error), "bids db: a second award is refused");

    // 2b-i final review: the awarded bidder's contact change re-renders; another bidder's doesn't
    const c0 = await getQuote(q);
    await new Promise((r) => setTimeout(r, 5));
    const s2 = await setPartyContact(g2, F_FIX.ct3);
    ok(s2.ok && !(await touchAwardedAddressee(s2.party, null)) && (await getQuote(q))?.contentChangedAt === c0?.contentChangedAt, "contact db: a non-awarded bidder's contact change leaves contentChangedAt alone");
    const s1 = await setPartyContact(g1, null);
    const touched = s1.ok && (await touchAwardedAddressee(s1.party, ct1));
    const c1 = await getQuote(q);
    ok(touched && (c1?.contentChangedAt ?? 0) > (c0?.contentChangedAt ?? 0) && c1?.updatedAt === c0?.updatedAt, "contact db: the awarded bidder's contact change advances contentChangedAt (Send waits) without bumping updatedAt");
    const s1b = await setPartyContact(g1, ct1);
    ok(s1b.ok && !(await touchAwardedAddressee(s1b.party, ct1)), "contact db: an unchanged contact touches nothing");

    // Send defaults follow the awarded bidder
    ok((await awardedRecipient({ id: q, bid: null })) === null && (await awardedRecipient({ id: q, bid: { dueAt: null, addenda: [], awardedPartyId: g2 + "x" } })) === null, "send db: nothing (or a dead id) awarded → no recipient");
    const rcp0 = await awardedRecipient((await getQuote(q))!);
    ok(rcp0?.partyId === g1 && rcp0.contactId === ct1 && rcp0.name === "Gee Ceeone" && rcp0.firstName === "Gee" && rcp0.email === "", "send db: the awarded bidder's contact, no email on file");
    await setEmails(ct1, [{ value: "gee@gc-one.test", label: "work", isPrimary: true }]);
    const rcp1 = await awardedRecipient((await getQuote(q))!);
    const sd = sendDefaultsContact(rcp1, { name: "Bid Owner Contact", email: "own@owner.test" });
    ok(rcp1?.email === "gee@gc-one.test" && sd.contactEmail === "gee@gc-one.test" && sd.contactName === "Gee", "send db: To = the awarded contact's email, greeting = their first name");

    // cover + package page show the owner when addressed (never otherwise)
    const qAw = (await getQuote(q))!;
    const dAw = quoteDocumentDataFor(qAw as never, null, settings, await documentAddressee(qAw)), dOwn = quoteDocumentDataFor(qAw as never, null, settings, null);
    const cov = (d: typeof dAw) => coverDocumentPropsFor({ doc: d, coverSummary: "", notIncluded: "", signer: null, footerLine: "", shareUrl: null, letterhead: { src: "/l.png", full: true } });
    ok(cov(dAw).project.owner === "Bid Owner" && cov(dAw).project.customer === "Bid GC One" && !("owner" in cov(dOwn).project), "cover: an addressed estimate shows the Owner row; an owner-addressed one is unchanged");
    const pkg = (d: typeof dAw) => packageViewModel({ doc: d, photos: {}, catalog: new Map(), frozen: { coverSummary: "", notIncluded: "" }, state: { kind: "ok", rev: { rev: 1 } as never, closed: false, won: false }, headerLine: "", currentHref: null, view: "narrative", base: "/x", letterheadSrc: "/l.png" });
    ok(pkg(dAw).owner === "Bid Owner" && !("owner" in pkg(dOwn)), "package page: an addressed estimate carries the owner; an owner-addressed one is unchanged");

    // a revision cut while awarded
    const revAw = await addQuoteRevision(q, { by: "Test", reason: "sent", note: "awarded" });
    ok(!!revAw && revAw.docFields?.awardedPartyId === g1 && revAw.docFields.bid?.dueAt === T, "revisions db: a revision cut while awarded freezes the awarded bidder and the bid");
    const wd = await updateBidder(g1, { result: "withdrew" });
    ok(!wd.ok && wd.error === "Undo the award first.", "bids db: an awarded bidder can't be edited to withdrew");
    const wdLost = await updateBidder(g2, { result: "withdrew" });
    ok(!wdLost.ok && wdLost.error === "Undo the award first.", "bids db: a lost-by-award bidder's result can't be edited either");
    const lateAdd = await addBidder({ quoteId: q, companyId: own, role: "ec" }, "u");
    ok(!lateAdd.ok && lateAdd.error === "Undo the award before adding a bidder.", "bids db: no new bidder once awarded");
    ok(after?.locationId === before?.locationId && (after as { contactName?: string } | null)?.contactName === (before as { contactName?: string } | null)?.contactName, "bids db: award keeps the location and contact name");

    // undo
    const un = await undoAward(q);
    const afterUndo = await listBidders(q);
    ok(un.ok && afterUndo.every((b) => b.bid.result === "pending" && !("lostByAward" in b.bid)) && (await getQuote(q))?.bid?.awardedPartyId === null, "bids db: undo returns every bidder to pending");

    // after undo: each revision still prints who it was sent to; the live document is the owner's
    await setBidDetails(q, { dueAt: T + 86_400_000 });
    const qU = (await getQuote(q))!;
    const revOf = (n: number | undefined) => (qU.revisions || []).find((r) => r.rev === n) ?? null;
    const rPre = revOf(revPre?.rev), rAw = revOf(revAw?.rev);
    if (!rPre || !rAw) throw new Error("revisions missing");
    const docAw = await loadQuoteDocumentProps(qU, { revision: rAw, photos: "inline" });
    const docPre = await loadQuoteDocumentProps(qU, { revision: rPre, photos: "inline" });
    const docLive = await loadQuoteDocumentProps(qU, { photos: "inline" });
    ok(docAw?.custName === "Bid GC One" && docAw.ownerLine === "Owner: Bid Owner" && docAw.bidLine === bidDocLine({ dueAt: T, addenda: rAw.docFields?.bid?.addenda ?? [], awardedPartyId: null }), "revisions db: after undo, a revision cut while awarded still shows the GC and the bid line as sent");
    ok(docPre?.custName === "Bid Owner" && docPre.ownerLine === "" && docPre.bidLine === "", "revisions db: a revision cut before the award shows the owner");
    ok(docLive?.custName === "Bid Owner" && docLive.ownerLine === "", "revisions db: the live document follows the live (undone) award");
    const legacyDf = { ...rAw.docFields } as Record<string, unknown>;
    delete legacyDf.awardedPartyId;
    delete legacyDf.bid;
    const docLegacy = await loadQuoteDocumentProps(qU, { revision: { ...rAw, docFields: legacyDf } as never, photos: "inline" });
    ok(docLegacy?.custName === "Bid Owner" && docLegacy.ownerLine === "", "revisions db: an older revision without a frozen award loads owner-addressed");
    await setBidDetails(q, { dueAt: T });

    // won → project Bill to, undo refused
    ok((await awardBid(q, g1)).ok, "bids db: award again");
    await setStatus(q, "won", "Test", { bypassApprovalGate: "engine-owned-flow" });
    await regAll();
    const proj = await getProjectByQuote(q);
    ok(!!proj && proj.billToCompanyId === gc1 && proj.customerId === own, "bids db: the project bills the awarded GC; the customer stays the owner");
    const projParties = proj ? await listFor("project", proj.id) : [];
    ok(projParties.some((p) => p.companyId === gc1) && !projParties.some((p) => p.companyId === gc2), "bids db: the awarded GC carries to the project; the losing bidder doesn't");
    const noUndo = await undoAward(q);
    ok(!noUndo.ok && noUndo.error === "The estimate is won — the award can't be undone.", "bids db: a won estimate's award can't be undone");
  } finally {
    try { await regAll(); } catch {}
    await dropFixtures(348);
    await dropBidIdentityFixtures();
  }
}

const E_FIX = { own: fixtureId(348, "eown"), gc1: fixtureId(348, "egc1"), gc2: fixtureId(348, "egc2"), ct1: fixtureId(348, "ect1"), ct2: fixtureId(348, "ect2") };
async function dropBidSendIdentityFixtures() {
  const db = await getDb();
  await db.delete(contactEmails).where(like(contactEmails.contactId, "TEST348:e%"));
  await db.delete(contactsTable).where(like(contactsTable.id, "TEST348:e%"));
  await db.delete(companies).where(like(companies.id, "TEST348:e%"));
}

/** #348 2b-ii task 3 — the bidder send / failure / open writers and the bidder recipient (DB). */
export async function bidSendDbChecks(ok: Ok) {
  const { own, gc1, gc2, ct1, ct2 } = E_FIX;
  const eq = fixtureId(348, "eq");
  const regAll = async () => { for (const p of await listFor("quote", eq)) registerFixture("record_parties", p.id); };
  try {
    await dropBidSendIdentityFixtures();
    await saveCompany({ id: own, name: "Send Owner", type: "customer", lifecycle: "active", deleted: false });
    await saveCompany({ id: gc1, name: "Send GC One", type: "customer", lifecycle: "active", deleted: false });
    await saveCompany({ id: gc2, name: "Send GC Two", type: "customer", lifecycle: "active", deleted: false });
    await saveContact({ id: ct1, firstName: "Gee", lastName: "Ceeone", homeCompanyId: gc1 });
    await setEmails(ct1, [{ value: "gee@e.test", label: "work", isPrimary: true }] as never);
    await saveContact({ id: ct2, firstName: "Pri", lastName: "Mary", homeCompanyId: gc2, isPrimary: true });
    const NOW = Date.now();
    await createFixture("quotes", buildQuote(eq, { name: "Send quote", customer: "Send Owner", customerId: own, value: 1000 } as never, "system", null, NOW) as never);
    const a1 = await addBidder({ quoteId: eq, companyId: gc1, contactId: ct1, role: "gc" }, "u");
    const a2 = await addBidder({ quoteId: eq, companyId: gc2, role: "gc" }, "u");
    const a3 = await addBidder({ quoteId: eq, companyId: gc1, role: "ec", submitVia: "website" }, "u");
    await regAll();
    if (!a1.ok || !a2.ok || !a3.ok) throw new Error("send bidders missing");
    const g1 = a1.party.id, g2 = a2.party.id, g3 = a3.party.id;
    const bid = async (id: string) => (await listBidders(eq)).find((b) => b.id === id)?.bid;

    const r1 = await bidderRecipient(a1.party), r2 = await bidderRecipient(a2.party);
    ok(r1.contactId === ct1 && r1.email === "gee@e.test" && r1.firstName === "Gee", "send db: bidderRecipient → the party's contact, its first email, first name");
    ok(r2.contactId === ct2 && r2.email === "", "send db: bidderRecipient → the company's primary contact; no email → \"\"");

    const T = Date.UTC(2026, 9, 20, 15, 0);
    const u0 = (await getQuote(eq))?.updatedAt;
    const s1 = await recordBidderSend(eq, g1, { threadId: "C-e1", rev: 1, at: T, by: "Test", to: "gee@e.test" }, { kind: "sent" }, "u1");
    const b1 = await bid(g1), qa = await getQuote(eq);
    ok(s1 === true && b1?.revSent === 1 && b1.sentAt === T && b1.sentBy === "u1" && b1.threadId === "C-e1" && b1.failed === null, "send db: a sent bidder stamps revSent / sentAt / sentBy / thread, no failure");
    const em = qa?.estimateEmails?.at(-1) as Record<string, unknown> | undefined; // jsonb reorders keys: compare by value
    ok(!!em && Object.keys(em).length === 6 && em.threadId === "C-e1" && em.rev === 1 && em.at === T && em.by === "Test" && em.to === "gee@e.test" && em.partyId === g1, "send db: the estimate email remembers the bidder");
    ok(qa?.updatedAt === u0, "send db: recording a bidder send doesn't bump updatedAt");

    const s2 = await recordBidderSend(eq, g2, { threadId: "C-e2", rev: 1, at: T, by: "Test", to: "x@e.test" }, { kind: "failed", error: "Gmail didn\u2019t answer\u2026", unknown: true }, "u1");
    const b2 = await bid(g2);
    ok(s2 === true && b2?.failed?.unknown === true && b2.revSent == null && b2.threadId === "C-e2", "send db: an unknown failure keeps the thread, no revSent, unknown flag");

    const f3 = await markBidderSendFailed(eq, g3, { at: T, error: "x" });
    ok(f3 === true && (await bid(g3))?.failed?.error === "x", "send db: markBidderSendFailed stamps the failure");
    const before1 = JSON.stringify(await bid(g1));
    const fOther = await markBidderSendFailed(fixtureId(348, "eq2"), g1, { at: T, error: "nope" });
    ok(fOther === false && JSON.stringify(await bid(g1)) === before1, "send db: another quote's id can't write a bidder's failure");
    ok((await recordBidderSend(fixtureId(348, "eq2"), g1, { threadId: "C-ex", rev: 1, at: T, by: "x", to: "y" }, { kind: "sent" }, "u")) === false && !(await getQuote(eq))?.estimateEmails?.some((e) => e.threadId === "C-ex"), "send db: a party of another quote writes nothing");

    await recordBidderOpen(eq, g1, T);
    await recordBidderOpen(eq, g1, T + 5);
    const qo = await getQuote(eq);
    ok((await bid(g1))?.opens?.count === 2 && (await bid(g1))?.opens?.lastAt === T + 5 && qo?.shareOpens === undefined && qo?.updatedAt === u0, "send db: bidder opens count on the party, never on the quote");
    ok((await recordBidderOpen(eq, g1, -1)) === false, "send db: a bad open time writes nothing");

    // 2b-ii Task 4 — the bidder PDF from the sent revision
    const rRev9 = await renderBidderPdf(eq, g1, "localhost:3000", "http", { rev: 9 });
    ok(!rRev9.ok && rRev9.status === 404 && rRev9.error === "Not found", "bidder pdf rev db: a rev that isn't one of the quote's sent revisions 404s before any render");
    const tA = signPrintToken("s3cret", "quote", `${eq}~${g1}`, 1_000_000), tR1 = signPrintToken("s3cret", "quote", `${eq}~${g1}~r1`, 1_000_000);
    ok(!verifyPrintToken("s3cret", tA, "quote", `${eq}~${g1}~r1`, 1_000_000) && !verifyPrintToken("s3cret", tR1, "quote", `${eq}~${g1}`, 1_000_000)
      && !verifyPrintToken("s3cret", tR1, "quote", `${eq}~${g1}~r2`, 1_000_000) && !verifyPrintToken("s3cret", tR1, "quote", `${eq}~${g2}~r1`, 1_000_000) && verifyPrintToken("s3cret", tR1, "quote", `${eq}~${g1}~r1`, 1_000_000),
      "bidder pdf rev db: a rev token is bound to its bidder and revision; a no-rev token never unlocks it, nor the reverse");
    const rd4 = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    ok(rd4("src/app/print/quote/[id]/page.tsx").includes("~r${") && rd4("src/app/print/quote/[id]/page.tsx").includes("quoteAsOfRevision(") && rd4("src/app/api/quotes/[id]/bidder-pdf/[partyId]/route.ts").includes("bidderPdfRev(") && rd4("src/app/api/quotes/[id]/pdf/route.ts").includes("bidderFileOf(file)"),
      "bidder pdf rev: the print route reads the revision's source, the download route passes the sent rev, the pdf route serves bidder files");

    await recordEstimateEmail(eq, { threadId: "C-e3", rev: 1, at: T, by: "x", to: "y", partyId: "nope" });
    const e3 = (await getQuote(eq))?.estimateEmails?.find((e) => e.threadId === "C-e3");
    ok(!!e3 && !("partyId" in e3), "send db: a malformed partyId isn't stored");
  } finally {
    try { await regAll(); } catch {}
    await dropFixtures(348);
    await dropBidSendIdentityFixtures();
  }
}

if (process.argv[1]?.endsWith("test-bids.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  bidChecks(okf).then(() => bidSendChecks(okf)).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}
