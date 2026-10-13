/** Outcome rules (spec §7–§9). Pure. */
import type { AssistOutcome } from "./types";

const words = (s: string): string[] => (s || "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 2000);

/** Word-level Levenshtein distance ÷ the longer word count (0 = identical, 1 = nothing shared). */
export function editRatio(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.length && !y.length) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length] / Math.max(x.length, y.length);
}

export function replyOutcome(draft: string, sent: string): { outcome: "accepted" | "edited"; editRatio: number } {
  const r = Math.round(editRatio(draft, sent) * 1000) / 1000;
  return { outcome: r <= 0.1 ? "accepted" : "edited", editRatio: r };
}

export type DraftLine = { sku: string; qty: number };
type QuoteLike = { spec?: { sections?: Array<{ kind?: string; items?: Array<{ sku?: string; qty?: number; bonus?: unknown }> }> } };

/** Compare the drafted catalog lines with the quote as it stands now. Custom (sku "") lines are not counted. */
export function estimateKeep(
  lines: DraftLine[],
  quote: QuoteLike | null
): { outcome: AssistOutcome; kept: number; changed: number; removed: number; total: number } {
  const drafted = (lines || []).filter((l) => l && l.sku);
  if (!quote) return { outcome: "discarded", kept: 0, changed: 0, removed: drafted.length, total: drafted.length };
  const pool = new Map<string, number[]>();
  for (const s of quote.spec?.sections ?? []) {
    if (s.kind === "labor") continue;
    for (const it of s.items ?? []) {
      if (!it.sku || it.bonus) continue;
      const k = it.sku.toLowerCase();
      pool.set(k, [...(pool.get(k) ?? []), Number(it.qty) || 0]);
    }
  }
  let kept = 0, changed = 0, removed = 0;
  for (const l of drafted) {
    const qs = pool.get(l.sku.toLowerCase());
    if (!qs || !qs.length) { removed++; continue; }
    const at = qs.indexOf(l.qty);
    if (at >= 0) { kept++; qs.splice(at, 1); } else { changed++; qs.shift(); }
  }
  const total = drafted.length;
  if (!total) return { outcome: "edited", kept, changed, removed, total };
  const outcome: AssistOutcome = kept / total >= 0.9 ? "accepted" : (kept + changed) / total < 0.1 ? "discarded" : "edited";
  return { outcome, kept, changed, removed, total };
}

/**
 * A draft-estimate run's outcome from its stored detail (D879): no `quoteId`
 * key yet = pending (null); an explicit `quoteId: null` (no systems built, or
 * the create failed) = discarded; else estimateKeep against the quote as it
 * stands now (null = deleted = discarded).
 */
export function estimateOutcomeFor(detail: { quoteId?: string | null; lines?: DraftLine[] } | null | undefined, quote: QuoteLike | null): AssistOutcome | null {
  if (!detail || detail.quoteId === undefined) return null;
  if (detail.quoteId === null || detail.quoteId === "") return "discarded";
  return estimateKeep(detail.lines ?? [], quote).outcome;
}
