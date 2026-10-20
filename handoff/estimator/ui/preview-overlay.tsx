/**
 * Estimator handoff — the in-page overlay for the two customer-view routes the Estimator opens in a new tab:
 *
 *   /estimator/cut-sheets?id=<quoteId>&style=submittal|client   (the ⋯ menu's Cut sheets — window.open — and
 *                                                                 the Client package tab's "Client cut sheets" link)
 *   /estimator-preview/<quoteId>?tab=package|bom|cutsheets       (the BOM quote tab's "Open saved preview ↗")
 *
 * Under file:// those paths are dead, so `installPreviewRouting` catches them — a click on such a link, or
 * window.open of one — and opens this overlay with the same live view (ui/live-views.tsx) instead. Task 7's
 * shell can route them as pages; until then the overlay stands in. Plan: PR 2 Task 5.
 */
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { CutSheetStyle } from "@/lib/curtain-cut-sheets/model";
import { LiveBom, LiveCutSheets, LivePackagePage } from "./live-views";
import { previewTargetOf, type PreviewTarget } from "./preview-routes";

export { previewTargetOf, type PreviewTarget };

let current: PreviewTarget | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function openPreview(t: PreviewTarget): void {
  current = t;
  emit();
}

export function closePreview(): void {
  current = null;
  emit();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** A stand-in for the window `window.open("", "_blank")` returns: navigating it opens the overlay (or, for any other URL, a real window). */
function deferredWindow(realOpen: typeof window.open): Window {
  const stub = {
    closed: false,
    close() {
      stub.closed = true;
    },
    focus() {},
    location: {
      set href(url: string) {
        if (stub.closed) return;
        const t = previewTargetOf(url);
        if (t) openPreview(t);
        else realOpen.call(window, url, "_blank");
      },
      get href() {
        return "about:blank";
      },
    },
  };
  return stub as unknown as Window;
}

let installed = false;

/** Routes the two preview URLs to the overlay: link clicks (capture phase) and window.open. Idempotent. */
export function installPreviewRouting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.("a");
      const href = a?.getAttribute("href");
      if (!href) return;
      const t = previewTargetOf(href);
      if (!t) return;
      e.preventDefault();
      openPreview(t);
    },
    true,
  );
  const realOpen = window.open;
  window.open = function (url?: string | URL, target?: string, features?: string): Window | null {
    const s = url === undefined ? "" : String(url);
    if (s === "" || s === "about:blank") return deferredWindow(realOpen);
    const t = previewTargetOf(s);
    if (t) {
      openPreview(t);
      return null;
    }
    return realOpen.call(window, url, target, features);
  } as typeof window.open;
}

const SHADE: CSSProperties = { position: "fixed", inset: 0, zIndex: 1000, background: "rgba(22,24,29,.45)", display: "flex", flexDirection: "column" };
const SHEET: CSSProperties = { margin: "28px auto", width: "min(1180px, calc(100% - 32px))", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "#eef0f3", borderRadius: 12, overflow: "hidden", boxShadow: "0 10px 40px rgba(0,0,0,.3)" };
const BAR: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: "#fff", borderBottom: "1px solid #e4e7ec", fontFamily: "var(--font-ui)", fontSize: 13 };
const LINK_BTN = (on: boolean): CSSProperties => ({ border: "none", background: "transparent", color: "var(--accent)", fontWeight: on ? 700 : 400, cursor: "pointer", fontSize: 12.5, padding: 0 });

const TITLE: Record<PreviewTarget["kind"], string> = { cutsheets: "Cut sheets", package: "Package page", bom: "BOM" };

/** The overlay itself — mounted once by main.tsx. Esc or ✕ closes it. */
export function PreviewOverlay() {
  const t = useSyncExternalStore(subscribe, () => current, () => null);
  const [style, setStyle] = useState<CutSheetStyle | null>(null);
  useEffect(() => {
    if (!t) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePreview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [t]);
  if (!t) return null;
  const csStyle = t.kind === "cutsheets" ? (style ?? t.style) : null;
  return (
    <div style={SHADE} role="dialog" aria-modal="true" aria-label={TITLE[t.kind]} data-handoff-overlay={t.kind}>
      <div style={SHEET}>
        <div style={BAR}>
          <strong>{TITLE[t.kind]}</strong>
          {csStyle && (
            <span style={{ display: "inline-flex", gap: 10 }}>
              <button type="button" style={LINK_BTN(csStyle === "submittal")} onClick={() => setStyle("submittal")}>
                Submittal
              </button>
              <button type="button" style={LINK_BTN(csStyle === "client")} onClick={() => setStyle("client")}>
                Client
              </button>
            </span>
          )}
          <span style={{ marginLeft: "auto", color: "#8c919c", fontSize: 12 }}>The saved estimate, as the client gets it</span>
          <button
            type="button"
            aria-label="Close"
            onClick={() => {
              setStyle(null);
              closePreview();
            }}
            style={{ border: "none", background: "transparent", fontSize: 16, cursor: "pointer", color: "#5b616e" }}
          >
            ✕
          </button>
        </div>
        <div className="est-scroll" style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {t.kind === "cutsheets" ? (
            <LiveCutSheets key={`${t.quoteId}:${csStyle}`} quoteId={t.quoteId} style={csStyle ?? "submittal"} />
          ) : t.kind === "bom" ? (
            <LiveBom quoteId={t.quoteId} />
          ) : (
            <LivePackagePage key={`${t.quoteId}:${t.view}`} quoteId={t.quoteId} initialView={t.view} />
          )}
        </div>
      </div>
    </div>
  );
}
