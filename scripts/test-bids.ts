/* #348 slice 2a — bids harness checks. `bidChecks` is pure; `bidDbChecks` needs the test DB (Task 2 fills it).
   Run the pure half alone with `npx tsx scripts/test-bids.ts`. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import {
  BID_RESULTS, BID_RESULT_LABEL, EMPTY_BID, sanitizeBidDetails, sanitizeBidSiteUrl, sanitizeBidderPatch, newBidderState, applyBidderPatch,
  markSubmittedState, currentRev, needsRev, awardPlan, undoAwardPlan, canAward, canUndoAward, bidderStatusText, bidDueText, bidDueDays, isOpenBid,
  addedAddendumNos, addendumMovesToDraft, addendumDraftNote,
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
import { addressedHeader, bidDocLine, bidderPdfFileName, ownerNameFromLine, rewardsVisibleFor, sendDefaultsContact, type DocAddressee } from "../src/lib/parties/addressee";
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
import { portalBidCandidates, portalBidChip, portalBidDueAt, portalBidList, portalBidState, PORTAL_BID_COPY, quoteHasBidders, type PortalBidRow } from "../src/lib/parties/portal-bid";
import { portalBidPdfSource, portalOnlineEstimateState, portalQuotePdfSource } from "../src/lib/quote-pdf/portal-access";
import { portalBidPdfResponse, portalBidRowsFor, portalBidRowsForCompany, portalBidderQuoteIds, portalOwnerBom, portalOwnerHasBidders, portalQuoteHasBidders, PORTAL_BID_PDF_PER_MIN } from "../src/lib/parties/portal-bid-server";
import { ownerBom, ownerBomSections } from "../src/lib/parties/portal-owner-bom";
import { acceptPortal, copyToCart, PORTAL_NOT_FOUND_COPY, refreshPortalQuote, renamePortalQuote } from "../src/lib/portal-quotes";
import { serviceRequestFromQuoteId } from "../src/lib/portal-service-quotes";
import { like } from "drizzle-orm";
import { getDb } from "../src/db";
import { companies, contactEmails, contacts as contactsTable } from "../src/db/schema";
import { saveCompany } from "../src/lib/identity/companies";
import { saveContact, setEmails } from "../src/lib/identity/contacts";
import { createFixture, dropFixtures, fixtureId, registerFixture } from "./test-fixtures";
import { addQuoteRevision, buildQuote, get as getQuote, portalListsQuote, revisionDocFields, setStatus, update as updateQuote, type QuoteRevision } from "../src/lib/stores/quotes";
import { getProjectByQuote } from "../src/lib/stores/projects";
import { autoTaskId } from "../src/lib/stores/tasks";
import { addParty, listFor, setPartyBid, setPartyContact } from "../src/lib/stores/parties";
import { loadBidPanel } from "../src/lib/parties/bid-panel-server";
import { awardedRecipient, bidderRecipient, documentAddressee, touchAwardedAddressee } from "../src/lib/parties/addressee-server";
import { renderBidderPdf } from "../src/lib/quote-pdf/bidder-pdf-server";
import { signPrintToken, verifyPrintToken } from "../src/lib/quote-pdf/token";
import { quoteDocumentDataFor } from "../src/lib/quote-pdf/quote-document-data";
import { addBidder, awardBid, listBidders, markBidderSendFailed, markSubmitted, recordBidderOpen, recordBidderSend, setBidDetails, undoAward, updateBidder } from "../src/lib/stores/bids";
import { recordEstimateEmail } from "../src/lib/stores/quotes";
import { bidderLinkPath, bidderSharePath, ensureShareLink, recordSharedOpen, resolveSharedPackage, revokeShareLink } from "../src/lib/quote-share/links";
import { submitClientResponse } from "../src/lib/estimate-output/responses-server";
import { CLIENT_ACTION_COPY, cleanBidderName, type ClientResponse } from "../src/lib/estimate-output/responses";
import { appendResponseTo, responsesBy, responseQuoteBucket, MAX_CLIENT_RESPONSES, RESPONSE_QUOTE_LIMIT } from "../src/lib/estimate-output/responses";
import { loadPackageViewProps } from "../src/lib/estimate-output/package-loader";
import {
  EstimateEmailError, SEND_COPY, sendBidderEmail, sendEstimateEmail,
  type BidderEmailDeps, type BidderEmailInput, type BidderTarget, type ThreadSpec,
} from "../src/lib/estimate-email/send-server";
import type { EstimateEmailClaim, EstimateEmailEntry } from "../src/lib/stores/quotes";

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
  ok(bidderPdfFileName("P", "ABC", 3, true) === "Peak \u2013 P \u2013 ABC \u2013 Rev 3 (draft).pdf" && bidderPdfFileName("P", "ABC", 3) === "Peak \u2013 P \u2013 ABC \u2013 Rev 3.pdf", "addressee: a live render of a quote with a sent revision is named \"Rev N+1 (draft)\"");
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
  ok(plan.ids.join() === "a,b" && plan.label === "Send revision to all bidders" && plan.noEmail === 1, "bid-send: plan ids/label/noEmail");
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
  ok(bidWalkSummary({ total: 4, sent: 2, failed: 0, local: 0, stopped: true }) === "Sent to 2 bidders. Stopped — the rest weren’t sent.", "bid-send: walk summary stopped by user");
  ok(bidWalkSummary({ total: 4, sent: 1, failed: 0, local: 0, stoppedError: "x", stopped: true }) === "Stopped after 1 of 4: x", "bid-send: error stop wins over stopped flag");
  ok(BID_SEND_COPY.preparing === "Preparing…", "bid-send: preparing copy");
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
    ok(responseRows([{ ...rv, partyId: P }], (n) => n, () => "")[0].who === "Former bidder · Pat · pat@x.test" && responseRows([{ ...rv, partyId: P }], (n) => n)[0].who === "Former bidder · Pat · pat@x.test" && responseRows([rv], (n) => n)[0].who === "Pat · pat@x.test", "responseRows: a bidder response whose name no longer resolves reads \"Former bidder\"; an owner response has no prefix");
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

    // D1087: the owner's Rewards print only on the owner's copy — an addressed document (explicit bidder or the awarded default) hides them.
    ok(!rewardsVisibleFor(await documentAddressee(qAw)) && !rewardsVisibleFor(await documentAddressee(qAw, g2)) && rewardsVisibleFor(null), "rewards: an awarded-addressed or explicit-bidder document hides the owner's Rewards; the owner's copy keeps them");
    for (const f of ["src/lib/quote-pdf/document-loader.ts", "src/lib/estimate-output/cover-loader.ts", "src/lib/estimate-output/package-live-loader.ts", "src/app/print/quote/[id]/page.tsx"]) {
      ok(/rewardsVisibleFor\(addressee\) \? purchasePerksDocLine\(perks\) : ""/.test(readFileSync(join(process.cwd(), f), "utf8")), `rewards: ${f} gates the perks line on the addressee`);
    }
    ok(readFileSync(join(process.cwd(), "src/app/share/quote/[id]/[token]/package-page.tsx"), "utf8").includes("hit.bidder || hit.rev.docFields?.awardedPartyId ? null : creditNoteText("), "rewards: the package page drops the credit note on a bidder / awarded-addressed copy");

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

    // 2b-ii Task 5 — bidder links (v3): the share page, opens, tagged responses.
    const es = fixtureId(348, "es");
    const SEC = "s3cret";
    await createFixture("quotes", buildQuote(es, { name: "Link quote", customer: "Send Owner", customerId: own, value: 1000 } as never, "system", null, NOW) as never);
    const regEs = async () => { for (const p of await listFor("quote", es)) registerFixture("record_parties", p.id); };
    const lb1 = await addBidder({ quoteId: es, companyId: gc1, contactId: ct1, role: "gc" }, "u");
    const lb2 = await addBidder({ quoteId: es, companyId: gc2, role: "gc" }, "u");
    await regEs();
    if (!lb1.ok || !lb2.ok) throw new Error("link bidders missing");
    const sg1 = lb1.party.id, sg2 = lb2.party.id;
    const preSend = await bidderLinkPath(es, sg1, "Test", { secret: SEC });
    ok(!preSend.ok, "link db: an unsent estimate has no bidder link (ensureShareLink's refusal passes through)");
    await setStatus(es, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" });
    const ens = await ensureShareLink(es, "Test", { secret: SEC });
    ok(ens.ok, "link db: the estimate's share link exists after the send");
    const lp1 = await bidderLinkPath(es, sg1, "Test", { secret: SEC });
    const tok1 = lp1.ok ? lp1.path.split("/").pop()! : "";
    const p1 = parseShareToken(tok1);
    ok(lp1.ok && lp1.rev === 1 && lp1.path.startsWith("/share/quote/") && p1?.v === 3 && p1.partyId === sg1 && p1.rev === 1, "link db: bidderLinkPath → a v3 path for this bidder at the latest sent revision");
    const lpGone = await bidderLinkPath(es, "pty_0000000000000000", "Test", { secret: SEC });
    ok(!lpGone.ok && lpGone.error === BID_SEND_COPY.gone, "link db: an unknown bidder gets BID_SEND_COPY.gone");
    const lpOther = await bidderLinkPath(es, g1, "Test", { secret: SEC });
    ok(!lpOther.ok && lpOther.error === BID_SEND_COPY.gone, "link db: another quote's bidder gets BID_SEND_COPY.gone");
    const qes = (await getQuote(es))!;
    const NOWL = Date.now();
    ok(bidderSharePath(qes, sg1, 2, SEC, NOWL) === null && bidderSharePath(qes, "pty_xyz", 1, SEC, NOWL) === null && bidderSharePath(qes, sg1, 1, SEC, (qes.shareLink?.expiresAt ?? 0) + 1) === null
      && bidderSharePath(qes, sg1, 1, "", NOWL) === null && bidderSharePath(qes, sg1, 1, SEC, NOWL) === (lp1.ok ? lp1.path : "x"),
      "link db: bidderSharePath — only a sent rev, a bidder-shaped id, an active link and a secret");

    const hit1 = await resolveSharedPackage(es, tok1, { secret: SEC });
    ok(hit1?.bidder?.companyName === "Send GC One" && hit1.bidder.result === "pending" && hit1.bidder.partyId === sg1 && hit1.bidder.companyId === gc1 && hit1.rev.rev === 1 && hit1.currentPath === null,
      "link db: a v3 token resolves its bidder (company, pending) at the pinned revision");
    const v2tok = ens.ok && ens.link.pathV2 ? ens.link.pathV2.split("/").pop()! : "";
    const hitV2 = await resolveSharedPackage(es, v2tok, { secret: SEC });
    ok(!!hitV2 && hitV2.bidder === null, "link db: the owner's v2 for the same quote has bidder === null");
    const tokForged = tok1.replace(sg1.slice(4), sg2.slice(4));
    ok((await resolveSharedPackage(es, tokForged, { secret: SEC })) === null, "link db: a v3 moved to another bidder's id fails the MAC");

    const docB = hit1 ? await loadQuoteDocumentProps(hit1.q, { revision: hit1.rev, photos: { href: (d) => d }, bidderPartyId: sg1 }) : null;
    ok(docB?.custName === "Send GC One" && docB.ownerLine === "Owner: Send Owner", "link db: the bidder's document is addressed to the bidder, owner on its own line");
    const docX = hit1 ? await loadQuoteDocumentProps(hit1.q, { revision: hit1.rev, photos: { href: (d) => d }, bidderPartyId: "pty_0000000000000000" }) : "x";
    ok(docX === null, "link db: an unresolvable bidder id fails the loader closed");
    const docO = hitV2 ? await loadQuoteDocumentProps(hitV2.q, { revision: hitV2.rev, photos: { href: (d) => d } }) : null;
    ok(!!docO && docO.custName === "Send Owner", "link db: without bidderPartyId the document stays owner-addressed");

    const lp2 = await bidderLinkPath(es, sg2, "Test", { secret: SEC });
    const tok2 = lp2.ok ? lp2.path.split("/").pop()! : "";
    ok(!!(await resolveSharedPackage(es, tok2, { secret: SEC }))?.bidder, "link db: the second bidder's v3 resolves");
    await setPartyBid(sg2, null);
    ok((await resolveSharedPackage(es, tok2, { secret: SEC })) === null, "link db: a removed bidder's v3 resolves null (the one inactive card)");
    await setPartyBid(sg2, newBidderState());

    const op1 = await recordSharedOpen(es, tok1, "203.0.113.7", { secret: SEC });
    const op2 = await recordSharedOpen(es, tok1, "203.0.113.7", { secret: SEC });
    const sg1Bid = (await listBidders(es)).find((b) => b.id === sg1)?.bid;
    const qOpen = await getQuote(es);
    ok(op1 === true && op2 === false && sg1Bid?.opens?.count === 1 && !("1" in ((qOpen?.shareOpens ?? {}) as Record<string, unknown>)),
      "link db: a bidder open counts once per IP on the bidder, never on Quote.shareOpens");

    let seen: { r: ClientResponse; b?: string } | null = null;
    const sub1 = await submitClientResponse("question", es, tok1, { name: "Pat", message: "Hi" }, "203.0.113.8", {
      secret: SEC, users: async () => [], notify: async (_q, r, _u, _n, b) => { seen = { r, b }; },
    });
    const seenV = seen as { r: ClientResponse; b?: string } | null;
    const stored = (await getQuote(es))?.clientResponses?.at(-1);
    ok(sub1.ok && seenV?.r.partyId === sg1 && seenV.b === "Send GC One" && stored?.partyId === sg1, "link db: a bidder's response is tagged with the bidder and names it to notify");

    const aw = await awardBid(es, sg2);
    const hitLost = await resolveSharedPackage(es, tok1, { secret: SEC });
    ok(aw.ok && hitLost?.bidder?.partyId === sg1 && hitLost.bidder.result === "lost", "link db: a lost bidder's link still resolves, result lost");
    const subLost = await submitClientResponse("question", es, tok1, { name: "Pat", message: "Again" }, "203.0.113.9", { secret: SEC, users: async () => [], notify: async () => {} });
    ok(!subLost.ok && subLost.error === CLIENT_ACTION_COPY.closed, "link db: a lost bidder can't respond (closed)");
    ok(!!hitLost && packageBanner(hitLost.state, null, true)?.text === "This bid is closed.", "link db: the closed-bid banner");
    const modelLost = hitLost ? await loadPackageViewProps(hitLost, { base: "/b", view: "narrative", letterheadSrc: "/l.jpg" }) : null;
    ok(modelLost?.banner?.text === "This bid is closed." && modelLost.customer === "Send GC One", "link db: the lost bidder's package page reads \"This bid is closed.\", addressed to the bidder");
    const hitWin = await resolveSharedPackage(es, tok2, { secret: SEC });
    const modelWin = hitWin ? await loadPackageViewProps(hitWin, { base: "/b", view: "narrative", letterheadSrc: "/l.jpg" }) : null;
    ok(hitWin?.bidder?.result === "awarded" && modelWin?.banner == null && modelWin?.customer === "Send GC Two", "link db: the awarded bidder's page has no closed banner");
    ok((await undoAward(es)).ok, "link db: the award undoes");

    // Superseded: a newer send re-signs the SAME bidder's v3 — never the owner's v2.
    await addQuoteRevision(es, { by: "Test", reason: "sent" });
    const sup = await resolveSharedPackage(es, tok1, { secret: SEC });
    const supTok = parseShareToken(sup?.currentPath?.split("/").pop());
    ok(sup?.state.kind === "superseded" && supTok?.v === 3 && supTok.partyId === sg1 && supTok.rev === 2, "link db: a superseded v3's current link is the same bidder's v3 at the latest revision");

    ok(cleanBidderName("  Acme\n\n  GC\tInc  ") === "Acme GC Inc" && cleanBidderName("x".repeat(200)).length === 120 && cleanBidderName(undefined) === "", "link: bidder names are one line, ≤ 120 chars");

    ok((await revokeShareLink(es, "Test")).ok && (await resolveSharedPackage(es, tok1, { secret: SEC })) === null, "link db: Revoke kills every bidder link");

    const rdS = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    const SD = "src/app/share/quote/[id]/[token]/";
    const subRoutes = ["datasheets.pdf/route.ts", "package.zip/route.ts", "doc/[docId]/route.ts", "file/[fileId]/route.ts", "photo/[docId]/route.ts"].map((f) => rdS(SD + f));
    ok(subRoutes.every((t) => t.includes("isPackageToken(") && !t.includes("isShareTokenV2(")), "link: every package sub-route gates on isPackageToken, never isShareTokenV2");
    ok(rdS(SD + "page.tsx").includes("isPackageToken(token)") && rdS(SD + "package-page.tsx").includes("bidderCanAct("), "link: the share page branches on isPackageToken; the package page gates actions on bidderCanAct");

    // 2b-ii Task 7 — the shared panel loader: the send plan, row labels and per-viewer permissions.
    const ep = fixtureId(348, "ep");
    await createFixture("quotes", buildQuote(ep, { name: "Panel quote", customer: "Send Owner", customerId: own, value: 1000 } as never, "system", null, NOW) as never);
    const regEp = async () => { for (const p of await listFor("quote", ep)) registerFixture("record_parties", p.id); };
    const pb1 = await addBidder({ quoteId: ep, companyId: gc1, contactId: ct1, role: "gc" }, "u");
    const pb2 = await addBidder({ quoteId: ep, companyId: gc2, role: "gc" }, "u");
    const pb3 = await addBidder({ quoteId: ep, companyId: gc1, role: "ec", submitVia: "website" }, "u");
    await regEp();
    if (!pb1.ok || !pb2.ok || !pb3.ok) throw new Error("panel bidders missing");
    const pg1 = pb1.party.id, pg2 = pb2.party.id, pg3 = pb3.party.id;
    const full = await loadBidPanel(ep, { canEdit: true, canSend: true, canLink: true });
    if (!full.ok) throw new Error("panel load failed: " + full.error);
    const rowOf = (pn: typeof full.panel, id: string) => pn.bidders.find((b) => b.id === id);
    ok(JSON.stringify(full.panel.plan.ids) === JSON.stringify([pg1]) && full.panel.plan.label === "Send to all bidders" && full.panel.plan.noEmail === 1 && full.panel.canCopyLink === false,
      "panel db: the plan is the one emailable bidder, \"Send to all bidders\", one without an email, no link before a send");
    ok(rowOf(full.panel, pg1)?.sendLabel === "Send" && rowOf(full.panel, pg1)?.contactEmail === "gee@e.test" && rowOf(full.panel, pg2)?.noEmail === true && rowOf(full.panel, pg2)?.sendLabel === "" && rowOf(full.panel, pg3)?.sendLabel === "" && rowOf(full.panel, pg3)?.noEmail === false,
      "panel db: g1 Send (recipient email), g2 No email, the website bidder neither");
    ok(full.panel.canSend && full.panel.addendaAfterSend.length === 0 && rowOf(full.panel, pg1)?.revisedSubject === "" && rowOf(full.panel, pg1)?.opensText === "", "panel db: canSend, no addenda after a send, no revised subject, no opens text");
    const noSend = await loadBidPanel(ep, { canEdit: true, canSend: false, canLink: true });
    ok(noSend.ok && noSend.panel.plan.ids.length === 0 && noSend.panel.plan.label === null && !noSend.panel.canSend && noSend.panel.bidders.every((b) => b.sendLabel === ""), "panel db: without send permission the plan is empty and no row has a button");
    const badId = await loadBidPanel("", { canEdit: true, canSend: true, canLink: true });
    ok(!badId.ok && badId.error === "That estimate wasn't found.", "panel db: an empty id is refused");
    const rdP = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
    const sendAct = rdP("src/app/(app)/estimator/bid-send-actions.ts");
    const sendBody = sendAct.slice(sendAct.indexOf("export async function sendToBidderAction("), sendAct.indexOf("export type BidderEmailDefaultsResult"));
    ok(sendAct.startsWith('"use server";') && sendBody.indexOf("await requireUser()") > 0 && sendBody.indexOf('!can("send", user.roles) && !can("approve", user.roles)') > sendBody.indexOf("await requireUser()") && sendBody.indexOf('!can("send", user.roles) && !can("approve", user.roles)') < sendBody.indexOf("liveBidderEmailDeps(")
      && sendBody.includes("revalidatePath(") && sendBody.includes("retryUnknown: o.retryUnknown === true") && rdP("src/app/(app)/estimator/send-actions.ts").includes("await requestWhere()") && rdP("src/lib/estimate-email/request-where.ts").includes("printOriginFor(process.env,"),
      "panel: sendToBidderAction gates send|approve before the live deps, revalidates, and shares requestWhere with the estimate send");
  } finally {
    try { await regAll(); } catch {}
    try { for (const p of await listFor("quote", fixtureId(348, "es"))) registerFixture("record_parties", p.id); } catch {}
    try { for (const p of await listFor("quote", fixtureId(348, "ep"))) registerFixture("record_parties", p.id); } catch {}
    await dropFixtures(348);
    await dropBidSendIdentityFixtures();
  }
}

/** #348 2b-ii Task 6 — sendBidderEmail with fake deps (no DB): the order, the idempotency point, every scope. */
export async function bidSendFakeChecks(ok: Ok) {
  const NOW = Date.UTC(2026, 9, 7, 18, 0, 0);
  const V3 = "https://app.test/share/quote/Q-P3S/v3tok";
  const PID = "pty_0123456789abcdef";
  const SAM = { id: "u1", name: "Sam Mills", roles: ["Admin"] };
  const VIEWER = { id: "u9", name: "Vic Viewer", roles: ["Crew"] };
  const baseQuote = (): Quote => ({
    id: "Q-P3S", name: "North HS Auditorium", customer: "North HS", customerId: "co-1", locationId: null, contactName: "Pat Rivera",
    value: 1000, margin: 0.3, status: "draft", source: "estimator", quoteType: "system", owner: "Lee Lead", estNo: 1042, leadId: "L-9",
    review: { state: "none" }, createdAt: 1, updatedAt: 77, history: [], revisions: [],
    pdf: { status: "ready", at: 20, savedAt: 20, blobPath: "quote-pdfs/Q-P3S/cur.pdf" }, contentChangedAt: 10,
  } as unknown as Quote);
  const target = (bid: Partial<BidderState> = {}, over: Partial<BidderTarget> = {}): BidderTarget => ({
    partyId: PID, companyId: "co-gc", companyName: "Miron Construction", contactName: "Gee Ceeone", email: "gee@miron.test", bid: { ...newBidderState("email"), ...bid }, ...over,
  });
  type Outcome = { kind: "sent" } | { kind: "failed"; error: string; unknown?: boolean };
  const fakes = (quote: Partial<Quote> = {}, over: Partial<BidderEmailDeps> = {}, t: BidderTarget | null | Array<BidderTarget | null> = target()) => {
    const calls: string[] = [];
    const st = {
      q: { ...baseQuote(), ...quote } as Quote, threads: [] as ThreadSpec[], records: [] as Array<{ entry: EstimateEmailEntry; outcome: Outcome; by: string }>,
      failed: [] as Array<{ at: number; error: string; unknown?: boolean; threadId?: string }>, tasks: 0, asOf: [] as Array<number | undefined>,
      claims: [] as EstimateEmailClaim[], released: [] as EstimateEmailClaim[],
    };
    let bidderReads = 0;
    const deps: BidderEmailDeps = {
      now: () => NOW,
      getQuote: async (id) => (id === st.q.id ? st.q : null),
      readPdf: async (path) => { calls.push("readPdf:" + path); return Buffer.from("%PDF-estimate"); },
      renderCoverPdf: async () => { calls.push("renderCoverPdf"); return Buffer.from("%PDF-cover"); },
      storeCover: async (id, _b, now) => { calls.push("storeCover"); return `quote-pdfs/${id}/cover-${now}.pdf`; },
      findInboxDraft: async () => { calls.push("findInboxDraft"); return null; },
      claimSend: async (_id, by, now) => { calls.push("claimSend"); const claim = { by, until: now + 120_000 }; st.claims.push(claim); return { ok: true, claim }; },
      releaseSend: async (_id, claim) => { calls.push("releaseSend"); st.released.push(claim); },
      applySignature: async (body) => { calls.push("applySignature"); return body + "\n\n-- \nSam Mills · Peak"; },
      sendQuote: async (_id, actor, asOf) => {
        calls.push("sendQuote"); st.asOf.push(asOf);
        st.q = { ...st.q, status: "sent", revisions: [...(st.q.revisions || []), { rev: 4, at: NOW, by: actor.name, reason: "sent", pdfBlobPath: "quote-pdfs/Q-P3S/rev-4.pdf" }] } as Quote;
        return { ok: true };
      },
      ensureLink: async () => { calls.push("ensureLink"); return "https://app.test/share/quote/Q-P3S/v2tok"; },
      createAndSendThread: async (spec) => { calls.push("createAndSendThread"); st.threads.push(spec); return { threadId: "C-9001", delivery: "local" as const }; },
      createDraftThread: async () => { calls.push("createDraftThread"); return { threadId: "C-9002" }; },
      recordEmail: async () => { calls.push("recordEmail"); return true; },
      addFollowUpTask: async () => { calls.push("addFollowUpTask"); st.tasks++; },
      roster: async () => [],
      getBidder: async () => { calls.push("getBidder"); const v = Array.isArray(t) ? t[Math.min(bidderReads, t.length - 1)] : t; bidderReads++; return v ?? null; },
      renderBidderPdf: async (_q, _p, rev) => { calls.push("renderBidderPdf:" + (rev ?? "live")); return { ok: true, pdf: Buffer.from("%PDF-bidder") }; },
      storeBidderPdf: async (id, partyId, rev, _b, now) => { calls.push("storeBidderPdf"); return `quote-pdfs/${id}/bidder-${partyId.slice(4)}-r${rev}-${now}.pdf`; },
      bidderLink: async (_id, _p, rev) => { calls.push("bidderLink:" + rev); return V3; },
      recordBidderSend: async (_id, _p, entry, outcome, by) => { calls.push("recordBidderSend:" + outcome.kind); st.records.push({ entry, outcome, by }); return true; },
      markBidderFailed: async (_id, _p, f) => { calls.push("markBidderFailed"); st.failed.push(f); return true; },
      ...over,
    };
    return { deps, calls, st };
  };
  const input = (o: Partial<BidderEmailInput> = {}): BidderEmailInput => ({ subject: "North HS Auditorium — bid", body: "Hi Gee,\n\nYour link: {link}\n\nThanks", asOf: 77, ...o });
  const sentRev2 = { status: "sent" as const, revisions: [{ rev: 2, at: 5, by: "Sam", reason: "sent", pdfBlobPath: "quote-pdfs/Q-P3S/rev-2.pdf" }] as Quote["revisions"] };

  // 1. Draft happy path.
  {
    const f = fakes();
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    ok(r.ok && "rev" in r && !("skipped" in r) && r.rev === 4 && r.status === "sent" && r.delivery === "local" && r.partyId === PID, "send fake: draft happy path — ok, rev 4, sent, local");
    ok(f.calls.join(" > ") === "getBidder > claimSend > getBidder > applySignature > renderBidderPdf:live > sendQuote > bidderLink:4 > storeBidderPdf > createAndSendThread > recordBidderSend:sent > releaseSend",
      "send fake: the ordered pipeline — bidder read, claim, re-read, signature, render, mark sent, v3 link, store, email, record, release");
    const t = f.st.threads[0];
    ok(!!t && t.to === "gee@miron.test" && t.cc === "" && t.customerId === "co-gc" && t.customer === "Miron Construction" && t.contactName === "Gee Ceeone" && t.link.id === "Q-P3S",
      "send fake: the thread goes to the bidder, filed under the bidder company, linked to the quote");
    ok(!!t && t.body.includes(V3) && !t.body.includes("{link}") && t.subject === "North HS Auditorium — bid", "send fake: the v3 URL replaces {link}; the subject is the input base");
    const a = t?.attachments[0];
    ok(t?.attachments.length === 1 && a?.name === "Peak – North HS Auditorium – Miron Construction – Rev 4.pdf" && a.pdfPath === `quote-pdfs/Q-P3S/bidder-0123456789abcdef-r4-${NOW}.pdf` &&
       a.href === `/api/quotes/Q-P3S/pdf?file=bidder-0123456789abcdef-r4-${NOW}.pdf&download=1` && a.dataUrl === undefined, "send fake: one bidder PDF, by reference");
    ok(f.st.tasks === 0 && !f.calls.includes("addFollowUpTask") && f.st.released.length === 1 && f.st.released[0] === f.st.claims[0], "send fake: no follow-up task; the claim taken is released");
    const e = f.st.records[0];
    ok(!!e && e.entry.rev === 4 && e.entry.threadId === "C-9001" && e.entry.to === "gee@miron.test" && e.entry.by === "Sam Mills" && e.entry.at === NOW && e.by === "u1", "send fake: the record entry and the stamping user");
    ok(f.st.asOf.join() === "77", "send fake: mark sent passes the shown version");
  }
  // 2. Re-send on a sent quote with an addendum since the row's rev.
  {
    const f = fakes({
      status: "sent",
      revisions: [
        { rev: 1, at: 2, by: "Sam", reason: "sent", docFields: { bid: { addenda: [{ no: 1, receivedAt: 1, note: "" }] } } },
        { rev: 2, at: 5, by: "Sam", reason: "sent", pdfBlobPath: "quote-pdfs/Q-P3S/rev-2.pdf" },
      ] as unknown as Quote["revisions"],
      bid: { dueAt: null, awardedPartyId: null, addenda: [{ no: 1, receivedAt: 1, note: "" }, { no: 2, receivedAt: 3, note: "" }] },
    } as Partial<Quote>, {}, target({ revSent: 1, sentAt: 2 }));
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    ok(r.ok && !f.calls.includes("sendQuote") && f.calls.includes("renderBidderPdf:2") && f.calls.includes("bidderLink:2"), "send fake: re-send — no mark, render + link at rev 2");
    ok(f.st.threads[0]?.subject === "Revised bid — North HS Auditorium (Addendum 2)" && f.st.records[0]?.entry.rev === 2, "send fake: re-send subject names the new addendum; the entry is rev 2");
  }
  // 3. Already sent.
  {
    const f = fakes(sentRev2, {}, target({ revSent: 2 }));
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input({ asOf: undefined }));
    ok(r.ok && "skipped" in r && r.skipped === true && r.rev === 2 && f.calls.join() === "getBidder", "send fake: a bidder who already has the latest rev is skipped before any claim");
  }
  // 4. Double click.
  {
    const f = fakes(sentRev2, {}, [target({ revSent: 1 }), target({ revSent: 2 })]);
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input({ asOf: undefined }));
    ok(r.ok && "skipped" in r && f.calls.join(" > ") === "getBidder > claimSend > getBidder > releaseSend", "send fake: the re-read under the claim sees the first send's stamp — skipped, never emailed twice");
  }
  // 5. Row refusals.
  {
    const cases: Array<[string, BidderTarget | null, string, Partial<BidderEmailInput>]> = [
      ["website", target({ submitVia: "website" }), BID_SEND_COPY.website, {}],
      ["blank email", target({}, { email: "  " }), BID_SEND_COPY.noEmail("Gee Ceeone"), {}],
      ["withdrew", target({ result: "withdrew" }), BID_SEND_COPY.notPending, {}],
      ["gone", null, BID_SEND_COPY.gone, {}],
      ["unknown without retry", target({ failed: { at: 1, error: "x", unknown: true } }), BID_SEND_COPY.unknownRetry, {}],
    ];
    for (const [label, t, error, inp] of cases) {
      const f = fakes({}, {}, t);
      const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input(inp));
      ok(!r.ok && r.scope === "row" && r.error === error && !f.calls.includes("claimSend") && !f.calls.includes("markBidderFailed"), `send fake: row refusal — ${label}`);
    }
    const bad = fakes();
    const rb = await sendBidderEmail(bad.deps, SAM, "Q-P3S", "pty_nope", input());
    ok(!rb.ok && rb.scope === "row" && rb.error === BID_SEND_COPY.gone && bad.calls.length === 0, "send fake: a malformed party id is gone, nothing read");
    const retry = fakes({}, {}, target({ failed: { at: 1, error: "x", unknown: true } }));
    const rr = await sendBidderEmail(retry.deps, SAM, "Q-P3S", PID, input({ retryUnknown: true }));
    ok(rr.ok && retry.st.threads.length === 1, "send fake: an unknown failure proceeds with retryUnknown");
  }
  // 6. Quote refusals.
  {
    const cases: Array<[string, Partial<Quote>, Partial<BidderEmailInput>, string, typeof SAM, Partial<BidderEmailDeps>]> = [
      ["no permission", {}, {}, SEND_COPY.needsPerm, VIEWER, {}],
      ["won", { status: "won" }, {}, SEND_COPY.closed, SAM, {}],
      ["stale PDF", { contentChangedAt: 99 }, {}, SEND_COPY.pdfStale, SAM, {}],
      ["stale view", {}, { asOf: 76 }, SEND_COPY.changedSince, SAM, {}],
      ["busy claim", {}, {}, SEND_COPY.inProgress, SAM, { claimSend: async () => ({ ok: false as const, reason: "busy" as const }) }],
    ];
    for (const [label, q, inp, error, actor, over] of cases) {
      const f = fakes(q, over);
      const r = await sendBidderEmail(f.deps, actor, "Q-P3S", PID, input(inp));
      ok(!r.ok && r.scope === "quote" && r.error === error && !f.st.claims.length && !f.calls.includes("markBidderFailed") && !f.calls.includes("recordBidderSend:sent") && !f.st.threads.length,
        `send fake: quote refusal — ${label}`);
    }
  }
  // 7–8. Render fails: row (stamped) vs quote (not stamped).
  {
    const err = "The bidder PDF couldn’t be rendered — try again.";
    const f = fakes({}, { renderBidderPdf: async () => ({ ok: false, error: err, scope: "row" }) });
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    ok(!r.ok && r.scope === "row" && r.error === err && f.st.failed[0]?.error === err && !f.calls.includes("sendQuote") && f.st.q.status === "draft" && f.st.released.length === 1,
      "send fake: a row render failure stamps the bidder, marks nothing, releases the claim");
    const g = fakes({}, { renderBidderPdf: async () => ({ ok: false, error: err, scope: "quote" }) });
    const rg = await sendBidderEmail(g.deps, SAM, "Q-P3S", PID, input());
    ok(!rg.ok && rg.scope === "quote" && !g.calls.includes("markBidderFailed") && g.st.q.status === "draft", "send fake: an unavailable renderer is a quote failure, no stamp");
  }
  // 9. Approval gate.
  {
    const f = fakes({}, { sendQuote: async () => ({ ok: false, error: "Needs approval first." }) });
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    ok(!r.ok && r.scope === "quote" && r.error === "Needs approval first." && !f.st.threads.length && !f.st.records.length && !f.st.failed.length, "send fake: the approval gate refuses — no email, no stamp");
  }
  // 10. The email throws after mark sent.
  {
    const f = fakes({}, { createAndSendThread: async () => { throw new EstimateEmailError(SEND_COPY.notSent, "C-DRAFT"); } });
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    ok(!r.ok && r.scope === "row" && r.markedSent === true && r.error === SEND_COPY.notSent && f.st.failed[0]?.error === SEND_COPY.notSent && f.st.failed[0]?.threadId === "C-DRAFT" && !f.st.records.length,
      "send fake: a throw after mark sent stamps the bidder (with the leftover thread), markedSent carried");
  }
  // 11. Gmail refused / unknown.
  {
    const f = fakes({}, { createAndSendThread: async () => ({ threadId: "C-F", delivery: "failed" as const }) });
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    const o = f.st.records[0]?.outcome;
    ok(!r.ok && r.scope === "row" && f.calls.includes("recordBidderSend:failed") && o?.kind === "failed" && o.error === SEND_COPY.gmailFailedResend && !o.unknown && f.st.records[0]?.entry.threadId === "C-F",
      "send fake: Gmail refused — recorded failed on the row");
    const u = fakes({}, { createAndSendThread: async () => ({ threadId: "C-U", delivery: "unknown" as const }) });
    const ru = await sendBidderEmail(u.deps, SAM, "Q-P3S", PID, input());
    const ou = u.st.records[0]?.outcome;
    ok(!ru.ok && ru.scope === "row" && ru.error === SEND_COPY.gmailUnknownResend && ou?.kind === "failed" && ou.error === SEND_COPY.gmailUnknownResend && ou.unknown === true,
      "send fake: Gmail didn't answer — recorded unknown, never resent blind");
  }
  // 12. Revision guard.
  {
    const f = fakes(sentRev2, {}, target({ revSent: 1 }));
    f.deps.renderBidderPdf = async (_q, _p, rev) => {
      f.calls.push("renderBidderPdf:" + (rev ?? "live"));
      f.st.q = { ...f.st.q, revisions: [...(f.st.q.revisions || []), { rev: 3, at: NOW, by: "Portal", reason: "sent" }] } as Quote;
      return { ok: true, pdf: Buffer.from("%PDF-bidder") };
    };
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input({ asOf: undefined }));
    ok(!r.ok && r.scope === "quote" && r.error === SEND_COPY.changedSince && !f.calls.includes("createAndSendThread") && !f.calls.includes("storeBidderPdf") && !f.calls.some((c) => c.startsWith("bidderLink")),
      "send fake: a sent revision cut during the render refuses — no link minted, nothing emailed");
  }
  // 13. Storage down.
  {
    const f = fakes({}, { storeBidderPdf: async () => null });
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    const a = f.st.threads[0]?.attachments[0];
    ok(r.ok && !!a && !!a.dataUrl?.startsWith("data:application/pdf;base64,") && a.pdfPath === undefined, "send fake: storage down — the bidder PDF rides inline");
    const g = fakes({}, { storeBidderPdf: async () => { throw new Error("blob"); } });
    const rg = await sendBidderEmail(g.deps, SAM, "Q-P3S", PID, input());
    ok(rg.ok && !!g.st.threads[0]?.attachments[0]?.dataUrl, "send fake: a storage throw counts as null");
  }
  // 14. Too large.
  {
    const f = fakes({}, { renderBidderPdf: async () => ({ ok: true, pdf: Buffer.alloc(15 * 1024 * 1024 + 1) }) });
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    ok(!r.ok && r.scope === "quote" && r.error === BID_SEND_COPY.tooLarge && !f.calls.includes("sendQuote") && f.st.q.status === "draft" && !f.st.failed.length, "send fake: over 15 MB — refused, nothing marked");
  }
  // 15. Record fails.
  {
    const f = fakes({}, { recordBidderSend: async () => false });
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    ok(r.ok && "warning" in r && r.warning === BID_SEND_COPY.recordFailed, "send fake: a failed record is a warning on an ok send");
    const g = fakes({}, { recordBidderSend: async () => { throw new Error("db"); } });
    const rg = await sendBidderEmail(g.deps, SAM, "Q-P3S", PID, input());
    ok(rg.ok && "warning" in rg && rg.warning === BID_SEND_COPY.recordFailed, "send fake: a thrown record is a warning too");
  }
  // 17. Malformed email is a row refusal: no claim, no stamp.
  {
    const f = fakes({}, {}, target({}, { email: "not an email" }));
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    ok(!r.ok && r.scope === "row" && r.error === BID_SEND_COPY.badEmail("Gee Ceeone") && !f.calls.includes("claimSend") && !f.calls.includes("markBidderFailed") && !f.st.failed.length,
      "send fake: a malformed bidder email is a row refusal — no claim, no stamp");
    const q = { status: "draft", revisions: [] };
    const rows = [{ id: "a", bid: newBidderState("email"), email: "nope" }, { id: "b", bid: newBidderState("email"), email: "ok@x.test" }];
    const plan = bidderSendPlan(q, rows);
    ok(bidderEmailNeed(q, rows[0]) === null && plan.ids.join() === "b" && plan.noEmail === 1, "send plan: a malformed email counts as no email, not planned");
  }
  // 18. A send that may have left Gmail is stamped unknown.
  {
    const f = fakes({}, { createAndSendThread: async () => { throw new EstimateEmailError(SEND_COPY.notSent, "C-SENT", false); } });
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    ok(!r.ok && r.scope === "row" && r.markedSent === true && f.st.failed[0]?.unknown === true && f.st.failed[0]?.error === SEND_COPY.gmailUnknownResend && f.st.failed[0]?.threadId === "C-SENT",
      "send fake: a thread no longer a draft after a throw is stamped unknown with its thread");
  }
  // 19. Record failure after Gmail accepted: the row ends unknown.
  {
    for (const label of ["false", "throw"]) {
      const f = fakes({}, { recordBidderSend: async () => { if (label === "throw") throw new Error("db"); return false; } });
      const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
      const s = f.st.failed[0];
      ok(r.ok && "warning" in r && r.warning === BID_SEND_COPY.recordFailed && s?.unknown === true && s.threadId === "C-9001" && s.error === BID_SEND_COPY.recordFailed,
        `send fake: a record that ${label === "throw" ? "threw" : "wrote nothing"} stamps the row unknown`);
    }
    const h = fakes({}, { recordBidderSend: async () => false, markBidderFailed: async () => { throw new Error("db"); } });
    const rh = await sendBidderEmail(h.deps, SAM, "Q-P3S", PID, input());
    ok(rh.ok && "warning" in rh, "send fake: a failing unknown-stamp is swallowed");
  }
  // 20. The recipient is the claim-time re-read's.
  {
    const f = fakes({}, {}, [target(), target({}, { email: "new@miron.test" })]);
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    ok(r.ok && f.st.threads[0]?.to === "new@miron.test" && f.st.records[0]?.entry.to === "new@miron.test", "send fake: the email goes to the address re-read under the claim");
  }
  // 21. A bidder removed between the claim and the link is a row refusal.
  {
    const f = fakes({}, { bidderLink: async () => { throw new EstimateEmailError(BID_SEND_COPY.gone); } });
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    ok(!r.ok && r.scope === "row" && r.error === BID_SEND_COPY.gone && r.markedSent === true && !f.st.threads.length, "send fake: a bidder gone at the link is a row refusal");
  }
  // 22. Inline fallback is capped.
  {
    const f = fakes({}, { storeBidderPdf: async () => null, renderBidderPdf: async () => ({ ok: true, pdf: Buffer.alloc(4 * 1024 * 1024 + 1) }) });
    const r = await sendBidderEmail(f.deps, SAM, "Q-P3S", PID, input());
    ok(!r.ok && r.scope === "quote" && r.error === BID_SEND_COPY.tooLarge && !f.st.threads.length, "send fake: storage down and over 4 MB — refused, not inlined");
    const g = fakes({}, { storeBidderPdf: async () => null, renderBidderPdf: async () => ({ ok: true, pdf: Buffer.alloc(4 * 1024 * 1024) }) });
    const rg = await sendBidderEmail(g.deps, SAM, "Q-P3S", PID, input());
    ok(rg.ok && !!g.st.threads[0]?.attachments[0]?.dataUrl, "send fake: storage down and exactly 4 MB — still inline");
  }
  // 16. The customer path is untouched: same fakes, the #P3 order.
  {
    const f = fakes();
    const r = await sendEstimateEmail(f.deps, SAM, "Q-P3S", { to: "pat@school.org", cc: "", subject: "S", body: "B {link}", attachEstimate: true, attachCover: true, followUpDays: 0, asOf: 77 });
    ok(r.ok && f.calls.join(" > ") === "claimSend > applySignature > readPdf:quote-pdfs/Q-P3S/cur.pdf > renderCoverPdf > sendQuote > ensureLink > storeCover > createAndSendThread > recordEmail > releaseSend",
      "send fake: the customer send keeps its own order (ensureLink, no bidder deps)");
  }
}

