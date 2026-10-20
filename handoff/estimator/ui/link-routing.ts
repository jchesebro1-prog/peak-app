/**
 * Estimator handoff — link clicks inside the shell. Under file:// (and an Artifact) an app path such as
 * `/estimator?id=Q-2041` or `/quotes` is a dead link, and the real app's `<Link>` renders as a plain `<a>`
 * (shims/next-link.tsx). A click that nothing else handled goes through the same mapping as `router.push`
 * (runtime/routes.ts mapAppHref): a shell route, a same-page query change, a scroll to an in-page anchor, or the
 * "Not part of the prototype" notice — whatever the link's `target` (a `target="_blank"` app path such as
 * `/api/quotes/<id>/cover-pdf` would open a dead file:///api/… tab) and with or without `download`.
 *
 * BUBBLE phase, after React: an `<a>` whose own onClick navigates (the narrative column's "Change in Client
 * package →", the Build card's "Customer: … ↗" chip) calls preventDefault and pushes its own history entry; the
 * router skips any click already `defaultPrevented`, so a click makes exactly one entry. Listening on the React root
 * as well as on the document covers a React handler that stops propagation (React calls the native
 * stopPropagation at the root, which still runs the root's other listeners — this one is added after React's).
 *
 * Left to the browser: modified clicks, other sites / mailto: / packaged files (`images/…`), and the two preview
 * routes, which installPreviewRouting claims in the CAPTURE phase (it runs first and prevents the default).
 * Plan: PR 2 Task 7.
 */
import { appRouter, currentRoute } from "../shims/next-navigation";
import { mapAppHref } from "../runtime/routes";
import { previewTargetOf } from "./preview-routes";

let onDocument = false;
const roots = new WeakSet<Element>();

function onClick(e: MouseEvent): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = (e.target as Element | null)?.closest?.("a");
  const href = a?.getAttribute("href");
  if (!href || previewTargetOf(href)) return;
  if (mapAppHref(href, currentRoute()).kind === "external") return;
  e.preventDefault();
  appRouter.push(href);
}

/** Installs the router on the document, and on `root` (the React root container) when given. Idempotent. */
export function installLinkRouting(root?: Element | null): void {
  if (typeof window === "undefined") return;
  if (!onDocument) {
    onDocument = true;
    document.addEventListener("click", onClick);
  }
  if (root && !roots.has(root)) {
    roots.add(root);
    root.addEventListener("click", onClick as EventListener);
  }
}
