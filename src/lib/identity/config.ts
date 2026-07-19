/**
 * Identity-core value lists (Daylite parity Phase 1, D85).
 * Configuration, not schema (spec §4.1) — these are picker options, and the
 * columns accept any string so the lists can grow without a migration.
 * Converted companies keep their prototype venue-segment `type` verbatim;
 * the §5.3 classification pass cleans types up when the Daylite import runs.
 */

/** Default company-type hints (spec §4.1). */
export const COMPANY_TYPES = [
  "district/school",
  "architect",
  "engineer or AV consultant",
  "general contractor",
  "electrical contractor",
  "dealer",
  "vendor/manufacturer",
  "house of worship",
  "municipal/civic",
  "other",
] as const;

/** Daylite's "category" as a lifecycle (spec §4.1). */
export const LIFECYCLES = ["prospect", "customer", "past", "none"] as const;
export type Lifecycle = (typeof LIFECYCLES)[number];

/** Replaces the "gone"-note convention (spec §4.2). */
export const CONTACT_STATUSES = ["active", "former", "do_not_contact"] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export const CONTACT_STATUS_LABEL: Record<ContactStatus, string> = {
  active: "Active",
  former: "Former",
  do_not_contact: "Do not contact",
};

/** Labels for contact emails/phones (Daylite has Mobile / Work / untitled). */
export const CHANNEL_LABELS = ["work", "mobile", "home", "other"] as const;

export const LIFECYCLE_LABEL: Record<Lifecycle, string> = {
  prospect: "Prospect",
  customer: "Customer",
  past: "Past",
  none: "—",
};
