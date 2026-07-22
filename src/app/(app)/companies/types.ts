/**
 * Serializable view-models / action payloads shared across the server pages
 * and the client edit modal. Pure types — safe to import from either side.
 */

export type LocationInput = {
  id?: string;
  label: string;
  primary: boolean;
  address: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  venueKind: string;
  travelMiles: number | null;
  travelMin: number | null;
};

export type ContactInput = {
  name: string;
  role: string;
  email: string;
  phone: string;
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
};

/** A normalized address suggestion for the modal's live search dropdown. */
export type AddressHitVM = {
  title: string;
  sub: string;
  street: string;
  city: string;
  state: string;
  lat: number;
  lng: number;
};

/** Result of a Route lookup — real driving numbers to prefill the manual fields. */
export type RouteVM = {
  miles: number | null;
  minutes: number | null;
  officeName: string;
};
