import type { CatalogPart } from "@/lib/stores/catalog";
import { effectivePriceDate, type PriceDateSettings } from "./catalog-books";

export const ASSEMBLY_ROLES = [
  "fixture", "lens", "mount", "accessory", "cable", "power", "data", "lamp", "other",
] as const;
export type AssemblyRole = (typeof ASSEMBLY_ROLES)[number];

export type FixtureAssemblyComponent = {
  sku: string;
  /** User-facing label used in the Estimator/BOM, independent of vendor copy. */
  label: string;
  role: AssemblyRole;
  /** Zero keeps the component available but does not add it by default. */
  defaultQty: number;
  /** Optional per-assembly landed-cost override, primarily for included ETC power cable. */
  costOverride?: number;
};

export type FixtureAssembly = {
  id: string;
  name: string;
  components: FixtureAssemblyComponent[];
};

export type ResolvedAssemblyComponent = FixtureAssemblyComponent & {
  desc: string;
  unit: string;
  cost: number;
  list: number;
  found: boolean;
};
export type ResolvedFixtureAssembly = Omit<FixtureAssembly, "components"> & {
  components: ResolvedAssemblyComponent[];
  /** #FXB — the fixture's default hang position / circuit (Estimator pre-fill). */
  position?: string;
  circuit?: string;
};

export function sanitizeFixtureAssemblies(value: unknown): FixtureAssembly[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): FixtureAssembly[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Partial<FixtureAssembly>;
    const id = String(item.id || "").trim().slice(0, 80);
    const name = String(item.name || "").trim().slice(0, 160);
    if (!id || !name || !Array.isArray(item.components)) return [];
    const components = item.components.flatMap((part): FixtureAssemblyComponent[] => {
      if (!part || typeof part !== "object") return [];
      const p = part as Partial<FixtureAssemblyComponent>;
      const sku = String(p.sku || "").trim().slice(0, 160);
      if (!sku) return [];
      const role = ASSEMBLY_ROLES.includes(p.role as AssemblyRole) ? p.role as AssemblyRole : "other";
      const qty = Number(p.defaultQty);
      const costOverride = Number(p.costOverride);
      return [{
        sku,
        label: String(p.label || sku).trim().slice(0, 160) || sku,
        role,
        defaultQty: Number.isFinite(qty) ? Math.max(0, Math.round(qty * 100) / 100) : 0,
        ...(Number.isFinite(costOverride) && costOverride >= 0 ? { costOverride } : {}),
      }];
    });
    return components.length ? [{ id, name, components }] : [];
  });
}

export function resolveFixtureAssemblies(
  stored: unknown,
  catalog: Array<Pick<CatalogPart, "sku" | "desc" | "unit" | "cost" | "list">>
): ResolvedFixtureAssembly[] {
  const bySku = new Map(catalog.map((part) => [part.sku, part]));
  return sanitizeFixtureAssemblies(stored).map((assembly) => ({
    ...assembly,
    components: assembly.components.map((component) => {
      const part = bySku.get(component.sku);
      return {
        ...component,
        desc: part?.desc || "Catalog part not found",
        unit: part?.unit || "ea",
        cost: Number.isFinite(component.costOverride) ? component.costOverride! : Number(part?.cost) || 0,
        list: Number(part?.list) || 0,
        found: !!part,
      };
    }),
  }));
}

export function assemblyUnitTotals(assembly: ResolvedFixtureAssembly): { cost: number; sell: number } {
  return assembly.components.reduce(
    (totals, component) => ({
      cost: totals.cost + component.cost * component.defaultQty,
      sell: totals.sell + component.list * component.defaultQty,
    }),
    { cost: 0, sell: 0 }
  );
}

export function assemblyDescription(assembly: ResolvedFixtureAssembly): string {
  const included = assembly.components
    .filter((component) => component.defaultQty > 0)
    .map((component) => component.defaultQty === 1 ? component.label : `${component.label} ×${component.defaultQty}`);
  return included.length ? `${assembly.name} — ${included.join("; ")}` : assembly.name;
}

/* ---- #129 — subassemblies resolve live, like assemblies ------------------ */

export const FIXTURE_OPTION_CATEGORIES: readonly FixtureOptionCategory[] = ["data", "power", "mounting", "accessories"];

/** A catalog as an array or an already-built SKU map (#FXB — the builder
 *  resolves many records against ~37k parts; build the map once). */
export type SkuLookup<P extends { sku: string }> = ReadonlyArray<P> | ReadonlyMap<string, P>;

