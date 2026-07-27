/**
 * Consulting lifecycle stages (spec §1 2026-07-25, D123) — the six-stage
 * ladder that replaced the 4-status vocabulary when Consulting was redefined
 * as a SPECIFIER role: Peak is paid to design and write the spec, the job
 * goes out to bid, Peak may bid its own spec, and the engagement ends when
 * construction admin ends.
 *
 * ZERO imports of any kind (the tabs.ts / consulting-review.ts lesson): this
 * module is client-bundled ("use client" views render the pills and the
 * stage <select>), server-trusted (the store normalizes and the actions
 * allowlist through it), and spec-tested (the harness imports it with no DB).
 *
 * Lazy migration: stored docs may still carry the old literals — every store
 * read path calls normalizeEngagementStatus, and patchEngagement upgrades
 * the stored value on the doc's next write. Nothing is bulk-rewritten.
 */

export type EngagementStage =
  | "proposal_sent"
  | "awarded"
  | "design"
  | "out_to_bid"
  | "construction_admin"
  | "closed";

/** tone is a MONDAY_TONE key — feeds the house StatusPill directly. */
export type EngagementStageDef = {
  key: EngagementStage;
  label: string;
  tone: string;
};

export const ENGAGEMENT_STAGES: readonly EngagementStageDef[] = [
  { key: "proposal_sent", label: "Proposal sent", tone: "orange" },
  { key: "awarded", label: "Awarded", tone: "purple" },
  { key: "design", label: "Design", tone: "blue" },
  { key: "out_to_bid", label: "Out to bid", tone: "darkblue" },
  { key: "construction_admin", label: "Construction admin", tone: "green" },
  { key: "closed", label: "Closed", tone: "gray" },
] as const;

export const ENGAGEMENT_STAGE_KEYS: readonly EngagementStage[] =
  ENGAGEMENT_STAGES.map((s) => s.key);

/** Every stage before Closed — the D113 item-11 rule's carrier. */
export const OPEN_ENGAGEMENT_STAGES: readonly EngagementStage[] =
  ENGAGEMENT_STAGE_KEYS.filter((k) => k !== "closed");

/** Keeps the pre-rebuild export name — consumers (design/page.tsx, venues
 *  humanizer fallbacks) import this exact identifier via stores/engagements. */
export const ENGAGEMENT_STATUS_LABEL: Record<EngagementStage, string> =
  Object.fromEntries(ENGAGEMENT_STAGES.map((s) => [s.key, s.label])) as Record<
    EngagementStage,
    string
  >;

export const ENGAGEMENT_STAGE_TONE: Record<EngagementStage, string> =
  Object.fromEntries(ENGAGEMENT_STAGES.map((s) => [s.key, s.tone])) as Record<
    EngagementStage,
    string
  >;

/** The old 4-status vocabulary, mapped onto the new ladder (spec §1:
 *  "Existing engagements map onto the new ladder"). COMPLETE by construction
 *  — the spec harness pins exactly these four keys. */
export const LEGACY_STATUS_MAP: Record<string, EngagementStage> = {
  active: "design",
  delivered: "out_to_bid",
  bid_supported: "construction_admin",
  oversight_complete: "closed",
};

/** New keys pass through; legacy keys map; anything else lands on "design"
 *  (the safe middle — visibly open, visibly mid-lifecycle). */
export function normalizeEngagementStatus(raw: string): EngagementStage {
  if ((ENGAGEMENT_STAGE_KEYS as readonly string[]).includes(raw)) {
    return raw as EngagementStage;
  }
  return LEGACY_STATUS_MAP[raw] ?? "design";
}

/** Position on the ladder (normalizes first) — ordering, never gating:
 *  stage transitions stay free-form via the header <select> (house style). */
export function stageIndex(k: string): number {
  return ENGAGEMENT_STAGE_KEYS.indexOf(normalizeEngagementStatus(k));
}

/**
 * THE open-engagement rule (D113 item 11 carried into the six-stage ladder,
 * spec §1): every stage before Closed counts as live work. Accepts raw
 * status strings so legacy docs and history rows work unchanged. The single
 * definition — consulting-review.ts re-exports it, venue-match's duplicate
 * list is spec-pinned in agreement, nothing else may restate the rule.
 */
export function isOpenEngagement(e: { status: string }): boolean {
  return normalizeEngagementStatus(e.status) !== "closed";
}
