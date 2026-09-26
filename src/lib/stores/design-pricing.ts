import type { CatalogPart } from "@/lib/stores/catalog";
import type { FixtureRecord } from "@/lib/stores/fixtures";
import { loadEquipPriceCtx } from "@/lib/stores/equipment-map";
import { buildEquipmentPriceTable, priceCell, type EquipmentPriceTable, type EquipPriceCtx, type UnitPrice } from "@/lib/design/equipment-map";
import { EQUIPMENT_ROW_BY_KEY } from "@/lib/design/equipment-vocab";
import { quickDesignPrice, type QuickDesignPrice, type QuickRates } from "@/lib/design/equipment-pricing";
import { addToQuotesGuard } from "@/lib/design/scope-targets";
import type { DesignRecordLike } from "@/app/(app)/design/quick/engine";
import { num } from "@/lib/stores/pricing";
import { createDesign, getDesign, updateDesign, type DesignRecord } from "@/lib/stores/designs";

/**
 * Server-side Quick Design pricing (#GEM final review I3/I4, D-GEM-19).
 *
 * The Quick Design screen prices in the browser, but nothing it sends about
 * price or completeness is trusted: every save derives `incomplete` AND
 * `budget` here (D-GEM-23 — the server is the budget's authority), and every
 * promote path (Quick Design's Add to Quotes, the Designs dashboard, Home)
 * re-prices the design against the live Equipment map before a quote is
 * made. A needs-a-part line blocks — including a design saved before #GEM,
 * whose stored budget stays visible but which can't become a quote until
 * its rows are mapped.
 */

/** A fixture pick's per-unit price, keyed by fixture id — priceCell on an
 *  assembly cell, so a pick that can't price stays needs-a-part. */
export function fixturePricesFrom(ids: Iterable<string>, ctx: EquipPriceCtx): Record<string, UnitPrice> {
  const def = EQUIPMENT_ROW_BY_KEY.get("lighting:par")!; // any lighting row: an assembly cell only checks def.curtain
  const out: Record<string, UnitPrice> = {};
  for (const id of ids) if (id && !out[id]) out[id] = priceCell({ kind: "assembly", id }, def, ctx);
  return out;
}

/** The fixture ids a Quick design's config picks (live or deleted). */
export function pickedFixtureIds(d: DesignRecordLike): string[] {
  const picks = (d.config as { fixtureAssemblies?: unknown } | null | undefined)?.fixtureAssemblies;
  if (!picks || typeof picks !== "object") return [];
  return Object.values(picks as Record<string, unknown>).filter((v): v is string => typeof v === "string" && !!v);
}

/** The table + fixture prices one design needs. Pass `catalog`/`fixtures`
 *  when the request already holds them (Quick Design's page); otherwise the
 *  map's SKUs and the picked fixtures' parts are read in ONE getMany. */
export async function loadDesignPricing(
  fixtureIds: string[],
  opts: { catalog?: ReadonlyArray<CatalogPart>; fixtures?: ReadonlyArray<FixtureRecord> } = {}
): Promise<{ table: EquipmentPriceTable; fixturePrices: Record<string, UnitPrice> }> {
  const { map, ctx } = await loadEquipPriceCtx(
    opts.catalog || opts.fixtures ? { catalog: opts.catalog, fixtures: opts.fixtures, extraFixtureIds: fixtureIds } : { extraFixtureIds: fixtureIds }
  );
  return { table: buildEquipmentPriceTable(map, ctx), fixturePrices: fixturePricesFrom(fixtureIds, ctx) };
}

/** The install / freight / contingency percentages Quick Design totals with (its page reads the same keys). */
async function quickRates(): Promise<QuickRates> {
  const [installPct, freightPct, contingencyPct] = await Promise.all([
    num("system.installPct", 18),
    num("system.freightPct", 5),
    num("system.contingencyPct", 10),
  ]);
  return { installPct, freightPct, contingencyPct };
}

/** The server's own price for one Quick design — needs-a-part count AND
 *  budget (D-GEM-19, D-GEM-23): one loadEquipPriceCtx for the map + picks. */
export async function serverDesignPrice(d: DesignRecordLike): Promise<QuickDesignPrice> {
  const ids = pickedFixtureIds(d);
  const [{ table, fixturePrices }, rates] = await Promise.all([loadDesignPricing(ids), quickRates()]);
  return quickDesignPrice(d, table, fixturePrices, rates);
}

