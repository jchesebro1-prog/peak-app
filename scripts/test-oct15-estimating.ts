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
import { documentRevStamp, maxSentRevNo, nextSendRevNo, sentRevNo } from "../src/lib/quote-pdf/state";
import { quoteAsOfRevision, sentDocumentStamp } from "../src/lib/quote-share/view";
import { addQuoteRevision } from "../src/lib/stores/quotes";
import { bomViewProps } from "../src/app/(app)/estimator/quote-document-view";
import { documentLetterhead, fullDocumentLetterhead } from "../src/lib/letterhead-server";
import { bookCoverFingerprint } from "../src/lib/part-docs/datasheet-book-cover-server";
import { specDocumentsForQuote, specDocumentsKey, uniqueDocxName, quoteSpecDocuments } from "../src/lib/estimate-output/package-spec-docs-server";
import { buildRevisionPackageZip } from "../src/lib/estimate-output/package-zip-server";
import { createSpecDocument, patchSpecDocument } from "../src/lib/stores/spec-documents";
import { canChangeQuotePeople, quoteSentOnce, PEOPLE_LOCKED_AFTER_SEND } from "../src/lib/quote-people-lock";
import { setQuotePeopleAs } from "../src/lib/quote-people";
import { appendResponseTo, MAX_CLIENT_RESPONSES, responseQuoteLimitKey, type ClientResponse } from "../src/lib/estimate-output/responses";

const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PTY = "pty_0123456789abcdef";
const PTY2 = "pty_fedcba9876543210";

