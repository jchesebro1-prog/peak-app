/* Jeff's 2026-10-15 decisions — Batch 2 (Estimating & client output) harness checks
   (docs/decisions/2026-10-15-jeff-decisions.md items 2, 3, 4, 6, 12–15, 17–22).
   `oct15PureChecks` needs no database; `oct15DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-oct15-estimating.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { evaluateReviewLimit, largestAlternateTotal, reviewAmount, autoSnapshotUnchanged } from "../src/lib/review-limits";
import { addedAddendumNos, addendumDraftNote, addendumMovesToDraft, addendumReviseConfirm } from "../src/lib/parties/bids";
import { MAX_CLIENT_RESPONSES_TOTAL } from "../src/lib/estimate-output/responses";
import { awardBid } from "../src/lib/stores/bids";
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
import { specDocumentsForQuote, specDocumentsForRevision, specDocumentsKey, uniqueDocxName, quoteSpecDocuments, revisionSpecKey, zipKeyWithSpecs } from "../src/lib/estimate-output/package-spec-docs-server";
import { buildRevisionPackageZip } from "../src/lib/estimate-output/package-zip-server";
import { createSpecDocument, patchSpecDocument, stampSpecDocumentDownload } from "../src/lib/stores/spec-documents";
import { canChangeQuotePeople, quoteSentOnce, PEOPLE_LOCKED_AFTER_SEND } from "../src/lib/quote-people-lock";
import { setQuotePeopleAs } from "../src/lib/quote-people";
import { bonusRatesFrom, lineBonusPct, DEFAULT_BONUS_RATES } from "../src/lib/estimate-bonus/flags";
import { bonusRatesFor, withBonusLines, idCounterFrom } from "../src/lib/estimate-bonus/rules";
import { canonicalBonusSections } from "../src/lib/estimate-bonus/canonical";
import { GROUPS, setValue, loadBonusRates } from "../src/lib/stores/pricing";
import { flagOldVendorLine, OLD_VENDOR_PRICE_NOTE } from "../src/lib/narrative/system-library";
import { estimateReadiness, requoteCount } from "../src/lib/estimate-steps/readiness";
import { alternatingPhotoSides, keyProductPhotoStyle } from "../src/app/(app)/estimator/quote-document-view";
import { resolvePackageDoc } from "../src/lib/package-doc/resolve";
import { productImageFor } from "../src/lib/package-doc/seed";
import { sanitizePackageDoc } from "../src/lib/package-doc/sanitize";
import { DEFAULT_IMAGE } from "../src/lib/package-doc/schema";
import { walkPhotoSides } from "../src/lib/package-doc/photo-sides";
import { onlineShowsCutSheets } from "../src/lib/curtain-cut-sheets/online";
import { acceptanceLine, cleanPoNumber, sanitizeClientResponse, responseNoteText, responseRows, cleanClientResponses, CLIENT_ACTION_COPY } from "../src/lib/estimate-output/responses";
import { notifyPortalAcceptance, ACCEPT_SIGNER_NAME_COPY, ACCEPT_SIGNER_TITLE_COPY, ACCEPT_PO_NUMBER_COPY } from "../src/lib/portal-quotes";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { generateQuotePdf } from "../src/lib/quote-pdf/generate";
import { quoteDocumentDataFor } from "../src/lib/quote-pdf/quote-document-data";
import { pdfStorage } from "../src/lib/quote-pdf/storage";
import { revisionCopyPlan, pdfIsCurrent } from "../src/lib/quote-pdf/state";
import { updateQuotePdf } from "../src/lib/stores/quotes";
import { appendResponseTo, MAX_CLIENT_RESPONSES, responseQuoteLimitKey, type ClientResponse } from "../src/lib/estimate-output/responses";
import { DISCARD_COPY, discardConfirmText, draftChanged, inputIsDirty, isModalInputKind, MODAL_INPUT_KINDS, rebaseDraft, stableDraftJson } from "../src/lib/estimate-steps/discard-confirm";

const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const PTY = "pty_0123456789abcdef";
const PTY2 = "pty_fedcba9876543210";

export async function oct15PureChecks(ok: Ok) {
  oct15ReviewAmountChecks(ok);
  oct15RevChecks(ok);
  await oct15LetterheadChecks(ok);
  oct15BonusRateChecks(ok);
  /* ---- #15 — online Accept: signer name + title required, optional PO #, the Lead estimator is told ---- */
  {
    ok(cleanPoNumber("  PO-4481 ") === "PO-4481" && cleanPoNumber("") === "" && cleanPoNumber(undefined) === "" && cleanPoNumber("x".repeat(61)) === null && cleanPoNumber("4111 1111 1111 1111") === null && cleanPoNumber("4111-1111-1111-1111") === null,
      "oct15 #15: a PO number is one line, ≤ 60 characters, and never a card number");
    ok(cleanPoNumber("PO 4111 1111 1111 1111") === null && cleanPoNumber("Card 4111111111111111 please") === null, "I3: a card number inside the PO text is refused (Luhn scan of every digit run)");
    ok(cleanPoNumber("123456789012345") === "123456789012345" && cleanPoNumber("PO 1234-5678-9012-345") === "PO 1234-5678-9012-345", "I3: a real 15-digit PO that fails Luhn is accepted");
    ok(rd("src/lib/estimate-output/responses.ts").includes("if (looksLikeCardNumber(v)) return null;"), "I3: cleanPoNumber reuses the portal's looksLikeCardNumber");
    ok(acceptanceLine({ name: "Pat Doe", title: "Director", po: "4481" }) === "Accepted by Pat Doe, Director — PO 4481" && acceptanceLine({ name: "Pat Doe", title: "Director" }) === "Accepted by Pat Doe, Director",
      "oct15 #15: the notice reads \"Accepted by <name>, <title> — PO <po>\"");
    const scopes = [{ id: "s1", name: "Lighting", price: 100, priceLabel: "$100.00" }];
    const noTitle = sanitizeClientResponse("accept", { name: "Pat", sectionIds: ["s1"] }, scopes);
    const card = sanitizeClientResponse("accept", { name: "Pat", title: "Director", po: "4111111111111111", sectionIds: ["s1"] }, scopes);
    const good = sanitizeClientResponse("accept", { name: "Pat", title: "Director", po: " 4481 ", sectionIds: ["s1"] }, scopes);
    const q = sanitizeClientResponse("question", { name: "Pat", message: "Hi", po: "9" }, scopes);
    ok(!noTitle.ok && noTitle.error === CLIENT_ACTION_COPY.needTitle && !card.ok && card.error === CLIENT_ACTION_COPY.badPo && good.ok && good.value.po === "4481" && good.value.title === "Director" && q.ok && !("po" in q.value),
      "oct15 #15: the share page's accept needs a title, takes an optional PO (a card number refused); a question carries none");
    if (good.ok) {
      ok(responseNoteText(good.value, "EST-1", 2).split("\n")[1] === "Accepted by Pat, Director — PO 4481", "oct15 #15: the note / task for the Lead estimator names the signer and PO");
      const stored = cleanClientResponses([{ ...good.value, id: "CR-0123456789ab", rev: 1, at: 5 }]);
      ok(stored[0]?.po === "4481" && responseRows(stored, (v) => v)[0].who.endsWith("PO 4481"), "oct15 #15: the PO is stored with the response and shown on Client link");
    }
    const sel = rd("src/app/share/quote/[id]/[token]/scope-selection.tsx");
    ok(/aria-label=\{CLIENT_ACTION_COPY\.title\}[^>]* required /.test(sel) && sel.includes("aria-label={CLIENT_ACTION_COPY.poNumber}") && sel.includes("{ name, title, po, email"),
      "oct15 #15: the share page's Choose your scopes form requires the title and offers a PO #");
    const dlg = rd("src/app/portal/accept-dialog.tsx");
    ok(dlg.includes('id="pk-accept-name"') && dlg.includes('id="pk-accept-title"') && dlg.includes('id="pk-accept-po"') && dlg.includes("signerName, signerTitle, poNumber })"),
      "oct15 #15: the portal Accept dialog asks for name, title and PO #");
    const pq = rd("src/lib/portal-quotes.ts");
    const acc = pq.slice(pq.indexOf("export async function acceptPortal("), pq.indexOf("export async function notifyPortalAcceptance("));
    ok(acc.indexOf("ACCEPT_SIGNER_NAME_COPY") > 0 && acc.indexOf("ACCEPT_SIGNER_NAME_COPY") < acc.indexOf("rateLimit(") && acc.indexOf("rateLimit(") < acc.indexOf("updateQuote(") && acc.indexOf("updateQuote(") < acc.indexOf("notifyPortalAcceptance)("),
      "oct15 #15: acceptPortal validates the signer before the rate limit and the write, then tells the Lead estimator");
  }
  /* ---- #22 — the online estimate shows cut sheets when the PDF includes them ---- */
  {
    ok(onlineShowsCutSheets({ pdfCutSheets: true }, null, 100) && onlineShowsCutSheets({ pdfCutSheets: true }, 100, 100), "oct15 #22: the sent revision's Cut sheets toggle on → the online pages show them");
    ok(!onlineShowsCutSheets({ pdfCutSheets: false }, null, 100) && !onlineShowsCutSheets(null, null, 100) && !onlineShowsCutSheets({}, null, 100), "oct15 #22: off (the default) → none");
    ok(!onlineShowsCutSheets({ pdfCutSheets: true }, 101, 100), "oct15 #22: the print route's rule — edited since the revision, the live-built sheets would disagree, so none");
    const on = rd("src/lib/curtain-cut-sheets/online.ts");
    ok(on.includes('loadCutSheets(q.id, { images: "data" })') && on.includes("CUT_SHEET_APPEND_LOAD_MS") && on.includes("loaded.models.client.length > 0"), "oct15 #22: the online pages load the Client sheets with inlined photos, capped at 8 s");
    const share = rd("src/app/share/quote/[id]/[token]/page.tsx"), portal = rd("src/app/portal/quotes/[id]/page.tsx"), pkg = rd("src/app/share/quote/[id]/[token]/package-page.tsx");
    ok(share.includes("await onlineCutSheets(ok.q, ok.rev)") && portal.includes("await onlineCutSheets(q, state.rev)") && pkg.includes("await onlineCutSheets(hit.q, hit.rev)") &&
       [share, portal, pkg].every((t) => t.includes("<OnlineCutSheets loaded={")) && rd("src/components/estimate-output/package-view.tsx").includes('{slots.cutSheets && <section data-mount="cutsheets"'),
      "oct15 #22: the v1 share page, the portal page and the package page each show them for their sent revision");
    ok(!/["']use client["']/.test(rd("src/components/cutsheets/online-cut-sheets.tsx")), "oct15 #22: the cut-sheet block is a server component");
  }
  /* ---- #20 — narrative photos alternate right, left, right ---- */
  {
    const sides = alternatingPhotoSides(["a|1", "a|2", "b|1", "a|1"]);
    ok(sides.get("a|1") === "right" && sides.get("a|2") === "left" && sides.get("b|1") === "right" && sides.size === 3, "oct15 #20: printed photos alternate right, left, right in document order");
    ok(keyProductPhotoStyle("right").float === "right" && keyProductPhotoStyle("right").margin === "0 0 8px 14px" && keyProductPhotoStyle("left").float === "left" && keyProductPhotoStyle("left").margin === "0 14px 8px 0",
      "oct15 #20: the first photo keeps #293's right float; the next mirrors it");
    const qd = rd("src/app/(app)/estimator/quote-document.tsx");
    ok(qd.includes("style={keyProductPhotoStyle(photoSides?.get(ps.id + \"|\" + kp.sku) ?? \"right\")}") && qd.includes("[...previewSections, ...alternateGroups.flatMap((ag) => ag.systems.map((x) => x.ps))]"),
      "oct15 #20: the PDF / online document numbers photos across the body's narrative systems, then the alternates");
    const pv = rd("src/components/estimate-output/package-view.tsx");
    ok(pv.includes(".pkg-kp.pkg-kp-left img { float: left;") && pv.includes("<style>{PACKAGE_LEFT_PHOTO_CSS}</style>}") && pv.includes('className={kp.side === "left" ? "pkg-kp pkg-kp-left" : "pkg-kp"}') && rd("src/lib/estimate-output/package-model.ts").includes("n++ % 2 === 1"),
      "oct15 #20: the package page alternates too (stacked on a phone)");
    // The TipTap document: a new image is "auto" and alternates; an explicit choice wins.
    ok(DEFAULT_IMAGE.align === "auto" && productImageFor("s1", 1, "A").attrs.align === "auto" && productImageFor("s1", 1, "A", { align: "left" }).attrs.align === "left", "oct15 #20: a new document image defaults to Auto");
    const photos = { A: { src: "/a", alt: "" }, B: { src: "/b", alt: "" }, C: { src: "/c", alt: "" }, D: { src: "/d", alt: "" } };
    const sections = [{ id: "s1", name: "S", kind: "materials", mfr: "", freightPct: 0, items: ["A", "B", "C", "D"].map((sku, i) => ({ id: i + 1, sku, desc: sku, qty: 1, unit: "ea", cost: 1, price: 2 })) }];
    const img = (sku: string, n: number, align?: "left" | "right" | "full" | "auto") => productImageFor("s1", n, sku, align ? { align } : undefined);
    const ctx = { sections, t: { grand: 0, tax: 0, credit: 0 }, quoteId: "Q", photos } as never;
    const aligns = (content: unknown[]) => resolvePackageDoc({ type: "doc", version: 1, content } as never, ctx).blocks.map((b) => (b as { photo?: { align: string } }).photo?.align).join();
    ok(aligns([img("A", 1), img("B", 2), img("C", 3)]) === "right,left,right", "oct15 #20: Auto images alternate right, left, right");
    ok(aligns([img("A", 1), img("B", 2, "right"), img("C", 3), img("D", 4, "full")]) === "right,right,left,full", "oct15 #20: an explicit choice wins and the next Auto image goes opposite it");
    ok(aligns([img("A", 1, "left"), img("B", 2)]) === "left,right", "oct15 #20: after an explicit Left, Auto goes right");
    const saneOld = sanitizePackageDoc({ type: "doc", version: 1, content: [{ type: "productImage", attrs: { sectionId: "s1", lineKey: "1", sku: "A", align: "right", width: 34 } }] });
    ok(!!saneOld && (saneOld as { content: Array<{ attrs: { align: string } }> }).content[0].attrs.align === "right", "oct15 #20: an existing image's stored Right is kept (older documents print as before)");
    ok(rd("src/components/package-doc/editor/product-image-view.tsx").includes('[["auto", "Auto"], ["left", "Left"], ["right", "Right"], ["full", "Full"]]'), "oct15 #20: the image strip offers Auto");
    ok(JSON.stringify(walkPhotoSides(["auto", null, "auto", "right", "auto", "full", "auto"])) === JSON.stringify(["right", null, "left", "right", "left", "full", "right"]),
      "M4: one alternation rule — Auto opposite the last printed side, an explicit side sets it, Full and photo-less blocks leave it");
    const piv = rd("src/components/package-doc/editor/product-image-view.tsx");
    ok(piv.includes("walkPhotoSides(items)[at]") && piv.includes("...wrapperStyle(shown),") && rd("src/lib/package-doc/resolve.ts").includes("resolveAutoAlign(\"auto\", last)"),
      "M4: the editor previews an Auto image on the side the print gives it (the same walk as resolvePackageDoc)");
  }
  /* ---- #21 — Load system brings vendor-quoted lines, flagged "Old vendor price — re-quote" ---- */
  {
    const orig = { id: 4, sku: "VQ-1", desc: "Vendor rig", qty: 2, unit: "ea", cost: 500, price: 700, extSellOverride: 1500, vendorQuoteId: "vq1", noFreight: true, internalNote: "from Acme" } as never;
    const copied = { id: 4, sku: "VQ-1", desc: "Vendor rig", qty: 2, unit: "ea", cost: 500, price: 655, vendorQuoteId: "vq1", noFreight: true, internalNote: "from Acme" } as never;
    const f = flagOldVendorLine(copied, orig) as unknown as Record<string, unknown>;
    ok(f.cost === 500 && f.price === 700 && f.extSellOverride === 1500 && !("vendorQuoteId" in f) && f.noFreight === true && f.internalNote === "Old vendor price — re-quote · from Acme",
      "oct15 #21: a loaded vendor line keeps its last price (cost, sell, typed ext), drops the source's vendor-quote link, and is flagged");
    const g = flagOldVendorLine(f as never, f as never) as unknown as Record<string, unknown>;
    ok(OLD_VENDOR_PRICE_NOTE === "Old vendor price — re-quote" && g.internalNote === "Old vendor price — re-quote · from Acme", "oct15 #21: loading it again doesn't stack the flag");
    ok(f.custom === true, "M3: a flagged vendor line becomes a custom line (no vendor-quote record behind it), keeping its note");
    const secsRq = [{ id: "s", name: "S", kind: "materials", mfr: "", freightPct: 0, items: [f, { ...(f as object), id: 5, internalNote: "" }, { id: 6, sku: "X", desc: "x", qty: 1, unit: "ea", cost: 1, price: 2 }] }] as never;
    const rdy = (status: string) => estimateReadiness({ saved: true, sections: secsRq, review: { label: "Approved", tone: "approved" }, status: status as never, revNum: 1 }).send;
    ok(requoteCount(secsRq) === 1 && rdy("draft").state === "gaps" && rdy("draft").label === "Ready to send · ⚠ 1 line needs a re-quote" && rdy("sent").label.startsWith("Sent"),
      "M3: Send & track's readiness line warns \"N lines need a re-quote\" on a draft (a warning, never a block); clearing the note clears it");
    ok(rd("src/lib/narrative/load-system.ts").includes("flagOldVendorLine(it, originals.get(it.id)!)") && !rd("src/lib/narrative/system-library.ts").includes("items.filter((it) => !it.vendorQuoteId)"),
      "oct15 #21: Load keeps vendor lines and flags each after re-pricing");
  }
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
    ok(specDocumentsForRevision([{ downloadedAt: 50 }, { downloadedAt: 100 }, { downloadedAt: 101 }, {}] as never[], 100).length === 2,
      "I2: a revision's zip carries only specs downloaded at or before its send (never a draft or a later one)");
    ok(specDocumentsKey([{ id: "SP-1", updatedAt: 1, downloadedAt: 5, letterheadKey: "aa" }]) !== specDocumentsKey([{ id: "SP-1", updatedAt: 1, downloadedAt: 6, letterheadKey: "aa" }]) &&
       specDocumentsKey([{ id: "SP-1", updatedAt: 1, downloadedAt: 5, letterheadKey: "aa" }]) !== specDocumentsKey([{ id: "SP-1", updatedAt: 1, downloadedAt: 5, letterheadKey: "bb" }]),
      "I2: the cache key follows each spec's download and the letterhead it prints");
    const sdm = rd("src/lib/estimate-output/package-spec-docs-server.ts");
    ok(!sdm.includes("allSpecDocuments") && sdm.includes("specDocumentsWithQuoteSource(quoteId)") && rd("src/lib/stores/spec-documents.ts").includes('listDocsWhere<Doc>("spec_documents"'),
      "I2/M5: the zip reads only the specs whose source quote matches, filtered in SQL");
    ok(zipKeyWithSpecs("ab12cd34", "") === "ab12cd34" && /^[0-9a-f]{8}$/.test(zipKeyWithSpecs("ab12cd34", "0011aabb")) && zipKeyWithSpecs("ab12cd34", "0011aabb") !== "ab12cd34",
      "oct15 #17: a zip with no SP specs keeps its cache key; with them the key folds them in");
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
    ok(pm.includes("...(d.pdfQty === false ? { showQty: false } : {}),") && pm.includes('d.pdfQty === false ? { ...r, qty: null, unit: "" } : r') && pv.includes("showQty || i > 0") && pv.includes("{showQty && <td className=\"pkg-qty\">"),
      "oct15 #14: the package page's BOM drops its Qty column (and quantities) when the PDF hides them");
  }
  /* ---- #3 / #4 (pure + pins) ---- */
  {
    ok(JSON.stringify(addedAddendumNos([{ no: 1 }], [{ no: 1 }, { no: 3 }, { no: 2 }])) === "[2,3]" && addedAddendumNos(null, []).length === 0 && addedAddendumNos([{ no: 1 }, { no: 2 }], [{ no: 1 }]).length === 0,
      "oct15 #3: only new addendum numbers count (a removal adds none) — #348's addedAddendumNos");
    ok(addendumDraftNote([2]).includes("Send revision to all bidders") && addendumMovesToDraft("sent", [2]) && !addendumMovesToDraft("sent", [2], true),
      "oct15 #3 / M2: the chip's note names \"Send revision to all bidders\"; an awarded bid never moves to Draft");
    const chip0 = rd("src/app/(app)/estimator/bid-chip.tsx");
    ok(addendumReviseConfirm([2]).startsWith("Addendum 2 came in after this estimate was sent.") && chip0.includes("wasSent && !panel.awardedPartyId && added.length > 0 && !window.confirm(addendumReviseConfirm(added))"),
      "M2: the Bid chip asks before an addendum reverts a sent bid (not on an awarded one)");
    const B = (revSent: number | null) => ({ result: "pending", submitVia: "email", revSent, failed: null }) as never;
    const revs = { status: "draft", revisions: [{ rev: 1, reason: "sent" }] };
    const plan = bidderSendPlan(revs, [{ id: "a", bid: B(1), email: "a@e.test" }, { id: "b", bid: B(null), email: "b@e.test" }]);
    ok(plan.label === "Send revision to all bidders" && plan.label === BID_SEND_COPY.sendRevision && plan.ids.join() === "a,b", "oct15 #3: a revising bid sends the revision to every bidder (new ones too)");
    const st = rd("src/lib/stores/bids.ts");
    ok(st.includes("if (!addendumMovesToDraft(q.status, added, !!q.bid?.awardedPartyId)) return { ok: true as const, bid: saved.bid };") && st.indexOf("withQuoteRowLock(quoteId") < st.indexOf('await setStatus(quoteId, "draft"'),
      "oct15 #3: the revise is the normal setStatus(\"draft\") under the bid's row lock");
    const chip = rd("src/app/(app)/estimator/bid-chip.tsx");
    ok(chip.includes("onSync?.(r.sync);") && chip.includes('source: "chip"') && rd("src/app/(app)/estimator/steps/bidders-card.tsx").includes('detail.source === "chip"'),
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
    const pty = (n: number) => "pty_" + n.toString(16).padStart(16, "0");
    const mixed = Array.from({ length: MAX_CLIENT_RESPONSES_TOTAL }, (_, i) => r(i + 1, i % 10 === 0 ? undefined : pty(i % 10)));
    ok(MAX_CLIENT_RESPONSES_TOTAL === 1000 && appendResponseTo(mixed, r(99_001, pty(11))) === null && appendResponseTo(mixed.slice(1), r(99_002, pty(11)))?.length === MAX_CLIENT_RESPONSES_TOTAL,
      "M1: the quote's whole list caps at 1,000 — a submit past it is refused, nothing old is dropped");
    const srv = rd("src/lib/estimate-output/responses-server.ts");
    ok(srv.includes("rateLimit(responseQuoteBucket(hit.q.id, bidder?.partyId), RESPONSE_QUOTE_LIMIT, RESPONSE_QUOTE_WINDOW_MS)") && !srv.includes("`share-respond-quote:${hit.q.id}`"),
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

/* ---- #19 — the 5 % / 2 % bonus rates live in Estimating Rules; drafts only ---- */
function oct15BonusRateChecks(ok: Ok) {
  ok(JSON.stringify(bonusRatesFrom(undefined, null)) === JSON.stringify(DEFAULT_BONUS_RATES) && bonusRatesFrom(6, 2.5).packagePct === 0.06 && bonusRatesFrom(6, 2.5).estimatorPct === 0.025,
    "oct15 #19: stored percent numbers → fractions; missing → 5 % / 2 %");
  ok(bonusRatesFrom(21, -1).packagePct === 0.05 && bonusRatesFrom(21, -1).estimatorPct === 0.02 && bonusRatesFrom(20, 0).packagePct === 0.2 && bonusRatesFrom(20, 0).estimatorPct === 0,
    "oct15 #19: outside 0–20 % falls back to the default (the editor also clamps)");
  const grp = GROUPS.find((g) => g.key === "bonuses");
  const items = (grp?.items || []) as Array<{ id: string; min?: number; max?: number; def?: number }>;
  ok(!!grp && items.some((i) => i.id === "bonus.packagePct" && i.min === 0 && i.max === 20 && i.def === 5) && items.some((i) => i.id === "bonus.estimatorPct" && i.min === 0 && i.max === 20 && i.def === 2),
    "oct15 #19: Estimating Rules → Estimator bonuses edits both, 0–20 %, defaults 5 / 2");
  const s = [{ id: "s1", name: "R", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "P", desc: "P", qty: 1, unit: "ea", cost: 100, price: 150 }, { id: 2, sku: "L", desc: "L", qty: 1, unit: "hr", cost: 100, price: 150, labor: true }] }] as never;
  const def = withBonusLines(s, idCounterFrom(s));
  const est = (secs: never) => (secs as { items: Array<{ bonus?: string; price: number; bonusPct?: number; desc: string }> }[])[0].items.find((i) => i.bonus === "estimator")!;
  const pkg = (secs: never) => (secs as { items: Array<{ bonus?: string; cost: number; bonusPct?: number; desc: string }> }[])[0].items.find((i) => i.bonus === "package")!;
  ok(!("bonusPct" in est(def as never)) && pkg(def as never).desc === "Package bonus — 5% of system cost" && est(def as never).desc === "Estimator bonus — 2% of system price",
    "oct15 #19: default-rate lines are byte-identical to before (no bonusPct key, same text)");
  const r = { packagePct: 0.06, estimatorPct: 0.03 };
  const custom = withBonusLines(s, idCounterFrom(s), r);
  ok(pkg(custom as never).cost === 12 && pkg(custom as never).bonusPct === 0.06 && est(custom as never).bonusPct === 0.03 && pkg(custom as never).desc === "Package bonus — 6% of system cost",
    "oct15 #19: a draft figures its lines at the Estimating Rules rates and records them on the line");
  ok(JSON.stringify(bonusRatesFor("draft", custom as never, DEFAULT_BONUS_RATES)) === JSON.stringify(DEFAULT_BONUS_RATES) && JSON.stringify(bonusRatesFor(undefined, def as never, r)) === JSON.stringify(r),
    "oct15 #19: a draft (or new estimate) takes the current rates");
  ok(JSON.stringify(bonusRatesFor("sent", custom as never, DEFAULT_BONUS_RATES)) === JSON.stringify(r) && JSON.stringify(bonusRatesFor("sent", def as never, r)) === JSON.stringify(DEFAULT_BONUS_RATES),
    "oct15 #19: a sent quote keeps the rates its lines were figured at, whatever Settings says now");
  const sentRe = canonicalBonusSections({ source: "estimator", status: "sent" }, def as never, r);
  ok(sentRe === def, "oct15 #19: re-saving a sent quote at new rates leaves its bonus lines (and price) untouched");
  ok(canonicalBonusSections({ source: "estimator", status: "won" }, def as never, r) === def && lineBonusPct({ bonus: "estimator" }) === 0.02, "oct15 #19: won / lost never re-derive; a line without bonusPct reads its default");
  const acts = rd("src/app/(app)/estimator/actions.ts");
  ok((acts.match(/canonicalBonusSections\([^\n]*await loadBonusRates\(\)\)/g) || []).length === 3 && rd("src/lib/assessments/quote-from-findings.ts").includes("[section], await loadBonusRates())"),
    "oct15 #19: every server write of an Estimator quote's sections passes the current rates");
}

/* ---- #13 — every send gets the next Rev; numbers never repeat ---- */
export function oct15RevChecks(ok: Ok) {
  // #352 review I1 — the copy step's plan.
  const rv = (revNo?: number, extra: Record<string, unknown> = {}) => ({ rev: 2, at: 100, reason: "sent", ...(revNo ? { docFields: { revNo } } : {}), ...extra });
  const pdf = (savedAt: number, revNum?: number) => ({ savedAt, ...(revNum ? { printed: { revNum, revDateMs: savedAt } } : {}) });
  ok(revisionCopyPlan(rv(2), pdf(90, 2), 80) === "copy" && revisionCopyPlan(rv(2), pdf(90), 80) === "copy" && revisionCopyPlan(rv(), pdf(90, 1), 80) === "copy",
    "I1: a pre-send file copies when it printed the stamped Rev (or either is unknown — older revisions)");
  ok(revisionCopyPlan(rv(2), pdf(90, 1), 80) === "rerender" && revisionCopyPlan(rv(2), pdf(90, 1), 150) === "wait",
    "I1: a pre-send file with another Rev is refused — re-rendered while nothing printed changed since the send, else left");
  ok(revisionCopyPlan(rv(2), pdf(120, 2), 80) === "copy" && revisionCopyPlan(rv(2), pdf(120, 1), 80) === "wait" && revisionCopyPlan(rv(2), pdf(120, 2), 110) === "wait" && revisionCopyPlan(rv(), pdf(120, 2), 80) === "wait",
    "I1: a post-send file copies only when unchanged since the send and printing exactly the stamped Rev — never a loop");
  ok(revisionCopyPlan(rv(2, { pdfBlobPath: "x" }), pdf(90, 2), 80) === "wait" && revisionCopyPlan({ rev: 2, at: 100, reason: "manual" }, pdf(90, 2), 80) === "wait", "I1: a copied or non-sent revision is left alone");
  const qsrc = rd("src/lib/stores/quotes.ts");
  ok(qsrc.includes("if (r && typeof stamped === \"number\" && typeof printedRev === \"number\" && printedRev !== stamped) return;") && qsrc.includes("if (out && revised.value) await scheduleRevisePdfSafely(id);"),
    "I1: setRevisionPdfPath never overwrites a stamped Rev; every revise schedules a render");
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

/* ---- #352 review I1 — a revise resent with no edits never reprints the old Rev ---- */
async function oct15ResendDbChecks(ok: Ok) {
  const keys = ["BLOB_READ_WRITE_TOKEN", "VERCEL", "QUOTE_PDF_DIR"] as const;
  const prev = keys.map((k) => [k, process.env[k]] as const);
  delete process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.VERCEL;
  const root = mkdtempSync(join(tmpdir(), "quote-pdfs-o15-"));
  process.env.QUOTE_PDF_DIR = root;
  try {
    const qid = fixtureId(FIX, "resend");
    const sec = { id: "sysR", name: "O15 resend", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "O15R", desc: "Fixture", qty: 1, unit: "ea", cost: 10, price: 20 }] };
    await createFixture("quotes", buildQuote(qid, { name: "O15 resend", customer: "O15 Owner", customerId: CO.own, value: 20, spec: { sections: [sec], mobs: [] } } as never, "system", null, Date.now()) as never);
    const SET = { companyName: "Peak Systems Group", logoDark: null };
    const render = async () => Buffer.from(`%PDF-1.4 o15 Rev ${quoteDocumentDataFor((await getQuote(qid))!, null, SET).revNum}`);
    const renderAt = async (savedAt: number) => generateQuotePdf({ quoteId: qid, savedAt, origin: "http://print.test", secret: "o15-secret", render });
    const tick = () => new Promise<void>((r) => setTimeout(r, 5));
    const fileOf = async () => {
      const p = (await getQuote(qid))?.revisions?.filter((r) => r.reason === "sent").at(-1)?.pdfBlobPath;
      const store = pdfStorage();
      return p && !("unavailable" in store) ? (await store.read(p))?.toString() ?? null : null;
    };
    // Send 1: save → render (Rev 1) → send → the copy carries Rev 1.
    const s1 = Date.now();
    await updateQuotePdf(qid, (cur) => ({ status: "pending", at: s1, savedAt: s1, ...(cur?.blobPath ? { blobPath: cur.blobPath } : {}) }));
    await renderAt(s1);
    await tick();
    await setStatus(qid, "sent", "Pat", { bypassApprovalGate: "engine-owned-flow" });
    const q1 = (await getQuote(qid))!;
    const ready1 = q1.pdf!;
    ok(q1.revisions?.at(-1)?.docFields?.revNo === 1 && (await fileOf()) === "%PDF-1.4 o15 Rev 1", "I1 db: the first send carries Rev 1 (revision and file)");
    // Revise with no edits: the PDF is re-scheduled (outside a request: marked stale), so Send waits for a fresh render.
    await tick();
    await setStatus(qid, "draft", "Pat");
    const q2 = (await getQuote(qid))!;
    ok(q2.pdf?.status === "pending" && !pdfIsCurrent(q2.pdf, q2.contentChangedAt), "I1 db: a revise re-schedules the PDF — Send waits for a fresh render");
    // The reviewer's case: the old Rev 1 file is still the current one when the resend lands (no edits, no re-render).
    await updateQuotePdf(qid, () => ready1);
    await tick();
    await setStatus(qid, "sent", "Pat", { bypassApprovalGate: "engine-owned-flow" });
    const q3 = (await getQuote(qid))!;
    const rev2 = q3.revisions!.filter((r) => r.reason === "sent").at(-1)!;
    ok(rev2.docFields?.revNo === 2 && !rev2.pdfBlobPath && q3.pdf?.status === "pending",
      "I1 db: the resend stamps Rev 2 and refuses the Rev 1 file — the copy step schedules a re-render instead");
    // The re-render (status sent → prints Rev 2) is copied onto the revision.
    await renderAt(q3.pdf!.savedAt);
    const q4 = (await getQuote(qid))!;
    const rev2b = q4.revisions!.filter((r) => r.reason === "sent").at(-1)!;
    ok(!!rev2b.pdfBlobPath && rev2b.docFields?.revNo === 2 && q4.pdf?.printed?.revNum === 2 && (await fileOf()) === "%PDF-1.4 o15 Rev 2",
      "I1 db: after the re-render both the revision and its PDF read Rev 2");
    ok((q4.revisions || []).find((r) => r.rev === 1)?.docFields?.revNo === 1, "I1 db: the first send still reads Rev 1");
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    rmSync(root, { recursive: true, force: true });
  }
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
  ok(linked.length === 1 && linked[0].id === sp.id, "oct15 #17 db: a spec saved from the estimate is found (filtered by its source quote)");
  ok((await revisionSpecKey(qid, rev.at)) === "", "I2 db: a spec never downloaded is a draft — not in the sent revision's zip (empty spec key)");
  await stampSpecDocumentDownload(sp.id, {}, rev.at - 1);
  const k1 = await revisionSpecKey(qid, rev.at);
  ok(/^[0-9a-f]{8}$/.test(k1), "I2 db: a spec downloaded before the send is in that revision's zip");
  await patchSpecDocument(sp.id, (d) => ({ ...d, fillIns: { "a#1": "x" } }), "t");
  const k2 = await revisionSpecKey(qid, rev.at);
  await stampSpecDocumentDownload(sp.id, {}, rev.at + 60_000);
  ok(k2 !== k1 && (await revisionSpecKey(qid, rev.at)) === "", "I2 db: an edit re-keys the cache; a spec next downloaded after the send drops out of that revision's zip");
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
    await oct15ResendDbChecks(ok);
    await oct15ZipSpecDbChecks(ok);
    await oct15PeopleDbChecks(ok);
    {
      // #15: the Lead estimator's to-do for a portal acceptance (no system mailbox to email from).
      const made: Array<{ title: string; assigneeName?: string; notes?: string; quoteId?: string }> = [];
      const users = [{ id: "u-lead", name: "Lead O15", status: "active", roles: ["Estimator"] }, { id: "u-appr", name: "Appr O15", status: "active", roles: ["Admin"] }, { id: "u-mgr", name: "Mgr O15", status: "active", roles: ["Manager"] }];
      const q = { id: "Q-O15", estNo: 1015, name: "Stage", owner: "Lead O15", preparedBy: "", customerId: "C-1", quoteType: "system" } as never;
      await notifyPortalAcceptance(q, { signerName: "Pat Doe", signerTitle: "Director", poNumber: "4481" }, Date.UTC(2026, 9, 15, 15), {
        users: async () => users, createTask: (async (input: { title: string; assigneeName?: string; notes?: string; quoteId?: string }) => { made.push(input); return input; }) as never,
      });
      ok(made.length === 1 && made[0].assigneeName === "Lead O15" && made[0].title === "EST-1015 accepted online — Accepted by Pat Doe, Director — PO 4481" && made[0].quoteId === "Q-O15" && !!made[0].notes?.startsWith("Accepted by Pat Doe, Director — PO 4481."),
        "oct15 #15 db: the Lead estimator gets one to-do: \"Accepted by <name>, <title> — PO <po>\": " + JSON.stringify(made[0]?.title));
      const none: typeof made = [];
      await notifyPortalAcceptance({ ...(q as object), owner: "Nobody Here" } as never, { signerName: "Pat", signerTitle: "Dir", poNumber: "" }, Date.now(), {
        users: async () => users, createTask: (async (input: { title: string }) => { none.push(input); return input; }) as never,
      });
      ok(none.length === 1 && none[0].assigneeName === "Appr O15" && none[0].title.endsWith("Accepted by Pat, Dir"), "oct15 #15 db / M6: no Lead estimator on the roster → the admins only (a Manager approver gets nothing)");
      ok(ACCEPT_SIGNER_NAME_COPY.length > 0 && ACCEPT_SIGNER_TITLE_COPY.length > 0 && ACCEPT_PO_NUMBER_COPY.length > 0, "oct15 #15: refusal copy exists");
    }
    {
      const before = await loadBonusRates();
      await setValue("bonus.packagePct", 99);
      const clamped = await loadBonusRates();
      await setValue("bonus.packagePct", before.packagePct * 100);
      ok(clamped.packagePct === 0.2, "oct15 #19 db: the Estimating Rules store clamps a typed rate to 20 %");
    }
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
  ok(d0.ok && !d0.backToDraft && (await getQuote(qid))?.status === "draft", "oct15 #3: an addendum on a draft just saves");
  await setStatus(qid, "sent", "Pat", { bypassApprovalGate: "engine-owned-flow" });
  await recordBidderSend(qid, a.party.id, { threadId: "C-o15", rev: 1, at: NOW, by: "Pat", to: "gc@e.test" }, { kind: "sent" }, "u1");
  const d1 = await setBidDetails(qid, { dueAt: NOW + 86_400_000 }, "Pat");
  ok(d1.ok && !d1.backToDraft && (await getQuote(qid))?.status === "sent", "oct15 #3: a due-date change on a sent bid leaves it Sent");
  const d2 = await setBidDetails(qid, { addenda: [A1, A2] }, "Pat");
  const q2 = await getQuote(qid);
  ok(d2.ok && JSON.stringify(d2.backToDraft) === "[2]" && q2?.status === "draft" && q2.history?.at(-1)?.from === "sent" && q2.history?.at(-1)?.to === "draft",
    "oct15 #3: a new addendum on a sent bid puts it back to Draft through setStatus (history sent → draft)");
  ok((q2?.revisions || []).filter((r) => r.reason === "sent").length === 1, "oct15 #3: the revise cuts no revision — the next send does");
  const panel = await loadBidPanel(qid, { canEdit: true, canSend: true, canLink: true });
  ok(panel.ok && panel.panel.plan.label === "Send revision to all bidders" && panel.panel.bidders[0]?.sendLabel === "Send revision",
    "oct15 #3: the Bidders card then offers \"Send revision to all bidders\": " + (panel.ok ? String(panel.panel.plan.label) : panel.error));
  const d3 = await setBidDetails(qid, { addenda: [A1, A2] }, "Pat");
  ok(d3.ok && !d3.backToDraft, "oct15 #3: re-saving the same addenda changes nothing");
  // M2: on an awarded bid an addendum is recorded and the estimate stays Sent.
  await setStatus(qid, "sent", "Pat", { bypassApprovalGate: "engine-owned-flow" });
  const aw = await awardBid(qid, a.party.id);
  const A3 = { no: 3, receivedAt: Date.UTC(2026, 9, 5, 17), note: "" };
  const d4 = await setBidDetails(qid, { addenda: [A1, A2, A3] }, "Pat");
  ok(aw.ok && d4.ok && !d4.backToDraft && (await getQuote(qid))?.status === "sent" && (d4.ok ? d4.bid.addenda.length === 3 : false),
    "M2 db: an addendum on an awarded bid is recorded and the estimate stays Sent (no revert)");
}

/** #348 follow-up (Jeff 2026-10-15) — the Estimator pop-ups ask before a stray click discards unsaved work. Pure + pins. */
export function discardConfirmChecks(ok: Ok) {
  // Pure: the dirty comparison.
  const fresh = { id: "VQ-1", vendor: "", lines: [{ id: 1, qty: "1", amount: "" }], pdfRead: null, extracted: null, total: "" };
  const base = stableDraftJson(fresh);
  ok(!draftChanged(base, { ...fresh }) && !inputIsDirty({ baseline: base, current: structuredClone(fresh) }), "discard: a fresh, untouched draft is clean");
  ok(draftChanged(base, { ...fresh, vendor: "Acme" }) && draftChanged(base, { ...fresh, lines: [{ id: 1, qty: "2", amount: "" }] }), "discard: an edited field (top-level or in a line) is dirty");
  ok(draftChanged(base, { ...fresh, pdfRead: { runId: "r1", filled: 3 } }) && draftChanged(base, { ...fresh, extracted: { runId: "r1" } }), "discard: a PDF read present (pdfRead / extracted) is dirty");
  const reordered = { total: "", extracted: null, pdfRead: null, lines: [{ amount: "", qty: "1", id: 1 }], vendor: "", id: "VQ-1" };
  ok(!draftChanged(base, reordered), "discard: key order (top-level and nested) doesn't count");
  ok(!draftChanged(base, { ...fresh, note: undefined }) && !draftChanged(stableDraftJson({ ...fresh, note: undefined }), fresh), "discard: undefined vs missing doesn't count (either way)");
  ok(draftChanged(base, { ...fresh, total: null }), "discard: null is not missing (a cleared value counts)");
  ok(!draftChanged(null, { ...fresh, vendor: "x" }) && !draftChanged(undefined, { vendor: "x" }), "discard: no baseline yet (still settling) is clean");
  ok(inputIsDirty({ baseline: base, current: fresh, reading: true }) && !inputIsDirty({ baseline: base, current: fresh, reading: false }), "discard: a Read the PDF in progress is dirty on its own");
  const fill = (d: typeof fresh) => (d.id !== "VQ-1" ? d : { ...d, vendor: d.vendor || "Filled Co" });
  const rebased = rebaseDraft<typeof fresh>(base, fill);
  ok(!draftChanged(rebased, fill(fresh)) && draftChanged(rebased, { ...fill(fresh), total: "9" }), "discard: the hand-off fill re-bases the baseline — the filled form is clean, a later edit dirty");
  ok(rebaseDraft(null, fill) === null && rebaseDraft(undefined, fill) === undefined && rebaseDraft("{bad", fill) === "{bad", "discard: a pending or unreadable baseline is left as-is by rebaseDraft");
  ok(MODAL_INPUT_KINDS.join() === "curtain,track,fixture,labor,vendor" && isModalInputKind("vendor") && !isModalInputKind("custom") && !isModalInputKind("catalog"), "discard: the five pop-ups (custom / catalog are not)");
  ok(discardConfirmText("vendor", { read: true }) === "Discard this vendor quote? The PDF read and your changes will be lost." && DISCARD_COPY.vendorRead === discardConfirmText("vendor", { read: true }), "discard: vendor with a read — copy");
  ok(discardConfirmText("vendor") === "Discard this vendor quote? Your changes will be lost." && discardConfirmText("curtain") === "Discard this curtain? Your changes will be lost." &&
     discardConfirmText("track") === "Discard this track? Your changes will be lost." && discardConfirmText("fixture", { read: true }) === "Discard this assembly? Your changes will be lost." &&
     discardConfirmText("labor") === "Discard this labor? Your changes will be lost.", "discard: the generic copy per pop-up (read only matters for vendor)");

  // Pins.
  const code = (f: string) => readFileSync(join(process.cwd(), f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const ui = code("src/app/(app)/estimator/est-ui.tsx");
  const cm = ui.slice(ui.indexOf("export function ConfigModal("));
  ok(/const close = confirmClose\s*\?\s*\(\) => \{\s*if \(confirmClose\(\)\) onClose\(\);\s*\}\s*:\s*onClose;/.test(cm) && /className="est-modalwrap"\s*onClick=\{close\}/.test(cm) && /className="est-close"\s*onClick=\{close\}/.test(cm) &&
     !/onClick=\{onClose\}/.test(cm), "discard pins: ConfigModal's backdrop and × go through confirmClose (and, without it, onClose itself — unchanged)");
  const bs = code("src/app/(app)/estimator/steps/build-step.tsx");
  const closers = bs.match(/onClose=\{closeInput\}\s*confirmClose=\{confirmDiscardInput\}/g) || [];
  ok(closers.length === 5 && (bs.match(/onClose=\{closeInput\}/g) || []).length === 5 && (bs.match(/confirmClose=/g) || []).length === 5, "discard pins: the five closeInput pop-ups pass confirmClose, nothing else does");
  for (const [tag, f] of [["CurtainModal", "curtain-modal"], ["TrackModal", "track-modal"], ["FixtureModal", "fixture-modal"], ["LaborModal", "labor-modal"], ["VendorQuoteModal", "vendor-quote-modal"]] as const) {
    const at = bs.indexOf(`<${tag}`), end = bs.indexOf("/>", bs.indexOf("onClose={closeInput}", at));
    ok(at > 0 && bs.slice(at, end).includes("confirmClose={confirmDiscardInput}"), `discard pins: build-step passes confirmClose to ${tag}`);
    ok(/confirmClose=\{confirmClose\}/.test(code(`src/app/(app)/estimator/${f}.tsx`)), `discard pins: ${tag} hands confirmClose to ConfigModal`);
  }
  ok(!/confirmClose/.test(code("src/app/(app)/estimator/ai-scope-modal.tsx")) && !/confirmClose/.test(code("src/app/(app)/estimator/add-system-modal.tsx")) &&
     /<AiScopeModal[\s\S]*?onClose=\{\(\) => setAiOpen\(false\)\}/.test(bs), "discard pins: AI scope and Add a system don't pass confirmClose (they close as before)");
  const hook = code("src/app/(app)/estimator/use-estimator-state.ts");
  const fn = (start: string, next: string) => hook.slice(hook.indexOf(start), hook.indexOf(next, hook.indexOf(start) + start.length));
  const closeFn = fn("const closeInput = () => {", "const openInputMethod = ");
  ok(closeFn.length > 0 && !/confirm/.test(closeFn), "discard pins: closeInput itself never asks (the Add / Save path calls it directly)");
  for (const [name, next] of [["const addTrack = (", "const setCurtainField"], ["const commitVendorQuote = ", "\n  const "], ["const addLabor = (", "\n  const "]] as const) {
    const body = fn(name, next);
    ok(body.length > 0 && body.includes("closeInput()") && !/confirmDiscardInput|window\.confirm\(discard/.test(body), `discard pins: ${name.replace(/const | = .*|\(/g, "")} closes without asking`);
  }
  const om = fn("const openInputMethod = (", "const openVendorEdit = ");
  ok(/const cur = openInputRef\.current;\s*if \(cur && !confirmDiscardInput\(\)\) return;\s*if \(cur && cur\.kind === kind && cur\.secId === secId\)/.test(om) && /seedDraft\(kind, secId\);\s*markDraftBaseline\(kind\);/.test(om),
    "discard pins: openInputMethod asks before closing / switching away, and marks the new open's baseline after seeding");
  for (const n of ["openVendorEdit", "openLaborEdit", "openTrackEdit", "openCustomEdit", "openCurtainEdit"]) {
    const body = fn(`const ${n} = (`, "closeInput();");
    ok(body.length > 0 && body.length < 900 && body.includes("if (!confirmDiscardInput()) return;"), `discard pins: ${n} asks before its close-then-seed`);
  }
  ok(/const confirmDiscardInput = \(\): boolean => \{\s*const d = openInputDirty\(\);\s*return !d \|\| window\.confirm\(discardConfirmText\(d\.kind, \{ read: d\.read \}\)\);/.test(hook) &&
     /reading = cur\.kind === "vendor" && \(vendorPdfBusyRef\.current \|\| !!vendorPdf\.busy\)/.test(hook) && /read: cur\.kind === "vendor" && \(reading \|\| !!vendorDraft\.pdfRead\)/.test(hook),
    "discard pins: the confirm compares the open pop-up's draft (a running read counts; a read names it)");
  ok((hook.match(/markDraftBaseline\(/g) || []).length === 2 && hook.includes('markDraftBaseline("labor");') &&
     /draftBaselineRef\.current\.vendor = rebaseDraft<VendorDraft>\(draftBaselineRef\.current\.vendor, fill\);/.test(hook) && hook.includes("setVendorDraft(fill);"),
    "discard pins: baselines are set in one helper — each open, the labor travel reseed — and the hand-off fill re-bases it");
  ok(/if \(draftBaselineRef\.current\[k\] === null\) draftBaselineRef\.current\[k\] = stableDraftJson\(modalDrafts\[k\]\);/.test(hook) && /\}, \[draftBaselineTick, modalDrafts\]\);/.test(hook),
    "discard pins: a pending baseline snapshots the committed draft");
}

if (process.argv[1]?.endsWith("test-oct15-estimating.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  oct15PureChecks(okf)
    .then(() => discardConfirmChecks(okf))
    .then(() => (db ? oct15DbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
