/**
 * #368 — ETC pull → snapshot → resumable import, and the daily delta sync.
 * Server only.
 *
 * A snapshot is one meta row (`etc_price_pull`: id, kind, account, counts,
 * the pull's preview, complete) plus its rows in chunks of ETC_CHUNK_ROWS
 * (`etc_price_pull:<id>:<n>`, ~160 bytes a row, so ~320 KB a chunk): a batch
 * reads only the chunk it is walking, never the whole pull. Each row carries
 * the match made when the snapshot was planned (target SKU + skip code,
 * plan.ts); at import time the target is re-read by primary key
 * (`getManyBySku`, one query per chunk) and re-checked, so a batch never loads
 * the whole catalog.
 *
 * Pull fetches the four full lists, matches them against the catalog, stores
 * the snapshot (with its preview) and returns the preview. `applyBatch` walks
 * the snapshot from the cursor on the connection under a deadline, writing
 * through `mergeUpsert` with `{ pricedAt, priceDate }` = today (Chicago noon)
 * on rows that confirm a price. A pulled snapshot older than 24 h or for
 * another account must be pulled again; Pull refuses while a batch holds the
 * import lease. When the last row lands, `baseline` is set (the snapshot's own
 * Chicago day — what turns the daily sync on) and `lastRun` records the counts.
 *
 * `runDailySync` (the cron rider) works to a hard deadline: the fetch timeout
 * is a share of the budget, and the snapshot read and the catalog read count
 * against it. It fetches `price-updates/{baseline.date}` for the four lists
 * and stores the rows UNMATCHED right away; matching (one catalog read) and
 * applying follow only while time is left, otherwise the next run continues
 * from the stored snapshot and cursor. The baseline moves only once every row
 * is applied; a failure stores `lastRun.error` and leaves it alone.
 */
import { randomUUID } from "node:crypto";
import { deleteBlobs, getBlob, setBlob, updateBlob } from "@/db/doc-store";
import { chicagoDayKey, chicagoDayStart } from "@/lib/drive-plan/day";
import { getManyBySku, list as listCatalog, listDeleted, mergeUpsert, type CatalogPart } from "@/lib/stores/catalog";
import { importResolverFor } from "@/lib/stores/catalog-renames";
import {
  etcBlockedReason, ETC_PULL_BLOB, ETC_SNAPSHOT_TTL_MS, readEtcConnection, updateEtcConnection, type EtcRunSummary,
} from "@/lib/dealer-api/connections";
import { fetchPriceList, fetchPriceUpdates, ETC_TIMEOUT_MS, type EtcClientDeps } from "./client";
import { ETC_COPY } from "./copy";
import { ETC_LISTS, parsePriceList, type EtcListKey, type EtcRow, type EtcSkip } from "./parse";
import {
  countAction, decodeItem, encodeItem, matchEtcItems, mergeEtcRows, planEtc, planEtcItem, previewOf, targetNow, ZERO_ETC_COUNTS,
  type EtcCounts, type EtcItem, type EtcItemTuple, type EtcLivePart, type EtcMatch, type EtcPreview,
} from "./plan";

export { ETC_COPY, ETC_PULL_BLOB, ETC_SNAPSHOT_TTL_MS };
/** Per-call budget for a manual Import batch (the #304 / #294 pattern). */
export const ETC_IMPORT_BUDGET_MS = 40_000;
/** Rows per stored chunk (~160 bytes a row → ~320 KB a chunk). */
export const ETC_CHUNK_ROWS = 2_000;

type Env = Record<string, string | undefined>;

export type EtcApplyDeps = EtcClientDeps & {
  /** Epoch ms stamped on writes and runs; default the clock. */
  now?: number;
  env?: Env;
  /** Budget clock (tests inject a fake one); default Date.now. */
  clock?: () => number;
};

type SnapshotMeta = {
  id: string;
  kind: "pull" | "daily";
  pulledAt: number;
  /** Chicago day of the fetch — the baseline once fully applied. */
  day: string;
  accountId: string;
  total: number;
  chunks: number;
  chunkRows: number;
  /** false: a daily delta stored before its catalog read; the next step matches it. */
  matched: boolean;
  rowCounts: Partial<Record<EtcListKey, number>>;
  skippedCount: number;
  preview: EtcPreview | null;
  complete: boolean;
};

export const etcChunkId = (id: string, n: number) => `${ETC_PULL_BLOB}:${id}:${n}`;

