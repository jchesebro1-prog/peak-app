/**
 * #301 slice C (R8) — the signed Grid drawing-set print's pure names: the
 * set id `<projectId>~<optionId>` (the print token's id), per-asset token
 * ids, the print URL, the wait selector and the per-step render cap.
 * Client-safe; imports nothing.
 */

const PART = /^[A-Za-z0-9_-]{1,80}$/;

export const GRID_SET_WAIT_FOR = '[data-plan-figure]:not([data-ready="1"]):not([data-error="1"])';
/** A plan figure that settled by failing (PdfCanvas error) — fails the render instead of printing a blank plan. */
export const GRID_SET_FAIL_IF = '[data-plan-figure][data-error="1"]';
/** Per render step (adaptation 16): launch 20 + goto 25 + fonts 10 + waitFor 25 + pdf 25 = 105 s < 120 s. */
export const GRID_SET_STEP_MS = 25_000;
/** The whole render's deadline — queue wait included — so a queued render can't outrun the step budget: 20 launch + 2×25 + 10 fonts + 25 wait = 105 s. */
export const GRID_SET_DEADLINE_MS = 105_000;

export const GRID_SET_COPY = {
  noGrid: "No Grid design is linked to this quote.",
  renderFailed: "The drawing set couldn’t be rendered — try again.",
  figureFailed: "One of the plan sheets couldn’t be drawn — try again.",
  storeFailed: "The drawing set was drawn but couldn’t be saved — try again.",
  failed: "The drawing set couldn’t be generated — try again.",
  tooBig: "The drawing set is over 25 MB — upload a smaller set instead.",
  noSecret: "Printing isn’t set up on this server (AUTH_SECRET is missing).",
  generating: "Rendering the drawing set — this can take a minute…",
  generated: "Drawing set added from the Grid.",
} as const;

export function gridSetId(projectId: string, optionId: string): string {
  return `${projectId}~${optionId}`;
}

export function parseGridSetId(id: string): { projectId: string; optionId: string } | null {
  const parts = typeof id === "string" ? id.split("~") : [];
  if (parts.length !== 2 || !PART.test(parts[0]) || !PART.test(parts[1])) return null;
  return { projectId: parts[0], optionId: parts[1] };
}

/** The id an asset's own print token signs — the print page signs only assets it drew (adaptation 6). */
export function gridSetAssetTokenId(setId: string, kind: "sheet" | "doc", assetId: string): string {
  return `${setId}|${kind}|${assetId}`;
}

export function gridSetPrintUrl(origin: string, setId: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/print/grid-set/${encodeURIComponent(setId)}?t=${encodeURIComponent(token)}`;
}

export function gridSetFileName(projectName: string): string {
  const base = (projectName || "Grid design").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+-\s*|\s*-\s+/g, " - ").replace(/\s+/g, " ").trim().slice(0, 120) || "Grid design";
  return `${base} — drawing set.pdf`;
}
