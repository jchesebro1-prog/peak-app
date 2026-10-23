import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import { lineModel, partModel } from "@/lib/catalog-rename/sku";
import { hasSellOverride, isSystemLine, lineExtSellOf, systemFreight, systemItemsRev, systemSellAdjustment, systemSellTotal } from "./pricing";
import type { SpecItem, SpecSection, VendorQuote } from "./types";
import { isBonusItem, isEstimatorBonusItem, isPackageBonusItem } from "@/lib/estimate-bonus/flags";
import { isPlaceholderSku } from "@/lib/specs/record-keys";
import { normalCostOf, type ProjectDiscounts } from "@/lib/project-discounts/rules";

/** The Estimator's "Parts list (CSV)" export for the project manager (#262) —
 *  every orderable part in the estimate's material systems, assemblies
 *  exploded into their components, vendor quotes into their lines, identical
 *  parts consolidated per room + system. Σ qty × Unit Cost equals the
 *  estimate's material cost; per system, Σ qty × Unit Sell equals the
 *  system's price including freight (typed, or rounded up to $25; exact for
 *  a legacy system) less any labor lines' share (#276, #279) — freight has
 *  no row of its own but is carried in the parts' sell.
 *  v2 (2026-10-20 spec): every row also says where its price came from and
 *  carries its line markup (before freight) beside the effective markup.
 *  #363: the menu now downloads the Review spreadsheet (review-sheet-xlsx.ts)
 *  built from `reviewSheetModel` below — the same rows, plus each row's Link
 *  and its section id, grouped per system with that system's fees. The CSV
 *  helpers (`partsListCsvRows`, `PARTS_CSV_HEADER`) stay for the row tests.
 *  Pure: no React, no server imports. */

/** Catalog facts for one SKU, keyed by the trimmed SKU (#262). */
export type PartInfo = { mfr?: string; manufacturerPartNumber?: string; manufacturerModelNumber?: string; desc?: string };

/** One consolidated row of the parts list (#262). `unitCost`/`unitSell`/
 *  `lineSell` stay unrounded; `sku` and `unit` are kept for merging + the
 *  unit note, never printed as their own columns. `lineSell` is the unit
 *  sell before the system's freight / rounding / typed-sell factor; `source`
 *  is the Price source label (v2). `link` is the line's own product page
 *  (http/https only, else "") and `sectionId` the system it came from (#363). */
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
  link: string;
  sectionId: string;
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
  "Line markup",
  "Effective markup",
  "Price source",
  "Notes",
];

/** Price source of a cost-adjustment row (v2) — it carries no markups. */
const ADJUSTMENT = "Adjustment";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Longest link the Review spreadsheet writes (#363) — Excel refuses a file
 *  whose hyperlink runs past 2,079 characters, so a longer one is dropped. */
const LINK_MAX = 2000;

/** A line's link as the Review spreadsheet may print it (#363): trimmed, an
 *  absolute http(s) URL only — anything else (javascript:, mailto:, a bare
 *  path, junk) is "". */
export function reviewLink(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw.trim();
  if (!s || s.length > LINK_MAX || !/^https?:\/\//i.test(s)) return "";
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : "";
  } catch {
    return "";
  }
}

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
  // #366: a project discount is named (its own merge key too), keeping "sell edited" when that applies.
  if (typeof item.projectDiscountPct === "number") return projectSource(item.projectDiscountPct) + (edited ? " · sell edited" : "");
  return edited ? "Catalog — sell edited" : "Catalog";
}

/** #366: the Price source of a catalog line / part carrying a project discount. */
function projectSource(pct: number): string {
  return `Catalog — project discount ${pct}%`;
}

/** #366: the "Project pricing: <note>" Notes entry for a discounted SKU ([] when no note, or no discount). */
function projectNotes(discounts: ProjectDiscounts, sku: string, pct: number | undefined): string[] {
  if (typeof pct !== "number" || !sku || !Object.prototype.hasOwnProperty.call(discounts, sku)) return [];
  const note = (discounts[sku]?.note || "").trim();
  return note ? [`Project pricing: ${note}`] : [];
}

/** The trimmed SKU, or "" for a placeholder (CUSTOM, AI, CURTAIN, CRT-n) —
 *  those count as no SKU: never printed, never looked up, never a merge key. */
function realSku(raw: string | undefined): string {
  const sku = (raw || "").trim();
  return isPlaceholderSku(sku) ? "" : sku;
}

