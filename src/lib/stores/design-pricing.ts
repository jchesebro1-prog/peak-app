import type { CatalogPart } from "@/lib/stores/catalog";
import type { FixtureRecord } from "@/lib/stores/fixtures";
import { loadEquipPriceCtx } from "@/lib/stores/equipment-map";
import { buildEquipmentPriceTable, priceCell, type EquipmentPriceTable, type EquipPriceCtx, type UnitPrice } from "@/lib/design/equipment-map";
import { EQUIPMENT_ROW_BY_KEY } from "@/lib/design/equipment-vocab";
import { quickDesignNeedsPart } from "@/lib/design/equipment-pricing";
import { addToQuotesGuard } from "@/lib/design/scope-targets";
import type { DesignRecordLike } from "@/app/(app)/design/quick/engine";

/**
 * Server-side Quick Design pricing (#GEM final review I3/I4, D-GEM-19).
 *
 * The Quick Design screen prices in the browser, but nothing it sends about
 * completeness is trusted: every save derives `incomplete` here, and every
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

function pickedFixtureIds(d: DesignRecordLike): string[] {
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

/** The server's needs-a-part count for one Quick design (config or reconstructed seed). */
export async function serverDesignNeedsPart(d: DesignRecordLike): Promise<number> {
  const ids = pickedFixtureIds(d);
  const { table, fixturePrices } = await loadDesignPricing(ids);
  return quickDesignNeedsPart(d, table, fixturePrices);
}

/** Promote guard for a Quick design (D-GEM-19): the message, or null when every line prices. */
export async function quickPromoteGuard(d: DesignRecordLike): Promise<{ error: string; needsPart: number } | null> {
  const needsPart = await serverDesignNeedsPart(d);
  const error = addToQuotesGuard(needsPart);
  return error ? { error, needsPart } : null;
}

/**
 * The partial a Quick Design save writes (D-GEM-19): the client's
 * `incomplete` is replaced by the server's own count — `known` when the
 * caller already derived it this request (Add to Quotes' guard).
 */
export async function withServerIncomplete<T extends DesignRecordLike & { incomplete?: { needsPart: number } }>(
  partial: T,
  known?: number
): Promise<T & { incomplete: { needsPart: number } }> {
  return { ...partial, incomplete: { needsPart: known ?? (await serverDesignNeedsPart(partial)) } };
}