export async function readSnapshotMeta(): Promise<SnapshotMeta | null> {
  const m = await getBlob<Partial<SnapshotMeta>>(ETC_PULL_BLOB, {});
  if (typeof m.id !== "string" || !m.id || typeof m.total !== "number") return null;
  return {
    id: m.id,
    kind: m.kind === "daily" ? "daily" : "pull",
    pulledAt: m.pulledAt ?? 0,
    day: m.day ?? "",
    accountId: m.accountId ?? "",
    total: m.total,
    chunks: m.chunks ?? 0,
    chunkRows: m.chunkRows || ETC_CHUNK_ROWS,
    matched: m.matched !== false,
    rowCounts: m.rowCounts ?? {},
    skippedCount: m.skippedCount ?? 0,
    preview: m.preview ?? null,
    complete: m.complete !== false,
  };
}

async function readChunk(id: string, n: number): Promise<EtcItemTuple[]> {
  const c = await getBlob<{ rows?: unknown }>(etcChunkId(id, n), {});
  return Array.isArray(c.rows) ? (c.rows as EtcItemTuple[]) : [];
}

/** Store a new snapshot (chunks first, then the meta row), then drop the previous one's chunks. */
async function writeSnapshot(meta: Omit<SnapshotMeta, "id" | "total" | "chunks" | "chunkRows" | "complete">, tuples: EtcItemTuple[]): Promise<SnapshotMeta> {
  const old = await readSnapshotMeta();
  const id = `${meta.pulledAt.toString(36)}-${randomUUID().slice(0, 8)}`;
  const chunks = Math.ceil(tuples.length / ETC_CHUNK_ROWS);
  for (let n = 0; n < chunks; n++) await setBlob(etcChunkId(id, n), { rows: tuples.slice(n * ETC_CHUNK_ROWS, (n + 1) * ETC_CHUNK_ROWS) });
  const full: SnapshotMeta = { ...meta, id, total: tuples.length, chunks, chunkRows: ETC_CHUNK_ROWS, complete: false };
  await setBlob(ETC_PULL_BLOB, full);
  if (old && old.id !== id) await deleteBlobs(Array.from({ length: old.chunks }, (_, n) => etcChunkId(old.id, n)));
  return full;
}

/** Chicago noon of `ms`'s day — the stamp an import writes (like the CSV importer's local-noon date). */
function todayStamp(ms: number): { day: string; start: number; noon: number } {
  const day = chicagoDayKey(ms);
  const start = chicagoDayStart(day);
  return { day, start, noon: start + 12 * 60 * 60 * 1000 };
}

function liveView(p: CatalogPart): EtcLivePart {
  return {
    sku: p.sku, mfr: p.mfr, manufacturerPartNumber: p.manufacturerPartNumber, manufacturerModelNumber: p.manufacturerModelNumber,
    list: p.list, cost: p.cost, priceDate: p.priceDate, demoPrice: p.demoPrice, etcPriceList: p.etcPriceList, formerSkus: p.formerSkus,
  };
}

/** The whole catalog, the resolver and the parts people deleted (renames' tombstones excluded). */
async function catalogContext() {
  const [catalog, deleted] = await Promise.all([listCatalog(), listDeleted()]);
  const resolve = await importResolverFor(catalog);
  return { live: catalog.map(liveView), deleted: deleted.filter((p) => !p.renamedTo).map(liveView), resolve };
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
  const blocked = etcBlockedReason(deps.env ?? process.env);
  if (blocked) return { ok: false, error: blocked };
  const now = deps.now ?? Date.now();
  const conn = await readEtcConnection();
  if (!conn.keyEnc) return { ok: false, error: ETC_COPY.noKey };
  if (!conn.accountId) return { ok: false, error: ETC_COPY.noAccount };
  if (conn.applyingUntil > Date.now()) return { ok: false, error: ETC_COPY.busy };
  const accountId = conn.accountId;
  const fetched = await fetchAll((l) => fetchPriceList(accountId, l, deps));
  if (!fetched.ok) return { ok: false, error: fetched.error };
  const items = mergeEtcRows(fetched.rows);
  const ctx = await catalogContext();
  const matches = matchEtcItems(items, ctx.live, ctx.deleted, ctx.resolve);
  const t = todayStamp(now);
  const preview = previewOf(planEtc(items, matches, ctx.live, { now, todayStart: t.start, full: true }), fetched.rowCounts, fetched.skipped);
  // A batch may have taken the lease while we fetched: never swap the snapshot under it.
  if ((await readEtcConnection()).applyingUntil > Date.now()) return { ok: false, error: ETC_COPY.busy };
  await writeSnapshot(
    { kind: "pull", pulledAt: now, day: t.day, accountId, matched: true, rowCounts: fetched.rowCounts, skippedCount: fetched.skipped.length, preview },
    items.map((it, i) => encodeItem(it, matches[i]))
  );
  await updateEtcConnection(() => ({ cursor: null }));
  return { ok: true, preview, pulledAt: now, accountName: conn.accountName };
}

