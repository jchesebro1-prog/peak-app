import {
  getBlob,
  getDoc,
  listDocs,
  setBlob,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";
import { getSettings, type Office } from "@/lib/settings";
import { coordsOf, estimate, type TravelEstimate } from "@/lib/geo";
import { customersSeed } from "@/db/seeds/customers";

/**
 * CustomerStore — the SHARED, canonical customer directory. Server port of
 * app/customers.js (window.CustomerStore) over the "customers" collection.
 *
 * This is the single customer list every screen links against: Designs,
 * Quotes and Projects reference a customer by its stable `id` here and
 * resolve the display name, venues and travel from that id (so a rename
 * never breaks a link).
 *
 * - Keyed by stable `id` ('lakefront', 'northridge', …) — the prototype's
 *   localStorage key was rss_customer_dir_v1.
 * - Each customer carries structured `locations[]` (each one a venue), used
 *   to resolve a primary venue and compute travel from the nearest office
 *   (E3/E4). Offices come from app settings.
 * - The prototype's derived name -> locations[] cache (rss_customer_locs_v2)
 *   survives only as the setLocations() escape hatch for out-of-directory
 *   names, stored in the "customer_locs" blob; directory names resolve
 *   straight through resolveId (a superset of the old exact-name map hit).
 */

/* ---------------- record shapes ---------------- */

export type CustomerLocation = {
  id?: string;
  label?: string;
  primary: boolean;
  /** Street address (site visits / calendar invites, D76) — city/state stay
   *  the separate fields they always were. */
  address?: string;
  city?: string;
  state?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  venueKind: string;
  travelMiles: number | null;
  travelMin: number | null;
};

export type CustomerContact = {
  name: string;
  role: string;
  email: string;
  /** Phone number (site visits / calendar invites, D76). */
  phone?: string;
  primary: boolean;
};

export type CustomerDoc = {
  id: string;
  name: string;
  type: string;
  location: string;
  locations: CustomerLocation[];
  contacts: CustomerContact[];
  /**
   * Record metadata (D83, punch item 23 D/E). All optional: records written
   * before this change have none, and there is no way to reconstruct them.
   * `createdAt` is set once and never rewritten; `updatedAt` only moves when
   * the record's content actually changes, so it stays meaningful as a
   * "modified" date. `owner` is the stored account owner — the Customers
   * screen still falls back to deriving one from the newest quote/project
   * when this is unset.
   */
  createdAt?: number;
  updatedAt?: number;
  owner?: string;
};

/** The metadata keys stamped by the store, not by the edit form. */
const META_KEYS = ["createdAt", "updatedAt"] as const;

/** Loose authoring shapes (what Customers screen edit forms produce). */
export type CustomerLocationInput = {
  id?: string;
  label?: string;
  primary?: boolean;
  address?: string;
  city?: string;
  state?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  venueKind?: string;
  travelMiles?: number | string | null;
  travelMin?: number | string | null;
};

export type CustomerContactInput = {
  name?: string;
  role?: string;
  email?: string;
  phone?: string;
  primary?: boolean;
};

export type CustomerRecordInput = {
  id: string;
  name?: string;
  type?: string;
  location?: string;
  locations?: CustomerLocationInput[];
  contacts?: CustomerContactInput[];
  owner?: string;
};

const COLL = "customers" as const;

/** Legacy name -> locations[] cache blob (prototype rss_customer_locs_v2). */
const LEGACY_LOCS_BLOB = "customer_locs";

async function readLegacyMap(): Promise<Record<string, CustomerLocation[]>> {
  return getBlob<Record<string, CustomerLocation[]>>(LEGACY_LOCS_BLOB, {});
}

/** Travel origins — the prototype read window.AppSettings.offices(). */
async function offices(): Promise<Office[]> {
  const s = await getSettings();
  return Array.isArray(s.offices) ? s.offices : [];
}

/* ---------------- normalization ---------------- */

/**
 * Normalize an authoring record (from the Customers screen) down to the
 * directory shape — enough to link against and resolve venues/travel.
 * Exact port of the prototype's normalizeRecord.
 */
export function normalizeRecord(c: CustomerRecordInput): CustomerDoc {
  const locs: CustomerLocation[] = (c.locations || []).map((l) => ({
    id: l.id,
    label: l.label,
    primary: !!l.primary,
    address: (l.address || "").trim() || undefined,
    city: l.city,
    state: l.state,
    lat: l.lat,
    lng: l.lng,
    venueKind: l.venueKind || "proscenium",
    travelMiles:
      l.travelMiles === "" || l.travelMiles == null ? null : Number(l.travelMiles),
    travelMin: l.travelMin === "" || l.travelMin == null ? null : Number(l.travelMin),
  }));
  const prim = locs.find((l) => l.primary) || locs[0] || null;
  const location =
    c.location || (prim ? [prim.city, prim.state].filter(Boolean).join(", ") : "");
  const contacts: CustomerContact[] = (c.contacts || [])
    .filter(
      (ct): ct is CustomerContactInput & { name: string } =>
        !!ct && !!(ct.name || "").trim()
    )
    .map((ct) => ({
      name: ct.name,
      role: ct.role || "",
      email: ct.email || "",
      phone: (ct.phone || "").trim() || undefined,
      primary: !!ct.primary,
    }));
  if (contacts.length && !contacts.some((ct) => ct.primary)) contacts[0].primary = true;
  const doc: CustomerDoc = {
    id: c.id,
    name: c.name || "",
    type: c.type || "",
    location,
    locations: locs,
    contacts,
  };
  const owner = (c.owner || "").trim();
  if (owner) doc.owner = owner;
  return doc;
}

/**
 * Carry record metadata across a write. `normalizeRecord` rebuilds the doc from
 * form input, so without this every save would reset createdAt and drop a
 * stored owner the form didn't submit.
 *
 * `updatedAt` advances only when the content changed — the directory is written
 * on full-replace, and stamping unconditionally would make "modified" mean
 * "last time anything saved" for every customer at once.
 */
function stampMeta(next: CustomerDoc, prev: CustomerDoc | null, t: number): CustomerDoc {
  if (!prev) return { ...next, createdAt: t, updatedAt: t };
  const out: CustomerDoc = {
    ...next,
    createdAt: prev.createdAt ?? t,
    owner: next.owner ?? prev.owner,
  };
  const content = (d: CustomerDoc) => {
    const rest: Partial<CustomerDoc> = { ...d };
    for (const k of META_KEYS) delete rest[k];
    return JSON.stringify(rest);
  };
  out.updatedAt = content(out) === content(prev) ? (prev.updatedAt ?? t) : t;
  return out;
}

/* ---------------- canonical directory (id-keyed) ---------------- */

/** All customers, sorted by name (prototype's all()). */
export async function all(): Promise<CustomerDoc[]> {
  const list = await listDocs<CustomerDoc>(COLL);
  return list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}

export async function get(id: string | null | undefined): Promise<CustomerDoc | null> {
  return id ? getDoc<CustomerDoc>(COLL, id) : null;
}

/** Resolve an id OR a name down to the canonical id (null if unknown). */
export async function resolveId(
  idOrName: string | null | undefined
): Promise<string | null> {
  if (!idOrName) return null;
  const list = await listDocs<CustomerDoc>(COLL);
  if (list.some((c) => c.id === idOrName)) return idOrName;
  const s = String(idOrName).toLowerCase();
  const m = list.find((c) => (c.name || "").toLowerCase() === s);
  return m ? m.id : null;
}

/** Rename-safe display name for a customer id (''/null tolerant). */
export async function nameFor(id: string | null | undefined): Promise<string> {
  const c = await get(id);
  return c ? c.name : "";
}

export async function byName(
  name: string | null | undefined
): Promise<CustomerDoc | null> {
  if (!name) return null;
  const s = String(name).toLowerCase();
  const list = await listDocs<CustomerDoc>(COLL);
  return list.find((c) => (c.name || "").toLowerCase() === s) || null;
}

/**
 * Resolve {id, name} from either an id or a stored (possibly stale) name,
 * preferring the canonical record. Returns {id, name} — name falls back to
 * the passed string so out-of-directory customers still display.
 */
export async function resolve(
  idOrName: string | null | undefined,
  fallbackName?: string | null
): Promise<{ id: string | null; name: string }> {
  const id = (await resolveId(idOrName)) || (await resolveId(fallbackName));
  if (id) return { id, name: await nameFor(id) };
  return {
    id: null,
    name: fallbackName || (typeof idOrName === "string" ? idOrName : "") || "",
  };
}

/**
 * Replace the whole directory (the Customers screen pushes its live
 * authoring list here on mount + every save). Full-replace semantics:
 * records not in the new list are soft-deleted.
 */
export async function setDirectory(
  records: CustomerRecordInput[] | null | undefined
): Promise<void> {
  if (!Array.isArray(records)) return;
  const next = records.map(normalizeRecord).filter((c) => c.id);
  const existing = await listDocs<CustomerDoc>(COLL);
  const prevById = new Map(existing.map((c) => [c.id, c]));
  const keep = new Set(next.map((c) => c.id));
  const t = Date.now();
  for (const rec of next) {
    await upsertDoc(COLL, stampMeta(rec, prevById.get(rec.id) ?? null, t));
  }
  for (const old of existing) {
    if (!keep.has(old.id)) await softDeleteDoc(COLL, old.id);
  }
}

export async function upsert(
  record: CustomerRecordInput | null | undefined
): Promise<void> {
  if (!record || !record.id) return;
  const prev = await getDoc<CustomerDoc>(COLL, record.id);
  await upsertDoc(COLL, stampMeta(normalizeRecord(record), prev, Date.now()));
}

/**
 * Soft-delete a customer. (The prototype had no explicit remove — deletion
 * happened via setDirectory full replace; this is the direct equivalent for
 * a single record.)
 */
export async function remove(id: string | null | undefined): Promise<void> {
  if (!id) return;
  await softDeleteDoc(COLL, id);
}

/* ---------------- locations / venues ---------------- */

export async function locationsForId(
  id: string | null | undefined
): Promise<CustomerLocation[] | null> {
  const c = await get(id);
  return c ? c.locations || [] : null;
}

/** Back-compat: accepts an id OR a name. */
export async function locationsFor(
  idOrName: string | null | undefined
): Promise<CustomerLocation[] | null> {
  const id = await resolveId(idOrName);
  if (id) return locationsForId(id);
  if (!idOrName) return null;
  const map = await readLegacyMap();
  return map[idOrName] || null;
}

export async function locationById(
  id: string | null | undefined,
  locId?: string | null
): Promise<CustomerLocation | null> {
  const locs = (await locationsForId(id)) || [];
  const hit = locId ? locs.find((l) => l.id === locId) : undefined;
  return hit || primaryLoc(locs);
}

export function primaryLoc(
  locs: CustomerLocation[] | null | undefined
): CustomerLocation | null {
  const ls = locs || [];
  return ls.find((l) => l && l.primary) || ls[0] || null;
}

/* ---------------- contacts (the people a quote is "prepared for / attn") ---------------- */

export async function contactsForId(
  id: string | null | undefined
): Promise<CustomerContact[] | null> {
  const c = await get(id);
  return c ? c.contacts || [] : null;
}

export async function primaryContact(
  id: string | null | undefined
): Promise<CustomerContact | null> {
  const cs = (await contactsForId(id)) || [];
  return cs.find((c) => c.primary) || cs[0] || null;
}

export async function contactByName(
  id: string | null | undefined,
  name: string | null | undefined
): Promise<CustomerContact | null> {
  const cs = (await contactsForId(id)) || [];
  if (!name) return null;
  return cs.find((c) => c.name === name) || null;
}

/** Upsert just a customer's locations (legacy name-keyed cache). */
export async function setLocations(
  name: string | null | undefined,
  locs: CustomerLocation[] | null | undefined
): Promise<void> {
  if (!name) return;
  await setBlob(LEGACY_LOCS_BLOB, { [name]: locs || [] });
}

/* ---------------- travel ({miles, minutes, office, source} from nearest office) ---------------- */

export async function travelFor(
  locs: CustomerLocation[] | null | undefined
): Promise<TravelEstimate<Office> | null> {
  const l = primaryLoc(locs);
  if (!l) return null;
  const coords = coordsOf(l) || {};
  return estimate(await offices(), { ...l, ...coords });
}

/** Travel to a specific customer/venue by id (falls back to the primary venue). */
export async function travelForId(
  id: string | null | undefined,
  locId?: string | null
): Promise<TravelEstimate<Office> | null> {
  const l = await locationById(id, locId);
  if (!l) return null;
  const coords = coordsOf(l) || {};
  return estimate(await offices(), { ...l, ...coords });
}

export async function travelForName(
  name: string | null | undefined
): Promise<TravelEstimate<Office> | null> {
  const id = await resolveId(name);
  if (id) return travelForId(id);
  if (!name) return null;
  const map = await readLegacyMap();
  const locs = map[name];
  return locs ? travelFor(locs) : null;
}

/* ---------------- seed ---------------- */

export async function resetToSeed(): Promise<void> {
  await setDirectory(customersSeed());
}

/** Alias — the prototype's method is all(); list() reads better server-side. */
export { all as list };
