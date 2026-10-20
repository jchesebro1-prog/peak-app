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
 * Modified clicks (⌘ / ctrl / shift / alt) and middle-clicks (`auxclick`, button 1) on an app path would open a dead
 * tab (file:///estimator… or <host>/estimator…), so they are claimed too: a path that maps to a prototype route opens
 * that route's hash URL in a new tab (the current page without its hash or the Estimator's own params, plus the
 * route); an app path the prototype has shows the "Not part of the prototype" notice; a preview route (middle-click;
 * installPreviewRouting already claims the others) opens the in-window overlay.
 *
 * Left to the browser: other sites / mailto: / packaged files (`images/…`), plain `#/…` hrefs (a hash link is
 * new-tab safe), and the two preview routes on a plain or modified left click, which installPreviewRouting claims in
 * the CAPTURE phase (it runs first and prevents the default).
 *
 * App links must not sit inside a portal whose handlers stopPropagation: the click would never reach the document /
 * React-root listeners below and the link would bypass routing (a dead path under file://).
 * Plan: PR 2 Task 7.
 */
import { appRouter, currentRoute } from "../shims/next-navigation";
import { mapAppHref, newTabHref } from "../runtime/routes";
import { openPreview } from "./preview-overlay";
import { previewTargetOf } from "./preview-routes";

let onDocument = false;
const roots = new WeakSet<Element>();

function handle(e: MouseEvent, aux: boolean): void {
  if (e.defaultPrevented) return;
  if (aux ? e.button !== 1 : e.button !== 0) return;
  const modified = aux || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
  const a = (e.target as Element | null)?.closest?.("a");
  const href = a?.getAttribute("href");
  if (!href) return;
  const preview = previewTargetOf(href);
  if (preview) {
    // A left click (modified or not) was claimed by installPreviewRouting's capture listener; a middle-click was not.
    if (aux) {
      e.preventDefault();
      openPreview(preview);
    }
    return;
  }
  const target = mapAppHref(href, currentRoute());
  if (target.kind === "external") return;
  e.preventDefault();
  if (modified) {
    const url = newTabHref(target, window.location);
    if (url) {
      window.open(url, "_blank", "noopener");
      return;
    }
  }
  // Unmapped (the notice), an in-page anchor, or a plain click: through the router, in this window.
  appRouter.push(href);
}

const onClick = (e: MouseEvent) => handle(e, false);
const onAuxClick = (e: MouseEvent) => handle(e, true);

/** Installs the router on the document, and on `root` (the React root container) when given. Idempotent. */
export function installLinkRouting(root?: Element | null): void {
  if (typeof window === "undefined") return;
  if (!onDocument) {
    onDocument = true;
    document.addEventListener("click", onClick);
    document.addEventListener("auxclick", onAuxClick);
  }
  if (root && !roots.has(root)) {
    roots.add(root);
    root.addEventListener("click", onClick as EventListener);
    root.addEventListener("auxclick", onAuxClick as EventListener);
  }
}
