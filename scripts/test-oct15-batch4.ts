/* Jeff's 2026-10-15 decisions — Batch 4 (Grid, specs, catalog) harness checks
   (docs/decisions/2026-10-15-jeff-decisions.md items 32, 43, 45, 46, 47).
   `batch4PureChecks` needs no database; `batch4DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-oct15-batch4.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { effectivePriceDate, priceBooks } from "../src/lib/catalog-books";
import { pricesAsOf } from "../src/lib/fixture-assemblies";
import { catalogEffectiveAtFor } from "../src/lib/vendor-status";

const ROOT = join(__dirname, "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");
const DAY = 86400000;

/* --- #32 partial price files: per-part priceDate --- */
function priceDateChecks(ok: Ok) {
  const now = Date.UTC(2026, 9, 15);
  const old = now - 400 * DAY;
  const fresh = now - 2 * DAY;
  const book = { priceListEffective: { acme: old } };
  ok(effectivePriceDate({ mfr: "Acme", priceDate: fresh }, book) === fresh, "#32: a part's own priceDate beats an older book date");
  ok(effectivePriceDate({ mfr: "Acme" }, book) === old, "#32: a part with no per-part date falls back to the manufacturer's book date");
  ok(effectivePriceDate({ mfr: "Acme", pricedAt: fresh, priceDate: old }, {}) === fresh, "#32: the latest of pricedAt and priceDate wins");
  ok(effectivePriceDate({ mfr: "Acme", priceDate: old }, { priceListEffective: { acme: fresh } }) === fresh, "#32: a later by-hand book date still confirms every line");
  ok(effectivePriceDate({ mfr: "Zed", priceDate: Number.NaN }, {}) === null, "#32: an invalid priceDate dates nothing");
  // A partial file dated only A; B keeps the old book date. Builders show the newest; the price book the oldest.
  const parts = [
    { sku: "A", mfr: "Acme", priceDate: fresh },
    { sku: "B", mfr: "Acme" },
  ];
  ok(pricesAsOf(["A", "B"], parts, book) === fresh, "#32 / item 33: a builder's 'prices as of' shows the newest per-part date");
  const [row] = priceBooks(parts, book, { now });
  ok(row.effectiveAt === old && row.count === 2, "#32: the price book's oldest date reads the per-part dates (B's old book date)");
  const [row2] = priceBooks([{ mfr: "Acme", priceDate: fresh }, { mfr: "Acme" }], {}, { now });
  ok(row2.effectiveAt === null && row2.unknown, "#32: a part no file listed and no book date covers keeps the book Unknown");
  ok(catalogEffectiveAtFor(parts, ["Acme"], book) === fresh, "#32: the vendor 'Catalog priced' date reads the newest per-part date");
  const imp = src("src/app/(app)/catalog/import.ts");
  ok(!imp.includes("setPriceListEffective"), "#32: the Catalog page importer no longer re-dates the manufacturer's book");
  ok(/priced \? \{ priceDate: input\.effectiveAt \}/.test(imp), "#32: …it stamps priceDate on each row of a priced file");
  const hub = src("src/app/(app)/import/catalog-commit.ts");
  ok(!hub.includes("setPriceListEffective"), "#32: the Import hub no longer re-dates the manufacturer's book");
  const reg = src("src/app/(app)/import/registry.ts");
  ok((reg.match(/ctx\.priced \? \{ priceDate: ctx\.effectiveAt \}/g) || []).length === 2, "#32: both hub catalog write paths (create, update) stamp priceDate");
}

async function priceDateDbChecks(ok: Ok) {
  const Catalog = await import("../src/lib/stores/catalog");
  const D1 = Date.UTC(2026, 0, 15, 18);
  const D2 = Date.UTC(2026, 5, 1, 17);
  const base = { desc: "Batch4 date part", category: "Test", unit: "ea", list: 10, cost: 5, mfr: "B4 Dating" };
  await Catalog.mergeUpsert("B4-PD-1", base, { pricedAt: D1, priceDate: D1 });
  ok((await Catalog.get("B4-PD-1"))?.priceDate === D1, "#32 store: an import write stamps priceDate");
  await Catalog.mergeUpsert("B4-PD-1", { desc: "renamed by hand" });
  ok((await Catalog.get("B4-PD-1"))?.priceDate === D1, "#32 store: a non-import write keeps the stored priceDate");
  const full = (await Catalog.get("B4-PD-1"))!;
  const { priceDate: _drop, ...noDate } = full;
  void _drop;
  await Catalog.upsert(noDate);
  ok((await Catalog.get("B4-PD-1"))?.priceDate === D1, "#32 store: a full replace that dropped priceDate gets it back");
  await Catalog.mergeUpsert("B4-PD-1", { list: 10 }, { pricedAt: D2, priceDate: D2 });
  const after = await Catalog.get("B4-PD-1");
  ok(after?.priceDate === D2 && after.pricedAt === D1, "#32 store: an unchanged price in a newer file moves priceDate, not pricedAt");
}

export async function batch4PureChecks(ok: Ok) {
  priceDateChecks(ok);
}

export async function batch4DbChecks(ok: Ok) {
  await priceDateDbChecks(ok);
}

if (process.argv[1]?.endsWith("test-oct15-batch4.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  batch4PureChecks(okf)
    .then(() => (db ? batch4DbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
