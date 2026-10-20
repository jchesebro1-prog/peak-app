/**
 * Estimator handoff — entry. Opens the browser store (IndexedDB overlay over the slice, runtime/store.ts), points the
 * ports at it, registers the Estimator's server actions, and mounts the shell (ui/shell.tsx): the confidential banner,
 * the top nav, the acting-user switcher, Reset to production snapshot and a hash-routed screen — the Estimates list by
 * default, one estimate in the real EstimatorClient at `#/estimate/<id>` (props from runtime/props/estimator.ts, the
 * prototype's EstimatorPage), the Catalog screen (ui/catalog.tsx), the Assembly Builder + rack sheets (ui/assemblies.tsx) and the Estimating Rules editors (ui/rules.tsx). A
 * pre-shell deep link (`index.html?id=Q-G001&step=review`, `?new=1`) is put onto its hash route first. `router.refresh()`
 * re-reads the props for the estimate the route names now (a new estimate's first save puts its id there). The root
 * gets `data-handoff-ready` once the first screen has rendered (verify.ts waits for it). Task 5: the customer-facing
 * views' actions, the image URL rewrite (runtime/assets.ts) and the cut-sheet / preview overlay
 * (ui/preview-overlay.tsx). Task 6: Send & track (simulated), the next-step approval actions and the explicit
 * refusals — every server action the bundle stubs is registered (verify.ts --smoke --all-steps checks it).
 */
import { appRouter, normalizeLocation } from "./shims/next-navigation"; // patches history before the app mounts
import { createRoot } from "react-dom/client";
import { openStore, seedFromSlice } from "./runtime/store";
import { configurePorts, refreshPortsFromStore } from "./runtime/ports";
import { registerActions } from "./runtime/actions-registry";
import { actionRegistrations } from "./runtime/actions/registrations";
import { installAssetUrlRewrite } from "./runtime/assets";
import { installPreviewRouting } from "./ui/preview-overlay";
import { installLinkRouting } from "./ui/link-routing";
import { Shell } from "./ui/shell";

async function boot() {
  const el = document.getElementById("root");
  if (!el) throw new Error("#root is missing from index.html");
  const store = await openStore(seedFromSlice());
  configurePorts({ store });
  // The ports' rate / settings snapshot starts as the store's (seed ∪ this browser's overlay — an Estimating Rules edit
  // made earlier), never the bare slice; every writer re-reads it after a write (Task 10).
  await refreshPortsFromStore(store);
  // The Estimator's server actions, in the browser (before the first render — mount effects call some):
  // every "use server" module the bundle stubs (runtime/actions/registrations.ts).
  for (const [fileKey, impls] of actionRegistrations(store)) registerActions(fileKey, impls);
  // App image URLs (/placeholders/*, /api/part-documents/*) → packaged files; the two preview routes → the overlay;
  // every other app link → a shell route, a same-page change or the "Not part of the prototype" notice.
  installAssetUrlRewrite();
  installPreviewRouting();
  // The route is the hash; a pre-shell deep link (`?id=…` with no hash) or a stale search is put in line with it.
  normalizeLocation();
  // verify.ts drives the overlay and the router through this handle (put → reload → read back → reset; push → route).
  const w = window as unknown as { __peakHandoff?: Record<string, unknown> };
  w.__peakHandoff = { ...(w.__peakHandoff ?? {}), store, router: appRouter };
  const root = createRoot(el, {
    // Log the component stack, then report as React would by default (a pageerror — verify.ts fails on it).
    onUncaughtError: (e, info) => {
      console.error("[handoff] uncaught render error", info?.componentStack);
      window.reportError(e);
    },
  });
  // After createRoot, so the root-level link router runs after React's own click handlers (ui/link-routing.ts).
  installLinkRouting(el);
  root.render(<Shell store={store} />);
}

boot().catch((e: unknown) => {
  console.error("[handoff] boot failed", e);
  window.reportError(e);
});
