/* #348 slice 4 — vendors harness checks. `vendorChecks` is pure; `vendorDbChecks` needs the test DB (Tasks 2–4 fill it).
   Run the pure half alone with `npx tsx scripts/test-vendors.ts`. */
import { like, sql } from "drizzle-orm";
import type { Ok } from "./ok-type";
import { getDb } from "../src/db";
import { companies } from "../src/db/schema";
import { patchDoc } from "../src/db/doc-store";
import { DOC_TABLES } from "../src/db/doc-tables";
import { saveCompany } from "../src/lib/identity/companies";
import { createFixture, dropFixtures, fixtureId } from "./test-fixtures";
import { buildQuote, get as getQuote, update as updateQuote } from "../src/lib/stores/quotes";
import type { Quote } from "../src/lib/stores/quotes";
import { addParty, listFor, removeParty } from "../src/lib/stores/parties";
import { displayQuoteNumber } from "../src/lib/estimate-number";
import { prepareVendorQuotesForSave, addVendorPartiesForSave, vendorPartyRemovalRefusalFor, quotesReceivedFor } from "../src/lib/stores/vendor-quotes";
import type { VendorQuoteLike } from "../src/lib/vendor-quotes/rules";
import { partsByLooseKeys } from "../src/lib/stores/catalog";
import { VENDOR_ATTACHMENT_BUDGET } from "../src/app/(app)/estimator/types";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
import { parseMoney } from "../src/app/(app)/estimator/material-csv";
import type { VendorDraft, VendorQuote, VendorQuoteLine } from "../src/app/(app)/estimator/types";
import { readFileSync } from "node:fs";
import { blobEnabled, deleteBlob, getBlobBytes, putBlob } from "../src/lib/blob";
import { ownsVendorQuoteBlobPath } from "../src/lib/vendor-quote-file";
import {
  VENDOR_COPY, isVendorPickerType, asVendorQuotes, vendorCompanyIdsOf, newVendorCompanyIds, stampVendorQuotes,
  keepLiveVendorCompanies, liveVendorQuoteIds, vendorPartyRemovalRefusal, isPdfAttachment, vendorCardGroups, quotesReceivedRows,
} from "../src/lib/vendor-quotes/rules";

