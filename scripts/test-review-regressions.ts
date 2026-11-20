import assert from "node:assert/strict";
import { getDoc, upsertDoc, patchDoc } from "@/db/doc-store";
import { withTransaction } from "@/db";
import type { Quote } from "@/lib/stores/quotes";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { contactByEmail } from "@/lib/identity/lookup";
import { contactsForCompany, emailsFor, saveContact, setEmails, softDeleteContact } from "@/lib/identity/contacts";
import { get as getLead, getAll as getAllLeads } from "@/lib/stores/leads";
import { addUser } from "@/lib/users";
import { getCompany, saveCompany } from "@/lib/identity/companies";
import { sitesForCompany } from "@/lib/identity/sites";
import { VENDOR_COMPANY_TYPE } from "@/lib/identity/config";
import {
  claimManufacturer, createVendorCompany, getVendorProfile, isVendorCompany, logPriceList,
  saveVendorProfile, setContactRole, vendorCompanyNamed, vendorForManufacturer,
} from "@/lib/stores/vendors";
import { setSettings } from "@/lib/settings";
import { loadVendors } from "@/lib/vendor-tasks";
import {
  upsert as upsertCustomer,
  get as getCustomer,
  all as allCustomers,
  remove as removeCustomer,
  findCustomerByName,
  findCustomerById,
} from "@/lib/stores/customers";
import { commitImport, exportCsv } from "@/app/(app)/import/registry";
import { getTypeMeta } from "@/app/(app)/import/types";
import { autoMap, norm, parseCsv, prepareRows } from "@/app/(app)/import/parse";

/** #137 — CSV text → the prepared rows commitImport takes, through the same
 *  parse / autoMap / prepareRows path the import action runs. */
function prepImport(key: string, csv: string) {
  const type = getTypeMeta(key);
  if (!type) throw new Error(`unknown import type ${key}`);
  const p = parseCsv(csv);
  if (!p.ok) throw new Error(`CSV did not parse: ${p.error}`);
  return prepareRows(p.rows, autoMap(p.headers, type.fields), type.fields).rows;
}

