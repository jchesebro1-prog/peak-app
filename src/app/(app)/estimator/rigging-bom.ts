import { sellAt } from "@/lib/markup";
import type { ResolvedFixtureAssembly } from "@/lib/fixture-assemblies";
import { linesetQuantities } from "@/lib/rigging-config/lineset";
import { pipeQuantities } from "@/lib/rigging-config/pipe";
import {
  LINESET_ROLES, LINESET_ROLE_NAMES, LINESET_TYPES_HOME, PIPE_TYPES_HOME, isFootUnit,
  type LinesetConfig, type LinesetRole, type LinesetSource, type LinesetType, type PipeConfig, type PipeType,
} from "@/lib/rigging-config/types";
import { round2 } from "./pricing";
import { catalogAddPrice, seedMarkupOf } from "./tier-reprice";
import type { CurtainDraft, LinesetDraft, PipeDraft, SpecItem, TrackPart } from "./types";

/**
 * #373 — pricing a configured pipe or lineset and the one estimate line it
 * becomes. Pure. The engines say how many of each role; each role resolves to a
 * catalog part or a Hardware assembly's included members, priced exactly as
 * trackBom prices a track's parts, so the line is an ordinary tier-seeded line.
 * An assembly's members use its resolved cost but sell at the tier, never at the
 * assembly's own sell, which keeps the whole line on one seed.
 */

type Member = { sku: string; label: string; qty: number; unit: string; cost: number; list: number };
export type RiggingAssembly = { name: string; members: Member[]; broken: boolean };
export type RiggingCatalog = { parts: Record<string, TrackPart>; assemblies: Record<string, RiggingAssembly> };

export type RiggingBomRow = {
  key: string;
  label: string;
  sku: string;
  desc: string;
  qty: number;
  unit: string;
  cost: number;
  price: number;
  ext: number;
  missing: boolean;
  mount: boolean;
};
export type RiggingBom = { rows: RiggingBomRow[]; errors: string[]; warnings: string[]; cost: number; price: number };

export const RIGGING_TYPE_GONE = "This type no longer exists.";

/** The client's lookup: the mapped parts plus every Hardware assembly (add-ons left out). */
export function riggingCatalog(parts: Record<string, TrackPart>, assemblies: readonly ResolvedFixtureAssembly[]): RiggingCatalog {
  const out: Record<string, RiggingAssembly> = {};
  for (const a of assemblies) {
    if (a.kind !== "hardware") continue;
    const included = a.components.filter((c) => c.defaultQty > 0);
    out[a.id] = {
      name: a.name,
      members: included.map((c) => ({ sku: c.sku, label: c.label || c.sku, qty: c.defaultQty, unit: c.unit, cost: c.cost, list: c.list })),
      broken: !included.length || included.some((c) => !c.found),
    };
  }
  return { parts, assemblies: out };
}

type Wanted = { key: string; label: string; qty: number; source: LinesetSource | null; mount?: boolean; unit?: "foot" | "notFoot" };

function own<T>(rec: Record<string, T>, k: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : undefined;
}

