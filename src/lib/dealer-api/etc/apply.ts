/**
 * #368 — ETC pull → snapshot → resumable import, and the daily delta sync.
 * Server only.
 *
 * Pull fetches the four full lists, parses and merges them, and stores a
 * compact snapshot in the `etc_price_pull` blob; it returns the preview.
 * `applyBatch` walks the snapshot under a time budget from the cursor kept on
 * the connection (`dealer_connections.etc.cursor`), writing through
 * `mergeUpsert` with `{ pricedAt, priceDate }` = today (Chicago noon) on rows
 * that confirm a price. A pulled snapshot older than 24 h or for another
 * account must be pulled again. When the last row lands, `baseline` is set
 * (the snapshot's own Chicago day — what turns the daily sync on) and
 * `lastRun` records the counts.
 *
 * `runDailySync` (the cron rider) fetches `price-updates/{baseline.date}` for
 * the four lists, stores them as a `daily` snapshot and applies it with the
 * same plan — new parts included. A budget that runs out keeps the cursor and
 * the next run finishes the same snapshot before the baseline moves. A
 * failure stores `lastRun.error` and leaves the baseline alone.
 */
import { getBlob, setBlob } from "@/db/doc-store";
import { chicagoDayKey, chicagoDayStart } from "@/lib/drive-plan/day";
import { list as listCatalog, listDeleted, mergeUpsert, type CatalogPart } from "@/lib/stores/catalog";
import { importResolverFor } from "@/lib/stores/catalog-renames";
import { etcPreviewBlocked, etcSyncDisabled, readEtcConnection, updateEtcConnection, type EtcRunSummary } from "@/lib/dealer-api/connections";
import { fetchPriceList, fetchPriceUpdates, ETC_TIMEOUT_MS, type EtcClientDeps } from "./client";
import { ETC_LISTS, parsePriceList, type EtcListKey, type EtcRow, type EtcSkip } from "./parse";
import {
  buildEtcMatcher, countAction, decodeItem, encodeItem, mergeEtcRows, planEtc, planEtcItem, previewOf, ZERO_ETC_COUNTS,
  type EtcAction, type EtcCounts, type EtcItem, type EtcItemTuple, type EtcPreview,
} from "./plan";

export const ETC_PULL_BLOB = "etc_price_pull";
export const ETC_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
/** Per-call budget for a manual Import batch (the #304 / #294 pattern). */
export const ETC_IMPORT_BUDGET_MS = 40_000;

export const ETC_COPY = {
  preview: "ETC sync is off on preview deploys.",
  disabled: "ETC sync is turned off (ETC_SYNC_DISABLED).",
  noKey: "Save an ETC API key first.",
  noAccount: "Test the connection and pick an ETC account first.",
  nothing: "Nothing to import — pull prices first.",
  stale: "These prices were pulled more than 24 hours ago — pull again.",
  otherAccount: "These prices were pulled for another ETC account — pull again.",
  busy: "An ETC import is already running — try again in a minute.",
} as const;

type Env = Record<string, string | undefined>;

export type EtcApplyDeps = EtcClientDeps & { now?: number; env?: Env };

type Snapshot = {
  kind: "pull" | "daily";
  pulledAt: number;
  /** Chicago day of the fetch — the baseline once fully applied. */
  day: string;
  accountId: string;
  items: EtcItemTuple[];
  rowCounts: Partial<Record<EtcListKey, number>>;
  skippedCount: number;
  complete: boolean;
};

const EMPTY_SNAPSHOT: Snapshot = { kind: "pull", pulledAt: 0, day: "", accountId: "", items: [], rowCounts: {}, skippedCount: 0, complete: true };

async function readSnapshot(): Promise<Snapshot> {
  const s = await getBlob<Snapshot>(ETC_PULL_BLOB, { ...EMPTY_SNAPSHOT });
  return { ...s, items: Array.isArray(s.items) ? s.items : [] };
}

/** Chicago noon of `ms`'s day — the stamp an import writes (like the CSV importer's local-noon date). */
function todayStamp(ms: number): { day: string; start: number; noon: number } {
  const day = chicagoDayKey(ms);
  const start = chicagoDayStart(day);
  return { day, start, noon: start + 12 * 60 * 60 * 1000 };
}

