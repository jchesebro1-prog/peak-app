import type {
  CustomerDoc,
  CustomerLocation,
} from "@/lib/stores/customers";

/**
 * Customers — shared, client-safe view helpers (ports of the display logic in
 * Customers.dc.html / Customer Context.dc.html). Pure functions + type/colour
 * tables only; no store runtime imports, so both the server pages and the
 * client edit modal can import from here.
 *
 * NOTE on the ported store shape: the canonical CustomerDoc the store persists
 * is the reduced directory record — { id, name, type, location, locations[],
 * contacts[] }. The prototype's `since`, `owner`, `notes`, `mono`, per-venue
 * street/zip/stage dims and inline `quotes[]` are NOT persisted (normalizeRecord
 * drops them). So: `mono` is derived from the name, the account `owner` is
 * rolled up from the customer's linked quotes/projects, and activity (quotes,
 * projects, surveys) is cross-read live from those stores by customerId/name.
 */

export const ACCENT_INK = "color-mix(in srgb, var(--accent) 68%, #000)";
export const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";

/** Customer types offered in the New/Edit form (prototype typeOptions). */
export const CUSTOMER_TYPES = [
  "Performing arts",
  "Education",
  "Worship",
  "Civic",
  "Commercial",
] as const;

const TYPE_COLORS: Record<string, string> = {
  "Performing arts": "#7b3f8a",
  Education: "#3155a8",
  Worship: "#1f7a52",
  Civic: "#9a7d1f",
  Commercial: "#b4543a",
};

export function typeColor(t: string | null | undefined): string {
  return (t && TYPE_COLORS[t]) || "#5b616e";
}

/** Venue kinds — [value, label] (prototype VENUE_KINDS). */
export const VENUE_KINDS: Array<[string, string]> = [
  ["proscenium", "Proscenium / Auditorium"],
  ["church", "Worship / Church"],
  ["flat", "Flat floor / Conference"],
  ["blackbox", "Black box"],
  ["arena", "Arena / Open floor"],
];

export function venueKindLabel(k: string | null | undefined): string {
  const v = VENUE_KINDS.find((x) => x[0] === k);
  return v ? v[1] : "Venue";
}

export type ChipMeta = { label: string; ink: string; soft: string; bd: string };

/** Quote status pills (prototype statusMeta). */
export const QUOTE_STATUS_META: Record<string, ChipMeta> = {
  draft: { label: "Draft", ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  sent: { label: "Sent", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  won: { label: "Won", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
  lost: { label: "Lost", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" },
};

export function quoteStatusMeta(k: string | null | undefined): ChipMeta {
  return QUOTE_STATUS_META[k || "draft"] || QUOTE_STATUS_META.draft;
}

/** Travel-source badge meta (prototype srcMeta). */
export const TRAVEL_SOURCE_META: Record<string, { label: string; ink: string; soft: string }> = {
  manual: { label: "Manual entry", ink: "#3155a8", soft: "#e9eefb" },
  routed: { label: "Driving route", ink: "#1f7a52", soft: "#eaf6ef" },
  auto: { label: "Estimated (straight-line)", ink: "#9a7d1f", soft: "#fbf3dd" },
  none: { label: "No estimate", ink: "#9aa0ab", soft: "#f1f2f5" },
};

/** Two-letter monogram from a name (prototype mono derivation). */
export function mono(name: string | null | undefined): string {
  const clean = (name || "").replace(/[^A-Za-z ]/g, "").trim();
  if (!clean) return "NC";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function cityState(loc: CustomerLocation | null | undefined): string {
  return loc ? [loc.city, loc.state].filter(Boolean).join(", ") : "";
}

/** Primary-or-first venue's "City, ST" for a customer, em-dash when none. */
export function custLocation(c: CustomerDoc | null | undefined): string {
  if (!c) return "—";
  const ls = c.locations || [];
  const prim = ls.find((l) => l.primary) || ls[0] || null;
  return cityState(prim) || c.location || "—";
}

/** Full-dollar money with separators, em-dash for zero (prototype money()). */
export function moneyDash(n: number | null | undefined): string {
  const v = Math.round(n || 0);
  return v > 0 ? "$" + v.toLocaleString("en-US") : "—";
}

export function money(n: number | null | undefined): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

/** Compact money for list rows (prototype moneyK()). */
export function moneyK(n: number | null | undefined): string {
  const v = Math.round(n || 0);
  return v >= 1000 ? "$" + Math.round(v / 1000) + "k" : "$" + v;
}
