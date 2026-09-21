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
  | "rental";

/** Same six entries as the "+ New quote" split menu (quotes/controls.tsx) —
 *  label/sub-label/badge content ported verbatim so the picker on this
 *  screen reads identically to the menu that links here. */
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
];

export function isServiceType(v: string | null | undefined): v is ServiceType {
  return !!v && SERVICE_TYPES.some((s) => s.key === v);
}

/** Where each service type's builder lives, matching NewQuoteMenu's six hrefs. */
export function builderPath(type: ServiceType, customerId: string): string {
  const qs = customerId ? "?customer=" + encodeURIComponent(customerId) : "";
  switch (type) {
    case "system":
      return "/estimator" + qs;
    case "flame_test":
      return "/flame-tests/quote" + qs;
    case "repair":
      return "/repairs/quote" + qs;
    case "inspection":
      return "/inspections/quote" + qs;
    case "consulting":
      return "/design/engagements/quote" + qs;
    case "rental":
      return "/rentals/quote" + qs;
  }
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
