/**
 * Design module consolidation (D97) — the single source of truth for the
 * old→new path map. The Design overview, Quick Design, the Grid, Specs and
 * Consulting are gone (stage 4 of the shrink); what is left maps old paths
 * onto the kept builders (Assembly Builder, Lineset Builder, Motor Library)
 * and the Knowledge tools.
 *
 * Deliberately dependency-free: imported by server route stubs AND by
 * scripts/test-review-and-spec.ts, so it must not reach the doc-store.
 */

function qs(pathname: string, query: Record<string, string>): string {
  const keys = Object.keys(query);
  const parts: string[] = [];
  for (const k of keys) {
    const v = query[k];
    if (v == null || v === "") continue;
    parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
  }
  return parts.length ? "?" + parts.join("&") : "";
}

/**
 * #136: Steel Calculator and Fixture Cross-Ref moved from DESIGN to the
 * KNOWLEDGE tab. Keyed on the /design/* path they had after D97 so BOTH the
 * D97 stubs (/design-studio/steel → /design/steel) and the /design/* stubs
 * land on /knowledge/* in one hop instead of a redirect chain.
 */
const KNOWLEDGE_MOVES: Record<string, string> = {
  "/design/steel": "/knowledge/steel",
  "/design/fixtures": "/knowledge/fixtures",
};

/**
 * Returns the new path for a legacy Design-module path, or null when the
 * path is not a legacy path (and must render normally).
 */
export function designRedirect(
  pathname: string,
  query: Record<string, string>
): string | null {
  // The Design overview is gone: /design lands on the Assembly Builder.
  if (pathname === "/design") return "/design/assemblies";

  // Subassemblies became a tab of the Assembly Builder (#130), then merged
  // into its one list (#210).
  if (pathname === "/design/subassemblies") return "/design/assemblies";
  if (KNOWLEDGE_MOVES[pathname]) return KNOWLEDGE_MOVES[pathname];

  if (pathname === "/design-studio") return "/design/assemblies";

  // Weights was folded into the lineset builder — it has no standalone
  // /design/weights page, so it needs an explicit mapping instead of
  // falling through to the generic leaf-name branch below.
  if (pathname === "/design-studio/weights") {
    return "/design/lineset" + qs("/design-studio/lineset", query);
  }

  if (pathname.startsWith("/design-studio/")) {
    const leaf = pathname.slice("/design-studio/".length);
    const next = "/design/" + leaf;
    return (KNOWLEDGE_MOVES[next] || next) + qs(pathname, query);
  }

  return null;
}
