/**
 * Estimator handoff — the props of the four Estimating Rules screens, ported from their server pages onto the
 * HandoffStore (each page's reads become reads of the store's `blobs` / `settings` / `catalog` over the slice):
 *
 *   src/app/(app)/estimating-rules/page.tsx                    → buildRulesProps        (RulesEditor + RulesActions)
 *   src/app/(app)/estimating-rules/track-series/page.tsx       → buildTrackSeriesProps  (TrackSeriesClient)
 *   src/app/(app)/estimating-rules/curtain-mounts/page.tsx     → buildCurtainMountsProps (CurtainMountsClient)
 *   src/app/(app)/estimating-rules/system-categories/page.tsx  → buildSystemCategoriesProps (SystemCategoriesClient)
 *
 * Every page is admin-only (`manage_users`): `isAdmin` false → the page's own "Admin access required" panel and no
 * data. Conduit sizes is a Grid concern and not in the prototype. Plan: PR 2 Task 10.
 */
import type { GroupVM, ItemVM } from "@/app/(app)/estimating-rules/controls";
import type { PartInfo } from "@/app/(app)/estimating-rules/track-series/track-series-client";
import type { MountPartInfo } from "@/app/(app)/estimating-rules/curtain-mounts/curtain-mounts-client";
import type { CategoryPartInfo } from "@/app/(app)/estimating-rules/system-categories/actions";
import { can } from "@/lib/team";
import { resolveVenueDoctrine, type VenueDoctrine, type VenueDoctrinePatch } from "@/lib/venue-doctrine";
import { sanitizeTrackSeriesBlob, seriesSkus, TRACK_SERIES_BLOB, type TrackSeries } from "@/lib/track-series";
import { CURTAIN_MOUNTS_BLOB, sanitizeCurtainMounts, type CurtainMountHardware } from "@/lib/curtain-mounts";
import type { CurtainMountTypeId } from "@/lib/curtain-cut-sheets/vocab";
import { sanitizeSystemCategories, SYSTEM_CATEGORIES_BLOB, type SystemCategory } from "@/lib/system-categories";
import type { HandoffStore } from "../store";
import { refreshPortsFromStore, settingsView, users } from "../ports";
import { bySkuResolver, getManyLocal, liveCatalog } from "../readers";
import { defaultOf, getBlobLocal, GROUPS, value } from "../pricing-rules";

/** The acting user may edit Estimating Rules (requirePerm("manage_users") / can("manage_users", roles)). */
export const canManageRules = (): boolean => can("manage_users", users.current().roles);

export type RulesProps = { isAdmin: boolean; groups: GroupVM[]; venueDoctrine: VenueDoctrine };

/**
 * Estimating Rules the prototype leaves off the screen: they price Peak's service quotes (flame test, repair,
 * inspection — not in the package), the flights-over-drive travel those quotes use, and the customer portal — never a
 * system estimate. Hidden, not deleted: their stored values and defaults are untouched, and Export / Import still carry
 * every rate. What stays prices estimates: System design, tiers, sizing, catalog margin, fixtures, wire, cable, labor,
 * curtains, bonuses, the drive-distance knobs (travel.roadFactor / travel.mph → the venue's travel) and freight.
 */
export const PROTOTYPE_HIDDEN_RULE_GROUPS: readonly string[] = ["flame", "repair", "inspection"];
export const PROTOTYPE_HIDDEN_RULE_ITEMS: readonly string[] = [
  "travel.flyThreshold", "travel.airfarePerPerson", "travel.hotelPerNight", "travel.perDiemPerDay", "travel.carPerDay",
  "travel.flyTravelHoursEachWay", "travel.flyHoursPerDay", "travel.fly",
  "portal.validityDays", "portal.browseMinQuotes", "portal.browseWindowMonths", "portal.staleCostMonths",
];
/** The registry groups the prototype shows, each without its hidden items (a group left empty goes). Pure. */
export function prototypeRuleGroups<G extends { key: string; items: ReadonlyArray<{ id: string }> }>(groups: readonly G[]): G[] {
  return groups
    .filter((g) => !PROTOTYPE_HIDDEN_RULE_GROUPS.includes(g.key))
    .map((g) => ({ ...g, items: g.items.filter((it) => !PROTOTYPE_HIDDEN_RULE_ITEMS.includes(it.id)) }))
    .filter((g) => g.items.length > 0);
}

/** EstimatingRulesPage: each group's rows with their current value and EFFECTIVE default (#232), plus the venue doctrine —
 *  the service-quote and portal rules hidden (prototypeRuleGroups). */
