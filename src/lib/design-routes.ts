/**
 * Design module consolidation (D97) — the single source of truth for the
 * old→new path map.
 *
 * Deliberately dependency-free: imported by server route stubs AND by
 * scripts/test-review-and-spec.ts, so it must not reach the doc-store.
 */

const QS_ORDER: Record<string, string[]> = {
  "/consulting/markup": ["eng", "phase", "doc"],
};

function qs(pathname: string, query: Record<string, string>): string {
  const keys = QS_ORDER[pathname] || Object.keys(query);
  const parts: string[] = [];
  for (const k of keys) {
    const v = query[k];
    if (v == null || v === "") continue;
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

/**
 * Returns the new path for a legacy Design-module path, or null when the
 * path is not a legacy path (and must render normally).
 */
export function designRedirect(
  pathname: string,
  query: Record<string, string>
): string | null {
  // Bare /design is the new Overview. Only the ?id= deep link moves.
  if (pathname === "/design") {
    return query.id ? "/design/designs?id=" + encodeURIComponent(query.id) : null;
  }

  if (pathname === "/consulting") return "/design/engagements";

  if (pathname.startsWith("/consulting/")) {
    const rest = pathname.slice("/consulting/".length);
    return "/design/engagements/" + rest + qs(pathname, query);
  }

  if (pathname === "/design-studio") return "/design";

  if (pathname.startsWith("/design-studio/")) {
    const leaf = pathname.slice("/design-studio/".length);
    return "/design/" + leaf + qs(pathname, query);
  }

  if (pathname === "/quick-design") return "/design/quick" + qs(pathname, query);

  return null;
}