function liveView(catalog: CatalogPart[]) {
  return catalog.map((p) => ({ sku: p.sku, mfr: p.mfr, manufacturerPartNumber: p.manufacturerPartNumber, manufacturerModelNumber: p.manufacturerModelNumber, list: p.list, cost: p.cost, priceDate: p.priceDate, demoPrice: p.demoPrice, formerSkus: p.formerSkus }));
}

async function catalogContext() {
  const [catalog, deleted] = await Promise.all([listCatalog(), listDeleted()]);
  const resolve = await importResolverFor(catalog);
  const deletedSkus = new Set(deleted.filter((p) => !p.renamedTo).map((p) => p.sku));
  return { live: liveView(catalog), resolve, deletedSkus };
}

type Fetched = { ok: true; rows: EtcRow[]; skipped: EtcSkip[]; rowCounts: Partial<Record<EtcListKey, number>> } | { ok: false; error: string };

async function fetchAll(get: (list: EtcListKey) => Promise<{ ok: true; data: unknown } | { ok: false; message: string }>): Promise<Fetched> {
  const replies = await Promise.all(ETC_LISTS.map((l) => get(l)));
  const rows: EtcRow[] = [];
  const skipped: EtcSkip[] = [];
  const rowCounts: Partial<Record<EtcListKey, number>> = {};
  for (let i = 0; i < ETC_LISTS.length; i++) {
    const r = replies[i];
    if (!r.ok) return { ok: false, error: r.message };
    const parsed = parsePriceList(r.data, ETC_LISTS[i]);
    if (parsed.error) return { ok: false, error: parsed.error };
    rows.push(...parsed.rows);
    skipped.push(...parsed.skipped);
    rowCounts[ETC_LISTS[i]] = parsed.rows.length;
  }
  return { ok: true, rows, skipped, rowCounts };
}

export type EtcPullResult = { ok: true; preview: EtcPreview; pulledAt: number; accountName: string | null } | { ok: false; error: string };

/** Manual Pull: fetch all four full lists, store the snapshot, return the preview. Writes no part. */
export async function pullAll(deps: EtcApplyDeps = {}): Promise<EtcPullResult> {
  const env = deps.env ?? process.env;
  if (etcPreviewBlocked(env)) return { ok: false, error: ETC_COPY.preview };
  if (etcSyncDisabled(env)) return { ok: false, error: ETC_COPY.disabled };
  const conn = await readEtcConnection();
  if (!conn.keyEnc) return { ok: false, error: ETC_COPY.noKey };
  if (!conn.accountId) return { ok: false, error: ETC_COPY.noAccount };
  const accountId = conn.accountId;
  const now = deps.now ?? Date.now();
  const fetched = await fetchAll((l) => fetchPriceList(accountId, l, deps));
  if (!fetched.ok) return { ok: false, error: fetched.error };
  const items = mergeEtcRows(fetched.rows);
  const ctx = await catalogContext();
  const t = todayStamp(now);
  const actions = planEtc(items, ctx.live, ctx.resolve, { now, todayStart: t.start, deletedSkus: ctx.deletedSkus });
  const preview = previewOf(actions, fetched.rowCounts, fetched.skipped);
  const snap: Snapshot = { kind: "pull", pulledAt: now, day: t.day, accountId, items: items.map(encodeItem), rowCounts: fetched.rowCounts, skippedCount: fetched.skipped.length, complete: false };
  await setBlob(ETC_PULL_BLOB, snap);
  await updateEtcConnection(() => ({ cursor: null }));
  return { ok: true, preview, pulledAt: now, accountName: conn.accountName };
}

export type EtcBatchResult = { ok: true; done: number; total: number; finished: boolean; counts: EtcCounts } | { ok: false; error: string };

/** Write one planned action. */
async function writeAction(a: EtcAction, stamp: number): Promise<void> {
  const priced = { pricedAt: stamp, priceDate: stamp };
  if (a.kind === "create") await mergeUpsert(a.sku, a.part, priced);
  else if (a.kind === "update") await mergeUpsert(a.sku, a.patch, a.priced ? priced : {});
  else if (a.kind === "unchanged" && a.redate) await mergeUpsert(a.sku, {}, priced);
}

