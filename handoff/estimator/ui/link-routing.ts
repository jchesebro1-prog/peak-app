/**
 * Estimator handoff — link clicks inside the shell. Under file:// (and an Artifact) an app path such as
 * `/estimator?id=Q-2041` or `/quotes` is a dead link, and the real app's `<Link>` renders as a plain `<a>`
 * (shims/next-link.tsx). One capture-phase click handler sends every such click through the same mapping as
 * `router.push` (runtime/routes.ts mapAppHref): a shell route, a same-page query change, a scroll to an in-page
 * anchor, or the "Not part of the prototype" notice. Modified clicks, new-tab targets, downloads, other sites and
 * packaged files (`images/…`) are left to the browser. Installed after installPreviewRouting, so a preview link
 * (cut sheets / saved preview) has already been claimed (`defaultPrevented`) or is left to its own page (the package
 * page's Narrative / BOM toggle). Plan: PR 2 Task 7.
 */
import { appRouter, currentRoute } from "../shims/next-navigation";
import { mapAppHref } from "../runtime/routes";
import { previewTargetOf } from "./preview-routes";

let installed = false;

export function installLinkRouting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Capture phase, so it runs before React's own handlers (a row's onClick checks `defaultPrevented`).
  document.addEventListener(
    "click",
    (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.hasAttribute("download")) return;
      const target = a.getAttribute("target");
      if (target && target !== "_self") return;
      const href = a.getAttribute("href");
      if (!href || previewTargetOf(href)) return;
      if (mapAppHref(href, currentRoute()).kind === "external") return;
      e.preventDefault();
      appRouter.push(href);
    },
    true,
  );
}
