/**
 * Estimator handoff — entry. Opens the browser store (IndexedDB overlay over the slice,
 * runtime/store.ts), points the ports at it, and mounts the real EstimatorClient with props from
 * runtime/props/estimator.ts — the prototype's EstimatorPage. Opens `?id=` when the store has it,
 * else a clean new estimate for `?new=1`, else the golden fixture Q-G001, else the first estimate,
 * else a clean new estimate. The Estimator's server actions are registered (runtime/actions/*) before
 * the first render. `router.refresh()` re-reads the props for the estimate the URL names now (a new
 * estimate's first save puts its id there). The root gets `data-handoff-ready` after the first render
 * (verify.ts waits for it).
 */
import "./shims/next-navigation"; // patch history before the app mounts
import { useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import EstimatorClient from "@/app/(app)/estimator/estimator-client";
import type { EstimatorProps } from "@/app/(app)/estimator/types";
import { onRefresh } from "./runtime/router";
import { openStore, seedFromSlice, type HandoffStore } from "./runtime/store";
import { configurePorts } from "./runtime/ports";
import { buildEstimatorProps } from "./runtime/props/estimator";
import { registerActions } from "./runtime/actions-registry";
import { ESTIMATOR_ACTIONS_KEY, estimatorActions, refusedEstimatorActions } from "./runtime/actions/estimator-actions";
import { QUOTES_ACTIONS_KEY, quotesActions } from "./runtime/actions/quotes-actions";

const DEFAULT_ESTIMATE_ID = "Q-G001";

/** The estimate the URL names: `?id=` when the store has it; `?new=1` → none (a clean new estimate); else the default. */
async function pickEstimateId(store: HandoffStore): Promise<string | null> {
  const params = new URLSearchParams(window.location.search);
  const want = params.get("id");
  const all = await store.all<{ id: string }>("quotes");
  const hit = all.find((q) => q.id === want);
  if (hit) return hit.id;
  if (params.get("new") === "1") return null;
  return (all.find((q) => q.id === DEFAULT_ESTIMATE_ID) ?? all[0])?.id ?? null;
}

const bannerStyle = {
  padding: "4px 12px",
  font: "600 12px/1.6 var(--font-ui)",
  letterSpacing: "0.02em",
  background: "#16181b",
  color: "#e8e3d8",
} as const;

function App({ store, first }: { store: HandoffStore; first: EstimatorProps }) {
  const [props, setProps] = useState(first);
  // The store flips this live: a failed write, or another window resetting the data (runtime/store.ts).
  const persistent = useSyncExternalStore(store.subscribe, () => store.persistent, () => store.persistent);
  // router.refresh() → re-read the props from the store for the estimate the URL names now (client
  // state is kept, as with a server re-render). Refreshes are serialized and only the latest one lands.
  useEffect(() => {
    let seq = 0;
    return onRefresh(() => {
      const mine = ++seq;
      pickEstimateId(store)
        .then((id) => buildEstimatorProps(store, id, new URLSearchParams(window.location.search)))
        .then(
          (next) => {
            if (mine !== seq) return;
            setProps(next);
            // verify.ts reads how many refreshes have landed (a save must re-read the props).
            const w = window as unknown as { __peakHandoff?: { propsRefreshes?: number } };
            if (w.__peakHandoff) w.__peakHandoff.propsRefreshes = (w.__peakHandoff.propsRefreshes ?? 0) + 1;
          },
          (e: unknown) => console.error("[handoff] refresh: could not rebuild the Estimator props", e),
        );
    });
  }, [store]);
  useEffect(() => {
    document.getElementById("root")?.setAttribute("data-handoff-ready", "");
  }, []);
  return (
    <>
      <div style={bannerStyle} data-handoff-banner="">
        Confidential — Peak Systems Group · prototype — nothing is sent or saved to Peak
        {persistent ? null : <span data-handoff-not-persistent=""> · Changes won&apos;t be saved in this window</span>}
      </div>
      <EstimatorClient {...props} />
    </>
  );
}

async function boot() {
  const el = document.getElementById("root");
  if (!el) throw new Error("#root is missing from index.html");
  const store = await openStore(seedFromSlice());
  configurePorts({ store });
  // The Estimator's server actions, in the browser (before the first render — mount effects call some).
  registerActions(ESTIMATOR_ACTIONS_KEY, { ...refusedEstimatorActions(), ...estimatorActions(store) });
  registerActions(QUOTES_ACTIONS_KEY, quotesActions(store));
  // verify.ts drives the overlay through this handle (put → reload → read back → reset).
  const w = window as unknown as { __peakHandoff?: Record<string, unknown> };
  w.__peakHandoff = { ...(w.__peakHandoff ?? {}), store };
  const quoteId = await pickEstimateId(store);
  const first = await buildEstimatorProps(store, quoteId, new URLSearchParams(window.location.search));
  createRoot(el, {
    // Log the component stack, then report as React would by default (a pageerror — verify.ts fails on it).
    onUncaughtError: (e, info) => {
      console.error("[handoff] uncaught render error", info?.componentStack);
      window.reportError(e);
    },
  }).render(<App store={store} first={first} />);
}

boot().catch((e: unknown) => {
  console.error("[handoff] boot failed", e);
  window.reportError(e);
});
