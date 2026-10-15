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
    await thr("vt1", { customerId: null });
    await thr("vt2", { status: "draft", link: { type: "quote", id: q }, customerId: vven1 });
    await thr("vt3", { customerId: vven1 });
    await thr("vt4", { link: { type: "quote", id: q }, customerId: vcust });
    await thr("vt5", { link: { type: "quote", id: q }, customerId: vven1, deleted: true });
    await thr("vt7", { link: { type: "project", id: vp1 }, customerId: vven1, linkedBy: "user" });

    const t1 = (await getThread(T1))!;
    const f1 = await fileThreadTo(t1, { type: "quote", id: q }, vven1, "u");
    const f1b = await fileThreadTo((await getThread(T1))!, { type: "quote", id: q }, vven1, "u");
    const t1After = await getThread(T1);
    const stQ = await getQuote(q);
    ok(f1.ok && f1.label === filingLinkLabel({ type: "quote", number: displayQuoteNumber(stQ!), name: stQ!.name }) && f1b.ok && !f1b.partyAdded
      && t1After?.link?.type === "quote" && t1After.link.id === q && t1After.customerId === vven1 && t1After.linkedBy === "user"
      && asVendorQuotes((stQ as unknown as { vendorQuotes: unknown }).vendorQuotes).filter((v) => v.vendorCompanyId === vven1).length === 1
      && (await listFor("quote", q)).filter((p) => p.role === "vendor" && p.companyId === vven1).length === 1,
      "filing: link + vendor kept + party idempotent");
    const missing = await fileThreadTo(t1After!, { type: "quote", id: "TEST348:vmissing" }, null, "u");
    const notVendor = await fileThreadTo(t1After!, { type: "quote", id: q }, vcust, "u");
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
  } finally {
    // Party ids are pty_<hash> — not TEST348-prefixed, so dropFixtures(348) skips them: delete this quote's rows directly.
    // Direct SQL by recordId — includes soft-deleted rows, so a mid-test failure can't leak a pty_ row.
    const t = DOC_TABLES.record_parties;
    await db.delete(t).where(sql`${t.doc}->>'recordId' = ${q}`);
    await dropFixtures(348);
    await dropIdentity();
  }
}

if (process.argv[1]?.endsWith("test-vendors.ts")) {
  let pass = 0, fail = 0;
  vendorChecks((c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } }).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}
