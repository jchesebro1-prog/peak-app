/**
 * #333 (spec 2026-10-12 §7.3, D-TBD-l) — the trimmed BOM the Client package
 * tab sends to clientPackageDocsAction while the estimator types: only the
 * section / item keys the package BOM reads, so the payload is a small
 * fraction of a Save's. Pure and client-safe (no imports).
 *
 * The keys are exactly what these read, and nothing else:
 *  - quoteBom (client-package-server.ts): section `kind`; item `labor`, `qty`,
 *    `sku`, `desc`;
 *  - isBonusItem (estimate-bonus/flags.ts): item `bonus`;
 *  - isRewardCreditItem (rewards/credit-line.ts): item `rewardCredit`;
 *  - expandLine (quote-line-members.ts): item `rackId`, `fixtureId`,
 *    `fixture`, `components[]` (`sku`, `label`, `role`, `qty`).
 * A harness check proves quoteBom on the projection equals quoteBom on the
 * full sections. The server re-sanitises (sanitizeBomProjection): ≤ 200
 * sections, ≤ 5,000 items in all, ≤ 200 components a line, strings ≤ 300
 * chars, numbers finite (a non-finite qty reads 0, which quoteBom skips).
 */

export type BomProjectionComponent = { sku?: string; label?: string; role?: string; qty?: number };
export type BomProjectionItem = {
  sku?: string;
  desc?: string;
  qty?: number;
  labor?: boolean;
  bonus?: string;
  rewardCredit?: boolean;
  rackId?: string;
  fixtureId?: string;
  fixture?: boolean;
  components?: BomProjectionComponent[];
};
export type BomProjectionSection = { kind?: string; items: BomProjectionItem[] };
export type BomProjection = BomProjectionSection[];

export const BOM_PROJECTION_MAX_SECTIONS = 200;
export const BOM_PROJECTION_MAX_ITEMS = 5000;
export const BOM_PROJECTION_MAX_COMPONENTS = 200;
export const BOM_PROJECTION_MAX_STRING = 300;

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);

function projectComponents(raw: unknown): BomProjectionComponent[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.filter(isRec).map((c) => {
    const out: BomProjectionComponent = {};
    if (c.sku !== undefined) out.sku = c.sku as string;
    if (c.label !== undefined) out.label = c.label as string;
    if (c.role !== undefined) out.role = c.role as string;
    if (c.qty !== undefined) out.qty = c.qty as number;
    return out;
  });
}

function projectItem(it: Rec): BomProjectionItem {
  const out: BomProjectionItem = {};
  if (it.sku !== undefined) out.sku = it.sku as string;
  if (it.desc !== undefined) out.desc = it.desc as string;
  if (it.qty !== undefined) out.qty = it.qty as number;
  if (it.labor !== undefined) out.labor = it.labor as boolean;
  if (it.bonus !== undefined) out.bonus = it.bonus as string;
  if (it.rewardCredit !== undefined) out.rewardCredit = it.rewardCredit as boolean;
  if (it.rackId !== undefined) out.rackId = it.rackId as string;
  if (it.fixtureId !== undefined) out.fixtureId = it.fixtureId as string;
  if (it.fixture !== undefined) out.fixture = it.fixture as boolean;
  const comps = projectComponents(it.components);
  if (comps) out.components = comps;
  return out;
}

/** The editor's sections → the projection (the browser side; no caps — the server applies them). */
export function projectBom(sections: ReadonlyArray<unknown>): BomProjection {
  const out: BomProjection = [];
  for (const s of sections || []) {
    if (!isRec(s)) continue;
    const items = Array.isArray(s.items) ? s.items.filter(isRec).map(projectItem) : [];
    out.push(s.kind !== undefined ? { kind: s.kind as string, items } : { items });
  }
  return out;
}

const str = (v: unknown): string | undefined => (typeof v === "string" ? v.slice(0, BOM_PROJECTION_MAX_STRING) : undefined);
const finite = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Untrusted JSON → a capped projection (the server side). Never throws. */
export function sanitizeBomProjection(raw: unknown): BomProjection {
  const out: BomProjection = [];
  if (!Array.isArray(raw)) return out;
  let budget = BOM_PROJECTION_MAX_ITEMS;
  for (const s of raw.slice(0, BOM_PROJECTION_MAX_SECTIONS)) {
    if (!isRec(s)) continue;
    const items: BomProjectionItem[] = [];
    const rawItems = Array.isArray(s.items) ? s.items : [];
    for (const it of rawItems) {
      if (budget <= 0) break;
      if (!isRec(it)) continue;
      budget--;
      const o: BomProjectionItem = {};
      const sku = str(it.sku);
      if (sku !== undefined) o.sku = sku;
      const desc = str(it.desc);
      if (desc !== undefined) o.desc = desc;
      if (it.qty !== undefined && it.qty !== null) o.qty = finite(it.qty);
      if (it.labor === true) o.labor = true;
      const bonus = str(it.bonus);
      if (bonus !== undefined) o.bonus = bonus;
      if (it.rewardCredit === true) o.rewardCredit = true;
      const rackId = str(it.rackId);
      if (rackId !== undefined) o.rackId = rackId;
      const fixtureId = str(it.fixtureId);
      if (fixtureId !== undefined) o.fixtureId = fixtureId;
      if (it.fixture === true) o.fixture = true;
      if (Array.isArray(it.components)) {
        o.components = it.components
          .slice(0, BOM_PROJECTION_MAX_COMPONENTS)
          .filter(isRec)
          .map((c) => {
            const co: BomProjectionComponent = {};
            const csku = str(c.sku);
            if (csku !== undefined) co.sku = csku;
            const label = str(c.label);
            if (label !== undefined) co.label = label;
            const role = str(c.role);
            if (role !== undefined) co.role = role;
            co.qty = finite(c.qty);
            return co;
          });
      }
      items.push(o);
    }
    const kind = str(s.kind);
    out.push(kind !== undefined ? { kind, items } : { items });
    if (budget <= 0) break;
  }
  return out;
}

/** The JSON key the tab debounces on (projection order is the editor's). */
export function bomProjectionKey(p: BomProjection): string {
  return JSON.stringify(p);
}
