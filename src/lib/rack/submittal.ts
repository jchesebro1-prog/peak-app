/**
 * #296 — the pure rack submittal model. From a saved rack record and a part
 * lookup it builds the equipment schedule, the rack-level rows, the power and
 * heat lines, the issues, the datasheet SKU order and the schedule CSV. The
 * printed sheets, the zip and the client package (Tasks 11–13) only render
 * what this returns. No React, no store/db imports.
 *
 * Imperial: inches, pounds, watts, BTU/hr. Absent = unknown, never zero —
 * an unknown number is `null` here (printed "—") and a total that has
 * unknowns reads "at least …".
 */
import { parseVirtualPartId } from "@/lib/design/grid-virtual-parts";
import type { FixtureRecord } from "@/lib/fixture-assemblies";
import { emptyRackLayout, placementFacts, ruRangeLabel } from "./layout";
import { RACK_FACT_LABEL, rackFactsOf, rackModelOf } from "./part-facts";
import { ruLabel, totals as rackTotals, validate } from "./rules";
import { CIRCUIT_VOLTS, type RackIssue, type RackLayout, type RackPartLookup, type RackPlacement, type RackTotals } from "./types";

export type ScheduleRow = {
  ru: string;
  face: "Front" | "Rear" | "";
  qty: number;
  mfr: string;
  sku: string;
  /** #302: the Model # a customer sheet prints (`sku` stays the lookup key); absent → print the sku. */
  model?: string;
  desc: string;
  depthIn: number | null;
  weightLb: number | null;
  watts: number | null;
  notes: string;
  optional: boolean;
  reserved: boolean;
};
export type RackLevelRow = { qty: number; mfr: string; sku: string; model?: string; desc: string; weightLb: number | null; watts: number | null };
export type RackSubmittalGap = { sku: string; label: string; kind: "missing-data" | "missing-datasheet" | "missing-catalog"; detail: string };
export type RackSubmittal = {
  title: string;
  scope?: string;
  ruCount: number;
  /** Top → bottom by display order (highest RU first), front before rear at equal RU; shelf children right after their shelf. */
  schedule: ScheduleRow[];
  rackLevel: RackLevelRow[];
  totals: RackTotals;
  issues: RackIssue[];
  power: { circuitAmps: number; capacityWatts: number | null; loadPct: number | null; lines: string[] };
  /** Distinct SKUs: schedule order (no reserved), then rack-level parts in list order. */
  datasheetSkus: string[];
  /** Model-level gaps only; the server step adds missing-datasheet gaps. */
  gaps: RackSubmittalGap[];
};

/* ---------- formatting ---------- */

const num1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });

export function formatWatts(n: number): string {
  return `${num1(n)} W`;
}
export function formatBtu(n: number): string {
  return `${Math.round(n).toLocaleString("en-US")} BTU/hr`;
}
export function formatLb(n: number): string {
  return `${num1(n)} lb`;
}
/** "33% loaded", or "at least 33% loaded" while any part's watts are unknown. */
export function pduLoad(loadPct: number, unknownWatts: number): string {
  return `${unknownWatts > 0 ? "at least " : ""}${loadPct}% loaded`;
}

/* ---------- the model ---------- */

const orNull = (n: number | undefined): number | null => (typeof n === "number" && Number.isFinite(n) ? n : null);
const topOf = (p: RackPlacement) => p.ruStart + p.ruHeight - 1;

/** Top-level placements highest RU first, front before rear, lane ascending; each shelf's children right after it. */
function scheduleOrder(layout: RackLayout): RackPlacement[] {
  const idx = new Map(layout.placements.map((p, i) => [p.id, i]));
  const laneOf = (p: RackPlacement) => p.lane ?? 0;
  const byLane = (a: RackPlacement, b: RackPlacement) => laneOf(a) - laneOf(b) || idx.get(a.id)! - idx.get(b.id)!;
  const tops = layout.placements
    .filter((p) => !p.shelfId)
    .sort((a, b) => topOf(b) - topOf(a) || (a.face === b.face ? 0 : a.face === "front" ? -1 : 1) || byLane(a, b));
  const out: RackPlacement[] = [];
  for (const p of tops) {
    out.push(p);
    if (p.kind === "shelf") out.push(...layout.placements.filter((c) => c.shelfId === p.id).sort(byLane));
  }
  // A child whose shelf is missing would vanish; keep it visible at the end.
  const seen = new Set(out.map((p) => p.id));
  for (const p of layout.placements) if (!seen.has(p.id)) out.push(p);
  return out;
}

