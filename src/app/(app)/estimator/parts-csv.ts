import type { SpecItem, SpecSection, VendorQuote } from "./types";

/** The Estimator's "Parts list (CSV)" export for the project manager (#262) —
 *  every orderable part in the estimate's material systems, assemblies
 *  exploded into their components, vendor quotes into their lines, identical
 *  parts consolidated per room + system. Σ qty × Unit Cost equals the
 *  estimate's material cost; Σ qty × Unit Sell equals its material sell.
 *  Pure: no React, no server imports. */

/** Catalog facts for one SKU, keyed by the trimmed SKU (#262). */
export type PartInfo = { mfr?: string; manufacturerPartNumber?: string; manufacturerModelNumber?: string; desc?: string };

/** One consolidated row of the parts list (#262). `unitCost`/`unitSell` stay
 *  unrounded; `sku` and `unit` are kept for merging + the unit note, never
 *  printed as columns. */
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
  partOf: string[];
  notes: string[];
};

export const PARTS_CSV_HEADER: string[] = [
  "Manufacturer",
  "Model number",
  "Room",
  "System",
  "Qty",
  "Unit Cost",
  "Unit Sell",
  "Description",
  "Notes",
];

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

/** Unit sell of one estimate line (#262) — a typed extended sell wins over the unit price. */
function lineSellOf(item: SpecItem): number {
  return typeof item.extSellOverride === "number" && Number.isFinite(item.extSellOverride)
    ? item.extSellOverride / item.qty
    : item.price;
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
    const room = section.room?.trim() || defaultRoom.trim();
    const system = section.name;
    for (const item of section.items) {
      if (item.labor || item.laborOverhead || item.option) continue;
      if (!Number.isFinite(item.qty) || item.qty <= 0) continue;
      const lineSell = lineSellOf(item);
      const note = item.internalNote?.trim() || "";
      const notes = note ? [note] : [];

      const vq = item.vendorQuoteId ? vendorQuotes.find((v) => v.id === item.vendorQuoteId) : undefined;
      if (vq && vq.lines.length > 0) {
        const vqName = `Vendor quote ${vq.vendor}${vq.quoteNumber ? " #" + vq.quoteNumber : ""}`;
        let linesTotal = 0;
        for (const line of vq.lines) if (line.qty > 0) linesTotal += line.amount;
        for (const line of vq.lines) {
          if (!(line.qty > 0)) continue;
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
            unitSell: linesTotal > 0 ? (lineSell * line.amount / linesTotal) / line.qty : 0,
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
            unitSell: sellOf(comp),
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
        modelNumber: item.manufacturerModelNumber?.trim() || item.manufacturerPartNumber?.trim() || modelFromInfo(info, sku),
        room,
        system,
        sku,
        desc: item.desc,
        qty: item.qty,
        unit: item.unit || "ea",
        unitCost: item.cost,
        unitSell: lineSell,
        partOf: [],
        notes,
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

/** The consolidated parts list (#262) — identical parts within one room +
 *  system merged, first-appearance order. */
export function partsListRows(
  sections: SpecSection[],
  vendorQuotes: VendorQuote[],
  info: Record<string, PartInfo>,
  defaultRoom = ""
): PartsListRow[] {
  const rows = new Map<string, PartsListRow>();
  for (const e of expand(sections, vendorQuotes, info, defaultRoom)) {
    const key = e.sku || e.modelNumber
      ? `p|${e.room}|${e.system}|${e.manufacturer}|${e.modelNumber}|${e.sku}|${e.unit}|${round2(e.unitCost)}|${round2(e.unitSell)}`
      : `d|${e.room}|${e.system}|${e.desc}|${e.unit}|${round2(e.unitCost)}|${round2(e.unitSell)}`;
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

/** CSV body rows under PARTS_CSV_HEADER (#262); [] when empty. Notes carries
 *  "Part of: …", a "per <unit>" for anything not sold each, then internal notes. */
export function partsListCsvRows(rows: PartsListRow[]): (string | number)[][] {
  return rows.map((r) => {
    const notes: string[] = [];
    if (r.partOf.length > 0) notes.push("Part of: " + r.partOf.join(", "));
    if (r.unit !== "ea") notes.push("per " + r.unit);
    notes.push(...r.notes);
    return [
      r.manufacturer,
      r.modelNumber,
      r.room,
      r.system,
      r.qty,
      r.unitCost.toFixed(2),
      r.unitSell.toFixed(2),
      r.desc,
      notes.join("; "),
    ];
  });
}