/** #348 Jeff's 2026-10-15 bid follow-ups (decisions 2 and 3) — pure: per-responder response caps + buckets, and the
 *  addendum → Draft rule. */
export async function bidFollowupChecks(ok: Ok) {
  const PA = "pty_aaaaaaaaaaaaaaaa", PB = "pty_bbbbbbbbbbbbbbbb";
  const resp = (i: number, partyId?: string): ClientResponse => ({
    id: `CR-${String(i).padStart(12, "0")}`, kind: "question", rev: 1, at: T1 + i, name: "N", email: "", message: "m", sectionIds: [], sectionNames: [], total: 0, ...(partyId ? { partyId } : {}),
  });
  const ownerFull = Array.from({ length: MAX_CLIENT_RESPONSES }, (_, i) => resp(i));
  ok(appendResponseTo(ownerFull, resp(9001)) === null, "followup: the owner's 201st response is refused (the 200 cap holds for the owner)");
  ok(appendResponseTo(ownerFull, resp(9002, PA))?.length === MAX_CLIENT_RESPONSES + 1, "followup: a bidder still has room when the owner's 200 are used");
  const aFull = Array.from({ length: MAX_CLIENT_RESPONSES }, (_, i) => resp(i, PA));
  ok(appendResponseTo(aFull, resp(9003, PA)) === null, "followup: a bidder's 201st response is refused");
  ok(appendResponseTo(aFull, resp(9004, PB))?.length === MAX_CLIENT_RESPONSES + 1 && appendResponseTo(aFull, resp(9005))?.length === MAX_CLIENT_RESPONSES + 1,
    "followup: one bidder's full cap never blocks another bidder or the owner");
  const mixed = [...aFull.slice(0, 3), resp(500), resp(501, PB)];
  ok(responsesBy(mixed, PA) === 3 && responsesBy(mixed) === 1 && responsesBy(mixed, "") === 1 && responsesBy(mixed, PB) === 1 && responsesBy("junk", PA) === 0, "followup: responsesBy counts one responder (owner = no partyId)");
  ok(responseQuoteBucket("Q-1") === "share-respond-quote:Q-1" && responseQuoteBucket("Q-1", null) === "share-respond-quote:Q-1" && responseQuoteBucket("Q-1", PA) === `share-respond-quote:Q-1:${PA}`,
    "followup: the owner keeps the quote-wide bucket; each bidder has its own");
  const srv = readFileSync(join(process.cwd(), "src/lib/estimate-output/responses-server.ts"), "utf8");
  ok(srv.includes("rateLimit(responseQuoteBucket(hit.q.id, bidder?.partyId), RESPONSE_QUOTE_LIMIT, RESPONSE_QUOTE_WINDOW_MS)") && !srv.includes("`share-respond-quote:${hit.q.id}`"),
    "followup: submitClientResponse spends the responder's own bucket (source pin)");

  const A = (no: number, note = "") => ({ no, receivedAt: T1, note });
  ok(addedAddendumNos([A(1)], [A(1), A(3), A(2)]).join() === "2,3", "followup: added addenda = new numbers, ascending");
  ok(addedAddendumNos([A(1, "x"), A(2)], [A(1, "y")]).length === 0 && addedAddendumNos([A(1)], [A(1)]).length === 0 && addedAddendumNos(null, []).length === 0,
    "followup: a note edit or a removal adds nothing");
  ok(addedAddendumNos(undefined, [A(1)]).join() === "1", "followup: the first addendum on a bid with none counts");
  ok(addendumMovesToDraft("sent", [2]) && !addendumMovesToDraft("sent", []) && !addendumMovesToDraft("draft", [2]) && !addendumMovesToDraft("won", [2]),
    "followup: only a sent estimate with an added addendum moves to Draft");
  ok(addendumDraftNote([2]) === "Addendum 2 added — the estimate is back in Draft. Send revision to all bidders when it's ready. The customer's and bidders' links show it as being revised until then." && addendumDraftNote([2, 3]).startsWith("Addenda 2, 3 added"),
    "followup: the Bid chip note");
  const chip = readFileSync(join(process.cwd(), "src/app/(app)/estimator/bid-chip.tsx"), "utf8");
  ok(chip.includes('postChanged("quote", quoteId)') && chip.indexOf('postChanged("quote", quoteId)') > chip.indexOf("onSync?.(r.sync)"), "followup: a status sync posts the LiveSync change so other windows refresh");
  const bidsStore = readFileSync(join(process.cwd(), "src/lib/stores/bids.ts"), "utf8");
  ok(bidsStore.includes("statusMoveFailed = true") && bidsStore.includes("if (statusMoveFailed) return") && bidsStore.includes("Couldn't save the bid details — try again."), "followup: only a failed status move reports the status message; other failures are neutral");
  ok(chip.includes("setNotice(r.note)") && chip.includes("onSync?.(r.sync)") && chip.includes('source: "chip"'), "followup: the Bid chip shows the note, syncs the header and tells the Bidders card");
}