export function rackSubmittal(rec: Pick<FixtureRecord, "label" | "scope" | "rack" | "parts">, lookup: RackPartLookup): RackSubmittal {
  const layout: RackLayout = rec.rack ?? emptyRackLayout();
  const { config } = layout;
  const parts = (rec.parts ?? []).filter((l) => l.qty > 0);

  const shelfOf = (p: RackPlacement) => (p.shelfId ? layout.placements.find((q) => q.id === p.shelfId && q.kind === "shelf") : undefined);

  const schedule: ScheduleRow[] = scheduleOrder(layout).map((p) => {
    const shelf = shelfOf(p);
    const ru = shelf
      ? `on shelf RU ${Math.min(ruLabel(config, shelf.ruStart), ruLabel(config, topOf(shelf)))}`
      : ruRangeLabel(config, p.ruStart, topOf(p));
    const face = p.face === "rear" ? "Rear" : "Front";
    if (p.kind === "reserved") {
      return { ru, face, qty: 1, mfr: "", sku: "", model: "", desc: "Reserved — future", depthIn: null, weightLb: null, watts: null, notes: p.notes ?? "", optional: false, reserved: true };
    }
    const info = p.sku ? lookup(p.sku) : undefined;
    const f = placementFacts(p, lookup);
    const notes = p.optional ? (p.notes ? `Optional — ${p.notes}` : "Optional") : (p.notes ?? "");
    return {
      ru,
      face,
      qty: 1,
      mfr: info?.mfr || "",
      sku: p.sku ?? "",
      model: p.sku ? rackModelOf(info, p.sku) : "",
      desc: p.label || info?.desc || p.sku || "",
      depthIn: orNull(f.depthIn),
      weightLb: orNull(f.weightLb),
      watts: orNull(f.powerWatts),
      notes,
      optional: !!p.optional,
      reserved: false,
    };
  });

  // Labor/travel rows (internal) price in the Estimator but are no equipment: no row, datasheet or gap.
  const isInternal = (sku: string) => !!lookup(sku)?.internal;
  const rackLevel: RackLevelRow[] = parts.filter((l) => !isInternal(l.sku)).map((l) => {
    const info = lookup(l.sku);
    const f = rackFactsOf(info);
    return { qty: l.qty, mfr: info?.mfr || "", sku: l.sku, model: rackModelOf(info, l.sku), desc: l.label || info?.desc || l.sku, weightLb: orNull(f.weightLb), watts: orNull(f.powerWatts) };
  });

  const t = rackTotals(layout, lookup, parts.map((l) => ({ sku: l.sku, qty: l.qty })));
  const issues = validate(layout, lookup);

  // Power, heat and weight in plain sentences.
  const cap = t.capacityWatts;
  const loadPct = cap !== null && cap > 0 ? Math.round((t.watts / cap) * 100) : null;
  // Every watts-derived figure hedges "At least" while any part's watts are unknown (as the sheet's totals grid does).
  const hedge = t.unknownWatts > 0 ? "At least " : "";
  const lines = [
    t.unknownWatts > 0
      ? `At least ${formatWatts(t.watts)} typical (${t.unknownWatts} part${t.unknownWatts === 1 ? "" : "s"} unknown)`
      : `${formatWatts(t.watts)} typical`,
    `${hedge}${formatWatts(t.maxWatts)} maximum`,
    `${hedge}${formatBtu(t.btuHr)}`,
    `${hedge}${t.amps.toFixed(1)} A at ${CIRCUIT_VOLTS} V`,
    ...(cap !== null && loadPct !== null ? [`PDU capacity ${formatWatts(cap)} — ${pduLoad(loadPct, t.unknownWatts)}`] : []),
    t.unknownWeight > 0 ? `At least ${formatLb(t.weightLb)}` : formatLb(t.weightLb),
  ];

  const datasheetSkus: string[] = [];
  const seenSku = new Set<string>();
  for (const sku of [...schedule.filter((r) => !r.reserved).map((r) => r.sku), ...rackLevel.map((r) => r.sku)]) {
    if (!sku || seenSku.has(sku) || isInternal(sku)) continue;
    seenSku.add(sku);
    datasheetSkus.push(sku);
  }

  // Name a SKU the way the schedule does: placement label, catalog description, then the SKU.
  const nameOf = (sku: string) => lookup(sku)?.desc || schedule.find((r) => r.sku === sku)?.desc || rackLevel.find((r) => r.sku === sku)?.desc || sku;
  const gaps: RackSubmittalGap[] = [];
  for (const sku of datasheetSkus) {
    if (lookup(sku)?.found !== true) gaps.push({ sku, label: nameOf(sku), kind: "missing-catalog", detail: "Not in the catalog." });
  }
  for (const m of t.missingData) {
    gaps.push({ sku: m.sku, label: m.label, kind: "missing-data", detail: `Missing ${m.fields.map((f) => RACK_FACT_LABEL[f]).join(", ")}` });
  }

  return {
    title: rec.label,
    ...(rec.scope ? { scope: rec.scope } : {}),
    ruCount: config.ruCount,
    schedule,
    rackLevel,
    totals: t,
    issues,
    power: { circuitAmps: t.amps, capacityWatts: cap, loadPct, lines },
    datasheetSkus,
    gaps,
  };
}