/** Every emitted entry, in order, before consolidation (#262). */
function expand(
  sections: SpecSection[],
  vendorQuotes: VendorQuote[],
  info: Record<string, PartInfo>,
  defaultRoom = "",
  /** #366: the estimate's project discounts — only their notes are read (the % is stamped on the lines). */
  discounts: ProjectDiscounts = {}
): PartsListRow[] {
  const out: PartsListRow[] = [];
  for (const section of sections) {
    if (section.kind === "labor") continue;
    // Phase 2b: an Alternate group's systems are out of the base bid, like option lines
    if (section.alternate) continue;
    const room = section.room?.trim() || defaultRoom.trim();
    const system = section.name;
    const sectionId = section.id;
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
      // A found vendor quote names the line even when it has no lines (a typed total).
      const vqLabel = vq ? `${vq.vendor}${vq.quoteNumber ? " #" + vq.quoteNumber : ""}` : "";
      const vqName = `Vendor quote ${vqLabel}`;
      const vqSource = `Vendor quote — ${vqLabel}`;
      // #363: a row links the line's own page — for a vendor quote, else the vendor quote's.
      const link = reviewLink(item.link) || (vq ? reviewLink(vq.link) : "");
      if (vq && vq.lines.length > 0) {
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
            link,
            sectionId,
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
            link,
            sectionId,
          });
        }
        continue;
      }

      if (item.components && item.components.length > 0) {
        const assemblyName = item.desc.split(" — ")[0].trim();
        const included = item.components.filter((comp) => comp.qty > 0);
        const partsCost = included.reduce((a, comp) => a + comp.cost * comp.qty, 0);
        const partsList = included.reduce((a, comp) => a + comp.price * comp.qty, 0);
        // #366: sell is shared out by NORMAL cost — a project discount lowers a part's cost, never its share of sell.
        const partsNormal = included.reduce((a, comp) => a + normalCostOf(comp) * comp.qty, 0);
        // Sell is allocated so the parts carry the line's markup and sum to
        // the line: by cost share, else by list-price share, else nothing.
        const sellOf = (comp: { cost: number; price: number; catalogCost?: number }) =>
          partsNormal > 0 ? normalCostOf(comp) * lineSell / partsNormal
            : partsList > 0 ? comp.price * lineSell / partsList
            : 0;
        for (const comp of included) {
          const sku = realSku(comp.sku);
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
            source: typeof comp.projectDiscountPct === "number" ? projectSource(comp.projectDiscountPct) : "Catalog",
            partOf: [assemblyName],
            notes: [...notes, ...projectNotes(discounts, sku, comp.projectDiscountPct)],
            // #363: components are catalog parts — the assembly line's link isn't theirs.
            link: "",
            sectionId,
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
            link: "",
            sectionId,
          });
        }
        continue;
      }

      const sku = realSku(item.sku);
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
        source: vq ? vqSource : plainSource(item, !!p),
        partOf: [],
        notes: vq ? notes : [...notes, ...projectNotes(discounts, sku, item.projectDiscountPct)],
        link,
        sectionId,
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
 *  lineSell agrees; the first row's is kept. #363: the section id and the
 *  link are in the key too — two systems that share a name never merge, nor
 *  do two lines that link different pages. */
