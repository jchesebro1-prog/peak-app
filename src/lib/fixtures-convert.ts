import {
  FIXTURE_BOXES,
  sanitizeFixtureAssemblies,
  type AssemblyRole,
  type FixtureAssembly,
  type FixtureAssemblyComponent,
  type FixtureBox,
  type FixtureLine,
  type FixtureRecord,
  type HeadLine,
} from "./fixture-assemblies";

/**
 * #FXB conversion — pure. The Assemblies tab's `settings.fixtureAssemblies`
 * entries and the Subassemblies tab's rows become one FixtureRecord shape,
 * keeping their ids (spec §3). The server runner is src/lib/fixtures-migrate.ts.
 */

/** The Subassemblies tab's stored option (pre-#FXB, #129). */
export type LegacyOption = { sku: string; name: string; cost: number; qty: number };

/** The Subassemblies tab's stored row (pre-#FXB). */
export type LegacySubassembly = {
  id: string;
  kind: "fixture";
  label: string;
  description: string;
  lightEngineSku: string;
  lightEngineName: string;
  lightEngineCost: number;
  lensSku: string;
  lensName: string;
  lensCost: number;
  lamp?: string;
  position?: string;
  circuit?: string;
  options: Record<FixtureBox, LegacyOption[]>;
  cost: number;
  price: number;
  snapshot?: { cost: number; price: number; pricedAt: number | null };
  createdAt: number;
  updatedAt: number;
};

export type RawFixtureRow = Record<string, unknown> & { id: string };

export const CONVERTED_BY = "Fixture builder conversion";

const ROLE_BOX: Partial<Record<AssemblyRole, FixtureBox>> = { data: "data", power: "power", mount: "mounting" };
const emptyBoxes = (): Record<FixtureBox, FixtureLine[]> => ({ data: [], power: [], mounting: [], accessories: [] });
const toLine = (c: FixtureAssemblyComponent): FixtureLine => ({
  sku: c.sku,
  label: c.label,
  qty: c.defaultQty,
  ...(c.costOverride !== undefined ? { costOverride: c.costOverride } : {}),
});
const toHead = (c: FixtureAssemblyComponent): HeadLine => ({
  label: c.label,
  qty: c.defaultQty,
  ...(c.costOverride !== undefined ? { costOverride: c.costOverride } : {}),
});

/**
 * One Assemblies-tab entry → a fixture (spec §3 role mapping): first
 * `fixture` → light engine; first `lens` → lens; data/power → those boxes;
 * mount → Mounting; accessory, cable, lamp, other and any extra fixture/lens
 * members → Accessories, component order kept. With no fixture member the
 * first component is the light engine and the record is `needsReview`.
 */
export function assemblyToFixture(a: FixtureAssembly, at: number): FixtureRecord {
  const comps = a.components || [];
  const engineIdx = comps.findIndex((c) => c.role === "fixture");
  const needsReview = engineIdx < 0;
  const headIdx = needsReview ? 0 : engineIdx;
  const lensIdx = comps.findIndex((c, i) => c.role === "lens" && i !== headIdx);
  const lines = emptyBoxes();
  comps.forEach((c, i) => {
    if (i === headIdx || i === lensIdx) return;
    lines[ROLE_BOX[c.role] ?? "accessories"].push(toLine(c));
  });
  const head = comps[headIdx];
  const lens = lensIdx >= 0 ? comps[lensIdx] : undefined;
  return {
    id: a.id,
    kind: "fixture",
    label: a.name,
    description: "",
    lightEngineSku: head?.sku || "",
    ...(head ? { lightEngineLine: toHead(head) } : {}),
    lensSku: lens?.sku || null,
    ...(lens ? { lensLine: toHead(lens) } : {}),
    lines,
    ...(needsReview ? { needsReview: true } : {}),
    createdAt: at,
    createdBy: CONVERTED_BY,
    updatedAt: at,
    updatedBy: CONVERTED_BY,
    legacy: { from: "assembly" },
  };
}

/** A row in the pre-#FXB shape (no `lines` object). */
export function isLegacySubassembly(row: Record<string, unknown>): boolean {
  const lines = row.lines;
  return !(lines && typeof lines === "object");
}

/** A Subassemblies-tab row → a fixture, rewritten in place (same id). The
 *  stored names survive only as `legacy.names` (fallback display). */
export function subassemblyToFixture(s: LegacySubassembly): FixtureRecord {
  const names: Record<string, string> = {};
  if (s.lightEngineSku && s.lightEngineName) names[s.lightEngineSku] = s.lightEngineName;
  if (s.lensSku && s.lensName) names[s.lensSku] = s.lensName;
  const lines = emptyBoxes();
  for (const box of FIXTURE_BOXES) {
    for (const o of s.options?.[box] || []) {
      if (!o?.sku) continue;
      lines[box].push({ sku: o.sku, qty: Math.max(1, Math.round(Number(o.qty) || 1)) });
      if (o.name) names[o.sku] = o.name;
    }
  }
  return {
    id: s.id,
    kind: "fixture",
    label: String(s.label || s.id),
    description: String(s.description || ""),
    lightEngineSku: s.lightEngineSku || "",
    lensSku: s.lensSku || null,
    ...(s.lamp ? { lamp: s.lamp } : {}),
    ...(s.position ? { position: s.position } : {}),
    ...(s.circuit ? { circuit: s.circuit } : {}),
    lines,
    ...(s.snapshot ? { snapshot: s.snapshot } : {}),
    createdAt: Number(s.createdAt) || 0,
    createdBy: CONVERTED_BY,
    updatedAt: Number(s.updatedAt) || 0,
    updatedBy: CONVERTED_BY,
    legacy: { from: "subassembly", ...(Object.keys(names).length ? { names } : {}) },
  };
}

/** Any stored row → a FixtureRecord (legacy rows convert in memory). */
export function normalizeFixtureRow(row: RawFixtureRow): FixtureRecord {
  if (isLegacySubassembly(row)) return subassemblyToFixture(row as unknown as LegacySubassembly);
  const r = row as unknown as FixtureRecord;
  const lines = emptyBoxes();
  for (const box of FIXTURE_BOXES) if (Array.isArray(r.lines?.[box])) lines[box] = r.lines[box];
  const kind = r.kind === "system" ? "system" : "fixture";
  return {
    ...r,
    kind,
    label: String(r.label || r.id),
    description: String(r.description || ""),
    lightEngineSku: String(r.lightEngineSku || ""),
    lensSku: r.lensSku || null,
    lines,
    ...(kind === "system" ? { parts: Array.isArray(r.parts) ? r.parts : [] } : {}),
  };
}

/**
 * What a conversion pass must write: every settings assembly with no row of
 * that id — neither live nor soft-deleted (`deletedIds`; a deleted one stays
 * deleted, and insert-if-absent would skip it anyway) — and every live row
 * still in the legacy shape (rewrite in place). Running it again over the
 * result plans nothing.
 */
export function planFixtureConversion(
  settingsAssemblies: unknown,
  rows: readonly RawFixtureRow[],
  at: number,
  deletedIds: ReadonlySet<string> = new Set()
): { inserts: FixtureRecord[]; rewrites: FixtureRecord[] } {
  const live = new Set([...rows.map((r) => r.id), ...deletedIds]);
  const inserts = sanitizeFixtureAssemblies(settingsAssemblies)
    .filter((a) => !live.has(a.id))
    .map((a) => assemblyToFixture(a, at));
  const rewrites = rows.filter((r) => isLegacySubassembly(r)).map((r) => subassemblyToFixture(r as unknown as LegacySubassembly));
  return { inserts, rewrites };
}
