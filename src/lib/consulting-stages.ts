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

/* ---------- spawn model (spec §1) ---------- */

export type EngagementSyncAction =
  | { kind: "create"; stage: "proposal_sent" | "awarded" }
  | { kind: "advance"; stage: "awarded" }
  | { kind: "close"; stage: "closed" }
  | { kind: "reopen"; stage: "proposal_sent" }
  | null;

/**
 * What the quotes→engagements sweep should do for ONE consulting quote
 * (spec §1 spawn model), given the quote's status and the engagement's
 * current stage (null = no engagement yet):
 *   sent  → the engagement exists, at proposal_sent
 *   won   → the engagement exists; a proposal_sent record advances to
 *           awarded (a stage a human moved further is never touched)
 *   lost  → an engagement still at proposal_sent closes ("Proposal lost")
 *   sent (again), engagement closed → REOPEN to proposal_sent: a re-sent
 *           lost proposal picks the lifecycle back up rather than staying
 *           dead (the deliberate reopen rule)
 * Pure and total: every other combination is a no-op, so the sweep is
 * idempotent by construction — each branch converges on a fixed point.
 */
export function engagementSyncAction(
  quoteStatus: string,
  current: EngagementStage | null
): EngagementSyncAction {
  if (current === null) {
    if (quoteStatus === "sent") return { kind: "create", stage: "proposal_sent" };
    if (quoteStatus === "won") return { kind: "create", stage: "awarded" };
    return null;
  }
  if (quoteStatus === "won" && current === "proposal_sent") {
    return { kind: "advance", stage: "awarded" };
  }
  if (quoteStatus === "lost" && current === "proposal_sent") {
    return { kind: "close", stage: "closed" };
  }
  if (quoteStatus === "sent" && current === "closed") {
    // Deliberate reopen: a re-sent proposal that was previously lost picks
    // the lifecycle back up at proposal_sent instead of staying closed.
    return { kind: "reopen", stage: "proposal_sent" };
  }
  return null;
}

/* ---------- structured proposal content (#35) ---------- */

/** One scope-of-work line item — title + description + fee (spec §1:
 *  "the proposal total assembles from scope fees"). id: uid("sc-"),
 *  minted server-side in quote/actions.ts. */
export type ConsultingScope = {
  id: string;
  title: string;
  description: string;
  fee: number;
};

export function scopesTotal(
  scopes?: readonly ConsultingScope[] | null
): number {
  return (scopes || []).reduce((a, s) => a + (s.fee || 0), 0);
}

/**
 * What an engagement's milestones seed from at spawn (pure half of
 * fromQuote): structured scopes when the proposal has them (name = title,
 * amount = fee), else the legacy milestone fee schedule, else nothing —
 * exactly the pre-rebuild behavior for pre-rebuild quotes. targetDate is
 * always 0 (unscheduled), so the Reports billing forecast — which filters
 * targetDate > 0 — is unaffected until someone dates the milestone.
 */
export function milestoneSeeds(pay: {
  scopes?: readonly ConsultingScope[] | null;
  feeMode?: string;
  fees?: ReadonlyArray<{ name?: string; amount?: number }> | null;
}): Array<{ name: string; amount: number }> {
  if (pay.scopes?.length) {
    return pay.scopes.map((s) => ({
      name: s.title || "Scope",
      amount: s.fee || 0,
    }));
  }
  if (pay.feeMode === "milestones") {
    return (pay.fees || []).map((f) => ({
      name: f.name || "Milestone",
      amount: f.amount || 0,
    }));
  }
  return [];
}
