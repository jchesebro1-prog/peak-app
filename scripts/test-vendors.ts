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
import {
  lineMath, filledLine, sumCheck, catalogMatch, normalizeCompanyName, vendorCompanyMatch, includesFreightRule, vendorPdfChecks, mathFlagCount, checkNotes,
} from "../src/lib/vendor-pdf/checks";
import { readFileSync } from "node:fs";
import { fileThreadTo, vendorThreadsFor, loadVendorsPanel } from "../src/lib/vendor-quotes/threads-server";
import { canSeeThread, get as getThread } from "../src/lib/stores/comms";
import { blobEnabled } from "../src/lib/blob";
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

/** #348 slice 5 — Read the PDF: schema, cleaning, prompt and every deterministic check (pure). */
export async function vendorPdfPureChecks(ok: Ok) {
  // Schema → JSON Schema (structured outputs reject length / range keywords).
  const js = toJsonSchema(VendorPdfWire) as any;
  const wireKeys = ["vendor", "quoteNumber", "quoteDate", "validUntil", "leadTime", "shipFrom", "lines", "freight", "tax", "total", "paymentTerms", "notes"];
  const lineKeys = ["description", "mfrPartNumber", "qty", "unit", "unitPrice", "amount"];
  ok(js.additionalProperties === false && js.items === undefined, "vendor-pdf: wire root is closed");
  ok(js.properties?.lines?.items?.additionalProperties === false, "vendor-pdf: wire line items are closed");
  ok(wireKeys.every((k) => js.required?.includes(k)) && js.required.length === 12, "vendor-pdf: wire requires all 12 keys");
  ok(lineKeys.every((k) => js.properties.lines.items.required?.includes(k)) && js.properties.lines.items.required.length === 6, "vendor-pdf: wire line requires all 6 keys");
  const jsText = JSON.stringify(js);
  ok(!/maxLength|minLength|"minimum"|"maximum"|maxItems/.test(jsText), "vendor-pdf: wire schema has no length / range keywords");
  ok(js.properties.vendor.anyOf?.some((a: any) => a.type === "null") && js.properties.total.anyOf?.some((a: any) => a.type === "null"), "vendor-pdf: nullable fields emit anyOf with null");

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
  ok(catalogMatch("jupiter  4", parts)?.kind === "match", "vendor-pdf: exact key collapses whitespace and case");
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
  ok(fr({ notes: "FOB Destination" }).why === "included-words", "vendor-pdf: FOB destination ticks");

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
  const { readFileSync: rf } = await import("node:fs");
  for (const f of ["extraction.ts", "checks.ts"]) {
    const src = rf(new URL(`../src/lib/vendor-pdf/${f}`, import.meta.url), "utf8");
    ok(!/from\s+["'](node:|@\/db|@\/lib\/stores)|-server["']/.test(src), `vendor-pdf: ${f} imports nothing server-side`);
  }
}

if (process.argv[1]?.endsWith("test-vendors.ts")) {
  let pass = 0, fail = 0;
  const ok: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  vendorChecks(ok).then(() => vendorPdfPureChecks(ok)).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}
