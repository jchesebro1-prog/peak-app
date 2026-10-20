# Parts list (CSV) v2 + BOM quote PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Estimator's More ▾ → Parts list (CSV) prints Item name, Description, cost, sell, Line margin, Effective margin and Price source on every row (Task 1). Build package → BOM quote gains Download PDF / Open PDF ↗ for the saved estimate's BOM view (Task 2).

**Architecture:** This is a pure change to one module, `src/app/(app)/estimator/parts-csv.ts`. Each `PartsListRow` gains `source` (a label derived from the flags the estimate line already carries) and `lineSell` (unit sell before the system's freight/rounding factor `k`). `source` joins the consolidation key. The CSV writer prints the 12-column header and formats the margins. Task 1 has no server, store, migration or UI change; the caller in `use-estimator-state.ts` already passes `PARTS_CSV_HEADER` and `partsListCsvRows(rows)` through untouched. Task 2 copies the Cover PDF (#301): a `view=bom` mode on the existing signed `/print/quote/[id]` page, a `renderBomPdf` helper, and a staff `GET /api/quotes/[id]/bom-pdf` route linked from the BOM tab. There's no migration and nothing stored.

**Tech Stack:** TypeScript, Next.js 16 app (client-side CSV via `downloadCsv`), spec harness `scripts/test-review-and-spec.ts` run with `tsx`.

**Specs:** `docs/superpowers/specs/2026-10-20-parts-list-csv-price-source-design.md` (Task 1), `docs/superpowers/specs/2026-10-20-bom-quote-pdf-design.md` (Task 2)

## Global Constraints

- Header, exactly, in order: `Manufacturer, Item name, Description, Room, System, Qty, Unit Cost, Unit Sell, Line margin, Effective margin, Price source, Notes`.
- Item name = today's model rule (`modelNumber`), else the SKU, else blank.
- Margins print as a percent with one decimal (`35.0%`) and print negative when negative (`-25.0%`). They're blank when the relevant sell is 0, and on cost-adjustment rows.
- Price-source labels, verbatim: `Vendor quote — <vendor>` (+ ` #<quoteNumber>` when present), `Adjustment`, `Catalog`, `Price on request`, `Allowance`, `Curtain calculator`, `Custom`, `Catalog — sell edited`, `Not in catalog`. The dash is an em dash `—`.
- Unchanged invariants: Σ qty × Unit Cost = material cost. Per system, Σ qty × Unit Sell = the system price less labor lines' share.
- Unchanged row set: labor, options, alternates, bonus lines and the Rewards credit stay out. Assemblies and vendor quotes still explode.
- No new `SpecItem` field, no migration, no AI.
- BOM PDF: renders the SAVED estimate only. File `<number> BOM.pdf`. Copy, verbatim: `Download PDF`, `Open PDF ↗`, `Save first — the PDF prints the saved estimate.`, `Save to create the PDF.` Never stored, never attached to a send, never in the portal or client link. The BOM tab must import nothing from `@/lib/stores/`.
- The dev DB is single-process. `npm run test:specs` uses its own temp datadir, so it's safe. Never run another `tsx` db script alongside it, and check `ps aux | grep tsx` first.

---

### Task 1: Price source, line sell and the 12-column CSV

**Files:**
- Modify: `src/app/(app)/estimator/parts-csv.ts` (whole file — full content below)
- Test: `scripts/test-review-and-spec.ts` (the `#262` block, ~lines 37267–37352)

**Interfaces:**
- Consumes: `lineExtSellOf`, `systemItemsRev`, `systemSellTotal` from `./pricing`. `lineModel`, `partModel` from `@/lib/catalog-rename/sku`. `SpecItem`, `SpecSection`, `VendorQuote` from `./types` (all existing).
- Produces:
  - `PartsListRow` gains `lineSell: number` and `source: string`.
  - `PARTS_CSV_HEADER: string[]` (12 columns).
  - `partsListCsvRows(rows: PartsListRow[]): (string | number)[][]` — 12 cells per row.
  - `partsListRows` and `partsListSkus` keep their signatures.

- [ ] **Step 1: Update the existing #262 assertions that pin the old layout**

In `scripts/test-review-and-spec.ts`, inside the `#262` block, replace the header assertion:

```ts
  ok(p262Header.join(",") === "Manufacturer,Model number,Room,System,Qty,Unit Cost,Unit Sell,Description,Notes", "#262 parts list: the CSV header is Jeff's nine columns, in order");
```

with:

```ts
  ok(p262Header.join(",") === "Manufacturer,Item name,Description,Room,System,Qty,Unit Cost,Unit Sell,Line margin,Effective margin,Price source,Notes", "#262 v2 parts list: the CSV header is the twelve columns, in order");
```

Replace the CSV-row assertion:

```ts
  ok(csv[1].join("|") === "Altman|C-CLAMP-PN|Stage|Lighting|8|10.00|20.00|Clamp|Part of: Cyc light, Wash", "#262 parts list: a CSV row prints Jeff's columns, cents, and \"Part of:\" in Notes");
  ok(csv.find((r) => r[7] === "Plain one")![8] === "Hang on 1st elec" && csv.find((r) => r[7] === "Cable")![8] === "per ft", "#262 parts list: the internal note (trimmed) and a non-ea unit (\"per ft\") land in Notes");
```

with:

```ts
  ok(csv[1].join("|") === "Altman|C-CLAMP-PN|Clamp|Stage|Lighting|8|10.00|20.00|50.0%|50.0%|Catalog|Part of: Cyc light, Wash", "#262 v2 parts list: a CSV row prints the twelve columns, cents, margins, source and \"Part of:\" in Notes");
  ok(csv.find((r) => r[2] === "Plain one")?.[11] === "Hang on 1st elec" && csv.find((r) => r[2] === "Cable")?.[11] === "per ft", "#262 parts list: the internal note (trimmed) and a non-ea unit (\"per ft\") land in Notes");
```

- [ ] **Step 2: Add the new v2 assertions at the end of the #262 block**

Insert immediately before the block's closing `}` (directly after the `p262Skus(sections)` assertion):

```ts
  // --- v2 (2026-10-20 spec): Item name, Line / Effective margin, Price source ---
  ok(rows.map((r) => r.source).join("|") === "Catalog|Catalog|Adjustment|Catalog|Not in catalog|Not in catalog|Catalog|Vendor quote — Acme #Q-77|Vendor quote — Acme #Q-77|Not in catalog|Not in catalog|Catalog", "#262 v2 parts list: components and catalog SKUs say Catalog, vendor lines name the vendor + quote #, cost-adjustment rows say Adjustment, unresolved SKUs (and a missing vendor quote) say Not in catalog");
  ok(lamp.lineSell === 200 && clamp.lineSell === 20 && truss.lineSell === 100, "#262 v2 parts list: lineSell is the allocated unit sell before the system factor (LAMP 200, CLAMP 20, truss 100)");
  ok(csv.find((r) => r[2] === "Mystery part")?.[1] === "UNKNOWN-9" && csv.find((r) => r[2] === "Source Four 750W")?.[1] === "S4-750" && csv.find((r) => r[2] === "Base plate")?.[1] === "", "#262 v2 parts list: Item name is the model number, else the SKU, else blank");
  const adjCsv = csv.find((r) => String(r[2]).startsWith("Cost adjustment — Wash"));
  ok(adjCsv?.[8] === "" && adjCsv?.[9] === "" && adjCsv?.[10] === "Adjustment", "#262 v2 parts list: a cost-adjustment row prints no margins");

  const srcInfo: Record<string, P262Info> = { CAT: { mfr: "ETC" }, CAT2: { mfr: "ETC" }, CAT3: { mfr: "ETC" }, DUP: { mfr: "ETC" } };
  const srcSec: P262Section = { id: "s5", name: "Sources", kind: "materials", mfr: "", freightPct: 0, items: [
    it(1, "POR-1", "Customer asked", 1, 0, { por: true, price: 0 }),
    it(2, "", "Rigging allowance", 1, 500, { allowance: true }),
    it(3, "", "Main drape", 1, 800, { curtain: true }),
    it(4, "CUSTOM", "Custom bracket", 2, 30, { custom: true }),
    it(5, "CAT", "Catalog plain", 1, 40),
    it(6, "CAT2", "Catalog typed unit sell", 1, 40, { sellOverride: true, price: 100 }),
    it(7, "CAT3", "Catalog typed ext sell", 2, 40, { extSellOverride: 150 }),
    it(8, "DUP", "Dup part", 1, 10),
    it(9, "DUP", "Dup part", 1, 10, { custom: true }),
    it(10, "", "Bolt pipe", 1, 60, { vendorQuoteId: "VQ-2" }),
  ] };
  const vq2: P262Vq = { id: "VQ-2", vendor: "Bolt", quoteNumber: "", description: "", terms: "", notes: "", total: 60, includesFreight: false, display: "single",
    lines: [{ id: 1, description: "Pipe", qty: 2, unit: "ea", amount: 60 }] };
  const srcRows = p262Rows([srcSec], [vq2], srcInfo);
  const srcCsv = p262Csv(srcRows);
  ok(srcRows.map((r) => r.source).join("|") === "Price on request|Allowance|Curtain calculator|Custom|Catalog|Catalog — sell edited|Catalog — sell edited|Catalog|Custom|Vendor quote — Bolt", "#262 v2 parts list: POR, allowance, curtain, custom, catalog, a typed unit sell, a typed extended sell, and a vendor quote with no number each get their label");
  ok(srcRows.filter((r) => r.sku === "DUP").map((r) => `${r.source}:${r.qty}`).join("|") === "Catalog:1|Custom:1", "#262 v2 parts list: the same part as a catalog line and as a custom line stays two rows (source is in the merge key)");
  const sc = (desc: string) => srcCsv.find((r) => r[2] === desc);
  ok(sc("Catalog plain")?.[8] === "50.0%" && sc("Catalog plain")?.[9] === "50.0%", "#262 v2 parts list: with no freight or rounding, Line margin = Effective margin (80 sell / 40 cost → 50.0%)");
  ok(sc("Catalog typed unit sell")?.[8] === "60.0%" && sc("Catalog typed ext sell")?.[8] === "46.7%", "#262 v2 parts list: margins follow a typed unit sell (100 → 60.0%) and a typed extended sell (150 / 2 = 75 → 46.7%)");
  ok(sc("Customer asked")?.[8] === "" && sc("Customer asked")?.[9] === "", "#262 v2 parts list: a zero-sell row prints blank margins");

  const typed = p262Rows([{ id: "s6", name: "Typed", kind: "materials", mfr: "", freightPct: 0, sellOverride: 125, items: [it(1, "CAT", "Catalog plain", 1, 50, { price: 100 })] }], [], srcInfo);
  const typedCsv = p262Csv(typed);
  ok(typed[0]?.lineSell === 100 && typedCsv[0][7] === "125.00" && typedCsv[0][8] === "50.0%" && typedCsv[0][9] === "60.0%", "#262 v2 parts list: a typed system sell lifts Unit Sell and the Effective margin (60.0%) but not the Line margin (50.0%)");
  const below = p262Csv(p262Rows([{ id: "s7", name: "Below", kind: "materials", mfr: "", freightPct: 0, items: [it(1, "CAT", "Below cost", 1, 50, { price: 40 })] }], [], srcInfo));
  ok(below[0][8] === "-25.0%" && below[0][9] === "-25.0%", "#262 v2 parts list: a below-cost line prints a negative margin");
  ok(srcCsv.every((r) => r.length === 12) && csv.every((r) => r.length === 12), "#262 v2 parts list: every CSV row has twelve cells");
```

- [ ] **Step 3: Run the spec harness and confirm the new assertions fail**

Run: `ps aux | grep -c "[t]sx"` (expect `0`; stop any stray `tsx` first), then:

```bash
npm run test:specs 2>&1 | grep -E "#262" | grep -E "^FAIL"
```

Expected: FAIL lines for the `#262 v2` assertions, plus the updated header and CSV-row assertions. Before the change, `r.source` and `r.lineSell` are `undefined` and the header is nine columns. `tsx` doesn't type-check, so the missing fields fail at runtime rather than at compile. Every new lookup uses `?.`, so the old layout fails the assertions instead of throwing.

- [ ] **Step 4: Replace `src/app/(app)/estimator/parts-csv.ts` with the v2 module**

Full file content:

```ts
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import { lineModel, partModel } from "@/lib/catalog-rename/sku";
import { lineExtSellOf, systemItemsRev, systemSellTotal } from "./pricing";
import type { SpecItem, SpecSection, VendorQuote } from "./types";
import { isBonusItem } from "@/lib/estimate-bonus/flags";

/** The Estimator's "Parts list (CSV)" export for the project manager (#262) —
 *  every orderable part in the estimate's material systems, assemblies
 *  exploded into their components, vendor quotes into their lines, identical
 *  parts consolidated per room + system. Σ qty × Unit Cost equals the
 *  estimate's material cost; per system, Σ qty × Unit Sell equals the
 *  system's price including freight (typed, or rounded up to $25; exact for
 *  a legacy system) less any labor lines' share (#276, #279) — freight has
 *  no row of its own but is carried in the parts' sell.
 *  v2 (2026-10-20 spec): every row also says where its price came from and
 *  carries its line margin (before freight) beside the effective margin.
 *  Pure: no React, no server imports. */

/** Catalog facts for one SKU, keyed by the trimmed SKU (#262). */
export type PartInfo = { mfr?: string; manufacturerPartNumber?: string; manufacturerModelNumber?: string; desc?: string };

/** One consolidated row of the parts list (#262). `unitCost`/`unitSell`/
 *  `lineSell` stay unrounded; `sku` and `unit` are kept for merging + the
 *  unit note, never printed as their own columns. `lineSell` is the unit
 *  sell before the system's freight / rounding / typed-sell factor; `source`
 *  is the Price source label (v2). */
export type PartsListRow = {
  manufacturer: string;
  modelNumber: string;
  room: string;
  system: string;
  sku: string;
  desc: string;
  qty: number;
  unit: string;
  unitCost: number;
  unitSell: number;
  lineSell: number;
  source: string;
  partOf: string[];
  notes: string[];
};

export const PARTS_CSV_HEADER: string[] = [
  "Manufacturer",
  "Item name",
  "Description",
  "Room",
  "System",
  "Qty",
  "Unit Cost",
  "Unit Sell",
  "Line margin",
  "Effective margin",
  "Price source",
  "Notes",
];

/** Price source of a cost-adjustment row (v2) — it carries no margins. */
const ADJUSTMENT = "Adjustment";

const round2 = (n: number) => Math.round(n * 100) / 100;

function infoOf(info: Record<string, PartInfo>, sku: string): PartInfo | undefined {
  return sku && Object.prototype.hasOwnProperty.call(info, sku) ? info[sku] : undefined;
}

/** Model rule (#262, #304): partModel for a known catalog part (model > P/N >
 *  the SKU's tail after `Brand:` > the SKU); "" for an unknown SKU. */
function modelFromInfo(info: Record<string, PartInfo>, sku: string): string {
  const p = infoOf(info, sku);
  if (!p) return "";
  return partModel({ sku, manufacturerModelNumber: p.manufacturerModelNumber, manufacturerPartNumber: p.manufacturerPartNumber });
}

/** Unit sell of one estimate line (#262) — a typed extended sell wins over the unit price. */
function lineSellOf(item: SpecItem): number {
  return typeof item.extSellOverride === "number" && Number.isFinite(item.extSellOverride)
    ? item.extSellOverride / item.qty
    : item.price;
}

/** Price source of a plain line — not a vendor quote, not exploded (v2 spec
 *  rules 4–9, first match wins). */
function plainSource(item: SpecItem, inCatalog: boolean): string {
  if (item.por) return "Price on request";
  if (item.allowance) return "Allowance";
  if (item.curtain) return "Curtain calculator";
  if (item.custom) return "Custom";
  if (!inCatalog) return "Not in catalog";
  const edited = item.sellOverride === true
    || (typeof item.extSellOverride === "number" && Number.isFinite(item.extSellOverride));
  return edited ? "Catalog — sell edited" : "Catalog";
}

/** Every emitted entry, in order, before consolidation (#262). */
function expand(
  sections: SpecSection[],
  vendorQuotes: VendorQuote[],
  info: Record<string, PartInfo>,
  defaultRoom = ""
): PartsListRow[] {
  const out: PartsListRow[] = [];
  for (const section of sections) {
    if (section.kind === "labor") continue;
    // Phase 2b: an Alternate group's systems are out of the base bid, like option lines
    if (section.alternate) continue;
    const room = section.room?.trim() || defaultRoom.trim();
    const system = section.name;
    // #279: every part's sell scales by the system's price (freight included) ÷ its lines' sell.
    // The bonus lines are internal and never listed; leaving their sell out of
    // `rev` makes k spread it pro rata over the other lines, the same way k
    // carries freight and a typed sell — so per system the listed parts still
    // total the system's price less the labor lines' share (header above).
    const rev = systemItemsRev(section) - section.items.filter((x) => isBonusItem(x)).reduce((a, x) => a + lineExtSellOf(x), 0);
    const k0 = rev > 0 ? Math.max(0, systemSellTotal(section)) / rev : 1;
    const k = Number.isFinite(k0) ? k0 : 1;
    const start = out.length;
    for (const item of section.items) {
      if (item.labor || item.laborOverhead || item.laborTravel || item.option || isBonusItem(item) || isRewardCreditItem(item)) continue;
      if (!Number.isFinite(item.qty) || item.qty <= 0) continue;
      const lineSell = lineSellOf(item);
      const note = item.internalNote?.trim() || "";
      const notes = note ? [note] : [];

      const vq = item.vendorQuoteId ? vendorQuotes.find((v) => v.id === item.vendorQuoteId) : undefined;
      if (vq && vq.lines.length > 0) {
        const vqName = `Vendor quote ${vq.vendor}${vq.quoteNumber ? " #" + vq.quoteNumber : ""}`;
        const vqSource = `Vendor quote — ${vq.vendor}${vq.quoteNumber ? " #" + vq.quoteNumber : ""}`;
        let linesTotal = 0;
        for (const line of vq.lines) if (line.qty > 0) linesTotal += line.amount;
        for (const line of vq.lines) {
          if (!(line.qty > 0)) continue;
          const sell = linesTotal > 0 ? (lineSell * line.amount / linesTotal) / line.qty : 0;
          out.push({
            manufacturer: "",
            modelNumber: line.manufacturerPartNumber?.trim() || "",
            room,
            system,
            sku: "",
            desc: line.description,
            qty: line.qty * item.qty,
            unit: line.unit || "ea",
            unitCost: line.amount / line.qty,
            unitSell: sell,
            lineSell: sell,
            source: vqSource,
            partOf: [vqName],
            notes: [...notes],
          });
        }
        // A typed vendor total (totalSource "manual") can differ from its
        // lines; the difference rides as its own row so the file still
        // totals to the estimate's cost.
        if (Math.abs(item.cost - linesTotal) > 0.005) {
          out.push({
            manufacturer: "",
            modelNumber: "",
            room,
            system,
            sku: "",
            desc: `Cost adjustment — ${vqName} (quote total differs from its lines)`,
            qty: item.qty,
            unit: "ea",
            unitCost: item.cost - linesTotal,
            unitSell: 0,
            lineSell: 0,
            source: ADJUSTMENT,
            partOf: [vqName],
            notes: [],
          });
        }
        continue;
      }

      if (item.components && item.components.length > 0) {
        const assemblyName = item.desc.split(" — ")[0].trim();
        const included = item.components.filter((comp) => comp.qty > 0);
        const partsCost = included.reduce((a, comp) => a + comp.cost * comp.qty, 0);
        const partsList = included.reduce((a, comp) => a + comp.price * comp.qty, 0);
        // Sell is allocated so the parts carry the line's margin and sum to
        // the line: by cost share, else by list-price share, else nothing.
        const sellOf = (comp: { cost: number; price: number }) =>
          partsCost > 0 ? comp.cost * lineSell / partsCost
            : partsList > 0 ? comp.price * lineSell / partsList
            : 0;
        for (const comp of included) {
          const sku = comp.sku.trim();
          const p = infoOf(info, sku);
          const sell = sellOf(comp);
          out.push({
            manufacturer: p?.mfr?.trim() || "",
            modelNumber: modelFromInfo(info, sku),
            room,
            system,
            sku,
            desc: p?.desc || comp.label,
            qty: comp.qty * item.qty,
            unit: comp.unit || "ea",
            unitCost: comp.cost,
            unitSell: sell,
            lineSell: sell,
            source: "Catalog",
            partOf: [assemblyName],
            notes: [...notes],
          });
        }
        if (Math.abs(item.cost - partsCost) > 0.005) {
          out.push({
            manufacturer: "",
            modelNumber: "",
            room,
            system,
            sku: "",
            desc: `Cost adjustment — ${assemblyName} (line cost differs from its parts)`,
            qty: item.qty,
            unit: "ea",
            unitCost: item.cost - partsCost,
            unitSell: 0,
            lineSell: 0,
            source: ADJUSTMENT,
            partOf: [assemblyName],
            notes: [],
          });
        }
        continue;
      }

      const sku = (item.sku || "").trim();
      const p = infoOf(info, sku);
      out.push({
        manufacturer: item.manufacturer?.trim() || p?.mfr?.trim() || "",
        modelNumber: lineModel(item, p ? { sku, manufacturerModelNumber: p.manufacturerModelNumber, manufacturerPartNumber: p.manufacturerPartNumber } : undefined),
        room,
        system,
        sku,
        desc: item.desc,
        qty: item.qty,
        unit: item.unit || "ea",
        unitCost: item.cost,
        unitSell: lineSell,
        lineSell,
        source: plainSource(item, !!p),
        partOf: [],
        notes,
      });
    }
    // k scales the exported Unit Sell only; lineSell keeps the line as priced.
    if (k !== 1) for (let i = start; i < out.length; i++) out[i].unitSell *= k;
  }
  return out;
}

/** The SKUs the parts list needs catalog facts for (#262) — plain items and
 *  included assembly components, unique, first-seen order. It sees no vendor
 *  quotes, so a vendor-quote line's own SKU is kept (a harmless extra lookup
 *  that covers the fall-through case). */
export function partsListSkus(sections: SpecSection[]): string[] {
  const seen = new Set<string>();
  for (const e of expand(sections, [], {})) if (e.sku) seen.add(e.sku);
  return [...seen];
}

/** The consolidated parts list (#262) — identical parts within one room +
 *  system merged, first-appearance order. v2: the price source is part of
 *  the key, so a catalog part and the same part typed in as custom stay
 *  apart. Merged rows share system, unit cost and unit sell, so their
 *  lineSell agrees; the first row's is kept. */
export function partsListRows(
  sections: SpecSection[],
  vendorQuotes: VendorQuote[],
  info: Record<string, PartInfo>,
  defaultRoom = ""
): PartsListRow[] {
  const rows = new Map<string, PartsListRow>();
  for (const e of expand(sections, vendorQuotes, info, defaultRoom)) {
    const key = e.sku || e.modelNumber
      ? `p|${e.room}|${e.system}|${e.manufacturer}|${e.modelNumber}|${e.sku}|${e.unit}|${round2(e.unitCost)}|${round2(e.unitSell)}|${e.source}`
      : `d|${e.room}|${e.system}|${e.desc}|${e.unit}|${round2(e.unitCost)}|${round2(e.unitSell)}|${e.source}`;
    const row = rows.get(key);
    if (row) {
      row.qty += e.qty;
      for (const x of e.partOf) if (!row.partOf.includes(x)) row.partOf.push(x);
      for (const x of e.notes) if (!row.notes.includes(x)) row.notes.push(x);
    } else {
      rows.set(key, { ...e, partOf: [...new Set(e.partOf)], notes: [...new Set(e.notes)] });
    }
  }
  return [...rows.values()];
}

/** A margin as a one-decimal percent (v2) — "" when the sell is zero or not
 *  finite; negative when below cost; never "-0.0%". */
function marginPct(sell: number, cost: number): string {
  if (!Number.isFinite(sell) || !Number.isFinite(cost) || Math.abs(sell) < 1e-9) return "";
  const v = Math.round(((sell - cost) / sell) * 1000) / 10;
  return (v === 0 ? 0 : v).toFixed(1) + "%";
}

/** CSV body rows under PARTS_CSV_HEADER (#262, v2); [] when empty. Item name
 *  is the model number, else the SKU. Notes carries "Part of: …", a "per
 *  <unit>" for anything not sold each, then internal notes. Cost-adjustment
 *  rows print no margins. */
export function partsListCsvRows(rows: PartsListRow[]): (string | number)[][] {
  return rows.map((r) => {
    const notes: string[] = [];
    if (r.partOf.length > 0) notes.push("Part of: " + r.partOf.join(", "));
    if (r.unit !== "ea") notes.push("per " + r.unit);
    notes.push(...r.notes);
    const adjustment = r.source === ADJUSTMENT;
    return [
      r.manufacturer,
      r.modelNumber || r.sku,
      r.desc,
      r.room,
      r.system,
      r.qty,
      r.unitCost.toFixed(2),
      r.unitSell.toFixed(2),
      adjustment ? "" : marginPct(r.lineSell, r.unitCost),
      adjustment ? "" : marginPct(r.unitSell, r.unitCost),
      r.source,
      notes.join("; "),
    ];
  });
}
```

- [ ] **Step 5: Run the harness and confirm every #262 assertion passes**

```bash
npm run test:specs 2>&1 | grep -E "#262|#304 parts list" | grep -vE "^PASS" ; echo "exit-grep:$?"
```

Expected: no output lines before `exit-grep:1` (grep found nothing that isn't PASS). Then confirm the counts:

```bash
npm run test:specs 2>&1 | grep -cE "^PASS .*#262"
npm run test:specs 2>&1 | grep -E "^FAIL" | head -20
```

Expected: the #262 PASS count is the old count + 12 (twelve new assertions; the two rewritten ones keep their place). The FAIL listing is empty, or shows only failures that already failed on `main` before this change. If so, note them with their messages and don't fix them here.

- [ ] **Step 6: Type-check and lint the touched files**

```bash
npx tsc --noEmit -p . 2>&1 | grep -E "parts-csv|test-review-and-spec" | head
npx eslint "src/app/(app)/estimator/parts-csv.ts"
```

Expected: no tsc lines for these files, and no eslint output. If `tsc` prints errors elsewhere, check they also exist on `main` (`git stash` is forbidden here — compare against a clean `git worktree` or the CI baseline instead) and leave them.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/estimator/parts-csv.ts" scripts/test-review-and-spec.ts
git commit -m "feat(estimator): parts list CSV v2 — item name, line/effective margin, price source

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: BOM quote PDF from the Build package tab

**Spec:** `docs/superpowers/specs/2026-10-20-bom-quote-pdf-design.md`

**Files:**
- Create: `src/lib/estimate-output/bom-pdf.ts` (pure helpers)
- Create: `src/lib/estimate-output/bom-pdf-server.ts` (render)
- Create: `src/app/api/quotes/[id]/bom-pdf/route.ts` (download route)
- Modify: `src/app/print/quote/[id]/page.tsx` (`view=bom`)
- Modify: `src/app/(app)/estimator/steps/package-bom-tab.tsx` (buttons + copy)
- Modify: `scripts/smoke-routes.ts` (two 404 entries)
- Test: `scripts/test-review-and-spec.ts` (new block at the end of the file)

**Interfaces:**
- Consumes: `bomViewProps(p: QuoteDocumentProps): QuoteDocumentProps` from `@/app/(app)/estimator/quote-document-view`. `signPrintToken(secret, "quote", id, nowMs)` from `@/lib/quote-pdf/token`. `printOriginFor(env, host, proto)` from `@/lib/quote-pdf/origin`. `renderPrintRouteToPdf(url, { timeoutMs, signal })` and `PdfRenderUnavailable` from `@/lib/quote-pdf/render`. `displayQuoteNumber` from `@/lib/estimate-number`. `attachmentDisposition` from `@/lib/document-files`. `pdfDirty: boolean` and `loadedId` on `EstimatorState` (both exist).
- Produces:
  - `bomPdfFileName(number: string): string` and `bomPdfPath(quoteId: string, download: boolean): string`.
  - `renderBomPdf(quoteId: string, host: string | null, proto: string | null): Promise<BomRender>`.
  - `BOM_TAB_COPY` gains `downloadPdf`, `openPdf`, `saveFirst`, `saveToCreate`.

- [ ] **Step 1: Write the failing harness block**

Append at the very end of `scripts/test-review-and-spec.ts`, after the last block's closing `}`. `readFileSync` and `join` are already imported at the top of the file. Keep the import with the block, as the rest of the file does.

```ts
/* --- BOM quote PDF (2026-10-20 spec): Build package → BOM quote → Download PDF / Open PDF ↗ --- */
import { bomPdfFileName as bq1File, bomPdfPath as bq1Path } from "@/lib/estimate-output/bom-pdf";
{
  const rd = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const has = (p: string) => existsSync(join(process.cwd(), p));
  ok(bq1File("EST-1234") === "EST-1234 BOM.pdf" && bq1File("") === "Estimate BOM.pdf" && bq1File("A/B") === "A_B BOM.pdf", "BOM PDF: \"<number> BOM.pdf\", Estimate when blank, unsafe characters → _");
  ok(bq1Path("Q-1", true) === "/api/quotes/Q-1/bom-pdf?download=1" && bq1Path("Q 1", false) === "/api/quotes/Q%201/bom-pdf", "BOM PDF: bomPdfPath encodes the id; download adds ?download=1");
  const page = rd("src/app/print/quote/[id]/page.tsx");
  ok(page.includes('import { bomViewProps } from "@/app/(app)/estimator/quote-document-view";') && /const bom = \(Array\.isArray\(sp\.view\) \? sp\.view\[0\] : sp\.view\) === "bom";/.test(page) && page.includes("<QuoteDocument {...bomViewProps(doc)} rewardsLine={purchasePerksDocLine(perks)} />"),
    "BOM PDF print: ?view=bom renders bomViewProps(doc) — the saved BOM preview's own transform");
  ok(page.includes("!bom && normalizePdfOptions(q.pdfOptions).pdfCutSheets") && page.indexOf("if (bom)") < page.indexOf("keyProductPhotoDataUris("),
    "BOM PDF print: the BOM view appends no cut sheets and reads no key-product photos");
  ok(page.indexOf('tokenOk(t, "quote", id)') > -1 && page.indexOf('tokenOk(t, "quote", id)') < page.indexOf("getQuote("), "BOM PDF print: the quote token is still checked before any read");
  const route = has("src/app/api/quotes/[id]/bom-pdf/route.ts") && has("src/lib/estimate-output/bom-pdf-server.ts")
    ? rd("src/app/api/quotes/[id]/bom-pdf/route.ts") + rd("src/lib/estimate-output/bom-pdf-server.ts") : "";
  ok(route.includes("export const maxDuration = 60;") && route.includes("await requireUser();") && route.includes("printOriginFor(process.env,") &&
     route.includes('signPrintToken(secret, "quote", q.id, Date.now())') && route.includes("&view=bom") && route.includes("renderPrintRouteToPdf(") && route.includes("PdfRenderUnavailable") &&
     route.includes('pdfKindForQuoteType(q.quoteType) !== "quote"') && route.includes("BOM_RENDER_TIMEOUT_MS = 45_000") && route.includes("BOM_RENDER_DEADLINE_MS = 55_000") &&
     route.includes("bomPdfFileName(displayQuoteNumber(q))") && route.includes('"x-content-type-options": "nosniff"') && route.includes('"cache-control": "private, no-store"'),
    "BOM PDF route: signed-in only, 60 s, the shared print origin, system quotes only, the quote token + view=bom, \"EST-#### BOM.pdf\"");
  const tab = rd("src/app/(app)/estimator/steps/package-bom-tab.tsx");
  ok(tab.includes('downloadPdf: "Download PDF"') && tab.includes('openPdf: "Open PDF ↗"') && tab.includes('saveFirst: "Save first — the PDF prints the saved estimate."') && tab.includes('saveToCreate: "Save to create the PDF."'),
    "BOM PDF tab: the four copy strings");
  ok(tab.includes("href={bomPdfPath(loadedId, true)}") && tab.includes("href={bomPdfPath(loadedId, false)}") && tab.includes("{pdfDirty && ") && !/from "@\/lib\/stores\//.test(tab),
    "BOM PDF tab: Download / Open use bomPdfPath, the save-first note follows pdfDirty, and the tab still imports no store");
  const smoke = rd("scripts/smoke-routes.ts");
  ok(smoke.includes('{ route: "/api/quotes/Q-0/bom-pdf", expectNotFound: true }') && smoke.includes('{ route: "/print/quote/Q-2041?view=bom", expectNotFound: true }'), "BOM PDF: smoke covers the 404 paths");
}
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
ps aux | grep -c "[t]sx"
npm run test:specs 2>&1 | grep -E "BOM PDF" | head -20
```

Expected: the harness fails to start, because `@/lib/estimate-output/bom-pdf` doesn't exist yet and the import can't resolve. That's the RED. Every other assertion depends on files created below.

- [ ] **Step 3: Create `src/lib/estimate-output/bom-pdf.ts`**

```ts
/**
 * BOM quote PDF (2026-10-20 spec) — pure, client-safe helpers shared by the
 * Build package → BOM quote tab and the render. The tab imports nothing from
 * a store (#333), so these live apart from bom-pdf-server.ts.
 */

/** "<estimate number> BOM.pdf" — the Cover PDF's character rule (coverPdfFileName). */
export function bomPdfFileName(number: string): string {
  return `${(number || "Estimate").replace(/[^A-Za-z0-9 _-]/g, "_")} BOM.pdf`;
}

/** The staff download route; `download` sends it as an attachment, else it opens inline. */
export function bomPdfPath(quoteId: string, download: boolean): string {
  return `/api/quotes/${encodeURIComponent(quoteId)}/bom-pdf${download ? "?download=1" : ""}`;
}
```

- [ ] **Step 4: Create `src/lib/estimate-output/bom-pdf-server.ts`**

```ts
import { displayQuoteNumber } from "@/lib/estimate-number";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { PdfRenderUnavailable, renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { signPrintToken } from "@/lib/quote-pdf/token";
import { get as getQuote } from "@/lib/stores/quotes";
import { bomPdfFileName } from "./bom-pdf";

/**
 * BOM quote PDF (2026-10-20 spec) — one headless-Chrome render of a system
 * estimate's itemized BOM view, from the SAVED quote through the signed
 * /print/quote/[id]?view=bom route (the estimate's own print page and token
 * kind; `view` only re-lays-out what the token already authorizes). Mirrors
 * renderCoverPdf. Never stored, never attached to a send. Server-only.
 */

/** The render's own budget: it fails cleanly inside the route's maxDuration. */
export const BOM_RENDER_TIMEOUT_MS = 45_000;
/** Bounds the queue wait too. */
export const BOM_RENDER_DEADLINE_MS = 55_000;

export const BOM_RENDER_FAILED = "The BOM PDF couldn’t be rendered — try again.";
export const BOM_NO_SECRET = "BOM PDFs aren’t set up on this server (AUTH_SECRET is missing).";

/** `status` mirrors the route's answer: 404 not a system estimate / unknown,
 *  503 not set up here (secret, origin, Chrome), 500 the render failed. */
export type BomRender = { ok: true; pdf: Buffer; fileName: string } | { ok: false; status: 404 | 500 | 503; error: string };

/** `host` / `proto`: the request's (x-forwarded-)host and proto — printOriginFor decides the origin. */
export async function renderBomPdf(quoteId: string, host: string | null, proto: string | null): Promise<BomRender> {
  try {
    if (!quoteId || quoteId.length > 64) return { ok: false, status: 404, error: "Not found" };
    const q = await getQuote(quoteId);
    if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") return { ok: false, status: 404, error: "Not found" };
    const secret = process.env.AUTH_SECRET || "";
    if (!secret) return { ok: false, status: 503, error: BOM_NO_SECRET };
    const where = printOriginFor(process.env, host, proto);
    if ("error" in where) return { ok: false, status: 503, error: where.error };
    const t = signPrintToken(secret, "quote", q.id, Date.now());
    const pdf = await renderPrintRouteToPdf(`${where.origin}/print/quote/${encodeURIComponent(q.id)}?t=${encodeURIComponent(t)}&view=bom`, {
      timeoutMs: BOM_RENDER_TIMEOUT_MS,
      signal: AbortSignal.timeout(BOM_RENDER_DEADLINE_MS),
    });
    return { ok: true, pdf, fileName: bomPdfFileName(displayQuoteNumber(q)) };
  } catch (e) {
    if (e instanceof PdfRenderUnavailable) return { ok: false, status: 503, error: e.message };
    console.error("[bom-pdf] BOM PDF render failed", e);
    return { ok: false, status: 500, error: BOM_RENDER_FAILED };
  }
}
```

- [ ] **Step 5: Create `src/app/api/quotes/[id]/bom-pdf/route.ts`**

```ts
import { attachmentDisposition } from "@/lib/document-files";
import { renderBomPdf } from "@/lib/estimate-output/bom-pdf-server";
import { requireUser } from "@/lib/session";

/** One headless-Chrome render of the BOM view. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

/**
 * BOM quote PDF (2026-10-20 spec) — a system estimate's itemized BOM view as a
 * PDF for staff, rendered on demand from the SAVED quote (renderBomPdf).
 * `?download=1` downloads; otherwise it opens inline. A service quote and an
 * unknown id answer the same 404.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Outside the render: a signed-out request redirects to the login page.
  await requireUser();
  const { id } = await params;
  const h = request.headers;
  const r = await renderBomPdf(id, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
  if (!r.ok) return text(r.error, r.status);
  const disposition = attachmentDisposition(r.fileName);
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(r.pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": download ? disposition : "inline" + disposition.slice("attachment".length),
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
```

- [ ] **Step 6: Teach the print page `view=bom`**

In `src/app/print/quote/[id]/page.tsx`:

(a) Add the import after the `QuoteDocument` import line:

```ts
import { bomViewProps } from "@/app/(app)/estimator/quote-document-view";
```

(b) Directly after `const t = Array.isArray(sp.t) ? sp.t[0] : sp.t;` add:

```ts
  // BOM quote PDF (2026-10-20 spec): ?view=bom prints the saved BOM preview — itemized bands, no package document, no cut sheets, no photos.
  const bom = (Array.isArray(sp.view) ? sp.view[0] : sp.view) === "bom";
```

(c) In the `Promise.all`, change the cut-sheets entry from

```ts
    normalizePdfOptions(q.pdfOptions).pdfCutSheets ? settleWithin(loadCutSheets(id, { images: "data" }), CUT_SHEET_APPEND_LOAD_MS, `[cutsheets] estimate PDF ${id}`) : null,
```

to

```ts
    !bom && normalizePdfOptions(q.pdfOptions).pdfCutSheets ? settleWithin(loadCutSheets(id, { images: "data" }), CUT_SHEET_APPEND_LOAD_MS, `[cutsheets] estimate PDF ${id}`) : null,
```

(d) Directly after `const doc = quoteDocumentDataFor(q, cust, settings);` add:

```tsx
  if (bom) {
    return (
      <main>
        <style>{QUOTE_PRINT_CSS}</style>
        <QuoteDocument {...bomViewProps(doc)} rewardsLine={purchasePerksDocLine(perks)} />
      </main>
    );
  }
```

Update the route's doc comment ("Signed print route for an Estimator quote (#222)…") with one more sentence: `` `?view=bom` (2026-10-20) prints the BOM view instead — bomViewProps, no cut sheets, no photos — for the Build package BOM PDF.``

- [ ] **Step 7: Add the buttons to the BOM quote tab**

In `src/app/(app)/estimator/steps/package-bom-tab.tsx`:

(a) Add the import after the `previewPath` import:

```ts
import { bomPdfPath } from "@/lib/estimate-output/bom-pdf";
```

(b) Extend `BOM_TAB_COPY`. Add these four keys after `openSaved`:

```ts
  downloadPdf: "Download PDF",
  openPdf: "Open PDF ↗",
  saveFirst: "Save first — the PDF prints the saved estimate.",
  saveToCreate: "Save to create the PDF.",
```

(c) Add `pdfDirty,` to the destructured fields of `s`, after `loadedId,`.

(d) In the strip, directly after the existing `{loadedId && ( … openSaved … )}` block, leaving that block unchanged, add:

```tsx
          {loadedId ? (
            <>
              <a href={bomPdfPath(loadedId, true)} style={LINK}>
                {BOM_TAB_COPY.downloadPdf}
              </a>
              <a href={bomPdfPath(loadedId, false)} target="_blank" rel="noopener noreferrer" style={LINK}>
                {BOM_TAB_COPY.openPdf}
              </a>
              {pdfDirty && <span style={{ color: "#8a6d1f" }}>{BOM_TAB_COPY.saveFirst}</span>}
            </>
          ) : (
            <span aria-disabled="true" style={{ color: "#9aa0ab", fontWeight: 600 }}>
              {BOM_TAB_COPY.downloadPdf} — {BOM_TAB_COPY.saveToCreate}
            </span>
          )}
```

Update the component's doc comment with one line: `Download PDF / Open PDF ↗ (2026-10-20) print the SAVED estimate's BOM view through /api/quotes/[id]/bom-pdf.`

- [ ] **Step 8: Add the smoke entries**

In `scripts/smoke-routes.ts`, directly after the `{ route: "/api/quotes/Q-0/cover-pdf", expectNotFound: true },` line, add:

```ts
  // BOM quote PDF (2026-10-20) — an unknown quote is a clean 404, never a render; the print view without a token is a 404 before any read.
  { route: "/api/quotes/Q-0/bom-pdf", expectNotFound: true },
  { route: "/print/quote/Q-2041?view=bom", expectNotFound: true },
```

- [ ] **Step 9: Run the harness and confirm the block passes**

```bash
npm run test:specs 2>&1 | grep -E "BOM PDF|#333 BOM tab|#333 review K|#333 review L"
npm run test:specs 2>&1 | grep -E "^FAIL" | head -20
```

Expected: all nine `BOM PDF` assertions PASS, and the existing `#333 BOM tab` / `review K` / `review L` assertions still PASS. The FAIL listing is empty, or shows only failures already present on `main`.

- [ ] **Step 10: Type-check, lint, smoke**

```bash
npx tsc --noEmit -p . 2>&1 | grep -E "bom-pdf|print/quote|package-bom-tab|smoke-routes" | head
npx eslint src/lib/estimate-output/bom-pdf.ts src/lib/estimate-output/bom-pdf-server.ts "src/app/api/quotes/[id]/bom-pdf/route.ts" "src/app/print/quote/[id]/page.tsx" "src/app/(app)/estimator/steps/package-bom-tab.tsx"
npm run test:smoke 2>&1 | grep -E "bom-pdf|view=bom|FAIL|passed|failed" | head
```

Expected: no tsc lines for these files, no eslint output, and both new smoke routes report the expected 404. `test:smoke` starts its own server. Before running it, check that no other `next dev` holds the dev DB (`lsof -i :3000`, `ps aux | grep "[n]ext dev"`). If one does, stop it, or run smoke after Step 11.

- [ ] **Step 11: See one real PDF on the dev server (GET only)**

1. Run `ps aux | grep -E "[t]sx|[n]ext dev"` and make sure nothing else holds `.data/pglite`.
2. Start the dev server with `preview_start` (the main checkout's `.claude/launch.json`).
3. Open `/quotes`, pick any **saved system estimate**, and open it in the Estimator → Build package → BOM quote. Confirm the strip shows **Download PDF** and **Open PDF ↗**.
4. Click **Open PDF ↗** (or navigate to `/api/quotes/<id>/bom-pdf`). Confirm a PDF loads, with the full Peak letterhead and the systems itemized like the tab.
5. Take a screenshot as proof. Don't edit or save the estimate, because the dev DB holds the real book.

If the render answers 503 (no local Chrome or print origin), record the message. That's an environment gap, not a code failure. Confirm instead that `/print/quote/<id>?view=bom` without a token is a 404. Then stop the server (`preview_stop`, then make sure no `next dev` remains).

- [ ] **Step 12: Commit**

```bash
git add src/lib/estimate-output/bom-pdf.ts src/lib/estimate-output/bom-pdf-server.ts "src/app/api/quotes/[id]/bom-pdf/route.ts" "src/app/print/quote/[id]/page.tsx" "src/app/(app)/estimator/steps/package-bom-tab.tsx" scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "feat(estimator): BOM quote PDF — Download / Open from Build package → BOM quote

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Docs and the verification gate

**Files:**
- Modify: `DECISIONS.md` (append one entry)
- Modify: `PUNCHLIST.md` (append one shipped item)

**Interfaces:**
- Consumes: Task 1's and Task 2's committed changes.
- Produces: nothing code-facing.

- [ ] **Step 1: Pick the numbers right before writing**

Other sessions write to these files. Recompute just before editing:

```bash
git fetch -q origin && git log --oneline -1 origin/main
grep -oE '^## D[0-9]+' DECISIONS.md | sed 's/## D//' | sort -n | tail -1
git show origin/main:DECISIONS.md | grep -oE '^## D[0-9]+' | sed 's/## D//' | sort -n | tail -1
grep -oE '#[0-9]{3}\b' PUNCHLIST.md | sed 's/#//' | sort -n | tail -1
git show origin/main:PUNCHLIST.md | grep -oE '#[0-9]{3}\b' | sed 's/#//' | sort -n | tail -1
```

Use D = (max of the two D numbers) + 1 for the CSV entry and D + 1 for the BOM PDF entry. Use punch # = (max of the two punch numbers) + 1. Below they're written `D<N>`, `D<N+1>` and `#<P>`; substitute the real numbers.

- [ ] **Step 2: Append the DECISIONS.md entry**

Append at the end of `DECISIONS.md`, matching the existing `## D…` format:

```markdown
## D<N>. Parts list CSV v2: Item name, two margins, Price source (#<P>, 2026-10-20)

Jeff asked that the Estimator's Parts list (CSV) cover item name, description, cost, sell margin and where the pricing came from, "Catalog" for catalog items. The #262 header becomes twelve columns: Manufacturer, Item name, Description, Room, System, Qty, Unit Cost, Unit Sell, Line margin, Effective margin, Price source, Notes. **Item name** renames Model number (same rule, now falling back to the SKU), and Description moves up beside it. **Line margin** is the line as priced, before the system's freight / $25 rounding / typed sell. **Effective margin** is from the file's own Unit Cost and Unit Sell. Both are blank at zero sell and on cost-adjustment rows. **Price source** is derived from the line's existing flags, first match wins: vendor quote (`Vendor quote — <vendor> #<n>`), `Adjustment`, exploded components `Catalog`, `Price on request`, `Allowance`, `Curtain calculator`, `Custom`, a resolved SKU `Catalog` (or `Catalog — sell edited` when `sellOverride` / `extSellOverride` is set), else `Not in catalog`. Source joins the consolidation key. Rows, totals and invariants are unchanged; no stored field. `src/app/(app)/estimator/parts-csv.ts`; spec `docs/superpowers/specs/2026-10-20-parts-list-csv-price-source-design.md`; harness `#262 v2`.

## D<N+1>. BOM quote PDF from Build package (#<P>, 2026-10-20)

Jeff asked to export the Build package → BOM quote render. The tab gains **Download PDF** / **Open PDF ↗**, which render the SAVED estimate's BOM view through headless Chrome. It's the same pattern as the Cover PDF (#301): `GET /api/quotes/[id]/bom-pdf` (signed-in, 60 s, system estimates only) → `renderBomPdf` (`src/lib/estimate-output/bom-pdf-server.ts`) → the existing signed `/print/quote/[id]` page with `?view=bom`, which renders `bomViewProps(doc)` with no cut sheets and no photos. It reuses the `quote` token kind, because `view` only re-lays-out data that token already authorizes. Unsaved edits don't print: the tab says "Save first — the PDF prints the saved estimate." A live, unsaved PDF was considered and left out to keep one server render path. File `<number> BOM.pdf`. Never stored, never attached to a send, not in the portal or client link. Spec `docs/superpowers/specs/2026-10-20-bom-quote-pdf-design.md`; harness `BOM PDF`.
```

- [ ] **Step 3: Append the PUNCHLIST.md item**

Read the last shipped item in `PUNCHLIST.md` and copy its heading level and layout exactly. Then append an item with this content:

```markdown
#<P> ✅ Parts list CSV v2 + BOM quote PDF (2026-10-20, D<N>–D<N+1>) — Estimator → More ▾ → Parts list (CSV) now prints Item name (model, else SKU), Description, Unit Cost, Unit Sell, Line margin, Effective margin and Price source ("Catalog" for catalog parts; vendor quote / custom / allowance / curtain / POR / sell edited / not in catalog otherwise). Build package → BOM quote gains Download PDF / Open PDF ↗ for the saved estimate's BOM view (`<number> BOM.pdf`). Remaining: Jeff opens one real estimate's CSV in Excel and checks the labels and margins, and downloads one BOM PDF on production (needs `QUOTE_PDF_ORIGIN`, like every estimate PDF).
```

- [ ] **Step 4: Run the full verification gate and record real numbers**

```bash
npx tsc --noEmit -p . 2>&1 | tail -3
npm run test:specs 2>&1 | tail -5
npm run test:specs 2>&1 | grep -c "^FAIL"
npm run test:smoke 2>&1 | tail -5
npx eslint "src/app/(app)/estimator/parts-csv.ts" src/lib/estimate-output/bom-pdf.ts src/lib/estimate-output/bom-pdf-server.ts "src/app/api/quotes/[id]/bom-pdf/route.ts" "src/app/print/quote/[id]/page.tsx" "src/app/(app)/estimator/steps/package-bom-tab.tsx" scripts/test-review-and-spec.ts
```

Expected:
- tsc is clean, or has only failures already present on `main`.
- `test:specs` has 0 FAIL, or only failures that already fail on `main`.
- smoke passes and eslint prints nothing.

Report the actual PASS/FAIL counts, not "all green".

- [ ] **Step 5: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md
git commit -m "docs: D<N>–D<N+1> / #<P> — parts list CSV v2 + BOM quote PDF

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Not in this plan

- No browser check for the CSV. It's a client-side download of `partsListCsvRows` output, and the menu wiring in `use-estimator-state.ts:2150-2170` is untouched. The BOM PDF does get a real render in Task 2 Step 11.
- No push. Pushing to `origin/main` is Jeff's call after review.
