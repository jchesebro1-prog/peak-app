/**
 * Settings groups (settings cleanup, Oct 1) — the left-hand menu of groups
 * that replaced the two-section Company / Admin split (D99). Each `?section=`
 * key is one group; only the selected group's cards render.
 *
 * Dependency-free VALUE module — imported by the "use client" SettingsClient,
 * the server page, the Gmail OAuth routes and the spec test. Must not import a
 * store, a "use client" module, or anything that reaches PGlite/Drizzle (same
 * contract as home-tabs-keys.ts; see D90's client-reference-proxy bug).
 */

/** The permission every Settings group needs today. The whole page has been
 *  admin-only (manage_users) since Phase 1 — each group names it so a group
 *  with nothing the viewer may see drops out of the menu. */
export type SettingsPerm = "manage_users";

export const SETTINGS_SECTIONS = [
  { key: "company", label: "Company", desc: "Branding, locations, holidays and dashboard defaults.", perm: "manage_users" },
  { key: "sales", label: "Sales", desc: "Review limits, pipelines, customer fields and the assumptions library.", perm: "manage_users" },
  { key: "field", label: "Field & Venues", desc: "Venue types.", perm: "manage_users" },
  { key: "team", label: "Team & Access", desc: "Team members, roles and permissions.", perm: "manage_users" },
  { key: "data", label: "Data & Tools", desc: "Import, document categories and go-live tools.", perm: "manage_users" },
] as const satisfies ReadonlyArray<{ key: string; label: string; desc: string; perm: SettingsPerm }>;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["key"];

/** Retired `?section=` values → the group that now holds their cards.
 *  `general` predates D99; `admin` was the D99 Admin section, whose team
 *  roster is what an admin opening the old link expects first. */
export const SECTION_ALIASES: Readonly<Record<string, SettingsSection>> = {
  general: "company",
  admin: "team",
  // The Integrations group (mailboxes, recordings) was removed with the Inbox.
  integrations: "company",
  // The Consulting group went with the Consulting module; its assumptions library moved to Sales.
  consulting: "sales",
};

/** A Settings link tile — a screen that keeps its own route. */
export type SettingsScreen = { label: string; href: string; desc: string; mark?: string };

/**
 * Every screen Settings links to, once. These were ADMIN_SCREENS (Estimating
 * Rules, Import / Export) and COMPANY_SCREENS (Catalog); GROUP_LINKS hands
 * them out per group.
 */
export const SETTINGS_SCREENS = {
  catalog: { label: "Catalog", href: "/catalog", desc: "Company price books, parts, and manufacturers." },
  estimatingRules: { label: "Estimating Rules", href: "/estimating-rules", desc: "Rates and formulas the estimator uses." },
  importExport: { label: "Import / Export", href: "/import", desc: "Move records in and out of Peak." },
} as const satisfies Record<string, SettingsScreen>;

/** The link-tile row at the top of each group (empty = no row). Catalog sits
 *  on both Company and Sales (Jeff, Oct 1). */
export const GROUP_LINKS: Readonly<Record<SettingsSection, readonly SettingsScreen[]>> = {
  company: [SETTINGS_SCREENS.catalog],
  sales: [SETTINGS_SCREENS.catalog, SETTINGS_SCREENS.estimatingRules],
  field: [],
  team: [],
  data: [SETTINGS_SCREENS.importExport],
};

/**
 * Every card Settings shows, in render order, with the one group it lives in.
 * The spec test proves each old card is reachable in exactly one group; the
 * group components render in this order.
 */
export const SETTINGS_CARDS = [
  { key: "branding", label: "Branding & logos", group: "company" },
  { key: "locations", label: "Locations", group: "company" },
  { key: "federalHolidays", label: "Federal holidays", group: "company" },
  { key: "dashboardDefaults", label: "Dashboard defaults", group: "company" },
  { key: "reviewLimits", label: "Review limits", group: "sales" },
  { key: "pipelines", label: "Pipelines", group: "sales" },
  { key: "customerFields", label: "Customer fields", group: "sales" },
  { key: "estimateOutput", label: "Estimate output", group: "sales" },
  { key: "consultingAssumptions", label: "Assumptions library", group: "sales" },
  { key: "venueTypes", label: "Venue types", group: "field" },
  { key: "team", label: "Team & Roles", group: "team" },
  { key: "documentCategories", label: "Document categories", group: "data" },
  { key: "beta", label: "Beta & go-live tools", group: "data" },
] as const satisfies ReadonlyArray<{ key: string; label: string; group: SettingsSection }>;

export type SettingsCard = (typeof SETTINGS_CARDS)[number]["key"];

/** The cards one group renders, in order. */
export function cardsIn(group: SettingsSection): SettingsCard[] {
  return SETTINGS_CARDS.filter((c) => c.group === group).map((c) => c.key);
}

/** The groups a viewer may open, in menu order. `has` answers one permission
 *  (the page passes `(p) => can(p, me.roles)`); empty = the admin-lock card. */
export function visibleSettingsSections(
  has: (perm: SettingsPerm) => boolean,
): Array<(typeof SETTINGS_SECTIONS)[number]> {
  return SETTINGS_SECTIONS.filter((s) => has(s.perm));
}

/**
 * Resolve `?section=` into the group to show.
 * - Retired keys map through SECTION_ALIASES (`general` → company,
 *   `admin` → team).
 * - Unknown / missing → company; an array takes its first value.
 * - `visible` (when given) restricts the answer to groups the viewer may
 *   open, falling back to the first of them.
 */
export function resolveSettingsSection(
  param: string | string[] | undefined | null,
  opts: { visible?: readonly SettingsSection[] } = {},
): SettingsSection {
  const v = Array.isArray(param) ? param[0] : param;
  let key: SettingsSection = "company";
  if (v && SECTION_ALIASES[v]) key = SECTION_ALIASES[v];
  else if (SETTINGS_SECTIONS.some((s) => s.key === v)) key = v as SettingsSection;
  const visible = opts.visible;
  if (visible && visible.length && !visible.includes(key)) return visible[0];
  return key;
}

/** The canonical URL for a group (company is bare `/settings`, as before). */
export function settingsHref(group: SettingsSection): string {
  return group === "company" ? "/settings" : `/settings?section=${group}`;
}
