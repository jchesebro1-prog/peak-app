/**
 * Estimator handoff — the two customer-view routes the Estimator opens in a new tab, parsed (pure — no React,
 * so the Node checks import it): `/estimator/cut-sheets?id=…&style=…` and `/estimator-preview/<id>?tab=…&view=…`.
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
