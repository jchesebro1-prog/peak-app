/**
 * Estimator handoff — the two customer-view routes the Estimator opens in a new tab, parsed, plus the routing
 * of window.open and the UI copy verify.ts asserts (pure — no React, so the Node checks import it):
 * `/estimator/cut-sheets?id=…&style=…` and `/estimator-preview/<id>?tab=…&view=…`.
 * ui/preview-overlay.tsx opens its overlay for whatever this recognizes. Plan: PR 2 Task 5.
 */
import type { CutSheetStyle } from "@/lib/curtain-cut-sheets/model";

export type PreviewTarget =
  | { kind: "cutsheets"; quoteId: string; style: CutSheetStyle }
  | { kind: "package"; quoteId: string; view: "narrative" | "bom" }
  | { kind: "bom"; quoteId: string };

/** An app URL → the overlay target it stands for, or null when it isn't one of the two routes. Pure. */
export function previewTargetOf(url: string): PreviewTarget | null {
  if (typeof url !== "string") return null;
  let u: URL;
  try {
    u = new URL(url, "http://handoff.invalid");
  } catch {
    return null;
  }
  // Only root-relative app paths (or the same, resolved against file://) — never another site.
  if (u.origin !== "http://handoff.invalid" && u.protocol !== "file:") return null;
  const path = u.pathname;
  if (path === "/estimator/cut-sheets" || path.endsWith("/estimator/cut-sheets")) {
    const id = u.searchParams.get("id") || "";
    return id ? { kind: "cutsheets", quoteId: id, style: u.searchParams.get("style") === "client" ? "client" : "submittal" } : null;
  }
  const m = /\/estimator-preview\/([^/]+)$/.exec(path);
  if (m) {
    let id = m[1];
    try {
      id = decodeURIComponent(id);
    } catch {
      /* keep the raw id */
    }
    const tab = u.searchParams.get("tab");
    if (tab === "bom") return { kind: "bom", quoteId: id };
    if (tab === "cutsheets") return { kind: "cutsheets", quoteId: id, style: "client" };
    return { kind: "package", quoteId: id, view: u.searchParams.get("view") === "bom" ? "bom" : "narrative" };
  }
  return null;
}

/** Every printed page's footer (ui/review-overrides.tsx's print root) — a printed prototype PDF says what it is. */
export const PRINT_FOOTER_TEXT = "Confidential — Peak Systems Group · prototype";

/** popout/open.ts names a pop-out window `peak-pop:<kind>:<id>`; the prototype is one window, so it says so. */
export const POPOUT_NOTICE = "Pop-out windows aren't available in the prototype";

export type WindowOpenRoute = { kind: "popout" } | { kind: "deferred" } | { kind: "preview"; target: PreviewTarget } | { kind: "real" };

/**
 * What the prototype's window.open (ui/preview-overlay.tsx) does with a call. Pure.
 *   popout    a `peak-pop:*` target — the ⧉ pop-out (popout/open.ts `window.open("", name, features)`):
 *             an inert window plus the "not in the prototype" notice;
 *   deferred  exactly openCutSheets' shape (use-estimator-state.ts: `window.open("", "_blank")` — empty URL,
 *             target _blank, no features): the stand-in window that opens the overlay once navigated;
 *   preview   a preview-route URL (any target): the overlay;
 *   real      anything else, including other empty-URL opens: the browser's own window.open.
 */
export function windowOpenRoute(url: string, target?: string, features?: string): WindowOpenRoute {
  if (typeof target === "string" && target.startsWith("peak-pop:")) return { kind: "popout" };
  const blank = url === "" || url === "about:blank";
  if (blank) return target === "_blank" && features === undefined ? { kind: "deferred" } : { kind: "real" };
  const t = previewTargetOf(url);
  return t ? { kind: "preview", target: t } : { kind: "real" };
}
