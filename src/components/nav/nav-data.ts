/**
 * Nav structure — ported from Nav.dc.html (see docs/specs/nav-shell.json).
 * Keys match the prototype's `active` prop enum; hrefs map the prototype's
 * .dc.html screens to app routes.
 */

export type NavChild = { key: string; label: string; href: string };
export type NavEntry =
  | { kind: "link"; key: string; label: string; href: string }
  | { kind: "group"; key: string; label: string; children: NavChild[] };

export const NAV: NavEntry[] = [
  { kind: "link", key: "home", label: "Home", href: "/" },
  { kind: "link", key: "inbox", label: "Inbox", href: "/inbox" },
  {
    kind: "group",
    key: "sales",
    label: "Sales",
    children: [
      { key: "leads", label: "Leads", href: "/leads" },
      { key: "quotes", label: "Quotes", href: "/quotes" },
      { key: "design", label: "Design", href: "/design" },
      { key: "reviews", label: "Reviews", href: "/reviews" },
    ],
  },
  {
    kind: "group",
    key: "installs",
    label: "Installs",
    children: [
      { key: "projects", label: "Projects", href: "/projects" },
      { key: "schedule", label: "Schedule", href: "/schedule" },
      { key: "fieldwork", label: "Field Work", href: "/field-work" },
    ],
  },
  {
    kind: "group",
    key: "service",
    label: "Service",
    children: [
      { key: "flametests", label: "Flame Tests", href: "/flame-tests" },
      { key: "inspections", label: "Rigging Inspections", href: "/inspections" },
      { key: "repairs", label: "Repairs", href: "/repairs" },
    ],
  },
  {
    kind: "group",
    key: "general",
    label: "General",
    children: [
      { key: "customers", label: "Customers", href: "/customers" },
      { key: "field", label: "Field Survey", href: "/field-survey" },
      { key: "catalog", label: "Catalog", href: "/catalog" },
      { key: "reports", label: "Reports", href: "/reports" },
      { key: "rules", label: "Estimating Rules", href: "/estimating-rules" },
      { key: "import", label: "Import / Export", href: "/import" },
    ],
  },
];

/** pathname → active key (child keys map to their parent group for the tab pill) */
export function activeKeyFor(pathname: string): string {
  if (pathname === "/") return "home";
  const seg = "/" + (pathname.split("/")[1] || "");
  const map: Record<string, string> = {
    "/inbox": "inbox",
    "/leads": "leads",
    "/quotes": "quotes",
    "/design": "design",
    "/reviews": "reviews",
    "/projects": "projects",
    "/schedule": "schedule",
    "/field-work": "fieldwork",
    "/flame-tests": "flametests",
    "/inspections": "inspections",
    "/repairs": "repairs",
    "/customers": "customers",
    "/field-survey": "field",
    "/catalog": "catalog",
    "/reports": "reports",
    "/estimating-rules": "rules",
    "/import": "import",
    "/settings": "settings",
    "/account": "account",
  };
  return map[seg] || "";
}

export function parentGroupOf(key: string): string | null {
  for (const entry of NAV) {
    if (entry.kind === "group" && entry.children.some((c) => c.key === key))
      return entry.key;
  }
  return null;
}

/** Badge counts per child key. Phase 1: all zero (stores land in Phase 2). */
export type NavCounts = Partial<Record<string, number>>;