export function toSkuMap<P extends { sku: string }>(catalog: SkuLookup<P>): ReadonlyMap<string, P> {
  if (catalog instanceof Map) return catalog as ReadonlyMap<string, P>;
  return new Map((catalog as ReadonlyArray<P>).map((p) => [p.sku, p] as const));
}

/** "Prices as of": the NEWEST effective price date among the given SKUs
 *  (own pricedAt or the manufacturer's book date), null when none is dated. */
export function pricesAsOf(
  skus: string[],
  catalog: SkuLookup<{ sku: string; mfr?: string; pricedAt?: number }>,
  settings: PriceDateSettings = {}
): number | null {
  const bySku = toSkuMap(catalog);
  let newest: number | null = null;
  for (const sku of skus) {
    const part = bySku.get(sku);
    if (!part) continue;
    const at = effectivePriceDate(part, settings);
    if (at != null && (newest == null || at > newest)) newest = at;
  }
  return newest;
}

export type SubassemblyInput = {
  lightEngineSku: string;
  lensSku: string;
  /** Categories may be absent on older records and on the builder's draft. */
  options?: Partial<Record<FixtureOptionCategory, Array<{ sku: string; qty: number }>>>;
};

export type ResolvedSubassemblyPart = { sku: string; name: string; cost: number; found: boolean };
export type ResolvedSubassemblyOption = ResolvedSubassemblyPart & { qty: number };

export type ResolvedSubassembly = {
  lightEngine: ResolvedSubassemblyPart;
  lens: ResolvedSubassemblyPart;
  options: Record<FixtureOptionCategory, ResolvedSubassemblyOption[]>;
  optionsCost: number;
  cost: number;
  /** Equals cost — the legacy save-time formula priced fixtures at cost. */
  price: number;
  /** SKUs no longer in the catalog (priced at 0 above). */
  missing: string[];
  pricesAsOf: number | null;
};

/**
 * Price a fixture subassembly from the CURRENT catalog — exactly the formula
 * saveFixtureAction used to freeze at save time (engine cost + lens cost +
 * Σ option cost × qty), so a price-list import re-prices every fixture at
 * once. The saved record keeps its build-time numbers as `snapshot`.
 */
export function resolveSubassembly(
  sub: SubassemblyInput,
  catalog: Array<Pick<CatalogPart, "sku" | "desc" | "cost"> & { mfr?: string; pricedAt?: number }>,
  settings: PriceDateSettings = {}
): ResolvedSubassembly {
  const bySku = new Map(catalog.map((p) => [p.sku, p]));
  const missing: string[] = [];
  const partOf = (sku: string): ResolvedSubassemblyPart => {
    const p = bySku.get(sku);
    if (!p) {
      if (sku) missing.push(sku);
      return { sku, name: sku || "—", cost: 0, found: false };
    }
    return { sku: p.sku, name: p.desc, cost: Number(p.cost) || 0, found: true };
  };
  const lightEngine = partOf(sub.lightEngineSku);
  const lens = partOf(sub.lensSku);
  const options = { data: [], power: [], mounting: [], accessories: [] } as Record<FixtureOptionCategory, ResolvedSubassemblyOption[]>;
  let optionsCost = 0;
  const skus = [sub.lightEngineSku, sub.lensSku];
  for (const category of FIXTURE_OPTION_CATEGORIES) {
    for (const o of sub.options?.[category] || []) {
      const qty = Math.max(1, Math.round(Number(o.qty) || 1));
      const part = partOf(o.sku);
      options[category].push({ ...part, qty });
      optionsCost += part.cost * qty;
      skus.push(o.sku);
    }
  }
  const cost = lightEngine.cost + lens.cost + optionsCost;
  return { lightEngine, lens, options, optionsCost, cost, price: cost, missing, pricesAsOf: pricesAsOf(skus, catalog, settings) };
}


/* ======================================================================
   #FXB — one fixture builder (spec 2026-09-25-fixture-builder-merge-design.md).
   One record type for fixtures and systems, stored in the `subassemblies`
   doc table (src/lib/stores/fixtures.ts). Pure: client components import
   the constants, the resolver and the input sanitizer.
   ====================================================================== */

export const FIXTURE_BOXES = ["data", "power", "mounting", "accessories"] as const;
export type FixtureBox = (typeof FIXTURE_BOXES)[number];
/** Pre-#FXB name for the four boxes (the Subassemblies option categories). */
export type FixtureOptionCategory = FixtureBox;
export const FIXTURE_BOX_LABEL: Record<FixtureBox, string> = {
  data: "Data",
  power: "Power",
  mounting: "Mounting",
  accessories: "Accessories",
};