function priceRows(typeName: string, home: string, wanted: readonly Wanted[], catalog: RiggingCatalog, tierMargin: number | null | undefined): RiggingBom {
  const k = seedMarkupOf(tierMargin);
  const errors: string[] = [];
  const warnings: string[] = [];
  const rows: RiggingBomRow[] = [];
  let cost = 0;
  let costed = 0;
  let listed = 0;
  const add = (key: string, label: string, sku: string, desc: string, qty: number, unit: string, unitCost: number, unitList: number, mount: boolean) => {
    const price = catalogAddPrice(unitCost, unitList, tierMargin);
    cost += unitCost * qty;
    if (unitCost > 0) costed += unitCost * qty;
    else listed += unitList * qty;
    rows.push({ key, label, sku, desc, qty, unit, cost: unitCost, price, ext: round2(price * qty), missing: false, mount });
  };
  const miss = (w: Wanted, desc: string) => {
    errors.push(`${typeName} has no part for ${w.label} — map it in ${home}.`);
    rows.push({ key: w.key, label: w.label, sku: "", desc, qty: w.qty, unit: "", cost: 0, price: 0, ext: 0, missing: true, mount: !!w.mount });
  };
  for (const w of wanted) {
    if (!w.source) {
      miss(w, "No part mapped");
    } else if (w.source.kind === "part") {
      const p = own(catalog.parts, w.source.sku);
      if (!p) {
        miss(w, `${w.source.sku} — no longer in the catalog`);
        continue;
      }
      add(w.key, w.label, p.sku, p.desc || w.label, w.qty, p.unit || "ea", Number(p.cost) || 0, Number(p.list) || 0, !!w.mount);
      if (w.unit === "foot" && !isFootUnit(p.unit)) warnings.push(`${w.label} part ${p.sku} sells by "${p.unit || "ea"}", but this counts feet. Check the price.`);
      if (w.unit === "notFoot" && isFootUnit(p.unit)) warnings.push(`${w.label} part ${p.sku} sells by the foot, but this counts whole sticks. Check the price.`);
    } else {
      const a = own(catalog.assemblies, w.source.id);
      if (!a || a.broken) {
        miss(w, a ? `${a.name} — a part is no longer in the catalog` : "Assembly no longer exists");
        continue;
      }
      a.members.forEach((m, i) => add(`${w.key}:${i}`, `${w.label}: ${m.label}`, m.sku, m.label, w.qty * m.qty, m.unit || "ea", Number(m.cost) || 0, Number(m.list) || 0, !!w.mount));
    }
  }
  const price = errors.length ? 0 : round2(sellAt(costed, k) + listed);
  if (!errors.length && !(price > 0)) errors.push(`${typeName}'s parts have no cost or price in the catalog.`);
  return { rows, errors, warnings, cost: errors.length ? 0 : cost, price };
}

const partSource = (sku: string | undefined): LinesetSource | null => (sku ? { kind: "part", sku } : null);
const empty = (error: string): RiggingBom => ({ rows: [], errors: [error], warnings: [], cost: 0, price: 0 });

export function pipeBom(config: PipeConfig, type: PipeType | null | undefined, catalog: RiggingCatalog, tierMargin: number | null | undefined): RiggingBom {
  if (!type) return empty(RIGGING_TYPE_GONE);
  const q = pipeQuantities(config, type);
  if (q.errors.length) return { rows: [], errors: q.errors, warnings: [], cost: 0, price: 0 };
  const wanted = q.rows.map((r): Wanted => {
    if (r.role === "stick") return { key: "stick", label: `Pipe (${fmtFt(r.lengthFt!)} stick)`, qty: r.qty, source: partSource(r.sku), unit: "notFoot" };
    if (r.role === "splice") return { key: "splice", label: "Splice sleeve", qty: r.qty, source: partSource(type.spliceSku) };
    return { key: "clamp", label: "Hanging clamp", qty: r.qty, source: partSource(type.clampSku), mount: true };
  });
  return priceRows(type.name, PIPE_TYPES_HOME, wanted, catalog, tierMargin);
}

export function linesetBom(config: LinesetConfig, type: LinesetType | null | undefined, catalog: RiggingCatalog, tierMargin: number | null | undefined): RiggingBom {
  if (!type) return empty(RIGGING_TYPE_GONE);
  const q = linesetQuantities(config, type);
  if (q.errors.length) return { rows: [], errors: q.errors, warnings: [], cost: 0, price: 0 };
  const qty = (role: LinesetRole) => q.rows.find((r) => r.role === role)?.qty ?? 0;
  const wanted = LINESET_ROLES.map((role): Wanted => ({
    key: role,
    label: LINESET_ROLE_NAMES[role],
    qty: qty(role),
    source: type.parts[role] ?? null,
    ...(role === "cable" || role === "handLine" ? { unit: "foot" as const } : {}),
  }));
  return priceRows(type.name, LINESET_TYPES_HOME, wanted, catalog, tierMargin);
}