export async function vendorChecks(ok: Ok) {
  ok(isVendorPickerType("vendor/manufacturer") && isVendorPickerType(" Vendor ") && isVendorPickerType("Manufacturer"), "vendors: picker types (exact + legacy spellings)");
  ok(!isVendorPickerType("customer") && !isVendorPickerType("") && !isVendorPickerType(null), "vendors: non-vendor types refused");

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

  ok(isPdfAttachment({ name: "q.PDF" }) && isPdfAttachment({ name: "x", mime: "application/pdf; name=x" }) && !isPdfAttachment({ name: "q.xlsx", mime: "application/vnd.ms-excel" }), "vendors: PDF test");

  const ref = { threadId: "C-1040", messageId: "gm-18c2f0a", index: 1 };

  const ids = new Set(["rb"]);

  const groups = vendorCardGroups({
    vendorQuotes: [
      { id: "v1", vendor: "Rose Brand", vendorCompanyId: "rb", quoteNumber: "RB-1", total: 100, attachment: { blobPath: "vendor-quotes/v1-x.pdf" } },
      { id: "v2", vendor: "zeta typed" }, { id: "v3", vendor: "Alpha Typed" }, { id: "v4", vendor: "J.R. Clancy", vendorCompanyId: "jr" },
    ],
    companies: [{ id: "rb", name: "Rose Brand", href: "/companies/rb" }, { id: "ap", name: "Apollo", href: "/companies/ap" }],
  });
  ok(groups.map((g) => g.name).join("|") === "Apollo|J.R. Clancy|Rose Brand|Alpha Typed|zeta typed", "vendors: card groups — companies by name, typed last");
  const rb = groups.find((g) => g.companyId === "rb")!;
  ok(groups.find((g) => g.name === "Alpha Typed")!.companyId === null && groups.find((g) => g.name === "Alpha Typed")!.href === null, "vendors: legacy typed quote has no company");

  const rows = quotesReceivedRows("rb", [
    { id: "Q1", number: "EST-1001", name: "Gym", customer: "MPSD", status: "sent", href: "/estimator?id=Q1", vendorQuotes: [{ id: "a", vendorCompanyId: "rb", quoteNumber: "RB-1", total: 50, addedAt: 10 }, { id: "b", vendorCompanyId: "jr" }] },
    { id: "Q2", number: "EST-1002", name: "Aud", customer: "", status: "draft", href: "/estimator?id=Q2", vendorQuotes: [{ id: "c", vendorCompanyId: "rb", quoteNumber: "RB-2", total: 70, addedAt: 20 }, { id: "d", vendorCompanyId: "rb" }] },
  ]);
  ok(rows.map((r) => r.key).join() === "Q2:c,Q1:a,Q2:d", "vendors: received rows newest first, undated last, other vendors excluded");
  ok(rows[1].job === "Gym — MPSD" && rows[0].job === "Aud" && rows[1].vendorQuoteNumber === "RB-1" && rows[1].total === 50 && rows[2].addedAt === null, "vendors: received row fields");

  // Task 5 — the vendor quote modal + the ?vq= hand-off
  const modal = readFileSync("src/app/(app)/estimator/vendor-quote-modal.tsx", "utf8");
  ok(modal.includes("VendorCompanyField") && !modal.includes('list="pk-vendor-names"'), "vendor modal: the Vendor cell is VendorCompanyField (datalist moved into it)");
  const vqActions = readFileSync("src/app/(app)/estimator/vendor-actions.ts", "utf8");
  const hook = readFileSync("src/app/(app)/estimator/use-estimator-state.ts", "utf8");
  const stripAt = hook.indexOf('.delete("vq")');
  const field = readFileSync("src/components/vendors/vendor-company-field.tsx", "utf8");
  ok(field.includes('setMode("typed"); // the kept name') && field.includes("Current: {vendor}") && field.includes("onTyped(\"\")") && field.includes("seenCompanyId"), "vendor field: unlink lands in typed with the name kept; search shows Current: <name> with a clear; mode re-derives on a company change");
  ok(!/setMode\("search"\);\s*onUnlink/.test(field), "vendor field: unlinking never hides the kept name behind search");
  ok(modal.includes('htmlFor="vendor-quote-vendor"') && modal.includes('inputId="vendor-quote-vendor"'), "vendor modal: Vendor label tied to the field's input");
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
    const T6 = fixtureId(348, "vt6");
    const now = Date.now();

    // part C — filing a thread + visibility-filtered vendor threads (Task 4)
    const vp1 = fixtureId(348, "vp1");
    await createFixture("projects", { id: vp1, kind: "project", name: "Vendor test project", customer: "Vendor Test Owner", customerId: vcust, quoteId: q, createdAt: now, updatedAt: now } as never);
    const [T1, T2, T3, T4, T5, T7] = ["vt1", "vt2", "vt3", "vt4", "vt5", "vt7"].map((s) => fixtureId(348, s));
    const sugg = { customerId: vcust, work: null, noise: false, source: "identity", reason: "test", strength: "strong", needsReply: false, state: "suggested", at: now };
    const stQ = await getQuote(q);

    const idsOf = (r: Array<{ id: string }>) => r.map((x) => x.id).sort().join("|");
    const vSet = new Set([vven1]);
    const allowed: string[] = [];
    // last: filing T8 links it to the estimate, so it would join the lists asserted above
    const T8 = fixtureId(348, "vt8");

    if (!blobEnabled()) {
      let threw = false;
      try { } catch { threw = true; }
    } else {
      let threw = false;
      try { } catch { threw = true; }
    }

    // part D — quotes we've received + project Procurement read-through (Task 8)
    const vqSrc = readFileSync("src/lib/stores/vendor-quotes.ts", "utf8");
    const recvBody = vqSrc.slice(vqSrc.indexOf("export async function quotesReceivedFor"));
    ok((recvBody.match(/getQuotes\(/g) || []).length === 1 && !/getQuote\(/.test(recvBody) && (recvBody.match(/listForCompany\(/g) || []).length === 1, "vendors db: quotesReceivedFor makes one party read and one quote batch (no per-quote get)");
    const recv2 = await quotesReceivedFor(vven1);
    ok(recv2.length === 1 && recv2[0].key.startsWith(`${q}:`) && recv2[0].quoteId === q && recv2[0].total === recv[0].total && recv2[0].vendorQuoteNumber === recv[0].vendorQuoteNumber, "vendors db: quotes received carries one row per vendor quote with its estimate and total");
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


/* ---- #348 slice 5 Task 3: fill / undo / diff / report (pure) ---- */

if (process.argv[1]?.endsWith("test-vendors.ts")) {
  let pass = 0, fail = 0;
  const ok: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  vendorChecks(ok).then(() => { console.log(`${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0); });
}