export const SYSTEM_SCOPES = ["Lighting", "Controls", "Audio", "Video", "Rigging", "Curtains", "Acoustical", "Pit", "Other"] as const;
export type SystemScope = (typeof SYSTEM_SCOPES)[number];

export type FixtureKind = "fixture" | "system";

/** One part line. qty ≥ 0; 0 = a compatible optional add-on (off by default). */
export type FixtureLine = { sku: string; label?: string; qty: number; costOverride?: number };

/** The light engine / lens row's optional extras. qty defaults to 1. Kept so
 *  a converted Assemblies-tab fixture member keeps its exact label, quantity
 *  and override (identical Estimator totals). */
export type HeadLine = { label?: string; qty?: number; costOverride?: number };

export type FixtureRecord = {
  id: string;
  kind: FixtureKind;
  label: string;
  description: string;
  /** System only. */
  scope?: SystemScope;
  /** Fixture: required. System: "". */
  lightEngineSku: string;
  lensSku: string | null;
  lightEngineLine?: HeadLine;
  lensLine?: HeadLine;
  lamp?: string;
  position?: string;
  circuit?: string;
  /** Fixture boxes (all four always present; empty for a system). */
  lines: Record<FixtureBox, FixtureLine[]>;
  /** System only — its one parts list. */
  parts?: FixtureLine[];
  /** Build-time numbers for the "was $X" badge (price = included sell). */
  snapshot?: { cost: number; price: number; pricedAt: number | null };
  /** Converted from an assembly with no fixture-role member (spec §3). */
  needsReview?: boolean;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
  updatedBy: string;
  /** Provenance of a converted row; `names` = the old stored names, shown
   *  only as fallback display for a part missing from the catalog. */
  legacy?: { from: "assembly" | "subassembly"; names?: Record<string, string> };
};

export type FixtureSlot = "lightEngine" | "lens" | FixtureBox | "parts";

export type FixtureCatalogPart = { sku: string; desc: string; unit?: string; cost: number; list: number; mfr?: string; pricedAt?: number };

export type FixtureResolvable = Pick<FixtureRecord, "id" | "kind" | "label" | "lightEngineSku" | "lensSku" | "lines"> &
  Partial<Pick<FixtureRecord, "lightEngineLine" | "lensLine" | "parts" | "legacy" | "position" | "circuit">>;

export type ResolvedFixturePart = {
  slot: FixtureSlot;
  sku: string;
  /** line label → catalog desc → stored legacy name → SKU. */
  label: string;
  desc: string;
  unit: string;
  qty: number;
  /** Unit cost: costOverride ?? catalog cost (a missing part: override ?? 0). */
  cost: number;
  /** Unit sell: catalog list (a missing part: 0). */
  sell: number;
  found: boolean;
  /** qty > 0 — counted in the totals. */
  included: boolean;
  costOverride?: number;
};

export type ResolvedFixture = {
  id: string;
  kind: FixtureKind;
  label: string;
  position?: string;
  circuit?: string;
  parts: ResolvedFixturePart[];
  /** Σ over included parts of qty × unit cost / sell. */
  cost: number;
  sell: number;
  missing: string[];
  pricesAsOf: number | null;
};

/**
 * M1 (fix wave 1, #FXB) — the head line a light-engine/lens picker's `onPick`
 * should keep: a DIFFERENT part starts fresh (its old label/qty/costOverride
 * don't carry over onto the newly-picked part); re-picking the SAME part
 * (`pickedSku === current`) leaves whatever is already there untouched.
 */
export function headLineForPick(current: string, pickedSku: string, existing: HeadLine): HeadLine {
  return pickedSku === current ? existing : {};
}

function headToLine(sku: string, head?: HeadLine): FixtureLine {
  const qty = Number(head?.qty);
  return {
    sku,
    ...(head?.label ? { label: head.label } : {}),
    qty: Number.isFinite(qty) ? Math.max(0, qty) : 1,
    ...(head?.costOverride !== undefined ? { costOverride: head.costOverride } : {}),
  };
}

/** Every priced line in form order: light engine, lens, then the four boxes
 *  (fixture) — or the one parts list (system). */
