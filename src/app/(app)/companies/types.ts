/**
 * Serializable view-models / action payloads shared across the server pages
 * and the client edit modal. Pure types — safe to import from either side.
 */

export type LocationInput = {
  id?: string;
  locationName?: string;
  label: string;
  primary: boolean;
  address: string;
  city: string;
  state: string;
  /** #137 — carried through so a modal / quick-add save never drops an
   *  imported zip or venue category (absent = preserve, see writeRecord).
   *  null = clear it (#216: a moved venue, applyVenueMoveRule). */
  zip?: string | null;
  kind?: string;
  lat: number | null;
  lng: number | null;
  venueKind: string;
  travelMiles: number | null;
  travelMin: number | null;
  /** #216 — true: ignore `label` and store the derived "Location — Type"
   *  name (new venue, or its location/type changed). Absent = keep label. */
  deriveName?: boolean;
};

export type ContactInput = {
  name: string;
  role: string;
  email: string;
  phone: string;
  /** #137 — mobile channel; absent = preserve. */
  mobile?: string;
  primary: boolean;
};

export type SaveCustomerInput = {
  /** present when editing an existing customer; omitted when creating. */
  id?: string;
  name: string;
  type: string;
  /** Company-level pricing tier — the fallback (item 11/D87); a person's own
   *  tier wins. Empty/undefined = Base. */
  pricingTier?: string | null;
  locations: LocationInput[];
  contacts: ContactInput[];
  /** #23 Details section. lifecycle ∈ LIFECYCLES (unknown → server ignores
   *  the field); keywords trimmed/deduped/capped server-side; custom keyed
   *  by CustomFieldDef.id and re-validated server-side against the live
   *  defs. All optional — absent means preserve. */
  lifecycle?: string;
  keywords?: string[];
  custom?: Record<string, string | number | boolean | null>;
};

/** A normalized address suggestion for the modal's live search dropdown. */
export type AddressHitVM = {
  title: string;
  sub: string;
  street: string;
  city: string;
  state: string;
  /** #216 — the hit's postcode ("" when Nominatim has none); the venue
   *  dialog sends it so a picked address saves its zip. */
  zip: string;
  lat: number;
  lng: number;
};

/** Result of a Route lookup — real driving numbers to prefill the manual fields. */
export type RouteVM = {
  miles: number | null;
  minutes: number | null;
  officeName: string;
};