/**
 * Apply the stored snapshot from the cursor until `budgetMs` runs out (at
 * least one row per call, so every call makes progress). Resumable: a reload
 * or the next call picks up at the cursor.
 */
export async function applyBatch(opts: { budgetMs?: number } & EtcApplyDeps = {}): Promise<EtcBatchResult> {
  const budgetMs = Math.max(0, opts.budgetMs ?? ETC_IMPORT_BUDGET_MS);
  const t0 = Date.now();
  const now = opts.now ?? t0;
  const snap = await readSnapshot();
  if (snap.complete || !snap.items.length) return { ok: false, error: ETC_COPY.nothing };
  const conn = await readEtcConnection();
  if (!conn.accountId || snap.accountId !== conn.accountId) return { ok: false, error: ETC_COPY.otherAccount };
  if (snap.kind === "pull" && now - snap.pulledAt > ETC_SNAPSHOT_TTL_MS) return { ok: false, error: ETC_COPY.stale };

  // Lease: one batch at a time.
  const lease = now + budgetMs + 30_000;
  const held = await updateEtcConnection((cur) => (cur.applyingUntil > now ? null : { applyingUntil: lease }));
  if (held.applyingUntil !== lease) return { ok: false, error: ETC_COPY.busy };

  const total = snap.items.length;
  const resume = conn.cursor && conn.cursor.snapshotAt === snap.pulledAt ? conn.cursor : null;
  const start = Math.min(resume?.next ?? 0, total);
  // A fresh walk starts with the rows the parser already skipped.
  let counts: EtcCounts = resume?.counts ? { ...ZERO_ETC_COUNTS, ...resume.counts } : { ...ZERO_ETC_COUNTS, skipped: snap.skippedCount || 0 };
  let i = start;
  let error: string | null = null;
  try {
    const items = snap.items.map(decodeItem);
    const valid = items.filter((x): x is EtcItem => !!x);
    const ctx = await catalogContext();
    const bySku = new Map(ctx.live.map((p) => [p.sku, p]));
    const match = buildEtcMatcher(ctx.live, ctx.resolve, valid);
    const t = todayStamp(now);
    const planCtx = { now, todayStart: t.start, deletedSkus: ctx.deletedSkus };
    while (i < total && (i === start || Date.now() - t0 < budgetMs)) {
      const item = items[i];
      if (item) {
        const sku = match(item);
        const a = planEtcItem(item, sku, sku ? bySku.get(sku) ?? null : null, planCtx);
        await writeAction(a, t.noon);
        counts = countAction(counts, a);
      }
      i++;
    }
  } catch (e) {
    // e.name only: a driver error message can embed query params.
    console.error("[etc] import batch failed", e instanceof Error ? e.name : "error");
    error = "Writing the ETC prices failed part-way — run Import again to finish.";
  }

  const finished = i >= total && !error;
  const kind = snap.kind === "pull" ? "import" : "daily";
  const summary = (pending: boolean, err: string | null): EtcRunSummary => ({ at: now, kind, ok: !err, rows: i, pending, error: err, ...counts });
  await updateEtcConnection((cur) => {
    const release = cur.applyingUntil === lease ? { applyingUntil: 0 } : {};
    if (finished) {
      return { ...release, cursor: null, baseline: { date: snap.day, at: now }, lastRun: summary(false, null) };
    }
    return {
      ...release,
      cursor: { snapshotAt: snap.pulledAt, next: i, counts },
      ...(kind === "daily" || error ? { lastRun: summary(true, error) } : {}),
    };
  });
  if (finished) await setBlob(ETC_PULL_BLOB, { complete: true, items: [] });
  if (error) return { ok: false, error };
  return { ok: true, done: i, total, finished, counts };
}

export type EtcDailyResult =
  | { ran: false; reason: string }
  | { ran: true; ok: boolean; finished: boolean; rows: number; total: number; error: string | null };