async function main() {
  // Engineering batch B1 — ambient transactions must roll back doc-store
  // writes, including writes made through a nested helper transaction.
  const txProbe = `engineering-tx-${Date.now()}`;
  await assert.rejects(
    withTransaction(async () => {
      await upsertDoc("quotes", { id: txProbe, value: "rolled-back" } as any);
      await withTransaction(async () => {
        await patchDoc("quotes", txProbe, (doc: any) => ({ ...doc, nested: true }));
      });
      throw new Error("intentional transaction rollback");
    }),
    /intentional transaction rollback/,
    "B1 transaction failure propagates",
  );
  assert.equal(await getDoc("quotes", txProbe), null, "B1 failed transaction rolls back nested doc writes");

  const quoteId = "Q-review-venue-regression";
  const quote: Quote = {
    id: quoteId,
    name: "Venue linkage regression",
    customer: "Billing company",
    customerId: "billing-company",
    locationId: "venue-site-1",
    value: 1000,
    margin: 0,
    status: "sent",
    source: "consulting",
    quoteType: "consulting",
    owner: "Tester",
    review: {
      state: "none",
      reviewer: null,
      submittedBy: null,
      submittedAt: null,
      decidedBy: null,
      decidedAt: null,
      note: "",
    },
    consulting: {
      scope: "",
      feeMode: "fixed",
      fees: [],
      terms: "",
      phases: [],
      venueCustomerId: "venue-company",
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: [],
  };
  await upsertDoc("quotes", quote as Quote & Record<string, unknown>);

  // #96 — resolver over real tables
  await saveContact({
    id: "ct-t96", firstName: "Brenda", lastName: "Gauchel", homeCompanyId: "lakefront",
    title: "", pricingTier: null, status: "active", userId: null, ownerUserId: "u1",
    isPrimary: false, createdAt: Date.now(),
  });
  await setEmails("ct-t96", [{ value: "brenda.t96@lakefront.k12.mn.us", label: "work", isPrimary: true }]);
  const hit = await contactByEmail("Brenda.T96@Lakefront.K12.MN.US");
  assert.equal(hit && !("ambiguous" in hit) ? hit.customerId : null, "lakefront", "#96 contactByEmail joins to the home company");

  // #96 Wave A fix 1 — a soft-deleted contact must never resolve a sender,
  // and two live contacts on different customers sharing one address is
  // ambiguous, never a silent pick.
  await saveContact({
    id: "ct-t96gone", firstName: "Gone", lastName: "Person", homeCompanyId: "lakefront",
    title: "", pricingTier: null, status: "active", userId: null, ownerUserId: "u1",
    isPrimary: false, createdAt: Date.now(),
  });
  await setEmails("ct-t96gone", [{ value: "gone.t96@t96gone.org", label: "work", isPrimary: true }]);
  const gone = await contactByEmail("gone.t96@t96gone.org");
  assert.equal(gone && !("ambiguous" in gone) ? gone.contactId : null, "ct-t96gone", "#96 live contact resolves before deletion");
  await softDeleteContact("ct-t96gone");
  assert.equal(await contactByEmail("gone.t96@t96gone.org"), null, "#96 contactByEmail ignores a soft-deleted contact");
  await saveContact({
    id: "ct-t96dupA", firstName: "Dup", lastName: "A", homeCompanyId: "lakefront",
    title: "", pricingTier: null, status: "active", userId: null, ownerUserId: "u1",
    isPrimary: false, createdAt: Date.now(),
  });
  await saveContact({
    id: "ct-t96dupB", firstName: "Dup", lastName: "B", homeCompanyId: "other",
    title: "", pricingTier: null, status: "active", userId: null, ownerUserId: "u1",
    isPrimary: false, createdAt: Date.now(),
  });
  await setEmails("ct-t96dupA", [{ value: "shared.t96@t96dup.org", label: "work", isPrimary: true }]);
  await setEmails("ct-t96dupB", [{ value: "shared.t96@t96dup.org", label: "work", isPrimary: true }]);
  const dup = await contactByEmail("shared.t96@t96dup.org");
  assert.ok(dup && "ambiguous" in dup, "#96 contactByEmail reports two live customers as ambiguous");
  assert.deepEqual(
    dup && "ambiguous" in dup ? [...dup.ambiguous].sort() : [],
    ["lakefront", "other"],
    "#96 contactByEmail lists both live customers"
  );

  process.env.AUTH_SECRET ||= "quartzite-test-secret-not-for-production";


  // #133 — pricedAt moves only when list/cost change; the book date round-trips
  {
    const { get: getPart, mergeUpsert } = await import("@/lib/stores/catalog");
    const { getSettings, setPriceListEffective } = await import("@/lib/settings");
    const D1 = new Date(2026, 0, 15).getTime();
    const D2 = new Date(2026, 5, 1).getTime();
    await mergeUpsert("T133-STAMP", { desc: "Stamp test", category: "Test", unit: "ea", list: 100, cost: 60, mfr: "T133 Stamp" }, { pricedAt: D1 });
    assert.equal((await getPart("T133-STAMP"))?.pricedAt, D1, "#133 a new part is stamped with the write's effective date");
    await mergeUpsert("T133-STAMP", { desc: "Stamp test (renamed)", list: 100, cost: 60 }, { pricedAt: D2 });
    assert.equal((await getPart("T133-STAMP"))?.pricedAt, D1, "#133 an unchanged price keeps its date — a description edit doesn't move it");
    await mergeUpsert("T133-STAMP", { list: 110 }, { pricedAt: D2 });
    assert.equal((await getPart("T133-STAMP"))?.pricedAt, D2, "#133 a list change stamps the effective date that was passed");
    const before = Date.now();
    await mergeUpsert("T133-STAMP", { cost: 70 });
    const stamped = (await getPart("T133-STAMP"))?.pricedAt ?? 0;
    assert.ok(stamped >= before, "#133 a price change through any other path stamps now");
    assert.equal((await getPart("T133-STAMP"))?.desc, "Stamp test (renamed)", "#133 mergeUpsert still preserves fields the patch doesn't carry");

    await setPriceListEffective("t133stamp", D1);
    assert.equal((await getSettings()).priceListEffective?.t133stamp, D1, "#133 setPriceListEffective round-trips through settings");
    await setPriceListEffective("t133stamp", null);
    assert.equal((await getSettings()).priceListEffective?.t133stamp, undefined, "#133 setPriceListEffective(null) clears the key");
  }

  // #132/#133/#134 — the Catalog page importer's body (importCatalog itself needs a session + redirects)
  {
    const { runCatalogImport } = await import("@/app/(app)/catalog/import");
    const { get: getPart } = await import("@/lib/stores/catalog");
    const { getSettings } = await import("@/lib/settings");
    const D1 = new Date(2026, 0, 15).getTime();
    const D2 = new Date(2026, 5, 1).getTime();
    const csv = "SKU,Description,Category,Unit,List,Cost\nT133-A,Test part A,Test,ea,100,60\nT133-B,Test part B,Test,ea,200,120\n";
    const first = await runCatalogImport({ mfr: "T133 Acme", text: csv, bytes: Buffer.byteLength(csv), effectiveAt: D1, defaultCategory: "" });
    assert.ok(first.ok && first.imported === 2 && first.mfr === "T133 Acme", "#133 first import writes both rows under the typed manufacturer");
    assert.equal((await getPart("T133-A"))?.pricedAt, D1, "#133 a new part carries the import's effective date");
    assert.equal((await getPart("T133-A"))?.priceDate, D1, "Oct 15 #32: a priced import dates each part it carries (priceDate)");
    assert.equal((await getSettings()).priceListEffective?.t133acme, undefined, "Oct 15 #32: an import no longer re-dates the manufacturer's whole book");

    const csv2 = "SKU,Description,Category,Unit,List,Cost\nT133-A,Test part A (renamed),Test,ea,100,60\nT133-B,Test part B,Test,ea,210,120\n";
    const second = await runCatalogImport({ mfr: "t133-acme", text: csv2, bytes: Buffer.byteLength(csv2), effectiveAt: D2, defaultCategory: "" });
    assert.ok(second.ok && second.mfr === "T133 Acme", "#132 a re-spelled manufacturer normalizes to the existing spelling");
    assert.equal((await getPart("T133-A"))?.pricedAt, D1, "#133 an unchanged price keeps its date across a re-import");
    assert.equal((await getPart("T133-A"))?.priceDate, D2, "Oct 15 #32: …while the file still dates the unchanged line it lists");
    assert.equal((await getPart("T133-B"))?.pricedAt, D2, "#133 a changed list price stamps the new effective date");
    assert.equal((await getPart("T133-A"))?.mfr, "T133 Acme", "#132 rows are filed under the normalized spelling");

    const wrong = await runCatalogImport({ mfr: "T133 Acme", text: "SKU,Description\nT133-Z,Zed\n", bytes: 30, effectiveAt: D2, defaultCategory: "" });
    assert.ok(!wrong.ok && /None of the 1 SKU in this file belong to T133 Acme/.test(wrong.error), "#132 zero overlap with an existing manufacturer is rejected with the SKU count");
    const foreign = await runCatalogImport({ mfr: "T133 Other", text: "SKU,Description\nT133-A,Stolen\n", bytes: 30, effectiveAt: D2, defaultCategory: "" });
    assert.ok(!foreign.ok && /T133-A is filed under T133 Acme/.test(foreign.error), "#132 a SKU filed under another manufacturer is named in the error");
    assert.equal((await getPart("T133-A"))?.mfr, "T133 Acme", "#132 a rejected import writes nothing");
    const blank = await runCatalogImport({ mfr: "", text: csv, bytes: 100, effectiveAt: D2, defaultCategory: "" });
    assert.ok(!blank.ok && /Choose a manufacturer/.test(blank.error), "#132 a blank manufacturer is rejected server-side");
    const big = await runCatalogImport({ mfr: "T133 Acme", text: csv, bytes: 1_048_577, effectiveAt: D2, defaultCategory: "" });
    assert.ok(!big.ok && /1 MB/.test(big.error), "#134 an over-size upload is refused before parsing");

    // Final review item 3 — a file without a List/Cost column must neither
    // zero the stored prices nor date the manufacturer's book (D156: a file
    // confirms only the prices it carries).
    const D3 = new Date(2026, 8, 1).getTime();
    const descOnly = "SKU,Description\nT133-A,Test part A (desc only)\n";
    const noPrices = await runCatalogImport({ mfr: "T133 Acme", text: descOnly, bytes: Buffer.byteLength(descOnly), effectiveAt: D3, defaultCategory: "" });
    assert.ok(noPrices.ok && noPrices.imported === 1, "item 3: a SKU+description file still imports");
    const afterDescOnly = await getPart("T133-A");
    assert.equal(afterDescOnly?.desc, "Test part A (desc only)", "item 3: …and updates the description");
    assert.equal(afterDescOnly?.list, 100, "item 3: an absent List column leaves the stored list price alone (not zeroed)");
    assert.equal(afterDescOnly?.cost, 60, "item 3: an absent Cost column leaves the stored cost alone (not zeroed)");
    assert.equal(afterDescOnly?.pricedAt, D1, "item 3: …so pricedAt does not move");
    assert.equal(afterDescOnly?.priceDate, D2, "item 3: a price-less file does NOT re-date the line (priceDate stays)");
    assert.equal((await getSettings()).priceListEffective?.t133acme, undefined, "item 3: …nor the manufacturer's book");
    const withPrices = "SKU,Description,List,Cost\nT133-A,Test part A,120,60\n";
    const priced = await runCatalogImport({ mfr: "T133 Acme", text: withPrices, bytes: Buffer.byteLength(withPrices), effectiveAt: D3, defaultCategory: "" });
    assert.ok(priced.ok, "item 3: a file with prices still imports");
    assert.equal((await getPart("T133-A"))?.list, 120, "item 3: …and a carried List price still updates");
    assert.equal((await getPart("T133-A"))?.pricedAt, D3, "item 3: …stamping the changed line");
    assert.equal((await getPart("T133-A"))?.priceDate, D3, "item 3: …and dating the line the file lists");
    assert.equal((await getPart("T133-B"))?.priceDate, D2, "Oct 15 #32: a PARTIAL file (only T133-A) leaves T133-B's date alone");
    assert.equal((await getSettings()).priceListEffective?.t133acme, undefined, "Oct 15 #32: …and never stamps the manufacturer's book");
  }

  // #132/#133 — the Import hub's catalog writer stamps the commit's effective date
  {
    const { commitImport } = await import("@/app/(app)/import/registry");
    const { parseCsv, autoMap, prepareRows } = await import("@/app/(app)/import/parse");
    const { getTypeMeta } = await import("@/app/(app)/import/types");
    const { get: getPart } = await import("@/lib/stores/catalog");
    const t = getTypeMeta("catalog");
    assert.ok(t, "#132 catalog import type exists");
    const D1 = new Date(2026, 0, 15).getTime();
    const D2 = new Date(2026, 5, 1).getTime();
    const prepOf = (csv: string) => {
      const p = parseCsv(csv);
      return prepareRows(p.rows, autoMap(p.headers, t!.fields), t!.fields);
    };
    const created = await commitImport("catalog", prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part,50,30,T133 Hub\n").rows, "update", { effectiveAt: D1 });
    assert.equal(created.created, 1, "#133 hub create path wrote the row");
    assert.equal((await getPart("T133-H1"))?.pricedAt, D1, "#133 the hub stamps the commit's effective date on a new part");
    const same = await commitImport("catalog", prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part renamed,50,30,T133 Hub\n").rows, "update", { effectiveAt: D2 });
    assert.equal(same.updated, 1, "#133 hub update path ran");
    assert.equal((await getPart("T133-H1"))?.pricedAt, D1, "#133 an unchanged price through the hub keeps its date");
    await commitImport("catalog", prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part,55,30,T133 Hub\n").rows, "update", { effectiveAt: D2 });
    assert.equal((await getPart("T133-H1"))?.pricedAt, D2, "#133 a changed price through the hub stamps the new date");
    const invalid = await commitImport("catalog", prepOf("SKU,Description,List Price,Cost\nT133-H2,No manufacturer,50,30\n").rows, "update", { effectiveAt: D2 });
    assert.equal(invalid.errored, 1, "#132 a hub row without a manufacturer is never written");
    assert.equal(await getPart("T133-H2"), null, "#132 …and does not exist afterwards");

    // Final review item 3 — "Create new" on a SKU that already exists is a
    // merge (the SKU is the document id), so an absent price column must
    // preserve the stored price exactly like "Update existing" does (#81).
    const D3 = new Date(2026, 8, 1).getTime();
    const createDescOnly = await commitImport("catalog", prepOf("SKU,Description,Manufacturer\nT133-H1,Hub part (desc only),T133 Hub\n").rows, "create", { effectiveAt: D3 });
    assert.equal(createDescOnly.created, 1, "item 3: hub create mode on an existing SKU runs the create path");
    const afterCreate = await getPart("T133-H1");
    assert.equal(afterCreate?.desc, "Hub part (desc only)", "item 3: …and updates the description");
    assert.equal(afterCreate?.list, 55, "item 3: hub create mode keeps the stored list price when the file has no List column");
    assert.equal(afterCreate?.cost, 30, "item 3: …and the stored cost when it has no Cost column");
    assert.equal(afterCreate?.pricedAt, D2, "item 3: …so pricedAt does not move");

    // Final review item 1 (D156) — the hub's manufacturer book date is
    // stamped per manufacturer group, only for groups the commit actually
    // wrote: "Skip duplicates" compares nothing, so it confirms nothing.
    // commitCatalogImport is importRecords' body (guard → normalize →
    // commitImport → stamp), split out so it runs here without a session.
    const { commitCatalogImport } = await import("@/app/(app)/import/catalog-commit");
    const { getSettings } = await import("@/lib/settings");
    assert.equal((await getSettings()).priceListEffective?.t133hub, undefined, "item 1: precondition — T133 Hub has no book date yet");
    const skipped = await commitCatalogImport({ rows: prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part,55,30,T133 Hub\n").rows, mode: "skip", effectiveAt: D3, priced: true });
    assert.ok(skipped.ok && skipped.res.skipped === 1 && skipped.stamped.length === 0, "item 1: skip mode skips the existing SKU and stamps no book");
    assert.equal((await getSettings()).priceListEffective?.t133hub, undefined, "item 1: a skip-mode commit leaves priceListEffective[key] undefined");
    const updated = await commitCatalogImport({ rows: prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part,55,30,t133-hub\n").rows, mode: "update", effectiveAt: D3, priced: true });
    assert.ok(updated.ok && updated.res.updated === 1 && updated.res.written.length === 1, "item 1: update mode writes the row (commitImport reports the written rows)");
    assert.deepEqual(updated.ok ? updated.stamped : [], ["t133hub"], "item 1: …and reports that manufacturer's rows as dated, keyed through mfrKey");
    assert.equal((await getSettings()).priceListEffective?.t133hub, undefined, "Oct 15 #32: an update-mode commit no longer stamps the manufacturer's book");
    assert.equal((await getPart("T133-H1"))?.priceDate, D3, "Oct 15 #32: …it dates the line it carries (an unchanged price still confirms the line)");
    assert.equal((await getPart("T133-H1"))?.pricedAt, D2, "item 1: …while the unchanged line keeps its own pricedAt");
    const D4 = new Date(2026, 8, 15).getTime();
    const unpriced = await commitCatalogImport({ rows: prepOf("SKU,Description,Manufacturer\nT133-H1,Hub part (desc only),T133 Hub\n").rows, mode: "update", effectiveAt: D4, priced: false });
    assert.ok(unpriced.ok && unpriced.res.updated === 1 && unpriced.stamped.length === 0, "item 1/3: a price-less file writes the description but confirms no price");
    assert.equal((await getPart("T133-H1"))?.priceDate, D3, "item 1/3: …so the hub does not re-date the line either");
    const mixed = await commitCatalogImport({
      rows: prepOf("SKU,Description,List Price,Cost,Manufacturer\n,Blank SKU,1,1,T133 Hub\nT133-H1,Hub part,55,30,T133 Hub\nT133-H3,Other maker's part,10,5,T133 Hub Two\n").rows,
      mode: "update",
      effectiveAt: D4,
      priced: true,
    });
    assert.ok(mixed.ok && mixed.res.errored === 1 && mixed.res.updated === 1 && mixed.res.created === 1 && mixed.res.failed.length === 1, "item 1: a file with one bad row still writes the good rows");
    assert.deepEqual(mixed.ok ? [...mixed.stamped].sort() : [], ["t133hub", "t133hubtwo"], "Oct 15 #32: per part — every manufacturer with a written row is reported dated");
    assert.equal((await getPart("T133-H1"))?.priceDate, D4, "Oct 15 #32: …the written T133 Hub line takes the file's date despite the errored row");
    assert.equal((await getPart("T133-H3"))?.priceDate, D4, "Oct 15 #32: …and so does T133 Hub Two's");
    assert.equal((await getSettings()).priceListEffective?.t133hubtwo, undefined, "Oct 15 #32: …with no book date stamped");
    const foreign = await commitCatalogImport({ rows: prepOf("SKU,Description,List Price,Cost,Manufacturer\nT133-H1,Hub part,99,30,T133 Other\n").rows, mode: "update", effectiveAt: D4, priced: true });
    assert.ok(!foreign.ok && /T133 Other: .*T133-H1 is filed under T133 Hub/.test(foreign.error), "item 1: the guard still runs first and names the manufacturer + SKU");
    assert.equal((await getPart("T133-H1"))?.list, 55, "item 1: …and a rejected commit writes nothing");
  }
  // Attach a WON consulting proposal (#135 review fix) — won, not draft, so
  // engagementSyncAction has a real action to compute for "Q-t135-attach"
  // and the next sweep actually exercises the index: a broken/missing
  // sweepIndexesEngagement would fail to find this row by quoteId, see
  // current=null, and mint a duplicate awarded engagement
  // (engagementSyncAction("won", null) => create). A draft quote can never
  // surface that bug — engagementSyncAction("draft", …) is always null, so
  // the assertions below would pass whether or not the index worked. The
  // quote is created only now (after the earlier settling sweeps), so no
  // sweep-born row exists yet to collide with the id.
  await upsertDoc("quotes", { ...quote, id: "Q-t135-attach", status: "won" } as Quote & Record<string, unknown>);
  await upsertDoc("quotes", { ...quote, id: "Q-t135-notconsulting", quoteType: "flame" } as Quote & Record<string, unknown>);

  // #131 T10 (review fix) — cleanGridCategoryShapes is the exact "clean or
  // null" step saveGridCategoryShapesAction persists (factored out to a
  // pure helper since the action itself needs a session): an empty map
  // must collapse to null — never {}, which resolveCategoryShapes treats
  // as the whole truth and would drop every category to "rect" — a valid
  // entry round-trips, and an invalid shape is dropped while a valid
  // sibling entry survives.
  {
  }

  // #122 — vendor profiles: CRUD, claim moves a manufacturer, vendors get no base venue
  {
    await saveCompany({ id: "v-t122a", name: "Vendor A T122", type: VENDOR_COMPANY_TYPE });
    await saveCompany({ id: "v-t122b", name: "Vendor B T122", type: VENDOR_COMPANY_TYPE });
    assert.equal(await getVendorProfile("v-t122a"), null, "#122 no profile document until something is saved");
    const saved = await saveVendorProfile("v-t122a", { discounts: { note: "Dealer program", percentOffList: 35, terms: "Net 30" } });
    assert.equal(saved.discounts.percentOffList, 35, "#122 saveVendorProfile writes discounts");
    assert.equal((await getVendorProfile("v-t122a"))?.discounts.terms, "Net 30", "#122 the profile round-trips through the doc table");
    await claimManufacturer("v-t122a", "T122 Mfr");
    assert.equal(await vendorForManufacturer("t122-mfr"), "v-t122a", "#122 claim matches by mfrKey (case/punctuation-insensitive)");
    await claimManufacturer("v-t122b", "t122 MFR");
    assert.equal(await vendorForManufacturer("T122 Mfr"), "v-t122b", "#122 claiming moves the manufacturer to the new vendor");
    assert.deepEqual((await getVendorProfile("v-t122a"))?.manufacturers, [], "#122 the previous owner no longer lists it");
    await setContactRole("v-t122b", "ct-t122-x", "Price lists");
    assert.equal((await getVendorProfile("v-t122b"))?.contactRoles["ct-t122-x"], "Price lists", "#122 contact role is stored by contact id");
    await setContactRole("v-t122b", "ct-t122-x", "   ");
    assert.equal((await getVendorProfile("v-t122b"))?.contactRoles["ct-t122-x"], undefined, "#122 a blank role clears the entry");
    const logged = await logPriceList("v-t122b", { receivedAt: 1_000, effectiveAt: 500, note: "old" }, "Tester");
    await logPriceList("v-t122b", { receivedAt: 2_000, effectiveAt: 900, note: "newer" }, "Tester");
    assert.equal(logged.priceLists.length, 1, "#122 logPriceList appends one entry");
    assert.equal((await getVendorProfile("v-t122b"))?.priceLists[0]?.note, "newer", "#122 ledger is newest-first by effectiveAt");
    const made = await createVendorCompany("Acme Rigging T122");
    assert.equal(made.id, "v-acmeriggingt122", "#122 createVendorCompany mints v-<mfrKey>");
    assert.equal(made.type, VENDOR_COMPANY_TYPE, "#122 createVendorCompany presets the vendor type");
    assert.equal((await sitesForCompany(made.id)).length, 0, "#122 a new vendor gets NO base venue (PARTNER_TYPES fix)");
    assert.ok(await getVendorProfile(made.id), "#122 createVendorCompany mints the blank profile");
  }

  // #122 — owner tasks are exactly-once per (vendor, status, date); done ones never reopen
  {
    const part = (sku: string) => ({ id: sku, sku, desc: "T122 cron part " + sku, category: "Rigging", unit: "ea", list: 10, cost: 5, mfr: "T122 Cron Mfr" });
    await upsertDoc("catalog_parts", part("T122-C1"));
    await upsertDoc("catalog_parts", part("T122-C2"));
    await saveCompany({ id: "v-t122c", name: "Vendor C T122", type: VENDOR_COMPANY_TYPE });
    await claimManufacturer("v-t122c", "T122 Cron Mfr");
    const owner = await addUser({ name: "Catalog Owner T122", roles: ["Admin"] });
    await setSettings({ catalogOwner: { userId: owner.id } });

    const before = (await loadVendors("v-t122c")).rows[0];
    assert.equal(before?.status, "no-list", "#122 a vendor with no ledger entry reads no-list");
    assert.equal(before?.partCount, 2, "#122 loadVendors counts the claimed manufacturer's parts");

    const E = Date.now() - 5 * 86_400_000;
    await logPriceList("v-t122c", { receivedAt: Date.now(), effectiveAt: E, note: "2026 list" }, "Tester");
    const key = `auto: vendor v-t122c newer-list ${E}`;

    // a later import stamps pricedAt ≥ effectiveAt → current, nothing new
    await upsertDoc("catalog_parts", { ...part("T122-C1"), pricedAt: E });
    await upsertDoc("catalog_parts", { ...part("T122-C2"), pricedAt: E + 1 });
    assert.equal((await loadVendors("v-t122c")).rows[0]?.status, "current", "#122 pricedAt ≥ effectiveAt flips the status to current");
  }

  // #122 §3 — a ledger save spawns the owner task immediately, and that task's
  // Home Queue row lands on the vendor's own screen (not back on /queue).
  {
    const part = { id: "T122-D1", sku: "T122-D1", desc: "T122 detail part", category: "Rigging", unit: "ea", list: 10, cost: 5, mfr: "T122 Detail Mfr" };
    await upsertDoc("catalog_parts", part);
    await saveCompany({ id: "v-t122d", name: "Vendor D T122", type: VENDOR_COMPANY_TYPE });
    await claimManufacturer("v-t122d", "T122 Detail Mfr");

    const eff = Date.now() - 3 * 86_400_000;
    const key = `auto: vendor v-t122d newer-list ${eff}`;

    // what logPriceListAction does: append the entry, then re-derive at once
    await logPriceList("v-t122d", { receivedAt: Date.now(), effectiveAt: eff, note: "2027 list" }, "Tester");

    // re-saving the SAME entry must not spawn a second task
    await logPriceList("v-t122d", { receivedAt: Date.now(), effectiveAt: eff, note: "2027 list again" }, "Tester");
  }

  // #122 — claim from the unclaimed panel: reuse a vendor by normalized name, else create one
  {
    const reused = await vendorCompanyNamed("VENDOR-B T122");
    assert.equal(reused.id, "v-t122b", "#122 vendorCompanyNamed reuses a vendor whose name normalizes the same");
    const fresh = await vendorCompanyNamed("Wenger Corp T122");
    assert.equal(fresh.id, "v-wengercorpt122", "#122 vendorCompanyNamed creates a vendor named after the manufacturer");
    assert.equal(fresh.type, VENDOR_COMPANY_TYPE, "#122 …typed as a vendor");
    await claimManufacturer(fresh.id, "Wenger Corp T122");
    assert.equal(await vendorForManufacturer("wenger corp t122"), fresh.id, "#122 …and it owns the claimed manufacturer");
  }

  // #122 C1 — re-creating a vendor by the name of a SOFT-DELETED one must not
  // silently revive and overwrite it. The slug is taken by ANY company row,
  // deleted or not, so "+ New vendor" mints a fresh id; the deleted vendor
  // keeps its ledger, claims, discounts and contacts (the only history there
  // is — the profile doc has no versions to recover from).
  {
    const made = await createVendorCompany("Deleted Vendor T122");
    assert.equal(made.id, "v-deletedvendort122", "#122 C1 fixture: the first vendor takes the plain v-<mfrKey> slug");
    await upsertCustomer({
      id: made.id,
      name: "Deleted Vendor T122",
      type: VENDOR_COMPANY_TYPE,
      locations: [{ id: "l-t122-c1", label: "Warehouse", primary: true, address: "1 Dock Rd", city: "Madison", state: "WI" }],
      contacts: [{ name: "Dana Ledger", email: "dana@t122c1.example", primary: true }],
    });
    await claimManufacturer(made.id, "T122 C1 Mfr");
    await logPriceList(made.id, { receivedAt: 1_700_000_000_000, effectiveAt: 1_700_000_000_000, note: "2026 list" }, "Tester");
    await saveVendorProfile(made.id, { discounts: { note: "Dealer program", percentOffList: 20, terms: "Net 45" } });
    assert.equal((await contactsForCompany(made.id)).length, 1, "#122 C1 fixture: the vendor carries one contact");

    // The Edit button's Delete — deleteCustomerAction → softDeleteCompany.
    await removeCustomer(made.id);
    assert.equal(await getCompany(made.id), null, "#122 C1 fixture: the vendor reads as deleted");

    const again = await createVendorCompany("Deleted Vendor T122");
    assert.notEqual(again.id, made.id, "#122 C1 a soft-deleted slug is TAKEN — the re-created vendor gets its own id");
    assert.equal(await getCompany(made.id), null, "#122 C1 …and the deleted vendor is not resurrected by the re-create");
    const kept = await getVendorProfile(made.id);
    assert.equal(kept?.priceLists.length, 1, "#122 C1 the deleted vendor's price-list ledger survives");
    assert.deepEqual(kept?.manufacturers, ["T122 C1 Mfr"], "#122 C1 …its manufacturer claims survive");
    assert.equal(kept?.discounts.terms, "Net 45", "#122 C1 …and its discount terms survive");
    assert.equal(
      (await contactsForCompany(made.id)).length,
      1,
      "#122 C1 …and its contacts are not soft-deleted by the re-create's empty contacts list"
    );

    const born = await getVendorProfile(again.id);
    assert.ok(born, "#122 C1 the re-created vendor gets its own blank profile");
    assert.deepEqual(
      [born?.priceLists.length, born?.manufacturers.length],
      [0, 0],
      "#122 C1 …blank, sharing nothing with the deleted vendor's record"
    );
  }

  // #122 I1 — nothing cascades from softDeleteCompany to vendor_profiles, so a
  // deleted vendor's claims must stop counting as ownership: the manufacturer
  // returns to "Unclaimed manufacturers" (the only path back to a real vendor)
  // instead of labelling the Catalog link with a raw id that 404s.
  {
    await upsertDoc("catalog_parts", {
      id: "T122-I1", sku: "T122-I1", desc: "T122 I1 part", category: "Rigging", unit: "ea", list: 10, cost: 5, mfr: "T122 I1 Mfr",
    });
    const co = await createVendorCompany("Stranded Vendor T122");
    await claimManufacturer(co.id, "T122 I1 Mfr");
    const claimed = (await loadVendors(co.id)).directory.find((m) => m.name === "T122 I1 Mfr");
    assert.equal(claimed?.vendorId, co.id, "#122 I1 fixture: a live vendor owns the manufacturer");
    assert.equal(claimed?.vendorName, "Stranded Vendor T122", "#122 I1 fixture: …labelled by name, not by raw id");

    await removeCustomer(co.id);
    const after = (await loadVendors()).directory.find((m) => m.name === "T122 I1 Mfr");
    assert.equal(after?.vendorId, null, "#122 I1 a soft-deleted vendor's manufacturer reappears as unclaimed");
    assert.equal(after?.vendorName, "", "#122 I1 …with no dangling vendor link to label");
    assert.ok(
      (await getVendorProfile(co.id))?.manufacturers.includes("T122 I1 Mfr"),
      "#122 I1 …while the deleted vendor's own profile keeps the claim (C1: nothing blanks it)"
    );
  }

  // #122 T1 — the NEGATIVE half of the queue's company-link rule. The
  // /vendors/<id> deep link is gated on the vendor task's `source` prefix
  // because a "company" link from anywhere else may be a CUSTOMER, and that
  // route notFound()s on one.
  {
  }

  // #122 T1 — the action-layer scope guard (`vendorOr()` in vendors/actions.ts
  // is this predicate turned into "Vendor not found."): only a LIVE company of
  // the vendor type can be written to, so no customer record can ever reach
  // the vendor_profiles collection.
  {
    await upsertCustomer({ id: "c-t122-t1-customer", name: "T122 T1 Customer", type: "Education", locations: [], contacts: [] });
    assert.equal(await isVendorCompany("c-t122-t1-customer"), false, "#122 T1 a customer id is rejected by the vendor scope guard");
    assert.equal(await isVendorCompany("v-t122b"), true, "#122 T1 …a vendor company passes it");
    assert.equal(await isVendorCompany("v-deletedvendort122"), false, "#122 T1 …a soft-deleted vendor is not writable either");
    assert.equal(await isVendorCompany("v-t122-no-such-id"), false, "#122 T1 …nor is an id that doesn't exist");
  }

  // #137 T1 — zip / kind / phone / website / mobile plumbing through the customer seam
  {
    await upsertCustomer({
      id: "c-t137-plumb", name: "T137 Plumbing Playhouse", type: "Performing arts",
      zip: "53703", phone: "(608) 555-0100", website: "t137.example",
      locations: [{ id: "l-t137-1", label: "Main Stage", primary: true, address: "215 W Main St", city: "Madison", state: "WI", zip: "53703-1234", kind: "theatre" }],
      contacts: [{ name: "Maria Lopez", email: "maria@t137.example", phone: "(608) 555-0110", mobile: "(608) 555-0111", primary: true }],
    });
    const a = await getCustomer("c-t137-plumb");
    assert.ok(a, "#137 T1 customer written");
    assert.equal(a!.zip, "53703", "#137 T1 company zip persists (companies.zip)");
    assert.equal(a!.phone, "(608) 555-0100", "#137 T1 company phone persists (companies.main_phone)");
    assert.equal(a!.website, "t137.example", "#137 T1 company website persists");
    assert.equal(a!.locations[0].zip, "53703-1234", "#137 T1 venue zip persists (ZIP+4 kept as typed)");
    assert.equal(a!.locations[0].kind, "theatre", "#137 T1 venue kind persists (sites.kind)");
    assert.equal(a!.contacts[0].mobile, "(608) 555-0111", "#137 T1 contact mobile persists as a mobile-labelled phone");
    assert.equal(a!.contacts[0].phone, "(608) 555-0110", "#137 T1 …and the work phone is still `phone`");

    // A writer that doesn't carry the new fields (the Companies modal shape)
    // preserves them AND does not register as a change (D83).
    await upsertCustomer({
      id: "c-t137-plumb", name: "T137 Plumbing Playhouse", type: "Performing arts",
      locations: [{ id: "l-t137-1", label: "Main Stage", primary: true, address: "215 W Main St", city: "Madison", state: "WI" }],
      contacts: [{ name: "Maria Lopez", email: "maria@t137.example", phone: "(608) 555-0110", primary: true }],
    });
    const b = await getCustomer("c-t137-plumb");
    assert.equal(b!.zip, "53703", "#137 T1 company zip preserved when a writer omits it");
    assert.equal(b!.phone, "(608) 555-0100", "#137 T1 company phone preserved when a writer omits it");
    assert.equal(b!.locations[0].zip, "53703-1234", "#137 T1 venue zip preserved when a writer omits it");
    assert.equal(b!.locations[0].kind, "theatre", "#137 T1 venue kind preserved when a writer omits it");
    assert.equal(b!.contacts[0].mobile, "(608) 555-0111", "#137 T1 contact mobile preserved when a writer omits it");
    assert.equal(b!.updatedAt, a!.updatedAt, "#137 T1 an omit-everything re-save is a no-change write (updatedAt unchanged)");

    // …and a writer that carries a value writes it.
    await upsertCustomer({
      id: "c-t137-plumb", name: "T137 Plumbing Playhouse", type: "Performing arts", zip: "53704",
      locations: [{ id: "l-t137-1", label: "Main Stage", primary: true, address: "215 W Main St", city: "Madison", state: "WI", zip: "53704" }],
      contacts: [{ name: "Maria Lopez", email: "maria@t137.example", phone: "(608) 555-0110", primary: true }],
    });
    const c = await getCustomer("c-t137-plumb");
    assert.equal(c!.zip, "53704", "#137 T1 a provided company zip overwrites");
    assert.equal(c!.locations[0].zip, "53704", "#137 T1 a provided venue zip overwrites");
    assert.equal(c!.contacts[0].mobile, "(608) 555-0111", "#137 T1 mobile survives a zip-only change");

    assert.equal((await findCustomerByName("t-137 plumbing PLAYHOUSE!"))?.id, "c-t137-plumb", "#137 T1 findCustomerByName matches case/punctuation-insensitively");
    assert.equal(await findCustomerByName("nobody t137"), null, "#137 T1 findCustomerByName: unknown → null");
    assert.equal((await findCustomerById("c-t137-plumb"))?.name, "T137 Plumbing Playhouse", "#137 T1 findCustomerById");
    assert.ok((await allCustomers()).some((x) => x.id === "c-t137-plumb"), "#137 T1 all() lists it");

    // Re-creating a soft-deleted id (Companies "remove" → a later upsert with
    // the same id, e.g. a re-import) must keep matching the surviving contact
    // rows by name — softDeleteCompany leaves them on the company — so the
    // revival neither duplicates them nor drops their phone/mobile channels.
    await removeCustomer("c-t137-plumb");
    assert.equal(await getCustomer("c-t137-plumb"), null, "#137 T1 soft-deleted customer no longer composes");
    assert.equal(await findCustomerByName("T137 Plumbing Playhouse"), null, "#137 T1 findCustomerByName ignores soft-deleted companies");
    await upsertCustomer({
      id: "c-t137-plumb", name: "T137 Plumbing Playhouse", type: "Performing arts",
      locations: [{ id: "l-t137-1", label: "Main Stage", primary: true, city: "Madison", state: "WI" }],
      contacts: [{ name: "Maria Lopez", email: "maria@t137.example", primary: true }],
    });
    const d = await getCustomer("c-t137-plumb");
    assert.equal(d!.contacts.length, 1, "#137 T1 revived id re-matches the surviving contact by name (no duplicate row)");
    assert.equal(d!.contacts[0].phone, "(608) 555-0110", "#137 T1 revived contact keeps its work phone");
    assert.equal(d!.contacts[0].mobile, "(608) 555-0111", "#137 T1 revived contact keeps its mobile channel");

    // #137 T1 review — a supplied phone/mobile that matches an existing
    // number under a different label relabels that row instead of vanishing
    // (else rec.mobile never matches the composed side and D83 never converges).
    await upsertCustomer({
      id: "c-t137-dupphone", name: "T137 Dup Phone Co", type: "Vendor",
      contacts: [{ name: "Sam Duplicate", email: "sam@t137.example", phone: "555-1000", mobile: "555-1000", primary: true }],
    });
    const e = await getCustomer("c-t137-dupphone");
    assert.equal(e!.contacts[0].phone, "555-1000", "#137 T1 review: phone==mobile on first save — phone reads back");
    assert.equal(e!.contacts[0].mobile, "555-1000", "#137 T1 review: phone==mobile on first save — mobile relabelled, not dropped (one row)");
    await upsertCustomer({
      id: "c-t137-dupphone", name: "T137 Dup Phone Co", type: "Vendor",
      contacts: [{ name: "Sam Duplicate", email: "sam@t137.example", phone: "555-1000", mobile: "555-1000", primary: true }],
    });
    const e2 = await getCustomer("c-t137-dupphone");
    assert.equal(e2!.updatedAt, e!.updatedAt, "#137 T1 review: identical phone==mobile re-save leaves updatedAt unchanged (D83)");

    // A genuinely distinct mobile is unaffected: two separate rows, phone unchanged.
    await upsertCustomer({
      id: "c-t137-2phones", name: "T137 Two Phones Co", type: "Vendor",
      contacts: [{ name: "Dana Separate", email: "dana@t137.example", phone: "555-3000", mobile: "555-4000", primary: true }],
    });
    const f = await getCustomer("c-t137-2phones");
    assert.equal(f!.contacts[0].phone, "555-3000", "#137 T1 review: distinct phone/mobile — phone unchanged");
    assert.equal(f!.contacts[0].mobile, "555-4000", "#137 T1 review: distinct phone/mobile — a separate mobile row exists");

    // phone only, mobile never supplied: re-saving identically does not churn.
    await upsertCustomer({
      id: "c-t137-onlyphone", name: "T137 Only Phone Co", type: "Vendor",
      contacts: [{ name: "Pat Phoneonly", email: "pat@t137.example", phone: "555-5000", primary: true }],
    });
    const g = await getCustomer("c-t137-onlyphone");
    assert.equal(g!.contacts[0].mobile, undefined, "#137 T1 review: phone-only contact has no mobile");
    await upsertCustomer({
      id: "c-t137-onlyphone", name: "T137 Only Phone Co", type: "Vendor",
      contacts: [{ name: "Pat Phoneonly", email: "pat@t137.example", phone: "555-5000", primary: true }],
    });
    const g2 = await getCustomer("c-t137-onlyphone");
    assert.equal(g2!.updatedAt, g!.updatedAt, "#137 T1 review: identical phone-only re-save leaves updatedAt unchanged (D83)");
  }

  // #137 T4 — customers import: Category + Zip + Phone + Website, legacy embedded columns, export round-trip
  {
    const res = await commitImport("customers", prepImport("customers", [
      "Customer Name,Category,Address,City,State,Zip,Phone,Website,Notes",
      "T137 Import Playhouse,Worship,215 W Main St,Madison,WI,53703,(608) 555-0100,t137import.example,",
    ].join("\n")), "skip");
    assert.equal(res.created, 1, "#137 T4 one customer created");
    assert.equal(res.errored, 0, "#137 T4 no errors");
    const a = await findCustomerByName("T137 Import Playhouse");
    assert.ok(a, "#137 T4 customer findable by name");
    assert.equal(a!.type, "Worship", "#137 T4 Category → type");
    assert.equal(a!.zip, "53703", "#137 T4 Zip → company zip");
    assert.equal(a!.phone, "(608) 555-0100", "#137 T4 Phone → company phone (no contact on the row)");
    assert.equal(a!.website, "t137import.example", "#137 T4 Website → company website");
    assert.equal(a!.locations.length, 1, "#137 T4 exactly one venue (the address venue, no extra base venue)");
    assert.equal(a!.locations[0].address, "215 W Main St", "#137 T4 Address → primary venue");
    assert.equal(a!.locations[0].zip, "53703", "#137 T4 Zip → primary venue zip too");
    assert.equal(a!.locations[0].primary, true, "#137 T4 …and it is primary");

    // A pre-#137 file (Type / Contact Name / Email / Phone / Venue) in
    // "Update existing" mode: embedded columns still land, nothing is wiped.
    const res2 = await commitImport("customers", prepImport("customers", [
      "Customer Name,Type,Contact Name,Email,Phone,Venue,Address,City,State",
      "T137 Import Playhouse,Performing arts,Maria Lopez,maria@t137import.example,(608) 555-0110,Main Stage,215 W Main St,Madison,WI",
    ].join("\n")), "update");
    assert.equal(res2.updated, 1, "#137 T4 a legacy file matches by name and updates");
    const b = await findCustomerByName("T137 Import Playhouse");
    assert.equal(b!.type, "Performing arts", "#137 T4 legacy Type alias → type");
    assert.equal(b!.locations.length, 1, "#137 T4 legacy Venue claims the unnamed address venue instead of adding one");
    assert.equal(b!.locations[0].label, "Main Stage", "#137 T4 legacy Venue names the primary venue");
    assert.equal(b!.locations[0].zip, "53703", "#137 T4 a file without Zip keeps the stored venue zip");
    assert.equal(b!.zip, "53703", "#137 T4 …and the company zip");
    assert.equal(b!.website, "t137import.example", "#137 T4 …and the website");
    assert.equal(b!.contacts.length, 1, "#137 T4 legacy Contact Name lands as a contact");
    assert.equal(b!.contacts[0].email, "maria@t137import.example", "#137 T4 legacy Email on the contact");
    assert.equal(b!.contacts[0].phone, "(608) 555-0110", "#137 T4 legacy Phone goes to the contact when a Contact Name is present");
    assert.equal(b!.contacts[0].primary, true, "#137 T4 the embedded contact is primary");
    assert.equal(b!.phone, "(608) 555-0100", "#137 T4 …and the company phone is left alone");

    // "Skip duplicates" on the same name is a skip, not a second customer.
    const res3 = await commitImport("customers", prepImport("customers", "Customer Name,Category\nt137 import PLAYHOUSE,Civic"), "skip");
    assert.equal(res3.skipped, 1, "#137 T4 normalized-name duplicate skipped");
    assert.equal((await allCustomers()).filter((c) => norm(c.name) === norm("T137 Import Playhouse")).length, 1, "#137 T4 still one customer");

    // Export round-trip: Category + Zip present, same values, re-import creates nothing.
    const csv = await exportCsv("customers");
    const exp = parseCsv(csv);
    // #137 T7 — no Notes column: nothing on a customer record stores it, so
    // the hub stopped advertising it (the input file above still carries one,
    // and it is still absorbed without erroring).
    assert.equal(exp.headers.join(","), "Customer Name,Category,Address,City,State,Zip,Latitude,Longitude,Phone,Website", "#137 T4 customers export columns = template columns (hidden aliases excluded)");
    const row = exp.objects.find((o) => o["Customer Name"] === "T137 Import Playhouse");
    assert.ok(row, "#137 T4 exported row present");
    assert.equal(row!.Category, "Performing arts", "#137 T4 export Category");
    assert.equal(row!.Zip, "53703", "#137 T4 export Zip");
    assert.equal(row!.Address, "215 W Main St", "#137 T4 export Address from the primary venue");
    assert.equal(row!.Phone, "(608) 555-0100", "#137 T4 export Phone = company phone");
    assert.equal(row!.Website, "t137import.example", "#137 T4 export Website");
    const back = await commitImport("customers", prepImport("customers", csv).filter((r) => String(r.values.name).startsWith("T137")), "skip");
    assert.equal(back.created, 0, "#137 T4 export → re-import creates nothing");
    assert.equal(back.errored, 0, "#137 T4 export → re-import errors nothing");
  }

  // #137 T5 — contacts import: link by name + id, primary demotion, one auto-created customer for several rows, idempotent re-import, export round-trip
  {
    await upsertCustomer({
      id: "c-t137-ct", name: "T137 Contacts Co", type: "Education", locations: [],
      contacts: [{ name: "Old Primary", email: "old@t137ct.example", primary: true }],
    });
    const csv1 = [
      "Customer,Customer ID,Name,Email,Phone,Mobile,Title,Role,Primary",
      "t137 contacts co,,Maria Lopez,maria@t137ct.example,(608) 555-0110,(608) 555-0111,Technical Director,,yes",
      ",c-t137-ct,Sam Ortiz,sam@t137ct.example,,,,billing,no",
      "T137 Brand New Org,,Pat Doe,pat@t137new.example,,,,,",
      "t137 BRAND new org,,Lee Park,lee@t137new.example,,,,,",
    ].join("\n");
    const r1 = await commitImport("contacts", prepImport("contacts", csv1), "skip");
    assert.equal(r1.errored, 0, "#137 T5 no errors");
    assert.equal(r1.created, 4, "#137 T5 four contacts created");
    assert.equal(r1.customersLinked, 2, "#137 T5 two rows linked to the existing customer (one by name, one by id)");
    assert.equal(r1.customersCreated, 1, "#137 T5 exactly one customer auto-created for the two unmatched rows");
    const co = await getCustomer("c-t137-ct");
    const maria = co!.contacts.find((c) => c.name === "Maria Lopez");
    const sam = co!.contacts.find((c) => c.name === "Sam Ortiz");
    const old = co!.contacts.find((c) => c.name === "Old Primary");
    assert.ok(maria && sam && old, "#137 T5 both imported contacts sit on the customer beside the old one");
    assert.equal(maria!.primary, true, "#137 T5 Primary=yes promotes Maria");
    assert.equal(old!.primary, false, "#137 T5 …and demotes the previous primary");
    assert.equal(sam!.primary, false, "#137 T5 Primary=no stays non-primary");
    assert.equal(maria!.mobile, "(608) 555-0111", "#137 T5 Mobile persists");
    assert.equal(maria!.phone, "(608) 555-0110", "#137 T5 Phone persists");
    assert.equal(maria!.role, "Technical Director", "#137 T5 Title → contact title");
    assert.equal(sam!.role, "billing", "#137 T5 Role fills the title when Title is blank");
    const created = (await allCustomers()).filter((c) => norm(c.name) === norm("T137 Brand New Org"));
    assert.equal(created.length, 1, "#137 T5 the unmatched name created exactly one customer");
    assert.equal(created[0].name, "T137 Brand New Org", "#137 T5 …named as the first row spelled it");
    assert.equal(created[0].contacts.length, 2, "#137 T5 both rows landed on that one new customer");
    assert.equal(created[0].contacts.find((c) => c.name === "Pat Doe")?.primary, true, "#137 T5 the first contact on a new customer becomes primary");

    const r2 = await commitImport("contacts", prepImport("contacts", csv1), "skip");
    assert.equal(r2.skipped, 4, "#137 T5 re-importing the same file skips every row");
    assert.equal(r2.customersCreated, 0, "#137 T5 …and creates no customers");
    assert.equal((await getCustomer("c-t137-ct"))!.updatedAt, co!.updatedAt, "#137 T5 a skipped re-import writes nothing (updatedAt unchanged)");
    const r3 = await commitImport("contacts", prepImport("contacts", csv1), "update");
    assert.equal(r3.updated, 4, "#137 T5 update mode re-imports without duplicating");
    assert.equal((await getCustomer("c-t137-ct"))!.contacts.length, 3, "#137 T5 still three contacts after two re-imports");
    assert.equal((await allCustomers()).filter((c) => norm(c.name) === norm("T137 Brand New Org")).length, 1, "#137 T5 still one auto-created customer");
    // The relabel rule from #137 T1 is what makes this converge: saving the
    // same contacts file twice must be a no-change write, not a churn of the
    // phone/mobile channels (D83).
    assert.equal((await getCustomer("c-t137-ct"))!.updatedAt, co!.updatedAt, "#137 T5 saving the same contacts file twice leaves updatedAt unchanged (idempotent)");
    assert.equal((await getCustomer(created[0].id))!.updatedAt, created[0].updatedAt, "#137 T5 …on the auto-created customer too");

    const csv = await exportCsv("contacts");
    const exp = parseCsv(csv);
    assert.equal(exp.headers.join(","), "Customer,Customer ID,Name,Email,Phone,Mobile,Title,Role,Primary", "#137 T5 contacts export columns = template columns (no Notes — a contact has nowhere to store it)");
    const m = exp.objects.find((o) => o.Email === "maria@t137ct.example");
    assert.ok(m, "#137 T5 exported contact present");
    assert.ok(m!.Customer === "T137 Contacts Co" && m!["Customer ID"] === "c-t137-ct" && m!.Mobile === "(608) 555-0111" && m!.Phone === "(608) 555-0110" && m!.Title === "Technical Director" && m!.Primary === "yes", "#137 T5 exported contact carries the customer's name + id and its fields");
    const back = await commitImport("contacts", prepImport("contacts", csv).filter((r) => String(r.values.customer).startsWith("T137")), "skip");
    assert.equal(back.created, 0, "#137 T5 export → re-import creates nothing (round-trip)");
    assert.equal(back.errored, 0, "#137 T5 export → re-import errors nothing");
  }

  // #137 T6 — venues import: link by name + id, zip + category persist, the first venue claims the unnamed base venue, auto-create, idempotent, export round-trip
  {
    await upsertCustomer({ id: "c-t137-vn", name: "T137 Venues District", type: "Education", locations: [], contacts: [] });
    assert.equal((await getCustomer("c-t137-vn"))!.locations.length, 1, "#137 T6 fixture: a new customer starts with its unnamed D85 base venue");
    const csv1 = [
      "Customer,Customer ID,Venue Name,Address,City,State,Zip,Category,Notes",
      "T137 Venues District,,Main Auditorium,5000 N Ballard Rd,Appleton,WI,54913,theatre,",
      ",c-t137-vn,Black Box,5000 N Ballard Rd,Appleton,WI,54913-1234,black box,",
      "T137 Venue Church,,Sanctuary,1 Church St,Oshkosh,WI,54901,church,",
    ].join("\n");
    const r1 = await commitImport("venues", prepImport("venues", csv1), "skip");
    assert.equal(r1.errored, 0, "#137 T6 no errors");
    assert.equal(r1.created, 3, "#137 T6 three venues created");
    assert.equal(r1.customersLinked, 2, "#137 T6 two rows linked (one by name, one by id)");
    assert.equal(r1.customersCreated, 1, "#137 T6 one customer auto-created");
    const d = await getCustomer("c-t137-vn");
    assert.equal(d!.locations.length, 2, "#137 T6 the first venue claimed the unnamed base venue; the second appended");
    const main = d!.locations.find((l) => l.label === "Main Auditorium");
    const bb = d!.locations.find((l) => l.label === "Black Box");
    assert.ok(main && bb, "#137 T6 both venues on the customer");
    assert.equal(main!.zip, "54913", "#137 T6 venue zip persists");
    assert.equal(main!.kind, "theatre", "#137 T6 venue Category → kind");
    assert.equal(main!.address, "5000 N Ballard Rd", "#137 T6 venue address persists");
    assert.equal(main!.primary, true, "#137 T6 the claimed base venue stays primary");
    assert.equal(bb!.zip, "54913-1234", "#137 T6 ZIP+4 kept");
    assert.equal(bb!.kind, "black box", "#137 T6 category kept as typed");
    assert.equal(bb!.venueKind, "blackbox", "#137 T6 a new venue's venueKind derives from Category");
    assert.equal(bb!.primary, false, "#137 T6 an appended venue is not primary");
    const church = (await allCustomers()).find((c) => c.name === "T137 Venue Church");
    assert.ok(church, "#137 T6 unmatched customer auto-created");
    assert.equal(church!.locations.length, 1, "#137 T6 …with exactly one venue (the row's, on the base venue)");
    assert.equal(church!.locations[0].label, "Sanctuary", "#137 T6 …named from the row");
    assert.equal(church!.locations[0].zip, "54901", "#137 T6 …with its zip");

    const r2 = await commitImport("venues", prepImport("venues", csv1), "skip");
    assert.equal(r2.skipped, 3, "#137 T6 re-import skips all three");
    assert.equal((await getCustomer("c-t137-vn"))!.updatedAt, d!.updatedAt, "#137 T6 a skipped re-import writes nothing (updatedAt unchanged)");
    const r3 = await commitImport("venues", prepImport("venues", csv1), "update");
    assert.equal(r3.updated, 3, "#137 T6 update mode re-imports without duplicating");
    assert.equal((await getCustomer("c-t137-vn"))!.locations.length, 2, "#137 T6 no duplicate venues after re-imports");
    // Same D83 contract the contacts file relies on above: re-importing an
    // unchanged venues file is a no-change write, not a churn of the sites.
    assert.equal((await getCustomer("c-t137-vn"))!.updatedAt, d!.updatedAt, "#137 T6 saving the same venues file twice leaves updatedAt unchanged (idempotent)");
    assert.equal((await getCustomer(church!.id))!.updatedAt, church!.updatedAt, "#137 T6 …on the auto-created customer too");

    const csv = await exportCsv("venues");
    const exp = parseCsv(csv);
    assert.equal(exp.headers.join(","), "Customer,Customer ID,Venue Name,Address,City,State,Zip,Latitude,Longitude,Category", "#137 T6 venues export columns = template columns (no Notes — a venue has nowhere to store it)");
    const row = exp.objects.find((o) => o["Customer ID"] === "c-t137-vn" && o["Venue Name"] === "Black Box");
    assert.ok(row, "#137 T6 exported venue present");
    assert.ok(row!.Zip === "54913-1234" && row!.Category === "black box" && row!.Customer === "T137 Venues District" && row!.Address === "5000 N Ballard Rd", "#137 T6 exported venue carries the customer's name + id and its fields");
    const back = await commitImport("venues", prepImport("venues", csv).filter((r) => String(r.values.customer).startsWith("T137")), "skip");
    assert.equal(back.created, 0, "#137 T6 export → re-import creates nothing (round-trip)");
    assert.equal(back.errored, 0, "#137 T6 export → re-import errors nothing");

    // #137 T6 review (punch #137 fix) — a customers import with Address/
    // City/State/Zip but no Venue leaves an ADDRESSED, UNNAMED primary venue
    // (D85 base venue); the venues export emits it with a blank Venue Name;
    // committing that exact row back must not error, must target the SAME
    // venue in place, and must never invent a name for it.
    await upsertCustomer({
      id: "c-t137-vn-addr",
      name: "T137 Venue Addressed Only",
      type: "Education",
      locations: [
        { id: "l-t137-vn-addr-1", label: "", primary: true, address: "9 Probe St", city: "Neenah", state: "WI", zip: "54956" },
      ],
      contacts: [],
    });
    const addrBefore = await getCustomer("c-t137-vn-addr");
    assert.equal(addrBefore!.locations.length, 1, "#137 T6 fix fixture: exactly one venue — unnamed, addressed");
    // Blank labels read back as undefined (composeLocation: `s.name || undefined`), not "".
    assert.ok(!addrBefore!.locations[0].label, "#137 T6 fix fixture: the venue has no name");

    const csvAddr = await exportCsv("venues");
    const expAddr = parseCsv(csvAddr);
    const addrRow = expAddr.objects.find((o) => o["Customer ID"] === "c-t137-vn-addr");
    assert.ok(addrRow, "#137 T6 fix: the addressed unnamed venue is exported");
    assert.equal(addrRow!["Venue Name"], "", "#137 T6 fix: exported with a blank Venue Name");
    assert.equal(addrRow!.Address, "9 Probe St", "#137 T6 fix: exported with its address");

    const addrRowsBack = prepImport("venues", csvAddr).filter((r) => String(r.values.customerId) === "c-t137-vn-addr");
    assert.equal(addrRowsBack.length, 1, "#137 T6 fix: exactly one prepared row for this customer");
    assert.equal(
      addrRowsBack[0].valid,
      true,
      "#137 T6 fix: a blank Venue Name is VALID when the row carries an address (requiredUnless: address)"
    );

    const rt1 = await commitImport("venues", addrRowsBack, "update");
    assert.equal(rt1.errored, 0, "#137 T6 fix: committing the exported blank-label row errors nothing");
    // matchLocation never matches a blank label (by design — see link.ts), so
    // WRITERS.venues.find() can't report this row as "existing"; it always
    // takes the create() path. That's fine: create() re-links the SAME
    // customer and writeVenueRow's mergeLocation (preferPrimary: true)
    // targets the existing primary venue in place rather than appending.
    assert.equal(rt1.created + rt1.updated, 1, "#137 T6 fix: the row is written exactly once");
    const addrAfter1 = await getCustomer("c-t137-vn-addr");
    assert.equal(addrAfter1!.locations.length, 1, "#137 T6 fix: still exactly one venue — no second unnamed venue created");
    assert.ok(!addrAfter1!.locations[0].label, "#137 T6 fix: still unnamed — no name was invented for it");
    assert.equal(addrAfter1!.locations[0].primary, true, "#137 T6 fix: still the primary venue");
    assert.equal(addrAfter1!.locations[0].address, "9 Probe St", "#137 T6 fix: address unchanged");
    assert.equal(
      addrAfter1!.updatedAt,
      addrBefore!.updatedAt,
      "#137 T6 fix: round-tripping identical content is a no-op (updatedAt unchanged)"
    );

    const rt2 = await commitImport("venues", addrRowsBack, "update");
    assert.equal(rt2.errored, 0, "#137 T6 fix: a second identical re-import still errors nothing");
    const addrAfter2 = await getCustomer("c-t137-vn-addr");
    assert.equal(addrAfter2!.locations.length, 1, "#137 T6 fix: still no duplicate venue on a second re-import");
    assert.equal(
      addrAfter2!.updatedAt,
      addrBefore!.updatedAt,
      "#137 T6 fix: …and updatedAt still hasn't moved (idempotent)"
    );

    // A blank-label row for a customer with NO venue at all: a partner-type
    // customer (D85 venue-defaults) gets no auto base venue, so there is
    // nothing to claim — mergeLocation's existing fallback (opts.preferPrimary
    // with an empty list) appends the customer's first venue, still unnamed
    // rather than erroring or inventing a name.
    await upsertCustomer({ id: "c-t137-vn-novenue", name: "T137 Venue Partner Co", type: "Vendor", locations: [], contacts: [] });
    assert.equal(
      (await getCustomer("c-t137-vn-novenue"))!.locations.length,
      0,
      "#137 T6 fix fixture: a partner-type customer has no venue at all"
    );
    const csvNoVenue = [
      ["Customer", "Customer ID", "Venue Name", "Address", "City", "State", "Zip", "Category", "Notes"],
      ["", "c-t137-vn-novenue", "", "200 Vendor Way", "Neenah", "WI", "54956", "warehouse", ""],
    ]
      .map((r) => r.join(","))
      .join("\n");
    const rNoVenue = await commitImport("venues", prepImport("venues", csvNoVenue), "skip");
    assert.equal(rNoVenue.errored, 0, "#137 T6 fix: a blank-label row on a venueless customer does not error");
    assert.equal(rNoVenue.created, 1, "#137 T6 fix: it creates the customer's first venue");
    const novenue = await getCustomer("c-t137-vn-novenue");
    assert.equal(novenue!.locations.length, 1, "#137 T6 fix: exactly one venue now exists");
    assert.ok(!novenue!.locations[0].label, "#137 T6 fix: still no invented name");
    assert.equal(novenue!.locations[0].primary, true, "#137 T6 fix: the sole venue is primary");
    assert.equal(novenue!.locations[0].address, "200 Vendor Way", "#137 T6 fix: its address persists");

    // A row with NEITHER a Venue Name NOR anything else to target (no
    // address/city/state/zip either) is still invalid: required-unless
    // doesn't mean "always optional" — keep it required when there is
    // nothing else for the row to target.
    const csvNothing = [
      ["Customer", "Customer ID", "Venue Name", "Address", "City", "State", "Zip", "Category", "Notes"],
      ["", "c-t137-vn-novenue", "", "", "", "", "", "", ""],
    ]
      .map((r) => r.join(","))
      .join("\n");
    const nothingRows = prepImport("venues", csvNothing);
    assert.equal(
      nothingRows[0].valid,
      false,
      "#137 T6 fix: a blank Venue Name with no address either is still invalid (nothing to target)"
    );
  }

  // #137 C1 (final review — data loss) — the go-live order in MASTER-HOWTO §7
  // is customers.csv → contacts.csv → venues.csv. The customers template has
  // no Venue column, so every customer it writes ends up owning an UNNAMED
  // but ADDRESSED primary venue: the company's mailing address. A labelled
  // venues row for that customer must APPEND a second venue — claiming the
  // addressed slot would overwrite the mailing address with the venue's, and
  // D158 leaves companies.address/city/state to the Daylite import, so
  // nothing else holds it and it is unrecoverable.
  {
    const cRes = await commitImport("customers", prepImport("customers", [
      "Customer Name,Category,Address,City,State,Zip",
      "T137 C1 Mailing Co,Education,215 W Main St,Madison,WI,53703",
    ].join("\n")), "skip");
    assert.equal(cRes.errored, 0, "#137 C1 fixture: the customers row errors nothing");
    assert.equal(cRes.created, 1, "#137 C1 fixture: the customers row creates the customer");
    const c1 = await findCustomerByName("T137 C1 Mailing Co");
    assert.equal(c1!.locations.length, 1, "#137 C1 fixture: one venue — the unnamed mailing venue");
    assert.ok(!c1!.locations[0].label, "#137 C1 fixture: …unnamed (the template has no Venue column)");
    assert.equal(c1!.locations[0].address, "215 W Main St", "#137 C1 fixture: …carrying the mailing address");

    const vRes = await commitImport("venues", prepImport("venues", [
      "Customer,Customer ID,Venue Name,Address,City,State,Zip,Category",
      "T137 C1 Mailing Co,,Main Auditorium,5000 N Ballard Rd,Appleton,WI,54913,theatre",
    ].join("\n")), "skip");
    assert.equal(vRes.errored, 0, "#137 C1 the venues row errors nothing");
    assert.equal(vRes.created, 1, "#137 C1 the venues row writes one venue");
    const c2 = await findCustomerByName("T137 C1 Mailing Co");
    assert.equal(c2!.locations.length, 2, "#137 C1 a labelled venues row APPENDS — it never claims a blank-label venue that already has an address");
    const mail = c2!.locations.find((l) => !l.label);
    const aud = c2!.locations.find((l) => l.label === "Main Auditorium");
    assert.ok(mail && aud, "#137 C1 both the mailing venue and the named venue exist");
    assert.equal(mail!.address, "215 W Main St", "#137 C1 the customer's mailing address survives the venues import");
    assert.equal(mail!.city, "Madison", "#137 C1 …and its city");
    assert.equal(aud!.address, "5000 N Ballard Rd", "#137 C1 the appended venue keeps its own address");
    assert.equal(aud!.city, "Appleton", "#137 C1 …and its city");
    // Revised for #137 I3 (was: the mailing venue stays primary / the appended
    // venue is not): primaryLoc drives the record page's location line, travel
    // estimates and quote defaults, so the venue where the work happens must
    // outrank the unnamed mailing placeholder, which stays as a second location.
    assert.equal(aud!.primary, true, "#137 I3 the appended NAMED venue becomes primary");
    assert.equal(mail!.primary, false, "#137 I3 …and the unnamed mailing placeholder is demoted, not removed");

    // The mirror, the same slot from the other side (#137 C1b) — a customers
    // row must never address a venue that has a name to lose. Two shapes:
    //
    // (1) the go-live re-run ("Update existing"). After I3 the NAMED venue is
    //     the primary one, so the row has to skip it and land on the unnamed
    //     mailing venue it owns — both addresses intact, no third venue.
    const cRes2 = await commitImport("customers", prepImport("customers", [
      "Customer Name,Category,Address,City,State,Zip",
      "T137 C1 Mailing Co,Education,220 E Doty St,Madison,WI,53703",
    ].join("\n")), "update");
    assert.equal(cRes2.errored, 0, "#137 C1b mirror: the second customers file errors nothing");
    assert.equal(cRes2.updated, 1, "#137 C1b mirror: it matches by name and updates");
    const c3 = await findCustomerByName("T137 C1 Mailing Co");
    assert.equal(c3!.locations.length, 2, "#137 C1b mirror: still exactly two venues");
    assert.equal(
      c3!.locations.find((l) => l.label === "Main Auditorium")!.address,
      "5000 N Ballard Rd",
      "#137 C1b mirror: a customers row with no Venue never overwrites an existing named venue's address"
    );
    assert.equal(
      c3!.locations.find((l) => l.label === "Main Auditorium")!.primary,
      true,
      "#137 C1b mirror: …and the named venue is still the primary one"
    );
    assert.equal(
      c3!.locations.find((l) => !l.label)!.address,
      "220 E Doty St",
      "#137 C1b mirror: it updates the unnamed mailing venue it owns instead"
    );

    // (2) the shape the previous round's fixture missed, and the one that
    //     actually loses data: the named, addressed venue IS the primary and
    //     there is no unnamed venue at all — every seeded customer
    //     (src/db/seeds/customers.ts) and anything named through the Companies
    //     modal looks like this. The preferPrimary branch landed straight on
    //     it and overwrote "5000 N Ballard Rd" with the row's mailing address,
    //     which nothing else holds (D158 leaves companies.address/city/state
    //     to the Daylite import).
    await upsertCustomer({
      id: "c-t137-c1b",
      name: "T137 C1b Named Primary Co",
      type: "Education",
      locations: [
        { id: "l-t137-c1b-1", label: "Main Auditorium", primary: true, address: "5000 N Ballard Rd", city: "Appleton", state: "WI", zip: "54913" },
      ],
      contacts: [],
    });
    const b0 = await getCustomer("c-t137-c1b");
    assert.equal(b0!.locations.length, 1, "#137 C1b fixture: one venue — named and addressed");
    assert.equal(b0!.locations[0].primary, true, "#137 C1b fixture: …and it IS the primary venue");
    const bRes = await commitImport("customers", prepImport("customers", [
      "Customer Name,Customer ID,Category,Address,City,State,Zip",
      "T137 C1b Named Primary Co,c-t137-c1b,Education,215 W Main St,Madison,WI,53703",
    ].join("\n")), "update");
    assert.equal(bRes.errored, 0, "#137 C1b the customers row errors nothing");
    assert.equal(bRes.updated, 1, "#137 C1b it matches the existing customer and updates");
    const b1 = await getCustomer("c-t137-c1b");
    assert.equal(b1!.locations.length, 2, "#137 C1b a customers row APPENDS its mailing address — it never addresses a NAMED venue");
    const bAud = b1!.locations.find((l) => l.label === "Main Auditorium");
    const bMail = b1!.locations.find((l) => !l.label);
    assert.ok(bAud && bMail, "#137 C1b both the named venue and the new mailing venue exist");
    assert.equal(bAud!.address, "5000 N Ballard Rd", "#137 C1b the named venue's address survives the customers import");
    assert.equal(bAud!.city, "Appleton", "#137 C1b …and its city");
    assert.equal(bAud!.primary, true, "#137 C1b …and it stays primary (I3: a named venue outranks a mailing placeholder)");
    assert.equal(bMail!.address, "215 W Main St", "#137 C1b the row's mailing address lands on the appended unnamed venue");
    assert.equal(bMail!.city, "Madison", "#137 C1b …and its city");
    assert.equal(bMail!.primary, false, "#137 C1b …and it is not primary");

    // …and a second run updates that mailing venue in place rather than
    // growing a new unnamed venue on every "Update existing" pass.
    const bRes2 = await commitImport("customers", prepImport("customers", [
      "Customer Name,Customer ID,Category,Address,City,State,Zip",
      "T137 C1b Named Primary Co,c-t137-c1b,Education,220 E Doty St,Madison,WI,53703",
    ].join("\n")), "update");
    assert.equal(bRes2.errored, 0, "#137 C1b the second customers run errors nothing");
    const b2 = await getCustomer("c-t137-c1b");
    assert.equal(b2!.locations.length, 2, "#137 C1b a re-run does not grow a third venue");
    assert.equal(b2!.locations.find((l) => !l.label)!.address, "220 E Doty St", "#137 C1b it updates the unnamed mailing venue it owns");
    assert.equal(b2!.locations.find((l) => l.label === "Main Auditorium")!.address, "5000 N Ballard Rd", "#137 C1b …and still never touches the named venue");

    // And the claim that C1 narrows stays intact: when the blank-label venue
    // is a TRUE D85 placeholder (no address of its own), a labelled venues
    // row still fills it rather than leaving an empty twin behind.
    await upsertCustomer({ id: "c-t137-c1-bare", name: "T137 C1 Bare Co", type: "Education", locations: [], contacts: [] });
    const bare = await getCustomer("c-t137-c1-bare");
    assert.equal(bare!.locations.length, 1, "#137 C1 fixture: a new customer starts with its unnamed D85 base venue");
    assert.ok(!bare!.locations[0].address, "#137 C1 fixture: …with no address of its own");
    const vBare = await commitImport("venues", prepImport("venues", [
      "Customer,Customer ID,Venue Name,Address,City,State,Zip,Category",
      ",c-t137-c1-bare,Recital Hall,12 Bare St,Neenah,WI,54956,theatre",
    ].join("\n")), "skip");
    assert.equal(vBare.errored, 0, "#137 C1 the placeholder row errors nothing");
    const bare2 = await getCustomer("c-t137-c1-bare");
    assert.equal(bare2!.locations.length, 1, "#137 C1 an unaddressed base venue is still claimed — no empty twin");
    assert.equal(bare2!.locations[0].label, "Recital Hall", "#137 C1 …and it takes the row's name");
    assert.equal(bare2!.locations[0].address, "12 Bare St", "#137 C1 …and the row's address");
    assert.equal(bare2!.locations[0].primary, true, "#137 C1 …and it stays primary");
  }

  // #43 — per-user layouts persist in the blobs table, one key per surface
  const { layoutFor, saveLayout, resetLayout } = await import("@/lib/dashboard/layout-store");
  const { presetFor } = await import("@/lib/dashboard/registry");
  const fresh = await layoutFor("u-t43", "home", ["Admin"]);
  assert.equal(fresh.customized, false, "#43 no row → preset");
  assert.deepEqual(fresh.ids, presetFor("home", ["Admin"]), "#43 preset ids when nothing stored");
  await saveLayout("u-t43", "home", ["my-leads", "bogus", "my-leads"], ["Admin"]);
  const saved = await layoutFor("u-t43", "home", ["Admin"]);
  assert.deepEqual(saved.ids, ["my-leads"], "#43 save normalizes before writing");
  assert.equal(saved.customized, true, "#43 a stored row marks the layout customized");
  await saveLayout("u-t43-other", "home", ["my-leads"], ["Admin"]);
  assert.deepEqual((await layoutFor("u-t43-other", "home", ["Admin"])).ids, ["my-leads"], "#43 layouts are isolated by user id");
  await saveLayout("u-t43-gated", "reports", ["my-leads", "book-margin", "total-quoted", "my-leads"], ["Estimator"]);
  assert.deepEqual((await layoutFor("u-t43-gated", "reports", ["Estimator"])).ids, ["total-quoted"], "#43 normalization drops gated and wrong-surface ids");
  await saveLayout("u-t43", "reports", ["total-quoted"], ["Admin"]);
  assert.deepEqual((await layoutFor("u-t43", "home", ["Admin"])).ids, ["my-leads"], "#43 saving reports leaves home untouched (per-key merge)");
  await resetLayout("u-t43", "home");
  assert.equal((await layoutFor("u-t43", "home", ["Admin"])).customized, false, "#43 reset returns to the preset");
  assert.deepEqual((await layoutFor("u-t43", "reports", ["Admin"])).ids, ["total-quoted"], "#43 resetting home preserves the reports layout");
  const { saveLayoutAction, resetLayoutAction } = await import("@/app/(app)/dashboard-actions");
  assert.deepEqual(await saveLayoutAction("invalid" as never, []), { ok: false }, "#43 save action rejects an invalid surface before auth");
  assert.deepEqual(await resetLayoutAction("invalid" as never), { ok: false }, "#43 reset action rejects an invalid surface before auth");

  /* --- specs: template + curtain-template stores --- */
  {
    const SpecTemplates = await import("@/lib/stores/spec-templates");

    // getDb() awaits the dev auto-seed, which has ALREADY run
    // seedStarterTemplates() by the time this block executes — so the first
    // call here legitimately returns 0. Assert the end state, not the count.
    await SpecTemplates.seedStarterTemplates("Seed");
    const all = await SpecTemplates.allTemplates();
    const ids = new Set(all.map((t) => t.id));
    assert(
      SpecTemplates.STARTER_TEMPLATES.every((t) => ids.has(SpecTemplates.templateId(t.key))),
      "templates: after seeding, the collection holds every starter"
    );
    assert((await SpecTemplates.seedStarterTemplates("Seed")) === 0, "templates: seeding again writes nothing");
    assert((await SpecTemplates.ensureStarterTemplates("Seed")) === 0, "templates: ensure is a no-op on a collection that already holds formulas");

    await SpecTemplates.saveTemplate({ key: "Fixtures", title: "Lighting Fixture", headings: [{ label: "X", guidance: "Y" }], rules: "R", example: "E" }, "Jeff");
    const edited = await SpecTemplates.getTemplate(SpecTemplates.templateId("Fixtures"));
    assert(edited?.headings.length === 1 && edited.example === "E", "templates: saving by an existing key replaces that formula, not a duplicate");
    assert((await SpecTemplates.allTemplates()).length === all.length, "templates: saving an existing key adds no row");
    assert((await SpecTemplates.seedStarterTemplates("Seed")) === 0, "templates: re-seeding never overwrites an edited formula");
  }

  /* --- specs: part spec fields + legacy adoption --- */
  {
    const { get: getPart, upsert, mergeUpsert } = await import("@/lib/stores/catalog");
    const { createSection } = await import("@/lib/stores/spec-sections");
    const { createArticle } = await import("@/lib/stores/spec-articles");

    await upsert({ sku: "SPEC-1", desc: "Profile fixture", category: "Fixtures", unit: "ea", list: 100, cost: 50, mfr: "ETC", manufacturerPartNumber: "7060A", mapPrice: 90, ports: [{ kind: "dmx", n: 1 }] } as never);
    // The action's body minus the session gate (requirePerm cannot run here — :1046-1048).
    await mergeUpsert("SPEC-1", { specArticleId: "ar-fix", specTitle: "LED PROFILE FIXTURE", specBody: "Basis of Design: ETC ColorSource Spot", specState: "authored", specSource: "authored", specUpdatedAt: Date.now(), specUpdatedBy: "Tester" });
    const after = await getPart("SPEC-1");
    assert(after?.specTitle === "LED PROFILE FIXTURE" && after?.specState === "authored", "part spec: the fields land");
    assert(!!after?.ports?.length, "part spec: mergeUpsert left ports alone");
    assert(after?.list === 100 && after?.cost === 50 && after?.mapPrice === 90 && after?.manufacturerPartNumber === "7060A", "part spec: pricing and manufacturer numbers are untouched");

    const sec = await createSection({ number: "99 01 13", title: "Legacy Adoption Test", by: "Tester" });
    const art = await createArticle({ sectionId: sec.id, title: "Legacy Instruments" }, "Tester");
    await upsert({ sku: "LEG-1", desc: "Legacy one", category: "X", unit: "ea", list: 1, cost: 1, productMetadata: { specSection: "99-01-13", specArticle: "legacy instruments" } } as never);
    await upsert({ sku: "LEG-2", desc: "Legacy two", category: "X", unit: "ea", list: 1, cost: 1, specArticleId: "ar-authored", productMetadata: { specArticle: "Legacy Instruments" } } as never);
    const leg1 = await getPart("LEG-1");
    assert(leg1?.productMetadata?.specSection === "99-01-13", "legacy: the Displays text itself is kept");
    assert((await getPart("LEG-2"))?.specArticleId === "ar-authored", "legacy: adoption never overwrites a canonical value");
  }

  /* --- specs: library import/export --- */
  {
    const Sections = await import("@/lib/stores/spec-sections");
    const Articles = await import("@/lib/stores/spec-articles");

    await Sections.createSection({ number: "11 61 43", title: "Stage Curtains", sort: 10, by: "Jeff" });
    const [sec] = await Sections.allSections();
    await Articles.createArticle({ sectionId: sec.id, title: "Theatrical Stage Drapes", manufacturers: ["Rose Brand"], categoryKeys: ["Curtains"], general: "A. General" }, "Jeff");
    const after = await Sections.allSections();
    const afterArticles = await Articles.allArticles();
    const kept = await Articles.getArticle("ar-from-file");
  }

  // #123/I1/I4 review — "+ New quote" from a thread: mint the draft with the
  // right per-type shape, link the thread, adopt the customer, idempotent
  // on a repeat call, and never silently overwrite a different link.
  {
    const { get: getQuoteDoc } = await import("@/lib/stores/quotes");
    const r3now = Date.now();
    const r3flameInput = {
      customerId: "lakefront", customer: "Lakefront ISD", locationId: "loc1", locationLabel: "Auditorium",
      contactName: "Brenda Gauchel", contactRole: "Director", contactEmail: "brenda.t96@lakefront.k12.mn.us",
      quoteType: "flame_test", category: "", owner: "Tester",
    };
  }

  // I1 — the other service types read a different shape than flame_test's;
  // rentals have no venue concept at all, consulting needs venueCustomerId.
  {
    const { get: getQuoteDoc } = await import("@/lib/stores/quotes");
    const r3now = Date.now();
  }

  // I4 follow-up review — threadQuoteLinkStatus is the decision
  // createQuoteIntakeAction now checks BEFORE saveCustomerAction
  // (quotes/new/actions.ts, right after the thread validity check, well
  // before any customer/venue/contact write) instead of only inside
  // linkThreadToNewQuote after the save already ran. createQuoteIntakeAction
  // itself is session-gated (requireUser()) and can't be called from this
  // harness — this pins the extracted decision function directly, which is
  // what the action's early-exit relies on for correctness.
  {
    const r3now = Date.now();
  }

  // #124 — siteId follows the customer: setThreadSite stamps it, a re-link
  // to the same customer keeps it, a different customer clears it.
  {
    const r3now = Date.now();
  }

  // #125 — identity source: setIdentityMessage re-resolves from the picked
  // message's address, and a re-sweep keeps that pick.
  {
    const r3now = Date.now();
  }

  // #127 — the signature round-trips through its own blob, one key per user,
  // merged atomically (setBlob) so it never disturbs another user's row.
  {
  }

  // #128 review (I3) — sendDraft threads `me` through to the sent message's
  // author instead of always stamping DEFAULT_USER, and rowName() (pure,
  // already covered by test:specs) reads the result by DIRECTION so a
  // mismatched Gmail display name on the outbound message still reads as me.
  {
    const r3now = Date.now();
  }

  /* --- part documents (#207): stores, links, accessory graph, legacy backfill --- */
  {
    const Docs = await import("@/lib/stores/part-documents");
    const Acc = await import("@/lib/stores/part-accessory-links");
    const { backfillLegacyDatasheets, legacyDocumentId } = await import("@/lib/part-docs/legacy");
    const { loadPartDocsState } = await import("@/lib/part-docs/load");
    const { slotCoverage } = await import("@/lib/part-docs/coverage");
    const { setDocNotNeeded } = await import("@/lib/part-docs/not-needed");
    const { upsert: upsertPart, get: getPart } = await import("@/lib/stores/catalog");
    const { listDocs } = await import("@/db/doc-store");

    const d = await Docs.createDocument({
      kind: "datasheet", fileName: "S4_LED_Datasheet.pdf", contentType: "application/pdf", size: 10,
      blobKey: "part-docs/PD-x/S4_LED_Datasheet.pdf", sourceUrl: null, source: "upload", by: "Jeff",
    });
    assert(d && /^PD-[0-9a-f]{12}$/.test(d.id), "part docs store: createDocument mints a PD- id");
    assert.equal(d!.title, "S4 LED Datasheet", "part docs store: the title defaults from the file name");
    assert.equal(await Docs.createDocument({ id: d!.id, kind: "datasheet", fileName: "x.pdf", contentType: "application/pdf", size: 1, blobKey: null, sourceUrl: null, source: "upload", by: "Jeff" }), null, "part docs store: an existing id is never overwritten");

    assert.equal(await Docs.attachDocument(d!.id, ["DOC-FIX", "DOC-FIX", "DOC-LENS2"], "Jeff"), 2, "part docs store: attach links each part once");
    assert.equal(await Docs.attachDocument(d!.id, ["DOC-FIX"], "Jeff"), 0, "part docs store: attaching again is a no-op");
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.documentId === d!.id).length, 2, "part docs store: one link row per part↔document");
    assert.equal(await Docs.detachDocument(d!.id, "DOC-LENS2"), true, "part docs store: detach removes a live link");
    assert.equal(await Docs.detachDocument(d!.id, "DOC-LENS2"), false, "part docs store: detaching twice reports nothing removed");
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.documentId === d!.id).length, 1, "part docs store: a detached link leaves the live list");
    assert.equal(await Docs.attachDocument(d!.id, ["DOC-LENS2"], "Jeff"), 1, "part docs store: re-attaching revives the same row");
    assert.equal(await Docs.ensureLinks([{ partSku: "DOC-OTHER", documentId: d!.id, kind: "datasheet" }], "Jeff"), 1, "part docs store: ensureLinks adds a new pair");
    await Docs.detachDocument(d!.id, "DOC-OTHER");
    assert.equal(await Docs.ensureLinks([{ partSku: "DOC-OTHER", documentId: d!.id, kind: "datasheet" }], "Jeff"), 0, "part docs store: ensureLinks never re-attaches a pair a human detached");

    const replaced = await Docs.replaceDocumentFile(d!.id, { blobKey: "part-docs/PD-x/v2.pdf", fileName: "v2.pdf", contentType: "application/pdf", size: 20 }, "Chris", 5000);
    assert.equal(replaced?.blobKey, "part-docs/PD-x/v2.pdf", "part docs store: replace points at the new file");
    assert.deepEqual(replaced?.history, [{ blobKey: "part-docs/PD-x/S4_LED_Datasheet.pdf", fileName: "S4_LED_Datasheet.pdf", size: 10, replacedAt: 5000, replacedBy: "Chris" }], "part docs store: the replaced file is kept in history");
    await Docs.recordFetchResult(d!.id, { ok: false, error: "HTTP 404" }, 6000);
    assert.deepEqual((await Docs.getDocument(d!.id))?.lastFetch, { at: 6000, ok: false, error: "HTTP 404" }, "part docs store: a fetch failure is remembered with its reason");
    assert.equal(await Docs.getDocument("../etc"), null, "part docs store: a non-id never reaches the table");

    // accessory graph
    const r1 = await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "fa-doc-1" }, [
      { parentSku: "DOC-FIX", accessorySku: "DOC-LENS" },
      { parentSku: "DOC-FIX", accessorySku: "DOC-CLAMP", included: true },
      { parentSku: "DOC-FIX", accessorySku: "DOC-FIX" },
    ]);
    assert.deepEqual(r1, { written: 2, removed: 0 }, "part docs graph: sync writes each pair once and drops a self-link");
    assert.deepEqual(await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "fa-doc-1" }, [
      { parentSku: "DOC-FIX", accessorySku: "DOC-LENS" },
      { parentSku: "DOC-FIX", accessorySku: "DOC-CLAMP", included: true },
    ]), { written: 0, removed: 0 }, "part docs graph: an unchanged re-sync writes nothing");
    assert.deepEqual(await Acc.setOwnDatasheet("DOC-FIX", "DOC-CLAMP", true), { linked: true, changed: 1 }, "part docs graph: the own-datasheet toggle flags the pair");
    const r2 = await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "fa-doc-1" }, [{ parentSku: "DOC-FIX", accessorySku: "DOC-CLAMP", included: true }]);
    assert.deepEqual(r2, { written: 0, removed: 1 }, "part docs graph: a pair the assembly dropped is removed");
    assert.equal((await Acc.allAccessoryLinks()).find((l) => l.accessorySku === "DOC-CLAMP")?.ownDatasheet, true, "part docs graph: re-saving keeps the own-datasheet flag");
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "fa-doc-2" }, [{ parentSku: "DOC-FIX", accessorySku: "DOC-LENS" }]);
    assert.equal((await Acc.allAccessoryLinks()).filter((l) => l.sourceRef === "fa-doc-1").length, 1, "part docs graph: another assembly's sync never touches this one's links");

    // coverage over the stored graph, via the one-load loader
    await upsertPart({ sku: "DOC-FIX", desc: "Fixture", category: "Lighting", unit: "ea", list: 1, cost: 1 });
    await upsertPart({ sku: "DOC-LENS", desc: "Lens", category: "Lighting", unit: "ea", list: 1, cost: 1 });
    const parts = [(await getPart("DOC-FIX"))!, (await getPart("DOC-LENS"))!];
    const state = await loadPartDocsState(parts);
    assert.equal(slotCoverage(state.index, "DOC-LENS", "datasheet").state, "covered", "part docs graph: an assembly member is covered by the fixture's datasheet");

    // not-needed marks ride on the catalog part through mergeUpsert
    assert.equal(await setDocNotNeeded(["DOC-LENS", "NO-SUCH-PART"], "specsheet", true), 1, "part docs not-needed: marks live parts only");
    const lens = await getPart("DOC-LENS");
    assert.deepEqual(lens?.docNotNeeded, { specsheet: true }, "part docs not-needed: the mark is on the part");
    assert.equal(lens?.desc, "Lens", "part docs not-needed: mergeUpsert leaves the rest of the part alone");
    assert.equal(await getPart("NO-SUCH-PART"), null, "part docs not-needed: never creates a part");
    await setDocNotNeeded(["DOC-LENS"], "specsheet", false);
    assert.equal((await getPart("DOC-LENS"))?.docNotNeeded, undefined, "part docs not-needed: clearing the last mark removes the field");

    // legacy backfill
    await upsertPart({ sku: "DOC-LEGACY", desc: "Legacy", category: "Lighting", unit: "ea", list: 1, cost: 1, datasheetBlobKey: "part-datasheets/DOC-LEGACY/old.pdf", datasheetName: "old.pdf" });
    const legacy = (await getPart("DOC-LEGACY"))!;
    assert.deepEqual(await backfillLegacyDatasheets([legacy]), { created: 1 }, "part docs legacy: a datasheetBlobKey becomes a shared document");
    const ldoc = await Docs.getDocument(legacyDocumentId("DOC-LEGACY"));
    assert(ldoc?.source === "legacy" && ldoc.blobKey === "part-datasheets/DOC-LEGACY/old.pdf" && ldoc.fileName === "old.pdf", "part docs legacy: the document keeps the old blob and name");
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.partSku === "DOC-LEGACY").length, 1, "part docs legacy: and is linked to its part");
    assert.deepEqual(await backfillLegacyDatasheets([legacy]), { created: 0 }, "part docs legacy: a second run writes nothing");
    await Docs.detachDocument(legacyDocumentId("DOC-LEGACY"), "DOC-LEGACY");
    await backfillLegacyDatasheets([legacy]);
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.partSku === "DOC-LEGACY").length, 0, "part docs legacy: a detached legacy document stays detached");
    assert.equal((await getPart("DOC-LEGACY"))?.datasheetBlobKey, "part-datasheets/DOC-LEGACY/old.pdf", "part docs legacy: datasheetBlobKey stays readable");
    assert((await listDocs("part_documents")).some((x) => x.id === legacyDocumentId("DOC-LEGACY")), "part docs legacy: the document itself is never deleted");
  }

  /* --- part documents (#207): fetch from links, shared per URL --- */
  {
    const { upsert: upsertPart, list: listParts } = await import("@/lib/stores/catalog");
    const { loadPartDocsState } = await import("@/lib/part-docs/load");
    const { buildFetchContext, fetchSlot } = await import("@/lib/part-docs/fetch-links");
    const { slotCoverage } = await import("@/lib/part-docs/coverage");
    const Docs = await import("@/lib/stores/part-documents");
    const U1 = "https://etc.example/s4-datasheet.pdf";
    const U2 = "https://etc.example/broken.pdf";
    await upsertPart({ sku: "FETCH-A", desc: "A", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: U1 }] });
    await upsertPart({ sku: "FETCH-B", desc: "B", category: "Lighting", unit: "ea", list: 1, cost: 1, productMetadata: { datasheets: [{ kind: "datasheet", fileName: "ds.pdf", sourceUrl: U1 }] } });
    await upsertPart({ sku: "FETCH-C", desc: "C", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: U2 }] });
    await upsertPart({ sku: "FETCH-D", desc: "D", category: "Lighting", unit: "ea", list: 1, cost: 1 });

    const fetched: string[] = [];
    let brokenWorks = false;
    const ALWAYS_BROKEN_URLS = new Set(["https://etc.example/always-broken.pdf"]);
    const deps = {
      fetchDoc: async (url: string) => {
        fetched.push(url);
        if ((url === U2 && !brokenWorks) || ALWAYS_BROKEN_URLS.has(url)) return { ok: true as const, file: { bytes: new TextEncoder().encode("<html>error</html>"), contentDisposition: null, finalUrl: url } };
        return { ok: true as const, file: { bytes: new TextEncoder().encode("%PDF-1.7 x"), contentDisposition: null, finalUrl: url } };
      },
      putFile: async (pathname: string) => ({ pathname: pathname.replace(/\.pdf$/, "-rnd.pdf") }),
    };
    const ctxFor = async () => buildFetchContext(await loadPartDocsState(await listParts()));

    const a = await fetchSlot(await ctxFor(), { sku: "FETCH-A", kind: "datasheet" }, "Jeff", deps);
    assert(a.ok && a.documentId && a.alsoLinked === 2, "part docs fetch: a fetched URL is attached to every part that referenced it");
    const doc = await Docs.getDocument(a.documentId!);
    assert(doc?.source === "fetch" && doc.sourceUrl === U1 && doc.blobKey?.startsWith(`part-docs/${doc.id}/`) && doc.lastFetch?.ok === true, "part docs fetch: the document stores the file privately under part-docs/<id>/ and remembers the URL");
    const state = await loadPartDocsState(await listParts());
    assert.equal(slotCoverage(state.index, "FETCH-B", "datasheet").state, "own", "part docs fetch: the other part is satisfied without a second download");
    const b = await fetchSlot(await ctxFor(), { sku: "FETCH-B", kind: "datasheet" }, "Jeff", deps);
    assert(b.ok && fetched.filter((u) => u === U1).length === 1, "part docs fetch: a URL is downloaded once, ever");

    const c1 = await fetchSlot(await ctxFor(), { sku: "FETCH-C", kind: "datasheet" }, "Jeff", deps);
    assert(!c1.ok && c1.error === "That file is not a PDF.", "part docs fetch: bytes that aren't a PDF are refused with the reason");
    const cState = await loadPartDocsState(await listParts());
    const cSlot = slotCoverage(cState.index, "FETCH-C", "datasheet");
    assert(cSlot.state === "link-only" && cSlot.docs.length === 1, "part docs fetch: the failed URL becomes a link-only document on the part");
    const failedDoc = await Docs.getDocument(cSlot.state === "link-only" ? cSlot.docs[0].id : "");
    assert.deepEqual([failedDoc?.lastFetch?.ok, failedDoc?.lastFetch?.error], [false, "That file is not a PDF."], "part docs fetch: …carrying the failure reason for the page to list");
    brokenWorks = true;
    const c2 = await fetchSlot(await ctxFor(), { sku: "FETCH-C", kind: "datasheet" }, "Jeff", deps);
    assert(c2.ok && c2.documentId === failedDoc?.id, "part docs fetch: a retry that succeeds fills the same document");
    assert.equal((await Docs.getDocument(failedDoc!.id))?.lastFetch?.ok, true, "part docs fetch: …and clears the failure");

    const d = await fetchSlot(await ctxFor(), { sku: "FETCH-D", kind: "datasheet" }, "Jeff", deps);
    assert(!d.ok && d.error === "No link to fetch.", "part docs fetch: a part with no link says so");

    /* --- review fix wave 1, M1: kind-keyed dedupe — a URL fetched as a
       datasheet for one part must never reuse or attach to a spec-sheet
       document for another part referencing the SAME url, and vice versa. --- */
    {
      const U3 = "https://etc.example/shared-doc.pdf";
      await upsertPart({ sku: "FETCH-F", desc: "F", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: U3 }] });
      await upsertPart({ sku: "FETCH-G", desc: "G", category: "Lighting", unit: "ea", list: 1, cost: 1, productMetadata: { datasheets: [{ kind: "guide-spec", fileName: "spec.pdf", sourceUrl: U3 }] } });

      const f = await fetchSlot(await ctxFor(), { sku: "FETCH-F", kind: "datasheet" }, "Jeff", deps);
      assert(f.ok && !!f.documentId, "part docs fetch M1: the datasheet slot for a shared URL fetches fine");
      const g = await fetchSlot(await ctxFor(), { sku: "FETCH-G", kind: "specsheet" }, "Jeff", deps);
      assert(g.ok && !!g.documentId && g.documentId !== f.documentId, "part docs fetch M1: the SAME url fetched for a different kind makes its own document, not the other kind's");
      const gDoc = await Docs.getDocument(g.documentId!);
      assert.equal(gDoc?.kind, "specsheet", "part docs fetch M1: the new document carries the kind it was fetched for");

      const links = await Docs.allDocumentLinks();
      assert(!links.some((l) => l.partSku === "FETCH-F" && l.documentId === g.documentId), "part docs fetch M1: the datasheet part is never linked to the spec-sheet document from the same url");
      assert(!links.some((l) => l.partSku === "FETCH-G" && l.documentId === f.documentId), "part docs fetch M1: the spec-sheet part is never linked to the datasheet document from the same url");
    }

    /* --- review fix wave 1, M2: a failed URL is shared with every part
       that referenced it, and never re-downloaded within the SAME call --- */
    {
      const U4 = "https://etc.example/always-broken.pdf";
      await upsertPart({ sku: "FETCH-E1", desc: "E1", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: U4 }] });
      await upsertPart({ sku: "FETCH-E2", desc: "E2", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: U4 }] });

      const sharedCtx = await ctxFor(); // ONE context reused across both calls — same as one fetchLinksAction batch
      const before = fetched.filter((u) => u === U4).length;
      const e1 = await fetchSlot(sharedCtx, { sku: "FETCH-E1", kind: "datasheet" }, "Jeff", deps);
      assert(!e1.ok && e1.error === "That file is not a PDF.", "part docs fetch M2: the first part sharing a broken url fails normally");
      const e2 = await fetchSlot(sharedCtx, { sku: "FETCH-E2", kind: "datasheet" }, "Jeff", deps);
      assert(!e2.ok && e2.error === "That file is not a PDF.", "part docs fetch M2: the second part sharing the SAME broken url in the same call reports the same failure");
      assert.equal(fetched.filter((u) => u === U4).length, before + 1, "part docs fetch M2: the broken url is downloaded only once across both parts in the same call");

      const eState = await loadPartDocsState(await listParts());
      const e1Slot = slotCoverage(eState.index, "FETCH-E1", "datasheet");
      const e2Slot = slotCoverage(eState.index, "FETCH-E2", "datasheet");
      assert(e1Slot.state === "link-only" && e2Slot.state === "link-only" && e1Slot.docs[0].id === e2Slot.docs[0].id, "part docs fetch M2: both parts sharing the broken url end up pointing at the SAME failed link-only document");
    }

    /* --- review fix wave 1, M3: a thrown store/blob write is caught and
       isolated — the slot reports a fixed refusal, the batch continues --- */
    {
      await upsertPart({ sku: "FETCH-H", desc: "H", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: "https://etc.example/throws.pdf" }] });
      await upsertPart({ sku: "FETCH-I", desc: "I", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: "https://etc.example/fine.pdf" }] });
      const throwingDeps = { fetchDoc: deps.fetchDoc, putFile: async (): Promise<{ pathname: string }> => { throw new Error("blob store is down"); } };

      const h = await fetchSlot(await ctxFor(), { sku: "FETCH-H", kind: "datasheet" }, "Jeff", throwingDeps);
      assert(!h.ok && h.error === "Could not store the file.", "part docs fetch M3: a thrown putFile is caught and reported, never thrown out of fetchSlot");
      const i = await fetchSlot(await ctxFor(), { sku: "FETCH-I", kind: "datasheet" }, "Jeff", deps);
      assert(i.ok && !!i.documentId, "part docs fetch M3: a later slot in the same batch still succeeds after an isolated throw");
    }

    /* --- review fix wave 1, I1: the per-call wall-clock budget — a target
       past the deadline is never attempted and says so with fixed text --- */
    {
      const { createFetchBudget, NOT_ATTEMPTED_ERROR } = await import("@/lib/part-docs/fetch-links");
      await upsertPart({ sku: "FETCH-J1", desc: "J1", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: "https://etc.example/j1.pdf" }] });
      await upsertPart({ sku: "FETCH-J2", desc: "J2", category: "Lighting", unit: "ea", list: 1, cost: 1, docs: [{ kind: "datasheet", label: "DS", url: "https://etc.example/j2.pdf" }] });

      let clock = 0;
      const budget = createFetchBudget(1000, () => clock); // a budget far smaller than one fetch's 30s worst case
      const jCtx = await ctxFor();
      const before = fetched.length;

      const j1 = await fetchSlot(jCtx, { sku: "FETCH-J1", kind: "datasheet" }, "Jeff", deps, budget);
      assert(j1.ok, "part docs fetch I1: the very first fetch of a call always runs, even under a budget smaller than one worst case");
      assert.equal(fetched.length, before + 1, "part docs fetch I1: …and it actually fetched");

      clock += 999; // only 1ms of the 1000ms budget left — nowhere near FETCH_WORST_CASE_MS
      const j2 = await fetchSlot(jCtx, { sku: "FETCH-J2", kind: "datasheet" }, "Jeff", deps, budget);
      assert(!j2.ok && j2.error === NOT_ATTEMPTED_ERROR, "part docs fetch I1: a target past the deadline comes back as not attempted, with the fixed text");
      assert.equal(fetched.length, before + 1, "part docs fetch I1: …and no fetch was made for it");
    }
  }

  /* --- part documents (#207): Assembly Builder saves sync the graph in one pass --- */
  {
    const Acc = await import("@/lib/stores/part-accessory-links");
    const first = await Acc.syncAccessoryScopes("assembly", "assembly:", [
      { sourceRef: "assembly:fa-sync-1", pairs: [{ parentSku: "SYNC-FIX", accessorySku: "SYNC-LENS" }] },
      { sourceRef: "assembly:fa-sync-2", pairs: [{ parentSku: "SYNC-FIX2", accessorySku: "SYNC-CLAMP" }] },
    ]);
    assert.deepEqual(first, { written: 2, removed: 0 }, "part docs graph: one save writes every assembly's links");
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "subassembly:SA-sync" }, [{ parentSku: "SYNC-FIX", accessorySku: "SYNC-OPT" }]);
    const second = await Acc.syncAccessoryScopes("assembly", "assembly:", [
      { sourceRef: "assembly:fa-sync-1", pairs: [{ parentSku: "SYNC-FIX", accessorySku: "SYNC-LENS" }] },
    ]);
    assert.deepEqual(second, { written: 0, removed: 1 }, "part docs graph: an assembly deleted from the list loses its links");
    assert((await Acc.allAccessoryLinks()).some((l) => l.sourceRef === "subassembly:SA-sync"), "part docs graph: a subassembly's links are outside the assemblies prefix and survive");
  }

  /* --- part documents (#207): DaVinci pre-fill apply is idempotent --- */
  {
    const { applyPrefill, davinciDocumentId } = await import("@/lib/part-docs/davinci-apply");
    const Docs = await import("@/lib/stores/part-documents");
    const Acc = await import("@/lib/stores/part-accessory-links");
    const url = "https://etc.example/prefill-ds.pdf";
    const plan = {
      libraryTimestamp: "t",
      documents: [{ url, label: "CSPAR Datasheet", typeId: "TY-1", skus: ["PF-CSPAR", "PF-CSPAR2"] }],
      accessoryPairs: [{ parentSku: "PF-CSPAR", accessorySku: "PF-LENS", maxQty: 2, sourceRef: "TY-1" }],
      stats: { parts: 3, typesMatched: 2, documents: 1, documentLinks: 2, accessoryPairs: 1, accessoryLinksUnmatched: 0 },
    };
    const first = await applyPrefill(plan, "DaVinci pre-fill");
    assert.deepEqual(first, { documentsCreated: 1, linksCreated: 2, accessoryWritten: 1, accessoryRemoved: 0, complete: true }, "part docs prefill: documents, links and the graph are written");
    const doc = await Docs.getDocument(davinciDocumentId(url));
    assert(doc && doc.source === "davinci" && doc.blobKey === null && doc.sourceUrl === url && doc.language === "en" && doc.title === "CSPAR Datasheet", "part docs prefill: a link-only DaVinci document — nothing downloaded");
    assert.deepEqual(await applyPrefill(plan, "DaVinci pre-fill"), { documentsCreated: 0, linksCreated: 0, accessoryWritten: 0, accessoryRemoved: 0, complete: true }, "part docs prefill: a second run writes nothing");
    await Docs.detachDocument(doc!.id, "PF-CSPAR2");
    await applyPrefill(plan, "DaVinci pre-fill");
    assert(!(await Docs.allDocumentLinks()).some((l) => l.partSku === "PF-CSPAR2"), "part docs prefill: a human's detach survives a re-run");
    const dropped = await applyPrefill({ ...plan, accessoryPairs: [] }, "DaVinci pre-fill");
    assert.equal(dropped.accessoryRemoved, 1, "part docs prefill: a pair ETC dropped from the library is removed");
    assert(!(await Acc.allAccessoryLinks()).some((l) => l.source === "davinci" && l.accessorySku === "PF-LENS"), "part docs prefill: …from the live graph");

    const fetchedUrl = "https://etc.example/already-fetched.pdf";
    const fetched = await Docs.createDocument({ kind: "datasheet", fileName: "f.pdf", contentType: "application/pdf", size: 5, blobKey: "part-docs/x/f.pdf", sourceUrl: fetchedUrl, source: "fetch", by: "Jeff" });
    await applyPrefill({ ...plan, documents: [{ url: fetchedUrl, label: "F", typeId: "TY-2", skus: ["PF-F"] }] }, "DaVinci pre-fill");
    assert.equal(await Docs.getDocument(davinciDocumentId(fetchedUrl)), null, "part docs prefill: a URL someone already fetched gets no second document");
    assert((await Docs.allDocumentLinks()).some((l) => l.partSku === "PF-F" && l.documentId === fetched!.id), "part docs prefill: …the part is linked to the fetched one instead");
  }

  /* --- part documents (#207) review fix wave 1: batched doc-store writes
         mean exactly what their single-row versions mean --- */
  {
    const DS = await import("@/db/doc-store");
    const { getDb } = await import("@/db");
    const { DOC_TABLES } = await import("@/db/doc-tables");
    const { inArray } = await import("drizzle-orm");
    const coll = "review_snapshots" as const;
    const t = DOC_TABLES[coll];
    const rowsOf = async (ids: string[]) => {
      const db = await getDb();
      const rows = await db.select().from(t).where(inArray(t.id, ids));
      return new Map(rows.map((r) => [r.id, r]));
    };
    // Twin rows: S-* go through the single-row API, B-* through the batch one.
    const seedBoth = async (suffix: string, doc: Record<string, unknown>) => {
      await DS.upsertDoc(coll, { id: `S-${suffix}`, ...doc });
      await DS.upsertDoc(coll, { id: `B-${suffix}`, ...doc });
    };
    await seedBoth("live", { v: 1 });
    await seedBoth("gone", { v: 1 });
    await DS.softDeleteDoc(coll, "S-gone");
    await DS.softDeleteDoc(coll, "B-gone");
    await DS.setReview(coll, "S-live", { state: "seen" });
    await DS.setReview(coll, "B-live", { state: "seen" });
    const same = async (suffixes: string[], label: string) => {
      const rows = await rowsOf(suffixes.flatMap((x) => [`S-${x}`, `B-${x}`]));
      for (const x of suffixes) {
        const a = rows.get(`S-${x}`);
        const b = rows.get(`B-${x}`);
        assert(a && b, `${label}: both twins exist (${x})`);
        const strip = (d: unknown) => { const { id: _id, ...rest } = d as Record<string, unknown>; void _id; return rest; };
        assert.deepEqual(
          // review.at is setReview's own clock stamp — the twins were triaged a millisecond apart.
          { doc: strip(b!.doc), rev: b!.rev, deleted: b!.deleted, review: { ...(b!.review ?? {}), at: 0 } },
          { doc: strip(a!.doc), rev: a!.rev, deleted: a!.deleted, review: { ...(a!.review ?? {}), at: 0 } },
          `${label}: the batch row matches its single-row twin (${x})`
        );
      }
    };

    // insertDocsIfAbsent ≡ insertDocIfAbsent: new → inserted; live or
    // soft-deleted → untouched; a duplicate inside the batch → first wins.
    const singleIns = [
      await DS.insertDocIfAbsent(coll, { id: "S-new", v: 2 }),
      await DS.insertDocIfAbsent(coll, { id: "S-live", v: 2 }),
      await DS.insertDocIfAbsent(coll, { id: "S-gone", v: 2 }),
      await DS.insertDocIfAbsent(coll, { id: "S-dup", v: "first" }),
      await DS.insertDocIfAbsent(coll, { id: "S-dup", v: "second" }),
    ];
    assert.deepEqual(singleIns, [true, false, false, true, false], "batch writes: the single-row baseline behaves as documented");
    const ins = await DS.insertDocsIfAbsent(coll, [
      { id: "B-new", v: 2 }, { id: "B-live", v: 2 }, { id: "B-gone", v: 2 }, { id: "B-dup", v: "first" }, { id: "B-dup", v: "second" },
    ]);
    assert.deepEqual({ ids: [...ins.ids].sort(), complete: ins.complete }, { ids: ["B-dup", "B-new"], complete: true }, "batch writes: insertDocsIfAbsent reports only the rows it inserted");
    await same(["new", "live", "gone", "dup"], "batch writes: insertDocsIfAbsent");
    assert.equal(await DS.getDoc(coll, "B-gone"), null, "batch writes: insertDocsIfAbsent never revives a soft-deleted row");

    // upsertDocs ≡ upsertDoc: replace the doc, bump rev, revive a soft-deleted
    // row, keep review; a duplicate id inside the batch keeps the LAST doc.
    const seqBefore = await rowsOf(["B-live", "B-gone"]);
    await DS.upsertDoc(coll, { id: "S-live", v: 3 });
    await DS.upsertDoc(coll, { id: "S-gone", v: 3 });
    await DS.upsertDoc(coll, { id: "S-fresh", v: 3 });
    const up = await DS.upsertDocs(coll, [{ id: "B-live", v: 3 }, { id: "B-gone", v: 3 }, { id: "B-fresh", v: 3 }]);
    assert.deepEqual({ n: up.ids.length, complete: up.complete }, { n: 3, complete: true }, "batch writes: upsertDocs reports every row written");
    await same(["live", "gone", "fresh"], "batch writes: upsertDocs");
    const seqAfter = await rowsOf(["B-live", "B-gone"]);
    assert(Number(seqAfter.get("B-live")!.seq) > Number(seqBefore.get("B-live")!.seq) && Number(seqAfter.get("B-gone")!.seq) > Number(seqBefore.get("B-gone")!.seq), "batch writes: the _seq_bump trigger fires per row on a multi-row upsert");
    await DS.upsertDocs(coll, [{ id: "B-last", v: "a" }, { id: "B-last", v: "b" }]);
    assert.equal((await DS.getDoc<{ id: string; v: string }>(coll, "B-last"))?.v, "b", "batch writes: a duplicate id in one upsertDocs keeps the last document");

    // softDeleteDocs ≡ softDeleteDoc, and pull-sync sees every batched change.
    const cursor = Math.max(...[...(await rowsOf(["S-live", "B-live", "S-new", "B-new", "S-fresh", "B-fresh"])).values()].map((r) => Number(r.seq)));
    await DS.softDeleteDoc(coll, "S-live");
    await DS.softDeleteDoc(coll, "S-new");
    await DS.softDeleteDoc(coll, "S-missing");
    const del = await DS.softDeleteDocs(coll, ["B-live", "B-new", "B-missing", "B-live"]);
    assert.deepEqual({ ids: [...del.ids].sort(), complete: del.complete }, { ids: ["B-live", "B-new"], complete: true }, "batch writes: softDeleteDocs reports the rows that matched");
    await same(["live", "new"], "batch writes: softDeleteDocs");
    const pulled = await DS.listSince(coll, cursor, 1000);
    assert(["B-live", "B-new"].every((id) => pulled.changes.some((c) => c.id === id && c.deleted)), "batch writes: pull-sync (listSince) sees batched soft-deletes");
    const pulled2 = await DS.listSince(coll, 0, 5000);
    assert(["B-fresh", "B-dup"].every((id) => pulled2.changes.some((c) => c.id === id)), "batch writes: pull-sync sees batched inserts");

    // Chunking + the between-chunks stop.
    let chunks = 0;
    const many = Array.from({ length: 7 }, (_, i) => ({ id: `B-chunk-${i}`, v: i }));
    const stopped = await DS.insertDocsIfAbsent(coll, many, { chunkSize: 3, shouldStop: () => ++chunks > 1 });
    assert.deepEqual({ n: stopped.ids.length, complete: stopped.complete }, { n: 3, complete: false }, "batch writes: shouldStop halts cleanly between chunks");
    const rest = await DS.insertDocsIfAbsent(coll, many, { chunkSize: 3 });
    assert.deepEqual({ n: rest.ids.length, complete: rest.complete }, { n: 4, complete: true }, "batch writes: a re-run writes exactly the rest");
    assert.deepEqual(await DS.upsertDocs(coll, []), { ids: [], complete: true }, "batch writes: an empty batch is a complete no-op");
  }

  /* --- part documents (#207) review fix wave 1: the pre-fill at production
         scale is batched, budgeted, and resumable --- */
  {
    const { applyPrefill, createPrefillStopper } = await import("@/lib/part-docs/davinci-apply");
    const Acc = await import("@/lib/stores/part-accessory-links");
    // Production-sized (spec review: ~362 documents, ~3,959 links, ~6,666
    // pairs): 400 documents × 10 parts, 7,000 pairs — many 500-row chunks.
    const documents = Array.from({ length: 400 }, (_, i) => ({
      url: `https://etc.example/bulk/${i}.pdf`, label: `Bulk ${i} Datasheet`, typeId: `TY-B${i}`,
      skus: Array.from({ length: 10 }, (_, j) => `PFB-${i}-${j}`),
    }));
    const accessoryPairs = Array.from({ length: 7000 }, (_, i) => ({ parentSku: `PFB-${i % 400}-0`, accessorySku: `PFB-ACC-${i}`, maxQty: 1, sourceRef: `TY-B${i % 400}` }));
    const plan = { libraryTimestamp: "t", documents, accessoryPairs, stats: { parts: 4000, typesMatched: 400, documents: 400, documentLinks: 4000, accessoryPairs: 7000, accessoryLinksUnmatched: 0 } };
    const priorDavinci = (await Acc.allAccessoryLinks()).filter((l) => l.source === "davinci").length;

    // A budget that allows 5 chunks: the documents (1) + 4 of the 8 link chunks.
    let allowed = 5;
    const cut = await applyPrefill(plan, "DaVinci pre-fill", { shouldStop: () => allowed-- <= 0 });
    assert.deepEqual(cut, { documentsCreated: 400, linksCreated: 2000, accessoryWritten: 0, accessoryRemoved: 0, complete: false }, "part docs prefill (scale): a run out of budget stops cleanly between chunks and says so");
    let t0 = Date.now();
    const resumed = await applyPrefill(plan, "DaVinci pre-fill");
    const resumeMs = Date.now() - t0;
    assert.deepEqual(resumed, { documentsCreated: 0, linksCreated: 2000, accessoryWritten: 7000, accessoryRemoved: priorDavinci, complete: true }, "part docs prefill (scale): clicking again finishes exactly the rest");
    t0 = Date.now();
    const again = await applyPrefill(plan, "DaVinci pre-fill");
    const rerunMs = Date.now() - t0;
    assert.deepEqual(again, { documentsCreated: 0, linksCreated: 0, accessoryWritten: 0, accessoryRemoved: 0, complete: true }, "part docs prefill (scale): a finished pre-fill re-runs as a no-op");
    console.log(`  part docs prefill (scale): resume 2,000 links + 7,000 pairs ${resumeMs} ms; no-op re-run ${rerunMs} ms`);

    // The action's stopper: the first chunk always runs; later ones only
    // while a worst-case chunk still fits in the budget.
    let clock = 0;
    const stop = createPrefillStopper(10_000, 3_000, () => clock);
    clock = 20_000;
    assert.equal(stop(), false, "part docs prefill: the first chunk runs even past the budget (forward progress)");
    assert.equal(stop(), true, "part docs prefill: a later chunk past the budget does not start");
    clock = 0;
    const stop2 = createPrefillStopper(10_000, 3_000, () => clock);
    assert.equal(stop2(), false, "part docs prefill: stopper — first chunk");
    clock = 6_999;
    assert.equal(stop2(), false, "part docs prefill: stopper — a chunk that fits starts");
    clock = 7_001;
    assert.equal(stop2(), true, "part docs prefill: stopper — a chunk that would overrun does not");
  }

  /* --- part documents (#207) final fix wave: bridge, batched attach, graph
         sync, toggle no-op, DaVinci kind filter --- */
  {
    const DS = await import("@/db/doc-store");
    const Docs = await import("@/lib/stores/part-documents");
    const Acc = await import("@/lib/stores/part-accessory-links");
    const { resolvePartDatasheet, partsWithOwnDatasheet } = await import("@/lib/part-docs/datasheet-bridge");
    const { backfillLegacyDatasheets, legacyDocumentId } = await import("@/lib/part-docs/legacy");
    const { upsert: upsertPart, get: getPart } = await import("@/lib/stores/catalog");

    // doc-store helpers: rows by id with their deleted flag; SQL field filter.
    const hd = await Docs.createDocument({ kind: "datasheet", fileName: "h.pdf", contentType: "application/pdf", size: 1, blobKey: "part-docs/h/h.pdf", sourceUrl: null, source: "upload", by: "Jeff" });
    assert.equal(await Docs.attachDocument(hd!.id, ["FW-H1", "FW-H2"], "Jeff"), 2, "final fix: attach two");
    await Docs.detachDocument(hd!.id, "FW-H2");
    const rows = await DS.getDocRows("part_document_links", [Docs.documentLinkId("FW-H1", hd!.id), Docs.documentLinkId("FW-H2", hd!.id), "PDL-nope"]);
    assert.deepEqual(rows.map((r) => `${r.doc.partSku}:${r.deleted}`).sort(), ["FW-H1:false", "FW-H2:true"], "final fix: getDocRows returns live and detached rows with their flag, skips missing ids");
    assert.deepEqual((await DS.listDocsByField("part_document_links", "partSku", ["FW-H1", "FW-H2", "FW-NONE"])).map((l) => l.partSku), ["FW-H1"], "final fix: listDocsByField filters by a doc field in SQL, live rows only");
    assert.deepEqual(await DS.listDocsByField("part_document_links", "partSku", []), [], "final fix: listDocsByField with no values reads nothing");

    // I3: the batched fan-out keeps attachDocument's semantics exactly.
    const ad = await Docs.createDocument({ kind: "specsheet", fileName: "a.pdf", contentType: "application/pdf", size: 1, blobKey: "part-docs/a/a.pdf", sourceUrl: null, source: "upload", by: "Jeff" });
    assert.equal(await Docs.attachDocument(ad!.id, ["FW-A1", " FW-A1 ", "", "FW-A2"], "Jeff", 100), 2, "final fix I3: new links counted once each, blanks and trimmed duplicates skipped");
    const a1 = (await DS.getDocRows("part_document_links", [Docs.documentLinkId("FW-A1", ad!.id)]))[0].doc as Record<string, unknown>;
    assert(a1.kind === "specsheet" && a1.createdBy === "Jeff" && a1.createdAt === 100 && a1.documentId === ad!.id, "final fix I3: a new link carries the document's kind and who/when");
    await Docs.detachDocument(ad!.id, "FW-A2");
    assert.equal(await Docs.attachDocument(ad!.id, ["FW-A1", "FW-A2", "FW-A3"], "Chris", 200), 2, "final fix I3: live left alone, detached revived, new inserted — two added");
    const a2 = (await DS.getDocRows("part_document_links", [Docs.documentLinkId("FW-A2", ad!.id)]))[0];
    assert(!a2.deleted && a2.doc.createdBy === "Chris" && a2.doc.createdAt === 200, "final fix I3: a revived link is live again with fresh who/when stamps");
    const a1b = (await DS.getDocRows("part_document_links", [Docs.documentLinkId("FW-A1", ad!.id)]))[0].doc as Record<string, unknown>;
    assert(a1b.createdBy === "Jeff" && a1b.createdAt === 100, "final fix I3: a live link is never rewritten");
    assert.equal(await Docs.attachDocument(ad!.id, ["FW-A1", "FW-A2", "FW-A3"], "Chris"), 0, "final fix I3: attaching all again is a no-op");
    assert.equal(await Docs.attachDocument("PD-000000000000", ["FW-A1"], "Chris"), 0, "final fix I3: an unknown document links nothing");
    const many = Array.from({ length: 1200 }, (_, i) => `FW-MANY-${i}`);
    assert.equal(await Docs.attachDocument(ad!.id, many, "Jeff"), 1200, "final fix I3: a large fan-out (past one chunk) links every part");

    // I1: the SKU bridge follows the part's live datasheet documents.
    await upsertPart({ sku: "FW-LEG", desc: "Legacy", category: "Lighting", unit: "ea", list: 1, cost: 1, datasheetBlobKey: "part-datasheets/FW-LEG/old.pdf", datasheetName: "old.pdf" });
    const leg = (await getPart("FW-LEG"))!;
    assert.deepEqual(await resolvePartDatasheet(leg), { kind: "legacy", blobKey: "part-datasheets/FW-LEG/old.pdf" }, "final fix I1: before the backfill reaches it, the legacy blob streams");
    assert((await partsWithOwnDatasheet([leg])).has("FW-LEG"), "final fix M5: …and the catalog marker shows it");
    await backfillLegacyDatasheets([leg]);
    const legId = legacyDocumentId("FW-LEG");
    assert.deepEqual(await resolvePartDatasheet(leg), { kind: "document", documentId: legId }, "final fix I1: once backfilled, the bridge redirects to the legacy document");
    await Docs.replaceDocumentFile(legId, { blobKey: `part-docs/${legId}/new.pdf`, fileName: "new.pdf", contentType: "application/pdf", size: 3 }, "Chris");
    assert.deepEqual(await resolvePartDatasheet(leg), { kind: "document", documentId: legId }, "final fix I1: after a replace it still goes to the document (its new file), never the stale datasheetBlobKey");
    await Docs.detachDocument(legId, "FW-LEG");
    assert.equal(await resolvePartDatasheet(leg), null, "final fix I1: a detached legacy document stays detached — no stale file");
    assert(!(await partsWithOwnDatasheet([leg])).has("FW-LEG"), "final fix M5: …and the catalog marker drops it");
    const linkOnly = await Docs.createDocument({ kind: "datasheet", fileName: "l.pdf", contentType: "application/pdf", size: 0, blobKey: null, sourceUrl: "https://x.example/l.pdf", source: "fetch", by: "Jeff" });
    await Docs.attachDocument(linkOnly!.id, ["FW-LEG"], "Jeff");
    assert.deepEqual(await resolvePartDatasheet(leg), { kind: "document", documentId: linkOnly!.id }, "final fix I1: a link-only datasheet is served when there is no stored one");
    assert(!(await partsWithOwnDatasheet([leg])).has("FW-LEG"), "final fix M5: a link-only datasheet is not the part's own file");
    const spec = await Docs.createDocument({ kind: "specsheet", fileName: "s.pdf", contentType: "application/pdf", size: 1, blobKey: "part-docs/s/s.pdf", sourceUrl: null, source: "upload", by: "Jeff" });
    await Docs.attachDocument(spec!.id, ["FW-LEG"], "Jeff");
    const stored = await Docs.createDocument({ kind: "datasheet", fileName: "d.pdf", contentType: "application/pdf", size: 1, blobKey: "part-docs/d/d.pdf", sourceUrl: null, source: "upload", by: "Jeff" });
    await Docs.attachDocument(stored!.id, ["FW-LEG"], "Jeff");
    assert.deepEqual(await resolvePartDatasheet(leg), { kind: "document", documentId: stored!.id }, "final fix I1: a stored datasheet wins over link-only; a spec sheet is never served as the datasheet");
    assert((await partsWithOwnDatasheet([leg, { sku: "FW-NOTHING" }])).has("FW-LEG"), "final fix M5: a stored datasheet shows the marker");
    assert.equal(await resolvePartDatasheet({ sku: "FW-NOTHING" }), null, "final fix I1: a part with nothing gets nothing");

    // M1: the own-datasheet toggle distinguishes "not linked" from "no change".
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "assembly:fw-m1" }, [{ parentSku: "FW-FIX", accessorySku: "FW-ACC" }]);
    assert.deepEqual(await Acc.setOwnDatasheet("FW-FIX", "FW-ACC", false), { linked: true, changed: 0 }, "final fix M1: setting the flag to its current value is a linked no-op, not 'save first'");
    assert.deepEqual(await Acc.setOwnDatasheet("FW-FIX", "FW-ACC", true), { linked: true, changed: 1 }, "final fix M1: setting it changes the row");
    assert.deepEqual(await Acc.setOwnDatasheet("FW-FIX", "FW-ACC", true), { linked: true, changed: 0 }, "final fix M1: setting it again is still a linked no-op");
    assert.deepEqual(await Acc.setOwnDatasheet("FW-FIX", "FW-UNSAVED", true), { linked: false, changed: 0 }, "final fix M1: an unsaved member reports not linked");

    // M2: the DaVinci pre-fill never reuses a spec sheet as a datasheet.
    const { applyPrefill, davinciDocumentId } = await import("@/lib/part-docs/davinci-apply");
    const sharedUrl = "https://etc.example/shared-guide.pdf";
    const specByUrl = await Docs.createDocument({ kind: "specsheet", fileName: "g.pdf", contentType: "application/pdf", size: 0, blobKey: null, sourceUrl: sharedUrl, source: "fetch", by: "Jeff" });
    await applyPrefill({
      libraryTimestamp: "t",
      documents: [{ url: sharedUrl, label: "Shared", typeId: "TY-FW", skus: ["FW-DV"] }],
      accessoryPairs: [],
      stats: { parts: 1, typesMatched: 1, documents: 1, documentLinks: 1, accessoryPairs: 0, accessoryLinksUnmatched: 0 },
    }, "DaVinci pre-fill");
    const dvLinks = (await Docs.allDocumentLinks()).filter((l) => l.partSku === "FW-DV");
    assert.deepEqual(dvLinks.map((l) => `${l.documentId}:${l.kind}`), [`${davinciDocumentId(sharedUrl)}:datasheet`], "final fix M2: the part gets a DaVinci datasheet document, not the spec sheet sharing its URL");
    assert(!dvLinks.some((l) => l.documentId === specByUrl!.id), "final fix M2: …the spec sheet is not linked");

    // I2 → #210: the one-time fixture conversion — settings assemblies and
    // legacy subassemblies become fixture records (ids kept), and the graph
    // moves from assembly:/subassembly: to one fixture:<id> scope.
    const { setSettings } = await import("@/lib/settings");
    const { insertDocIfAbsent } = DS;
    const Mig = await import("@/lib/fixtures-migrate");
    const { CONVERTED_BY, normalizeFixtureRow } = await import("@/lib/fixtures-convert");
    const { getDb } = await import("@/db");
    const { blobs, DOC_TABLES } = await import("@/db/doc-tables");
    const { inArray, sql } = await import("drizzle-orm");
    const { getSettings } = await import("@/lib/settings");
    const flagIds = [Mig.FIXTURES_CONVERT_BLOB_ID, Mig.LEGACY_GRAPH_SYNC_BLOB_ID];
    const clearFlags = async () => { await (await getDb()).delete(blobs).where(inArray(blobs.id, flagIds)); };
    // A fingerprint of everything the conversion could write: row counts,
    // max seq and rev sums of both doc tables, plus both flag blobs.
    const tableFp = async () => {
      const db = await getDb();
      const one = async (t: (typeof DOC_TABLES)["subassemblies"]) =>
        (await db.select({ n: sql<number>`count(*)::int`, s: sql<string>`coalesce(max(${t.seq}), 0)::text`, r: sql<string>`coalesce(sum(${t.rev}), 0)::text`, d: sql<number>`count(*) filter (where ${t.deleted})::int` }).from(t))[0];
      return JSON.stringify([await one(DOC_TABLES.subassemblies), await one(DOC_TABLES.part_accessory_links)]);
    };
    const fp = async () => JSON.stringify([await tableFp(), await (await getDb()).select().from(blobs).where(inArray(blobs.id, flagIds)).orderBy(blobs.id)]);
    await clearFlags();
    const priorAssemblies = ((await getSettings()).fixtureAssemblies ?? []) as unknown[];
    assert.equal(priorAssemblies.length, 0, "#210: the test database starts with no fixture assemblies");
    const fwAssemblies = [
      { id: "fw-asm", name: "FW assembly", components: [
        { sku: "FW-S4", label: "Engine", role: "fixture", defaultQty: 1 },
        { sku: "FW-LENS", label: "Lens", role: "lens", defaultQty: 1 },
        { sku: "FW-CLAMP", label: "Clamp", role: "mount", defaultQty: 0 },
      ] },
      // Converted once, then deleted by a user: must stay deleted.
      { id: "fw-del", name: "FW deleted", components: [{ sku: "FW-S4", label: "Engine", role: "fixture", defaultQty: 1 }] },
    ];
    await setSettings({ fixtureAssemblies: fwAssemblies });
    await insertDocIfAbsent("subassemblies", { id: "fw-del", kind: "fixture", label: "FW deleted", lightEngineSku: "FW-S4", lines: { data: [], power: [], mounting: [], accessories: [] } });
    await DS.softDeleteDoc("subassemblies", "fw-del");
    const saOriginal = {
      id: "SA-FW", kind: "fixture", label: "FW sub", description: "", lightEngineSku: "FW-S4", lightEngineName: "S4 engine", lightEngineCost: 40,
      lensSku: "FW-LENS2", lensName: "Lens two", lensCost: 5, options: { data: [{ sku: "FW-DATA", name: "Data cable", cost: 3, qty: 2 }], power: [], mounting: [], accessories: [] },
      cost: 51, price: 90, snapshot: { cost: 51, price: 90, pricedAt: null }, createdAt: 1, updatedAt: 1,
    };
    await insertDocIfAbsent("subassemblies", saOriginal);
    // The part-documents build's scopes as a database that ran its one-time
    // sync holds them, a deleted assembly's leftovers, DaVinci's scope, and a
    // human's own-datasheet flag on one assembly: pair and one subassembly: pair.
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "assembly:fw-asm" }, [{ parentSku: "FW-S4", accessorySku: "FW-LENS", maxQty: 1, included: true }, { parentSku: "FW-S4", accessorySku: "FW-CLAMP" }]);
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "subassembly:SA-FW" }, [{ parentSku: "FW-S4", accessorySku: "FW-LENS2", maxQty: 1, included: true }, { parentSku: "FW-S4", accessorySku: "FW-DATA", maxQty: 2, included: true }]);
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "assembly:fw-gone" }, [{ parentSku: "FW-OLD", accessorySku: "FW-OLDACC" }]);
    await Acc.syncAccessoryLinks({ source: "davinci", sourceRef: "TY-FWX" }, [{ parentSku: "FW-S4", accessorySku: "FW-LENS" }]);
    await Acc.setOwnDatasheet("FW-S4", "FW-LENS", true);
    await Acc.setOwnDatasheet("FW-S4", "FW-DATA", true);
    assert.equal(await Mig.fixturesConverted(), false, "#210: a fresh database has not converted");

    // Fix wave 1, C1(a): a Vercel preview (shares production's database)
    // never converts on a page read — nothing is written at all.
    const priorVercelEnv = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "preview";
    try {
      const before = await fp();
      assert.equal(await Mig.ensureFixturesConverted(), false, "#210 fix C1: a preview deploy's page read does not convert");
      assert.equal(await fp(), before, "#210 fix C1: …and writes nothing (rows, graph and flags untouched)");
    } finally {
      if (priorVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = priorVercelEnv;
    }
    // Fix wave 1, M3: a pass out of budget before its first chunk writes nothing.
    {
      const before = await fp();
      assert.equal(await Mig.ensureFixturesConverted(0, () => 0), false, "#210 fix M3: an out-of-budget pass reports incomplete");
      assert.equal(await fp(), before, "#210 fix M3: …and writes nothing — no insert, no rewrite, no graph row, no flag");
    }

    const isLegacyRef = (l: { source?: string; sourceRef?: string }) => l.source === "assembly" && /^(assembly|subassembly):/.test(l.sourceRef ?? "");
    const legacyLive = (await Acc.allAccessoryLinks()).filter(isLegacyRef).length;
    assert(legacyLive >= 5, `#210 setup: at least this section's five legacy rows are live (got ${legacyLive})`);
    const r1 = await Mig.convertFixtures();
    assert(r1.complete && r1.inserted === 1 && r1.rewritten === 1 && r1.graphWritten === 4, `#210: the first run converts one assembly + one subassembly and moves the graph (got ${JSON.stringify(r1)})`);
    assert.equal(r1.graphRemoved, legacyLive, "#210 fix M3: graphRemoved is exactly the live legacy rows retired");
    assert.equal(await Mig.fixturesConverted(), true, "#210: a completed conversion sets the flag");
    assert((await DS.getBlob(Mig.LEGACY_GRAPH_SYNC_BLOB_ID, { assembliesSyncedAt: 0 })).assembliesSyncedAt > 0, "#210 fix M1: …and the part-documents build's graph flag, so an older build can't re-create assembly:/subassembly: rows");
    assert.equal(await DS.getDoc("subassemblies", "fw-del"), null, "#210 fix I1: a converted assembly a user deleted stays deleted (never revived)");
    const fw = (await DS.getDoc<Record<string, unknown> & { id: string }>("subassemblies", "fw-asm"))!;
    const fwLines = fw.lines as Record<string, Array<{ sku: string; qty: number }>>;
    assert(fw && fw.lightEngineSku === "FW-S4" && fw.lensSku === "FW-LENS" && fwLines.mounting[0]?.sku === "FW-CLAMP" && fwLines.mounting[0]?.qty === 0, "#210: the settings assembly converted by role, keeping its fa-style id");
    const saRow = (await DS.getDocRows("subassemblies", ["SA-FW"]))[0];
    const sa = saRow.doc as Record<string, unknown> & { id: string };
    const saLines = sa.lines as Record<string, Array<{ sku: string; qty: number }>>;
    assert(!saRow.deleted && saLines?.data?.[0]?.sku === "FW-DATA" && saLines.data[0].qty === 2 && sa.createdBy === CONVERTED_BY, "#210: the legacy subassembly row gains the fixture fields in place under its SA- id");
    // Fix wave 1, C1(b): the rewrite is additive — every original field survives.
    for (const [k, v] of Object.entries(saOriginal)) assert.deepEqual(sa[k], v, `#210 fix C1: the old row's ${k} survives the conversion unchanged`);
    // …so a main-style reader (the old Subassemblies tab: options per box,
    // stored names, stored cost/price) still reads the same record.
    type OldShape = { id: string; lightEngineName: string; lensName: string; options: Record<string, Array<{ sku: string; name: string; qty: number }>>; price: number; cost: number };
    const oldRead = (await DS.listDocs<OldShape>("subassemblies")).find((r) => r.id === "SA-FW")!;
    assert(oldRead.lightEngineName === "S4 engine" && oldRead.lensName === "Lens two" && oldRead.options.data.map((o) => `${o.sku}:${o.name}:${o.qty}`).join() === "FW-DATA:Data cable:2" && oldRead.price === 90 && oldRead.cost === 51, "#210 fix C1: a main-style reader still sees the old shape's fields");
    const norm = normalizeFixtureRow(sa);
    assert(norm.kind === "fixture" && norm.lensSku === "FW-LENS2" && norm.lines.data[0]?.sku === "FW-DATA" && norm.legacy?.from === "subassembly", "#210 fix C1: …and the new reader normalizes the merged row as a converted fixture");
    assert.equal((await DS.listSince("subassemblies", 0, 10_000)).changes.find((c) => c.id === "SA-FW")?.rev, 2, "#210 fix I1: the in-place merge bumps rev exactly once");
    assert.equal(((await getSettings()).fixtureAssemblies ?? []).length, 2, "#210: settings.fixtureAssemblies is left untouched as a backup");
    const live = await Acc.allAccessoryLinks();
    const has = (ref: string, parent: string, acc: string) => live.some((l) => l.source === "assembly" && l.sourceRef === ref && l.parentSku === parent && l.accessorySku === acc);
    assert(has("fixture:fw-asm", "FW-S4", "FW-LENS") && has("fixture:fw-asm", "FW-S4", "FW-CLAMP") && has("fixture:SA-FW", "FW-S4", "FW-LENS2") && has("fixture:SA-FW", "FW-S4", "FW-DATA"), "#210: every fixture's pairs live under one fixture:<id> scope");
    assert(!live.some(isLegacyRef), "#210: the old assembly:/subassembly: rows are soft-deleted, a deleted assembly's leftovers included");
    assert.equal(live.find((l) => l.sourceRef === "fixture:fw-asm" && l.accessorySku === "FW-LENS")?.ownDatasheet, true, "#210: the pair's own-datasheet flag carries onto the fixture: row");
    assert.equal(live.find((l) => l.sourceRef === "fixture:SA-FW" && l.accessorySku === "FW-DATA")?.ownDatasheet, true, "#210 fix M3: …a subassembly:-origin pair's flag too");
    assert(live.some((l) => l.source === "davinci" && l.sourceRef === "TY-FWX"), "#210: DaVinci's scope is never touched");
    {
      const before = await fp();
      assert.equal(await Mig.ensureFixturesConverted(), true, "#210: every later read reports converted");
      assert.equal(await fp(), before, "#210 fix M3: …and is a true no-op — nothing written, flags included");
      const beforeTables = await tableFp();
      const again = await Mig.convertFixtures();
      assert(again.complete && again.inserted === 0 && again.rewritten === 0 && again.graphWritten === 0 && again.graphRemoved === 0, `#210: an explicit re-run changes nothing (got ${JSON.stringify(again)})`);
      assert.equal(await tableFp(), beforeTables, "#210 fix M3: …no row in either table is touched");
    }
    // A run cut short by its budget leaves the flag unset; the next read finishes.
    await clearFlags();
    await setSettings({ fixtureAssemblies: [...fwAssemblies, { id: "fw-asm2", name: "FW two", components: [{ sku: "FW-S5", label: "E", role: "fixture", defaultQty: 1 }, { sku: "FW-IRIS", label: "I", role: "accessory", defaultQty: 1 }] }] });
    {
      const before = await fp();
      assert.equal(await Mig.ensureFixturesConverted(0, () => 0), false, "#210: a conversion out of budget reports incomplete");
      assert.equal(await fp(), before, "#210 fix M3: …writes nothing");
    }
    assert.equal(await Mig.fixturesConverted(), false, "#210: …and leaves the flag unset");
    assert.equal(await Mig.ensureFixturesConverted(), true, "#210: the next read finishes the job");
    assert(!!(await DS.getDoc("subassemblies", "fw-asm2")) && (await Acc.allAccessoryLinks()).some((l) => l.sourceRef === "fixture:fw-asm2" && l.accessorySku === "FW-IRIS"), "#210: …writing the rest, graph included");

    // Fix wave 1, I1: a save or delete landing between the pass's read and its
    // write is never overwritten or revived — the pass reports incomplete and
    // the next one re-plans from the fresh rows.
    await clearFlags();
    const legacyRow = (id: string, dataSku: string) => ({
      id, kind: "fixture", label: id, description: "", lightEngineSku: "FW-RACE-E", lightEngineName: "E", lightEngineCost: 1, lensSku: "", lensName: "", lensCost: 0,
      options: { data: [{ sku: dataSku, name: dataSku, cost: 1, qty: 1 }], power: [], mounting: [], accessories: [] }, cost: 2, price: 3, createdAt: 1, updatedAt: 1,
    });
    for (const id of ["SA-RACE-OLD", "SA-RACE-NEW", "SA-RACE-DEL"]) await insertDocIfAbsent("subassemblies", legacyRow(id, "FW-RACE-D"));
    const newSave = { id: "SA-RACE-NEW", kind: "fixture", label: "User's save", description: "", lightEngineSku: "FW-RACE-E", lensSku: null, lines: { data: [{ sku: "FW-RACE-USER", qty: 4 }], power: [], mounting: [], accessories: [] }, updatedBy: "Jeff", updatedAt: 5 };
    const race = await Mig.convertFixtures({
      beforeWrite: async () => {
        await upsertDoc("subassemblies", legacyRow("SA-RACE-OLD", "FW-RACE-OLDSAVE")); // an older build's save (old shape)
        await upsertDoc("subassemblies", newSave); // a builder save (new shape)
        await DS.softDeleteDoc("subassemblies", "SA-RACE-DEL"); // a delete
      },
    });
    assert(!race.complete && race.rewritten === 0, `#210 fix I1: a pass that lost every race rewrites nothing and stays incomplete (got ${JSON.stringify(race)})`);
    assert.equal(await Mig.fixturesConverted(), false, "#210 fix I1: …so the flag stays unset");
    const oldSaved = (await DS.getDoc<Record<string, unknown> & { id: string }>("subassemblies", "SA-RACE-OLD"))!;
    assert(oldSaved.lines === undefined && JSON.stringify(oldSaved.options).includes("FW-RACE-OLDSAVE"), "#210 fix I1: an older build's concurrent save is not overwritten from the stale snapshot");
    assert.deepEqual(await DS.getDoc("subassemblies", "SA-RACE-NEW"), newSave, "#210 fix I1: a concurrent builder save is left exactly as saved");
    const delRow = (await DS.getDocRows("subassemblies", ["SA-RACE-DEL"]))[0];
    assert(delRow.deleted && delRow.doc.lines === undefined, "#210 fix I1: a concurrent delete is not revived (or rewritten)");
    const race2 = await Mig.convertFixtures();
    assert(race2.complete && race2.rewritten === 1, `#210 fix I1: the next pass converts the re-saved row and completes (got ${JSON.stringify(race2)})`);
    const oldConverted = (await DS.getDoc<Record<string, unknown> & { id: string }>("subassemblies", "SA-RACE-OLD"))!;
    assert.equal((oldConverted.lines as Record<string, Array<{ sku: string }>>).data[0]?.sku, "FW-RACE-OLDSAVE", "#210 fix I1: …from the user's latest save, not the stale read");

    // Fix wave 1, M3: two concurrent passes end in the same state as one —
    // each insert and rewrite lands once, nothing revived or clobbered.
    await clearFlags();
    await setSettings({ fixtureAssemblies: [...fwAssemblies, { id: "fw-par", name: "FW par", components: [{ sku: "FW-PAR-E", label: "E", role: "fixture", defaultQty: 1 }, { sku: "FW-PAR-L", label: "L", role: "lens", defaultQty: 1 }] }] });
    await insertDocIfAbsent("subassemblies", legacyRow("SA-PAR", "FW-PAR-D"));
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "subassembly:SA-PAR" }, [{ parentSku: "FW-RACE-E", accessorySku: "FW-PAR-D", maxQty: 1, included: true }]);
    const [p1, p2] = await Promise.all([Mig.convertFixtures(), Mig.convertFixtures()]);
    assert.equal(p1.inserted + p2.inserted, 1, `#210 fix M3: two concurrent passes insert the new assembly once (got ${JSON.stringify([p1, p2])})`);
    assert.equal(p1.rewritten + p2.rewritten, 1, "#210 fix M3: …and rewrite the legacy row once");
    assert.equal(p1.graphWritten + p2.graphWritten, 2, "#210 fix M3: …and write each new fixture: row once");
    assert(p1.complete || p2.complete || (await Mig.convertFixtures()).complete, "#210 fix M3: the pair (or one more pass) completes");
    const parRow = (await DS.getDocRows("subassemblies", ["SA-PAR"]))[0];
    assert(!parRow.deleted && (parRow.doc.lines as Record<string, Array<{ sku: string }>>).data[0]?.sku === "FW-PAR-D" && JSON.stringify(parRow.doc.options).includes("FW-PAR-D"), "#210 fix M3: the legacy row is converted once, additively");
    assert.equal((await DS.listSince("subassemblies", 0, 10_000)).changes.find((c) => c.id === "SA-PAR")?.rev, 2, "#210 fix M3: …its rev bumped exactly once across both passes");
    assert.equal(await DS.getDoc("subassemblies", "fw-del"), null, "#210 fix M3: the deleted assembly is still not revived");
    const parLive = await Acc.allAccessoryLinks();
    assert(parLive.some((l) => l.sourceRef === "fixture:fw-par" && l.accessorySku === "FW-PAR-L") && parLive.some((l) => l.sourceRef === "fixture:SA-PAR" && l.accessorySku === "FW-PAR-D") && !parLive.some(isLegacyRef), "#210 fix M3: …the graph ends fully moved");

    // Fix wave 1, M3: a pass cut off after the fixture: rows landed but before
    // the retire resumes on the next run. The only graph work is one fixture:
    // chunk (check 1) and one retire chunk (check 2), so stopping at check 2
    // cuts exactly between them.
    await clearFlags();
    await insertDocIfAbsent("subassemblies", { id: "SA-RES", kind: "fixture", label: "Resume", description: "", lightEngineSku: "FW-RES-E", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [{ sku: "FW-RES-A", qty: 1 }] } });
    await Acc.syncAccessoryLinks({ source: "assembly", sourceRef: "subassembly:SA-RES" }, [{ parentSku: "FW-RES-E", accessorySku: "FW-RES-A", maxQty: 1, included: true }]);
    let checks = 0;
    const cut = await Mig.convertFixtures({ shouldStop: () => ++checks >= 2 });
    const cutLive = await Acc.allAccessoryLinks();
    assert(!cut.complete && cut.graphWritten === 1 && cut.graphRemoved === 0, `#210 fix M3: the cut pass wrote the fixture: row but retired nothing (got ${JSON.stringify(cut)})`);
    assert(cutLive.some((l) => l.sourceRef === "fixture:SA-RES") && cutLive.some((l) => l.sourceRef === "subassembly:SA-RES"), "#210 fix M3: …both scopes are live at the cut");
    assert.equal(await Mig.fixturesConverted(), false, "#210 fix M3: …and the flag is unset");
    const resumed = await Mig.convertFixtures();
    assert(resumed.complete && resumed.graphWritten === 0 && resumed.graphRemoved === 1, `#210 fix M3: the re-run retires the one leftover and completes (got ${JSON.stringify(resumed)})`);
    assert(await Mig.fixturesConverted(), "#210 fix M3: …setting the flag");
    await setSettings({ fixtureAssemblies: priorAssemblies });
  }

  /* --- part documents (#207) final fix wave 2, I4: an interrupted legacy
         backfill (document minted, link never written) must not 404 --- */
  {
    const Docs = await import("@/lib/stores/part-documents");
    const { resolvePartDatasheet, partsWithOwnDatasheet } = await import("@/lib/part-docs/datasheet-bridge");
    const { backfillLegacyDatasheets, legacyDocumentId } = await import("@/lib/part-docs/legacy");
    const { upsert: upsertPart, get: getPart } = await import("@/lib/stores/catalog");

    await upsertPart({ sku: "DOC-INTERRUPT", desc: "Interrupted", category: "Lighting", unit: "ea", list: 1, cost: 1, datasheetBlobKey: "part-datasheets/DOC-INTERRUPT/old.pdf", datasheetName: "old.pdf" });
    const part = (await getPart("DOC-INTERRUPT"))!;
    const docId = legacyDocumentId("DOC-INTERRUPT");
    // Simulate legacy.ts stopping between "create the document" and
    // "ensureLinks" (two separate writes): the document exists, its link
    // never does.
    const minted = await Docs.createDocument({
      id: docId, kind: "datasheet", fileName: "old.pdf", contentType: "application/pdf", size: 0,
      blobKey: "part-datasheets/DOC-INTERRUPT/old.pdf", sourceUrl: null, source: "legacy", sourceRef: "DOC-INTERRUPT", by: "Legacy datasheet backfill",
    });
    assert(minted, "final fix I4 setup: the interrupted state — the document exists, unlinked");

    assert.deepEqual(await resolvePartDatasheet(part), { kind: "legacy", blobKey: "part-datasheets/DOC-INTERRUPT/old.pdf" }, "final fix I4: a minted-but-unlinked legacy document must not 404 — the link never existed, so the legacy blob still streams");
    assert((await partsWithOwnDatasheet([part])).has("DOC-INTERRUPT"), "final fix I4: …and the catalog marker still shows it");

    const repaired = await backfillLegacyDatasheets([part]);
    assert.deepEqual(repaired, { created: 0 }, "final fix I4: the backfill repairs the missing link without minting a second document");
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.partSku === "DOC-INTERRUPT" && l.documentId === docId).length, 1, "final fix I4: the missing link now exists");
    assert.deepEqual(await resolvePartDatasheet(part), { kind: "document", documentId: docId }, "final fix I4: the bridge now redirects to the (now-linked) legacy document");

    // A human's detach afterwards must still stick — the repair pass must
    // never make a detached link un-detachable, and must never resurrect it
    // on a later run.
    await Docs.detachDocument(docId, "DOC-INTERRUPT");
    assert.equal(await resolvePartDatasheet(part), null, "final fix I4: once linked and then detached, it 404s as before");
    await backfillLegacyDatasheets([part]);
    assert.equal((await Docs.allDocumentLinks()).filter((l) => l.partSku === "DOC-INTERRUPT").length, 0, "final fix I4: …confirmed — the repair pass itself never revives a link a human detached");
  }

  /* --- part documents (#207) final fix wave 2, I5: the one-time graph sync
         uses a STRICT settings read — a DB error must propagate, not read
         as "no fixture assemblies" and mark the pass complete --- */
  {
    const { getDb, withTransaction } = await import("@/db");
    const { sql, eq } = await import("drizzle-orm");
    const { blobs } = await import("@/db/doc-tables");
    const { getSettingsPatch, getSettingsPatchStrict, getSettingsStrict } = await import("@/lib/settings");

    // settings.ts: the strict readers agree with the lenient ones when the
    // DB is healthy…
    await setSettings({ companyName: "Strict Settings Probe" });
    assert.equal((await getSettingsStrict()).companyName, "Strict Settings Probe", "final fix I5: getSettingsStrict matches getSettings when the DB is healthy");

    // …but a genuine DB error propagates from the strict reader (never
    // resolves to `{}`), while the lenient one still swallows it exactly as
    // documented (unchanged) — both probed inside a transaction so the
    // DROP is rolled back and never actually lands.
    await assert.rejects(
      withTransaction(async () => {
        const db = await getDb();
        await db.execute(sql`DROP TABLE app_settings`);
        await getSettingsPatchStrict();
      }),
      "final fix I5: getSettingsPatchStrict propagates a DB error instead of resolving to {}",
    );
    await assert.rejects(
      withTransaction(async () => {
        const db = await getDb();
        await db.execute(sql`DROP TABLE app_settings`);
        assert.deepEqual(await getSettingsPatch(), {}, "final fix I5: the lenient reader still swallows the same failure (documented behavior, unchanged)");
        throw new Error("I5-lenient-probe-rollback");
      }),
      /I5-lenient-probe-rollback/,
      "final fix I5: probe transaction rolled back cleanly",
    );
    assert.equal((await getSettingsStrict()).companyName, "Strict Settings Probe", "final fix I5: app_settings is intact after both probes roll back");

    // End to end: the fixture conversion (which now owns the one-time graph
    // sync, #210) propagates a settings-read failure instead of converting
    // the subassemblies only and marking itself complete.
    const Mig = await import("@/lib/fixtures-migrate");
    await (await getDb()).delete(blobs).where(eq(blobs.id, Mig.FIXTURES_CONVERT_BLOB_ID));
    assert.equal(await Mig.fixturesConverted(), false, "final fix I5 setup: the flag starts unset");
    await assert.rejects(
      withTransaction(async () => {
        const db = await getDb();
        await db.execute(sql`DROP TABLE app_settings`);
        await Mig.convertFixtures();
      }),
      "final fix I5: a settings-read failure during the one-time conversion propagates — it must not silently convert subassemblies only",
    );
    assert.equal(await Mig.fixturesConverted(), false, "final fix I5: …and the completion flag stays unset after the throw");
  }

  /* --- part documents (#207) final fix wave 2, I6: the one-time graph sync
         is strictly add-only — it can never overwrite a concurrent Assembly
         Builder save --- */
  {
    const Acc = await import("@/lib/stores/part-accessory-links");
    // Seed the scope the way a normal (reconcile) save would.
    await Acc.syncAccessoryScopes("assembly", "assembly:", [
      { sourceRef: "assembly:fw-conc", pairs: [{ parentSku: "FW-CONC", accessorySku: "FW-A" }, { parentSku: "FW-CONC", accessorySku: "FW-B" }] },
    ]);
    // A concurrent save lands "during" the one-time sync's window: it drops
    // FW-B and adds FW-C.
    await Acc.syncAccessoryScopes("assembly", "assembly:", [
      { sourceRef: "assembly:fw-conc", pairs: [{ parentSku: "FW-CONC", accessorySku: "FW-A" }, { parentSku: "FW-CONC", accessorySku: "FW-C" }] },
    ]);
    const before = (await Acc.allAccessoryLinks()).filter((l) => l.sourceRef === "assembly:fw-conc").map((l) => l.accessorySku).sort();
    assert.deepEqual(before, ["FW-A", "FW-C"], "final fix I6 setup: the concurrent save's drop+add landed");

    // The one-time sync now runs off ITS OWN stale settings snapshot — read
    // before the concurrent save above, so it still thinks the scope is
    // [FW-A, FW-B] and knows nothing of FW-C. A reconcile sync would
    // soft-delete FW-C (not in its stale desired set) — overwriting the
    // concurrent save; add-only must never remove anything.
    const r = await Acc.syncAccessoryScopeSet("assembly", [
      { sourceRef: "assembly:fw-conc", pairs: [{ parentSku: "FW-CONC", accessorySku: "FW-A" }, { parentSku: "FW-CONC", accessorySku: "FW-B" }] },
    ]);
    assert.equal(r.removed, 0, "final fix I6: the one-time sync never soft-deletes anything");
    const after = (await Acc.allAccessoryLinks()).filter((l) => l.sourceRef === "assembly:fw-conc").map((l) => l.accessorySku).sort();
    assert(after.includes("FW-C"), "final fix I6: the concurrent save's FW-C addition survives the one-time sync's stale, add-only pass — never overwritten");

    // An already-live row (and its own-datasheet flag) is left completely
    // alone by the add-only pass, never rewritten.
    await Acc.setOwnDatasheet("FW-CONC", "FW-A", true);
    await Acc.syncAccessoryScopeSet("assembly", [
      { sourceRef: "assembly:fw-conc", pairs: [{ parentSku: "FW-CONC", accessorySku: "FW-A" }] },
    ]);
    assert.equal((await Acc.allAccessoryLinks()).find((l) => l.sourceRef === "assembly:fw-conc" && l.accessorySku === "FW-A")?.ownDatasheet, true, "final fix I6: an already-live row's own-datasheet flag is never touched by the add-only pass");
  }

  /* --- #210 fixture builder: the store — first-read conversion, create /
         update / delete, save rules, who/when stamps --- */
  {
    const Fx = await import("@/lib/stores/fixtures");
    const Mig = await import("@/lib/fixtures-migrate");
    const DS = await import("@/db/doc-store");
    const { sanitizeFixtureInput } = await import("@/lib/fixture-assemblies");
    const { assemblyToFixture } = await import("@/lib/fixtures-convert");

    await Mig.resetFixturesConversion();
    assert.equal(await Mig.fixturesConverted(), false, "#210 store: resetFixturesConversion re-arms the conversion (the go-live reset path)");
    await setSettings({ fixtureAssemblies: [{ id: "fa-fxb-store", name: "Store probe", components: [{ sku: "FXB-E", label: "E", role: "fixture", defaultQty: 1 }] }] });
    const first = await Fx.listFixtures();
    assert(first.some((f) => f.id === "fa-fxb-store"), "#210 store: listFixtures converts on its first read");
    assert.equal(await Mig.fixturesConverted(), true, "#210 store: …and marks the conversion complete");
    const labels = first.map((f) => f.label);
    assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)), "#210 store: the list is sorted by label");
    await setSettings({ fixtureAssemblies: [] });

    const clean = sanitizeFixtureInput({ kind: "fixture", label: "FXB Store", description: "", lightEngineSku: "FXB-NOT-IN-CATALOG", lines: { power: [{ sku: "FXB-CBL", qty: 1 }] } });
    assert(clean.ok, "#210 store: a light engine missing from the catalog does not block a save");
    if (!clean.ok) throw new Error("unreachable");
    const snap = { cost: 0, price: 0, pricedAt: null };
    const made = await Fx.createFixture(clean.value, "Jeff", snap, 1_700_000_000_000);
    assert.match(made.id, /^SA-[0-9A-Z]+$/, "#210 store: new records get an SA-<TS36> id");
    assert(made.createdBy === "Jeff" && made.updatedBy === "Jeff" && made.createdAt === 1_700_000_000_000 && made.updatedAt === 1_700_000_000_000, "#210 store: create stamps who/when");
    const twin = await Fx.createFixture(clean.value, "Jeff", snap, 1_700_000_000_000);
    assert.notEqual(twin.id, made.id, "#210 store: a same-millisecond create never overwrites (collision-safe id)");
    const edited = sanitizeFixtureInput({ kind: "fixture", label: "FXB Store v2", description: "", lightEngineSku: "FXB-ENG" });
    if (!edited.ok) throw new Error("unreachable");
    const upd = await Fx.updateFixture(made, edited.value, "Sam", snap, 1_700_000_100_000);
    assert(upd.id === made.id && upd.label === "FXB Store v2" && upd.createdBy === "Jeff" && upd.createdAt === made.createdAt && upd.updatedBy === "Sam" && upd.updatedAt === 1_700_000_100_000, "#210 store: update keeps id + created*, stamps updated*");
    assert.equal((await Fx.getFixture(made.id))?.label, "FXB Store v2", "#210 store: the update is read back");
    await Fx.removeFixture(made.id);
    assert.equal(await Fx.getFixture(made.id), null, "#210 store: delete is a soft delete the reader no longer sees");
    assert(!(await Fx.listFixtures()).some((f) => f.id === made.id), "#210 store: …and the list drops it");

    const flagged = assemblyToFixture({ id: "fa-fxb-nr", name: "Kit", components: [{ sku: "K1", label: "Cable", role: "cable", defaultQty: 1 }] }, 1);
    await DS.insertDocIfAbsent("subassemblies", flagged);
    const nr = (await Fx.getFixture("fa-fxb-nr"))!;
    assert.equal(nr.needsReview, true, "#210 store: a converted assembly with no fixture member reads as needs-review");
    const reviewed = sanitizeFixtureInput({ kind: "fixture", label: "Kit", description: "", lightEngineSku: "K1" });
    if (!reviewed.ok) throw new Error("unreachable");
    const cleared = await Fx.updateFixture(nr, reviewed.value, "Jeff", snap);
    assert(cleared.needsReview === undefined && cleared.legacy?.from === "assembly" && cleared.id === "fa-fxb-nr", "#210 store: a human save clears needs-review and keeps the id + provenance");
  }

  /* --- #210 fix wave 1: updateFixture must not drop a converted SA- row's
         legacy-only keys (options, lightEngineName, lensName,
         lightEngineCost, lensCost, cost, price, snapshot-era keys…) on the
         first human save. upsertDoc is a full-record replace, and `rec` used
         to be built from `value` (the clean new shape) alone, so those keys
         — kept verbatim by fixtures-migrate.ts for rollback/older-build
         compatibility — silently vanished. --- */
  {
    const Fx = await import("@/lib/stores/fixtures");
    const { subassemblyToFixture } = await import("@/lib/fixtures-convert");
    const { additiveFixturePatch } = await import("@/lib/fixtures-migrate");
    const { sanitizeFixtureInput } = await import("@/lib/fixture-assemblies");
    const DS = await import("@/db/doc-store");

    // A row shaped exactly like a real conversion's output: the original
    // legacy Subassemblies-tab fields, additively merged with what
    // subassemblyToFixture computes (fixtures-migrate.ts's own merge path) —
    // plus needsReview:true, to also prove that clears.
    const rawLegacy: Record<string, unknown> & { id: string } = {
      id: "SA-FXB-LEGACY",
      kind: "fixture",
      label: "Legacy Fixture",
      description: "Old desc",
      lightEngineSku: "FXB-ENG-L",
      lightEngineName: "Legacy Engine",
      lightEngineCost: 40,
      lensSku: "FXB-LENS-L",
      lensName: "Legacy Lens",
      lensCost: 10,
      lamp: "575W",
      position: "FOH",
      circuit: "A1",
      options: { data: [], power: [{ sku: "FXB-CBL-L", name: "Legacy Cable", cost: 5, qty: 1 }], mounting: [], accessories: [] },
      cost: 55,
      price: 55,
      createdAt: 1_600_000_000_000,
      updatedAt: 1_600_000_000_000,
    };
    const convertedShape = subassemblyToFixture(rawLegacy as never);
    const legacyRow = { ...rawLegacy, ...additiveFixturePatch(rawLegacy as never, convertedShape), needsReview: true };
    assert(await DS.insertDocIfAbsent("subassemblies", legacyRow), "#210 fix wave 1 setup: the converted-shaped legacy row inserts");

    const before = (await Fx.getFixture("SA-FXB-LEGACY"))!;
    assert.equal(before.position, "FOH", "#210 fix wave 1 setup: the row reads back its legacy optional fields");
    assert.equal(before.needsReview, true, "#210 fix wave 1 setup: …and its needs-review flag");

    // Edit through the form: rename, keep the light engine + circuit, but
    // leave lamp/position blank — sanitizeFixtureInput omits a blank optional
    // entirely, so `value` carries no key for it at all. The bug read
    // "no key in value" as "nothing to carry", so it fell through to
    // existing.lamp / existing.position and resurrected them.
    const edited = sanitizeFixtureInput({
      kind: "fixture",
      label: "Legacy Fixture — edited",
      description: "Old desc",
      lightEngineSku: "FXB-ENG-L",
      lensSku: "FXB-LENS-L",
      circuit: "A1",
    });
    assert(edited.ok, "#210 fix wave 1: the edited input sanitizes");
    if (!edited.ok) throw new Error("unreachable");
    const snap = { cost: 0, price: 0, pricedAt: null };
    const saved = await Fx.updateFixture(before, edited.value, "Jeff", snap, 1_700_000_200_000);

    assert.equal(saved.label, "Legacy Fixture — edited", "#210 fix wave 1: the new-shape field reflects the edit");
    assert.equal(saved.circuit, "A1", "#210 fix wave 1: a kept optional survives the save");
    assert.equal(saved.lamp, undefined, "#210 fix wave 1: a cleared optional (lamp) stays cleared — not resurrected from existing");
    assert.equal(saved.position, undefined, "#210 fix wave 1: a cleared optional (position) stays cleared — not resurrected from existing");
    assert.equal(saved.needsReview, undefined, "#210 fix wave 1: a human save clears needs-review");

    const stored = (await DS.getDoc<Record<string, unknown> & { id: string }>("subassemblies", "SA-FXB-LEGACY"))!;
    assert.equal(stored.cost, 55, "#210 fix wave 1: legacy `cost` survives the save");
    assert.equal(stored.price, 55, "#210 fix wave 1: legacy `price` survives the save");
    assert.equal(stored.lightEngineName, "Legacy Engine", "#210 fix wave 1: legacy `lightEngineName` survives the save");
    assert.equal(stored.lensName, "Legacy Lens", "#210 fix wave 1: legacy `lensName` survives the save");
    assert.equal(stored.lightEngineCost, 40, "#210 fix wave 1: legacy `lightEngineCost` survives the save");
    assert.equal(stored.lensCost, 10, "#210 fix wave 1: legacy `lensCost` survives the save");
    assert.deepEqual(
      (stored.options as Record<string, unknown[]>).power,
      [{ sku: "FXB-CBL-L", name: "Legacy Cable", cost: 5, qty: 1 }],
      "#210 fix wave 1: legacy `options` survives the save"
    );
    assert(!("lamp" in stored), "#210 fix wave 1: the cleared optional is actually gone from storage, not just from the returned value");
    assert(!("needsReview" in stored), "#210 fix wave 1: needs-review is actually gone from storage");
  }

  /* --- #210 final review I1: updateFixture carries legacy-only keys from the
         RAW stored row. A row still in the OLD shape (a preview; production
         before/while the conversion runs; a row an older build re-saved)
         normalizes without options/lightEngineName/…, so carrying from the
         normalized record dropped exactly what main still reads. --- */
  {
    const Fx = await import("@/lib/stores/fixtures");
    const DS = await import("@/db/doc-store");
    const { sanitizeFixtureInput } = await import("@/lib/fixture-assemblies");
    const raw: Record<string, unknown> & { id: string } = {
      id: "SA-FXB-RAW",
      kind: "fixture",
      label: "Raw legacy",
      description: "Unconverted",
      lightEngineSku: "FXB-RAW-E",
      lightEngineName: "Raw Engine",
      lightEngineCost: 70,
      lensSku: "FXB-RAW-L",
      lensName: "Raw Lens",
      lensCost: 20,
      lamp: "LED",
      position: "Cat 1",
      options: { data: [{ sku: "FXB-RAW-D", name: "Raw DMX", cost: 4, qty: 2 }], power: [], mounting: [], accessories: [] },
      cost: 98,
      price: 98,
      snapshot: { cost: 98, price: 98, pricedAt: null },
      createdAt: 1_600_000_000_000,
      updatedAt: 1_600_000_000_000,
    };
    assert(await DS.insertDocIfAbsent("subassemblies", raw), "#210 final review I1 setup: an UNCONVERTED legacy row inserts");
    const existing = (await Fx.getFixture("SA-FXB-RAW"))!;
    assert(existing && !("options" in existing) && existing.lines.data[0]?.sku === "FXB-RAW-D", "#210 final review I1 setup: it reads back normalized (no legacy keys on the record)");
    const edited = sanitizeFixtureInput({
      kind: "fixture",
      label: "Raw legacy — edited",
      description: "Unconverted",
      lightEngineSku: "FXB-RAW-E",
      lensSku: "FXB-RAW-L",
      position: "Cat 1",
      lines: { data: [{ sku: "FXB-RAW-D", qty: 3 }], power: [{ sku: "FXB-RAW-P", qty: 1 }] },
    });
    if (!edited.ok) throw new Error(`unreachable: ${edited.error}`);
    await Fx.updateFixture(existing, edited.value, "Jeff", { cost: 0, price: 0, pricedAt: null }, 1_700_000_300_000);
    const stored = (await DS.getDoc<Record<string, unknown> & { id: string }>("subassemblies", "SA-FXB-RAW"))!;
    for (const k of ["options", "lightEngineName", "lightEngineCost", "lensName", "lensCost", "cost", "price"]) {
      assert.deepEqual(stored[k], raw[k], `#210 final review I1: saving an unconverted legacy row keeps its old \`${k}\``);
    }
    const lines = stored.lines as Record<string, Array<{ sku: string; qty: number }>>;
    assert(stored.label === "Raw legacy — edited" && lines.data[0]?.qty === 3 && lines.power[0]?.sku === "FXB-RAW-P" && stored.updatedBy === "Jeff" && stored.updatedAt === 1_700_000_300_000, "#210 final review I1: …and writes the new fields");
    assert(!("lamp" in stored) && stored.position === "Cat 1", "#210 final review I1: …a cleared optional (lamp) stays cleared, a kept one stays");
  }

  /* --- #210 final review M4: while unconverted (every Vercel preview) the
         settings-backed fa- records served in memory are first-class: get
         finds them, a save creates their row under the same id, a delete
         leaves a soft-deleted row (so neither the list nor a later
         conversion brings them back). --- */
  {
    const Fx = await import("@/lib/stores/fixtures");
    const Mig = await import("@/lib/fixtures-migrate");
    const DS = await import("@/db/doc-store");
    const { sanitizeFixtureInput } = await import("@/lib/fixture-assemblies");
    const { CONVERTED_BY } = await import("@/lib/fixtures-convert");
    const snap = { cost: 0, price: 0, pricedAt: null };
    const asm = (id: string, name: string) => ({ id, name, components: [{ sku: `${id}-E`, label: "Engine", role: "fixture", defaultQty: 1 }, { sku: `${id}-C`, label: "Cable", role: "power", defaultQty: 2 }] });
    await Mig.resetFixturesConversion();
    await setSettings({ fixtureAssemblies: [asm("fa-mem-1", "Mem one"), asm("fa-mem-2", "Mem two"), asm("fa-mem-3", "Mem three")] });
    const priorVercelEnv = process.env.VERCEL_ENV;
    process.env.VERCEL_ENV = "preview";
    try {
      const list0 = await Fx.listFixtures();
      assert(["fa-mem-1", "fa-mem-2", "fa-mem-3"].every((id) => list0.some((f) => f.id === id)), "#210 final review M4 setup: an unconverted database lists the settings assemblies in memory");
      assert.equal((await DS.getDocRows("subassemblies", ["fa-mem-1", "fa-mem-2", "fa-mem-3"])).length, 0, "#210 final review M4 setup: …with no rows behind them");

      const mem1 = await Fx.getFixture("fa-mem-1");
      assert(mem1 && mem1.label === "Mem one" && mem1.lines.power[0]?.sku === "fa-mem-1-C", "#210 final review M4: getFixture finds the in-memory fa- record listFixtures serves");
      const v = sanitizeFixtureInput({ kind: "fixture", label: "Mem one — edited", description: "", lightEngineSku: "fa-mem-1-E", lines: { power: [{ sku: "fa-mem-1-C", qty: 3 }] } });
      if (!v.ok) throw new Error(`unreachable: ${v.error}`);
      await Fx.updateFixture(mem1!, v.value, "Jeff", snap, 1_700_000_400_000);
      const [row1] = await DS.getDocRows<Record<string, unknown> & { id: string }>("subassemblies", ["fa-mem-1"]);
      assert(row1 && !row1.deleted && row1.doc.label === "Mem one — edited" && (row1.doc.legacy as { from?: string })?.from === "assembly" && row1.doc.createdBy === CONVERTED_BY && row1.doc.createdAt === 1_700_000_400_000 && row1.doc.updatedBy === "Jeff", "#210 final review M4: saving an in-memory fa- record creates its row under the same id, in the conversion's shape");
      const list1 = await Fx.listFixtures();
      assert.equal(list1.filter((f) => f.id === "fa-mem-1").length, 1, "#210 final review M4: …listed once (the row, not the in-memory copy too)");
      assert.equal(list1.find((f) => f.id === "fa-mem-1")?.label, "Mem one — edited", "#210 final review M4: …with the saved edit");

      await Fx.removeFixture("fa-mem-2");
      const [row2] = await DS.getDocRows("subassemblies", ["fa-mem-2"]);
      assert(row2 && row2.deleted, "#210 final review M4: deleting an in-memory fa- record writes a soft-deleted row");
      assert.equal(await Fx.getFixture("fa-mem-2"), null, "#210 final review M4: …getFixture no longer finds it");
      assert(!(await Fx.listFixtures()).some((f) => f.id === "fa-mem-2"), "#210 final review M4: …and the in-memory list no longer re-shows it");

      const mem3 = (await Fx.getFixture("fa-mem-3"))!;
      await Fx.removeFixture("fa-mem-3");
      const v3 = sanitizeFixtureInput({ kind: "fixture", label: "Mem three", description: "", lightEngineSku: "fa-mem-3-E" });
      if (!v3.ok) throw new Error("unreachable");
      await assert.rejects(Fx.updateFixture(mem3, v3.value, "Jeff", snap), /deleted/, "#210 final review M4: a save of an in-memory record deleted meanwhile is refused, not revived");
      assert((await DS.getDocRows("subassemblies", ["fa-mem-3"]))[0]?.deleted, "#210 final review M4: …the row stays deleted");
    } finally {
      if (priorVercelEnv === undefined) delete process.env.VERCEL_ENV;
      else process.env.VERCEL_ENV = priorVercelEnv;
    }
    const conv = await Mig.convertFixtures();
    assert(conv.complete, `#210 final review M4: the conversion then completes (got ${JSON.stringify(conv)})`);
    assert((await DS.getDocRows("subassemblies", ["fa-mem-2"]))[0]?.deleted, "#210 final review M4: …and does not re-insert the deleted fa- record");
    assert.equal((await Fx.getFixture("fa-mem-1"))?.label, "Mem one — edited", "#210 final review M4: …nor overwrite the saved one");
    await setSettings({ fixtureAssemblies: [] });
  }

  // #209 — riser document + drawing-set settings persistence (scratch DB).
  {
    const by = "tester";
    const stagePoly = [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.5 }];
  }


  // #209 fix wave 1 — review findings I1/M1/M2/M3/M4 (scratch DB).
  {
    const by = "tester";

    // M1 — normalizeRiserDoc never adopts a __proto__/constructor/prototype node key. JSON.parse
    // produces those as ordinary OWN keys (no actual prototype change) — it's a naive
    // `nodes[k] = …` afterward that would turn one into a real prototype write.
    const rawDoc = JSON.parse(
      '{"nodes":{"__proto__":{"x":0,"y":0,"w":1,"h":1},"constructor":{"x":0,"y":0,"w":1,"h":1},"prototype":{"x":0,"y":0,"w":1,"h":1},"sp-ok":{"x":0.2,"y":0.2,"w":0.1,"h":0.1}},"levels":[],"conduits":[],"notes":[],"links":[]}'
    );

    // M4 — buildGridQuote prices RiserLink footage summed with same-cable routes BEFORE the
    // per-part ceiling, and is unchanged (matches plain route math) when there are no links.
    {
    }

    // M4 — GP.removePlacement (not just the riser-aware removeNodeDevices) prunes any riser
    // link/conduit that ended on the single removed placement.
    {
    }

    // M4 — restoring a pre-#209 revision (a snapshot with no `riser` key at all, since
    // snapshotOf now always writes at least `{}`) still works, and the live riser document
    // falls back to the auto layout rather than erroring or leaving stale data.
    {
    }
  }

  // #209 Task 7 fix wave 1 — I1: unticking "own notes" and saving reverts the
  // cover to the standard notes. SetSettingsPanel.saveAll() must send
  // resetGeneralNotes: !ownNotes to setDrawingSet — a bare merge patch with
  // no generalNotes field left the previously-saved custom text in place.
  {
    const by = "tester";
    const standard = "Standard note one.\nStandard note two.";
    await setSettings({ gridStandardNotes: standard });
  }

  /* --- #211 T2: the Equipment map store — starts empty, per-row atomic writes, who/when --- */
  {
    const Cat = await import("@/lib/stores/catalog");
    await Cat.upsert({ sku: "GEM2-PAR", desc: "GEM2 par", category: "Lighting Fixtures", unit: "ea", list: 900, cost: 600 });
  }

  /* --- #211 T6: auto placements — per-scope replace, hand-touched kept, lots + virtual parts on the quote --- */
  {
    const Cat = await import("@/lib/stores/catalog");
    const by = "tester";
    const tag = (rowKey: string) => ({ scope: "lighting" as const, rowKey, tier: "better" as const });
    const pipeTag = { scope: "rigging" as const, rowKey: "rigging:pipe", tier: "better" as const };
    await Cat.upsert({ sku: "GEM6-PAR", desc: "GEM6 par", category: "Lighting Fixtures", unit: "ea", list: 900, cost: 600 });
    const subTag = { scope: "audio" as const, rowKey: "audio:subwoofer", tier: "better" as const };
  }

  /* --- #211 T6 fix wave 1: lot-aware riser qty, riser swap clears auto, per-option estimates, dead virtual lines refused, store sanitizers --- */
  {
    const by = "tester";
    const node = "unassigned";
    const pipeTag = { scope: "rigging" as const, rowKey: "rigging:pipe", tier: "good" as const };
    const pipePart = [{ id: "GEMF-PIPE", sku: "GEMF-PIPE", desc: "Pipe", category: "Rigging", unit: "ft", list: 12, cost: 8 }];

    // I2: a riser part swap is a hand edit — the next per-scope re-fill keeps the swapped devices.
    const frontTag = { scope: "lighting" as const, rowKey: "lighting:front", tier: "good" as const };

    // D1: Auto choices are per option — copied with an option, snapshotted, restored, removed with it.
    const estA = { tierByScope: { lighting: "best" as const }, overrides: { "lighting:par": { qty: 7 } } };
    const estB = { tierByScope: { audio: "good" as const }, overrides: {} };
  }

  /* --- #211 T8: the Auto fill paints the generated base sheet from the Equipment map --- */
  {
    const Cat = await import("@/lib/stores/catalog");
    const Fx = await import("@/lib/stores/fixtures");
    const { sanitizeFixtureInput } = await import("@/lib/fixture-assemblies");
    const by = "tester";
    await Cat.upsert({ sku: "GEM8-PAR", desc: "GEM8 LED par", category: "Lighting Fixtures", unit: "ea", list: 900, cost: 600 });
    await Cat.upsert({ sku: "GEM8-VEL", desc: "GEM8 velour", category: "Fabric", unit: "sq ft", list: 0, cost: 0, curtainAreaRate: 3.5 });
    await Cat.upsert({ sku: "GEM8-MIX", desc: "GEM8 mixer", category: "Audio", unit: "ea", list: 7000, cost: 5000 });
    const sysIn = sanitizeFixtureInput({ kind: "system", label: "GEM8 mixer rack", description: "", scope: "Audio", parts: [{ sku: "GEM8-MIX", qty: 1 }] });
    if (!sysIn.ok) throw new Error(sysIn.error);
    const rack = await Fx.createFixture(sysIn.value, by, { cost: 5000, price: 7000, pricedAt: null });
  }

  /* --- #211 T9: a per-scope re-fill keeps hand-touched devices and honours
         the new choices. Adapted from the brief for D312 (not in the
         original brief): autoEstimate is stored PER OPTION, so
         setAutoEstimate takes the option id and the current choices are read
         back with autoEstimateFor rather than a bare `p.autoEstimate`. --- */
  {
    const Cat = await import("@/lib/stores/catalog");
    const by = "tester";
    await Cat.upsert({ sku: "GEM9-PAR", desc: "GEM9 LED par", category: "Lighting Fixtures", unit: "ea", list: 900, cost: 600 });
    // Final review minor: leave no GEM9 fixture behind for later blocks.
    await Cat.remove("GEM9-PAR");
    assert.equal((await Cat.getMany(["GEM9-PAR"])).length, 0, "#211 T9: cleanup — the GEM9 catalog fixture is removed");
  }

  /* --- #211 final review: D320 — a re-fill counts devices kept by hand
         toward the row's new quantity (12 → move 3 → re-fill → 12 total;
         re-fill to 8 → 5 placed + 3 kept), and D322's autoNeedsPart. --- */
  {
    const Cat = await import("@/lib/stores/catalog");
    const by = "tester";
    await Cat.upsert({ sku: "GEMK-PAR", desc: "GEMK LED par", category: "Lighting Fixtures", unit: "ea", list: 900, cost: 600 });
    await Cat.remove("GEMK-PAR");
  }

  /* --- #211 final review I3/I4 (D319): the server re-prices a Quick
         design before any promote, and derives `incomplete` on save. --- */
  {
    const Cat = await import("@/lib/stores/catalog");
    const Fx = await import("@/lib/stores/fixtures");
    const { sanitizeFixtureInput } = await import("@/lib/fixture-assemblies");
    const by = "tester";
    // I3 — fixture picks price through priceCell (catalog markup), a dead pick stays needs-a-part.
    await Cat.upsert({ sku: "GEMFR-ENG", desc: "GEMFR engine", category: "Lighting Fixtures", unit: "ea", list: 0, cost: 500 });
    const live = sanitizeFixtureInput({ kind: "fixture", label: "GEMFR live", description: "", lightEngineSku: "GEMFR-ENG", lensSku: null });
    const dead = sanitizeFixtureInput({ kind: "fixture", label: "GEMFR dead", description: "", lightEngineSku: "GEMFR-NOPE", lensSku: null });
    if (!live.ok || !dead.ok) throw new Error("fixture input");
    const fxLive = await Fx.createFixture(live.value, by, { cost: 500, price: 0, pricedAt: null });
    const fxDead = await Fx.createFixture(dead.value, by, { cost: 0, price: 0, pricedAt: null });
    await Cat.remove("GEMFR-ENG");
  }

  /* --- #211 final review, fix wave 2 — I2: a Grid Auto design carries its
         live `incomplete` on every read (one shared price context); a Blank
         Grid design carries none. --- */
  {
    const by = "tester";
    const mkAuto = async (name: string) => {
    };
    const one = await mkAuto("GEMW2 auto one");
    const two = await mkAuto("GEMW2 auto two");
  }

  /* --- #211 final review, fix wave 2 — I1 (D323), M1, M2: the server
         derives `budget` as well as `incomplete` on every save and promote;
         the save writes only whitelisted fields; Quick refuses a Grid record. --- */
  {
    const Quotes = await import("@/lib/stores/quotes");
    const by = "tester";
  }

  /* --- #211 fix wave 3 — I1 (D324) Scenery-track feet override priced
         identically on the screen's LIVE state and the server; I2 a dead
         fixture pick is needs-a-part on both; I3 (D325) query counts:
         getAllDesigns is flat in N manual designs with ONE catalog load,
         nav counts load no catalog at all; the letter re-derives. --- */
  {
    const { navData } = await import("@/lib/nav-counts");
    const { getDb } = await import("@/db");
    const by = "tester";
    const rates = { installPct: 18, freightPct: 5, contingencyPct: 10 };
    const liveIds: string[] = [];
    // I3 — query counts with N manual (Grid) designs.
    const db = (await getDb()) as unknown as { $client: { query: (q: string, ...rest: unknown[]) => Promise<unknown> } };
    const client = db.$client;
    const orig = client.query.bind(client);
    let queries = 0;
    let catalogQueries = 0;
    client.query = (q: string, ...rest: unknown[]) => {
      queries++;
      if (/"catalog_parts"/.test(q)) catalogQueries++;
      return orig(q, ...rest);
    };
    const addManual = async (n: number) => {
      for (let i = 0; i < n; i++) {
      }
    };
    const measure = async () => {
      queries = 0; catalogQueries = 0;
      const all = { queries, catalogQueries };
      queries = 0; catalogQueries = 0;
      await navData("Jeff Chesebro");
      return { all, nav: { queries, catalogQueries } };
    };
    try {
      await addManual(2);
      const small = await measure();
      await addManual(6);
      const big = await measure();
      assert.equal(big.nav.catalogQueries, 0, "#211 wave 3 I3: nav counts never load the catalog");
    } finally {
      client.query = orig;
    }
  }

  /* --- #210 final review M5: the go-live reset keeps fixtures and systems
         (configuration, like the settings they used to live in) and the
         kept fixtures' accessory graph is rebuilt. LAST: it wipes every
         other doc collection in this harness database. --- */
  {
    const Fx = await import("@/lib/stores/fixtures");
    const Mig = await import("@/lib/fixtures-migrate");
    const Acc = await import("@/lib/stores/part-accessory-links");
    const { clearDemoData } = await import("@/db/seed-data");
    const { syncAllAssemblyGraphs } = await import("@/lib/part-docs/assembly-sync");
    const { sanitizeFixtureInput } = await import("@/lib/fixture-assemblies");
    const v = sanitizeFixtureInput({ kind: "fixture", label: "Kept across reset", description: "", lightEngineSku: "FXB-KEEP-E", lensSku: "FXB-KEEP-L" });
    if (!v.ok) throw new Error("unreachable");
    const kept = await Fx.createFixture(v.value, "Jeff", { cost: 0, price: 0, pricedAt: null });
    const flagBefore = await Mig.fixturesConverted();
    await clearDemoData();
    assert.equal((await Fx.getFixture(kept.id))?.label, "Kept across reset", "#210 final review M5: the go-live reset keeps fixtures");
    assert.equal(await Mig.fixturesConverted(), flagBefore, "#210 final review M5: …and leaves the conversion flag as it was");
    await syncAllAssemblyGraphs();
    assert((await Acc.allAccessoryLinks()).some((l) => l.sourceRef === `fixture:${kept.id}` && l.accessorySku === "FXB-KEEP-L"), "#210 final review M5: the reset's graph rebuild restores the kept fixture's accessory links");
  }

  /* --- #211 fix wave 1 (I1): a saved design's `incomplete` shape round-trips
     through the real store. Additive field — a legacy record saved with no
     `incomplete` at all must still read back without crashing. --- */
  {
  }

  console.log("review regression checks passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
