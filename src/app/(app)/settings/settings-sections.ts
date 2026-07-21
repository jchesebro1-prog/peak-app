/**
 * Settings section nav + Admin area (D99).
 *
 * Dependency-free VALUE module — imported by the "use client" SettingsClient
 * and by the spec test. Must not import a store, a "use client" module, or
 * anything that reaches PGlite/Drizzle (same contract as home-tabs-keys.ts;
 * see D90's client-reference-proxy bug).
 */

export const SETTINGS_SECTIONS = [
  { key: "general", label: "General" },
  { key: "team", label: "Team & Roles" },
  { key: "admin", label: "Admin" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["key"];

/**
 * The four data-administration screens the dissolved General group hands to
 * Settings. Each keeps its own route; the Admin area only links to them.
 */
export const ADMIN_SCREENS = [
  { label: "Catalog", href: "/catalog", desc: "Price books, parts, and manufacturers." },
  { label: "Templates", href: "/templates", desc: "Document and message wording." },
  { label: "Estimating Rules", href: "/estimating-rules", desc: "Rates and formulas the estimator uses." },
  { label: "Import / Export", href: "/import", desc: "Move records in and out of Peak." },
] as const;

/** Validate the `?section=` param into a known section key (defaults general). */
export function resolveSettingsSection(
  param: string | string[] | undefined,
): SettingsSection {
  const v = Array.isArray(param) ? param[0] : param;
  return SETTINGS_SECTIONS.some((s) => s.key === v)
    ? (v as SettingsSection)
    : "general";
}
