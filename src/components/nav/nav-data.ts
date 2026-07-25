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
  /* Q-6 rebrand (D117): the header reads like the brand lockup —
   * [Q6 mark = Home] EST · PM · CRM · DESIGN. Home left the tab row (the
   * mark is the link); Quotes/Estimator/Reviews split out of Sales into
   * EST; the rest of Sales became CRM; Operations became PM. Routes are
   * untouched — only group keys/labels moved. */
  {
    kind: "group",
    key: "est",
    label: "EST",
    children: [
      { key: "quotes", label: "Quotes", href: "/quotes" },
      { key: "estimator", label: "Estimator", href: "/estimator" },
      { key: "reviews", label: "Reviews", href: "/reviews" },
    ],
  },
  {
    kind: "group",
    key: "pm",
    label: "PM",
    children: [
      { key: "projects", label: "Projects", href: "/projects" },
      { key: "schedule", label: "Schedule", href: "/schedule" },
      { key: "fieldwork", label: "Field Work", href: "/field-work" },
      { key: "flametests", label: "Flame Tests", href: "/flame-tests" },
      { key: "inspections", label: "Rigging Inspections", href: "/inspections" },
      { key: "repairs", label: "Repairs", href: "/repairs" },
    ],
  },
  {
    kind: "group",
    key: "crm",
    label: "CRM",
    children: [
      { key: "leads", label: "Leads", href: "/leads" },
      { key: "companies", label: "Companies", href: "/companies" },
      { key: "people", label: "People", href: "/people" },
      { key: "venues", label: "Venues", href: "/venues" },
      { key: "field", label: "Field Survey", href: "/field-survey" },
    ],
  },
  {
    kind: "group",
    key: "design",
    label: "DESIGN",
    children: [
      { key: "designoverview", label: "Overview", href: "/design" },
      { key: "engagements", label: "Consulting", href: "/design/engagements" },
      { key: "designs", label: "Designs", href: "/design/designs" },
      /* The Grid (D108) — the DaVinci-style system designer: plan sheets,
       * painted catalog devices, live BOM → draft quote. */
      { key: "grid", label: "The Grid", href: "/design/grid" },
      { key: "steel", label: "Steel Calculator", href: "/design/steel" },
      { key: "lineset", label: "Lineset Builder", href: "/design/lineset" },
      { key: "motors", label: "Motor Library", href: "/design/motors" },
      { key: "fixtures", label: "Fixture Cross-Ref", href: "/design/fixtures" },
    ],
  },
];

/** pathname → active key (child keys map to their parent group for the tab pill) */
export function activeKeyFor(pathname: string): string {
  if (pathname === "/") return "home";
  const seg = "/" + (pathname.split("/")[1] || "");
  const map: Record<string, string> = {
    "/queue": "home",
    "/calendar": "home",
    "/inbox": "home",
    "/leads": "leads",
    "/quotes": "quotes",
    "/estimator": "estimator",
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
    "/venues": "venues",
    "/customers": "companies", // legacy route redirects to /companies (D85)
    "/field-survey": "field",
    "/catalog": "settings",
    "/reports": "home",
    "/templates": "settings",
    "/estimating-rules": "settings",
    "/import": "settings",
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
