/* #348 slice 4 — vendors harness checks. `vendorChecks` is pure; `vendorDbChecks` needs the test DB (Tasks 2–4 fill it).
   Run the pure half alone with `npx tsx scripts/test-vendors.ts`. */
import { like, sql } from "drizzle-orm";
import type { Ok } from "./test-inbox-org";
import { getDb } from "../src/db";
import { companies } from "../src/db/schema";
import { patchDoc } from "../src/db/doc-store";
import { DOC_TABLES } from "../src/db/doc-tables";
import { saveCompany } from "../src/lib/identity/companies";
import { createFixture, dropFixtures, fixtureId } from "./test-fixtures";
import { buildQuote, get as getQuote } from "../src/lib/stores/quotes";
import type { Quote } from "../src/lib/stores/quotes";
import { addParty, listFor, removeParty } from "../src/lib/stores/parties";
import { displayQuoteNumber } from "../src/lib/estimate-number";
import { prepareVendorQuotesForSave, addVendorPartiesForSave, vendorPartyRemovalRefusalFor, quotesReceivedFor } from "../src/lib/stores/vendor-quotes";
import type { VendorQuoteLike } from "../src/lib/vendor-quotes/rules";
import { toJsonSchema } from "../src/lib/assist/run";
import {
  VendorPdfWire, VendorPdfExtractionSchema, cleanExtraction, isEmptyExtraction, canonicalJson, modelLabel, VENDOR_PDF_SYSTEM, VENDOR_PDF_LINES_MAX,
  VENDOR_PDF_MAX_FILE_BYTES, VENDOR_PDF_MAX_REQUEST_BYTES,
} from "../src/lib/vendor-pdf/extraction";
import type { VendorPdfExtraction, VendorPdfWireOut } from "../src/lib/vendor-pdf/extraction";
import type { CatalogMatchPart } from "../src/lib/vendor-pdf/checks";
import { catalogLookupKeys } from "../src/lib/vendor-pdf/checks";
import { readVendorPdf, vendorPdfErrorFor, VENDOR_PDF_DATA_URL_PREFIX, type ReadVendorPdfInput, type VendorPdfSource } from "../src/lib/vendor-pdf/read-server";
import { countPdfPages, pageCountFromText } from "../src/lib/vendor-pdf/pages-server";
import { partsByLooseKeys } from "../src/lib/stores/catalog";
import { createRun, getRun } from "../src/lib/stores/assist-runs";
import { assistSettingsOf } from "../src/lib/assist/config";
import type { AssistProvider, ProviderRequest } from "../src/lib/assist/types";
import { fakeRun } from "./test-assist";
import { VENDOR_PDF_COPY } from "../src/lib/vendor-pdf/extraction";
import { VENDOR_ATTACHMENT_BUDGET } from "../src/app/(app)/estimator/types";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
import {
  lineMath, filledLine, sumCheck, catalogMatch, buildCatalogIndex, normalizeCompanyName, vendorCompanyMatch, includesFreightRule, vendorPdfChecks, mathFlagCount, checkNotes,
} from "../src/lib/vendor-pdf/checks";
import {
  applyVendorPdfRead, undoVendorPdfRead, readLinesEdited, dropVendorPdfRead, vendorPdfLineHints, vendorPdfTerms, vendorPdfDescription,
  type VendorPdfReadResult,
} from "../src/lib/vendor-pdf/fill";
import { vendorPdfDiff, vendorPdfOutcome } from "../src/lib/vendor-pdf/diff";
import { vendorPdfReport } from "../src/lib/assist/report";
import { parseMoney } from "../src/app/(app)/estimator/material-csv";
import type { VendorDraft, VendorQuoteLine } from "../src/app/(app)/estimator/types";
import type { AssistRun } from "../src/lib/stores/assist-runs";
import { readFileSync } from "node:fs";
import { fileThreadTo, vendorThreadsFor, loadVendorsPanel } from "../src/lib/vendor-quotes/threads-server";
import { canSeeThread, get as getThread } from "../src/lib/stores/comms";
import { blobEnabled, deleteBlob, getBlobBytes, putBlob } from "../src/lib/blob";
import { ownsVendorQuoteBlobPath } from "../src/lib/vendor-quote-file";
import { findPart, listAttachmentParts, parseInbound } from "../src/lib/gmail/mime";
import type { GmailFullMessage, GmailPart } from "../src/lib/gmail/api";
import type { CommThread } from "../src/lib/stores/comms";
import type { MailboxViewer } from "../src/lib/stores/comms-visibility";
import { readThreadAttachment, copyToVendorQuoteBlob } from "../src/lib/vendor-quotes/thread-attachment-server";
import {
  VENDOR_COPY, VENDOR_FROM_EMAIL_MAX_BYTES, isVendorPickerType, asVendorQuotes, vendorCompanyIdsOf, newVendorCompanyIds, stampVendorQuotes,
  keepLiveVendorCompanies, liveVendorQuoteIds, vendorPartyRemovalRefusal, quoteNumberFromSubject, isPdfAttachment, threadAttachmentRef,
  parseThreadAttachmentRef, vendorFromEmailHref, threadAttachmentHref, filingLinkLabel, isListedVendorThread, vendorThreadRow, vendorCardGroups, quotesReceivedRows,
} from "../src/lib/vendor-quotes/rules";