const H_FIX = { own: fixtureId(348, "hown"), gc1: fixtureId(348, "hgc1"), gc2: fixtureId(348, "hgc2"), ct1: fixtureId(348, "hct1"), ct2: fixtureId(348, "hct2") };
async function dropFollowupIdentityFixtures() {
  const db = await getDb();
  await db.delete(contactEmails).where(like(contactEmails.contactId, "TEST348:h%"));
  await db.delete(contactsTable).where(like(contactsTable.id, "TEST348:h%"));
  await db.delete(companies).where(like(companies.id, "TEST348:h%"));
}

/** #348 Jeff's 2026-10-15 bid follow-ups — DB: per-bidder response buckets, and an addendum after a send → Draft. */
export async function bidFollowupDbChecks(ok: Ok) {
  const { own, gc1, gc2, ct1, ct2 } = H_FIX;
  const hq = fixtureId(348, "hq");
  const SEC = "h-s3cret";
  const regAll = async () => { for (const p of await listFor("quote", hq)) registerFixture("record_parties", p.id); };
  try {
    await dropFollowupIdentityFixtures();
    await saveCompany({ id: own, name: "Follow Owner", type: "customer", lifecycle: "active", deleted: false });
    await saveCompany({ id: gc1, name: "Follow GC One", type: "customer", lifecycle: "active", deleted: false });
    await saveCompany({ id: gc2, name: "Follow GC Two", type: "customer", lifecycle: "active", deleted: false });
    await saveContact({ id: ct1, firstName: "Hal", lastName: "One", homeCompanyId: gc1 });
    await setEmails(ct1, [{ value: "hal@h.test", label: "work", isPrimary: true }] as never);
    await saveContact({ id: ct2, firstName: "Hue", lastName: "Two", homeCompanyId: gc2 });
    await setEmails(ct2, [{ value: "hue@h.test", label: "work", isPrimary: true }] as never);
    const NOW = Date.now();
    await createFixture("quotes", buildQuote(hq, { name: "Follow quote", customer: "Follow Owner", customerId: own, value: 1000 } as never, "system", null, NOW) as never);
    const b1 = await addBidder({ quoteId: hq, companyId: gc1, contactId: ct1, role: "gc" }, "u");
    const b2 = await addBidder({ quoteId: hq, companyId: gc2, contactId: ct2, role: "gc" }, "u");
    await regAll();
    if (!b1.ok || !b2.ok) throw new Error("follow-up bidders missing");
    const p1 = b1.party.id, p2 = b2.party.id;
    const T = Date.UTC(2026, 9, 20, 17, 0);
    const d1 = await setBidDetails(hq, { addenda: [{ no: 1, receivedAt: T, note: "first" }] }, "Test");
    ok(d1.ok && !d1.backToDraft && (await getQuote(hq))?.status === "draft", "followup db: an addendum on a draft stays draft, no note");
    await setStatus(hq, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" });
    for (const [pid, to] of [[p1, "hal@h.test"], [p2, "hue@h.test"]] as const) await recordBidderSend(hq, pid, { threadId: `C-h-${pid}`, rev: 1, at: T, by: "Test", to }, { kind: "sent" }, "u1");

    // 1. Each bidder has its own response bucket; the owner's v2 keeps the quote-wide one.
    const ens = await ensureShareLink(hq, "Test", { secret: SEC });
    const l1 = await bidderLinkPath(hq, p1, "Test", { secret: SEC }), l2 = await bidderLinkPath(hq, p2, "Test", { secret: SEC });
    const tok1 = l1.ok ? l1.path.split("/").pop()! : "", tok2 = l2.ok ? l2.path.split("/").pop()! : "";
    const tokOwner = ens.ok && ens.link.pathV2 ? ens.link.pathV2.split("/").pop()! : "";
    const deps = { secret: SEC, users: async () => [], notify: async () => {} };
    let spent = 0;
    for (let i = 0; i < RESPONSE_QUOTE_LIMIT; i++) {
      const r = await submitClientResponse("question", hq, tok1, { name: "Hal", message: `q${i}` }, `192.0.2.${i + 1}`, deps);
      if (r.ok) spent++;
    }
    const over1 = await submitClientResponse("question", hq, tok1, { name: "Hal", message: "one more" }, "192.0.2.101", deps);
    const from2 = await submitClientResponse("question", hq, tok2, { name: "Hue", message: "mine" }, "192.0.2.102", deps);
    const fromOwner = await submitClientResponse("question", hq, tokOwner, { name: "Pat", message: "owner" }, "192.0.2.103", deps);
    const stored = (await getQuote(hq))?.clientResponses ?? [];
    ok(spent === RESPONSE_QUOTE_LIMIT && !over1.ok && over1.error === CLIENT_ACTION_COPY.tooMany, "followup db: a bidder's own daily limit stops it");
    ok(from2.ok && fromOwner.ok && responsesBy(stored, p2) === 1 && responsesBy(stored) === 1 && responsesBy(stored, p1) === RESPONSE_QUOTE_LIMIT,
      "followup db: one bidder's spent limit never blocks another bidder or the owner");

    // 2. An addendum after a send puts the estimate back to Draft; Send revision then goes to every pending bidder.
    const before = await getQuote(hq);
    const d2 = await setBidDetails(hq, { addenda: [{ no: 1, receivedAt: T, note: "first" }, { no: 2, receivedAt: T + 86_400_000, note: "second" }] }, "Test");
    const after = await getQuote(hq);
    const last = after?.history?.at(-1);
    ok(before?.status === "sent" && d2.ok && d2.backToDraft?.join() === "2" && after?.status === "draft" && last?.from === "sent" && last.to === "draft",
      "followup db: Addendum 2 on a sent estimate → Draft through setStatus (history stamped)");
    const pan = await loadBidPanel(hq, { canEdit: true, canSend: true, canLink: true });
    ok(pan.ok && [...pan.panel.plan.ids].sort().join() === [p1, p2].sort().join() && pan.panel.plan.label === "Send revision to all bidders" && pan.panel.addendaAfterSend.length === 0,
      "followup db: the Bidders plan lists both sent bidders with \"Send revision to all bidders\" (#352), and no fallback hint on the draft");

    // Back to sent: a note edit, a removal and a due-date change never change status.
    await setStatus(hq, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" });
    const n1 = await setBidDetails(hq, { addenda: [{ no: 1, receivedAt: T, note: "first" }, { no: 2, receivedAt: T + 86_400_000, note: "second, edited" }] }, "Test");
    const s1 = (await getQuote(hq))?.status;
    const n2 = await setBidDetails(hq, { addenda: [{ no: 2, receivedAt: T + 86_400_000, note: "second, edited" }] }, "Test");
    const s2 = (await getQuote(hq))?.status;
    const n3 = await setBidDetails(hq, { dueAt: T + 7 * 86_400_000 }, "Test");
    const s3 = (await getQuote(hq))?.status;
    ok(n1.ok && !n1.backToDraft && s1 === "sent" && n2.ok && !n2.backToDraft && s2 === "sent" && n3.ok && !n3.backToDraft && s3 === "sent",
      "followup db: a note edit, a removal and a due-date change keep the estimate sent");
    // Re-adding a number removed after the send counts as added (it isn't on the stored list).
    const n4 = await setBidDetails(hq, { addenda: [{ no: 1, receivedAt: T, note: "back" }, { no: 2, receivedAt: T + 86_400_000, note: "second, edited" }] }, "Test");
    ok(n4.ok && n4.backToDraft?.join() === "1" && (await getQuote(hq))?.status === "draft", "followup db: re-adding a removed addendum on a sent estimate moves it to Draft too");
    await setStatus(hq, "lost", "Test");
    const closed = await setBidDetails(hq, { addenda: [{ no: 3, receivedAt: T, note: "" }] }, "Test");
    ok(!closed.ok && closed.error === "This estimate is closed." && (await getQuote(hq))?.status === "lost", "followup db: a lost estimate's bid details are still refused");
  } finally {
    try { await regAll(); } catch {}
    await dropFixtures(348);
    await dropFollowupIdentityFixtures();
  }
}

/** #348 slice 6 task 1 — the portal's pure bidder rule and its composition into portalOnlineEstimateState. */
export function portalBidPureChecks(ok: Ok) {
  const T = Date.UTC(2026, 9, 20, 22, 0);
  const rev = (n: number, reason: "sent" | "manual", extra: Record<string, unknown> = {}) =>
    ({ rev: n, at: 1_000 * n, by: "u1", reason, note: "", name: `Rev${n}`, value: 0, margin: 0, status: "sent", ...extra }) as unknown as import("../src/lib/stores/quotes").QuoteRevision;
  const mk = (over: Record<string, unknown> = {}, revs?: unknown[]) =>
    ({
      id: "Q-1", name: "Gym", customerId: "OWNER", status: "sent", source: "estimator", quoteType: "system",
      bid: { dueAt: T, addenda: [], awardedPartyId: null },
      revisions: revs ?? [rev(1, "sent"), rev(2, "manual"), rev(3, "sent")],
      ...over,
    }) as unknown as Quote;
  const row = (id: string, companyId: string, role: "gc" | "ec", bid: Record<string, unknown> | null, over: Record<string, unknown> = {}): PortalBidRow =>
    ({ id, recordType: "quote", recordId: "Q-1", companyId, role, bid: bid === null ? null : ({ result: "pending", submitVia: "email", revSent: 1, ...bid }) as never, ...over }) as PortalBidRow;
  const A = row("A", "CA", "gc", {});
  const B = row("B", "CB", "gc", {});
  const E = row("E", "CA", "ec", { revSent: 3 });
  const st = (q: Quote, cid: string, rows: PortalBidRow[]) => portalBidState(q, cid, rows);

  // Delivered copy.
  let s = st(mk(), "CA", [A]);
  ok(s.kind === "ok" && s.bid.rev.rev === 1 && s.bid.via === "sent" && !s.closed && s.bid.partyId === "A" && s.bid.role === "gc", "portal-bid: a sent bid shows its delivered revision");
  ok(st(mk(), "CA", [row("A", "CA", "gc", { revSent: 2 })]).kind === "unavailable", "portal-bid: revSent at a manual revision is unavailable");
  ok(st(mk(), "CA", [row("A", "CA", "gc", { revSent: null })]).kind === "unavailable", "portal-bid: revSent null is unavailable");
  ok(st(mk(), "CA", [row("A", "CA", "gc", { revSent: 1.5 })]).kind === "unavailable", "portal-bid: a non-integer revSent is unavailable");
  ok(st(mk(), "CA", [row("A", "CA", "gc", { revSent: 999 })]).kind === "unavailable", "portal-bid: an unknown revSent is unavailable");
  ok(st(mk(), "CA", [row("A", "CA", "gc", null)]).kind === "unavailable", "portal-bid: a row without bid state is unavailable");
  ok(portalBidCandidates(mk(), row("A", "CA", "gc", { revSent: null })).length === 0, "portal-bid: no candidates without a delivered revision or a frozen one");
  // #348 slice 6 task 2 — the PDF source carries the chosen revision's frozen name, never the live q.name.
  {
    const src = portalBidPdfSource(mk({ name: "Renamed live" }), "CA", [A]);
    ok(src?.rev === 1 && src.name === "Rev1", "portal-bid: portalBidPdfSource names the chosen revision's frozen name when q.name differs");
  }
  // #348 slice 6 task 2 — a row with no id never matches a revision frozen without an award (undefined === undefined).
  {
    const df = { docFields: { customer: "Owner" } };
    const qNoAward = mk({}, [rev(1, "sent", df), rev(2, "sent", df)]);
    for (const id of [undefined, ""]) {
      const r = row("x", "CA", "gc", { revSent: null }, { id });
      ok(portalBidCandidates(qNoAward, r).length === 0 && st(qNoAward, "CA", [r]).kind === "unavailable",
        `portal-bid: a row with id ${JSON.stringify(id)} has no award candidates and is unavailable`);
    }
    const rSent = row("x", "CA", "gc", { revSent: 1 }, { id: undefined });
    ok(st(qNoAward, "CA", [rSent]).kind === "unavailable", "portal-bid: a row without an id is skipped even with a delivered revision");
  }
  // Never a later unsent revision.
  ok(s.kind === "ok" && s.bid.rev.rev !== 3, "portal-bid: never a later revision sent to others");
  // Excluded results.
  for (const r of ["withdrew", "no_bid", "lost"]) ok(st(mk(), "CA", [row("A", "CA", "gc", { result: r })]).kind === "unavailable", `portal-bid: result ${r} is unavailable`);
  // Award.
  const r4 = rev(4, "sent", { docFields: { awardedPartyId: "A", bid: { dueAt: T + 1, addenda: [], awardedPartyId: "A" } } });
  const awarded = mk({ bid: { dueAt: T, addenda: [], awardedPartyId: "A" } }, [rev(1, "sent"), rev(2, "manual"), rev(3, "sent"), r4]);
  ok(st(awarded, "CB", [B]).kind === "unavailable", "portal-bid: a stale pending row on an awarded bid is unavailable");
  s = st(awarded, "CA", [row("A", "CA", "gc", { result: "awarded" })]);
  ok(s.kind === "ok" && s.bid.rev.rev === 4 && s.bid.via === "award" && s.bid.result === "awarded" && s.bid.dueAt === T + 1, "portal-bid: the awarded bidder sees the revision frozen to it, with that revision's due date");
  // An award candidate counts on its own: no delivered copy needed.
  s = st(awarded, "CA", [row("A", "CA", "gc", { result: "awarded", revSent: null })]);
  ok(s.kind === "ok" && s.bid.rev.rev === 4 && s.bid.via === "award", "portal-bid: an awarded row with revSent null sees the revision frozen to it");
  ok(st(mk(), "CA", [row("A", "CA", "gc", { revSent: null })]).kind === "unavailable", "portal-bid: a pending row with revSent null and nothing frozen to it is unavailable");
  ok(st(awarded, "CB", [row("B", "CB", "gc", { revSent: null })]).kind === "unavailable", "portal-bid: a pending row with revSent null on a quote awarded to someone else is unavailable");
  s = st(awarded, "CA", [row("A", "CA", "gc", { revSent: 999, result: "awarded" })]);
  ok(s.kind === "ok" && s.bid.rev.rev === 4 && s.bid.via === "award", "portal-bid: a bad revSent still leaves the award candidate");
  // After Undo award the revision frozen to A stays A's candidate (it is addressed to A).
  const undone = mk({}, [rev(1, "sent"), rev(2, "manual"), rev(3, "sent"), r4]);
  s = st(undone, "CA", [row("A", "CA", "gc", { result: "pending", revSent: 1 })]);
  ok(s.kind === "ok" && s.bid.rev.rev === 4 && s.bid.via === "award" && s.bid.result === "pending", "portal-bid: after Undo award, a revision frozen to the bidder stays its candidate");
  const toB = mk({ bid: { dueAt: T, addenda: [], awardedPartyId: "A" } }, [rev(1, "sent"), rev(4, "sent", { docFields: { awardedPartyId: "B" } })]);
  ok(portalBidCandidates(toB, A).length === 1 && portalBidCandidates(toB, A)[0].rev.rev === 1, "portal-bid: a revision frozen to another bidder is never A's candidate");
  // Status.
  ok(st(mk({ status: "draft" }), "CA", [A]).kind === "revising", "portal-bid: draft is revising");
  ok(st(mk({ status: "draft" }), "CB", [A]).kind === "unavailable", "portal-bid: draft with no row for the company is unavailable");
  ok(st(mk({ status: "won", bid: { dueAt: T, addenda: [], awardedPartyId: "A" } }), "CA", [row("A", "CA", "gc", { result: "awarded" })]).kind === "ok", "portal-bid: won with the awarded row is ok");
  ok(st(mk({ status: "won" }), "CA", [A]).kind === "unavailable", "portal-bid: won with a pending row and no award is unavailable");
  s = st(mk({ status: "lost" }), "CA", [A]);
  ok(s.kind === "ok" && s.closed, "portal-bid: lost with a pending row is ok and closed");
  ok(st(mk({ status: "weird" }), "CA", [A]).kind === "unavailable", "portal-bid: an unknown status is unavailable");
  // Other companies, records, customers.
  ok(st(mk(), "CZ", [A]).kind === "unavailable", "portal-bid: another company is unavailable");
  ok(st(mk(), "CA", [row("A", "CA", "gc", {}, { recordId: "Q-2" })]).kind === "unavailable", "portal-bid: a row on another quote is ignored");
  ok(st(mk(), "CA", [row("A", "CA", "gc", {}, { recordType: "lead" })]).kind === "unavailable", "portal-bid: a lead row is ignored");
  ok(st(mk(), "CA", [row("A", "CA", "other" as never, {})]).kind === "unavailable", "portal-bid: only gc / ec rows count");
  ok(st(mk(), "", [A]).kind === "unavailable", "portal-bid: an empty company id is unavailable");
  const ownerRow = row("O", "OWNER", "gc", {});
  for (const status of ["sent", "draft", "won", "lost"]) {
    const q = mk({ status });
    ok(st(q, "OWNER", [ownerRow]).kind === "unavailable", `portal-bid: the customer never goes through the bidder rule (${status})`);
    ok(JSON.stringify(portalOnlineEstimateState(q, "OWNER", [ownerRow])) === JSON.stringify(portalOnlineEstimateState(q, "OWNER")), `portal-bid: the customer's answer ignores bidder rows (${status})`);
  }
  // The customer answer is the unchanged two-arg rule.
  {
    const q = mk();
    const c = portalOnlineEstimateState(q, "OWNER");
    ok(c.kind === "ok" && c.rev.rev === 3 && !("bidder" in c), "portal-bid: the customer still sees the latest sent revision with no bidder field");
    ok(portalOnlineEstimateState(mk({ status: "draft" }), "OWNER").kind === "revising", "portal-bid: customer draft stays revising");
    ok(portalOnlineEstimateState(mk({ status: "lost" }), "OWNER").kind === "ok", "portal-bid: customer lost stays ok/closed");
  }
  // Composition into the portal gate.
  {
    const g = portalOnlineEstimateState(mk(), "CA", [A]);
    ok(g.kind === "ok" && g.rev.rev === 1 && g.closed === false && g.bidder?.partyId === "A", "portal-bid: the gate returns the bidder's revision with the bidder field");
    ok(portalOnlineEstimateState(mk(), "CA").kind === "unavailable", "portal-bid: no rows fails closed");
    ok(portalOnlineEstimateState(mk({ source: "daylite" }), "CA", [A]).kind === "unavailable", "portal-bid: Daylite history is unavailable");
    ok(portalOnlineEstimateState(mk({ quoteType: "flame_test" }), "CA", [A]).kind === "unavailable", "portal-bid: a flame-test quote is unavailable");
    ok(portalOnlineEstimateState(mk({ status: "draft" }), "CA", [A]).kind === "revising", "portal-bid: the gate says revising for a bidder on a draft");
  }
  // Row choice.
  s = st(mk(), "CA", [A, E]);
  ok(s.kind === "ok" && s.bid.partyId === "E" && s.bid.rev.rev === 3, "portal-bid: the latest delivered revision wins between GC and EC rows");
  s = st(mk(), "CA", [A, row("E", "CA", "ec", { revSent: 1 })]);
  ok(s.kind === "ok" && s.bid.partyId === "A", "portal-bid: equal revisions prefer the GC row");
  s = st(mk(), "CA", [row("E", "CA", "ec", { revSent: 1 }), A]);
  ok(s.kind === "ok" && s.bid.partyId === "A", "portal-bid: the GC preference does not depend on row order");
  const awardedE = mk({ bid: { dueAt: T, addenda: [], awardedPartyId: "E" } });
  s = st(awardedE, "CA", [A, row("E", "CA", "ec", { revSent: 3, result: "awarded" })]);
  ok(s.kind === "ok" && s.bid.partyId === "E" && s.bid.result === "awarded", "portal-bid: an awarded row beats a pending one");
  s = st(mk({ bid: { dueAt: T, addenda: [], awardedPartyId: "A" } }), "CA", [row("A", "CA", "gc", { result: "awarded", revSent: 1 }), E]);
  ok(s.kind === "ok" && s.bid.partyId === "A" && s.bid.rev.rev === 1, "portal-bid: the awarded row beats a later pending revision on an awarded bid");
  // PDF source.
  {
    const p = portalBidPdfSource(mk(), "CA", [A]);
    ok(!!p && p.partyId === "A" && p.rev === 1, "portal-bid: the PDF source mirrors ok");
    const pc = portalBidPdfSource(mk({ status: "lost" }), "CA", [A]);
    ok(!!pc && pc.rev === 1, "portal-bid: the PDF source includes a closed bid");
    ok(portalBidPdfSource(mk({ status: "draft" }), "CA", [A]) === null, "portal-bid: no PDF while revising");
    ok(portalBidPdfSource(mk(), "CZ", [A]) === null, "portal-bid: no PDF for another company");
    ok(portalBidPdfSource(mk(), "OWNER", [ownerRow]) === null, "portal-bid: no bidder PDF for the customer");
  }
  // List.
  {
    const qa = mk({ id: "Q-1" }, [rev(1, "sent", { docFields: { issuedAt: 5_000 } })]);
    const qb = mk({ id: "Q-3", status: "lost" }, [rev(1, "sent", { docFields: { issuedAt: 9_000 } })]);
    const qd = mk({ id: "Q-4", status: "draft" }, [rev(1, "sent")]);
    const qo = mk({ id: "Q-5", customerId: "CA" }, [rev(1, "sent")]);
    const qw = mk({ id: "Q-6", status: "won", bid: { dueAt: null, addenda: [], awardedPartyId: "A6" } }, [rev(1, "sent", { docFields: { issuedAt: 7_000 } })]);
    const rows = [A, row("A3", "CA", "gc", {}, { recordId: "Q-3" }), row("A4", "CA", "gc", {}, { recordId: "Q-4" }), row("A5", "CA", "gc", {}, { recordId: "Q-5" }), row("A6", "CA", "gc", { result: "awarded" }, { recordId: "Q-6" })];
    const l = portalBidList([qa, qb, qd, qo, qw], "CA", rows);
    ok(l.open.map((x) => x.q.id).join() === "Q-1", "portal-bid: the list's open group is the sent bids");
    ok(l.history.map((x) => x.q.id).join() === "Q-3,Q-6", "portal-bid: history is won / lost, newest sent first, no drafts, no own quotes");
  }
  // Chips and copy.
  {
    const base = { partyId: "A", role: "gc" as const, rev: rev(1, "sent"), via: "sent" as const };
    ok(portalBidChip("sent", { ...base, result: "pending", dueAt: T }) === PORTAL_BID_COPY.due(bidDueText(T)) && bidDueText(T) !== "", "portal-bid: the pending chip is the due text");
    ok(portalBidChip("sent", { ...base, result: "pending", dueAt: null }) === "Bid submitted", "portal-bid: no due date reads Bid submitted");
    ok(portalBidChip("sent", { ...base, result: "awarded", dueAt: T }) === "Awarded" && portalBidChip("won", { ...base, result: "awarded", dueAt: T }) === "Awarded", "portal-bid: awarded chip");
    ok(portalBidChip("lost", { ...base, result: "pending", dueAt: T }) === "Closed", "portal-bid: lost reads Closed");
    ok(!/lost|other bidder/i.test(JSON.stringify(PORTAL_BID_COPY)) && !/lost|other bidder/i.test(PORTAL_BID_COPY.cardSub("X")) && !/lost|other bidder/i.test(PORTAL_BID_COPY.due("X")), "portal-bid: the copy never says lost or other bidder (function strings included)");
  }
  // Due date.
  {
    const q = mk();
    ok(portalBidDueAt(q, rev(4, "sent", { docFields: { bid: { dueAt: T + 5, addenda: [], awardedPartyId: null } } })) === T + 5, "portal-bid: the frozen bid's due date wins over the live one");
    ok(portalBidDueAt(q, rev(1, "sent")) === T, "portal-bid: a revision without a bid reads the live due date");
    ok(portalBidDueAt(q, rev(4, "sent", { docFields: { bid: { dueAt: null, addenda: [], awardedPartyId: null } } })) === null, "portal-bid: a frozen null due date stays null");
  }
  // #348 slice 6 Task 3 (Jeff 2026-10-15) — the owner's portal on a bid estimate: BOM only, no prices.
  {
    // "Has bidders": any GC/EC row on this quote with bid state, whatever its result.
    for (const r of ["pending", "awarded", "withdrew", "no_bid", "lost"]) {
      ok(quoteHasBidders("Q-1", [row("A", "CA", "gc", { result: r })]) && quoteHasBidders("Q-1", [row("E", "CA", "ec", { result: r })]), `owner-bom: a gc / ec row with bid state counts (${r})`);
    }
    for (const role of ["owner", "architect", "vendor", "engineer"]) {
      ok(!quoteHasBidders("Q-1", [row("O", "CA", role as never, {})]), `owner-bom: a ${role} row never counts`);
    }
    ok(!quoteHasBidders("Q-1", [row("A", "CA", "gc", null)]), "owner-bom: a gc row with bid: null does not count");
    ok(!quoteHasBidders("Q-1", [row("A", "CA", "gc", {}, { recordId: "Q-2" })]), "owner-bom: another quote's row does not count");
    ok(!quoteHasBidders("Q-1", [row("A", "CA", "gc", {}, { recordType: "lead" })]), "owner-bom: a lead's row does not count");
    ok(!quoteHasBidders("Q-1", []) && !quoteHasBidders("", [A]), "owner-bom: no rows / no quote id → false");
    ok(quoteHasBidders("Q-1", [row("O", "OWNER", "owner" as never, {}), row("A", "CA", "gc", { result: "withdrew" })]), "owner-bom: one bidder among other parties is enough");

    // The owner's state: bomOnly on ok, the revision unchanged; nothing else moves.
    const o = portalOnlineEstimateState(mk(), "OWNER", [], { hasBidders: true });
    ok(o.kind === "ok" && o.bomOnly === true && o.rev.rev === 3 && !o.closed && !("bidder" in o), "owner-bom: the owner with bidders gets ok + bomOnly on the latest sent revision");
    for (const status of ["sent", "draft", "won", "lost"]) {
      const q = mk({ status });
      const today = JSON.stringify(portalOnlineEstimateState(q, "OWNER"));
      ok(JSON.stringify(portalOnlineEstimateState(q, "OWNER", [], { hasBidders: false })) === today && JSON.stringify(portalOnlineEstimateState(q, "OWNER", [], {})) === today,
        `owner-bom: without bidders the owner's answer deep-equals today's (${status})`);
      const b = portalOnlineEstimateState(q, "OWNER", [], { hasBidders: true });
      const t = JSON.parse(today);
      ok(t.kind === "ok" ? b.kind === "ok" && b.bomOnly === true && JSON.stringify({ ...b, bomOnly: undefined }) === JSON.stringify({ ...t, bomOnly: undefined }) : JSON.stringify(b) === today,
        `owner-bom: with bidders only bomOnly is added, revising / unavailable unchanged (${status})`);
    }
    ok(portalOnlineEstimateState(mk({ status: "lost" }), "OWNER", [], { hasBidders: true }).kind === "ok" &&
       (portalOnlineEstimateState(mk({ status: "lost" }), "OWNER", [], { hasBidders: true }) as { closed: boolean }).closed === true, "owner-bom: a lost bid estimate is bomOnly and closed");
    ok(portalOnlineEstimateState(mk({ status: "draft" }), "OWNER", [], { hasBidders: true }).kind === "revising", "owner-bom: a recalled bid estimate is still the being-revised card");
    ok(JSON.stringify(portalOnlineEstimateState(mk(), "CA", [A], { hasBidders: true })) === JSON.stringify(portalOnlineEstimateState(mk(), "CA", [A])), "owner-bom: a bidder company's answer ignores hasBidders");
    ok(portalOnlineEstimateState(mk({ source: "daylite" }), "OWNER", [], { hasBidders: true }).kind === "unavailable", "owner-bom: Daylite history stays unavailable");

    // The PDF source refuses the owner of a bid estimate.
    const withPdf = mk({}, [rev(1, "sent", { pdfBlobPath: "quote-pdfs/q1-r1.pdf" }), rev(2, "manual"), rev(3, "sent", { pdfBlobPath: "quote-pdfs/q1-r3.pdf" })]);
    ok(portalQuotePdfSource(withPdf, "OWNER")?.path === "quote-pdfs/q1-r3.pdf" && portalQuotePdfSource(withPdf, "OWNER", { hasBidders: false })?.path === "quote-pdfs/q1-r3.pdf",
      "owner-bom: without bidders the owner's PDF source is today's");
    ok(portalQuotePdfSource(withPdf, "OWNER", { hasBidders: true }) === null, "owner-bom: with bidders the owner has no PDF source");

    // The pure BOM: printed systems only, PackageBomRow keys only, no money anywhere.
    const KEYS = "description,key,manufacturer,part,qty,unit";
    const item = (id: number, over: Record<string, unknown> = {}) => ({ id, sku: "", desc: `Item ${id}`, qty: 2, unit: "ea", cost: 1234.5, price: 5678.25, ...over });
    const spec = {
      groups: [{ id: "g-alt", name: "Alt", alternate: true }],
      sections: [
        { id: "s1", name: "Rigging", kind: "materials", mfr: "", freightPct: 0, items: [item(1, { manufacturer: "Acme", manufacturerModelNumber: "AX-1" }), item(2, { option: true, price: 99991 })] },
        { id: "s2", name: "Empty", kind: "materials", mfr: "", freightPct: 0, items: [] },
        { id: "s3", name: "Labor", kind: "labor", mfr: "", freightPct: 0, items: [item(3, { labor: true, price: 4321 })] },
        { id: "s4", name: "Alternate one", kind: "materials", mfr: "", freightPct: 0, groupId: "g-alt", items: [item(4, { price: 8765 })] },
      ],
    };
    const r1 = rev(1, "sent", { spec, docFields: { customer: "Owner" } });
    const qb = mk({ name: "Live rename" }, [r1]);
    const bom = ownerBom(qb, r1, new Map([["X", { mfr: "Cat" }]]), " Owner Co ");
    const rows = bom.systems.flatMap((x) => x.rows);
    ok(bom.title === "Rev1" && bom.preparedFor === "Owner Co" && /Rev 1/.test(bom.headerLine) && bom.showQty === true, "owner-bom: the header is the revision's name, number · Rev · sent date and Prepared for");
    ok(bom.systems.map((x) => x.name).join() === "Rigging,Labor" && ownerBomSections(r1).length === 2, "owner-bom: one block per printed system (an empty system prints nothing, an Alternate is left out)");
    ok(rows.length >= 2 && rows.every((r) => Object.keys(r).sort().join() === KEYS), "owner-bom: every row has only the PackageBomRow fields");
    ok(rows[0].qty === 2 && rows[0].manufacturer === "Acme" && rows[0].part === "AX-1", "owner-bom: Qty · Manufacturer · Model come through");
    const json = JSON.stringify(bom);
    ok(!/1234|5678|99991|4321|8765|\$/.test(json) && !/price|cost|total|value/i.test(Object.keys(bom).join() + Object.keys(bom.systems[0]).join()), "owner-bom: no price, cost, option price or total anywhere in the model");
    const noQty = ownerBom(mk({ pdfOptions: { pdfQty: false } }, [r1]), r1, new Map(), "Owner");
    ok(noQty.showQty === false && noQty.systems.flatMap((x) => x.rows).every((r) => r.qty === null && r.unit === "" && Object.keys(r).sort().join() === KEYS), "owner-bom: Qty off → no quantities, same keys");
    const frozenQty = rev(1, "sent", { spec, docFields: { pdfOptions: { pdfQty: false } } });
    ok(ownerBom(mk({}, [frozenQty]), frozenQty, new Map(), "Owner").showQty === false, "owner-bom: the revision's frozen Qty choice wins over the live one");
    ok(ownerBom(mk(), rev(3, "sent"), new Map(), "Owner").systems.length === 0, "owner-bom: a revision with no spec has no systems");
  }
  // #348 slice 6 Task 4 — Home's Bids card and the read-only bid row.
  {
    const rd = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
    const codeOf = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const bidRow = rd("src/app/portal/bid-row.tsx"), bidCode = codeOf(bidRow);
    ok(!/["']use client["']/.test(bidRow), "bids-card: the bid row is a server component");
    ok(!/AcceptDialog|RefreshPricingButton|RenameQuote|copyQuoteToCart|Quote again|portalDecline/.test(bidCode), "bids-card: the bid row has no Accept, Refresh pricing, Rename, Copy, Quote again or decline note");
    ok(bidCode.includes("bid.rev.name") && bidCode.includes("bid.rev.value") && bidCode.includes("PORTAL_BID_COPY.badge") && bidCode.includes("portalBidChip(q.status, bid)") &&
       bidCode.includes("onlineHeaderLine(q, bid.rev)") && !/\bq\.(name|value)\b/.test(bidCode),
      "bids-card: the bid row shows the revision's frozen name and value, the Bid badge and the status chip — never the live q.name / q.value");
    ok(bidCode.includes("Open PDF ↗") && bidCode.includes("/pdf") && bidCode.includes("prefetch={false}"), "bids-card: the bid row links the online page and Open PDF");
    ok(!/@\/lib\/stores\/(parties|bids)|-server|addressee/.test(bidCode), "bids-card: the bid row imports no party store, bid store or -server module");
    // Home bounds the list to the quotes one of this company's rows points at — the output is identical.
    {
      const qs = [mk({ id: "Q-1" }), mk({ id: "Q-3", status: "lost" }), mk({ id: "Q-5", customerId: "CA" }), mk({ id: "Q-9" }), mk({ id: "Q-6", status: "won", bid: { dueAt: null, addenda: [], awardedPartyId: "A6" } })];
      const rs = [A, row("A3", "CA", "gc", {}, { recordId: "Q-3" }), row("A6", "CA", "gc", { result: "awarded" }, { recordId: "Q-6" })];
      const ids = new Set(rs.map((r) => r.recordId));
      ok(JSON.stringify(portalBidList(qs, "CA", rs)) === JSON.stringify(portalBidList(qs.filter((q) => ids.has(q.id)), "CA", rs)) &&
         portalBidList(qs, "CA", rs).open.length + portalBidList(qs, "CA", rs).history.length === 3,
        "bids-card: pre-filtering quotes by the company's row recordIds leaves portalBidList's output unchanged");
    }
    const homeSrc = codeOf(rd("src/app/portal/page.tsx"));
    ok(homeSrc.includes("portalBidRowsForCompany(cid)") && homeSrc.includes("portalBidList(\n    quotes.filter((q) => bidQuoteIds.has(q.id)),") && homeSrc.includes("new Set(bidRows.map((r) => r.recordId))") && homeSrc.includes("homePortalQuotes(quotes, cid)") &&
       homeSrc.includes("PORTAL_BID_COPY.card") && homeSrc.includes("PORTAL_BID_COPY.cardSub(companyName)") && homeSrc.includes("<PortalBidRow"),
      "bids-card: Home loads the company's bidder rows, lists them through portalBidList and keeps homePortalQuotes");
    ok(homeSrc.indexOf("PORTAL_BID_COPY.card") > -1 && homeSrc.indexOf("PORTAL_BID_COPY.card") < homeSrc.indexOf("Your quotes &amp; estimates"), "bids-card: the card sits above Your quotes & estimates");
    ok(homeSrc.includes("bidGroups.open.length + bidGroups.history.length > 0"), "bids-card: the card renders only when there is a bid to show");
    const smoke = rd("scripts/smoke-routes.ts");
    ok(smoke.includes('"/portal?preview=northridge"') && smoke.includes('"/portal/quotes/Q-2041?preview=northridge"'), "bids-card: the smoke routes cover the Bids branch of Home and the bidder branch of the online page");
    // The card's items carry only { q, bid, closed } — no party list.
    const l = portalBidList([mk()], "CA", [A]);
    ok(l.open.length === 1 && Object.keys(l.open[0]).sort().join() === "bid,closed,q" && !/"companyId"|recordId/.test(JSON.stringify(l.open[0].bid)), "bids-card: a list item is { q, bid, closed } with no party row");
  }
  // Boundary.
  {
    const src = readFileSync(join(__dirname, "../src/lib/parties/portal-bid.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    ok(!/import (?!type)[^;]*@\/lib\/stores/.test(code) && !/@\/db|node:|-server/.test(code), "portal-bid: no store value import, no db, node: or -server");
  }
}

const I_FIX = {
  own: fixtureId(348, "iown"), gc1: fixtureId(348, "igc1"), gc2: fixtureId(348, "igc2"), gc3: fixtureId(348, "igc3"), gc4: fixtureId(348, "igc4"),
  oth: fixtureId(348, "ioth"), ct1: fixtureId(348, "ict1"), ct2: fixtureId(348, "ict2"),
};
async function dropPortalBidIdentityFixtures() {
  const db = await getDb();
  await db.delete(contactEmails).where(like(contactEmails.contactId, "TEST348:i%"));
  await db.delete(contactsTable).where(like(contactsTable.id, "TEST348:i%"));
  await db.delete(companies).where(like(companies.id, "TEST348:i%"));
}

/** #348 slice 6 task 2 — the portal loader, the three portal quote routes' rule and the bidder PDF response, against the DB. */
export async function portalBidDbChecks(ok: Ok) {
  const { own, gc1, gc2, gc3, gc4, oth, ct1, ct2 } = I_FIX;
  const iq = fixtureId(348, "iq"), iq2 = fixtureId(348, "iq2");
  const NAMES = { own: "Portal Owner I", gc1: "Portal GC One I", gc2: "Portal GC Two I", gc3: "Portal GC Three I", gc4: "Portal GC Four I", oth: "Portal Other I" };
  const regAll = async () => {
    for (const p of await listFor("quote", iq)) registerFixture("record_parties", p.id);
    const proj = await getProjectByQuote(iq).catch(() => null);
    if (proj) {
      registerFixture("projects", proj.id);
      registerFixture("tasks", autoTaskId(`item16:sold:${proj.id}`));
      for (const p of await listFor("project", proj.id)) registerFixture("record_parties", p.id);
    }
  };
  const ses = (cid: string) => ({ grantId: "PG-i", customerId: cid, name: "T", email: "t@i.test" });
  const T = Date.UTC(2034, 2, 10);
  const sentRevs = (q: Quote | null) => (q?.revisions ?? []).filter((r) => r.reason === "sent");
  const stateFor = async (cid: string) => {
    const q = (await getQuote(iq))!;
    const rows = await portalBidRowsFor(q, cid);
    return { q, rows, s: portalOnlineEstimateState(q, cid, rows), pdf: portalBidPdfSource(q, cid, rows), list: portalBidList([q], cid, rows) };
  };
  const listed = (l: ReturnType<typeof portalBidList>) => l.open.length + l.history.length;
  try {
    await dropPortalBidIdentityFixtures();
    for (const k of ["own", "gc1", "gc2", "gc3", "gc4", "oth"] as const) {
      await saveCompany({ id: I_FIX[k], name: NAMES[k], type: "customer", lifecycle: "active", deleted: false });
    }
    await saveContact({ id: ct1, firstName: "Ivy", lastName: "One", homeCompanyId: gc1 });
    await setEmails(ct1, [{ value: "ivy@i.test", label: "work", isPrimary: true }] as never);
    await saveContact({ id: ct2, firstName: "Ike", lastName: "Two", homeCompanyId: gc2 });
    await setEmails(ct2, [{ value: "ike@i.test", label: "work", isPrimary: true }] as never);
    const NOW = Date.now();
    // Task 3: a printed system with priced lines, so the owner's BOM has rows (and prices that must never reach it).
    const iSpec = {
      sections: [
        { id: "is1", name: "Rigging", kind: "materials", mfr: "", freightPct: 0, items: [
          { id: 1, sku: "", desc: "Batten", qty: 4, unit: "ea", cost: 1234.5, price: 5678.25, manufacturer: "Acme", manufacturerModelNumber: "AX-1" },
          { id: 2, sku: "", desc: "Spare", qty: 1, unit: "ea", cost: 10, price: 99991, option: true },
        ] },
      ],
    };
    await createFixture("quotes", buildQuote(iq, { name: "Portal bid quote", customer: NAMES.own, customerId: own, value: 1000, spec: iSpec } as never, "system", null, NOW) as never);
    // Task 3: the owner's second estimate — no bidders, behaves exactly as today.
    await createFixture("quotes", buildQuote(iq2, { name: "Owner plain quote", customer: NAMES.own, customerId: own, value: 500, spec: iSpec } as never, "system", null, NOW) as never);
    const added = [
      await addBidder({ quoteId: iq, companyId: gc1, contactId: ct1, role: "gc" }, "u"),
      await addBidder({ quoteId: iq, companyId: gc2, contactId: ct2, role: "gc" }, "u"),
      await addBidder({ quoteId: iq, companyId: gc3, role: "gc" }, "u"),
      await addBidder({ quoteId: iq, companyId: gc4, role: "gc" }, "u"),
    ];
    await regAll();
    if (!added.every((a) => a.ok)) throw new Error("portal bidders missing");
    const [p1, p2, p3, p4] = added.map((a) => (a.ok ? a.party.id : ""));
    await setStatus(iq, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" });
    const r1 = sentRevs(await getQuote(iq)).at(-1)!.rev;
    const send = (pid: string, rev: number) => recordBidderSend(iq, pid, { threadId: `C-i-${pid}-${rev}`, rev, at: T, by: "Test", to: "x@i.test" }, { kind: "sent" }, "u1");
    for (const pid of [p1, p2, p3]) await send(pid, r1);
    await updateBidder(p3, { result: "withdrew" });

    // Loader.
    {
      const q = (await getQuote(iq))!;
      const rows1 = await portalBidRowsFor(q, gc1);
      ok(rows1.length === 1 && rows1[0].id === p1 && rows1.every((r) => r.companyId === gc1 && r.recordType === "quote" && r.recordId === iq && !!r.bid),
        "portal-bid db: portalBidRowsFor returns only this company's bidder rows on the quote");
      ok(!("contactId" in rows1[0]) && !("createdBy" in rows1[0]), "portal-bid db: the loader hands the portal only the rule's fields");
      ok((await portalBidRowsFor(q, own)).length === 0 && (await portalBidRowsFor(q, "")).length === 0 && (await portalBidRowsFor(q, oth)).length === 0,
        "portal-bid db: the owner, an empty company and a stranger get no rows");
      const byCo = await portalBidRowsForCompany(gc1);
      ok(byCo.some((r) => r.id === p1) && byCo.every((r) => r.companyId === gc1 && r.recordType === "quote" && !!r.bid && (r.role === "gc" || r.role === "ec")),
        "portal-bid db: portalBidRowsForCompany lists this company's quote bidder rows only");
      ok((await portalBidRowsForCompany("")).length === 0, "portal-bid db: no company, no rows");
      const rows4 = await portalBidRowsFor(q, gc4);
      ok(rows4.length === 1 && rows4[0].id === p4 && rows4[0].bid?.revSent == null, "portal-bid db: a never-sent bidder's row loads — the rule, not the loader, refuses it");
    }

    // 1. A sent bidder sees its delivered revision.
    {
      const { s, pdf } = await stateFor(gc1);
      ok(s.kind === "ok" && s.bidder?.partyId === p1 && s.rev.rev === r1 && pdf?.partyId === p1 && pdf.rev === r1, "portal-bid db: gc1 sees r1 (state and PDF source)");
    }
    // T3. The owner of a bid estimate (Jeff 2026-10-15): a BOM with no prices — no PDF, no Accept, no writes.
    {
      const q = (await getQuote(iq))!;
      const hb = await portalQuoteHasBidders(q);
      ok(hb && (await portalBidRowsFor(q, own)).length === 0, "owner-bom db: the owner's quote has bidders (and the bidder loader still reads nothing for the owner)");
      ok((await portalOwnerHasBidders(q, own)) === true && (await portalOwnerHasBidders(q, gc1)) === false && (await portalOwnerHasBidders(q, oth)) === false && (await portalOwnerHasBidders(q, "")) === false,
        "owner-bom db: portalOwnerHasBidders is true only for the quote's own customer (a bidder, a stranger and an empty company are false)");
      const s = portalOnlineEstimateState(q, own, [], { hasBidders: hb });
      ok(s.kind === "ok" && s.bomOnly === true && !s.bidder && s.rev.rev === r1, "owner-bom db: the owner's page state is bomOnly on its latest sent revision");
      const withPdf = { ...q, revisions: (q.revisions ?? []).map((r) => (r.reason === "sent" ? { ...r, pdfBlobPath: "quote-pdfs/x.pdf" } : r)) } as Quote;
      ok(portalQuotePdfSource(withPdf, own) !== null && portalQuotePdfSource(withPdf, own, { hasBidders: hb }) === null, "owner-bom db: the owner's PDF source is null once the quote has bidders");
      const so = ses(own);
      const acc = await acceptPortal(so, { quoteId: iq, purchaseMethod: "po", notes: "", poDocumentId: null, signerName: "Owen", signerTitle: "Director" }, Date.now(), { notify: async () => {} });
      const ref = await refreshPortalQuote(so, iq);
      const cp = await copyToCart(so, iq);
      const rn = await renamePortalQuote(so, iq, "Owner rename");
      ok(!acc.ok && acc.error === PORTAL_NOT_FOUND_COPY, "owner-bom db: acceptPortal refuses the owner of a bid estimate");
      ok(!ref.ok && ref.error === PORTAL_NOT_FOUND_COPY, "owner-bom db: refreshPortalQuote refuses the owner of a bid estimate");
      ok(!cp.ok && cp.error === PORTAL_NOT_FOUND_COPY, "owner-bom db: copyToCart refuses the owner of a bid estimate");
      ok(!rn.ok && rn.error === PORTAL_NOT_FOUND_COPY, "owner-bom db: renamePortalQuote refuses the owner of a bid estimate");
      const after = await getQuote(iq);
      ok(after?.status === "sent" && !after.portalAcceptance && after.name === "Portal bid quote", "owner-bom db: nothing was written for the owner");
      const bom = s.kind === "ok" ? await portalOwnerBom(q, s.rev, NAMES.own) : null;
      const rows = bom ? bom.systems.flatMap((x) => x.rows) : [];
      ok(!!bom && bom.preparedFor === NAMES.own && bom.title === "Portal bid quote" && bom.systems.length === 1 && rows.length === 1 && rows[0].qty === 4 && rows[0].manufacturer === "Acme" && rows[0].part === "AX-1",
        "owner-bom db: the BOM is the sent revision's printed system — Qty · Manufacturer · Model, the option line left out");
      ok(rows.every((r) => Object.keys(r).sort().join() === "description,key,manufacturer,part,qty,unit"), "owner-bom db: every BOM row has only the PackageBomRow fields");
      ok(!/1234|5678|99991|22713|\$/.test(JSON.stringify(bom)), "owner-bom db: no price, cost, option price or total in the owner's BOM");
      const ids = await portalBidderQuoteIds([iq, iq2, "", fixtureId(348, "imissing")]);
      ok(ids.has(iq) && !ids.has(iq2) && ids.size === 1, "owner-bom db: portalBidderQuoteIds picks the bid estimate only");
      ok((await portalBidderQuoteIds([])).size === 0, "owner-bom db: no ids, no read, empty set");
    }
    // T3. The owner's estimate without bidders behaves exactly as today — Accept still works.
    {
      await setStatus(iq2, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" });
      const q2 = (await getQuote(iq2))!;
      const hb2 = await portalOwnerHasBidders(q2, own);
      ok(!hb2 && JSON.stringify(portalOnlineEstimateState(q2, own, [], { hasBidders: hb2 })) === JSON.stringify(portalOnlineEstimateState(q2, own)) &&
         portalOnlineEstimateState(q2, own).kind === "ok" && !("bomOnly" in portalOnlineEstimateState(q2, own, [], { hasBidders: hb2 })),
        "owner-bom db: an estimate with no bidders has today's state, no bomOnly");
      const w2 = { ...q2, revisions: (q2.revisions ?? []).map((r) => (r.reason === "sent" ? { ...r, pdfBlobPath: "quote-pdfs/y.pdf" } : r)) } as Quote;
      ok(JSON.stringify(portalQuotePdfSource(w2, own, { hasBidders: hb2 })) === JSON.stringify(portalQuotePdfSource(w2, own)) && portalQuotePdfSource(w2, own) !== null, "owner-bom db: its PDF source is today's");
      const acc2 = await acceptPortal(ses(own), { quoteId: iq2, purchaseMethod: "po", notes: "", poDocumentId: null, signerName: "Owen", signerTitle: "Director" }, Date.now(), { notify: async () => {} });
      ok(acc2.ok && !!(await getQuote(iq2))?.portalAcceptance, "owner-bom db: Accept still works on the owner's estimate with no bidders");
    }

    // 2. Refused, the same as missing.
    for (const [cid, label] of [[gc4, "never sent"], [gc3, "withdrew"], [oth, "a stranger"]] as const) {
      const { s, pdf, list } = await stateFor(cid);
      ok(s.kind === "unavailable" && pdf === null && listed(list) === 0, `portal-bid db: ${label} is unavailable, with no PDF`);
    }
    {
      const missing = fixtureId(348, "imissing");
      ok((await getQuote(missing)) === null && (await portalBidRowsFor({ id: missing, customerId: own }, gc1)).length === 0, "portal-bid db: an unknown quote id has no quote and no rows");
      // The routes' null-q short-circuit, as written in page / pdf / photo.
      const mq = await getQuote(missing);
      const mBids = mq ? await portalBidRowsFor(mq, gc1) : [];
      const mState = mq ? portalOnlineEstimateState(mq, gc1, mBids) : ({ kind: "unavailable" } as const);
      const mPdf = mq ? portalBidPdfSource(mq, gc1, mBids) : null;
      ok(mState.kind === "unavailable" && mPdf === null && mBids.length === 0, "portal-bid db: an unknown quote id is unavailable with no PDF source");
    }
    // 9. No other bidder named on gc1's addressed page.
    {
      const q = (await getQuote(iq))!;
      const rev1 = q.revisions!.find((r) => r.rev === r1 && r.reason === "sent")!;
      const props = await loadQuoteDocumentProps(q, { revision: rev1, photos: { href: (d) => d }, bidderPartyId: p1 });
      const json = JSON.stringify(props);
      ok(!!props && props.custName === NAMES.gc1 && !json.includes(NAMES.gc2) && !json.includes(NAMES.gc3) && props.rewardsLine === "",
        "portal-bid db: gc1's page is addressed to gc1, names no other bidder and has no rewards line");
    }

    // 3. An unsent revision: draft → sent cuts r2, delivered to gc2 only.
    await setStatus(iq, "draft", "Test");
    await setStatus(iq, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" });
    const r2 = sentRevs(await getQuote(iq)).at(-1)!.rev;
    await send(p2, r2);
    {
      const a = await stateFor(gc1), b = await stateFor(gc2);
      ok(r2 > r1 && a.s.kind === "ok" && a.s.rev.rev === r1 && a.pdf?.rev === r1, "portal-bid db: gc1 still sees r1 after an unsent r2");
      ok(b.s.kind === "ok" && b.s.rev.rev === r2 && b.pdf?.rev === r2 && b.s.bidder?.partyId === p2, "portal-bid db: gc2 sees r2");
    }

    // 4. Revising: an addendum on the sent estimate moves it to draft.
    const ad = await setBidDetails(iq, { addenda: [{ no: 1, receivedAt: T, note: "a" }] }, "Test");
    {
      const a = await stateFor(gc1);
      ok(ad.ok && a.q.status === "draft" && a.s.kind === "revising" && listed(a.list) === 0 && a.pdf === null,
        "portal-bid db: while revising, gc1 gets the being-revised card, no list row and no PDF");
    }

    // 5. Award.
    await setStatus(iq, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" });
    const aw = await awardBid(iq, p1);
    {
      const a = await stateFor(gc1), b = await stateFor(gc2);
      ok(aw.ok && b.s.kind === "unavailable" && listed(b.list) === 0 && b.pdf === null, "portal-bid db: a bidder lost by award is unavailable and unlisted");
      ok(a.s.kind === "ok" && a.s.bidder?.result === "awarded", "portal-bid db: the awarded bidder still sees its estimate");
      ok(portalOnlineEstimateState(a.q, own).kind === "ok" && portalListsQuote(a.q, own) && (await portalBidRowsFor(a.q, own)).length === 0,
        "portal-bid db: the owner's view is unchanged by the award (and reads no rows)");
      const ao = portalOnlineEstimateState(a.q, own, [], { hasBidders: await portalQuoteHasBidders(a.q) });
      ok(ao.kind === "ok" && ao.bomOnly === true, "owner-bom db: after the award the owner still sees the BOM only");
    }

    // 6. A revision addressed after the award (never emailed to gc1).
    await setStatus(iq, "draft", "Test");
    await setStatus(iq, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" });
    const rAw = sentRevs(await getQuote(iq)).at(-1)!;
    {
      const a = await stateFor(gc1);
      ok(rAw.docFields?.awardedPartyId === p1 && a.s.kind === "ok" && a.s.rev.rev === rAw.rev && a.s.bidder?.via === "award" && a.pdf?.rev === rAw.rev,
        "portal-bid db: gc1 sees the revision frozen to it after the award (via award)");
    }

    // 8. Read-only: every portal write refuses a bidder company, the same as a missing quote.
    {
      const s1 = ses(gc1);
      const acc = await acceptPortal(s1, { quoteId: iq, purchaseMethod: "po", notes: "", poDocumentId: null });
      const ref = await refreshPortalQuote(s1, iq);
      const cp = await copyToCart(s1, iq);
      const rn = await renamePortalQuote(s1, iq, "Mine now");
      ok(!acc.ok && acc.error === PORTAL_NOT_FOUND_COPY, "portal-bid db: acceptPortal refuses a bidder");
      ok(!ref.ok && ref.error === PORTAL_NOT_FOUND_COPY, "portal-bid db: refreshPortalQuote refuses a bidder");
      ok(!cp.ok && cp.error === PORTAL_NOT_FOUND_COPY, "portal-bid db: copyToCart refuses a bidder");
      ok(!rn.ok && rn.error === PORTAL_NOT_FOUND_COPY, "portal-bid db: renamePortalQuote refuses a bidder");
      ok((await serviceRequestFromQuoteId(gc1, iq)) === null, "portal-bid db: serviceRequestFromQuoteId refuses a bidder");
      const after = await getQuote(iq);
      ok(after?.status === "sent" && after.name === "Portal bid quote" && !after.portalAcceptance, "portal-bid db: nothing was written");
    }

    // 10. The PDF response, with fake renders.
    {
      // Rename the live quote FIRST: the PDF source must still carry the revision's frozen name.
      await updateQuote(iq, { name: "Renamed later" });
      const a = await stateFor(gc1);
      const src = a.pdf!;
      ok(a.q.name === "Renamed later" && !!src && src.name === "Portal bid quote" && src.name === (a.s.kind === "ok" ? a.s.rev.name : ""),
        "portal-bid db: after a rename, the PDF source carries the revision's frozen name, not the live one");
      const calls: unknown[][] = [];
      const fakeOk = (async (...args: unknown[]) => { calls.push(args); return { ok: true as const, pdf: Buffer.from("%PDF-1"), fileName: "x" }; }) as unknown as typeof renderBidderPdf;
      const req = new Request("https://portal.test/portal/quotes/x/pdf", { headers: { host: "portal.test", "x-forwarded-proto": "https" } });
      const res = await portalBidPdfResponse(req, src, { quoteId: iq, rlKey: `portal-bidpdf:test-ok-${Date.now()}` }, { render: fakeOk });
      const disp = res.headers.get("content-disposition") || "";
      ok(res.status === 200 && res.headers.get("content-type") === "application/pdf" && disp.startsWith("inline;") && disp.includes(`Rev ${src.rev}`) &&
         disp.includes("Portal bid quote") && !disp.includes("Renamed later") && disp.includes(NAMES.gc1) &&
         res.headers.get("x-content-type-options") === "nosniff" && res.headers.get("cache-control") === "private, no-store",
        "portal-bid db: the PDF opens inline, named for the revision's own name, this bidder and its Rev");
      ok((await res.text()) === "%PDF-1", "portal-bid db: the rendered bytes are served");
      ok(calls.length === 1 && calls[0][0] === iq && calls[0][1] === p1 && calls[0][2] === "portal.test" && calls[0][3] === "https" && (calls[0][4] as { rev?: number })?.rev === src.rev,
        "portal-bid db: the render gets the quote, this party, the host and the bidder's own revision");
      const fake404 = (async () => ({ ok: false as const, status: 404 as const, error: "Not found" })) as unknown as typeof renderBidderPdf;
      const r404 = await portalBidPdfResponse(req, src, { quoteId: iq, rlKey: `portal-bidpdf:test-404-${Date.now()}` }, { render: fake404 });
      ok(r404.status === 404 && (await r404.text()) === "Not found", "portal-bid db: a refused render is a plain 404");
      const origErr = console.error;
      console.error = () => {};
      try {
        for (const [status, error] of [
          [503, "Bidder PDFs aren’t set up on this server (AUTH_SECRET is missing)."],
          [503, "Set QUOTE_PDF_ORIGIN, or QUOTE_PDF_DISABLED is on."],
          [500, "The bidder PDF couldn’t be rendered — try again."],
        ] as const) {
          const fakeFail = (async () => ({ ok: false as const, status, error })) as unknown as typeof renderBidderPdf;
          const rf = await portalBidPdfResponse(req, src, { quoteId: iq, rlKey: `portal-bidpdf:test-${status}-${Date.now()}-${error.length}` }, { render: fakeFail });
          const body = await rf.text();
          ok(rf.status === status && body === PORTAL_BID_COPY.pdfUnavailable && !/AUTH_SECRET|QUOTE_PDF/.test(body),
            `portal-bid db: a ${status} keeps its status and shows only the portal line (never the render's text)`);
        }
      } finally {
        console.error = origErr;
      }
      const key = `portal-bidpdf:test-rl-${Date.now()}`;
      const codes: number[] = [];
      for (let i = 0; i < PORTAL_BID_PDF_PER_MIN + 1; i++) codes.push((await portalBidPdfResponse(req, src, { quoteId: iq, rlKey: key }, { render: fakeOk, companyName: async () => "X" })).status);
      ok(PORTAL_BID_PDF_PER_MIN === 6 && codes.slice(0, 6).every((c) => c === 200) && codes[6] === 429, "portal-bid db: the seventh PDF in a minute on one key is 429");
      await updateQuote(iq, { name: "Portal bid quote" });
    }

    // 11. Undo award: the bidder lost by award is pending and visible again.
    const un = await undoAward(iq);
    {
      const b = await stateFor(gc2);
      const row2 = (await listFor("quote", iq)).find((p) => p.id === p2);
      ok(un.ok && row2?.bid?.result === "pending" && b.s.kind === "ok" && b.s.rev.rev === r2 && listed(b.list) === 1, "portal-bid db: after Undo award gc2 is pending and visible again");
    }
    const reAw = await awardBid(iq, p1);
    ok(reAw.ok && (await getQuote(iq))?.bid?.awardedPartyId === p1, "portal-bid db: gc1 is awarded again after Undo award");

    // 7. Won.
    await setStatus(iq, "won", "Test", { bypassApprovalGate: "engine-owned-flow" });
    await regAll();
    {
      const a = await stateFor(gc1), b = await stateFor(gc2);
      ok(a.q.status === "won" && a.s.kind === "ok" && !a.s.closed && a.list.history.length === 1 && a.list.open.length === 0, "portal-bid db: the awarded bidder sees a won estimate in its history");
      ok(b.s.kind === "unavailable" && listed(b.list) === 0, "portal-bid db: a losing bidder can't see the won estimate");
      const wo = portalOnlineEstimateState(a.q, own, [], { hasBidders: await portalQuoteHasBidders(a.q) });
      ok(wo.kind === "ok" && wo.bomOnly === true && (await acceptPortal(ses(own), { quoteId: iq, purchaseMethod: "po", notes: "", poDocumentId: null, signerName: "O", signerTitle: "D" })).ok === false,
        "owner-bom db: the won bid estimate stays BOM only for the owner, for good");
    }

    // 12. Route pins.
    {
      const rd = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
      const page = rd("src/app/portal/quotes/[id]/page.tsx"), pdf = rd("src/app/portal/quotes/[id]/pdf/route.ts"), photo = rd("src/app/portal/quotes/[id]/photo/[docId]/route.ts");
      ok([page, pdf, photo].every((x) => x.includes("portalBidRowsFor(")), "portal-bid db: page, PDF and photo routes load the bidder rows");
      ok(page.includes("portalOnlineEstimateState(q, cid, bids, { hasBidders })") && page.includes("bidderPartyId: state.bidder.partyId") && page.includes("onlineCutSheets(q, state.rev)"),
        "portal-bid db: the page composes the bidder rows and addresses the document to the bidder");
      ok(pdf.includes("portalBidPdfSource(q, session.customerId, bids)") && pdf.includes("export const maxDuration = 60") && pdf.includes("portalBidPdfResponse(req, bid,") &&
         pdf.includes("`portal-bidpdf:preview:${session.customerId}`") && pdf.includes("`portal-bidpdf:${session.grantId}`") &&
         pdf.includes("portalQuotePdfPreparing(q, session.customerId)") && pdf.includes("portalQuotePdfUnavailable(q, session.customerId)") &&
         pdf.includes("pdfFileName(displayQuoteNumber(q), src.rev)") && pdf.indexOf("portalBidPdfSource(") > -1 && pdf.indexOf("portalBidPdfSource(") < pdf.indexOf("portalQuotePdfSource(q, session.customerId, { hasBidders })"),
        "portal-bid db: the PDF route answers a bidder first, then runs the customer code unchanged");
      ok(photo.includes("portalOnlineEstimateState(q, session.customerId, bids, { hasBidders })") && photo.includes("servePhotoForRevision(req, state.rev, docId)"), "portal-bid db: photos come from the bidder's own revision");
      // Task 3 pins (Jeff 2026-10-15): the owner of a bid estimate — BOM only, no prices, no PDF, no Accept.
      const bomView = rd("src/app/portal/quotes/[id]/bom-view.tsx"), ownerBomSrc = rd("src/lib/parties/portal-owner-bom.ts");
      ok(bomView.includes('import type { OwnerBom } from "@/lib/parties/portal-owner-bom";') && ownerBomSrc.includes("packageBomRows(sec, catalog, vendorQuotes)") &&
         !/money\(|fmt\(|QuoteDocument|AcceptDialog|pdf/i.test(bomView) && !/["']use client["']/.test(bomView) && !/money\(|fmt\(|totals\(|systemSellTotal/.test(ownerBomSrc),
        "owner-bom pins: the BOM view renders packageBomRows rows (via ownerBom) and carries no money, document, Accept or download");
      const bomBranch = page.slice(page.indexOf("if (state.bomOnly) {"), page.indexOf("const docProps = await loadQuoteDocumentProps("));
      ok(page.includes("const hasBidders = q ? await portalOwnerHasBidders(q, cid) : false;") && bomBranch.includes("<BomView") && bomBranch.includes("portalOwnerBom(q, state.rev,") && !/QuoteDocument|OnlineEstimateView|pdfHref|onlineCutSheets/.test(bomBranch) &&
         page.indexOf("if (state.bomOnly) {") > -1 && page.indexOf("if (state.bomOnly) {") < page.indexOf("loadQuoteDocumentProps(q, {") && page.includes("portalQuotePdfSource(q, cid, { hasBidders })") && !page.includes("portalQuotePdfSource(q, cid)"),
        "owner-bom pins: the page's bomOnly branch renders <BomView before the priced document is ever loaded");
      ok(pdf.includes("const hasBidders = q ? await portalOwnerHasBidders(q, session.customerId) : false;") && pdf.indexOf('if (q && hasBidders) return new Response("Not found", { status: 404 });') > -1 &&
         pdf.indexOf('if (q && hasBidders) return new Response("Not found", { status: 404 });') < pdf.indexOf("portalQuotePdfPreparing(q, session.customerId)"),
        "owner-bom pins: the PDF route answers the owner of a bid estimate with a plain 404 first");
      ok(photo.includes("const hasBidders = q ? await portalOwnerHasBidders(q, session.customerId) : false;") && photo.includes("state.bomOnly"), "owner-bom pins: the photo route refuses the BOM-only owner");
      const pq = rd("src/lib/portal-quotes.ts");
      const gates = pq.match(/if \(!q \|\| !portalListsQuote\(q, session\.customerId\)\) return \{ ok: false, error: PORTAL_NOT_FOUND_COPY \};\n  if \(await ownerBidRefused\(q, session\.customerId\)\) return \{ ok: false, error: PORTAL_NOT_FOUND_COPY \};/g) || [];
      ok(pq.includes("  return portalOwnerHasBidders(q, cid);") && !pq.includes("portalQuoteHasBidders(") && gates.length === 4 && (pq.match(/ownerBidRefused\(q, session\.customerId\)/g) || []).length === 4,
        "owner-bom pins: accept, refresh, copy and rename each refuse the owner of a bid estimate right after the list rule");
      const home = rd("src/app/portal/page.tsx"), mine = rd("src/app/portal/my-quotes/page.tsx"), rowSrc = rd("src/app/portal/quote-row.tsx");
      ok(home.includes("portalBidderQuoteIds([") && home.includes("<PortalBidOwnerRow") && home.includes("!bidOwnerIds.has(p.quoteId)") && mine.includes("portalBidderQuoteIds(") && mine.includes("<PortalBidOwnerRow"),
        "owner-bom pins: Home and My quotes render the scope-only row for a bid estimate (and Home hides its project's value)");
      const ownerRow = rowSrc.slice(rowSrc.indexOf("export function PortalBidOwnerRow"));
      ok(ownerRow.length > 100 && ownerRow.includes("<Chip c={SCOPE_ONLY_CHIP} />") && rowSrc.includes("label: PORTAL_BID_COPY.ownerChip") &&
         !/money\(|AcceptDialog|RefreshPricingButton|copyQuoteToCart|pdf|Quote again|portalDecline|q\.value/i.test(ownerRow),
        "owner-bom pins: the scope-only row has no value, Accept, Refresh pricing, decline note, PDF, Copy or Quote again");
      const srv = rd("src/lib/parties/portal-bid-server.ts");
      ok(srv.includes("bidderPdfFileName(src.name,") && srv.includes("rateLimit(ctx.rlKey, PORTAL_BID_PDF_PER_MIN, 60_000)") && !srv.includes("r.fileName"),
        "portal-bid db: the bidder PDF is named by bidderPdfFileName over the revision's name, never the render's live name");
    }
    // 13. Choke-point inventory.
    {
      const root = join(__dirname, "../src/app/portal");
      const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => /\.(ts|tsx)$/.test(f));
      const NO_BIDDER_ROWS_NEEDED: string[] = [];
      const reads = files.filter((f) => /\bgetQuote\(/.test(readFileSync(join(root, f), "utf8")));
      ok(reads.length >= 3 && reads.every((f) => NO_BIDDER_ROWS_NEEDED.includes(f) || readFileSync(join(root, f), "utf8").includes("portalBidRowsFor(")),
        `portal-bid db: every portal file that reads a quote loads the bidder rows (${reads.join(", ")})`);
      // Any VALUE import from @/lib/stores/quotes (any alias) must gate through portalBidRowsFor( or portalListsQuote(.
      // Empty: Home left the list in slice 6 Task 4 — it reads the company's bidder rows (portalBidRowsForCompany) and
      // lists bids through portalBidList, alongside homePortalQuotes (portalListsQuote inside lib/portal-quotes).
      const QUOTE_READ_ALLOW: Record<string, string> = {};
      const quoteValueImport = (src: string) =>
        [...src.matchAll(/import\s+(type\s+)?([^;]*?)\s+from\s+["']@\/lib\/stores\/quotes["']/g)].some((m) => {
          if (m[1]) return false;
          const names = (m[2].match(/\{([^}]*)\}/)?.[1] ?? "").split(",").map((x) => x.trim()).filter(Boolean);
          return !/^\{/.test(m[2].trim()) || names.some((n) => !n.startsWith("type "));
        });
      // Loading rows (portalBidRowsForCompany) is not a gate; the list rule (portalBidList) is.
      const quoteGated = (src: string) => src.includes("portalBidRowsFor(") || src.includes("portalBidList(") || src.includes("portalListsQuote(");
      const ungated = files.filter((f) => {
        const src = readFileSync(join(root, f), "utf8");
        return quoteValueImport(src) && !(f in QUOTE_READ_ALLOW) && !quoteGated(src);
      });
      const valueImporters = files.filter((f) => quoteValueImport(readFileSync(join(root, f), "utf8")));
      ok(valueImporters.length >= 5 && !valueImporters.includes("quote-row.tsx") && ungated.length === 0,
        `portal-bid db: every portal file with a value import from stores/quotes gates through portalBidRowsFor / portalBidList / portalListsQuote (${ungated.join(", ")})`);
      ok(quoteValueImport('import {\n  getAll as allQuotes,\n  type Quote,\n} from "@/lib/stores/quotes";') && !quoteValueImport('import type { Quote } from "@/lib/stores/quotes";') &&
         !quoteValueImport('import { type Quote } from "@/lib/stores/quotes";') && quoteValueImport('import * as Q from "@/lib/stores/quotes";'),
        "portal-bid db: the import scan catches multi-line, aliased and namespace imports and skips type-only ones");
      ok(!quoteGated('import { getQuote } from "@/lib/stores/quotes";\nconst r = await portalBidRowsForCompany(cid);') && quoteGated("const g = portalBidList(qs, cid, rows);") &&
         quoteGated("await portalBidRowsFor(q, cid);") && quoteGated("portalListsQuote(q, cid)"),
        "portal-bid db: loading company rows alone is not a gate (a quote reader calling only portalBidRowsForCompany is flagged); portalBidList / portalBidRowsFor / portalListsQuote are");
      const leaks = files.filter((f) => /@\/lib\/stores\/parties|@\/lib\/stores\/bids|@\/lib\/parties\/addressee-server/.test(readFileSync(join(root, f), "utf8")));
      ok(files.length > 10 && leaks.length === 0, `portal-bid db: no portal file imports the party stores or addressee-server (${leaks.join(", ")})`);
      // Task 3 fix round 1 — the owner's fail-open default (hasBidders omitted = today's priced answer) is enforced:
      // any portal file that asks the PDF / online-state rule must also ask the one owner check, or be listed here.
      const OWNER_CHECK_ALLOW: Record<string, string> = {
        // PortalQuoteRow calls both with no hasBidders: it is only ever rendered for quotes WITHOUT bidders — Home and
        // My quotes swap a bid estimate to PortalBidOwnerRow first (portalBidderQuoteIds, pinned above). PortalBidOwnerRow
        // itself passes { hasBidders: true }.
        "quote-row.tsx": "Home / My quotes swap rows",
      };
      const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const needsOwnerCheck = (src: string) => {
        const code = codeOf(src);
        return /\bportal(QuotePdfSource|OnlineEstimateState)\(/.test(code) && !/\bportal(Owner|Quote)HasBidders\(/.test(code);
      };
      ok(needsOwnerCheck("const s = portalOnlineEstimateState(q, cid, bids);") && needsOwnerCheck("x = portalQuotePdfSource(q, cid); // portalOwnerHasBidders(q, cid)") &&
         !needsOwnerCheck("const hb = await portalOwnerHasBidders(q, cid);\nconst s = portalOnlineEstimateState(q, cid, bids, { hasBidders: hb });") &&
         !needsOwnerCheck("import { portalOnlineEstimateState } from \"x\";") && !needsOwnerCheck("/* calls portalQuotePdfSource(q, cid) */"),
        "owner-bom pins: the owner-check scanner flags an unchecked call (even with the check only in a comment) and passes a checked one, an import or a comment");
      const ownerScan = [
        ...files.map((f) => ({ f, src: readFileSync(join(root, f), "utf8") })),
        { f: "src/lib/portal-quotes.ts", src: readFileSync(join(__dirname, "../src/lib/portal-quotes.ts"), "utf8") },
      ];
      const unchecked = ownerScan.filter((x) => !(x.f in OWNER_CHECK_ALLOW) && needsOwnerCheck(x.src)).map((x) => x.f);
      const asks = ownerScan.filter((x) => /\bportal(QuotePdfSource|OnlineEstimateState)\(/.test(codeOf(x.src))).map((x) => x.f);
      ok(asks.length >= 4 && unchecked.length === 0 && Object.keys(OWNER_CHECK_ALLOW).every((f) => asks.includes(f)),
        `owner-bom pins: every portal file that asks the PDF / online-state rule also runs the owner check, or is allowlisted (${unchecked.join(", ")})`);
      const count = (f: string) => (readFileSync(join(__dirname, "..", f), "utf8").match(/portalListsQuote\(/g) || []).length;
      ok(count("src/lib/portal-quotes.ts") === 4 && count("src/lib/portal-service-quotes.ts") === 1, "portal-bid db: the portal write actions still gate on portalListsQuote (4 + 1)");
    }
  } finally {
    try { await regAll(); } catch {}
    await dropFixtures(348);
    await dropPortalBidIdentityFixtures();
  }
}

if (process.argv[1]?.endsWith("test-bids.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  bidChecks(okf).then(() => bidSendChecks(okf)).then(() => bidSendFakeChecks(okf)).then(() => bidFollowupChecks(okf)).then(() => portalBidPureChecks(okf)).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}