/** serverDesignPrice for several Quick designs with ONE price context (the
 *  union of their fixture picks) and one rates read — fix wave 3, for the
 *  engagement letter, which re-derives completeness rather than trusting a
 *  stored (possibly pre-wave-2, client-derived) budget. */
export async function serverDesignPrices(ds: ReadonlyArray<DesignRecordLike>): Promise<QuickDesignPrice[]> {
  if (!ds.length) return [];
  const ids = [...new Set(ds.flatMap(pickedFixtureIds))];
  const [{ table, fixturePrices }, rates] = await Promise.all([loadDesignPricing(ids), quickRates()]);
  return ds.map((d) => quickDesignPrice(d, table, fixturePrices, rates));
}

/** The server's needs-a-part count for one Quick design (config or reconstructed seed). */
export async function serverDesignNeedsPart(d: DesignRecordLike): Promise<number> {
  return (await serverDesignPrice(d)).needsPart;
}

/** Promote check for a Quick design (D-GEM-19/D-GEM-23): the server price
 *  the quote must use, and the refusal when any line still needs a part. */
export async function quickPromoteCheck(
  d: DesignRecordLike
): Promise<{ price: QuickDesignPrice; blocked: { error: string; needsPart: number } | null }> {
  const price = await serverDesignPrice(d);
  const error = addToQuotesGuard(price.needsPart);
  return { price, blocked: error ? { error, needsPart: price.needsPart } : null };
}

/** Promote guard for a Quick design (D-GEM-19): the message, or null when every line prices. */
export async function quickPromoteGuard(d: DesignRecordLike): Promise<{ error: string; needsPart: number } | null> {
  return (await quickPromoteCheck(d)).blocked;
}

/* ---------- the Quick Design save (D-GEM-23, final review M1/M2) ---------- */

/** The only DesignRecord keys a Quick Design save may write. Everything else
 *  — review, quoteId, owner, layoutMode, gridProjectId, revisions, id,
 *  updatedAt — is server-owned; `budget` and `incomplete` are derived here. */
export const QUICK_SAVE_KEYS = [
  "name", "venue", "size", "tier", "width", "depth", "grid", "systems",
  "customerId", "locationId", "customer", "config",
] as const;

export type QuickSaveFields = Partial<Pick<DesignRecord, (typeof QUICK_SAVE_KEYS)[number]>>;

export const GRID_DESIGN_REFUSAL = "This design is built in The Grid — open it there to edit or quote it.";

/** Whitelist + type-check a client's Quick Design payload (never trusted). */
export function quickSaveFields(input: unknown): QuickSaveFields {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out: QuickSaveFields = {};
  for (const k of ["name", "venue", "size", "tier", "customer"] as const) {
    if (typeof src[k] === "string") out[k] = src[k] as string;
  }
  for (const k of ["width", "depth", "grid"] as const) {
    const v = Number(src[k]);
    if (src[k] != null && Number.isFinite(v)) out[k] = v;
  }
  if (Array.isArray(src.systems)) out.systems = src.systems.filter((x): x is string => typeof x === "string");
  for (const k of ["customerId", "locationId"] as const) {
    if (src[k] === null || typeof src[k] === "string") out[k] = (src[k] as string | null) || null;
  }
  if (src.config && typeof src.config === "object" && !Array.isArray(src.config)) out.config = src.config as Record<string, unknown>;
  return out;
}

/**
 * Save a Quick design (D-GEM-19/D-GEM-23): only QUICK_SAVE_KEYS from the
 * client are written; `incomplete` AND `budget` are the server's price of the
 * merged record (or `known`, when the caller priced it this request). A Grid
 * (manual-layout) record is refused — it is never edited through Quick Design.
 * An unknown id falls through to a new record, as before.
 */
export async function saveQuickDesign(
  id: string | null,
  input: unknown,
  owner: string,
  known?: QuickDesignPrice
): Promise<{ ok: true; record: DesignRecord } | { ok: false; error: string }> {
  const fields = quickSaveFields(input);
  const existing = id ? await getDesign(id) : null;
  if (existing?.layoutMode === "manual") return { ok: false, error: GRID_DESIGN_REFUSAL };
  const price = known ?? (await serverDesignPrice({ ...(existing || {}), ...fields }));
  const partial = { ...fields, budget: price.budget, incomplete: { needsPart: price.needsPart } };
  if (existing) {
    const d = await updateDesign(existing.id, partial);
    if (d) return { ok: true, record: d };
  }
  // prototype: SandboxStore.create() stamps the current user as owner
  return { ok: true, record: await createDesign({ ...partial, owner }) };
}
