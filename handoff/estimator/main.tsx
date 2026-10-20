/**
 * Estimator handoff — entry. Opens the browser store (IndexedDB overlay over the slice,
 * runtime/store.ts), points the ports at it, and mounts the real EstimatorClient with props from
 * runtime/props/estimator.ts — the prototype's EstimatorPage. Opens `?id=` when the store has it,
 * else the golden fixture Q-G001, else the first estimate, else a clean new estimate. The root gets
 * `data-handoff-ready` after the first render (verify.ts waits for it).
 */
import "./shims/next-navigation"; // patch history before the app mounts
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import EstimatorClient from "@/app/(app)/estimator/estimator-client";
import type { EstimatorProps } from "@/app/(app)/estimator/types";
import { onRefresh } from "./runtime/router";
import { openStore, seedFromSlice, type HandoffStore } from "./runtime/store";
import { configurePorts } from "./runtime/ports";
import { buildEstimatorProps } from "./runtime/props/estimator";

const DEFAULT_ESTIMATE_ID = "Q-G001";

async function pickEstimateId(store: HandoffStore): Promise<string | null> {
  const want = new URLSearchParams(window.location.search).get("id");
  const all = await store.all<{ id: string }>("quotes");
  return (all.find((q) => q.id === want) ?? all.find((q) => q.id === DEFAULT_ESTIMATE_ID) ?? all[0])?.id ?? null;
}

const bannerStyle = {
  padding: "4px 12px",
  font: "600 12px/1.6 var(--font-ui)",
  letterSpacing: "0.02em",
  background: "#16181b",
  color: "#e8e3d8",
} as const;

function App({ store, quoteId, first }: { store: HandoffStore; quoteId: string | null; first: EstimatorProps }) {
  const [props, setProps] = useState(first);
  // router.refresh() → re-read the props from the store (client state is kept, as with a server re-render).
  useEffect(
    () =>
      onRefresh(() => {
        buildEstimatorProps(store, quoteId, new URLSearchParams(window.location.search)).then(setProps, (e: unknown) =>
          console.error("[handoff] refresh: could not rebuild the Estimator props", e),
        );
      }),
    [store, quoteId],
  );
  useEffect(() => {
    document.getElementById("root")?.setAttribute("data-handoff-ready", "");
  }, []);
  return (
    <>
      <div style={bannerStyle} data-handoff-banner="">
        Confidential — Peak Systems Group · prototype — nothing is sent or saved to Peak
        {store.persistent ? null : <span data-handoff-not-persistent=""> · Changes won&apos;t be saved in this window</span>}
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
  }).render(<App store={store} quoteId={quoteId} first={first} />);
}

boot().catch((e: unknown) => {
  console.error("[handoff] boot failed", e);
  window.reportError(e);
});