export type EtcBatchResult = { ok: true; done: number; total: number; finished: boolean; counts: EtcCounts } | { ok: false; error: string };

/** Write one planned action. */
async function writeAction(a: ReturnType<typeof planEtcItem>, stamp: number): Promise<void> {
  const priced = { pricedAt: stamp, priceDate: stamp };
  if (a.kind === "create") await mergeUpsert(a.sku, a.part, priced);
  else if (a.kind === "update") await mergeUpsert(a.sku, a.patch, a.priced ? priced : {});
  else if (a.kind === "unchanged" && a.redate) await mergeUpsert(a.sku, {}, priced);
}

/** Match a daily delta stored unmatched: one catalog read, every chunk rewritten with its matches. */
async function matchStored(meta: SnapshotMeta): Promise<void> {
  const tuples: EtcItemTuple[] = [];
  for (let n = 0; n < meta.chunks; n++) tuples.push(...(await readChunk(meta.id, n)));
  const items = tuples.map((t) => decodeItem(t)?.item ?? null);
  const valid = items.filter((x): x is EtcItem => !!x);
  const ctx = await catalogContext();
  const matches = matchEtcItems(valid, ctx.live, ctx.deleted, ctx.resolve);
  let k = 0;
  const out = items.map((it, i) => (it ? encodeItem(it, matches[k++]) : tuples[i]));
  for (let n = 0; n < meta.chunks; n++) await setBlob(etcChunkId(meta.id, n), { rows: out.slice(n * meta.chunkRows, (n + 1) * meta.chunkRows) });
  await updateBlob(ETC_PULL_BLOB, (cur) => (cur.id === meta.id ? { matched: true } : null));
}

/** Time kept for the matching step (one full catalog read) before starting it. */
export const ETC_MATCH_RESERVE_MS = 6_000;

class OutOfTime extends Error {}

/**
 * Apply the stored snapshot from the cursor until the deadline. A manual
 * Import always applies at least one row (so every call makes progress); the
 * cron passes `minOne: false` and stops at its deadline even before a row.
 */
