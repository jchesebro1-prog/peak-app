import { collapseDuplicates, type OpenWork } from "./dedupe";
import { rankCandidates } from "./rank";
import { feedErrorMessage, type FeedError, type SnapshotRow, type TriageCandidate } from "./types";
import type { FeedCtx, TriageFeed } from "./feeds/context";
import { FEEDS } from "./feeds";

/** Run every feed; a feed that throws (sync or async) becomes a FeedError, never a failed list. */
export async function gatherCandidates(
  ctx: FeedCtx,
  feeds: readonly TriageFeed[]
): Promise<{ candidates: TriageCandidate[]; openWork: OpenWork[]; errors: FeedError[] }> {
  const settled = await Promise.allSettled(feeds.map((f) => Promise.resolve().then(() => f.load(ctx))));
  const candidates: TriageCandidate[] = [];
  const openWork: OpenWork[] = [];
  const errors: FeedError[] = [];
  settled.forEach((s, i) => {
    const f = feeds[i];
    if (s.status === "fulfilled") {
      candidates.push(...s.value.candidates);
      openWork.push(...(s.value.openWork ?? []));
    } else {
      console.error(`[triage] ${f.source} feed failed`, s.reason);
      errors.push({ source: f.source, message: feedErrorMessage(f.source) });
    }
  });
  return { candidates, openWork, errors };
}

/** A stored snapshot keeps this many rows at most (after ranking): the list is for a morning, not an archive. */
export const MAX_SNAPSHOT_ROWS = 150;

/** Collapse duplicate call to-dos → rank → one row per key (the highest-ranked wins) → the top MAX_SNAPSHOT_ROWS. */
export function toSnapshotRows(candidates: readonly TriageCandidate[], openWork: readonly OpenWork[]): SnapshotRow[] {
  const seen = new Set<string>();
  const rows: SnapshotRow[] = [];
  for (const c of rankCandidates(collapseDuplicates(candidates, openWork))) {
    if (seen.has(c.key)) continue;
    seen.add(c.key);
    rows.push({ key: c.key, source: c.source, title: c.title, sub: c.sub, href: c.href, score: c.score, reason: c.reason, callLine: c.callLine ?? null, also: c.also ?? [], alsoKeys: c.alsoKeys ?? [] });
  }
  return rows.slice(0, MAX_SNAPSHOT_ROWS);
}

export async function buildRows(ctx: FeedCtx, feeds: readonly TriageFeed[] = FEEDS): Promise<{ rows: SnapshotRow[]; errors: FeedError[] }> {
  const g = await gatherCandidates(ctx, feeds);
  return { rows: toSnapshotRows(g.candidates, g.openWork), errors: g.errors };
}
