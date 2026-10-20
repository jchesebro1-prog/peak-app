/**
 * Estimator handoff — the app shell: the permanent confidential banner, the top nav (Estimates · Catalog · Assemblies ·
 * Estimating Rules), the acting-user switcher, Reset to production snapshot, and the routed screen (Task 8: Catalog is a real screen). Routes are hash
 * routes (runtime/routes.ts), so file:// and an Artifact behave the same; the Estimator keeps its `?id=` / `?step=` in
 * the search. The routed screen is remounted when the route names another estimate, another user is picked (the
 * Estimator's props depend on the viewer) or the data is reset — but NOT when a first save gives a new estimate its id
 * (that is the same screen, announced by the app, not a navigation). Plan: PR 2 Task 7.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from "react";
import EstimatorClient from "@/app/(app)/estimator/estimator-client";
import type { EstimatorProps } from "@/app/(app)/estimator/types";
import { currentRoute, normalizeLocation, subscribeLocation } from "../shims/next-navigation";
import { onRefresh } from "../runtime/router";
import { NAV_ROUTES, NEW_ESTIMATE_ID, NOT_IN_PROTOTYPE_COPY, routeHash, sameRoute, type Route } from "../runtime/routes";
import { users } from "../runtime/ports";
import { buildEstimatorProps } from "../runtime/props/estimator";
import { RESET_COPY, runReset } from "../runtime/reset";
import type { HandoffStore } from "../runtime/store";
import { CatalogScreen } from "./catalog";
import { EstimatesList } from "./estimates-list";
import { PreviewOverlay } from "./preview-overlay";

export const BANNER_TEXT = "Confidential — Peak Systems Group · prototype — nothing is sent or saved to Peak";
export const NOT_PERSISTENT_TEXT = "Changes won't be saved in this window";
export const PLACEHOLDER_COPY = "Coming in this prototype";

/* ------------------------------------------------------------------ route state */

type RouteState = { route: Route; key: number };

/**
 * The current route, plus a key that changes whenever the screen must start over: any route change except a first
 * save's id assignment (`#/estimate/new` → `#/estimate/Q-2041`, announced by the app's own replaceState).
 */
export function useShellRoute(): RouteState {
  const [state, setState] = useState<RouteState>(() => ({ route: currentRoute(), key: 0 }));
  useEffect(
    () =>
      subscribeLocation((change) => {
        // The hash is the route: after a back/forward or a typed hash, put the search in line with it.
        if (change.source === "nav") normalizeLocation();
        const next = currentRoute();
        setState((prev) => {
          if (sameRoute(next, prev.route)) return prev;
          const assigned = change.source === "app" && prev.route.name === "estimate" && prev.route.id === NEW_ESTIMATE_ID && next.name === "estimate";
          return { route: next, key: assigned ? prev.key : prev.key + 1 };
        });
      }),
    [],
  );
  return state;
}

/* ------------------------------------------------------------------ screens */

const FILL: CSSProperties = { position: "absolute", inset: 0 };

function Centered({ children, attr }: { children: ReactNode; attr: string }) {
  return (
    <div {...{ [attr]: "" }} style={{ ...FILL, overflow: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "56px 24px" }}>
      <div style={{ maxWidth: 520, textAlign: "center" }}>{children}</div>
    </div>
  );
}