export async function applyBatch(opts: { budgetMs?: number; deadlineAt?: number; minOne?: boolean } & EtcApplyDeps = {}): Promise<EtcBatchResult> {
  const clock = opts.clock ?? Date.now;
  const t0 = clock();
  const deadline = opts.deadlineAt ?? t0 + Math.max(0, opts.budgetMs ?? ETC_IMPORT_BUDGET_MS);
  const minOne = opts.minOne !== false;
  const now = opts.now ?? t0;
  const blocked = etcBlockedReason(opts.env ?? process.env);
  if (blocked) return { ok: false, error: blocked };
  const meta = await readSnapshotMeta();
  if (!meta || meta.complete || !meta.total) return { ok: false, error: ETC_COPY.nothing };
  const conn = await readEtcConnection();
  if (!conn.accountId || meta.accountId !== conn.accountId) return { ok: false, error: ETC_COPY.otherAccount };
  if (meta.kind === "pull" && now - meta.pulledAt > ETC_SNAPSHOT_TTL_MS) return { ok: false, error: ETC_COPY.stale };

  // Lease: one batch at a time (and Pull refuses while it's held).
  const leaseNow = Date.now();
  const lease = leaseNow + Math.max(0, deadline - t0) + 30_000;
  const held = await updateEtcConnection((cur) => (cur.applyingUntil > leaseNow ? null : { applyingUntil: lease }));
  if (held.applyingUntil !== lease) return { ok: false, error: ETC_COPY.busy };

  const resume = conn.cursor && conn.cursor.snapshotId === meta.id ? conn.cursor : null;
  const start = Math.min(resume?.next ?? 0, meta.total);
  // A fresh walk starts with the rows the parser already skipped.
  let counts: EtcCounts = resume?.counts ? { ...ZERO_ETC_COUNTS, ...resume.counts } : { ...ZERO_ETC_COUNTS, skipped: meta.skippedCount || 0 };
  let i = start;
  let error: string | null = null;
  const timeLeft = () => deadline - clock();
  const mayGo = () => (minOne && i === start) || timeLeft() > 0;
  try {
    if (!meta.matched) {
      if (!minOne && timeLeft() < ETC_MATCH_RESERVE_MS) throw new OutOfTime();
      await matchStored(meta);
    }
    const t = todayStamp(now);
    const planCtx = { now, todayStart: t.start, full: meta.kind === "pull" };
    while (i < meta.total && mayGo()) {
      const n = Math.floor(i / meta.chunkRows);
      const rows = (await readChunk(meta.id, n)).map(decodeItem);
      if (!rows.length) {
        i = Math.min(meta.total, (n + 1) * meta.chunkRows); // a missing chunk: move past it
        continue;
      }
      const from = i - n * meta.chunkRows;
      const want = new Set<string>();
      for (const d of rows.slice(from)) if (d?.match && d.match.code === 0) want.add(d.match.sku || d.item.pn);
      const liveNow = new Map<string, EtcLivePart>();
      for (const [sku, p] of await getManyBySku([...want])) liveNow.set(sku, liveView(p));
      for (let k = from; k < rows.length && i < meta.total && mayGo(); k++, i++) {
        const d = rows[k];
        if (!d) continue;
        const stored: EtcMatch = d.match ?? { sku: "", code: 4 };
        const { match, existing } = targetNow(d.item, stored, liveNow);
        const a = planEtcItem(d.item, match, existing, planCtx);
        await writeAction(a, t.noon);
        counts = countAction(counts, a);
      }
    }
  } catch (e) {
    if (!(e instanceof OutOfTime)) {
      // e.name only: a driver error message can embed query params.
      console.error("[etc] import batch failed", e instanceof Error ? e.name : "error");
      error = "Writing the ETC prices failed part-way — run Import again to finish.";
    }
  }

  const finished = i >= meta.total && !error;
  const kind = meta.kind === "pull" ? "import" : "daily";
  const summary = (pending: boolean, err: string | null): EtcRunSummary => ({ at: now, kind, ok: !err, rows: i, total: meta.total, pending, error: err, ...counts });
  await updateEtcConnection((cur) => {
    const release = cur.applyingUntil === lease ? { applyingUntil: 0 } : {};
    if (finished) return { ...release, cursor: null, baseline: { date: meta.day, at: now }, lastRun: summary(false, null) };
    return {
      ...release,
      cursor: { snapshotId: meta.id, next: i, counts },
      ...(kind === "daily" || error ? { lastRun: summary(true, error) } : {}),
    };
  });
  if (finished) {
    // Only THIS snapshot is marked complete — a newer one stored meanwhile is left alone.
    const after = await updateBlob(ETC_PULL_BLOB, (cur) => (cur.id === meta.id ? { complete: true } : null));
    if (after.id === meta.id) await deleteBlobs(Array.from({ length: meta.chunks }, (_, n) => etcChunkId(meta.id, n)));
  }
  if (error) return { ok: false, error };
  return { ok: true, done: i, total: meta.total, finished, counts };
}

export type EtcDailyResult =
  | { ran: false; reason: string }
  | { ran: true; ok: boolean; finished: boolean; rows: number; total: number; error: string | null };

/** The fetch may use at most this share of the time left. */
export const ETC_FETCH_SHARE = 0.4;
const MIN_FETCH_MS = 1_500;

