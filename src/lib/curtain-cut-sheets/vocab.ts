/**
 * Curtain cut sheets (#292) — the finish + mount vocabulary (spec §1.1).
 * Pure and client-safe: the Estimator curtain modal, the Grid drop dialog,
 * the cut-sheet collector and the harness all read it.
 */
import type { GridCurtainType } from "@/lib/design/grid-bom";

export type CurtainTopFinish = "grommets" | "pipe-pocket" | "hook-loop";
export type CurtainBottomFinish = "chain" | "pipe-pocket" | "hem";
export type CurtainMountTypeId = "track-batten" | "track-ceiling" | "track-structure" | "tie-batten" | "wall-hookloop";
/** `track-other` is a fallback detail for an unknown track mounting — never offered in a picker. */
export type CurtainMountKey = CurtainMountTypeId | "track-other";

export const TOP_FINISHES: readonly CurtainTopFinish[] = ["grommets", "pipe-pocket", "hook-loop"];
export const BOTTOM_FINISHES: readonly CurtainBottomFinish[] = ["chain", "pipe-pocket", "hem"];

export const TOP_FINISH_LABELS: Record<CurtainTopFinish, string> = {
  grommets: "Webbing with grommets",
  "pipe-pocket": "Pipe pocket",
  "hook-loop": "Hook-and-loop",
};
/** The prototype's Chain / Pocket / None, under clearer names. */
export const BOTTOM_FINISH_LABELS: Record<CurtainBottomFinish, string> = {
  chain: "Chain pocket (jack chain)",
  "pipe-pocket": "Pipe pocket",
  hem: "Plain hem",
};
/** Segmented-button captions (curtain modal, Grid drop dialog). */
export const TOP_FINISH_SHORT: Record<CurtainTopFinish, string> = { grommets: "Grommets", "pipe-pocket": "Pipe pocket", "hook-loop": "Hook & loop" };
export const BOTTOM_FINISH_SHORT: Record<CurtainBottomFinish, string> = { chain: "Chain pocket", "pipe-pocket": "Pipe pocket", hem: "Hem" };

/** Starter mount types — awaiting Jeff's confirmation (spec Open questions 1). */
export const CURTAIN_MOUNT_TYPES: ReadonlyArray<{ id: CurtainMountTypeId; label: string; track: boolean }> = [
  { id: "track-batten", label: "Track — batten mount", track: true },
  { id: "track-ceiling", label: "Track — ceiling mount", track: true },
  { id: "track-structure", label: "Track — structure mount (drop kit)", track: true },
  { id: "tie-batten", label: "Tie-line to pipe batten", track: false },
  { id: "wall-hookloop", label: "Wall/header — hook-and-loop", track: false },
];

export const MOUNT_KEY_LABELS: Record<CurtainMountKey, string> = {
  "track-batten": "Track — batten mount",
  "track-ceiling": "Track — ceiling mount",
  "track-structure": "Track — structure mount (drop kit)",
  "tie-batten": "Tie-line to pipe batten",
  "wall-hookloop": "Wall/header — hook-and-loop",
  "track-other": "Track — other mounting",
};

export const DEFAULT_MARK_SPACING_IN = 12;
export const DEFAULT_TOP_FINISH: CurtainTopFinish = "grommets";
export const DEFAULT_BOTTOM_FINISH: CurtainBottomFinish = "chain";
/** The mount a curtain with no track and no pick is assumed to use (flagged as assumed). */
export const ASSUMED_MOUNT: CurtainMountTypeId = "tie-batten";

/**
 * A track line's `track.mounting` → the mount detail. The parameter is a
 * plain string with a default branch on purpose: when another session adds
 * "structure" (or anything else) to TrackMounting, nothing here changes.
 */
export function mountTypeForTrackMounting(m: string): CurtainMountKey {
  switch (m) {
    case "batten":
      return "track-batten";
    case "ceiling":
      return "track-ceiling";
    case "structure":
      return "track-structure";
    default:
      return "track-other";
  }
}

export function isMountTypeId(v: unknown): v is CurtainMountTypeId {
  return typeof v === "string" && CURTAIN_MOUNT_TYPES.some((t) => t.id === v);
}
export function isTopFinish(v: unknown): v is CurtainTopFinish {
  return typeof v === "string" && (TOP_FINISHES as readonly string[]).includes(v);
}
export function isBottomFinish(v: unknown): v is CurtainBottomFinish {
  return typeof v === "string" && (BOTTOM_FINISHES as readonly string[]).includes(v);
}

/** Untrusted finishes/mount (a Grid drop, a saved line) → only the valid ones. Bad or absent values are dropped, never refused. */
export function cleanCurtainFinishes(raw: unknown): { topFinish?: CurtainTopFinish; bottomFinish?: CurtainBottomFinish; mountType?: CurtainMountTypeId } {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: { topFinish?: CurtainTopFinish; bottomFinish?: CurtainBottomFinish; mountType?: CurtainMountTypeId } = {};
  if (isTopFinish(r.topFinish)) out.topFinish = r.topFinish;
  if (isBottomFinish(r.bottomFinish)) out.bottomFinish = r.bottomFinish;
  if (isMountTypeId(r.mountType)) out.mountType = r.mountType;
  return out;
}

/** Defaults by Grid curtain type, for placed curtains and blank fields (spec §1.4; Open question 3). */
export const GRID_CURTAIN_DEFAULTS: Record<GridCurtainType, { top: CurtainTopFinish; bottom: CurtainBottomFinish; mount: CurtainMountTypeId }> = {
  Draw: { top: "grommets", bottom: "chain", mount: "track-batten" },
  Border: { top: "grommets", bottom: "hem", mount: "tie-batten" },
  Leg: { top: "grommets", bottom: "chain", mount: "tie-batten" },
  Full: { top: "grommets", bottom: "chain", mount: "tie-batten" },
};