export async function vendorChecks(ok: Ok) {
  ok(isVendorPickerType("vendor/manufacturer") && isVendorPickerType(" Vendor ") && isVendorPickerType("Manufacturer"), "vendors: picker types (exact + legacy spellings)");
  ok(!isVendorPickerType("customer") && !isVendorPickerType("") && !isVendorPickerType(null), "vendors: non-vendor types refused");
  ok(VENDOR_FROM_EMAIL_MAX_BYTES === 26_214_400, "vendors: 25 MB broker cap");

  ok(asVendorQuotes([{ id: "vq1" }, null, { id: 3 }, "x"]).length === 1 && asVendorQuotes("nope").length === 0, "vendors: narrow stored vendorQuotes");
  ok(vendorCompanyIdsOf([{ id: "a", vendorCompanyId: "rb" }, { id: "b", vendorCompanyId: " rb " }, { id: "c" }, { id: "d", vendorCompanyId: "jr" }]).join() === "rb,jr", "vendors: company ids deduped in order");
  ok(newVendorCompanyIds([{ id: "a", vendorCompanyId: "rb" }], [{ id: "a", vendorCompanyId: "rb" }, { id: "b", vendorCompanyId: "jr" }]).join() === "jr", "vendors: only a NEW company adds a party");
  ok(newVendorCompanyIds([{ id: "a", vendorCompanyId: "rb" }], [{ id: "b", vendorCompanyId: "rb" }]).length === 0, "vendors: a second quote from the same company adds nothing");

  const st = stampVendorQuotes<VendorQuoteLike>([{ id: "old", addedAt: 5 }, { id: "legacy" }], [
    { id: "old", addedAt: 999, vendorCompanyId: "rb" }, { id: "legacy" }, { id: "new", vendorCompanyId: "has space", fromThreadId: "C-1040" }, { id: "new2", fromThreadId: "../x" },
  ], 1000);
  ok(st[0].addedAt === 5 && st[0].vendorCompanyId === "rb", "vendors: prior addedAt kept (browser value ignored)");
  ok(!("addedAt" in st[1]), "vendors: a legacy record stays undated");
  ok(st[2].addedAt === 1000 && !("vendorCompanyId" in st[2]) && st[2].fromThreadId === "C-1040", "vendors: new record stamped now; malformed company id dropped; thread id kept");
  ok(!("fromThreadId" in st[3]), "vendors: malformed thread id dropped");
  const live = keepLiveVendorCompanies<VendorQuoteLike>([{ id: "a", vendorCompanyId: "rb", vendor: "Rose Brand" }, { id: "b", vendorCompanyId: "gone", vendor: "Gone Co" }], new Set(["rb"]));
  ok(live[0].vendorCompanyId === "rb" && !("vendorCompanyId" in live[1]) && live[1].vendor === "Gone Co", "vendors: unknown company dropped, typed name kept");

  ok([...liveVendorQuoteIds({ sections: [{ items: [{ vendorQuoteId: "vq1" }, { id: 2 }] }, { items: [{ vendorQuoteId: "vq2" }] }] })].join() === "vq1,vq2" && liveVendorQuoteIds(null).size === 0, "vendors: live vendor-quote ids from a spec");
  ok(vendorPartyRemovalRefusal("Rose Brand", "rb", [{ id: "a", vendorCompanyId: "rb" }]) === "Rose Brand has a vendor quote on this estimate — delete that vendor quote first.", "vendors: removal refused while a live quote names the company");
  ok(vendorPartyRemovalRefusal("Rose Brand", "rb", [{ id: "a", vendorCompanyId: "jr" }]) === null, "vendors: removal allowed otherwise");

  ok(quoteNumberFromSubject("Quote #RB-88214 — Lincoln HS rigging") === "RB-88214", "vendors: subject quote # (#)");
  ok(quoteNumberFromSubject("RE: Quotation No. Q-2024-117 for Peak Systems") === "Q-2024-117", "vendors: subject quote # (Quotation No.)");
  ok(quoteNumberFromSubject("Fwd: Rose Brand quote 88214") === "88214", "vendors: subject quote # (bare)");
  ok(quoteNumberFromSubject("Quote: 4471-A") === "4471-A" && quoteNumberFromSubject("Proposal #P1234 - stage drapes") === "P1234", "vendors: subject quote # (colon, proposal)");
  ok(quoteNumberFromSubject("Quote 88214.") === "88214" && quoteNumberFromSubject("Qt# 7781") === "7781", "vendors: trailing dot stripped; Qt#");
  ok(quoteNumberFromSubject("Your quote is ready") === "" && quoteNumberFromSubject("PO 12345") === "" && quoteNumberFromSubject("Requote 55") === "" && quoteNumberFromSubject(null) === "", "vendors: nothing obvious → blank");

  ok(isPdfAttachment({ name: "q.PDF" }) && isPdfAttachment({ name: "x", mime: "application/pdf; name=x" }) && !isPdfAttachment({ name: "q.xlsx", mime: "application/vnd.ms-excel" }), "vendors: PDF test");

  const ref = { threadId: "C-1040", messageId: "gm-18c2f0a", index: 1 };
  ok(threadAttachmentRef(ref) === "C-1040~gm-18c2f0a~1", "vendors: ref format");
  ok(JSON.stringify(parseThreadAttachmentRef("C-1040~gm-18c2f0a~1")) === JSON.stringify(ref), "vendors: ref round-trip");
  ok([null, 5, "", "a~b", "a~b~c", "a~b~20", "a/x~b~1", "a~b~-1", "x".repeat(141)].every((r) => parseThreadAttachmentRef(r) === null), "vendors: bad refs refused (shape, index < 20, path chars, length)");
  ok(vendorFromEmailHref("Q-2041", ref) === "/estimator?id=Q-2041&vq=C-1040~gm-18c2f0a~1", "vendors: hand-off href");
  ok(threadAttachmentHref(ref) === "/api/inbox/attachments/C-1040/gm-18c2f0a/1", "vendors: download href");
  ok(filingLinkLabel({ type: "quote", number: "FLM-1002", name: "Gym rigging" }) === "FLM-1002 · Gym rigging" && filingLinkLabel({ type: "project", id: "P-1007", name: "" }) === "P-1007 · Project", "vendors: link labels match the Inbox picker");

  const ids = new Set(["rb"]);
  ok(isListedVendorThread({ customerId: "rb", status: "waiting_us" }, ids), "vendors: a vendor thread is listed");
  ok(!isListedVendorThread({ customerId: "rb", status: "draft" }, ids) && !isListedVendorThread({ customerId: "rb", deleted: true }, ids) && !isListedVendorThread({ customerId: "gc", status: "sent" }, ids) && !isListedVendorThread({ customerId: null }, ids), "vendors: drafts, deleted and non-vendor threads never listed");

  const row = vendorThreadRow({ id: "C-1", customerId: "rb", subject: "", unread: true, messages: [{ at: 5, author: "Ann" }, { at: 9, author: "Bob" }] });
  ok(row.subject === "(no subject)" && row.lastAt === 9 && row.lastFrom === "Bob" && row.unread && row.href === "/inbox?thread=C-1" && !("body" in row), "vendors: thread row is subject/last/unread only");

  const groups = vendorCardGroups({
    vendorQuotes: [
      { id: "v1", vendor: "Rose Brand", vendorCompanyId: "rb", quoteNumber: "RB-1", total: 100, attachment: { blobPath: "vendor-quotes/v1-x.pdf" } },
      { id: "v2", vendor: "zeta typed" }, { id: "v3", vendor: "Alpha Typed" }, { id: "v4", vendor: "J.R. Clancy", vendorCompanyId: "jr" },
    ],
    companies: [{ id: "rb", name: "Rose Brand", href: "/companies/rb" }, { id: "ap", name: "Apollo", href: "/companies/ap" }],
    threads: [{ id: "C-2", companyId: "rb", subject: "a", lastAt: 1, lastFrom: "", unread: false, href: "" }, { id: "C-3", companyId: "rb", subject: "b", lastAt: 7, lastFrom: "", unread: true, href: "" }, { id: "C-9", companyId: "zz", subject: "c", lastAt: 1, lastFrom: "", unread: false, href: "" }],
  });
  ok(groups.map((g) => g.name).join("|") === "Apollo|J.R. Clancy|Rose Brand|Alpha Typed|zeta typed", "vendors: card groups — companies by name, typed last");
  const rb = groups.find((g) => g.companyId === "rb")!;
  ok(rb.quotes.length === 1 && rb.quotes[0].hasFile && rb.threads.map((t) => t.id).join() === "C-3,C-2", "vendors: a company's quotes + threads newest first");
  ok(groups.find((g) => g.companyId === "ap")!.quotes.length === 0 && groups.every((g) => !g.threads.some((t) => t.id === "C-9")), "vendors: a party-only vendor shows; a thread of no group is dropped");
  ok(groups.find((g) => g.name === "Alpha Typed")!.companyId === null && groups.find((g) => g.name === "Alpha Typed")!.href === null, "vendors: legacy typed quote has no company");

  const rows = quotesReceivedRows("rb", [
    { id: "Q1", number: "EST-1001", name: "Gym", customer: "MPSD", status: "sent", href: "/estimator?id=Q1", vendorQuotes: [{ id: "a", vendorCompanyId: "rb", quoteNumber: "RB-1", total: 50, addedAt: 10 }, { id: "b", vendorCompanyId: "jr" }] },
    { id: "Q2", number: "EST-1002", name: "Aud", customer: "", status: "draft", href: "/estimator?id=Q2", vendorQuotes: [{ id: "c", vendorCompanyId: "rb", quoteNumber: "RB-2", total: 70, addedAt: 20 }, { id: "d", vendorCompanyId: "rb" }] },
  ]);
  ok(rows.map((r) => r.key).join() === "Q2:c,Q1:a,Q2:d", "vendors: received rows newest first, undated last, other vendors excluded");
  ok(rows[1].job === "Gym — MPSD" && rows[0].job === "Aud" && rows[1].vendorQuoteNumber === "RB-1" && rows[1].total === 50 && rows[2].addedAt === null, "vendors: received row fields");
  ok(VENDOR_COPY.fileButton === "File to estimate / project…" && VENDOR_COPY.addButton === "Add as vendor quote…", "vendors: button copy");

  // Task 3 — Gmail attachments by reference
  const payload: GmailPart = {
    mimeType: "multipart/mixed",
    parts: [
      { partId: "0", mimeType: "multipart/alternative", parts: [{ partId: "0.0", mimeType: "text/plain", body: { data: "aGk" } }] },
      { partId: "1", mimeType: "application/pdf", filename: "Quote RB-88214.pdf", body: { attachmentId: "ANGjd", size: 48213 } },
      { partId: "2", mimeType: "image/png", filename: "", body: { size: 10 } },
    ],
  };
  ok(JSON.stringify(listAttachmentParts(payload)) === JSON.stringify([{ partId: "1", name: "Quote RB-88214.pdf", mime: "application/pdf", size: 48213 }]), "gmail attachments: named parts only, nested walk");
  const many: GmailPart = { mimeType: "multipart/mixed", parts: Array.from({ length: 25 }, (_, i) => ({ partId: String(i), mimeType: "application/pdf", filename: `f${i}.pdf`, body: { size: 1 } })) };
  ok(listAttachmentParts(many, 20).length === 20, "gmail attachments: capped at max");
  const inl = (mimeType: string, filename: string, hs: { name: string; value: string }[]): GmailPart => ({ partId: "9", mimeType, filename, headers: hs, body: { size: 5 } });
  const wrap = (p: GmailPart): GmailPart => ({ mimeType: "multipart/related", parts: [p] });
  ok(listAttachmentParts(wrap(inl("image/png", "image001.png", [{ name: "Content-ID", value: "<sig1>" }, { name: "Content-Disposition", value: "Inline; filename=image001.png" }]))).length === 0, "gmail attachments: an inline image with a Content-ID (signature logo) is skipped");
  ok(listAttachmentParts(wrap(inl("image/png", "site.png", [{ name: "Content-ID", value: "<x>" }, { name: "Content-Disposition", value: "attachment; filename=site.png" }]))).length === 1, "gmail attachments: an attachment-disposition image is kept");
  ok(listAttachmentParts(wrap(inl("application/pdf", "q.pdf", [{ name: "content-id", value: "<q>" }, { name: "content-disposition", value: "inline; filename=q.pdf" }]))).length === 1, "gmail attachments: an inline PDF with a Content-ID is kept");
  ok(findPart(payload, "0.0")?.mimeType === "text/plain" && findPart(payload, "9") === null, "gmail attachments: findPart by part id (nested; missing → null)");
  ok(parseInbound({ id: "g1", threadId: "t1", payload } as GmailFullMessage).attachments.length === 1, "gmail attachments: parseInbound lists them");

  // pins
  const route = readFileSync("src/app/api/inbox/attachments/[threadId]/[messageId]/[index]/route.ts", "utf8");
  ok(route.includes("readThreadAttachment(") && route.includes("status: 404"), "gmail attachments: the download route goes through the broker and answers a plain 404");
  const broker = readFileSync("src/lib/vendor-quotes/thread-attachment-server.ts", "utf8");
  const seeAt = broker.indexOf("canSeeThread(t, viewer)");
  ok(seeAt > 0 && seeAt < broker.indexOf("dataUrlToBytes(") && seeAt < broker.indexOf("fetchMessageAttachment("), "gmail attachments: the broker checks canSeeThread before reading any bytes");
  const copyBody = broker.slice(broker.indexOf("export async function copyToVendorQuoteBlob("));
  ok(copyBody.indexOf("putBlob(") > 0 && copyBody.indexOf("ownsVendorQuoteBlobPath(stored.pathname, vqId)") > copyBody.indexOf("putBlob(") && copyBody.indexOf("throw new Error(", copyBody.indexOf("ownsVendorQuoteBlobPath(")) > 0,
    "broker copy: the stored pathname is asserted to be the record's own before it is returned");
  const bridge = readFileSync("src/lib/gmail/bridge.ts", "utf8");
  const recBody = bridge.slice(bridge.indexOf("export async function recordMessage("), bridge.indexOf("// attach to an existing thread"));
  ok(recBody.includes("attsListed: true") && recBody.includes("gmailPartId: a.partId"), "gmail attachments: recordMessage stores attachments by reference and stamps attsListed");

  // Task 5 — the vendor quote modal + the ?vq= hand-off
  const modal = readFileSync("src/app/(app)/estimator/vendor-quote-modal.tsx", "utf8");
  ok(modal.includes("VendorCompanyField") && modal.includes("fileActions") && !modal.includes('list="pk-vendor-names"'), "vendor modal: the Vendor cell is VendorCompanyField (datalist moved into it) + a fileActions slot");
  const vqActions = readFileSync("src/app/(app)/estimator/vendor-actions.ts", "utf8");
  ok(/readThreadAttachment\([^;]*vendorPdf: true/.test(vqActions) && vqActions.includes("copyToVendorQuoteBlob("), "vendor hand-off: the action reads through the broker (vendorPdf) and copies into Blob");
  const hook = readFileSync("src/app/(app)/estimator/use-estimator-state.ts", "utf8");
  const stripAt = hook.indexOf('.delete("vq")');
  ok(stripAt > 0 && stripAt < hook.indexOf("vendorQuoteFromThreadAction("), "vendor hand-off: vq is stripped from the URL before the action runs");
  const field = readFileSync("src/components/vendors/vendor-company-field.tsx", "utf8");
  ok(field.includes('setMode("typed"); // the kept name') && field.includes("Current: {vendor}") && field.includes("onTyped(\"\")") && field.includes("seenCompanyId"), "vendor field: unlink lands in typed with the name kept; search shows Current: <name> with a clear; mode re-derives on a company change");
  ok(!/setMode\("search"\);\s*onUnlink/.test(field), "vendor field: unlinking never hides the kept name behind search");
  ok(vqActions.includes("isPdfAttachment({ name: r.name, mime: r.mime })") && !vqActions.includes("data:${r.mime}") && vqActions.includes("data:application/pdf;base64"), "vendor hand-off: PDF-only, and the data-URL never interpolates the attachment's mime");
  ok(/const blank = !\(d\.vendor \|\| ""\)\.trim\(\) && !d\.vendorCompanyId;/.test(hook) && hook.includes("...(blank ? { vendor: p.vendor, vendorCompanyId: p.vendorCompanyId } : {})"), "vendor hand-off: the prefill never overwrites a vendor the user typed or picked while copying");
  ok(modal.includes('htmlFor="vendor-quote-vendor"') && modal.includes('inputId="vendor-quote-vendor"') && modal.includes("disabled={copying}"), "vendor modal: Vendor label tied to the field's input; field disabled while copying");
  const wlc = readFileSync("src/app/(app)/inbox/work-link-card.tsx", "utf8");
  ok(/!vm\.readOnly && \(\s*<button[^>]*onClick=\{\(\) => setFileOpen\(true\)\}/.test(wlc) && /!vm\.readOnly && fileOpen && <FileThreadDialog/.test(wlc), "inbox: the File button and dialog render only under !vm.readOnly (owner-only)");
  const vqd = readFileSync("src/app/(app)/inbox/vendor-quote-dialog.tsx", "utf8");
  const fileCall = vqd.indexOf("fileThreadAction(");
  ok(fileCall > 0 && vqd.lastIndexOf("!vm.readOnly", fileCall) > vqd.lastIndexOf("try {", fileCall) && !vqd.includes("d.close()"), "inbox: the vendor-quote dialog files only inside a !vm.readOnly guard; neither dialog closes in the effect cleanup (StrictMode)");
  ok(!readFileSync("src/app/(app)/inbox/file-thread-dialog.tsx", "utf8").includes("d.close()"), "inbox: the File dialog does not close in its effect cleanup (StrictMode)");
  const serverOnly = /from "[^"]*(?:stores\/|@\/db|node:|-server)[^"]*"/;
  ok(!serverOnly.test(field) && !serverOnly.test(modal), "vendor modal: no store / db / node / -server import in the client field or modal");
}

export async function vendorDbChecks(ok: Ok) {
  const db = await getDb();
  const dropIdentity = async () => { await db.delete(companies).where(like(companies.id, "TEST348:v%")); };
  const q = fixtureId(348, "vq1");
  try {
    await dropIdentity();
    const vven1 = fixtureId(348, "vven1"), vven2 = fixtureId(348, "vven2"), vcust = fixtureId(348, "vcust");
    await saveCompany({ id: vven1, name: "Vendor Co One", type: "vendor/manufacturer", lifecycle: "active", deleted: false });
    await saveCompany({ id: vven2, name: "Vendor Co Two", type: "Vendor", lifecycle: "active", deleted: false });
    await saveCompany({ id: vcust, name: "Vendor Test Owner", type: "customer", lifecycle: "active", deleted: false });
    const quote = { ...buildQuote(q, { name: "Vendor quote test", customer: "Vendor Test Owner", customerId: vcust, value: 1000 }, "system", null, Date.now()),
      spec: { sections: [{ id: "s1", name: "Sys", items: [{ id: 1, vendorQuoteId: "vqaaaa1" }] }], mobs: [] }, vendorQuotes: [] } as unknown as Quote;
    await createFixture("quotes", quote as never);

    const prepared = await prepareVendorQuotesForSave<VendorQuoteLike>([], [
      { id: "vqaaaa1", vendor: "Vendor Co One", vendorCompanyId: vven1 }, { id: "vqaaaa2", vendor: "X", vendorCompanyId: vcust }, { id: "vqaaaa3", vendor: "Y", vendorCompanyId: "TEST348:vnope" },
    ], 1234);
    ok(prepared[0].vendorCompanyId === vven1 && !prepared[1].vendorCompanyId && !prepared[2].vendorCompanyId && prepared.every((v) => v.addedAt === 1234), "vendors db: only live vendor-type companies kept on save");
    const legacy = await prepareVendorQuotesForSave<VendorQuoteLike>([], [{ id: "vqaaaa4", vendor: "Two", vendorCompanyId: vven2 }], 1);
    ok(legacy[0].vendorCompanyId === vven2, "vendors db: legacy 'Vendor' type is a vendor company");

    // The move/copy path (placeSystemInEstimate) prepares the browser's placed rows then adds parties from the prepared array.
    const movePrior: VendorQuoteLike[] = [];
    const movePrepared = await prepareVendorQuotesForSave<VendorQuoteLike>(movePrior, [{ id: "vqaaaa5", vendor: "Customer", vendorCompanyId: vcust }, { id: "vqaaaa6", vendor: "Ghost", vendorCompanyId: "TEST348:vnope" }], 99);
    const moveAdded = await addVendorPartiesForSave({ type: "quote", id: q }, movePrior, movePrepared, "u");
    ok(movePrepared.every((v) => !v.vendorCompanyId && v.addedAt === 99) && moveAdded === 0 && (await listFor("quote", q)).filter((p) => p.role === "vendor").length === 0, "vendors db: a customer-type / missing vendorCompanyId through the move path is dropped and adds no party");

    const prep1 = prepared.slice(0, 1);
    const n1 = await addVendorPartiesForSave({ type: "quote", id: q }, [], prep1, "u");
    const rows1 = (await listFor("quote", q)).filter((p) => p.role === "vendor");
    ok(n1 === 1 && rows1.length === 1 && rows1[0].companyId === vven1, "vendors db: a vendor quote's company joins as a vendor party");
    const n2 = await addVendorPartiesForSave({ type: "quote", id: q }, prep1, prep1, "u");
    ok(n2 === 0 && (await listFor("quote", q)).filter((p) => p.role === "vendor").length === 1, "vendors db: once — a repeat save adds nothing");

    await removeParty(rows1[0].id);
    const n3 = await addVendorPartiesForSave({ type: "quote", id: q }, prep1, prep1, "u");
    ok(n3 === 0 && (await listFor("quote", q)).filter((p) => p.role === "vendor").length === 0, "vendors db: a deliberately removed vendor isn't re-added by a later save");
    const re = await addParty({ recordType: "quote", recordId: q, companyId: vven1, role: "vendor" }, "u");
    const row = re.ok ? re.party : null;

    await patchDoc<Quote>("quotes", q, (d) => { (d as unknown as { vendorQuotes: unknown }).vendorQuotes = prep1; });
    const refusal = row ? await vendorPartyRemovalRefusalFor(row) : "no row";
    await patchDoc<Quote>("quotes", q, (d) => { (d as unknown as { spec: unknown }).spec = { sections: [{ id: "s1", name: "Sys", items: [{ id: 1 }] }], mobs: [] }; });
    const after = row ? await vendorPartyRemovalRefusalFor(row) : "no row";
    ok(refusal === "Vendor Co One has a vendor quote on this estimate — delete that vendor quote first." && after === null, "vendors db: removal refused only while a LIVE line names the company");

    const stored = await getQuote(q);
    const recv = await quotesReceivedFor(vven1);
    ok(recv.length === 1 && recv[0].quoteId === q && recv[0].addedAt === 1234 && !!stored && recv[0].estimate === displayQuoteNumber(stored), "vendors db: quotes received lists the estimate with the vendor quote");
    ok((await quotesReceivedFor(vcust)).length === 0, "vendors db: a non-vendor company has no quotes received");

    // part B — the attachment broker (Task 3)
    const A: MailboxViewer = { id: fixtureId(348, "vua"), name: "Vee Alpha", nameUnique: true };
    const B: MailboxViewer = { id: fixtureId(348, "vub"), name: "Vee Beta", nameUnique: true };
    const T6 = fixtureId(348, "vt6");
    const now = Date.now();
    await createFixture("comms", {
      id: T6, mailbox: "personal", mailboxUser: A.name, mailboxOwnerId: A.id, unread: false, customer: "", contactName: "", contactEmail: "rep@vendor.test",
      subject: "Quote RB-1", channel: "email", status: "waiting_us", createdAt: now, updatedAt: now,
      messages: [{
        id: "m1", at: now, direction: "in", channel: "email", author: "Rep", body: "Attached.",
        attachments: [
          { name: "Quote RB-1.pdf", mime: "application/pdf", size: 9, dataUrl: "data:application/pdf;base64,JVBERi0xLjQK" },
          { name: "EST.pdf", mime: "application/pdf", size: 5, pdfPath: "quote-pdfs/x/a.pdf" },
          { name: "big.pdf", mime: "application/pdf", size: 26_214_401, dataUrl: "data:application/pdf;base64,AA==" },
          { name: "g.pdf", mime: "application/pdf", size: 10, gmailPartId: "1" },
        ],
      }],
    } as unknown as CommThread);
    const errOf = (r: Awaited<ReturnType<typeof readThreadAttachment>>) => (r.ok ? "ok" : r.error);
    ok(errOf(await readThreadAttachment({ threadId: T6, messageId: "m1", index: 0 }, B)) === "That email isn't available.", "broker: a thread B can't see is refused like a missing one");
    ok(errOf(await readThreadAttachment({ threadId: "TEST348:vnone", messageId: "m1", index: 0 }, A)) === "That email isn't available.", "broker: a missing thread gets the same answer");
    const own = await readThreadAttachment({ threadId: T6, messageId: "m1", index: 0 }, A);
    ok(own.ok && own.bytes.length === 9 && own.name === "Quote RB-1.pdf", "broker: the owner reads a stored attachment's bytes");
    ok(errOf(await readThreadAttachment({ threadId: T6, messageId: "m1", index: 7 }, A)) === "That attachment isn't on this email." && errOf(await readThreadAttachment({ threadId: T6, messageId: "m-other", index: 0 }, A)) === "That attachment isn't on this email.", "broker: a missing index or a message not on the thread is refused");
    ok(errOf(await readThreadAttachment({ threadId: T6, messageId: "m1", index: 1 }, A, { vendorPdf: true })) === "That's one of our own estimate PDFs, not a vendor quote.", "broker: our own estimate PDF is not a vendor quote");
    ok(errOf(await readThreadAttachment({ threadId: T6, messageId: "m1", index: 2 }, A)) === VENDOR_COPY.tooBig, "broker: over 25 MB refused on the stored size");
    ok(errOf(await readThreadAttachment({ threadId: T6, messageId: "m1", index: 3 }, A)) === "Gmail isn't connected here — download the PDF and attach it by hand.", "broker: a Gmail attachment with Gmail off says so");

    // part C — filing a thread + visibility-filtered vendor threads (Task 4)
    const vp1 = fixtureId(348, "vp1");
    await createFixture("projects", { id: vp1, kind: "project", name: "Vendor test project", customer: "Vendor Test Owner", customerId: vcust, quoteId: q, createdAt: now, updatedAt: now } as never);
    const thr = (slug: string, extra: Record<string, unknown>) => createFixture("comms", {
      id: fixtureId(348, slug), mailbox: "personal", mailboxUser: A.name, mailboxOwnerId: A.id, unread: true, customer: "", contactName: "", contactEmail: "rep@vendor.test",
      subject: `Subj ${slug}`, channel: "email", status: "waiting_us", createdAt: now, updatedAt: now,
      messages: [{ id: "m1", at: now, direction: "in", channel: "email", author: "Rep", body: "SECRET BODY", attachments: [] }], ...extra,
    } as unknown as CommThread);
    const [T1, T2, T3, T4, T5, T7] = ["vt1", "vt2", "vt3", "vt4", "vt5", "vt7"].map((s) => fixtureId(348, s));
    const sugg = { customerId: vcust, work: null, noise: false, source: "identity", reason: "test", strength: "strong", needsReply: false, state: "suggested", at: now };
    await thr("vt1", { customerId: null, filing: sugg });
    await thr("vt8", { filing: { ...sugg, state: "dismissed", noise: true } });
    await thr("vt2", { status: "draft", link: { type: "quote", id: q }, customerId: vven1 });
    await thr("vt3", { customerId: vven1 });
    await thr("vt4", { link: { type: "quote", id: q }, customerId: vcust });
    await thr("vt5", { link: { type: "quote", id: q }, customerId: vven1, deleted: true });
    await thr("vt7", { link: { type: "project", id: vp1 }, customerId: vven1, linkedBy: "user" });

    const t1 = (await getThread(T1))!;
    const ME = { id: A.id, name: A.name };
    const f1 = await fileThreadTo(t1, { type: "quote", id: q }, vven1, ME);
    const f1b = await fileThreadTo((await getThread(T1))!, { type: "quote", id: q }, vven1, ME);
    const t1Filing = (await getThread(T1))?.filing;
    ok(f1.ok && f1b.ok && t1Filing?.state === "skipped" && t1Filing.customerId === vcust, "filing: a pending #335 suggestion is skipped once a person files by hand (a manual File marks it skipped so Approve-all-strong won't override it; a sender-rule sweep or an explicit per-thread approve can still re-file it)");
    const t1After = await getThread(T1);
    const stQ = await getQuote(q);
    ok(f1.ok && f1.label === filingLinkLabel({ type: "quote", number: displayQuoteNumber(stQ!), name: stQ!.name }) && f1b.ok && !f1b.partyAdded
      && t1After?.link?.type === "quote" && t1After.link.id === q && t1After.customerId === vven1 && t1After.linkedBy === "user"
      && asVendorQuotes((stQ as unknown as { vendorQuotes: unknown }).vendorQuotes).filter((v) => v.vendorCompanyId === vven1).length === 1
      && (await listFor("quote", q)).filter((p) => p.role === "vendor" && p.companyId === vven1).length === 1,
      "filing: link + vendor kept + party idempotent");
    const missing = await fileThreadTo(t1After!, { type: "quote", id: "TEST348:vmissing" }, null, ME);
    const notVendor = await fileThreadTo(t1After!, { type: "quote", id: q }, vcust, ME);
    ok(!missing.ok && missing.error === "That estimate or project wasn't found." && !notVendor.ok && notVendor.error === "Pick a vendor company.", "filing: a missing target and a non-vendor company are refused");

    const idsOf = (r: Array<{ id: string }>) => r.map((x) => x.id).sort().join("|");
    const vSet = new Set([vven1]);
    const forB = await vendorThreadsFor({ quoteId: q }, vSet, B);
    ok(idsOf(forB) === T1, "vendors (#341): B sees only the filed vendor thread");
    const forA = await vendorThreadsFor({ quoteId: q }, vSet, A);
    ok(idsOf(forA) === T1 && ![T2, T3, T4, T5].some((x) => idsOf(forA).includes(x)), "vendors: drafts never listed, even to their owner");
    ok(forB.every((r) => !("body" in r) && !("messages" in r) && !("snippet" in r)) && !JSON.stringify(forB).includes("SECRET BODY"), "vendors: only subject / last author / last time / unread ship");
    const both = await vendorThreadsFor({ quoteId: q, projectId: vp1 }, vSet, B);
    const panel = await loadVendorsPanel({ quoteId: q, projectId: vp1 }, B);
    ok(idsOf(both) === [T1, T7].sort().join("|") && panel.threads.length === 2 && panel.companies.some((c) => c.id === vven1 && c.name === "Vendor Co One"), "vendors: quote + project threads, and the panel names the vendor company");
    const NOBODY: MailboxViewer = { id: "", name: "", nameUnique: false };
    const forN = await vendorThreadsFor({ quoteId: q, projectId: vp1 }, vSet, NOBODY);
    const allowed: string[] = [];
    for (const id of [T1, T7]) if (canSeeThread((await getThread(id))!, NOBODY)) allowed.push(id);
    ok(idsOf(forN) === allowed.sort().join("|") && !idsOf(forN).includes(T2), "vendors: a viewer with no id sees only what canSeeThread allows (never a draft)");
    ok((await vendorThreadsFor({ quoteId: q }, new Set(), B)).length === 0, "vendors: no vendor companies, no list");
    // last: filing T8 links it to the estimate, so it would join the lists asserted above
    const T8 = fixtureId(348, "vt8");
    const f8 = await fileThreadTo((await getThread(T8))!, { type: "quote", id: q }, vven1, ME);
    ok(f8.ok && (await getThread(T8))?.filing?.state === "dismissed", "filing: a dismissed (noise) filing is left exactly as it was");

    if (!blobEnabled()) {
      let threw = false;
      try { await copyToVendorQuoteBlob("bad id", "x.pdf", "application/pdf", Buffer.from("x")); } catch { threw = true; }
      ok(threw, "broker copy: a bad vendor quote id is refused");
    } else {
      let threw = false;
      try { await copyToVendorQuoteBlob("bad id", "x.pdf", "application/pdf", Buffer.from("x")); } catch { threw = true; }
      const cp = await copyToVendorQuoteBlob("vqaaaa9", "Q.pdf", "application/pdf", Buffer.from("%PDF-1.4\n"));
      ok(threw && ownsVendorQuoteBlobPath(cp.blobPath, "vqaaaa9"), "broker copy: the returned pathname is the record's own");
    }

    // part D — quotes we've received + project Procurement read-through (Task 8)
    const vqSrc = readFileSync("src/lib/stores/vendor-quotes.ts", "utf8");
    const recvBody = vqSrc.slice(vqSrc.indexOf("export async function quotesReceivedFor"));
    ok((recvBody.match(/getQuotes\(/g) || []).length === 1 && !/getQuote\(/.test(recvBody) && (recvBody.match(/listForCompany\(/g) || []).length === 1, "vendors db: quotesReceivedFor makes one party read and one quote batch (no per-quote get)");
    const recv2 = await quotesReceivedFor(vven1);
    ok(recv2.length === 1 && recv2[0].key.startsWith(`${q}:`) && recv2[0].quoteId === q && recv2[0].total === recv[0].total && recv2[0].vendorQuoteNumber === recv[0].vendorQuoteNumber, "vendors db: quotes received carries one row per vendor quote with its estimate and total");
    const pageSrc = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");
    ok(/procurementSlot=\{tab === "procurement" \?/.test(pageSrc), "vendors: the project page loads the Procurement panel only on that tab");
    ok(/target="_blank" rel="noopener noreferrer"/.test(readFileSync("src/components/vendors/vendor-groups.tsx", "utf8")), "vendors: the vendor groups' links open in a new tab");
  } finally {
    // Party ids are pty_<hash> — not TEST348-prefixed, so dropFixtures(348) skips them: delete this quote's rows directly.
    // Direct SQL by recordId — includes soft-deleted rows, so a mid-test failure can't leak a pty_ row.
    const t = DOC_TABLES.record_parties;
    await db.delete(t).where(sql`${t.doc}->>'recordId' = ${q}`);
    await dropFixtures(348);
    await dropIdentity();
  }
}

// Loose view of a JSON Schema document, enough to assert on its shape.
type JsonObj = {
  additionalProperties?: boolean; items?: unknown; required: string[];
  properties: { lines: { items: { additionalProperties?: boolean; required?: string[] } }; vendor: { anyOf?: Array<{ type?: string }> }; total: { anyOf?: Array<{ type?: string }> } };
};

/** #348 slice 5 — Read the PDF: schema, cleaning, prompt and every deterministic check (pure). */
export async function vendorPdfPureChecks(ok: Ok) {
  // Schema → JSON Schema (structured outputs reject length / range keywords).
  const js = toJsonSchema(VendorPdfWire) as JsonObj;
  const wireKeys = ["vendor", "quoteNumber", "quoteDate", "validUntil", "leadTime", "shipFrom", "lines", "freight", "tax", "total", "paymentTerms", "notes"];
  const lineKeys = ["description", "mfrPartNumber", "qty", "unit", "unitPrice", "amount"];
  ok(js.additionalProperties === false && js.items === undefined, "vendor-pdf: wire root is closed");
  ok(js.properties?.lines?.items?.additionalProperties === false, "vendor-pdf: wire line items are closed");
  ok(wireKeys.every((k) => js.required?.includes(k)) && js.required.length === 12, "vendor-pdf: wire requires all 12 keys");
  ok(lineKeys.every((k) => js.properties.lines.items.required?.includes(k)) && js.properties.lines.items.required?.length === 6, "vendor-pdf: wire line requires all 6 keys");
  const jsText = JSON.stringify(js);
  ok(!/maxLength|minLength|"minimum"|"maximum"|maxItems/.test(jsText), "vendor-pdf: wire schema has no length / range keywords");
  ok(!!js.properties.vendor.anyOf?.some((a) => a.type === "null") && !!js.properties.total.anyOf?.some((a) => a.type === "null"), "vendor-pdf: nullable fields emit anyOf with null");

  // cleanExtraction.
  const wire = (o: Partial<VendorPdfWireOut> = {}): VendorPdfWireOut => ({
    vendor: null, quoteNumber: null, quoteDate: null, validUntil: null, leadTime: null, shipFrom: null, lines: [],
    freight: null, tax: null, total: null, paymentTerms: null, notes: null, ...o,
  });
  const wl = (o: Partial<VendorPdfWireOut["lines"][number]> = {}) => ({ description: null, mfrPartNumber: null, qty: null, unit: null, unitPrice: null, amount: null, ...o });
  const c1 = cleanExtraction(wire({
    vendor: "  Rose   Brand\n Inc. ", total: 99.5, tax: Number.NaN, freight: null, notes: "FOB origin\n\n\n\nNo returns   ok",
    lines: [wl({ description: "x".repeat(300), qty: 2, unitPrice: Number.NaN }), wl(), wl({ mfrPartNumber: "AB-1", amount: 5 })],
  }));
  ok(c1.vendor === "Rose Brand Inc." && c1.total === 99.5, "vendor-pdf: clean collapses whitespace, keeps numbers");
  ok(!("tax" in c1) && !("freight" in c1) && !("quoteNumber" in c1), "vendor-pdf: clean drops nulls and NaN");
  ok(c1.notes === "FOB origin\n\nNo returns ok", "vendor-pdf: notes keep newlines (collapsed to one blank line)");
  ok(c1.lines?.length === 2 && c1.lines[0].description?.length === 200 && !("unitPrice" in c1.lines[0]) && c1.lines[1].mfrPartNumber === "AB-1", "vendor-pdf: clean caps description at 200, drops NaN and all-null lines");
  ok(VendorPdfExtractionSchema.safeParse(c1).success, "vendor-pdf: cleaned extraction passes the stored schema");
  const spaceCap = cleanExtraction(wire({ vendor: "V", notes: `${"n".repeat(1999)} tail`, lines: [wl({ description: `${"d".repeat(199)} tail`, mfrPartNumber: `${"p".repeat(79)} tail` })] }));
  ok(!/\s$/.test(spaceCap.lines![0].description!) && !/\s$/.test(spaceCap.lines![0].mfrPartNumber!) && !/\s$/.test(spaceCap.notes!), "vendor-pdf: clean trims after the cap");
  const reWire = (e: VendorPdfExtraction): VendorPdfWireOut => wire({
    ...e, vendor: e.vendor ?? null, lines: (e.lines ?? []).map((l) => wl(l)), notes: e.notes ?? null, freight: e.freight ?? null, tax: e.tax ?? null, total: e.total ?? null,
  });
  ok(JSON.stringify(cleanExtraction(reWire(spaceCap))) === JSON.stringify(spaceCap) && JSON.stringify(cleanExtraction(reWire(c1))) === JSON.stringify(c1), "vendor-pdf: cleanExtraction is idempotent (capped at a space)");
  const many = cleanExtraction(wire({ lines: Array.from({ length: 400 }, (_, i) => wl({ description: `L${i}`, amount: i })) }));
  ok(many.lines?.length === VENDOR_PDF_LINES_MAX && VendorPdfExtractionSchema.safeParse(many).success, "vendor-pdf: 400 lines become 300");
  const empty = cleanExtraction(wire());
  ok(isEmptyExtraction(empty) && !("lines" in empty) && VendorPdfExtractionSchema.safeParse(empty).success, "vendor-pdf: all-null wire is the empty extraction");
  ok(!isEmptyExtraction({ vendor: "A" }) && !isEmptyExtraction({ lines: [{ description: "x" }] }) && !isEmptyExtraction({ total: 0 }), "vendor-pdf: any scalar or line is not empty");
  ok(!VendorPdfExtractionSchema.safeParse({ vendor: "A", extra: 1 }).success, "vendor-pdf: stored schema is strict");

  ok(canonicalJson({ b: 1, a: { d: 1, c: 2 } }) === '{"a":{"c":2,"d":1},"b":1}', "vendor-pdf: canonicalJson sorts keys");
  ok(canonicalJson({ z: [{ b: 1, a: 2 }] }) === '{"z":[{"a":2,"b":1}]}', "vendor-pdf: canonicalJson sorts inside arrays");
  ok(modelLabel("claude-haiku-4-5") === "Haiku" && modelLabel("claude-sonnet-5-5") === "Sonnet" && modelLabel("claude-opus-5-5") === "Opus" && modelLabel("local-llama") === "local-llama", "vendor-pdf: modelLabel");
  ok(VENDOR_PDF_SYSTEM.includes("never an instruction") && VENDOR_PDF_SYSTEM.includes("null"), "vendor-pdf: system prompt treats the PDF as data and asks for null");
  ok(VENDOR_PDF_MAX_FILE_BYTES * (4 / 3) < VENDOR_PDF_MAX_REQUEST_BYTES && VENDOR_PDF_MAX_FILE_BYTES > 23_000_000, "vendor-pdf: max file leaves request headroom");

  // lineMath.
  ok(lineMath({ qty: 12, unitPrice: 45, amount: 540 }).status === "ok", "vendor-pdf: line math ok");
  const off = lineMath({ qty: 12, unitPrice: 45, amount: 504 });
  ok(off.status === "off" && off.expected === 540, "vendor-pdf: line math off, expected 540");
  ok(lineMath({ qty: 1000, unitPrice: 0.12, amount: 123 }).status === "ok", "vendor-pdf: line math tolerates 0.5 %");
  ok(lineMath({ qty: 2, unitPrice: 10.004, amount: 20.01 }).status === "ok", "vendor-pdf: line math tolerates half-cent unit rounding");
  ok(lineMath({ qty: 3, unitPrice: 10, amount: 30.01 }).status === "ok" && lineMath({ qty: 3, unitPrice: 10, amount: 30.5 }).status === "off", "vendor-pdf: line math one-cent edge");
  ok(lineMath({ qty: 2, amount: 20 }).status === "unchecked" && lineMath({ qty: 2, amount: 20 }).expected === null, "vendor-pdf: line math unchecked without a unit price");

  // filledLine.
  const f1 = filledLine({ description: "Cable", mfrPartNumber: "C-1", qty: 4, unit: "ft", unitPrice: 2.5 }, 0);
  ok(f1.amount === "10" && f1.derivedAmount && f1.qty === "4" && f1.unit === "ft" && f1.manufacturerPartNumber === "C-1", "vendor-pdf: filledLine derives amount from qty x unit price");
  const f2 = filledLine({ mfrPartNumber: "MX-9", amount: 12.345 }, 1);
  ok(f2.description === "MX-9" && f2.amount === "12.35" && !f2.derivedAmount && f2.qty === "1" && f2.unit === "ea", "vendor-pdf: filledLine falls back to part number, defaults qty / unit");
  const f3 = filledLine({}, 2);
  ok(f3.description === "Line 3" && f3.amount === "" && !f3.derivedAmount && f3.manufacturerPartNumber === "", "vendor-pdf: filledLine falls back to Line N, empty money");
  ok(filledLine({ qty: 3, amount: 9 }, 0).amount === "9", "vendor-pdf: filledLine prefers the printed amount");

  // sumCheck.
  const sc = (o: Partial<VendorPdfExtraction>) => sumCheck({ lines: [{ amount: 100 }, { amount: 50 }], ...o });
  ok(sc({ freight: 25, tax: 10, total: 185 }).status === "ok", "vendor-pdf: sum ok with freight + tax");
  ok(sc({ freight: 25, total: 150 }).status === "excludes-extras", "vendor-pdf: total leaves out freight");
  const so = sc({ freight: 25, tax: 10, total: 200 });
  ok(so.status === "off" && so.diff === 15 && so.expected === 185 && so.lines === 150, "vendor-pdf: sum off, diff 15");
  ok(sc({}).status === "no-total", "vendor-pdf: no total");
  ok(sumCheck({ total: 5 }).status === "no-lines" && sumCheck({ lines: [], total: 5 }).status === "no-lines", "vendor-pdf: no lines");
  const forty = Array.from({ length: 40 }, () => ({ amount: 10 }));
  ok(sumCheck({ lines: forty, total: 400.3 }).status === "ok" && sumCheck({ lines: forty, total: 400.5 }).status === "off", "vendor-pdf: sum tolerance grows with line count");
  ok(sumCheck({ lines: [{ amount: 100 }], total: 100.02 }).status === "off" && sumCheck({ lines: [{ amount: 100 }], total: 100.01 }).status === "ok", "vendor-pdf: sum tolerance floor is one cent");
  ok(sumCheck({ lines: [{ qty: 2, unitPrice: 5 }], total: 10 }).status === "ok", "vendor-pdf: sum uses derived amounts");

  // catalogMatch.
  const P = (sku: string, o: Record<string, unknown> = {}) => ({ sku, ...o });
  const parts = [
    P("Symetrix:80-0043", { mfr: "Symetrix", manufacturerModelNumber: "Jupiter 4", manufacturerPartNumber: "80-0043" }),
    P("ETC:ABC", { mfr: "ETC", manufacturerPartNumber: "Jupiter 4" }),
    P("Lex:OLD", { mfr: "Lex", manufacturerModelNumber: "Dimmer 12", formerSkus: ["Lex:77-1234"] }),
    P("MSC-100", { mfr: "Misc", manufacturerPartNumber: "WID-77" }),
  ];
  const m1 = catalogMatch("Jupiter 4", parts);
  ok(m1?.kind === "match" && m1.sku === "Symetrix:80-0043" && m1.by === "model" && m1.model === "Jupiter 4" && m1.mfr === "Symetrix", "vendor-pdf: model # beats a P/N match on another part");
  const m2 = catalogMatch("WID-77", parts);
  ok(m2?.kind === "match" && m2.sku === "MSC-100" && m2.by === "partNumber", "vendor-pdf: P/N match");
  const m3 = catalogMatch("80-0043", [P("Symetrix:80-0043", { mfr: "Symetrix" })]);
  ok(m3?.kind === "match" && m3.by === "sku", "vendor-pdf: order number of a Brand:Model SKU matches by sku");
  const m3b = catalogMatch("msc-100", parts);
  ok(m3b?.kind === "match" && m3b.by === "sku" && m3b.sku === "MSC-100", "vendor-pdf: whole SKU matches by sku, case-folded");
  const m4 = catalogMatch("77-1234", parts);
  ok(m4?.kind === "match" && m4.by === "formerSku" && m4.sku === "Lex:OLD", "vendor-pdf: former SKU order number matches by formerSku");
  const m4b = catalogMatch("lex:77-1234", parts);
  ok(m4b?.kind === "match" && m4b.by === "formerSku", "vendor-pdf: former SKU matches whole");
  const mj = catalogMatch("jupiter  4", parts);
  ok(mj?.kind === "match" && mj.by === "model" && mj.sku === "Symetrix:80-0043", "vendor-pdf: exact key collapses whitespace and case");
  const m5 = catalogMatch("JUPITER-4", parts);
  ok(m5?.kind === "match" && m5.by === "model" && m5.sku === "Symetrix:80-0043", "vendor-pdf: loose key matches in pass 2");
  ok(catalogMatch("EA", parts) === null && catalogMatch("12", [P("12", { mfr: "X" })]) === null && catalogMatch(undefined, parts) === null && catalogMatch("  ", parts) === null, "vendor-pdf: short / blank part numbers never match");
  ok(catalogMatch("A-1", [P("A1X"), P("A-1")])?.kind === "match", "vendor-pdf: exact beats loose");
  ok(catalogMatch("A-1", [P("A1")]) === null, "vendor-pdf: loose key under 4 chars is not used");
  const dup = [P("A:X1", { mfr: "Alpha", manufacturerModelNumber: "FX-100" }), P("B:X1", { mfr: "Beta Inc.", manufacturerModelNumber: "FX-100" })];
  const amb = catalogMatch("FX-100", dup);
  ok(amb?.kind === "ambiguous" && amb.count === 2 && amb.by === "model", "vendor-pdf: same model on two mfrs is ambiguous");
  const hint = catalogMatch("FX-100", dup, "The Beta, Inc.");
  ok(hint?.kind === "match" && hint.sku === "B:X1", "vendor-pdf: vendor hint narrows to one mfr");
  ok(catalogMatch("FX-100", dup, "Gamma")?.kind === "ambiguous", "vendor-pdf: a hint that narrows to none stays ambiguous");

  // One prebuilt index gives the same answers as matching each line against the raw parts.
  const idx = buildCatalogIndex([...parts, ...dup, P("x:1", { mfr: "Q", manufacturerPartNumber: "A-1" })]);
  const allParts: CatalogMatchPart[] = [...parts, ...dup, P("x:1", { mfr: "Q", manufacturerPartNumber: "A-1" })];
  // The straightforward per-line scan the index replaced (keys rebuilt for every part on every call).
  const naive = (pn: string, ps: CatalogMatchPart[], hint = "") => {
    const ex = (v: unknown) => String(v ?? "").normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ");
    const lo = (v: string) => v.replace(/[^A-Z0-9]/g, "");
    const key = ex(pn);
    if (key.length < 3) return null;
    const order = (sku: string) => { const i = sku.indexOf(":"); return (i >= 0 ? sku.slice(i + 1).trim() : "") || sku; };
    const tiers: Array<[string, (p: CatalogMatchPart) => string[]]> = [
      ["model", (p) => [p.manufacturerModelNumber ?? ""]], ["partNumber", (p) => [p.manufacturerPartNumber ?? ""]],
      ["sku", (p) => [p.sku, order(p.sku)]], ["formerSku", (p) => (p.formerSkus ?? []).flatMap((f) => [f, order(f)])],
    ];
    const passes: Array<(v: string) => string> = [ex, (v) => lo(ex(v))];
    for (const [pi, norm] of passes.entries()) {
      const want = pi === 0 ? key : lo(key);
      if (pi === 1 && want.length < 4) break;
      for (const [by, keys] of tiers) {
        const hits = ps.filter((p) => keys(p).some((v) => v.trim() && norm(v) === want));
        if (!hits.length) continue;
        const narrowed = hint ? hits.filter((p) => normalizeCompanyName(p.mfr) === normalizeCompanyName(hint)) : [];
        const one = hits.length === 1 ? hits : narrowed.length === 1 ? narrowed : null;
        return one ? { kind: "match", sku: one[0].sku, by } : { kind: "ambiguous", count: hits.length, by };
      }
    }
    return null;
  };
  const slim = (m: ReturnType<typeof catalogMatch>) => (m === null ? null : m.kind === "match" ? { kind: m.kind, sku: m.sku, by: m.by } : m);
  const probes = ["Jupiter 4", "jupiter  4", "JUPITER-4", "80-0043", "WID-77", "wid77", "msc-100", "77-1234", "lex:77-1234", "FX-100", "fx 100", "A-1", "EA", "12", "", "nope-999", "Dimmer 12", "DIMMER12"];
  ok(probes.every((q) => JSON.stringify(catalogMatch(q, idx, "Beta")) === JSON.stringify(catalogMatch(q, allParts, "Beta"))), "vendor-pdf: a prebuilt index matches like the raw parts");
  ok(probes.every((q) => JSON.stringify(slim(catalogMatch(q, idx, "Beta"))) === JSON.stringify(naive(q, allParts, "Beta")) && JSON.stringify(slim(catalogMatch(q, idx))) === JSON.stringify(naive(q, allParts))), "vendor-pdf: the index gives the old per-line scan's answers");
  const manyLines = Array.from({ length: 300 }, (_, i) => ({ mfrPartNumber: i % 3 === 0 ? "WID-77" : i % 3 === 1 ? "Jupiter 4" : `ZZZ-${i}` }));
  const viaChecks = vendorPdfChecks({ lines: manyLines }, { parts: allParts, companies: [] });
  ok(viaChecks.lines.every((l, i) => JSON.stringify(l.catalog) === JSON.stringify(catalogMatch(manyLines[i].mfrPartNumber, allParts))), "vendor-pdf: 300 lines through vendorPdfChecks match line by line");
  ok(buildCatalogIndex([P("Q:ABCD", { manufacturerPartNumber: "ABCD", manufacturerModelNumber: "ABCD" })]).exact.sku.get("ABCD")?.length === 1, "vendor-pdf: a part is listed once per key");

  // Vendor companies.
  ok(normalizeCompanyName("The Rose Brand, Inc.") === "rose brand", "vendor-pdf: normalize strips the, punctuation, Inc.");
  ok(normalizeCompanyName("Smith & Sons L.L.C.") === "smith and sons" && normalizeCompanyName("ACME Co., Ltd.") === "acme", "vendor-pdf: normalize strips repeated suffixes and & -> and");
  ok(normalizeCompanyName(undefined) === "" && normalizeCompanyName("The") === "the", "vendor-pdf: normalize edge cases");
  const cos = [{ id: "c1", name: "Rose Brand", type: "vendor/manufacturer" }, { id: "c2", name: "Rose Brand", type: "customer" }, { id: "c3", name: "Other", type: "Vendor" }];
  const vm1 = vendorCompanyMatch("ROSE BRAND LLC", cos);
  ok(vm1.status === "one" && vm1.companyId === "c1" && vm1.name === "Rose Brand", "vendor-pdf: vendor match ignores suffix and non-vendor types");
  ok(vendorCompanyMatch("Rose Brandt", cos).status === "none" && vendorCompanyMatch(undefined, cos).status === "none" && vendorCompanyMatch("", cos).status === "none", "vendor-pdf: no fuzzy vendor match");
  const vm2 = vendorCompanyMatch("rose brand inc", [...cos, { id: "c4", name: "Rose Brand, Inc.", type: "manufacturer" }]);
  ok(vm2.status === "many" && vm2.count === 2, "vendor-pdf: two vendor companies with one name is many");
  ok(vendorCompanyMatch("Rose Brand", [{ id: "c9", name: "Rose Brand" }]).status === "none", "vendor-pdf: a company with no type is not a vendor");

  // Freight rule.
  const fr = (o: Partial<VendorPdfExtraction>) => includesFreightRule({ lines: [{ amount: 100 }], ...o });
  const f4 = fr({ freight: 250, total: 350 });
  ok(f4.tick && f4.why === "freight-in-total", "vendor-pdf: freight carried by an ok total ticks");
  ok(fr({ freight: 250 }).why === "freight-in-total", "vendor-pdf: freight with no total ticks");
  ok(fr({ freight: 250, total: 100 }).tick === false && fr({ freight: 250, total: 100 }).why === "none", "vendor-pdf: freight left out of the total does not tick");
  const f5 = fr({ freight: 250, total: 350, notes: "FOB origin, freight prepaid and added" });
  ok(!f5.tick && f5.why === "excluded-words", "vendor-pdf: excluded words win over freight in total");
  const f6 = fr({ notes: "Freight prepaid and allowed" });
  ok(f6.tick && f6.why === "included-words", "vendor-pdf: prepaid and allowed ticks");
  ok(fr({ paymentTerms: "Net 30", shipFrom: "Free shipping on orders" }).tick, "vendor-pdf: free shipping ticks (text spans fields)");
  ok(!fr({ notes: "Freight not included" }).tick && !fr({ leadTime: "Plus freight" }).tick && !fr({ notes: "PPD & add" }).tick, "vendor-pdf: more excluded wordings");
  ok(!fr({}).tick && fr({}).why === "none", "vendor-pdf: nothing printed is none");
  ok(fr({ notes: "FOB Destination" }).why === "included-words" && fr({ notes: "FOB: Destination" }).why === "included-words", "vendor-pdf: FOB destination ticks");
  ok(fr({ notes: "Freight prepaid and allowed" }).tick && fr({ notes: "Freight prepaid & allowed" }).tick, "vendor-pdf: prepaid and allowed still ticks");
  // Each excluded wording ALONE (no "FOB origin" alongside), with freight in an ok total — the words win.
  for (const phrase of ["Freight prepaid and added", "Freight prepaid & added", "prepaid & add", "Prepay and add", "prepay & add", "PP&A", "PP & A", "PPD & add", "ppd and added", "FOB: Origin", "F.O.B. origin", "FOB shipping point", "Freight extra"]) {
    const r = fr({ freight: 250, total: 350, notes: phrase });
    ok(!r.tick && r.why === "excluded-words", `vendor-pdf: "${phrase}" excludes freight`);
  }
  ok(fr({ notes: "Shipping app & accessories" }).why === "none", "vendor-pdf: PP&A needs the whole token");

  // Aggregate + notes.
  const x: VendorPdfExtraction = {
    vendor: "Rose Brand Inc.", total: 905, freight: 25, tax: 0,
    lines: [
      { description: "A", mfrPartNumber: "Jupiter 4", qty: 2, unitPrice: 100, amount: 200 },
      { description: "B", qty: 5, unitPrice: 10 },
      { description: "C", mfrPartNumber: "NOPE-1", qty: 12, unitPrice: 45, amount: 504 },
      { description: "D", mfrPartNumber: "WID-77", qty: 1, unitPrice: 40, amount: 40 },
      { description: "E", qty: 3, unitPrice: 7 },
    ],
  };
  ok(mathFlagCount(x) === 2, "vendor-pdf: mathFlagCount = off line (1) + off sum (1)");
  ok(mathFlagCount({ lines: [{ qty: 1, unitPrice: 5, amount: 5 }], total: 5 }) === 0 && mathFlagCount({}) === 0, "vendor-pdf: mathFlagCount zero when clean");
  const checks = vendorPdfChecks(x, { parts, companies: cos });
  ok(checks.lines.length === 5 && checks.lines[2].math.status === "off" && checks.lines[1].derivedAmount && checks.lines[0].catalog?.kind === "match" && checks.lines[2].catalog === null && checks.lines[3].catalog?.kind === "match", "vendor-pdf: per-line checks");
  ok(checks.sum.status === "off" && checks.vendor.status === "one" && checks.mathFlags === 2 && checks.freight.tick === false, "vendor-pdf: aggregate checks");
  const notes = checkNotes(checks, x, { vendor: "", vendorCompanyId: null });
  const texts = notes.map((n) => n.text);
  ok(texts.includes("Line 3: 12 × $45.00 = $540.00 — the PDF says $504.00."), "vendor-pdf: checkNotes line-3 text");
  ok(texts.some((t) => t.startsWith("Lines + freight + tax = $") && t.includes("the PDF's total is $905.00") && t.endsWith("The form uses the PDF's total.")), "vendor-pdf: checkNotes sum text");
  ok(texts.includes("The PDF reads “Rose Brand Inc.” — linked to Rose Brand."), "vendor-pdf: checkNotes vendor linked");
  ok(texts.includes("2 of 5 lines match catalog parts."), "vendor-pdf: checkNotes catalog count");
  ok(texts.includes("Amounts computed from qty × unit price on lines 2, 5."), "vendor-pdf: checkNotes derived lines");
  const firstInfo = notes.findIndex((n) => n.tone === "info");
  ok(firstInfo > 0 && notes.slice(0, firstInfo).every((n) => n.tone === "warn") && notes.slice(firstInfo).every((n) => n.tone === "info") || notes.every((n) => n.tone === "warn"), "vendor-pdf: warnings come first");
  const linkedSame = checkNotes(checks, x, { vendor: "Rose Brand", vendorCompanyId: "c1" }).map((n) => n.text);
  ok(linkedSame.includes("The PDF reads “Rose Brand Inc.” — linked to Rose Brand."), "vendor-pdf: checkNotes linked when the form's company id equals the match");
  const linkedOther = checkNotes(checks, x, { vendor: "", vendorCompanyId: "c3" }).map((n) => n.text);
  ok(linkedOther.includes("The PDF reads “Rose Brand Inc.” — the form has “another vendor”.") && !linkedOther.some((t) => t.includes("linked to")), "vendor-pdf: checkNotes warns when the form's company id differs from the match");
  const idWarn = checkNotes(checks, x, { vendor: "Rose Brand", vendorCompanyId: "c3" });
  ok(idWarn.some((n) => n.tone === "warn" && n.text === "The PDF reads “Rose Brand Inc.” — the form has “Rose Brand”."), "vendor-pdf: checkNotes id-differs warning is a warn");
  const nDiff = checkNotes(checks, x, { vendor: "Other Co", vendorCompanyId: "c3" }).map((n) => n.text);
  ok(nDiff.includes("The PDF reads “Rose Brand Inc.” — the form has “Other Co”."), "vendor-pdf: checkNotes form vendor differs");
  const manyChecks = vendorPdfChecks({ vendor: "Rose Brand" }, { parts: [], companies: [...cos, { id: "c4", name: "Rose Brand Inc", type: "vendor" }] });
  ok(checkNotes(manyChecks, { vendor: "Rose Brand" }, { vendor: "", vendorCompanyId: null }).some((n) => n.tone === "warn" && n.text === "The PDF reads “Rose Brand” — matches 2 vendor companies — pick one."), "vendor-pdf: checkNotes many vendors");
  const exChecks = vendorPdfChecks({ lines: [{ amount: 100 }], freight: 25, total: 100 }, { parts: [], companies: [] });
  ok(checkNotes(exChecks, { lines: [{ amount: 100 }], freight: 25, total: 100 }, { vendor: "", vendorCompanyId: null }).some((n) => n.tone === "warn" && n.text === "The PDF total leaves out freight / tax."), "vendor-pdf: checkNotes excludes-extras");
  const fx: VendorPdfExtraction = { lines: [{ amount: 100 }], freight: 50, total: 150 };
  const fn = checkNotes(vendorPdfChecks(fx, { parts: [], companies: [] }), fx, { vendor: "", vendorCompanyId: null });
  ok(fn.some((n) => n.tone === "info" && n.text.startsWith("Quote includes freight ticked — ")), "vendor-pdf: checkNotes freight tick");
  ok(checkNotes(vendorPdfChecks({}, { parts: [], companies: [] }), {}, { vendor: "", vendorCompanyId: null }).length === 0, "vendor-pdf: an empty extraction has no notes");

  // Boundary: pure, browser-safe.
  for (const f of ["extraction.ts", "checks.ts"]) {
    const src = readFileSync(new URL(`../src/lib/vendor-pdf/${f}`, import.meta.url), "utf8");
    ok(!/from\s+["'](node:|@\/db|@\/lib\/stores)|-server["']/.test(src), `vendor-pdf: ${f} imports nothing server-side`);
  }
}

/* ---- #348 slice 5 Task 3: fill / undo / diff / report (pure) ---- */
export async function vendorPdfFillChecks(ok: Ok) {
  const blank = (o: Partial<VendorDraft> = {}): VendorDraft => ({
    id: "vqtest", vendor: "", quoteNumber: "", description: "", link: "", attachment: null, attachmentPreview: null, lines: [],
    terms: "", notes: "", total: "", includesFreight: false, display: "single", vendorCompanyId: null, fromThreadId: null,
    extracted: null, pdfRead: null, ...o,
  });
  const cos = [{ id: "c1", name: "Rose Brand", type: "vendor" }];
  const x: VendorPdfExtraction = {
    vendor: "Rose Brand Inc.", quoteNumber: "Q-77", quoteDate: "2026-10-01", validUntil: "2026-11-01", leadTime: "2 weeks", freight: 25, tax: 10, total: 1234.5,
    paymentTerms: "Net 30", notes: "FOB destination",
    lines: [
      { description: "Jupiter 4 processor", mfrPartNumber: "Jupiter 4", qty: 2, unitPrice: 100, amount: 200 },
      { description: "Cable", qty: 5, unitPrice: 10 },
      { mfrPartNumber: "WID-77", qty: 1, amount: 40 },
    ],
  };
  const res = (data: VendorPdfExtraction = x, o: Partial<VendorPdfReadResult> = {}): VendorPdfReadResult => ({
    runId: "run1", model: "claude-haiku-5-5", hard: false, at: 1000, data,
    checks: vendorPdfChecks(data, { parts: [], companies: cos }), pages: 2, ...o,
  });
  let n = 100;
  const mint = () => ++n;

  // Terms + description.
  ok(vendorPdfTerms(x) === "Quote date: 2026-10-01\nValid until: 2026-11-01\nLead time: 2 weeks\nPayment: Net 30\nFreight: $25.00\nTax: $10.00", "fill: terms list only printed rows, in order");
  ok(vendorPdfTerms({}) === "" && vendorPdfTerms({ shipFrom: "Reno" }) === "Ships from: Reno", "fill: terms empty / ships-from row");
  ok(vendorPdfDescription({}) === "" && vendorPdfDescription({ lines: [] }) === "", "fill: description for 0 lines is blank");
  ok(vendorPdfDescription({ lines: [{ description: "Rope" }] }) === "Rope", "fill: description for 1 line");
  ok(vendorPdfDescription({ lines: [{ mfrPartNumber: "AB-1" }] }) === "AB-1", "fill: description falls back to the part number");
  ok(vendorPdfDescription({ lines: [{ qty: 1 }] }) === "", "fill: a line with neither description nor part number → blank");
  ok(vendorPdfDescription({ lines: [{ description: "Rope" }, { description: "B" }] }) === "Rope + 1 more item", "fill: 2 lines → '+ 1 more item'");
  ok(vendorPdfDescription({ lines: [{ mfrPartNumber: "AB-1" }, {}, {}] }) === "AB-1 + 2 more items", "fill: 3 lines, first has only a part number");
  const longDesc = vendorPdfDescription({ lines: [{ description: "x".repeat(200) }, { description: "y" }, { description: "z" }] });
  ok(longDesc.length <= 200 && longDesc.endsWith(" + 2 more items"), "fill: description capped, suffix kept");

  // Apply onto a blank draft.
  const typed = { id: 1, description: "typed", manufacturerPartNumber: "", qty: "1", unit: "ea", amount: "9" };
  const a1 = applyVendorPdfRead(blank({ lines: [typed] }), res(), mint);
  ok(a1.lines.length === 4 && a1.lines[0].id === 1 && a1.lines[0].fromRead === undefined, "apply: typed line stays first");
  ok(a1.lines.slice(1).map((l) => l.fromRead).join() === "0,1,2", "apply: appended lines carry fromRead 0-2");
  ok(new Set(a1.lines.map((l) => l.id)).size === 4 && a1.lines[1].id === 101 && a1.lines[3].id === 103, "apply: fresh ids from mint");
  ok(a1.lines[2].amount === "50" && a1.lines[3].description === "WID-77" && a1.lines[1].manufacturerPartNumber === "Jupiter 4" && a1.lines[1].qty === "2" && a1.lines[1].amount === "200", "apply: lines come from filledLine");
  ok(a1.vendor === "Rose Brand" && a1.vendorCompanyId === "c1", "apply: vendor links on a 'one' match (company name)");
  ok(a1.quoteNumber === "Q-77" && a1.total === "1234.5" && a1.terms.startsWith("Quote date: 2026-10-01") && a1.notes === "FOB destination", "apply: scalars fill when blank; total '1234.5'");
  ok(a1.description === "Jupiter 4 processor + 2 more items", "apply: description prefilled when blank");
  ok(a1.includesFreight === true && a1.pdfRead?.filled.includesFreight === true, "apply: freight ticked from the rule");
  ok(a1.extracted?.runId === "run1" && a1.extracted.model === "claude-haiku-5-5" && a1.extracted.at === 1000 && a1.extracted.data === x, "apply: extracted stamped");
  ok(a1.pdfRead?.hard === false && a1.pdfRead.pages === 2 && a1.pdfRead.filled.vendorCompanyId === "c1" && a1.pdfRead.filled.total === "1234.5" && a1.pdfRead.filled.description === a1.description, "apply: pdfRead.filled records what was written");

  const a2 = applyVendorPdfRead(blank({ vendorCompanyId: "c9", vendor: "Other Co", quoteNumber: "MINE", description: "My desc", total: "5", terms: "t", notes: "n", includesFreight: true }), res(), mint);
  ok(a2.vendor === "Other Co" && a2.vendorCompanyId === "c9", "apply: a picked vendor is not overwritten");
  ok(a2.quoteNumber === "MINE" && a2.description === "My desc" && a2.total === "5" && a2.terms === "t" && a2.notes === "n", "apply: typed scalars stay");
  ok(a2.includesFreight === true && a2.pdfRead?.filled.includesFreight === false && a2.pdfRead.filled.vendor === null && a2.pdfRead.filled.description === null, "apply: filled records only what was written");
  const a3 = applyVendorPdfRead(blank({ vendor: "Typed Vendor" }), res(), mint);
  ok(a3.vendor === "Typed Vendor" && a3.vendorCompanyId === null, "apply: a typed vendor (no company) is not overwritten either");
  const noMatch = res({ ...x, vendor: "Unknown Supply" });
  const a4 = applyVendorPdfRead(blank(), noMatch, mint);
  ok(a4.vendor === "Unknown Supply" && a4.vendorCompanyId === null, "apply: no company match → the PDF's text as typed fallback");
  const a5 = applyVendorPdfRead(blank(), res({ lines: [{ amount: 5 }] }), mint);
  ok(a5.total === "" && a5.terms === "" && a5.quoteNumber === "" && a5.vendor === "" && a5.description === "" && a5.pdfRead?.filled.total === null && a5.lines.length === 1, "apply: nothing printed → fields stay blank");
  const a6 = applyVendorPdfRead(blank(), res({ ...x, notes: "Freight extra", freight: 25, total: 100, lines: [{ amount: 100 }] }), mint);
  ok(a6.includesFreight === false, "apply: freight excluded words → not ticked");
  const a7 = applyVendorPdfRead(blank({ includesFreight: true }), res({ lines: [{ amount: 1 }], total: 1 }), mint);
  ok(a7.includesFreight === true && a7.pdfRead?.filled.includesFreight === false, "apply: freight never unticked");

  // Undo then apply (Try harder).
  const fresh = applyVendorPdfRead(blank({ lines: [typed] }), res(), mint);
  const edited = { ...fresh, quoteNumber: "Q-CHANGED", lines: fresh.lines.map((l) => (l.fromRead === 1 ? { ...l, amount: "99" } : l)) };
  const un = undoVendorPdfRead(edited);
  ok(un.lines.length === 1 && un.lines[0].id === 1, "undo: read lines go, typed lines stay");
  ok(un.quoteNumber === "Q-CHANGED", "undo: a changed quote # stays");
  ok(un.total === "" && un.terms === "" && un.notes === "" && un.description === "" && un.vendor === "" && un.vendorCompanyId === null, "undo: untouched filled scalars blank");
  ok(un.includesFreight === false && un.extracted === null && un.pdfRead === null, "undo: freight unticked, extracted + pdfRead cleared");
  const userTicked = undoVendorPdfRead({ ...fresh, includesFreight: true, pdfRead: { ...fresh.pdfRead!, filled: { ...fresh.pdfRead!.filled, includesFreight: false } } });
  ok(userTicked.includesFreight === true, "undo: a freight tick the read did not make stays");
  const userUnticked = undoVendorPdfRead({ ...fresh, includesFreight: false });
  ok(userUnticked.includesFreight === false, "undo: a freight tick the user already removed stays removed");
  const vendorEdited = undoVendorPdfRead({ ...fresh, vendor: "Changed" });
  ok(vendorEdited.vendor === "Changed" && vendorEdited.vendorCompanyId === "c1", "undo: a vendor the user changed stays (name and link together)");
  const again = applyVendorPdfRead(un, res({ ...x, quoteNumber: "Q-NEW" }, { runId: "run2", hard: true }), mint);
  ok(again.quoteNumber === "Q-CHANGED" && again.lines.length === 4 && again.extracted?.runId === "run2", "try harder: a changed quote # survives the re-apply");
  const again2 = applyVendorPdfRead(undoVendorPdfRead(fresh), res({ ...x, quoteNumber: "Q-NEW" }, { runId: "run2", hard: true }), mint);
  ok(again2.quoteNumber === "Q-NEW" && again2.pdfRead?.hard === true, "try harder: an untouched quote # is replaced");
  const savedEdit = blank({ lines: [typed, { ...typed, id: 2, fromRead: 0 }], quoteNumber: "keep", extracted: { runId: "r", model: "m", at: 1, data: x } });
  const savedUn = undoVendorPdfRead(savedEdit);
  ok(savedUn.lines.length === 1 && savedUn.quoteNumber === "keep" && savedUn.extracted === null, "undo: with pdfRead null only the lines go (and extracted)");

  // readLinesEdited / drop.
  ok(JSON.stringify(readLinesEdited(fresh)) === JSON.stringify({ read: 3, edited: 0 }), "readLinesEdited: untouched read");
  ok(JSON.stringify(readLinesEdited(edited)) === JSON.stringify({ read: 3, edited: 1 }), "readLinesEdited: one edited amount");
  const reformatted = { ...fresh, lines: fresh.lines.map((l) => (l.fromRead === 0 ? { ...l, amount: "200.00", qty: " 2 " } : l)) };
  ok(readLinesEdited(reformatted).edited === 0, "readLinesEdited: numeric reformatting is not an edit");
  ok(JSON.stringify(readLinesEdited(blank())) === JSON.stringify({ read: 0, edited: 0 }), "readLinesEdited: nothing read");
  const dropped = dropVendorPdfRead(edited);
  ok(dropped.lines.length === 4 && dropped.lines.every((l) => !("fromRead" in l)) && dropped.extracted === null && dropped.pdfRead === null && dropped.quoteNumber === "Q-CHANGED", "drop: lines stay as the user's own, read cleared");

  // Hints.
  const hx: VendorPdfExtraction = { lines: [{ description: "A", mfrPartNumber: "Jupiter 4", qty: 2, unitPrice: 100, amount: 200 }, { description: "B", qty: 12, unitPrice: 45, amount: 504 }, { description: "C", qty: 5, unitPrice: 10 }, { description: "D", amount: 1 }] };
  const hres = res(hx, { checks: vendorPdfChecks(hx, { parts: [{ sku: "Symetrix:80-0043", mfr: "Symetrix", manufacturerModelNumber: "Jupiter 4" }], companies: [] }) });
  const hd = applyVendorPdfRead(blank(), hres, mint);
  const hints = vendorPdfLineHints(hd);
  const ids = hd.lines.map((l) => l.id);
  ok(hints[ids[0]]?.text === "In catalog: Jupiter 4 · Symetrix:80-0043" && hints[ids[0]].warn === false, "hints: catalog match chip");
  ok(hints[ids[1]]?.warn === true && hints[ids[1]].text.includes("12 × $45.00 = $540.00") && hints[ids[1]].text.includes("$504.00"), "hints: math off is a warning");
  ok(hints[ids[2]]?.warn === false && /computed/i.test(hints[ids[2]].text), "hints: derived amount is info");
  ok(hints[ids[3]] === undefined, "hints: a clean line has none");
  ok(Object.keys(vendorPdfLineHints({ ...hd, pdfRead: null })).length === 0, "hints: none without pdfRead");
  const fixedMath = vendorPdfLineHints({ ...hd, lines: hd.lines.map((l) => (l.id === ids[1] ? { ...l, amount: "540" } : l)) });
  ok(fixedMath[ids[1]] === undefined, "hints: a corrected amount drops the stale math warning");

  // Diff.
  const lines = (over: Array<Partial<VendorQuoteLine> | null> = []): VendorQuoteLine[] => {
    const base: VendorQuoteLine[] = (x.lines ?? []).map((l, i) => {
      const f = filledLine(l, i);
      return { id: i + 1, description: f.description, manufacturerPartNumber: f.manufacturerPartNumber, qty: Number(f.qty), unit: f.unit, amount: Number(f.amount), extractedIndex: i };
    });
    return base.flatMap((l, i) => (over[i] === null ? [] : [{ ...l, ...(over[i] ?? {}) }]));
  };
  const sv = (ls: VendorQuoteLine[], o: { total?: number; totalSource?: "manual" | "lines" } = {}) => ({ lines: ls, total: o.total ?? 1234.5, totalSource: o.totalSource });
  const dAll = vendorPdfDiff(x, sv(lines()));
  ok(dAll.read === 3 && dAll.kept === 3 && dAll.edited === 0 && dAll.deleted === 0 && dAll.added === 0 && !dAll.totalChanged && vendorPdfOutcome(dAll) === "accepted", "diff: all kept → accepted");
  ok(dAll.mathFlags === 1, "diff: mathFlags from the extraction (sum off)");
  const dQty = vendorPdfDiff(x, sv(lines([{ qty: 3 }])));
  ok(dQty.edited === 1 && dQty.kept === 2 && dQty.fieldEdits.qty === 1 && dQty.fieldEdits.amount === 0 && vendorPdfOutcome(dQty) === "edited", "diff: one edited qty");
  const dMulti = vendorPdfDiff(x, sv(lines([{ description: "  Jupiter   4  processor ", unit: " EA ", amount: 200.004 }])));
  ok(dMulti.kept === 3 && dMulti.edited === 0, "diff: whitespace, case and sub-cent differences are not edits");
  const dFields = vendorPdfDiff(x, sv(lines([{ description: "other", manufacturerPartNumber: "ZZ", unit: "box", amount: 1 }])));
  ok(dFields.edited === 1 && dFields.fieldEdits.description === 1 && dFields.fieldEdits.partNumber === 1 && dFields.fieldEdits.unit === 1 && dFields.fieldEdits.amount === 1, "diff: each differing field counted once");
  const dDel = vendorPdfDiff(x, sv(lines([{}, null])));
  ok(dDel.deleted === 1 && dDel.kept === 2, "diff: a removed line is deleted");
  const typedLine: VendorQuoteLine = { id: 9, description: "typed", qty: 1, unit: "ea", amount: 5 };
  const dAdd = vendorPdfDiff(x, sv([...lines(), typedLine]));
  ok(dAdd.added === 1 && dAdd.kept === 3 && vendorPdfOutcome(dAdd) === "edited", "diff: a typed line is added");
  const dDup = vendorPdfDiff(x, sv([...lines(), { ...lines()[0], id: 10 }]));
  ok(dDup.added === 1 && dDup.kept === 3, "diff: a duplicated index counts one added");
  const dBad = vendorPdfDiff(x, sv([...lines(), { ...typedLine, extractedIndex: 99 }, { ...typedLine, id: 11, extractedIndex: 1.5 }, { ...typedLine, id: 12, extractedIndex: -1 }]));
  ok(dBad.added === 3 && dBad.kept === 3, "diff: out-of-range / non-integer indexes are added");
  const dTot = vendorPdfDiff(x, sv(lines(), { total: 1300 }));
  ok(dTot.totalChanged === true && vendorPdfOutcome(dTot) === "edited", "diff: a total typed over a printed one");
  const dTotSame = vendorPdfDiff(x, sv(lines(), { total: 1234.504 }));
  ok(dTotSame.totalChanged === false, "diff: half-cent total difference is not a change");
  const noTotal: VendorPdfExtraction = { ...x, total: undefined };
  ok(vendorPdfDiff(noTotal, sv(lines(), { total: 245, totalSource: "lines" })).totalChanged === false, "diff: no printed total + lines-driven → no change");
  ok(vendorPdfDiff(noTotal, sv(lines(), { total: 245, totalSource: "manual" })).totalChanged === true, "diff: no printed total + typed → changed");
  const dEmpty = vendorPdfDiff({}, sv([typedLine]));
  ok(dEmpty.read === 0 && dEmpty.added === 1, "diff: an extraction with no lines");
  const dBlankAmt = vendorPdfDiff({ lines: [{ description: "no money" }], total: 0 }, sv([{ id: 1, description: "no money", qty: 1, unit: "ea", amount: 0, extractedIndex: 0 }], { total: 0 }));
  ok(dBlankAmt.kept === 1, "diff: a line with no printed amount saved at 0 is kept");
  const dBlankAmt2 = vendorPdfDiff({ lines: [{ description: "no money" }] }, sv([{ id: 1, description: "no money", qty: 1, unit: "ea", amount: 50, extractedIndex: 0 }], { totalSource: "lines" }));
  ok(dBlankAmt2.edited === 1 && dBlankAmt2.fieldEdits.amount === 1, "diff: a typed amount over a blank counts as edited");
  ok(parseMoney("12,450.00") === 12450 && vendorPdfDiff({ lines: [{ description: "a", qty: 12450, amount: 1 }] }, sv([{ id: 1, description: "a", qty: parseMoney("12,450.00"), unit: "ea", amount: 1, extractedIndex: 0 }], { totalSource: "lines" })).kept === 1, "diff: parseMoney reads '12,450.00'");

  // Report.
  const run = (id: string, o: Partial<AssistRun> & { detail?: Record<string, unknown> }): AssistRun => {
    const { detail, ...rest } = o;
    return {
      id, feature: "vendorpdf", step: null, userId: "u1", userName: "Jeff", provider: "anthropic", model: "claude-haiku-5-5", requestedModel: "claude-haiku-5-5", fellBack: false,
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01, latencyMs: 1, inputHash: "h", output: "", ok: true, error: null, stopReason: null,
      contextRef: "vendorquote:new:vq", monthKey: "2034-05", outcome: null, outcomeDetail: detail ?? null, outcomeAt: null, createdAt: 1, ...rest,
    } as AssistRun;
  };
  const rd = (read: number, kept: number, edited: number, extra: Partial<ReturnType<typeof vendorPdfDiff>> = {}) => ({ read, kept, edited, deleted: 0, added: 0, fieldEdits: { description: 0, partNumber: 0, qty: 0, unit: 0, amount: 0 }, totalChanged: false, mathFlags: 0, ...extra });
  const runs: AssistRun[] = [
    run("r1", { outcome: "edited", costUsd: 0.02, detail: { hard: false, mathFlags: 1, vendor: "Rose Brand", diff: rd(3, 2, 1, { totalChanged: true }) } }),
    run("r2", { outcome: "discarded", costUsd: 0.03, detail: { hard: false, mathFlags: 2 } }),
    run("r3", { model: "claude-sonnet-5-5", outcome: "accepted", costUsd: 0.1, detail: { hard: true, mathFlags: 0, vendor: "", diff: rd(3, 3, 0) } }),
    run("r4", { ok: false, costUsd: 0.005, detail: { mathFlags: 9 } }),
    run("r5", { feature: "reply", costUsd: 5 }),
  ];
  const rep = vendorPdfReport(runs);
  ok(rep.total.reads === 4 && rep.total.okReads === 3 && rep.total.tryHarder === 1 && rep.total.saved === 2 && rep.total.replaced === 1, "report: total counts (other features ignored)");
  ok(rep.total.linesRead === 6 && rep.total.kept === 5 && rep.total.edited === 1 && rep.total.deleted === 0 && rep.total.added === 0 && rep.total.keptPct === 83.3 && rep.total.totalChanged === 1, "report: total line stats, keptPct 83.3");
  ok(rep.total.mathFlags === 3, "report: mathFlags sum over ok reads only");
  ok(Math.abs(rep.total.costUsd - 0.155) < 1e-9, "report: cost summed (failed read included)");
  ok(rep.byModel.map((m) => m.key).join() === "claude-haiku-5-5,claude-sonnet-5-5", "report: byModel keys");
  const hk = rep.byModel[0];
  ok(hk.reads === 3 && hk.okReads === 2 && hk.saved === 1 && hk.replaced === 1 && hk.keptPct === 66.7 && hk.tryHarder === 0, "report: Haiku row");
  ok(rep.byModel[1].saved === 1 && rep.byModel[1].tryHarder === 1 && rep.byModel[1].keptPct === 100, "report: Sonnet row");
  ok(rep.byVendor.map((v) => v.key).join() === "Rose Brand,Unnamed vendor" && rep.byVendor.every((v) => v.saved === 1), "report: byVendor covers saved runs only");
  ok(rep.byVendor[0].reads === 1 && rep.byVendor[0].keptPct === 66.7, "report: vendor row stats");
  const none = vendorPdfReport([]);
  ok(none.total.reads === 0 && none.total.keptPct === null && none.byModel.length === 0 && none.byVendor.length === 0, "report: empty");
  ok(vendorPdfReport([run("x", { outcome: "accepted", detail: { diff: rd(0, 0, 0) } })]).total.keptPct === null, "report: keptPct null with no lines read");
  ok(vendorPdfReport([run("y", { outcome: "accepted" })]).total.saved === 0, "report: accepted without a diff is not saved");

  // Boundary.
  for (const f of ["fill.ts", "diff.ts"]) {
    const src = readFileSync(new URL(`../src/lib/vendor-pdf/${f}`, import.meta.url), "utf8");
    ok(!/from\s+["'](node:|@\/db|@\/lib\/stores)|-server["']/.test(src), `vendor-pdf: ${f} imports nothing server-side`);
    const imports = [...src.matchAll(/^import\s+(type\s+)?[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => ({ type: !!m[1], from: m[2] }));
    const allowed = (i: { type: boolean; from: string }) =>
      i.from === "./checks" || i.from === "./extraction" || i.from === "./diff" || i.from === "@/lib/format" ||
      i.from === "@/app/(app)/estimator/material-csv" || (i.type && i.from === "@/app/(app)/estimator/types");
    ok(imports.length > 0 && imports.every(allowed), `vendor-pdf: ${f} imports only types from estimator/types + ./checks ./extraction (+ pure helpers)`);
  }
}

if (process.argv[1]?.endsWith("test-vendors.ts")) {
  let pass = 0, fail = 0;
  const ok: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  vendorChecks(ok).then(() => vendorPdfPureChecks(ok)).then(() => vendorPdfFillChecks(ok)).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}

/** A fake Claude for Read the PDF: answers `text`, or fails with `error`; records every request. */
function pdfFake(answer: { text: string } | { error: string }, calls: ProviderRequest[]): AssistProvider {
  return {
    name: "fake",
    async complete(req) {
      calls.push(req);
      const usage = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
      if ("error" in answer) return { ok: false, error: answer.error, model: req.model, usage, stopReason: answer.error === "declined" ? "refusal" : null };
      return { ok: true, text: answer.text, model: req.model, usage, stopReason: "end_turn" };
    },
  };
}

/** #348 slice 5 Task 4 — the server read: gate, verified bytes, size + page guards, one runAssist per click, Try harder. */
export async function vendorPdfDbChecks(ok: Ok) {
  const db = await getDb();
  const runsT = DOC_TABLES.assist_runs;
  const U = { id: fixtureId(348, "hu"), name: "Hal Reader" };
  const myRuns = async () => (await db.select({ id: runsT.id }).from(runsT).where(sql`${runsT.doc}->>'userId' = ${U.id}`)).length;
  const dropRuns = async () => { await db.delete(runsT).where(sql`${runsT.doc}->>'userId' = ${U.id}`); };
  const dropIdentity = async () => { await db.delete(companies).where(like(companies.id, "TEST348:h%")); };
  const settings = assistSettingsOf({ assistUsers: [U.id], assistFeatures: { vendorpdf: true } });
  const env = { ANTHROPIC_API_KEY: "sk-ant-test-348" };
  const now = Date.UTC(2034, 4, 10, 15, 0);
  const VQ = "vqhaaaa1";
  const mkPdf = async (n: number) => { const d = await PDFDocument.create(); for (let i = 0; i < n; i++) d.addPage(); return Buffer.from(await d.save()); };
  const dataUrlOf = (b: Buffer) => VENDOR_PDF_DATA_URL_PREFIX + b.toString("base64");
  const L = (description: string, mfrPartNumber: string, qty: number, unitPrice: number, amount: number) => ({ description, mfrPartNumber, qty, unit: "ea", unitPrice, amount });
  const wire = (over: Partial<VendorPdfWireOut> = {}) => JSON.stringify({
    vendor: null, quoteNumber: null, quoteDate: null, validUntil: null, leadTime: null, shipFrom: null,
    lines: [], freight: null, tax: null, total: null, paymentTerms: null, notes: null, ...over,
  });
  const happyWire = wire({ vendor: "Rose Brand 348", quoteNumber: "RB-77", lines: [L("Velour drape", "RB-100", 1, 50, 50), L("Track", "HX-7700", 2, 30, 70), L("Clamp", "CL-1", 1, 40, 40)], freight: 25, total: 185 });
  const input = (over: Partial<ReadVendorPdfInput> = {}): ReadVendorPdfInput => ({ vendorQuoteId: VQ, quoteId: null, source: { kind: "dataUrl", dataUrl: "" }, hard: false, retryOf: null, ...over });
  const parts: CatalogMatchPart[] = [{ sku: "Hexa:HX 7700", mfr: "Hexa", manufacturerModelNumber: "HX 7700", manufacturerPartNumber: "100-200" }];
  // "Rose Brand 348", not "Rose Brand": the dev seed already has a live Rose Brand vendor (rose-brand), which would make it "many".
  try {
    await dropRuns();
    await dropIdentity();
    await saveCompany({ id: fixtureId(348, "hrose"), name: "Rose Brand 348", type: "vendor/manufacturer", lifecycle: "active", deleted: false });
    await saveCompany({ id: fixtureId(348, "hcust"), name: "Rose Brand 348", type: "customer", lifecycle: "active", deleted: false });
    const pdf2 = await mkPdf(2);
    const deps = (provider: AssistProvider) => ({ provider, settings, env, now });

    // 1. Gate off — refused before any byte, no run, no call.
    const c1: ProviderRequest[] = [];
    const g = await readVendorPdf(input({ source: { kind: "dataUrl", dataUrl: dataUrlOf(pdf2) } }), U, { provider: pdfFake({ text: happyWire }, c1), settings: assistSettingsOf({ assistUsers: [U.id], assistFeatures: { vendorpdf: false } }), env, now });
    ok(!g.ok && g.runId === null && c1.length === 0 && (await myRuns()) === 0, "read pdf: gate off → refused, no call, no run row");

    // 2. Foreign path.
    const c2: ProviderRequest[] = [];
    const fp = await readVendorPdf(input({ source: { kind: "blob", blobPath: "vendor-quotes/vqother-x.pdf" } }), U, deps(pdfFake({ text: happyWire }, c2)));
    ok(!fp.ok && fp.error === VENDOR_PDF_COPY.notThisFile && c2.length === 0, "read pdf: another vendor quote's blob path → notThisFile, never called");

    // 3. Bad data URL.
    const png = await readVendorPdf(input({ source: { kind: "dataUrl", dataUrl: "data:image/png;base64,iVBORw0KGgo=" } }), U, deps(pdfFake({ text: happyWire }, c2)));
    const notPdf = await readVendorPdf(input({ source: { kind: "dataUrl", dataUrl: VENDOR_PDF_DATA_URL_PREFIX + Buffer.from("hello, not a pdf").toString("base64") } }), U, deps(pdfFake({ text: happyWire }, c2)));
    ok(!png.ok && png.error === VENDOR_PDF_COPY.notPdf && !notPdf.ok && notPdf.error === VENDOR_PDF_COPY.notPdf && c2.length === 0, "read pdf: an image data URL and a non-%PDF payload → notPdf");
    const huge = await readVendorPdf(input({ source: { kind: "dataUrl", dataUrl: VENDOR_PDF_DATA_URL_PREFIX + "A".repeat(VENDOR_ATTACHMENT_BUDGET + 200) } }), U, deps(pdfFake({ text: happyWire }, c2)));
    ok(!huge.ok && huge.tooLarge === true && huge.error === VENDOR_PDF_COPY.tooLargeBytes && c2.length === 0, "read pdf: a data URL past the attachment budget → tooLarge, never decoded");
    const bad = await readVendorPdf(input({ vendorQuoteId: "../x", source: { kind: "dataUrl", dataUrl: dataUrlOf(pdf2) } }), U, deps(pdfFake({ text: happyWire }, c2)));
    const badRetry = await readVendorPdf(input({ retryOf: "AR-x;drop", source: { kind: "dataUrl", dataUrl: dataUrlOf(pdf2) } }), U, deps(pdfFake({ text: happyWire }, c2)));
    const badKind = await readVendorPdf(input({ source: { kind: "url", url: "https://evil.test/a.pdf" } as unknown as VendorPdfSource }), U, deps(pdfFake({ text: happyWire }, c2)));
    ok(!bad.ok && !badRetry.ok && !badKind.ok && c2.length === 0 && (await myRuns()) === 0, "read pdf: a bad vendor quote id / retryOf / source kind is refused with no call");

    // 4. Happy path.
    const c4: ProviderRequest[] = [];
    const r4 = await readVendorPdf(input({ source: { kind: "dataUrl", dataUrl: dataUrlOf(pdf2) } }), U, { ...deps(pdfFake({ text: happyWire }, c4)), parts });
    ok(r4.ok && r4.checks.lines[1].math.status === "off" && r4.pages === 2 && r4.checks.mathFlags === 1 && r4.data.lines?.length === 3, "read pdf: happy path — 3 lines, line 2's math off, 2 pages");
    ok(c4.length === 1 && c4[0].document?.base64 === pdf2.toString("base64") && c4[0].document?.mediaType === "application/pdf" && c4[0].model === "claude-haiku-5-5", "read pdf: the request carries the PDF as a document block, on Haiku");
    ok(r4.ok && r4.model === "claude-haiku-5-5" && r4.hard === false && r4.at === now, "read pdf: the result names the answering model and the run's time");
    const row4 = r4.ok ? await getRun(r4.runId) : null;
    const d4 = (row4?.outcomeDetail ?? {}) as Record<string, unknown>;
    const hash4 = r4.ok ? createHash("sha256").update(canonicalJson(r4.data)).digest("hex") : "";
    ok(!!row4 && row4.feature === "vendorpdf" && row4.contextRef === "vendorquote:new:vqhaaaa1" && row4.createdAt === now && row4.outcome === null, "read pdf: the run row — feature, context ref, time, no outcome yet");
    ok(d4.vendorQuoteId === VQ && d4.quoteId === null && d4.hard === false && d4.retryOf === null && d4.dataHash === hash4 && d4.mathFlags === 1 && d4.pages === 2 && d4.bytes === pdf2.length && d4.lines === 3, "read pdf: the run detail — ids, hash, mathFlags, pages, bytes, lines");
    ok(r4.ok && r4.checks.lines[1].catalog?.kind === "match" && r4.checks.lines[1].catalog.sku === "Hexa:HX 7700" && r4.checks.lines[1].catalog.by === "model", "read pdf: deps.parts matches a printed number by model #");
    ok(r4.ok && r4.checks.vendor.status === "one" && r4.checks.vendor.companyId === fixtureId(348, "hrose"), "read pdf: the vendor matches the live vendor company, not the customer namesake");
    ok(r4.ok && r4.checks.freight.tick === true && r4.checks.sum.status === "ok", "read pdf: freight inside the printed total");

    // 5. 101 pages — refused before the call.
    const c5: ProviderRequest[] = [];
    const before5 = await myRuns();
    const r5 = await readVendorPdf(input({ source: { kind: "dataUrl", dataUrl: dataUrlOf(await mkPdf(101)) } }), U, deps(pdfFake({ text: happyWire }, c5)));
    ok(!r5.ok && r5.error === VENDOR_PDF_COPY.tooLargePages(101) && r5.tooLarge === true && c5.length === 0 && (await myRuns()) === before5, "read pdf: 101 pages → tooLargePages(101), no call, no run");

    // 6. Page count without pdf-lib.
    const mini = "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R >> endobj\n4 0 obj << /Type /Page /Parent 2 0 R >> endobj\n5 0 obj << /Type /Page /Parent 2 0 R >> endobj\n%%EOF";
    ok(pageCountFromText(mini) === 3 && pageCountFromText(mini.replace("/Count 3", "")) === 3 && pageCountFromText("garbage bytes") === null, "pages: /Pages /Count, else /Type /Page objects, else null");
    ok(pageCountFromText("1 0 obj << /Type /Pages /Count 2 >> endobj 7 0 obj << /Type /Pages /Count 9 >> endobj") === 9, "pages: the largest /Pages /Count wins (the root)");
    ok((await countPdfPages(Buffer.from("%PDF-1.4\nnot really a pdf"))) === null && (await countPdfPages(Buffer.from(mini, "latin1"))) === 3 && (await countPdfPages(pdf2)) === 2, "pages: countPdfPages — pdf-lib, the text fallback, null");

    // 7. Try harder.
    const c7: ProviderRequest[] = [];
    const r7 = r4.ok ? await readVendorPdf(input({ hard: true, retryOf: r4.runId, source: { kind: "dataUrl", dataUrl: dataUrlOf(pdf2) } }), U, { ...deps(pdfFake({ text: happyWire }, c7)), parts }) : null;
    const prev7 = r4.ok ? await getRun(r4.runId) : null;
    const d7 = r7?.ok ? ((await getRun(r7.runId))?.outcomeDetail ?? {}) as Record<string, unknown> : {};
    ok(!!r7?.ok && c7[0]?.model === "claude-sonnet-5-5" && r7.model === "claude-sonnet-5-5" && r7.hard === true && d7.hard === true && d7.retryOf === (r4.ok ? r4.runId : ""), "read pdf: Try harder runs on Sonnet and records retryOf");
    ok(prev7?.outcome === "discarded" && (prev7.outcomeDetail as Record<string, unknown>)?.replacedBy === (r7?.ok ? r7.runId : "x"), "read pdf: Try harder discards the earlier read (replacedBy)");
    // A failing Try harder leaves the earlier read alone — and still logs its detail.
    const r7b = r7?.ok ? await readVendorPdf(input({ hard: true, retryOf: r7.runId, source: { kind: "dataUrl", dataUrl: dataUrlOf(pdf2) } }), U, deps(pdfFake({ error: "declined" }, []))) : null;
    const prev7b = r7?.ok ? await getRun(r7.runId) : null;
    const fail7 = r7b && !r7b.ok && r7b.runId ? await getRun(r7b.runId) : null;
    const fd7 = (fail7?.outcomeDetail ?? {}) as Record<string, unknown>;
    ok(!!r7b && !r7b.ok && r7b.error === VENDOR_PDF_COPY.couldNotRead && prev7b?.outcome === null, "read pdf: a declined Try harder → couldNotRead, the earlier read's outcome stays null");
    ok(!!fail7 && fail7.ok === false && fd7.hard === true && fd7.retryOf === (r7?.ok ? r7.runId : "") && fd7.vendorQuoteId === VQ && fd7.quoteId === null && fd7.pages === 2 && fd7.bytes === pdf2.length, "read pdf: a failed read's run still gets its detail (hard, retryOf, ids, pages, bytes)");
    // Someone else's run id is never discarded.
    const other = fakeRun({ id: "AR-zzzz348-abcd", feature: "vendorpdf", userId: "someone-else", monthKey: "2034-05" });
    await createRun(other);
    try {
      await readVendorPdf(input({ hard: true, retryOf: other.id, source: { kind: "dataUrl", dataUrl: dataUrlOf(pdf2) } }), U, { ...deps(pdfFake({ text: happyWire }, [])), parts });
      ok((await getRun(other.id))?.outcome === null, "read pdf: Try harder never discards another user's run");
    } finally {
      await db.delete(runsT).where(sql`${runsT.id} = ${other.id}`);
    }

    // 8. Error mapping.
    const r8a = await readVendorPdf(input({ source: { kind: "dataUrl", dataUrl: dataUrlOf(pdf2) } }), U, deps(pdfFake({ error: "too long" }, [])));
    const r8b = await readVendorPdf(input({ source: { kind: "dataUrl", dataUrl: dataUrlOf(pdf2) } }), U, deps(pdfFake({ error: "request rejected: PDF pages exceed limit" }, [])));
    const r8c = await readVendorPdf(input({ source: { kind: "dataUrl", dataUrl: dataUrlOf(pdf2) } }), U, deps(pdfFake({ error: "request rejected: PDF is password protected" }, [])));
    const r8d = await readVendorPdf(input({ source: { kind: "dataUrl", dataUrl: dataUrlOf(pdf2) } }), U, deps(pdfFake({ text: "{not json" }, [])));
    ok(!r8a.ok && r8a.error === VENDOR_PDF_COPY.tooManyLines && !!r8a.runId, "read pdf: 'too long' → tooManyLines (run logged)");
    ok(!r8b.ok && r8b.error === VENDOR_PDF_COPY.tooLargeBytes && r8b.tooLarge === true, "read pdf: a page/size rejection → tooLarge");
    ok(!r8c.ok && r8c.error === VENDOR_PDF_COPY.rejected && !r8c.tooLarge, "read pdf: another rejection → rejected");
    ok(!r8d.ok && r8d.error === VENDOR_PDF_COPY.couldNotRead, "read pdf: an unreadable answer → couldNotRead");
    ok(vendorPdfErrorFor("Too many Assist requests — try again in a bit.").error === "Too many Assist requests — try again in a bit." && vendorPdfErrorFor("empty answer").error === VENDOR_PDF_COPY.couldNotRead, "read pdf: rate-limit text passes through; empty answer → couldNotRead");

    // 9. Empty read.
    const r9 = await readVendorPdf(input({ source: { kind: "dataUrl", dataUrl: dataUrlOf(pdf2) } }), U, deps(pdfFake({ text: wire() }, [])));
    const row9 = !r9.ok && r9.runId ? await getRun(r9.runId) : null;
    ok(!r9.ok && r9.error === VENDOR_PDF_COPY.noQuote && !!row9 && row9.ok === true && row9.outcome === null && (row9.outcomeDetail as Record<string, unknown>)?.vendorQuoteId === VQ, "read pdf: an all-null read → noQuote, run logged with detail, outcome null");

    // 10. Catalog (SQL pre-filter) and vendor — no deps.parts / deps.companies.
    await createFixture("catalog_parts", { id: fixtureId(348, "hpart1"), sku: fixtureId(348, "hpart1"), desc: "Hexa tracker", category: "Rigging", unit: "ea", list: 10, cost: 5, mfr: "Hexa348", manufacturerModelNumber: "HXQ 9348", formerSkus: ["Old348:HXQ-OLD-9348"] } as never);
    await createFixture("catalog_parts", { id: fixtureId(348, "hpart2"), sku: fixtureId(348, "hpart2"), desc: "Wide", category: "Rigging", unit: "ea", list: 10, cost: 5, mfr: "Hexa348", manufacturerPartNumber: "ＷＸ－９３４８" } as never);
    const byModel = await partsByLooseKeys(["HXQ9348"]);
    const byFormer = await partsByLooseKeys(["HXQOLD9348"]);
    const bySkuOrder = await partsByLooseKeys(["HPART1"]);
    const byNfkc = await partsByLooseKeys(["WX9348"]);
    ok(byModel.some((p) => p.sku === fixtureId(348, "hpart1") && p.manufacturerModelNumber === "HXQ 9348" && p.formerSkus?.[0] === "Old348:HXQ-OLD-9348" && p.mfr === "Hexa348"), "catalog pre-filter: by model # (loose), projected to the match fields");
    ok(byFormer.some((p) => p.sku === fixtureId(348, "hpart1")) && bySkuOrder.some((p) => p.sku === fixtureId(348, "hpart1")) && byNfkc.some((p) => p.sku === fixtureId(348, "hpart2")), "catalog pre-filter: by a former SKU's order #, the SKU's order #, and NFKC (full-width) text");
    ok((await partsByLooseKeys([])).length === 0 && (await partsByLooseKeys(["ZZZNOPE348"])).length === 0, "catalog pre-filter: no keys / no hit → nothing read");
    ok(catalogLookupKeys({ lines: [{ mfrPartNumber: "hx-7700" }, { mfrPartNumber: "HX 7700" }, { mfrPartNumber: "ab" }, { mfrPartNumber: "---" }, { description: "x" }] }).join() === "HX7700", "catalog pre-filter: lookup keys are the loose keys of matchable printed numbers");
    const r10 = await readVendorPdf(input({ quoteId: "Q-348", source: { kind: "dataUrl", dataUrl: dataUrlOf(pdf2) } }), U, deps(pdfFake({ text: wire({ vendor: "Rose Brand 348, Inc.", lines: [L("Tracker", "HXQ-9348", 1, 10, 10), L("Wide", "WX 9348", 1, 5, 5)], total: 15 }) }, [])));
    ok(r10.ok && r10.checks.vendor.status === "one" && r10.checks.vendor.companyId === fixtureId(348, "hrose"), "read pdf: vendor match over live vendor-type companies only");
    ok(r10.ok && r10.checks.lines[0].catalog?.kind === "match" && r10.checks.lines[0].catalog.sku === fixtureId(348, "hpart1") && r10.checks.lines[1].catalog?.kind === "match" && r10.checks.lines[1].catalog.sku === fixtureId(348, "hpart2"), "read pdf: the server's catalog pre-filter finds the printed numbers' parts");
    ok(r10.ok && (await getRun(r10.runId))?.contextRef === "vendorquote:Q-348:vqhaaaa1", "read pdf: a saved estimate's id in the context ref");

    // 11. getBlobBytes.
    const blobSrc = readFileSync("src/lib/blob.ts", "utf8");
    const gb = blobSrc.slice(blobSrc.indexOf("export async function getBlobBytes"));
    ok(gb.indexOf("head(") > 0 && gb.indexOf("head(") < gb.indexOf("get(pathname"), "getBlobBytes: head() is asked before the body is requested");
    if (blobEnabled()) {
      const put = await putBlob(`vendor-quotes/${VQ}-t4.pdf`, Buffer.from("%PDF-1.4 tiny"), "application/pdf");
      try {
        const whole = await getBlobBytes(put.pathname, 1000);
        const tooBig = await getBlobBytes(put.pathname, 3);
        ok(whole.ok && whole.bytes.toString() === "%PDF-1.4 tiny" && !tooBig.ok && tooBig.reason === "too-large", "getBlobBytes: reads a small blob; over max → too-large");
        ok(!(await getBlobBytes(`vendor-quotes/${VQ}-missing-${Date.now()}.pdf`, 1000)).ok, "getBlobBytes: a missing blob → missing");
      } finally {
        await deleteBlob(put.pathname);
      }
    }

    // 12. Source pins.
    const act = readFileSync("src/app/(app)/estimator/vendor-pdf-actions.ts", "utf8");
    ok(act.startsWith('"use server"') && act.includes("requireUser(") && act.includes("readVendorPdf("), "action: use server, requireUser, readVendorPdf");
    const rs = readFileSync("src/lib/vendor-pdf/read-server.ts", "utf8");
    const body = rs.slice(rs.indexOf("export async function readVendorPdf"));
    ok(body.indexOf("vendorPdfGateFor(") > 0 && body.indexOf("vendorPdfGateFor(") < body.indexOf("loadVendorPdfBytes("), "read-server: the gate runs before any byte is loaded");
    ok(rs.includes("ownsVendorQuoteBlobPath(") && !/\bfetch\(/.test(rs), "read-server: blob paths are ownership-checked; nothing is fetched");
    ok(!/from "[^"]*(?:stores\/|@\/db|node:|-server|pdf-lib|@\/lib\/blob)[^"]*"/.test(act.replace('from "@/lib/vendor-pdf/read-server"', "")), "action: imports only session + read-server");
  } finally {
    await dropRuns();
    await dropFixtures(348);
    await dropIdentity();
  }
}