export function fixtureLineParts(
  r: Pick<FixtureResolvable, "kind" | "lightEngineSku" | "lensSku" | "lines" | "lightEngineLine" | "lensLine" | "parts">
): Array<{ slot: FixtureSlot; line: FixtureLine }> {
  if (r.kind === "system") return (r.parts || []).map((line) => ({ slot: "parts" as const, line }));
  const out: Array<{ slot: FixtureSlot; line: FixtureLine }> = [];
  if (r.lightEngineSku) out.push({ slot: "lightEngine", line: headToLine(r.lightEngineSku, r.lightEngineLine) });
  if (r.lensSku) out.push({ slot: "lens", line: headToLine(r.lensSku, r.lensLine) });
  for (const box of FIXTURE_BOXES) for (const line of r.lines?.[box] || []) out.push({ slot: box, line });
  return out;
}

/** Every SKU a record prices, once — the save action's targeted catalog read. */
export function fixtureSkus(r: Parameters<typeof fixtureLineParts>[0]): string[] {
  return [...new Set(fixtureLineParts(r).map((x) => x.line.sku).filter(Boolean))];
}

/**
 * Price a fixture or system from the CURRENT catalog (spec §4) — the
 * Assemblies rule: cost = costOverride ?? catalog cost, sell = catalog list.
 * Only qty ≥ 1 lines count; a qty-0 optional line lists its unit numbers.
 * A missing part is found:false, sells at 0 and costs its override or 0
 * (the same as resolveFixtureAssemblies, so converted totals are identical).
 */
export function resolveFixture(
  r: FixtureResolvable,
  catalog: SkuLookup<FixtureCatalogPart>,
  settings: PriceDateSettings = {}
): ResolvedFixture {
  const bySku = toSkuMap(catalog);
  const names = r.legacy?.names || {};
  const missing: string[] = [];
  const parts = fixtureLineParts(r).map(({ slot, line }): ResolvedFixturePart => {
    const p = bySku.get(line.sku);
    if (!p && line.sku && !missing.includes(line.sku)) missing.push(line.sku);
    const override =
      typeof line.costOverride === "number" && Number.isFinite(line.costOverride) && line.costOverride >= 0 ? line.costOverride : undefined;
    const qty = Math.max(0, Number(line.qty) || 0);
    return {
      slot,
      sku: line.sku,
      label: line.label || p?.desc || names[line.sku] || line.sku,
      desc: p?.desc || names[line.sku] || "Catalog part not found",
      unit: p?.unit || "ea",
      qty,
      cost: override ?? (Number(p?.cost) || 0),
      sell: Number(p?.list) || 0,
      found: !!p,
      included: qty > 0,
      ...(override !== undefined ? { costOverride: override } : {}),
    };
  });
  let cost = 0;
  let sell = 0;
  for (const part of parts) {
    if (!part.included) continue;
    cost += part.cost * part.qty;
    sell += part.sell * part.qty;
  }
  return {
    id: r.id,
    kind: r.kind,
    label: r.label,
    ...(r.position ? { position: r.position } : {}),
    ...(r.circuit ? { circuit: r.circuit } : {}),
    parts,
    cost,
    sell,
    missing,
    pricesAsOf: pricesAsOf(parts.map((p) => p.sku), bySku, settings),
  };
}

/** assemblyDescription's "Name — label×qty; …" format over included parts. */
export function fixtureDescription(r: ResolvedFixture): string {
  const included = r.parts.filter((p) => p.included).map((p) => (p.qty === 1 ? p.label : `${p.label} ×${p.qty}`));
  return included.length ? `${r.label} — ${included.join("; ")}` : r.label;
}

export type FixtureInput = {
  id?: string | null;
  kind?: string;
  label?: string;
  description?: string;
  scope?: string;
  lightEngineSku?: string;
  lensSku?: string | null;
  lightEngineLine?: HeadLine;
  lensLine?: HeadLine;
  lamp?: string;
  position?: string;
  circuit?: string;
  lines?: Partial<Record<FixtureBox, FixtureLine[]>>;
  parts?: FixtureLine[];
};

/** A sanitized record body — the store adds id, stamps, snapshot. */
export type CleanFixture = Omit<FixtureRecord, "id" | "snapshot" | "needsReview" | "legacy" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy">;

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function cleanLine(raw: unknown): FixtureLine | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Partial<FixtureLine>;
  const sku = text(l.sku, 160);
  if (!sku) return null;
  const qty = Number(l.qty);
  const label = text(l.label, 160);
  const override = l.costOverride == null ? NaN : Number(l.costOverride);
  return {
    sku,
    ...(label ? { label } : {}),
    qty: Number.isFinite(qty) ? Math.max(0, Math.round(qty * 100) / 100) : 0,
    ...(Number.isFinite(override) && override >= 0 ? { costOverride: override } : {}),
  };
}

