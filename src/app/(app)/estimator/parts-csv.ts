import type { SpecSection, VendorQuote } from "./types";

/** The Estimator's "Parts list (CSV)" export for the project manager (#262) —
 *  every orderable part in the estimate's material systems, assemblies
 *  exploded into their components, vendor quotes into their lines, identical
 *  parts consolidated. The file's total always equals the estimate's
 *  material cost. Pure: no React, no server imports. */

/** Catalog facts for one SKU, keyed by the trimmed SKU (#262). */
export type PartInfo = { mfr?: string; manufacturerPartNumber?: string; manufacturerModelNumber?: string; desc?: string };

/** One consolidated row of the parts list (#262). `unitCost` stays unrounded;
 *  `extCost` is rounded to cents on the merged row. */
export type PartsListRow = {
  manufacturer: string;
  modelNumber: string;
  sku: string;
  desc: string;
  qty: number;
  unit: string;
  unitCost: number;
  extCost: number;
  usedIn: string[];
};

export const PARTS_CSV_HEADER: string[] = [
  "Manufacturer",
  "Model number",
  "Peak SKU",
  "Description",
  "Qty",
  "Unit",
  "Unit cost",
  "Extended cost",
  "Used in",
];

type Entry = Omit<PartsListRow, "extCost" | "usedIn"> & { label: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

function infoOf(info: Record<string, PartInfo>, sku: string): PartInfo | undefined {
  return sku && Object.prototype.hasOwnProperty.call(info, sku) ? info[sku] : undefined;
}

/** Model rule (#262): printed model > printed P/N > the SKU itself for a
 *  known catalog part; "" for an unknown SKU. */
function modelFromInfo(info: Record<string, PartInfo>, sku: string): string {
  const p = infoOf(info, sku);
  if (!p) return "";
  return p.manufacturerModelNumber?.trim() || p.manufacturerPartNumber?.trim() || sku;
}

/** Every emitted entry, in order, before consolidation (#262). */
function expand(sections: SpecSection[], vendorQuotes: VendorQuote[], info: Record<string, PartInfo>): Entry[] {
  const out: Entry[] = [];
  for (const section of sections) {
    if (section.kind === "labor") continue;
    for (const item of section.items) {
      if (item.labor || item.laborOverhead || item.option) continue;
      if (!Number.isFinite(item.qty) || item.qty <= 0) continue;

      const vq = item.vendorQuoteId ? vendorQuotes.find((v) => v.id === item.vendorQuoteId) : undefined;
      if (vq && vq.lines.length > 0) {
        const vqName = `Vendor quote ${vq.vendor}${vq.quoteNumber ? " #" + vq.quoteNumber : ""}`;
        const label = `${section.name} › ${vqName}`;
        let linesTotal = 0;
        for (const line of vq.lines) {
          if (!(line.qty > 0)) continue;
          linesTotal += line.amount;
          out.push({
            manufacturer: "",
            modelNumber: line.manufacturerPartNumber?.trim() || "",
            sku: "",
            desc: line.description,
            qty: line.qty * item.qty,
            unit: line.unit || "ea",
            unitCost: line.amount / line.qty,
            label,
          });
        }
        // A typed vendor total (totalSource "manual") can differ from its
        // lines; the difference rides as its own row so the file still
        // totals to the estimate's cost.
        if (Math.abs(item.cost - linesTotal) > 0.005) {
          out.push({
            manufacturer: "",
            modelNumber: "",
            sku: "",
            desc: `Cost adjustment — ${vqName} (quote total differs from its lines)`,
            qty: item.qty,
            unit: "ea",
            unitCost: item.cost - linesTotal,
            label,
          });
        }
        continue;
      }

      if (item.components && item.components.length > 0) {
        const assemblyName = item.desc.split(" — ")[0].trim();
        const label = `${section.name} › ${assemblyName}`;
        let partsUnit = 0;
        for (const comp of item.components) {
          if (!(comp.qty > 0)) continue;
          const sku = comp.sku.trim();
          const p = infoOf(info, sku);
          partsUnit += comp.cost * comp.qty;
          out.push({
            manufacturer: p?.mfr?.trim() || "",
            modelNumber: modelFromInfo(info, sku),
            sku,
            desc: p?.desc || comp.label,
            qty: comp.qty * item.qty,
            unit: comp.unit || "ea",
            unitCost: comp.cost,
            label,
          });
        }
        if (Math.abs(item.cost - partsUnit) > 0.005) {
          out.push({
            manufacturer: "",
            modelNumber: "",
            sku: "",
            desc: `Cost adjustment — ${assemblyName} (line cost differs from its parts)`,
            qty: item.qty,
            unit: "ea",
            unitCost: item.cost - partsUnit,
            label,
          });
        }
        continue;
      }

      const sku = (item.sku || "").trim();
      const p = infoOf(info, sku);
      out.push({
        manufacturer: item.manufacturer?.trim() || p?.mfr?.trim() || "",
        modelNumber: item.manufacturerModelNumber?.trim() || item.manufacturerPartNumber?.trim() || modelFromInfo(info, sku),
        sku,
        desc: item.desc,
        qty: item.qty,
        unit: item.unit || "ea",
        unitCost: item.cost,
        label: section.name,
      });
    }
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

/** The consolidated parts list (#262) — identical parts merged, first-appearance order. */
export function partsListRows(
  sections: SpecSection[],
  vendorQuotes: VendorQuote[],
  info: Record<string, PartInfo>
): PartsListRow[] {
  const rows = new Map<string, PartsListRow>();
  for (const e of expand(sections, vendorQuotes, info)) {
    const key = e.sku || e.modelNumber
      ? `p|${e.manufacturer}|${e.modelNumber}|${e.sku}|${e.unit}|${round2(e.unitCost)}`
      : `d|${e.desc}|${e.unit}|${round2(e.unitCost)}`;
    const row = rows.get(key);
    if (row) {
      row.qty += e.qty;
      if (!row.usedIn.includes(e.label)) row.usedIn.push(e.label);
    } else {
      const { label, ...rest } = e;
      rows.set(key, { ...rest, extCost: 0, usedIn: [label] });
    }
  }
  const out = [...rows.values()];
  for (const r of out) r.extCost = round2(r.qty * r.unitCost);
  return out;
}

/** CSV body rows under PARTS_CSV_HEADER (#262) plus a final Total row; [] when empty. */
export function partsListCsvRows(rows: PartsListRow[]): (string | number)[][] {
  if (rows.length === 0) return [];
  const body: (string | number)[][] = rows.map((r) => [
    r.manufacturer,
    r.modelNumber,
    r.sku,
    r.desc,
    r.qty,
    r.unit,
    r.unitCost.toFixed(2),
    r.extCost.toFixed(2),
    r.usedIn.join("; "),
  ]);
  const total = rows.reduce((a, r) => a + r.extCost, 0);
  body.push(["", "", "", "Total", "", "", "", total.toFixed(2), ""]);
  return body;
}