/* ---------- CSV ---------- */

/** A text cell: formula-looking text gets a leading apostrophe, then RFC 4180 quoting. */
function textCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
/** A number cell: unformatted, blank for unknown. */
const numCell = (n: number | null) => (n === null ? "" : String(n));

const CSV_BOM = "﻿";
export const SCHEDULE_CSV_HEADER = ["RU", "Face", "Qty", "Manufacturer", "Model/SKU", "Description", "Depth (in)", "Weight (lb)", "Watts", "Notes"].join(",");
export const RACK_LEVEL_CSV_HEADER = ["Qty", "Manufacturer", "Model/SKU", "Description", "Weight (lb)", "Watts"].join(",");

export function scheduleCsv(s: RackSubmittal): string {
  const lines: string[] = [SCHEDULE_CSV_HEADER];
  for (const r of s.schedule) {
    lines.push(
      [textCell(r.ru), textCell(r.face), numCell(r.qty), textCell(r.mfr), textCell(r.model || r.sku), textCell(r.desc), numCell(r.depthIn), numCell(r.weightLb), numCell(r.watts), textCell(r.notes)].join(",")
    );
  }
  lines.push("", "Rack-level parts", RACK_LEVEL_CSV_HEADER);
  for (const r of s.rackLevel) {
    lines.push([numCell(r.qty), textCell(r.mfr), textCell(r.model || r.sku), textCell(r.desc), numCell(r.weightLb), numCell(r.watts)].join(","));
  }
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

/* ---------- which racks a Grid or a quote carries ---------- */

type KindOf = (id: string) => { kind?: string } | null | undefined;

/** Distinct rack fixture ids among a Grid's `asm:<id>` part ids, in first-seen order. */
export function racksInGrid(partIds: Iterable<string>, fixtureOf: KindOf): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const partId of partIds) {
    const ref = parseVirtualPartId(partId);
    if (!ref || ref.kind !== "assembly" || seen.has(ref.id)) continue;
    seen.add(ref.id);
    if (fixtureOf(ref.id)?.kind === "rack") out.push(ref.id);
  }
  return out;
}

/** = the submittal route's RACK_ID: one id length everywhere a rack id is read. */
const FIXTURE_ID = /^SA-[A-Z0-9-]{1,60}$/;

/** Distinct rack ids on a quote's items (`rackId`, else `fixtureId`). Items have no save-time sanitizer, so every id is validated here. */
export function racksInQuote(items: ReadonlyArray<{ rackId?: unknown; fixtureId?: unknown }>, fixtureOf: KindOf): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    for (const raw of [it?.rackId, it?.fixtureId]) {
      if (typeof raw !== "string" || !FIXTURE_ID.test(raw) || seen.has(raw)) continue;
      if (fixtureOf(raw)?.kind !== "rack") continue;
      seen.add(raw);
      out.push(raw);
      break;
    }
  }
  return out;
}
