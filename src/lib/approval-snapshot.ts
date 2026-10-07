/**
 * #284 — what an approval was granted against, and whether the quote still
 * matches it (spec §2). Approvals hold through wording edits (descriptions,
 * narrative, notes, terms) and go stale when the sell total or the priced
 * line set changes. Staleness is DERIVED, never stored — the same principle
 * as D92's approvalIsStale for consulting phases.
 *
 * Pure and CLIENT-SAFE: imports only the pure rewards credit-line helpers.
 * Rewards credit lines are excluded and the sell is the GROSS (pre-credit)
 * value, so a credit re-clamp on save (#282) never clears an approval.
 *
 * auto_limit approvals are deliberately NOT snapshot-checked here — #242's
 * own rule (autoSnapshotUnchanged / still fits the owner's limit) governs them.
 */
import { grossQuoteValue, isRewardCreditItem } from "@/lib/rewards/credit-line";

export type ApprovalSnapshot = { sell: number; linesKey: string };

export type FingerprintInput = {
  value?: unknown;
  spec?: unknown;
  quoteType?: unknown;
  flameTest?: unknown;
  inspection?: unknown;
  repair?: unknown;
};

type ReviewWithSnapshot = { state?: string; method?: string | null; approvedAgainst?: ApprovalSnapshot | null };

const n = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "");
const s = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const b = (v: unknown): string => (v ? "1" : "0");

/** FNV-1a 32-bit, hex — a stable short key; collisions only matter to an
 *  adversary editing their own quote, who could just resubmit anyway. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function linesKeyOf(spec: unknown): string {
  const rows: string[] = [];
  const sp = (spec && typeof spec === "object" ? spec : {}) as { sections?: unknown; lines?: unknown };
  if (Array.isArray(sp.sections)) {
    for (const sec of sp.sections as Array<Record<string, unknown>>) {
      if (!sec || typeof sec !== "object") continue;
      // Phase 2b: an alternate system appends its flag, so flipping a group
      // In total ⇄ Alternate re-asks approval — while a section without the
      // stamp keeps its pre-2b row exactly (existing approvals stay valid).
      const secRow = ["sec", s(sec.kind), n(sec.freightPct), n(sec.sellOverride)];
      if (sec.alternate === true) secRow.push("alt", b(sec.alternate));
      rows.push(secRow.join("|"));
      const items = Array.isArray(sec.items) ? (sec.items as Array<Record<string, unknown>>) : [];
      for (const it of items) {
        if (!it || typeof it !== "object" || isRewardCreditItem(it)) continue;
        rows.push(["it", s(it.sku), b(it.custom), n(it.qty), n(it.price), n(it.extSellOverride), b(it.option), b(it.labor)].join("|"));
      }
    }
  }
  if (Array.isArray(sp.lines)) {
    for (const l of sp.lines as Array<Record<string, unknown>>) {
      if (!l || typeof l !== "object") continue;
      rows.push(["ln", s(l.sku), n(l.qty), n(l.ext)].join("|"));
    }
  }
  rows.sort();
  return fnv1a(rows.join("\n"));
}

/** What an approval is granted against, right now. */
export function approvalFingerprint(q: FingerprintInput): ApprovalSnapshot {
  return { sell: grossQuoteValue(q as never), linesKey: linesKeyOf(q.spec) };
}

/** True when the quote still matches its approval snapshot. A review with no
 *  snapshot (legacy, or decided before #284) always matches. */
export function approvalSnapshotMatches(q: FingerprintInput & { review?: ReviewWithSnapshot | null }): boolean {
  const a = q.review?.approvedAgainst;
  if (!a) return true;
  const cur = approvalFingerprint(q);
  return Math.abs(cur.sell - a.sell) < 0.005 && cur.linesKey === a.linesKey;
}