/** "40'", "12.5'". */
export function fmtFt(n: number): string {
  return (Math.round(n * 100) / 100).toString() + "'";
}

export function pipeLineDesc(c: PipeConfig, type: Pick<PipeType, "name">): string {
  const label = (c.label || "").trim() || "Pipe";
  return `${label} — ${type.name}, ${fmtFt(c.runFt)} run${c.qty > 1 ? ` (${c.qty} pipes)` : ""}`;
}

export function linesetLineDesc(c: LinesetConfig, type: Pick<LinesetType, "name">, liftLines: number): string {
  const label = (c.label || "").trim() || "Lineset hardware";
  return `${label} — ${type.name}: ${c.sets} ${c.sets === 1 ? "set" : "sets"}, ${liftLines} lift ${liftLines === 1 ? "line" : "lines"}`;
}

export type RiggingLineResult = { ok: true; item: Omit<SpecItem, "id">; bom: RiggingBom } | { ok: false; errors: string[]; bom: RiggingBom };

function buildLine(sku: string, desc: string, rigging: NonNullable<SpecItem["rigging"]>, manufacturer: string, bom: RiggingBom): RiggingLineResult {
  const components: NonNullable<SpecItem["components"]> = bom.rows.map((r) => ({
    sku: r.sku,
    label: r.label,
    role: r.mount ? "mount" : "other",
    qty: r.qty,
    unit: r.unit,
    cost: r.cost,
    price: r.price,
  }));
  const item: Omit<SpecItem, "id"> = { sku, desc, qty: 1, unit: "lot", cost: bom.cost, price: bom.price, components, rigging };
  if (manufacturer) item.manufacturer = manufacturer;
  return { ok: true, item, bom };
}

export function cleanPipeConfig(c: PipeConfig): PipeConfig {
  const label = (c.label || "").trim();
  return { typeId: c.typeId, runFt: c.runFt, qty: c.qty, ...(c.hangerSpacingFt != null ? { hangerSpacingFt: c.hangerSpacingFt } : {}), ...(label ? { label } : {}) };
}

export function cleanLinesetConfig(c: LinesetConfig): LinesetConfig {
  const label = (c.label || "").trim();
  return {
    typeId: c.typeId, sets: c.sets, widthFt: c.widthFt, gridHeightFt: c.gridHeightFt,
    ...(c.linesPerSet != null ? { linesPerSet: c.linesPerSet } : {}),
    ...(c.allowanceFt != null ? { allowanceFt: c.allowanceFt } : {}),
    ...(label ? { label } : {}),
  };
}

export function pipeLine(config: PipeConfig, type: PipeType | null | undefined, catalog: RiggingCatalog, tierMargin: number | null | undefined): RiggingLineResult {
  const bom = pipeBom(config, type, catalog, tierMargin);
  if (!type || bom.errors.length) return { ok: false, errors: bom.errors, bom };
  return buildLine("PIP-" + type.id.toUpperCase(), pipeLineDesc(config, type), { kind: "pipe", ...cleanPipeConfig(config) }, type.manufacturer, bom);
}

export function linesetLine(config: LinesetConfig, type: LinesetType | null | undefined, catalog: RiggingCatalog, tierMargin: number | null | undefined): RiggingLineResult {
  const bom = linesetBom(config, type, catalog, tierMargin);
  if (!type || bom.errors.length) return { ok: false, errors: bom.errors, bom };
  const { liftLines } = linesetQuantities(config, type);
  return buildLine("LNS-" + type.id.toUpperCase(), linesetLineDesc(config, type, liftLines), { kind: "lineset", ...cleanLinesetConfig(config) }, type.manufacturer, bom);
}

/* ---------------- drafts ---------------- */