/** `minQty` (M2, fix wave 1) floors an explicitly-provided qty — 1 for the
 *  light engine line (a fixture always ships its own engine), 0 for lens.
 *  Absent qty is untouched either way; resolveFixture's own default (1)
 *  applies at read time, same as before. */
function cleanHead(raw: unknown, minQty = 0): HeadLine | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const h = raw as HeadLine;
  const label = text(h.label, 160);
  const qty = Number(h.qty);
  const override = h.costOverride == null ? NaN : Number(h.costOverride);
  const out: HeadLine = {
    ...(label ? { label } : {}),
    ...(h.qty != null && Number.isFinite(qty) ? { qty: Math.max(minQty, Math.round(qty * 100) / 100) } : {}),
    ...(Number.isFinite(override) && override >= 0 ? { costOverride: override } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

/**
 * The save rules (spec §2.4): label + light engine (fixture); label + scope +
 * at least one part (system). Lens optional. A SKU missing from the catalog
 * is NOT an error here — it prices as missing and shows a warning.
 */
export function sanitizeFixtureInput(input: unknown): { ok: true; value: CleanFixture } | { ok: false; error: string } {
  const i = (input && typeof input === "object" ? input : {}) as FixtureInput;
  const kind: FixtureKind = i.kind === "system" ? "system" : "fixture";
  const label = text(i.label, 160);
  if (!label) return { ok: false, error: "Add a label." };
  const description = text(i.description, 2000);
  const lines: Record<FixtureBox, FixtureLine[]> = { data: [], power: [], mounting: [], accessories: [] };
  const cleanList = (raw: unknown) => (Array.isArray(raw) ? raw : []).map(cleanLine).filter((l): l is FixtureLine => !!l);
  if (kind === "system") {
    const scope = SYSTEM_SCOPES.find((s) => s === i.scope);
    if (!scope) return { ok: false, error: "Pick a scope for the system." };
    const parts = cleanList(i.parts);
    if (!parts.length) return { ok: false, error: "Add at least one part to the system." };
    return { ok: true, value: { kind, label, description, scope, lightEngineSku: "", lensSku: null, lines, parts } };
  }
  const lightEngineSku = text(i.lightEngineSku, 160);
  if (!lightEngineSku) return { ok: false, error: "Pick a light engine from the catalog." };
  const lensSku = text(i.lensSku, 160) || null;
  for (const box of FIXTURE_BOXES) lines[box] = cleanList(i.lines?.[box]);
  const lightEngineLine = cleanHead(i.lightEngineLine, 1);
  const lensLine = lensSku ? cleanHead(i.lensLine) : undefined;
  const lamp = text(i.lamp, 120);
  const position = text(i.position, 120);
  const circuit = text(i.circuit, 120);
  return {
    ok: true,
    value: {
      kind,
      label,
      description,
      lightEngineSku,
      lensSku,
      ...(lightEngineLine ? { lightEngineLine } : {}),
      ...(lensLine ? { lensLine } : {}),
      ...(lamp ? { lamp } : {}),
      ...(position ? { position } : {}),
      ...(circuit ? { circuit } : {}),
      lines,
    },
  };
}

const SLOT_ROLE: Record<FixtureSlot, AssemblyRole> = {
  lightEngine: "fixture",
  lens: "lens",
  data: "data",
  power: "power",
  mounting: "mount",
  accessories: "accessory",
  parts: "other",
};

/**
 * Fixture records → the Estimator/Quick Design shape (ResolvedFixtureAssembly),
 * so those consumers keep one code path: id → id, label → name, every priced
 * line → a component (qty → defaultQty, sell → list). Systems are left out —
 * the pickers list fixtures (spec §5).
 */
export function fixtureAssembliesFrom(
  records: readonly FixtureRecord[],
  catalog: SkuLookup<FixtureCatalogPart>,
  settings: PriceDateSettings = {}
): ResolvedFixtureAssembly[] {
  const bySku = toSkuMap(catalog);
  return records
    .filter((r) => r.kind === "fixture")
    .map((r) => {
      const x = resolveFixture(r, bySku, settings);
      return {
        id: x.id,
        name: x.label,
        ...(x.position ? { position: x.position } : {}),
        ...(x.circuit ? { circuit: x.circuit } : {}),
        components: x.parts.map((p) => ({
          sku: p.sku,
          label: p.label,
          role: SLOT_ROLE[p.slot],
          defaultQty: p.qty,
          ...(p.costOverride !== undefined ? { costOverride: p.costOverride } : {}),
          desc: p.desc,
          unit: p.unit,
          cost: p.cost,
          list: p.sell,
          found: p.found,
        })),
      };
    });
}