/** The daily cron rider. Never throws for ETC's own failures (they land in lastRun). */
export async function runDailySync(opts: { budgetMs: number } & EtcApplyDeps): Promise<EtcDailyResult> {
  const env = opts.env ?? process.env;
  if (etcPreviewBlocked(env)) return { ran: false, reason: "preview deploy" };
  if (etcSyncDisabled(env)) return { ran: false, reason: "ETC_SYNC_DISABLED" };
  const t0 = Date.now();
  const now = opts.now ?? t0;
  const conn = await readEtcConnection();
  if (!conn.keyEnc || !conn.accountId) return { ran: false, reason: "not connected" };
  if (!conn.baseline) return { ran: false, reason: "no baseline (import once first)" };
  const accountId = conn.accountId;
  const left = () => Math.max(0, opts.budgetMs - (Date.now() - t0));

  const snap = await readSnapshot();
  if (!snap.complete && snap.items.length && snap.accountId === accountId) {
    if (snap.kind === "pull" && now - snap.pulledAt <= ETC_SNAPSHOT_TTL_MS) return { ran: false, reason: "a manual pull is waiting to be imported" };
    if (snap.kind === "daily") return toDaily(await applyBatch({ ...opts, budgetMs: left() }), snap.items.length);
  }

  const since = conn.baseline.date;
  const timeoutMs = Math.max(1_000, Math.min(ETC_TIMEOUT_MS, left()));
  const fetched = await fetchAll((l) => fetchPriceUpdates(accountId, l, since, { ...opts, timeoutMs }));
  const t = todayStamp(now);
  if (!fetched.ok) {
    await updateEtcConnection(() => ({ lastRun: { at: now, kind: "daily", ok: false, rows: 0, pending: false, error: fetched.error, ...ZERO_ETC_COUNTS } }));
    return { ran: true, ok: false, finished: false, rows: 0, total: 0, error: fetched.error };
  }
  const items = mergeEtcRows(fetched.rows);
  if (!items.length) {
    await updateEtcConnection(() => ({ baseline: { date: t.day, at: now }, cursor: null, lastRun: { at: now, kind: "daily", ok: true, rows: 0, pending: false, error: null, ...ZERO_ETC_COUNTS, skipped: fetched.skipped.length } }));
    return { ran: true, ok: true, finished: true, rows: 0, total: 0, error: null };
  }
  const daily: Snapshot = { kind: "daily", pulledAt: now, day: t.day, accountId, items: items.map(encodeItem), rowCounts: fetched.rowCounts, skippedCount: fetched.skipped.length, complete: false };
  await setBlob(ETC_PULL_BLOB, daily);
  await updateEtcConnection(() => ({ cursor: null }));
  return toDaily(await applyBatch({ ...opts, budgetMs: left() }), items.length);
}

function toDaily(r: EtcBatchResult, total: number): EtcDailyResult {
  if (!r.ok) return { ran: true, ok: false, finished: false, rows: 0, total, error: r.error };
  return { ran: true, ok: true, finished: r.finished, rows: r.done, total: r.total, error: null };
}

/** The cron route's whole budget (maxDuration 60) and the rider's cap (spec §8). */
export const ETC_ROUTE_BUDGET_MS = 55_000;
export const ETC_RIDER_MAX_MS = 20_000;
const ETC_RIDER_MIN_MS = 5_000;

export type EtcRiderResult = EtcDailyResult | { ran: false; error: string };

/**
 * The `/api/drive/sync` rider: min(20 s, what's left of the route's 55 s),
 * skipped under 5 s. Never throws — the drive sync's answer never depends on it.
 */
export async function runEtcDailyRider(routeStarted: number, deps: EtcApplyDeps = {}): Promise<EtcRiderResult> {
  const budgetMs = Math.min(ETC_RIDER_MAX_MS, Math.max(0, ETC_ROUTE_BUDGET_MS - (Date.now() - routeStarted)));
  if (budgetMs < ETC_RIDER_MIN_MS) return { ran: false, reason: "no time left in the cron run" };
  try {
    return await runDailySync({ ...deps, budgetMs });
  } catch (err) {
    // e.name only: a driver error message can embed query params.
    console.error("[etc] daily price sync failed", err instanceof Error ? err.name : "error");
    return { ran: false, error: "ETC daily price sync failed" };
  }
}