/** The daily cron rider, to a hard deadline. Never throws for ETC's own failures (they land in lastRun). */
export async function runDailySync(opts: { budgetMs: number } & EtcApplyDeps): Promise<EtcDailyResult> {
  const env = opts.env ?? process.env;
  const blocked = etcBlockedReason(env);
  if (blocked) return { ran: false, reason: blocked };
  const clock = opts.clock ?? Date.now;
  const t0 = clock();
  const deadline = t0 + Math.max(0, opts.budgetMs);
  const now = opts.now ?? t0;
  const left = () => deadline - clock();
  const conn = await readEtcConnection();
  if (!conn.keyEnc || !conn.accountId) return { ran: false, reason: "not connected" };
  if (!conn.baseline) return { ran: false, reason: "no baseline (import once first)" };
  if (conn.applyingUntil > Date.now()) return { ran: false, reason: "an import is running" };
  const accountId = conn.accountId;

  const meta = await readSnapshotMeta();
  if (meta && !meta.complete && meta.total && meta.accountId === accountId) {
    if (meta.kind === "pull" && now - meta.pulledAt <= ETC_SNAPSHOT_TTL_MS) return { ran: false, reason: "a manual pull is waiting to be imported" };
    if (meta.kind === "daily") return toDaily(await applyBatch({ ...opts, deadlineAt: deadline, minOne: false, clock }), meta.total);
  }

  if (left() < MIN_FETCH_MS * 2) return { ran: false, reason: "no time left to ask ETC" };
  const since = conn.baseline.date;
  const timeoutMs = Math.max(MIN_FETCH_MS, Math.min(ETC_TIMEOUT_MS, Math.floor(left() * ETC_FETCH_SHARE)));
  const fetched = await fetchAll((l) => fetchPriceUpdates(accountId, l, since, { ...opts, timeoutMs }));
  const t = todayStamp(now);
  if (!fetched.ok) {
    await updateEtcConnection(() => ({ lastRun: { at: now, kind: "daily", ok: false, rows: 0, total: 0, pending: false, error: fetched.error, ...ZERO_ETC_COUNTS } }));
    return { ran: true, ok: false, finished: false, rows: 0, total: 0, error: fetched.error };
  }
  const items = mergeEtcRows(fetched.rows);
  if (!items.length) {
    await updateEtcConnection(() => ({ baseline: { date: t.day, at: now }, cursor: null, lastRun: { at: now, kind: "daily", ok: true, rows: 0, total: 0, pending: false, error: null, ...ZERO_ETC_COUNTS, skipped: fetched.skipped.length } }));
    return { ran: true, ok: true, finished: true, rows: 0, total: 0, error: null };
  }
  // Stored unmatched first, so nothing fetched is lost if the time runs out.
  const daily = await writeSnapshot(
    { kind: "daily", pulledAt: now, day: t.day, accountId, matched: false, rowCounts: fetched.rowCounts, skippedCount: fetched.skipped.length, preview: null },
    items.map((it) => encodeItem(it, null))
  );
  await updateEtcConnection(() => ({ cursor: null }));
  if (left() < ETC_MATCH_RESERVE_MS) {
    await updateEtcConnection(() => ({ lastRun: { at: now, kind: "daily", ok: true, rows: 0, total: daily.total, pending: true, error: null, ...ZERO_ETC_COUNTS } }));
    return { ran: true, ok: true, finished: false, rows: 0, total: daily.total, error: null };
  }
  return toDaily(await applyBatch({ ...opts, deadlineAt: deadline, minOne: false, clock }), daily.total);
}

function toDaily(r: EtcBatchResult, total: number): EtcDailyResult {
  if (!r.ok) return { ran: true, ok: false, finished: false, rows: 0, total, error: r.error };
  return { ran: true, ok: true, finished: r.finished, rows: r.done, total: r.total, error: null };
}

/** The cron route's hard stop (maxDuration is 60) and the rider's cap (spec §8). */
export const ETC_ROUTE_HARD_STOP_MS = 50_000;
export const ETC_RIDER_MAX_MS = 20_000;
const ETC_RIDER_MIN_MS = 5_000;

export type EtcRiderResult = EtcDailyResult | { ran: false; error: string };

/**
 * The `/api/drive/sync` rider: min(20 s, what's left before 50 s of route
 * time), skipped under 5 s. Never throws — the drive sync's answer never
 * depends on it.
 */
export async function runEtcDailyRider(routeStarted: number, deps: EtcApplyDeps = {}): Promise<EtcRiderResult> {
  const clock = deps.clock ?? Date.now;
  const budgetMs = Math.min(ETC_RIDER_MAX_MS, Math.max(0, routeStarted + ETC_ROUTE_HARD_STOP_MS - clock()));
  if (budgetMs < ETC_RIDER_MIN_MS) return { ran: false, reason: "no time left in the cron run" };
  try {
    return await runDailySync({ ...deps, budgetMs });
  } catch (err) {
    // e.name only: a driver error message can embed query params.
    console.error("[etc] daily price sync failed", err instanceof Error ? err.name : "error");
    return { ran: false, error: "ETC daily price sync failed" };
  }
}
