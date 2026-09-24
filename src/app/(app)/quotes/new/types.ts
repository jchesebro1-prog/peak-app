/**
 * Guided quote-intake types — pure/serializable, safe for both the server
 * page and the client form (no store imports, matching the CustomerLite
 * pattern in estimator/types.ts).
 */

export type ServiceType =
  | "system"
  | "flame_test"
  | "repair"
  | "inspection"
  | "consulting"
  | "rental"
  | "custom";

/** Same six entries as the "+ New quote" split menu (quotes/controls.tsx) —
 *  label/sub-label/badge content ported verbatim so the picker on this
 *  screen reads identically to the menu that links here — plus a trailing
 *  "custom" card (#110): a user-named category for a system quote that
 *  builds in the Estimator like the default "system" entry does. */
export const SERVICE_TYPES: Array<{
  key: ServiceType;
  label: string;
  sub: string;
  badge: string | null;
  badgeInk: string;
  badgeSoft: string;
  badgeBd: string;
}> = [
  {
    key: "system",
    label: "System / equipment quote",
    sub: "Full line-item estimator",
    badge: null,
    badgeInk: "",
    badgeSoft: "",
    badgeBd: "",
  },
  {
    key: "flame_test",
    label: "Flame test quote",
    sub: "Auto-priced by travel + curtain count",
    badge: "Auto",
    badgeInk: "#b4543a",
    badgeSoft: "#f7e9e5",
    badgeBd: "#f0d6cd",
  },
  {
    key: "repair",
    label: "Repair quote",
    sub: "Auto-priced by labor + travel + parts",
    badge: "Auto",
    badgeInk: "#9a6a1f",
    badgeSoft: "#fbf3dd",
    badgeBd: "#f0e2bd",
  },
  {
    key: "inspection",
    label: "Inspection quote",
    sub: "Auto-priced by line sets + level + travel",
    badge: "Auto",
    badgeInk: "#3155a8",
    badgeSoft: "#e9eefb",
    badgeBd: "#d4ddf3",
  },
  {
    key: "consulting",
    label: "Consulting quote",
    sub: "Fee-based design & advisory work",
    badge: "Fee",
    badgeInk: "#6b4fa1",
    badgeSoft: "#f0ebf9",
    badgeBd: "#ddd2f0",
  },
  {
    key: "rental",
    label: "Rental quote",
    sub: "Auto-priced by equipment + duration",
    badge: "Auto",
    badgeInk: "#2f7a52",
    badgeSoft: "#e6f4ec",
    badgeBd: "#cde7d8",
  },
  {
    key: "custom",
    label: "Custom category",
    sub: "Name your own — builds in the Estimator",
    badge: null,
    badgeInk: "",
    badgeSoft: "",
    badgeBd: "",
  },
];

export function isServiceType(v: string | null | undefined): v is ServiceType {
  return !!v && SERVICE_TYPES.some((s) => s.key === v);
}

/** Where each service type's builder lives, matching NewQuoteMenu's six hrefs
 *  ("custom" is a system quote with a user-named category, #110). */
export const BUILDER_BASE: Record<ServiceType, string> = {
  system: "/estimator",
  custom: "/estimator",
  flame_test: "/flame-tests/quote",
  repair: "/repairs/quote",
  inspection: "/inspections/quote",
  consulting: "/design/engagements/quote",
  rental: "/rentals/quote",
};

export type BuilderPathOpts = {
  /** #110 — only sent for the "custom" type. */
  category?: string;
  /** #160 — optional quote name; blank → the builder's own auto-name. */
  name?: string;
  /** #160 — customer location id; never sent to rental (no venue concept). */
  venue?: string;
  /** #160 — contact NAME (contacts have no id). */
  contact?: string;
  /** #160 / D205 — the draft this new quote replaces (Change type). */
  replaces?: string;
};

/** The builder URL for a NEW quote, pre-seeded from the intake (#160). Each
 *  builder reads these back with readHandoff() and applies them to a new quote
 *  only. */
export function builderPath(type: ServiceType, customerId: string, opts: BuilderPathOpts = {}): string {
  const p = new URLSearchParams();
  const put = (k: string, v: string | undefined) => {
    const t = (v || "").trim();
    if (t) p.set(k, t);
  };
  put("customer", customerId);
  if (type === "custom") put("category", opts.category);
  put("name", opts.name);
  if (type !== "rental") put("venue", opts.venue);
  put("contact", opts.contact);
  put("replaces", opts.replaces);
  const qs = p.toString();
  return BUILDER_BASE[type] + (qs ? "?" + qs : "");
}

export type IntakeLocation = {
  id: string;
  label: string;
  city: string;
  state: string;
  primary: boolean;
};

export type IntakeContact = {
  name: string;
  role: string;
  primary: boolean;
};

/** Customer directory view-model handed to the client form — the same
 *  reduced shape estimator/page.tsx maps CustomerDoc into for CustomerLite. */
export type IntakeCustomer = {
  id: string;
  name: string;
  type: string;
  locations: IntakeLocation[];
  contacts: IntakeContact[];
};

/** The form's submit payload — a plain typed object (SaveCustomerInput's
 *  own convention), not FormData. */
export type IntakeSubmit = {
  type: ServiceType;
  /** User-named quote category — only read when `type` is "custom" (#110). */
  category?: string;
  /** #160 — optional quote name; "" → the builder's auto-name. */
  name: string;
  /** #160 / D205 — the draft this intake replaces ("Change type"); "" otherwise. */
  replaces: string;
  customerMode: "pick" | "new";
  customerId: string;
  newCustomerName: string;
  newCustomerType: string;
  locationMode: "pick" | "new" | "skip";
  locationId: string;
  newLocationLabel: string;
  newLocationCity: string;
  newLocationState: string;
  contactMode: "pick" | "new" | "skip";
  contactName: string;
  newContactName: string;
  newContactRole: string;
  newContactEmail: string;
  newContactPhone: string;
};