export async function buildRulesProps(store: HandoffStore): Promise<RulesProps> {
  await refreshPortsFromStore(store);
  const isAdmin = canManageRules();
  const settings = isAdmin ? settingsView() : null;
  const groups: GroupVM[] = isAdmin
    ? await Promise.all(
        prototypeRuleGroups(GROUPS).map(async (g) => ({
          key: g.key,
          label: g.label,
          live: g.live,
          sub: g.sub,
          note: g.note,
          items: await Promise.all(
            g.items.map(async (it): Promise<ItemVM> => {
              if (it.kind === "formula") return { kind: "formula", id: it.id, label: it.label, expr: it.expr };
              const v = await value(store, it);
              return {
                kind: "rate",
                id: it.id,
                label: it.label,
                unit: it.unit,
                value: v == null ? it.def : v,
                def: (await defaultOf(store, it)) ?? it.def,
                min: it.min,
                max: it.max,
                step: it.step,
                help: it.help,
                ref: it.ref,
              };
            }),
          ),
        })),
      )
    : [];
  return { isAdmin, groups, venueDoctrine: resolveVenueDoctrine(settings?.venueDoctrine as VenueDoctrinePatch | null | undefined) };
}

export type TrackSeriesProps = { isAdmin: boolean; series: TrackSeries[]; parts: Record<string, PartInfo> };

/** TrackSeriesPage: the series blob and ONLY the catalog SKUs the series reference (one getMany). */
export async function buildTrackSeriesProps(store: HandoffStore): Promise<TrackSeriesProps> {
  await refreshPortsFromStore(store);
  if (!canManageRules()) return { isAdmin: false, series: [], parts: {} };
  const series = sanitizeTrackSeriesBlob(await getBlobLocal(store, TRACK_SERIES_BLOB, {}));
  const skus = [...new Set(series.flatMap((s) => seriesSkus(s)))];
  const parts: Record<string, PartInfo> = {};
  for (const p of skus.length ? await getManyLocal(store, skus) : []) parts[p.sku] = { desc: p.desc, cost: p.cost || 0, unit: p.unit || "ea", mfr: p.mfr || "" };
  return { isAdmin: true, series, parts };
}

export type CurtainMountsProps = { isAdmin: boolean; mounts: Partial<Record<CurtainMountTypeId, CurtainMountHardware>>; parts: Record<string, MountPartInfo> };

/** CurtainMountsPage: the blob and only its SKUs (one getMany). */
export async function buildCurtainMountsProps(store: HandoffStore): Promise<CurtainMountsProps> {
  await refreshPortsFromStore(store);
  if (!canManageRules()) return { isAdmin: false, mounts: {}, parts: {} };
  const mounts = sanitizeCurtainMounts(await getBlobLocal(store, CURTAIN_MOUNTS_BLOB, {}));
  const skus = [...new Set(Object.values(mounts).flatMap((m) => (m?.rows ?? []).map((r) => r.sku)))];
  const parts: Record<string, MountPartInfo> = {};
  for (const p of skus.length ? await getManyLocal(store, skus) : []) parts[p.sku] = { desc: p.desc, cost: p.cost || 0, unit: p.unit || "ea" };
  return { isAdmin: true, mounts, parts };
}

export type SystemCategoriesProps = { isAdmin: boolean; categories: SystemCategory[]; parts: Record<string, CategoryPartInfo | null> };

/** SystemCategoriesPage: the categories (the seven defaults when never saved) and getManyBySku over their SKUs. */
export async function buildSystemCategoriesProps(store: HandoffStore): Promise<SystemCategoriesProps> {
  await refreshPortsFromStore(store);
  if (!canManageRules()) return { isAdmin: false, categories: [], parts: {} };
  const categories = sanitizeSystemCategories(await getBlobLocal(store, SYSTEM_CATEGORIES_BLOB, {}));
  const skus = [...new Set(categories.flatMap((c) => c.items.map((i) => i.sku)))];
  const bySku = skus.length ? bySkuResolver(await liveCatalog(store), store.catalogRenames) : () => undefined;
  const parts: Record<string, CategoryPartInfo | null> = {};
  for (const s of skus) {
    const p = bySku(s); // a retired SKU resolves to its renamed part
    parts[s] = p ? { sku: p.sku, desc: p.desc, unit: p.unit || "ea", cost: p.cost || 0, list: p.list || 0 } : null;
  }
  return { isAdmin: true, categories, parts };
}
