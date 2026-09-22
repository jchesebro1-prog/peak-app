/**
 * #137 — pure link-back helpers shared by the contacts / venues importers,
 * the customers writer's legacy embedded columns, and the client preview.
 * No runtime store imports (the CustomerContact / CustomerLocation imports
 * are type-only and erased at compile time), so controls.tsx can run the
 * same resolution the server commit runs: the preview's "linked / will
 * create" column and the result banner agree by construction.
 */
import type { CustomerContact, CustomerLocation } from "@/lib/stores/customers";
import { norm } from "./parse";

export type CustomerRef = { id: string; name: string };

export type CustomerResolution =
  | { how: "id"; id: string; name: string }
  | { how: "name"; id: string; name: string }
  | { how: "create"; id: null; name: string }
  | { how: "missing"; id: null; name: "" };

function txt(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/**
 * Which customer a contacts / venues row belongs to: `Customer ID` exact
 * match → normalized-name match (case/punctuation-insensitive, the same
 * `norm` the dedupe uses) → create a customer from the name → missing when
 * the row carries neither. `cache` is whatever list the caller keeps for one
 * file — the server pushes newly created customers into it so later rows
 * link to the same record (D159).
 */
export function resolveCustomerForRow(
  row: { customerId?: unknown; customer?: unknown },
  cache: readonly CustomerRef[]
): CustomerResolution {
  const id = txt(row.customerId);
  if (id) {
    const hit = cache.find((c) => c.id === id);
    if (hit) return { how: "id", id: hit.id, name: hit.name };
  }
  const name = txt(row.customer);
  const key = norm(name);
  if (key) {
    const hit = cache.find((c) => norm(c.name) === key);
    if (hit) return { how: "name", id: hit.id, name: hit.name };
    return { how: "create", id: null, name };
  }
  return { how: "missing", id: null, name: "" };
}

/** The contacts template's `Primary` column. Anything else is "no". */
export function parseYesNo(v: unknown): boolean {
  const t = txt(v).toLowerCase();
  return t === "yes" || t === "y" || t === "true" || t === "1" || t === "x" || t === "primary";
}

/** Same rule the contacts dedupe uses: primary email first, then name. */
export function matchContact(
  contacts: readonly CustomerContact[],
  email: unknown,
  name: unknown
): CustomerContact | null {
  const e = txt(email).toLowerCase();
  if (e) {
    const hit = contacts.find((c) => (c.email || "").trim().toLowerCase() === e);
    if (hit) return hit;
  }
  const key = norm(name);
  if (!key) return null;
  return contacts.find((c) => norm(c.name) === key) ?? null;
}

/** Venue dedupe: normalized label. A blank label never matches anything. */
export function matchLocation(
  locations: readonly CustomerLocation[],
  label: unknown
): CustomerLocation | null {
  const key = norm(label);
  if (!key) return null;
  return locations.find((l) => norm(l.label) === key) ?? null;
}

export type ContactPatch = {
  name: string;
  email?: string;
  phone?: string;
  mobile?: string;
  title?: string;
  /** true → becomes the record's primary (others demoted); false/undefined
   *  → flags are left alone, except that the first contact on a record is
   *  always primary. */
  primary?: boolean;
};

/**
 * Upsert one contact into a record's contacts (returns a new array; the
 * input is never mutated). A hit keeps its STORED name: writeRecord matches
 * contacts by display name, so renaming here would mint a second row.
 * Blank incoming fields never clear stored ones.
 */
export function mergeContact(
  contacts: readonly CustomerContact[],
  incoming: ContactPatch
): { contacts: CustomerContact[]; created: boolean } {
  const list = contacts.map((c) => ({ ...c }));
  const hit = matchContact(list, incoming.email, incoming.name);
  const or = (next: string | undefined, prev: string | undefined) => txt(next) || prev || "";
  const makePrimary = incoming.primary === true || (!hit && list.length === 0);
  if (makePrimary) for (const c of list) c.primary = false;
  if (hit) {
    hit.role = or(incoming.title, hit.role);
    hit.email = or(incoming.email, hit.email);
    hit.phone = or(incoming.phone, hit.phone) || undefined;
    hit.mobile = or(incoming.mobile, hit.mobile) || undefined;
    if (makePrimary) hit.primary = true;
    return { contacts: list, created: false };
  }
  list.push({
    name: txt(incoming.name),
    role: txt(incoming.title),
    email: txt(incoming.email),
    phone: txt(incoming.phone) || undefined,
    mobile: txt(incoming.mobile) || undefined,
    primary: makePrimary,
  });
  return { contacts: list, created: true };
}

export type LocationPatch = {
  label: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  kind?: string;
};

export type MergeLocationOpts = {
  /** customers file: a row with no Venue column addresses the primary venue
   *  (or the first one) instead of appending. */
  preferPrimary: boolean;
  /** venueKind for a venue this merge CREATES; default derives from `kind`. */
  venueKind?: string;
};

/**
 * Upsert one venue into a record's locations (new array, input untouched):
 * normalized-label match → a labelled row claims the unnamed D85 base venue
 * (so the first imported venue fills it instead of leaving an empty twin) →
 * a `preferPrimary` row without a label merges into the primary venue →
 * append. Blank incoming fields never clear stored ones; an existing venue
 * keeps its venueKind, lat/lng and travel figures.
 */
export function mergeLocation(
  locations: readonly CustomerLocation[],
  incoming: LocationPatch,
  newId: string,
  opts: MergeLocationOpts
): { locations: CustomerLocation[]; created: boolean } {
  const list = locations.map((l) => ({ ...l }));
  const label = txt(incoming.label);
  let hit: CustomerLocation | null = matchLocation(list, label);
  if (!hit && label) hit = list.find((l) => !norm(l.label)) ?? null;
  if (!hit && !label && opts.preferPrimary) hit = list.find((l) => l.primary) ?? list[0] ?? null;
  const or = (next: string | undefined, prev: string | undefined) => txt(next) || prev;
  if (hit) {
    if (label) hit.label = label;
    hit.address = or(incoming.address, hit.address);
    hit.city = or(incoming.city, hit.city);
    hit.state = or(incoming.state, hit.state);
    hit.zip = or(incoming.zip, hit.zip);
    hit.kind = or(incoming.kind, hit.kind);
    return { locations: list, created: false };
  }
  list.push({
    id: newId,
    label,
    primary: list.length === 0,
    address: txt(incoming.address) || undefined,
    city: txt(incoming.city) || undefined,
    state: txt(incoming.state) || undefined,
    zip: txt(incoming.zip) || undefined,
    kind: txt(incoming.kind) || undefined,
    venueKind: txt(opts.venueKind) || venueKindFromCategory(incoming.kind),
    travelMiles: null,
    travelMin: null,
  });
  return { locations: list, created: true };
}

/** The controlled venueKind (companies/lib.ts VENUE_KINDS) a free-text
 *  venue Category implies — used only for venues the import CREATES. */
export function venueKindFromCategory(category: unknown): string {
  const c = txt(category).toLowerCase();
  if (!c) return "proscenium";
  if (/church|worship|sanctuary|chapel|parish|cathedral|temple|synagogue/.test(c)) return "church";
  if (/black\s*box|studio/.test(c)) return "blackbox";
  if (/arena|stadium|field\s*house|open\s*floor/.test(c)) return "arena";
  if (/flat|conference|ballroom|cafeteria|gym|commons|multi/.test(c)) return "flat";
  return "proscenium";
}

export type RowLink = { how: "id" | "name" | "create" | "missing" | "skip"; name: string };

/**
 * The preview's Customer column + "will create N customers" list, computed
 * the way the commit will resolve them: rows that create a customer are
 * remembered for the rest of the file, so a second row for the same new
 * name shows "will create" but is counted once. Invalid rows are skipped.
 */
export function previewLinks(
  rows: ReadonlyArray<{ values: Record<string, string | number>; valid: boolean }>,
  index: readonly CustomerRef[]
): { links: RowLink[]; willCreate: string[] } {
  const pending: CustomerRef[] = [];
  const willCreate: string[] = [];
  const links = rows.map((r): RowLink => {
    if (!r.valid) return { how: "skip", name: "" };
    const res = resolveCustomerForRow(
      { customerId: r.values.customerId, customer: r.values.customer },
      [...index, ...pending]
    );
    if (res.how === "create") {
      pending.push({ id: "", name: res.name });
      willCreate.push(res.name);
      return { how: "create", name: res.name };
    }
    if (res.how === "name" && res.id === "") return { how: "create", name: res.name };
    return { how: res.how, name: res.name };
  });
  return { links, willCreate };
}
