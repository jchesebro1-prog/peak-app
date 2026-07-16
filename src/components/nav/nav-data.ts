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
      { key: "templates", label: "Templates", href: "/templates" },
      { key: "rules", label: "Estimating Rules", href: "/estimating-rules" },
      { key: "import", label: "Import / Export", href: "/import" },
    ],
  },
];

/** Assistant (Phase 8) is a top-level link inserted after Inbox, but only when
 *  the AI layer is enabled — the whole entry is absent when the ANTHROPIC_API_KEY
 *  gate is off, so there's no dead nav item pointing at an inert feature. */
export const ASSISTANT_NAV: NavEntry = {
  kind: "link",
  key: "assistant",
  label: "Assistant",
  href: "/assistant",
};

export function navEntries(aiEnabled: boolean): NavEntry[] {
  if (!aiEnabled) return NAV;
  const out = NAV.slice();
  out.splice(2, 0, ASSISTANT_NAV); // after Home + Inbox
  return out;
}

/** pathname → active key (child keys map to their parent group for the tab pill) */
export function activeKeyFor(pathname: string): string {
  if (pathname === "/") return "home";
  const seg = "/" + (pathname.split("/")[1] || "");
  const map: Record<string, string> = {
    "/inbox": "inbox",
    "/assistant": "assistant",
    "/leads": "leads",
    "/quotes": "quotes",
    "/estimator": "quotes",
    "/design": "design",
    "/quick-design": "design",
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