const numOf = (s: string): number => {
  const t = (s ?? "").trim();
  return t === "" ? NaN : Number(t);
};
const optionalNum = (s: string): number | undefined => {
  const t = (s ?? "").trim();
  return t === "" ? undefined : Number(t);
};
const str = (n: number | undefined) => (n != null && Number.isFinite(n) ? String(n) : "");

export function selectableTypes<T extends { id: string; active: boolean }>(all: readonly T[], keepId?: string): T[] {
  return all.filter((t) => t.active || (!!keepId && t.id === keepId));
}

export function freshPipeDraft(all: readonly PipeType[]): PipeDraft {
  return { typeId: selectableTypes(all)[0]?.id || "", run: "", qty: "1", hangerSpacing: "", label: "" };
}

export function pipeConfigFromDraft(d: PipeDraft): PipeConfig {
  const qtyText = (d.qty ?? "").trim();
  const label = (d.label || "").trim();
  const spacing = optionalNum(d.hangerSpacing);
  return { typeId: d.typeId, runFt: numOf(d.run), qty: qtyText === "" ? 1 : Number(qtyText), ...(spacing !== undefined ? { hangerSpacingFt: spacing } : {}), ...(label ? { label } : {}) };
}

export function pipeDraftFromConfig(c: PipeConfig): PipeDraft {
  return { typeId: c.typeId, run: str(c.runFt), qty: str(c.qty), hangerSpacing: str(c.hangerSpacingFt), label: c.label || "" };
}

export function freshLinesetDraft(all: readonly LinesetType[]): LinesetDraft {
  return { typeId: selectableTypes(all)[0]?.id || "", sets: "", width: "", gridHeight: "", linesPerSet: "", allowance: "", label: "" };
}

export function linesetConfigFromDraft(d: LinesetDraft): LinesetConfig {
  const label = (d.label || "").trim();
  const lines = optionalNum(d.linesPerSet);
  const allowance = optionalNum(d.allowance);
  return {
    typeId: d.typeId, sets: numOf(d.sets), widthFt: numOf(d.width), gridHeightFt: numOf(d.gridHeight),
    ...(lines !== undefined ? { linesPerSet: lines } : {}),
    ...(allowance !== undefined ? { allowanceFt: allowance } : {}),
    ...(label ? { label } : {}),
  };
}

export function linesetDraftFromConfig(c: LinesetConfig): LinesetDraft {
  return { typeId: c.typeId, sets: str(c.sets), width: str(c.widthFt), gridHeight: str(c.gridHeightFt), linesPerSet: str(c.linesPerSet), allowance: str(c.allowanceFt), label: c.label || "" };
}

/* ---------------- Add pipe from a curtain ---------------- */

export type CurtainPipePrefill = Pick<PipeDraft, "run" | "qty" | "label">;

export function curtainPipePrefill(c: Pick<CurtainDraft, "name" | "qty" | "width">): CurtainPipePrefill {
  const width = parseFloat(c.width) || 0;
  const name = (c.name || "").trim();
  return { run: width > 0 ? String(Math.round(width * 100) / 100) : "", qty: String(Math.max(1, parseInt(c.qty, 10) || 1)), label: name ? name + " pipe" : "" };
}

export function curtainPipeDraft(c: Pick<CurtainDraft, "name" | "qty" | "width">, all: readonly PipeType[]): PipeDraft {
  return { ...freshPipeDraft(all), ...curtainPipePrefill(c) };
}

/** The curtain changed: every pre-filled field the user hasn't touched follows; anything typed is kept. */
export function followCurtainPipePrefill(d: PipeDraft, prev: CurtainPipePrefill, next: CurtainPipePrefill): PipeDraft {
  const out = { ...d };
  if (d.run === prev.run) out.run = next.run;
  if (d.qty === prev.qty) out.qty = next.qty;
  if (d.label === prev.label) out.label = next.label;
  return out;
}
