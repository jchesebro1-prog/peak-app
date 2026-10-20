/**
 * Estimator handoff — the in-page overlay for the two customer-view routes the Estimator opens in a new tab:
 *
 *   /estimator/cut-sheets?id=<quoteId>&style=submittal|client   (the ⋯ menu's Cut sheets — window.open — and
 *                                                                 the Client package tab's "Client cut sheets" link)
 *   /estimator-preview/<quoteId>?tab=package|bom|cutsheets       (the BOM quote tab's "Open saved preview ↗")
 *
 * Under file:// those paths are dead, so `installPreviewRouting` catches them — a click on such a link, or
 * window.open of one — and opens this overlay with the same live view (ui/live-views.tsx) instead. The shell
 * (ui/shell.tsx) leaves them to the overlay: ui/link-routing.ts skips any href this module recognizes. The ⧉ pop-out (popout/open.ts opens a named
 * `peak-pop:*` window) gets an inert window and a short "not in the prototype" notice — the prototype is one
 * window. Plan: PR 2 Task 5.
 */
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from "react";
import type { CutSheetStyle } from "@/lib/curtain-cut-sheets/model";
import { LiveBom, LiveCutSheets, LivePackagePage } from "./live-views";
import { NOTICE_EVT } from "../shims/next-navigation";
import { POPOUT_NOTICE, previewTargetOf, windowOpenRoute, type PreviewTarget } from "./preview-routes";

export { POPOUT_NOTICE, previewTargetOf, type PreviewTarget };

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

/**
 * A stand-in for the window `window.open("", "_blank")` returns (openCutSheets, use-estimator-state.ts:
 * opened inside the click, navigated once the save lands). Navigating it — `location.href = url`,
 * `location.assign(url)` or `location.replace(url)` — opens the overlay for a preview route, or a real
 * window for any other URL. `close()` before that navigates nowhere.
 */
function deferredWindow(realOpen: typeof window.open): Window {
  const go = (url: string | URL) => {
    if (stub.closed) return;
    const s = String(url);
    const t = previewTargetOf(s);
    if (t) openPreview(t);
    else realOpen.call(window, s, "_blank");
  };
  const stub = {
    closed: false,
    close() {
      stub.closed = true;
    },
    focus() {},
    location: {
      set href(url: string) {
        go(url);
      },
      get href() {
        return "about:blank";
      },
      assign: go,
      replace: go,
    },
  };
  return stub as unknown as Window;
}

/** An inert pop-out window: about:blank that never navigates, so openPopout (popout/open.ts) neither reloads nor reports it blocked. */
function inertPopout(): Window {
  const noop = () => {};
  return { closed: false, close: noop, focus: noop, location: { href: "about:blank", assign: noop, replace: noop } } as unknown as Window;
}

let notice: { text: string; at: number } | null = null;
const noticeListeners = new Set<() => void>();

/** Shows a small, non-blocking notice (bottom of the window) for a few seconds. */
export function showNotice(text: string): void {
  notice = { text, at: Date.now() };
  noticeListeners.forEach((fn) => fn());
}

const subscribeNotice = (fn: () => void) => {
  noticeListeners.add(fn);
  return () => {
    noticeListeners.delete(fn);
  };
};

let installed = false;

/**
 * Routes the two preview URLs to the overlay: link clicks (capture phase) and window.open. Idempotent.
 * A Narrative / BOM toggle inside a live package page is left to the page itself (it switches in place).
 */
export function installPreviewRouting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // The router shim's "Not part of the prototype" (and any other shell notice) arrives as an event.
  window.addEventListener(NOTICE_EVT, (e) => showNotice(String((e as CustomEvent<string>).detail ?? "")));
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const a = (e.target as Element | null)?.closest?.("a");
      const href = a?.getAttribute("href");
      if (!href) return;
      const t = previewTargetOf(href);
      if (!t) return;
      // LivePackagePage's own toggle (its onClickCapture runs after this document-level listener).
      if (t.kind === "package" && a?.closest('[data-handoff-live="package"]')) return;
      e.preventDefault();
      openPreview(t);
    },
    true,
  );
  const realOpen = window.open;
  window.open = function (url?: string | URL, target?: string, features?: string): Window | null {
    const route = windowOpenRoute(url === undefined ? "" : String(url), target, features);
    if (route.kind === "popout") {
      showNotice(POPOUT_NOTICE);
      return inertPopout();
    }
    if (route.kind === "deferred") return deferredWindow(realOpen);
    if (route.kind === "preview") {
      openPreview(route.target);
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

const NOTICE_MS = 4000;
const NOTICE: CSSProperties = { position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 1100, padding: "8px 14px", borderRadius: 8, background: "#2b2e35", color: "#fff", fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,.25)", pointerEvents: "none" };

/** The last notice, for a few seconds — non-blocking (no focus, no pointer events). */
function Notice() {
  const n = useSyncExternalStore(subscribeNotice, () => notice, () => null);
  const [hiddenAt, setHiddenAt] = useState<number | null>(null);
  useEffect(() => {
    if (!n) return;
    const t = setTimeout(() => setHiddenAt(n.at), NOTICE_MS);
    return () => clearTimeout(t);
  }, [n]);
  if (!n || hiddenAt === n.at) return null;
  return (
    <div role="status" style={NOTICE} data-handoff-notice="">
      {n.text}
    </div>
  );
}

/** The overlay and the notice — mounted once by main.tsx. */
export function PreviewOverlay() {
  return (
    <>
      <Overlay />
      <Notice />
    </>
  );
}

/** The overlay itself. Esc or ✕ closes it. */
function Overlay() {
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
