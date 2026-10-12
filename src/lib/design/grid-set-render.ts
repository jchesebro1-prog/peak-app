/**
 * Grid notes #7 — the ONE render of a Grid design's title-blocked drawing set
 * (T-001 cover, plan sheets with their devices, riser, schedules) through the
 * signed /print/grid-set route to one PDF. SERVER ONLY (Chrome + the print
 * token). Used by "Generate from Grid" (estimate-output/package-files-server.ts)
 * and by both client packages (client-package-server.ts); each caller chooses
 * its own time budget and words a failure for its own reader.
 */
import { PdfRenderUnavailable, PrintFigureFailed, renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { signPrintToken } from "@/lib/quote-pdf/token";
import { GRID_SET_COPY, GRID_SET_FAIL_IF, GRID_SET_WAIT_FOR, gridSetId, gridSetPrintUrl } from "./grid-set-print";

export type GridSetRenderFn = (url: string, opts: { timeoutMs?: number; waitFor?: string; failIf?: string; signal?: AbortSignal }) => Promise<Buffer>;

/** Why no PDF came back: no AUTH_SECRET, no Chrome, a plan figure that failed to draw, the caller's signal fired, anything else. */
export type GridSetRenderCause = "no-secret" | "unavailable" | "figure" | "late" | "failed";

export type GridSetRendered = { ok: true; pdf: Buffer } | { ok: false; cause: GridSetRenderCause; error: string };

export async function renderGridSetPdf(input: {
  projectId: string;
  optionId: string;
  /** The request's own print origin (printOriginFor). */
  origin: string;
  secret: string;
  /** Read right before signing, so the token is minted immediately before its one render. */
  now: () => number;
  render?: GridSetRenderFn;
  /** Chrome's per-step cap; undefined = the renderer's own default (dev compiles /print on first hit). */
  timeoutMs?: number;
  /** Bounds the whole render, queue wait included. */
  signal: AbortSignal;
}): Promise<GridSetRendered> {
  if (!input.secret) return { ok: false, cause: "no-secret", error: GRID_SET_COPY.noSecret };
  const setId = gridSetId(input.projectId, input.optionId);
  const render = input.render ?? renderPrintRouteToPdf;
  try {
    const t = signPrintToken(input.secret, "grid-set", setId, input.now());
    const pdf = await render(gridSetPrintUrl(input.origin, setId, t), {
      timeoutMs: input.timeoutMs,
      waitFor: GRID_SET_WAIT_FOR,
      failIf: GRID_SET_FAIL_IF,
      signal: input.signal,
    });
    return { ok: true, pdf };
  } catch (e) {
    if (e instanceof PdfRenderUnavailable) return { ok: false, cause: "unavailable", error: e.message };
    console.error("[package] grid drawing set render failed", e);
    if (e instanceof PrintFigureFailed) return { ok: false, cause: "figure", error: GRID_SET_COPY.figureFailed };
    return { ok: false, cause: input.signal.aborted ? "late" : "failed", error: GRID_SET_COPY.renderFailed };
  }
}
