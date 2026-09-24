/**
 * Settings section nav + Admin area (D99).
 *
 * Dependency-free VALUE module — imported by the "use client" SettingsClient
 * and by the spec test. Must not import a store, a "use client" module, or
 * anything that reaches PGlite/Drizzle (same contract as home-tabs-keys.ts;
 * see D90's client-reference-proxy bug).
 */

export const SETTINGS_SECTIONS = [
  { key: "company", label: "Company" },
  { key: "admin", label: "Admin" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["key"];

/**
 * The four data-administration screens the dissolved General group hands to
 * Settings. Each keeps its own route; the Admin area only links to them.
 */
export const ADMIN_SCREENS = [
  { label: "Templates", href: "/templates", desc: "Document and message wording." },
  { label: "Estimating Rules", href: "/estimating-rules", desc: "Rates and formulas the estimator uses." },
  { label: "Task Templates", href: "/task-templates", desc: "Reusable checklists for projects, quotes, and designs." },
  { label: "Import / Export", href: "/import", desc: "Move records in and out of Peak." },
] as const;

/** Company-owned configuration screens. Catalog is a company price book,
 * not an administrator/user-management screen. */
export const COMPANY_SCREENS = [
  { label: "Catalog", href: "/catalog", desc: "Company price books, parts, and manufacturers." },
] as const;

/** Validate the `?section=` param into a known section key (defaults company). */
export function resolveSettingsSection(
  param: string | string[] | undefined,
): SettingsSection {
  const v = Array.isArray(param) ? param[0] : param;
  if (v === "general") return "company";
  return SETTINGS_SECTIONS.some((s) => s.key === v)
    ? (v as SettingsSection)
    : "company";
}

/**
 * Integration cards inside the General section (Mailboxes, Recordings). Each
 * card's `id` is its anchor, so deep links like `/settings#recordings` land
 * on it; the Account page's "Enable Drive archive" hint points there.
 */
export const INTEGRATION_CARDS = [
  { key: "mailboxes", label: "Mailboxes", desc: "Gmail connections — send, receive, calendar, tasks." },
  { key: "recordings", label: "Recordings", desc: "Where site-visit audio is archived once transcribed." },
] as const;

export type IntegrationCard = (typeof INTEGRATION_CARDS)[number]["key"];
