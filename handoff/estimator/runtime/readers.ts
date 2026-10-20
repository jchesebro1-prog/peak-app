/**
 * Estimator handoff — the store readers the props builder (props/estimator.ts) and the browser
 * actions (actions/*.ts) share: the live catalog, the sku resolver, fixtures, the settings-derived
 * rules (pipelines, bonus rates, freight, review limits) and the rename log. Each is the browser
 * twin of a server reader the app keeps in a store module (named per function). Plan: PR 2 Tasks 3–4.
 */
import type { CatalogPart } from "@/lib/stores/catalog";
import { sanitizeFixtureAssemblies, type FixtureRecord } from "@/lib/fixture-assemblies";
import { assemblyToFixture, normalizeFixtureRow, type RawFixtureRow } from "@/lib/fixtures-convert";
import { resolvePipelines, type Pipelines } from "@/lib/pipelines";
import { bonusRatesFrom, BONUS_ESTIMATOR_RATE_ID, BONUS_PACKAGE_RATE_ID, type BonusRates } from "@/lib/estimate-bonus/flags";
import { reviewLimitsFrom, type ReviewLimitContext } from "@/lib/review-limits";
import { can as roleCan } from "@/lib/team";
import { sanitizeIntroList, type SystemIntro } from "@/lib/narrative/intros";
import type { HandoffStore } from "./store";
import { blobData, settingsView, users } from "./ports";
import { fixturesConvertedNow } from "./fixtures-repo";

/** A catalog part as the store holds it (the slice keys parts by sku; `sku` defaults to the id). */
export type LivePart = CatalogPart & { id: string };

/** catalog list(): the live parts (retired-SKU stubs are never in the collection — store.catalogRenames). */
export async function liveCatalog(store: HandoffStore): Promise<LivePart[]> {
  return (await store.all<LivePart>("catalog")).map((p) => (p.sku ? p : { ...p, sku: p.id }));
}

/**
 * catalog getManyBySku over the rows the slice holds: the live part for each sku, following `renames`
 * (old sku → renamedTo, from the retired stubs #304 leaves behind) up to 8 hops. A redirect that leads
 * nowhere live (missing, a cycle, more than 8 hops) is absent, as in the app.
 */
export function bySkuResolver<P extends Pick<CatalogPart, "sku">>(rows: readonly P[], renames: ReadonlyMap<string, string> = new Map()): (sku: string) => P | undefined {
  const map = new Map(rows.map((p) => [p.sku, p]));
  return (sku) => {
    let cur: string | undefined = sku;
    for (let hop = 0; cur !== undefined && hop <= 8; hop++) {
      const live = map.get(cur);
      if (live) return live;
      const next = renames.get(cur);
      cur = next && next !== cur ? next : undefined;
    }
    return undefined;
  };
}

/**
 * (The "fixtures" collection also holds soft-delete markers — `deleted: true` rows — which readers must skip: use this.)
 * stores/fixtures listFixtures over the store: live rows normalized; until converted, the settings-backed assemblies no
 * row holds. By label, then id. A soft-delete marker row (`deleted: true`, written by fixtures-repo.ts removeFixtureLocal)
 * is not listed but still counts as a row, as is a deleted seed doc — a deleted id is never served from settings.
 */
export async function listFixtures(store: HandoffStore, settings: Record<string, unknown> = settingsView()): Promise<FixtureRecord[]> {
  const stored = await store.all<RawFixtureRow & { deleted?: unknown }>("fixtures");
  const rows = stored.filter((r) => r.deleted !== true).map(normalizeFixtureRow);
  if (!fixturesConvertedNow()) {
    const have = new Set([...stored, ...(await store.allIncludingDeleted<{ id: string }>("fixtures"))].map((r) => r.id));
    for (const a of sanitizeFixtureAssemblies(settings.fixtureAssemblies)) if (!have.has(a.id)) rows.push(assemblyToFixture(a, 0));
  }
  return rows.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/** catalog getMany over the slice: the live part for each requested sku (renames followed), each part once. */
export async function getManyLocal(store: HandoffStore, skus: readonly string[]): Promise<LivePart[]> {
  if (!skus.length) return [];
  const resolve = bySkuResolver(await liveCatalog(store), store.catalogRenames);
  const seen = new Set<string>();
  const out: LivePart[] = [];
  for (const s of skus) {
    const p = resolve(s);
    if (p && !seen.has(p.sku)) {
      seen.add(p.sku);
      out.push(p);
    }
  }
  return out;
}

/** A general Estimating Rules rate (pricing.ts value() for store "general"): pricing_rules[id] ?? its registry default. */
export function generalRate(id: string, def: number): number {
  const v = blobData("pricing_rules")[id];
  return v != null && typeof v === "number" ? v : def;
}

/** stores/pricing loadBonusRates: Estimating Rules' 5 % / 2 % bonus rates. */
export function bonusRatesNow(): BonusRates {
  const general = blobData("pricing_rules");
  return bonusRatesFrom(general[BONUS_PACKAGE_RATE_ID], general[BONUS_ESTIMATOR_RATE_ID]);
}

/** pipelines-server loadPipelines: the settings' Daylite pipelines. */
export function pipelinesNow(): Pipelines {
  return resolvePipelines(settingsView() as Parameters<typeof resolvePipelines>[0]);
}

/** review-limits-server loadReviewLimitContext: the settings' review limits over the ports' roster. */
export function reviewLimitContextNow(): ReviewLimitContext {
  return {
    limits: reviewLimitsFrom(settingsView().reviewLimits),
    roster: users.all().map((u) => ({ id: u.id, name: u.name, status: u.status ?? "active", canApprove: roleCan("approve", u.roles) })),
  };
}

/** catalog-renames renameMapOf: old sku → the sku it ended up as (a chain collapses; a cycle stops). Pure. */
export function renameMapOf(direct: ReadonlyMap<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const from of direct.keys()) {
    let to = direct.get(from)!;
    for (let hops = 0; direct.has(to) && hops < direct.size; hops++) to = direct.get(to)!;
    out.set(from, to);
  }
  return out;
}

/**
 * catalog-renames liveRenameRefs over the slice: `m` from the retired stubs (store.catalogRenames);
 * `models` = each target's live model number (the rename log's own `model` column is not sliced).
 */
export async function renameRefs(store: HandoffStore): Promise<{ m: Map<string, string>; models: Map<string, string> }> {
  const m = renameMapOf(store.catalogRenames);
  const models = new Map<string, string>();
  if (m.size) {
    const targets = new Set(m.values());
    for (const p of await liveCatalog(store)) {
      const model = (p.manufacturerModelNumber || "").trim();
      if (targets.has(p.sku) && model) models.set(p.sku, model);
    }
  }
  return { m, models };
}

/** The system-intro library's home in the store: the `intros` collection, doc id = the app's blob name. */
export const INTROS_DOC_ID = "narrative_intros";
export type IntrosDoc = { id: string; intros: SystemIntro[] };

/** stores/narrative-intros listIntros over the store: the collection doc (the prototype's writes), else the sliced blob. */
export async function listIntrosLocal(store: HandoffStore): Promise<SystemIntro[]> {
  const doc = await store.get<IntrosDoc>("intros", INTROS_DOC_ID);
  return sanitizeIntroList(doc ? doc.intros : blobData(INTROS_DOC_ID).intros);
}