export function partsListRows(
  sections: SpecSection[],
  vendorQuotes: VendorQuote[],
  info: Record<string, PartInfo>,
  defaultRoom = "",
  /** #366: the estimate's project discounts (their notes go in Notes). */
  discounts: ProjectDiscounts = {}
): PartsListRow[] {
  const rows = new Map<string, PartsListRow>();
  for (const e of expand(sections, vendorQuotes, info, defaultRoom, discounts)) {
    const key = e.sku || e.modelNumber
      ? `p|${e.sectionId}|${e.room}|${e.system}|${e.manufacturer}|${e.modelNumber}|${e.sku}|${e.unit}|${round2(e.unitCost)}|${round2(e.unitSell)}|${e.source}|${e.link}`
      : `d|${e.sectionId}|${e.room}|${e.system}|${e.desc}|${e.unit}|${round2(e.unitCost)}|${round2(e.unitSell)}|${e.source}|${e.link}`;
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

/** A markup as a one-decimal percent — "" when the cost is zero or not finite; negative when below cost; never "-0.0%". */
function markupPct(sell: number, cost: number): string {
  if (!Number.isFinite(sell) || !Number.isFinite(cost) || Math.abs(cost) < 1e-9) return "";
  const v = Math.round(((sell - cost) / cost) * 1000) / 10;
  return (v === 0 ? 0 : v).toFixed(1) + "%";
}

/** CSV body rows under PARTS_CSV_HEADER (#262, v2); [] when empty. Item name
 *  is the model number, else the SKU. Notes carries "Part of: …", a "per
 *  <unit>" for anything not sold each, then internal notes. Cost-adjustment
 *  rows print no markups. */
export function partsListCsvRows(rows: PartsListRow[]): (string | number)[][] {
  return rows.map((r) => {
    const adjustment = isAdjustmentRow(r);
    return [
      r.manufacturer,
      partsRowItemName(r),
      r.desc,
      r.room,
      r.system,
      r.qty,
      r.unitCost.toFixed(2),
      r.unitSell.toFixed(2),
      adjustment ? "" : markupPct(r.lineSell, r.unitCost),
      adjustment ? "" : markupPct(r.unitSell, r.unitCost),
      r.source,
      partsRowNotes(r),
    ];
  });
}

/** A row's Item name (#262 v2, #363): the model number, else the SKU, else "". */
export function partsRowItemName(r: PartsListRow): string {
  return r.modelNumber || r.sku;
}

/** A row's Notes cell (#262 v2, #363): "Part of: …", a "per <unit>" for
 *  anything not sold each, then internal notes, joined by "; ". */
export function partsRowNotes(r: PartsListRow): string {
  const notes: string[] = [];
  if (r.partOf.length > 0) notes.push("Part of: " + r.partOf.join(", "));
  if (r.unit !== "ea") notes.push("per " + r.unit);
  notes.push(...r.notes);
  return notes.join("; ");
}

/** A cost-adjustment row — it carries cost only, so it prints no markups (v2, #363). */
export function isAdjustmentRow(r: PartsListRow): boolean {
  return r.source === ADJUSTMENT;
}

/* ---------------- #363 Review spreadsheet ---------------- */

/** The money a system's price carries beyond its listed parts' own sell (#363). */
export type SystemFees = {
  freight: number;
  packageBonus: number;
  estimatorBonus: number;
  /** The $25 round-up, or what a typed system price adds (negative when it is below the computed price). */
  adjustment: number;
  /** True when `adjustment` comes from a typed system price, not the round-up. */
  typedPrice: boolean;
  /** All four, to the cent. */
  total: number;
};

/** System fees (#363, Jeff 2026-10-22): freight + the 5% package bonus + the
 *  2% estimator bonus + the round-up / typed-price adjustment. With the
 *  listed parts' own sell (lineSell) they make the system's price — to the
 *  cent for a system with no labor lines, which are never listed. */
export function systemFees(section: SpecSection): SystemFees {
  const bonus = (pick: (x: SpecItem) => boolean) =>
    round2(section.items.filter((x) => pick(x) && isSystemLine(x)).reduce((a, x) => a + lineExtSellOf(x), 0));
  const freight = systemFreight(section);
  const packageBonus = bonus(isPackageBonusItem);
  const estimatorBonus = bonus(isEstimatorBonusItem);
  const adjustment = systemSellAdjustment(section);
  return {
    freight,
    packageBonus,
    estimatorBonus,
    adjustment,
    typedPrice: hasSellOverride(section),
    total: round2(freight + packageBonus + estimatorBonus + adjustment),
  };
}

/** One system's block of the Review spreadsheet (#363): its listed rows, then
 *  its three subtotal rows (cost, markup, fees). */
export type ReviewSheetBlock = {
  sectionId: string;
  system: string;
  room: string;
  rows: PartsListRow[];
  fees: SystemFees;
};

/** The Review spreadsheet's model (#363): one block per system that lists at
 *  least one row, in the estimate's order — the parts list's own rows and
 *  exclusions (labor systems, alternates, option / labor / bonus / Rewards
 *  lines), grouped by section id so two same-named systems stay apart. */
export function reviewSheetModel(
  sections: SpecSection[],
  vendorQuotes: VendorQuote[],
  info: Record<string, PartInfo>,
  defaultRoom = "",
  /** #366: the estimate's project discounts. */
  discounts: ProjectDiscounts = {}
): ReviewSheetBlock[] {
  const bySection = new Map<string, PartsListRow[]>();
  for (const r of partsListRows(sections, vendorQuotes, info, defaultRoom, discounts)) {
    const list = bySection.get(r.sectionId);
    if (list) list.push(r);
    else bySection.set(r.sectionId, [r]);
  }
  const out: ReviewSheetBlock[] = [];
  for (const section of sections) {
    const rows = bySection.get(section.id);
    if (!rows || rows.length === 0) continue;
    // Section ids are unique per estimate; a repeat would only list the rows twice.
    bySection.delete(section.id);
    out.push({
      sectionId: section.id,
      system: section.name,
      room: section.room?.trim() || defaultRoom.trim(),
      rows,
      fees: systemFees(section),
    });
  }
  return out;
}