function Placeholder({ title, onReady }: { title: string; onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return (
    <Centered attr="data-handoff-placeholder">
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>{title}</div>
      <div style={{ fontSize: 14, color: "#8c919c", marginTop: 8 }}>{PLACEHOLDER_COPY}</div>
    </Centered>
  );
}

function BackToEstimates() {
  return (
    <a href="#/estimates" className="pk-btn-outline" style={{ display: "inline-block", marginTop: 16, textDecoration: "none" }}>
      ← Back to the estimates
    </a>
  );
}

function NotPartOfPrototype({ path, onReady }: { path: string; onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return (
    <Centered attr="data-handoff-unknown">
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>{NOT_IN_PROTOTYPE_COPY}</div>
      <div style={{ fontSize: 14, color: "#8c919c", marginTop: 8 }}>
        <code>{path || "/"}</code> isn&apos;t one of the screens in this prototype.
      </div>
      <BackToEstimates />
    </Centered>
  );
}

type EstimateState = { kind: "loading" } | { kind: "missing" } | { kind: "ready"; props: EstimatorProps };

/**
 * One estimate in the real Estimator. Props are built from the store for the id the ROUTE names; a router.refresh()
 * (a save, a status move) re-reads them for whatever the route names then — a new estimate's first save has moved it
 * to its new id by that time. Client state is kept across a refresh, as with a server re-render.
 */
function EstimateScreen({ store, initialId, onReady }: { store: HandoffStore; initialId: string; onReady: () => void }) {
  const [state, setState] = useState<EstimateState>({ kind: "loading" });
  const build = useCallback(async (): Promise<EstimateState> => {
    const r = currentRoute();
    const id = r.name === "estimate" ? r.id : initialId;
    const quoteId = id === NEW_ESTIMATE_ID ? null : id;
    if (quoteId && !(await store.get("quotes", quoteId))) return { kind: "missing" };
    return { kind: "ready", props: await buildEstimatorProps(store, quoteId, new URLSearchParams(window.location.search)) };
  }, [store, initialId]);

  useEffect(() => {
    let alive = true;
    build().then(
      (s) => alive && setState(s),
      (e: unknown) => console.error("[handoff] could not build the Estimator props", e),
    );
    return () => {
      alive = false;
    };
  }, [build]);

  // router.refresh() → re-read the props. Refreshes are serialized and only the latest one lands.
  useEffect(() => {
    let seq = 0;
    return onRefresh(() => {
      const mine = ++seq;
      build().then(
        (next) => {
          if (mine !== seq) return;
          setState(next);
          // verify.ts reads how many refreshes have landed (a save must re-read the props).
          const w = window as unknown as { __peakHandoff?: { propsRefreshes?: number } };
          if (w.__peakHandoff) w.__peakHandoff.propsRefreshes = (w.__peakHandoff.propsRefreshes ?? 0) + 1;
        },
        (e: unknown) => console.error("[handoff] refresh: could not rebuild the Estimator props", e),
      );
    });
  }, [build]);

  useEffect(() => {
    if (state.kind !== "loading") onReady();
  }, [state.kind, onReady]);

  if (state.kind === "loading") return <div style={FILL} data-handoff-loading="" />;
  if (state.kind === "missing")
    return (
      <Centered attr="data-handoff-missing">
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Estimate not found</div>
        <div style={{ fontSize: 14, color: "#8c919c", marginTop: 8 }}>
          There is no estimate <code>{initialId}</code> in this browser&apos;s data.
        </div>
        <BackToEstimates />
      </Centered>
    );
  return (
    <div style={FILL}>
      <EstimatorClient {...state.props} />
    </div>
  );
}

function NewEstimateRefused({ onReady }: { onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return (
    <Centered attr="data-handoff-refused">
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Your role can&apos;t create estimates</div>
      <div style={{ fontSize: 14, color: "#8c919c", marginTop: 8 }}>{users.current().name} holds {(users.current().roles ?? []).join(", ") || "no role"}. Pick an Estimator, Manager or Admin to start one.</div>
      <BackToEstimates />
    </Centered>
  );
}

function Screen({ route, store, onReady }: { route: Route; store: HandoffStore; onReady: () => void }) {
  switch (route.name) {
    case "estimates":
      return <EstimatesList store={store} onReady={onReady} />;
    case "estimate":
      return route.id === NEW_ESTIMATE_ID && !users.can("create") ? <NewEstimateRefused onReady={onReady} /> : <EstimateScreen store={store} initialId={route.id} onReady={onReady} />;
    case "catalog":
      return <CatalogScreen store={store} onReady={onReady} />;
    case "assemblies":
      return <Placeholder title="Assemblies" onReady={onReady} />;
    case "rules":
      return <Placeholder title="Estimating Rules" onReady={onReady} />;
    case "unknown":
      return <NotPartOfPrototype path={`/${route.path}`} onReady={onReady} />;
  }
}

/* ------------------------------------------------------------------ chrome */

const BANNER: CSSProperties = { padding: "4px 12px", font: "600 12px/1.6 var(--font-ui)", letterSpacing: "0.02em", background: "#16181b", color: "#e8e3d8", flexShrink: 0 };
const NAV_FIELD: CSSProperties = { background: "#1b1d22", color: "#e8e3d8", border: "1px solid #2d3038", borderRadius: 7, fontFamily: "var(--font-ui)", fontSize: 12.5, padding: "6px 8px", maxWidth: 300 };

function UserSwitcher({ viewerId, onPick }: { viewerId: string; onPick: (id: string) => void }) {
  const roster = users.all();
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#9aa0ab", fontSize: 11.5, fontWeight: 600 }}>
      Acting as
      <select data-handoff-user="" aria-label="Acting as" value={viewerId} onChange={(e) => onPick(e.target.value)} style={NAV_FIELD}>
        {roster.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name} — {(u.roles ?? []).join(", ") || "no role"}
          </option>
        ))}
      </select>
    </label>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The Reset confirm dialog — modal: focus starts on its primary control (Reset), Tab / Shift+Tab stay inside it,
 * Escape (or Cancel) closes it, and focus goes back to `returnTo` (the nav's Reset button) when it closes.
 */
function ResetDialog({ store, onClose, returnTo }: { store: HandoffStore; onClose: () => void; returnTo: RefObject<HTMLElement | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const back = returnTo;
    return () => {
      // Back to whatever opened the dialog (if it is still in the page).
      const el = back.current;
      if (el?.isConnected) el.focus();
    };
  }, [returnTo]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busy) onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const box = boxRef.current;
      if (!box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (!box.contains(at) || (e.shiftKey ? at === first : at === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    // Focus that leaves the dialog any other way (a click on the page behind the scrim) comes back to it.
    const onFocusIn = (e: FocusEvent) => {
      const box = boxRef.current;
      if (box && e.target instanceof Node && !box.contains(e.target)) (box.querySelector<HTMLElement>(FOCUSABLE) ?? box).focus();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [busy, onClose]);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    const r = await runReset(store);
    if (r.ok) {
      window.location.reload();
      return;
    }
    setError(r.error);
    setBusy(false);
  };
  // Busy disables both buttons (focus falls to the body); once the outcome is in, focus returns to the primary control.
  useEffect(() => {
    if (!busy && error) confirmRef.current?.focus();
  }, [busy, error]);
  return (
    <div className="pk-modal-scrim" data-handoff-reset-dialog="">
      <div ref={boxRef} className="pk-modal" role="dialog" aria-modal="true" aria-labelledby="handoff-reset-title" aria-describedby="handoff-reset-body" tabIndex={-1}>
        <div id="handoff-reset-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{RESET_COPY.title}</div>
        <div id="handoff-reset-body" style={{ fontSize: 13.5, color: "#5b616e", lineHeight: 1.5 }}>{RESET_COPY.body}</div>
        {error && (
          <div role="alert" data-handoff-reset-error="" style={{ marginTop: 12, fontSize: 13, color: "#a33a2b" }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <button type="button" className="pk-btn-outline" data-handoff-reset-cancel="" disabled={busy} onClick={onClose}>
            {RESET_COPY.cancel}
          </button>
          <button ref={confirmRef} type="button" className="pk-btn-danger" data-handoff-reset-confirm="" disabled={busy} onClick={confirm} style={{ padding: "7px 14px" }}>
            {busy ? RESET_COPY.busy : RESET_COPY.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Shell({ store }: { store: HandoffStore }) {
  const { route, key } = useShellRoute();
  // The store flips this live: a failed write, or another window resetting the data (runtime/store.ts).
  const persistent = useSyncExternalStore(store.subscribe, () => store.persistent, () => store.persistent);
  const [viewerId, setViewerId] = useState(() => users.current().id);
  const [resetting, setResetting] = useState(false);
  const resetBtn = useRef<HTMLButtonElement | null>(null);
  const closeReset = useCallback(() => setResetting(false), []);
  const readyOnce = useRef(false);
  // verify.ts waits for this: the first routed screen has rendered its content.
  const onReady = useCallback(() => {
    if (readyOnce.current) return;
    readyOnce.current = true;
    document.getElementById("root")?.setAttribute("data-handoff-ready", "");
  }, []);
  const pick = (id: string) => {
    users.setCurrent(id);
    setViewerId(users.current().id);
  };
  return (
    <div className="pk-shell" data-handoff-shell="" data-handoff-route={route.name} data-handoff-route-hash={routeHash(route)}>
      <div style={BANNER} data-handoff-banner="">
        {BANNER_TEXT}
        {persistent ? null : <span data-handoff-not-persistent=""> · {NOT_PERSISTENT_TEXT}</span>}
      </div>
      <header className="pk-nav">
        <div className="pk-nav-left">
          <span className="pk-mark">PK</span>
          <span className="pk-company">Peak Systems Group</span>
          <span className="pk-beta">PROTOTYPE</span>
          <nav className="pk-tabs" aria-label="Prototype">
            {NAV_ROUTES.map((n) => {
              const active = n.name === route.name || (n.name === "estimates" && route.name === "estimate");
              return (
                <a key={n.name} className={"pk-tab" + (active ? " active" : "")} href={`#/${n.name}`} data-handoff-nav={n.name} aria-current={active ? "page" : undefined}>
                  {n.label}
                </a>
              );
            })}
          </nav>
        </div>
        <div className="pk-nav-right">
          <UserSwitcher viewerId={viewerId} onPick={pick} />
          <button ref={resetBtn} type="button" data-handoff-reset="" aria-haspopup="dialog" onClick={() => setResetting(true)} style={{ ...NAV_FIELD, cursor: "pointer", fontWeight: 600 }}>
            {RESET_COPY.button}
          </button>
        </div>
      </header>
      <main style={{ flex: 1, minHeight: 0, position: "relative", background: "#f7f8fa" }}>
        <Screen key={`${key}:${viewerId}`} route={route} store={store} onReady={onReady} />
      </main>
      {resetting && <ResetDialog store={store} onClose={closeReset} returnTo={resetBtn} />}
      <PreviewOverlay />
    </div>
  );
}

