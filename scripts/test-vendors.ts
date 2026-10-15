/* #348 slice 4 — vendors harness checks. `vendorChecks` is pure; `vendorDbChecks` needs the test DB (Tasks 2–4 fill it).
   Run the pure half alone with `npx tsx scripts/test-vendors.ts`. */
import { like } from "drizzle-orm";
import type { Ok } from "./test-inbox-org";
import { getDb } from "../src/db";
import { companies } from "../src/db/schema";
import { patchDoc } from "../src/db/doc-store";
import { DOC_TABLES } from "../src/db/doc-tables";
import { eq } from "drizzle-orm";
import { saveCompany } from "../src/lib/identity/companies";
import { createFixture, dropFixtures, fixtureId } from "./test-fixtures";
import { buildQuote, get as getQuote } from "../src/lib/stores/quotes";
import type { Quote } from "../src/lib/stores/quotes";
import { addParty, listFor, removeParty } from "../src/lib/stores/parties";
import { displayQuoteNumber } from "../src/lib/estimate-number";
import { prepareVendorQuotesForSave, addVendorPartiesForSave, vendorPartyRemovalRefusalFor, quotesReceivedFor } from "../src/lib/stores/vendor-quotes";
import type { VendorQuoteLike } from "../src/lib/vendor-quotes/rules";
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
  } finally {
    // Party ids are pty_<hash> — not TEST348-prefixed, so dropFixtures(348) skips them: delete this quote's rows directly.
    const t = DOC_TABLES.record_parties;
    for (const p of await listFor("quote", q)) await db.delete(t).where(eq(t.id, p.id));
    await dropFixtures(348);
    await dropIdentity();
  }
}

if (process.argv[1]?.endsWith("test-vendors.ts")) {
  let pass = 0, fail = 0;
  vendorChecks((c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } }).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}