export async function oct15PureChecks(ok: Ok) {
  oct15ReviewAmountChecks(ok);
  oct15RevChecks(ok);
  await oct15LetterheadChecks(ok);
  /* ---- #18 — Lead estimator / Prepared by lock at send; approvers can still change them ---- */
  {
    ok(!quoteSentOnce({ status: "draft", revisions: [{ reason: "manual" }], history: [] }) && quoteSentOnce({ status: "draft", revisions: [{ reason: "sent" }] })
      && quoteSentOnce({ status: "draft", history: [{ to: "sent" }] }) && quoteSentOnce({ status: "won" }) && !quoteSentOnce(null),
      "oct15 #18: a quote counts as sent once it has a sent revision, a move to sent, or a status at/after sent");
    ok(canChangeQuotePeople({ status: "draft" }, false) && !canChangeQuotePeople({ status: "sent" }, false) && canChangeQuotePeople({ status: "sent" }, true),
      "oct15 #18: before the first send anyone may change them; after it, approvers only");
    const f = rd("src/app/(app)/estimator/quote-people-fields.tsx");
    ok((f.match(/disabled=\{!loadedId \|\| peopleBusy \|\| peopleLocked\}/g) || []).length === 2 && rd("src/app/(app)/estimator/page.tsx").includes("peopleSentOnce={quoteSentOnce(q)}"),
      "oct15 #18: both selects are read-only for a non-approver once sent");
  }
  /* ---- #17 — the client zip carries the estimate's SP-#### Word files ---- */
  {
    const doc = (id: string, quoteId: string | undefined, createdAt: number, kind = "quote") => ({ id, createdAt, updatedAt: createdAt, source: { kind, ...(quoteId ? { quoteId } : {}) } }) as never;
    const all = [doc("SP-1003", "Q-1", 30), doc("SP-1001", "Q-1", 10, "grid"), doc("SP-1002", "Q-2", 20), doc("SP-1004", undefined, 5, "scratch")];
    ok(specDocumentsForQuote(all, "Q-1").map((d) => d.id).join() === "SP-1001,SP-1003" && specDocumentsForQuote(all, "").length === 0, "oct15 #17: an estimate's specs are those the builder opened from it (quote or Grid source), oldest first");
    ok(specDocumentsKey([]) === "" && /^[0-9a-f]{8}$/.test(specDocumentsKey([{ id: "SP-1", updatedAt: 1 }])) && specDocumentsKey([{ id: "SP-1", updatedAt: 1 }]) !== specDocumentsKey([{ id: "SP-1", updatedAt: 2 }]),
      "oct15 #17: the zip cache key follows each spec's last edit");
    const used = new Set<string>();
    ok(uniqueDocxName("A.docx", used) === "A.docx" && uniqueDocxName("A.docx", used) === "A (2).docx" && uniqueDocxName("a.docx", used) === "a (3).docx", "oct15 #17: two specs with one file name don't collide");
    const zs = rd("src/lib/estimate-output/package-zip-server.ts");
    ok(zs.includes("if (sps.files.length) files.push(...sps.files);") && zs.includes("else if (specifications) files.push({ name: SPEC_DOCX_NAME") && zs.includes("files.splice(specFileCount, 0, { name: BOOK_FILE_NAME"),
      "oct15 #17: the SP files replace Specifications.docx (the D94 file only without them); Datasheets.pdf follows them");
  }
  /* ---- #14 — the online / package-page BOM follows the PDF's Qty switch ---- */
  {
    const props = (pdfQty: boolean) => ({ pdfQty, pdfNotes: false, pdfPrices: true, detail: "sectioned", sections: [], document: null, pdfItemizedAppendix: true }) as never;
    ok(bomViewProps(props(false)).pdfQty === false && bomViewProps(props(true)).pdfQty === true, "oct15 #14: the online BOM view keeps the PDF's Qty choice");
    const pm = rd("src/lib/estimate-output/package-model.ts");
    const pv = rd("src/components/estimate-output/package-view.tsx");
    ok(pm.includes("showQty: d.pdfQty !== false,") && pm.includes('d.pdfQty === false ? { ...r, qty: null, unit: "" } : r') && pv.includes("showQty || i > 0") && pv.includes("{showQty && <td className=\"pkg-qty\">"),
      "oct15 #14: the package page's BOM drops its Qty column (and quantities) when the PDF hides them");
  }
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

/* ---- #12 — the full Peak letterhead on the estimate's Datasheets.pdf cover and the client cut sheets ---- */
async function oct15LetterheadChecks(ok: Ok) {
  // A 1×1 PNG "logo" — documentLetterhead (the D59 ladder) prints it; the estimate book never does.
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const settings = { companyName: "Peak Systems Group", logoDark: png } as never;
  const full = await fullDocumentLetterhead(settings, true);
  const ladder = await documentLetterhead(settings, true);
  ok(!!full?.image && full.image.full === true && full.image.png === null && full.image.w > 1000, "oct15 #12: the estimate book letterhead is the full baked Peak sheet, even with a Branding logo");
  ok(!!ladder?.image && ladder.image.full === false, "oct15 #12: the document ladder (Specifications.docx, letters) still prints the uploaded logo");
  ok((await fullDocumentLetterhead(settings, false)) === null, "oct15 #12: the Peak-header choice still turns the book's letterhead off");
  ok(bookCoverFingerprint(null, full) !== bookCoverFingerprint(null, full, ladder) && bookCoverFingerprint(null, full, undefined) === bookCoverFingerprint(null, full),
    "oct15 #12: the zip cache key folds in the spec's own letterhead only when given (old book keys unchanged)");
  const zs = rd("src/lib/estimate-output/package-zip-server.ts");
  ok(zs.includes("bookLetterhead: loadEstimateBookLetterhead,") && zs.includes("buildSpecDocx(sp.spec, { letterhead: specLetterhead })") && zs.includes("loadEstimateBookLetterhead(peakHeader), loadDocumentLetterhead(peakHeader)"),
    "oct15 #12: the package zip's book takes the full sheet; Specifications.docx keeps its own letterhead");
  const dl = rd("src/lib/part-docs/datasheet-book-download.ts");
  ok(dl.includes("quoteBookCover(q), loadEstimateBookLetterhead(q.packagePeakHeader)") && dl.includes("loadEstimateBookLetterhead(resolvePeakHeader(q.packagePeakHeader") && dl.includes("gridBookCover(project, { quoteId, by }), loadDocumentLetterhead(opts.peakHeader)"),
    "oct15 #12: the staff and share-page estimate books take the full sheet; the Grid design's book is unchanged");
  ok(rd("src/lib/client-package-server.ts").includes("`[package] quote ${quote.id}`, bookLetterhead, bookCover)"), "oct15 #12: the Quotes-hub client package's book takes the full sheet");
  const cs = rd("src/components/cutsheets/cut-sheet-pages.tsx");
  ok(cs.includes('className="pk-cs-letterhead" src={letterheadSrc}') && !cs.includes("m.header.logoDark") && cs.includes("<SubmittalSheet key={m.sheetNo} m={m} />"),
    "oct15 #12: a client cut sheet heads with the full letterhead (never the Branding logo); the submittal keeps its title block");
  ok(["src/app/print/cutsheets/[quoteId]/page.tsx", "src/app/print/quote/[id]/page.tsx", "src/app/estimator-preview/[id]/page.tsx", "src/app/(app)/estimator/cut-sheets/page.tsx"].every((f) => /<CutSheetPages [^>]*letterheadSrc=\{(peakLetterhead|letterhead)\.src\}/.test(rd(f))),
    "oct15 #12: every cut-sheet page passes the baked letterhead");
}

/* ---- #13 — every send gets the next Rev; numbers never repeat ---- */
export function oct15RevChecks(ok: Ok) {
  const R = (rev: number, reason: string, revNo?: number) => ({ rev, reason, at: rev, ...(revNo ? { docFields: { revNo } } : {}) });
  ok(documentRevStamp({ revisions: [], status: "draft" }).revNum === 1 && documentRevStamp({ status: "draft" }).revNum === 1, "oct15 #13: before any send the document prints Rev 1");
  const once = [R(1, "sent", 1)];
  ok(documentRevStamp({ revisions: once, status: "sent" }).revNum === 1 && documentRevStamp({ revisions: once, status: "draft" }).revNum === 2,
    "oct15 #13: a sent quote prints its send's Rev; revising it prints the NEXT one (no second Rev 1)");
  ok(documentRevStamp({ revisions: [...once, R(2, "manual"), R(3, "recall")], status: "draft" }).revNum === 2, "oct15 #13: manual / recall snapshots don't move the Rev — only sends do");
  // Legacy: two sends that both printed "Rev 1" under the old rule keep it; the next send is 2.
  const legacy = [R(1, "sent"), R(2, "sent")];
  ok(sentRevNo(legacy, legacy[0]) === 1 && sentRevNo(legacy, legacy[1]) === 1 && sentDocumentStamp({ revisions: legacy } as never, legacy[1] as never).revNo === 1,
    "oct15 #13: older sends keep the Rev their PDFs printed");
  ok(maxSentRevNo(legacy) === 1 && nextSendRevNo(legacy) === 2 && documentRevStamp({ revisions: legacy, status: "draft" }).revNum === 2, "oct15 #13: the next send after them is max + 1");
  ok(nextSendRevNo([R(1, "sent", 4), R(2, "manual"), R(3, "sent", 2)]) === 5, "oct15 #13: the next Rev is the max any send printed + 1, never a reuse");
  ok(documentRevStamp({ revisions: once, status: "draft", docRevNo: 1 }).revNum === 1, "oct15 #13: a quote shown as one sent revision prints that revision's Rev");
  const q = { revisions: [R(1, "sent", 1), R(2, "manual"), R(3, "sent", 2)], status: "draft", updatedAt: 5 } as never;
  ok(documentRevStamp(quoteAsOfRevision(q, (q as { revisions: never[] }).revisions[0])).revNum === 1, "oct15 #13: the as-sent view of Rev 1 still prints Rev 1 while the quote is being revised");
  const qs = rd("src/lib/stores/quotes.ts");
  ok(qs.includes('if (reason === "sent" && r.docFields) r.docFields = { ...r.docFields, revNo: nextSendRevNo(revs) };'), "oct15 #13: every sent revision (setStatus, a portal refresh, a bidder send's cut) stamps max + 1");
  ok(!rd("src/app/(app)/estimator/page.tsx").includes("revisions?.length || 1") && !rd("src/app/(app)/estimator/actions.ts").includes("revisions?.length || 1"),
    "oct15 #13: the Estimator header reads the same rule");
}

async function oct15RevDbChecks(ok: Ok) {
  const qid = fixtureId(FIX, "revq");
  await createFixture("quotes", buildQuote(qid, { name: "O15 rev", customer: "O15 Owner", customerId: CO.own, value: 1000 } as never, "system", null, Date.now()) as never);
  const sentRevs = async () => ((await getQuote(qid))?.revisions || []).filter((r) => r.reason === "sent");
  await setStatus(qid, "sent", "Pat", { bypassApprovalGate: "engine-owned-flow" });
  await setStatus(qid, "draft", "Pat");
  await addQuoteRevision(qid, { by: "Pat", reason: "manual" });
  const mid = await getQuote(qid);
  ok(!!mid && documentRevStamp(mid).revNum === 2, "oct15 #13 db: a revise of a once-sent quote prints Rev 2");
  await setStatus(qid, "sent", "Pat", { bypassApprovalGate: "engine-owned-flow" });
  await setStatus(qid, "draft", "Pat");
  await setStatus(qid, "sent", "Pat", { bypassApprovalGate: "engine-owned-flow" });
  const sr = await sentRevs();
  const q = await getQuote(qid);
  ok(sr.map((r) => r.docFields?.revNo).join() === "1,2,3" && !!q && documentRevStamp(q).revNum === 3 && sentDocumentStamp(q, sr[2]).revNo === 3,
    "oct15 #13 db: three sends stamp Rev 1, 2, 3 (a manual snapshot in between moves nothing): " + sr.map((r) => r.docFields?.revNo).join());
}

async function oct15ZipSpecDbChecks(ok: Ok) {
  const qid = fixtureId(FIX, "zipq");
  await createFixture("quotes", buildQuote(qid, { name: "O15 zip", customer: "O15 Owner", customerId: CO.own, value: 1000 } as never, "system", null, Date.now()) as never);
  await setStatus(qid, "sent", "Pat", { bypassApprovalGate: "engine-owned-flow" });
  const q = (await getQuote(qid))!;
  const rev = (q.revisions || []).find((r) => r.reason === "sent")!;
  const stub = async () => ({ files: [{ name: "Peak_Spec 11 61 43_Stage Curtains.docx", data: Buffer.from("DOCX-SP") }], skipped: ["SP-1999"] });
  const built = await buildRevisionPackageZip(q, rev, { read: async () => null, sections: async () => [], letterhead: async () => null, bookLetterhead: async () => null, specDocFiles: stub });
  const has = (t: string) => !!built && built.zip.includes(Buffer.from(t, "utf8"));
  ok(!!built && has("Peak_Spec 11 61 43_Stage Curtains.docx") && has("DOCX-SP") && !has("Specifications.docx") && built.specifications === true && has("Specification SP-1999"),
    "oct15 #17 db: the zip carries the SP Word file (no D94 Specifications.docx) and names a spec it couldn't build");
  const none = await buildRevisionPackageZip(q, rev, { read: async () => null, sections: async () => [], letterhead: async () => null, bookLetterhead: async () => null, specDocFiles: async () => ({ files: [], skipped: [] }) });
  ok(none === null, "oct15 #17 db: without SP files and with no D94 sections there is nothing to download, as before");
  const sp = await createSpecDocument({
    sectionId: "sec-none", header: { projectName: "O15", projectNumber: "", phase: "", issueDate: "", preparedBy: "" }, source: { kind: "quote", id: qid, quoteId: qid },
    products: [], printQuantities: false, fillIns: {}, createdBy: "t", updatedBy: "t",
  } as never);
  registerFixture("spec_documents", sp.id);
  const linked = await quoteSpecDocuments(qid);
  const k1 = specDocumentsKey(linked);
  await patchSpecDocument(sp.id, (d) => ({ ...d, fillIns: { "a#1": "x" } }), "t");
  ok(linked.length === 1 && linked[0].id === sp.id && specDocumentsKey(await quoteSpecDocuments(qid)) !== k1, "oct15 #17 db: a spec saved from the estimate is found, and editing it changes the zip's cache key");
}

async function oct15PeopleDbChecks(ok: Ok) {
  const mk = async (slug: string, extra: Record<string, unknown> = {}) => {
    const id = fixtureId(FIX, "people-" + slug);
    await createFixture("quotes", { id, name: "O15 people", customer: "", customerId: null, status: "draft", source: "estimator", quoteType: "system",
      owner: "Jena Tolksdorf", preparedBy: "Jena Tolksdorf", value: 200, margin: 0.5, history: [], createdAt: 1, updatedAt: 1, spec: { sections: [], mobs: [] }, ...extra } as never);
    return id;
  };
  const NIC = { name: "Nic Trapani", roles: ["Estimator"] };
  const JEFF = { name: "Jeff Chesebro", roles: ["Admin", "Estimator"] };
  const draft = await mk("draft");
  const d = await setQuotePeopleAs(draft, NIC, { preparedBy: "Nic Trapani" });
  ok(d.ok && (await getQuote(draft))?.preparedBy === "Nic Trapani", "oct15 #18 db: before the first send a non-approver may change Prepared by");
  const sent = await mk("sent", { history: [{ at: 2, from: "draft", to: "sent" }], revisions: [{ rev: 1, reason: "sent", at: 2 }] });
  const n1 = await setQuotePeopleAs(sent, NIC, { owner: "Nic Trapani" });
  const n2 = await setQuotePeopleAs(sent, NIC, { preparedBy: "Nic Trapani" });
  ok(!n1.ok && !n2.ok && n1.error === PEOPLE_LOCKED_AFTER_SEND && (await getQuote(sent))?.owner === "Jena Tolksdorf" && (await getQuote(sent))?.updatedAt === 1,
    "oct15 #18 db: after a send (now revising in Draft) a non-approver's change is refused, nothing written");
  const same = await setQuotePeopleAs(sent, NIC, { owner: "Jena Tolksdorf" });
  ok(same.ok && !same.changed, "oct15 #18 db: re-picking the same people is not a change");
  const j = await setQuotePeopleAs(sent, JEFF, { owner: "Nic Trapani", preparedBy: "Jason Keagy" });
  const after = await getQuote(sent);
  ok(j.ok && after?.owner === "Nic Trapani" && after.preparedBy === "Jason Keagy", "oct15 #18 db: an approver can still change both after the send");
}

export async function oct15DbChecks(ok: Ok) {
  try {
    await dropCompanies();
    await saveCompany({ id: CO.own, name: "O15 Owner", type: "customer", lifecycle: "active", deleted: false });
    await saveCompany({ id: CO.gc, name: "O15 GC", type: "customer", lifecycle: "active", deleted: false });
    await saveContact({ id: CO.ct, firstName: "Gee", lastName: "Cee", homeCompanyId: CO.gc });
    await setEmails(CO.ct, [{ value: "gee@o15.test", label: "work", isPrimary: true }] as never);
    await oct15BidDbChecks(ok);
    await oct15RevDbChecks(ok);
    await oct15ZipSpecDbChecks(ok);
    await oct15PeopleDbChecks(ok);
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
