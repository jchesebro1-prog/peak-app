/**
 * Lead → visit → survey → estimate thread (#34) — PURE helpers, zero imports.
 * The design-spec answer (specs/2026-07-25-remaining-items-decisions-design.md
 * §3 #34): SiteVisit gains a lifecycle + leadId, requesting a visit auto-
 * creates the linked Survey, and lead→customer convert is gated on that
 * survey. This module is dependency-free so the "use client" drawer, the
 * server stores and the spec harness all consume the same logic.
 *
 * Lifecycle semantics:
 *   requested — born from a lead's visit request with assign "Open — anyone"
 *   open      — an existing visit explicitly released back to the pool
 *   claimed   — assignedTo set, no schedule yet (request-with-assignee lands here)
 *   scheduled — has startAt/endAt (the inbox create path lands here)
 *   done      — derived/stored past
 */

export const VISIT_STAGES = ["requested", "open", "claimed", "scheduled", "done"] as const;
export type VisitStage = (typeof VISIT_STAGES)[number];

export interface VisitStageMeta {
  label: string;
  ink: string;
  soft: string;
  bd: string;
}

/** Chip colors follow the survey STAGE_META families (amber/blue/purple/green)
 *  so the two thread chips read as one system in the drawer. */
export const VISIT_STAGE_META: Record<VisitStage, VisitStageMeta> = {
  requested: { label: "Requested", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  open: { label: "Open — unclaimed", ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4" },
  claimed: { label: "Claimed", ink: "#7b3f8a", soft: "#f3eaf5", bd: "#e6d3ea" },
  scheduled: { label: "Scheduled", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  done: { label: "Done", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
};

/**
 * Normalize-on-read for site-visit docs. Stored requested/open/claimed/done
 * pass through; stored "scheduled" whose (endAt ?? startAt) is past reads as
 * "done"; legacy stage-less docs (every pre-#34 record — they always carry
 * times) derive done/scheduled from the same rule.
 */
export function deriveVisitStage(
  v: { stage?: string | null; startAt: number | null; endAt: number | null },
  nowMs: number
): VisitStage {
  const s = v.stage;
  if (s === "requested" || s === "open" || s === "claimed" || s === "done") return s;
  const t = v.endAt ?? v.startAt;
  if (t != null && t < nowMs) return "done";
  return "scheduled";
}

/** Assign-or-open: a request with an assignee is born claimed; an open one
 *  is born requested (anyone can claim it from the pool). */
export function requestStageFor(assignee: string): "claimed" | "requested" {
  return assignee.trim() ? "claimed" : "requested";
}

export type ConvertGate =
  | { ok: true }
  | { ok: false; reason: "survey-missing" | "survey-open" };

/**
 * The convert gate (#34, decision D): lead → customer refuses until the
 * linked survey is COMPLETED, unless explicitly skipped. Tolerance note:
 * survey stage pills allow jumping backwards; this reads the CURRENT stage
 * at convert time — that's fine, the gate is a snapshot check.
 */
export function canConvertLead(
  survey: { stage: string } | null,
  skip: boolean
): ConvertGate {
  if (skip) return { ok: true };
  if (!survey) return { ok: false, reason: "survey-missing" };
  if (survey.stage !== "completed") return { ok: false, reason: "survey-open" };
  return { ok: true };
}
