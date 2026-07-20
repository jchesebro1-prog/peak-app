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
  /* My Queue (D93) — top-level beside Home: it is the "what do I owe anyone"
   * screen, and burying it in a group would defeat that. */
  { kind: "link", key: "queue", label: "My Queue", href: "/queue" },
  { kind: "link", key: "calendar", label: "Calendar", href: "/calendar" },
  { kind: "link", key: "inbox", label: "Inbox", href: "/inbox" },
  /* Design is the merged Consulting + Design Studio module (D97): one
   * top-level group covering engagements, sandbox designs, and the three
   * calculators, replacing the standalone Consulting link and the
   * separate Design Studio group. Positioned where the Consulting link
   * held its place, beside Home/Inbox. */
  {
    kind: "group",
    key: "design",
    label: "Design",
    children: [
      { key: "designoverview", label: "Overview", href: "/design" },
      { key: "engagements", label: "Engagements", href: "/design/engagements" },
      { key: "designs", label: "Designs", href: "/design/designs" },
      { key: "steel", label: "Steel Calculator", href: "/design/steel" },
      { key: "lineset", label: "Lineset Builder", href: "/design/lineset" },
      { key: "motors", label: "Motor Library", href: "/design/motors" },
    ],
  },
  {
    kind: "group",
    key: "sales",
    label: "Sales",
    children: [
      { key: "leads", label: "Leads", href: "/leads" },
      { key: "quotes", label: "Quotes", href: "/quotes" },
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
      { key: "companies", label: "Companies", href: "/companies" },
      { key: "people", label: "People", href: "/people" },
      { key: "field", label: "Field Survey", href: "/field-survey" },
      { key: "catalog", label: "Catalog", href: "/catalog" },
      { key: "reports", label: "Reports", href: "/reports" },
      { key: "templates", label: "Templates", href: "/templates" },
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
    "/queue": "queue",
    "/leads": "leads",
    "/quotes": "quotes",
    "/estimator": "quotes",
    "/design": "designoverview",
    "/reviews": "reviews",
    "/projects": "projects",
    "/schedule": "schedule",
    "/field-work": "fieldwork",
    "/flame-tests": "flametests",
    "/inspections": "inspections",
    "/repairs": "repairs",
    "/companies": "companies",
    "/people": "people",
    "/customers": "companies", // legacy route redirects to /companies (D85)
    "/field-survey": "field",
    "/catalog": "catalog",
    "/reports": "reports",
    "/templates": "templates",
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

/** Badge counts per child key (computed server-side in lib/nav-counts). */
export type NavCounts = Partial<Record<string, number>>;

/** To-do bell payload (client-safe types; built in lib/nav-counts). */
export type BellItem = {
  id: string;
  title: string;
  sub: string;
  href: string;
  letter: string;
  color: string;
};
export type BellGroup = { key: string; label: string; items: BellItem[] };
