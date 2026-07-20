import { getBlob, setBlob } from "@/db/doc-store";
import { getSettings, type Office } from "@/lib/settings";
import { coordsOf, estimate, type TravelEstimate } from "@/lib/geo";
import { customersSeed } from "@/db/seeds/customers";
import {
  allCompanies,
  getCompany,
  saveCompany,
  softDeleteCompany,
} from "@/lib/identity/companies";
import {
  sitesForCompany,
  sitesForCompanies,
  saveSite,
  softDeleteSite,
  docLocId,
} from "@/lib/identity/sites";
import {
  contactsForCompany,
  contactsForCompanies,
  emailsFor,
  emailsForContacts,
  phonesFor,
  phonesForContacts,
  saveContact,
  softDeleteContact,
  setEmails,
  setPhones,
  displayName,
} from "@/lib/identity/contacts";
import { splitName } from "@/lib/identity/convert";
import { mintId } from "@/lib/identity/ids";
import { allUsers } from "@/lib/users";
import type {
  CompanyRow,
  ContactEmailRow,
  ContactPhoneRow,
  ContactRow,
  SiteRow,
} from "@/db/schema";
import { getDb } from "@/db";
import { contactEmails, contactPhones } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * CustomerStore — the directory seam, re-backed by the IDENTITY CORE
 * (Daylite parity Phase 1, D85). The public API and record shapes are the
 * prototype's (window.CustomerStore) and are preserved byte-compatibly, but
 * the data now lives in the relational companies/sites/contacts tables —
 * the "customers" doc collection is no longer written (its history remains
 * for rollback; the converter in lib/identity/convert.ts was its last
 * reader).
 *
 * Composition rules (D85):
 * - CustomerDoc.id            = companies.id (the old slugs, unchanged)
 * - CustomerLocation.id       = sites.legacyLocId ?? sites.id — so stored doc
 *   `locationId` values ('loc1', …) keep matching byte-for-byte
 * - CustomerContact           = contact row + its primary email/phone
 * - CustomerDoc.owner         = the owner user's display name
 *
 * Writes decompose through the same rules in reverse. The identity core is
 * server-authoritative — `customers` left the sync-push allowlists (§3.2).
 */

/* ---------------- record shapes (unchanged — the seam contract) ---------------- */

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
   * "modified" date. `owner` is the stored account owner — screens still
   * fall back to deriving one from the newest quote/project when unset.
   */
  createdAt?: number;
  updatedAt?: number;
  owner?: string;
  /** Company-level pricing tier — the FALLBACK (item 11/D87, §4.7); the
   *  authoritative tier lives on the person. Part of doc content so
   *  tier-only edits register as changes. */
  pricingTier?: string;
};

/** The metadata keys stamped by the store, not by the edit form. */
const META_KEYS = ["createdAt", "updatedAt"] as const;

/** Loose authoring shapes (what edit forms + the CSV importer produce). */
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
  pricingTier?: string | null;
};

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

/* ---------------- normalization (unchanged pure port) ---------------- */

/**
 * Normalize an authoring record down to the directory shape — enough to
 * link against and resolve venues/travel. Exact port of the prototype's
 * normalizeRecord.
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
  const tier = (c.pricingTier || "").trim();
  if (tier) doc.pricingTier = tier;
  return doc;
}

/* ---------------- composition (identity rows -> CustomerDoc) ---------------- */

function numOrStr(v: string | null): number | string | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) && v.trim() !== "" ? n : v;
}

function numOrNull(v: string | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function composeLocation(s: SiteRow): CustomerLocation {
  return {
    id: docLocId(s),
    label: s.name || undefined,
    primary: s.isPrimary,
    address: s.address ?? undefined,
    city: s.city ?? undefined,
    state: s.state ?? undefined,
    lat: numOrStr(s.lat),
    lng: numOrStr(s.lng),
    venueKind: s.venueKind || "proscenium",
    travelMiles: numOrNull(s.travelMiles),
    travelMin: numOrNull(s.travelMin),
  };
}

function composeContact(
  c: ContactRow,
  emails: ContactEmailRow[] | undefined,
  phones: ContactPhoneRow[] | undefined
): CustomerContact {
  const email = (emails ?? [])[0]?.email ?? "";
  const phone = (phones ?? [])[0]?.phone;
  return {
    name: displayName(c),
    role: c.title || "",
    email,
    phone: phone || undefined,
    primary: c.isPrimary,
  };
}

function composeDoc(
  co: CompanyRow,
  siteRows: SiteRow[],
  contactRows: ContactRow[],
  emailsBy: Map<string, ContactEmailRow[]>,
  phonesBy: Map<string, ContactPhoneRow[]>,
  ownerName: string | undefined
): CustomerDoc {
  const locations = siteRows.map(composeLocation);
  const contacts = contactRows.map((c) =>
    composeContact(c, emailsBy.get(c.id), phonesBy.get(c.id))
  );
  const prim = locations.find((l) => l.primary) || locations[0] || null;
  const location = prim
    ? [prim.city, prim.state].filter(Boolean).join(", ")
    : [co.city, co.state].filter(Boolean).join(", ");
  const doc: CustomerDoc = {
    id: co.id,
    name: co.name,
    type: co.type,
    location,
    locations,
    contacts,
    createdAt: co.createdAt,
    updatedAt: co.updatedAt,
  };
  if (ownerName) doc.owner = ownerName;
  if (co.pricingTier) doc.pricingTier = co.pricingTier;
  return doc;
}

async function ownerNames(): Promise<Map<string, string>> {
  const users = await allUsers();
  return new Map(users.map((u) => [u.id, u.name]));
}

/* ---------------- canonical directory (id-keyed) ---------------- */

/** All customers, sorted by name (prototype's all()). */
export async function all(): Promise<CustomerDoc[]> {
  const companies = await allCompanies();
  const ids = companies.map((c) => c.id);
  const [siteMap, contactMap, owners] = await Promise.all([
    sitesForCompanies(ids),
    contactsForCompanies(ids),
    ownerNames(),
  ]);
  const contactIds = [...contactMap.values()].flat().map((c) => c.id);
  const [emailsBy, phonesBy] = await Promise.all([
    emailsForContacts(contactIds),
    phonesForContacts(contactIds),
  ]);
  return companies.map((co) =>
    composeDoc(
      co,
      siteMap.get(co.id) ?? [],
      contactMap.get(co.id) ?? [],
      emailsBy,
      phonesBy,
      co.ownerUserId ? owners.get(co.ownerUserId) : undefined
    )
  );
}

export async function get(id: string | null | undefined): Promise<CustomerDoc | null> {
  if (!id) return null;
  const co = await getCompany(id);
  if (!co) return null;
  const [siteRows, contactRows, owners] = await Promise.all([
    sitesForCompany(co.id),
    contactsForCompany(co.id),
    ownerNames(),
  ]);
  const contactIds = contactRows.map((c) => c.id);
  const [emailsBy, phonesBy] = await Promise.all([
    emailsForContacts(contactIds),
    phonesForContacts(contactIds),
  ]);
  return composeDoc(
    co,
    siteRows,
    contactRows,
    emailsBy,
    phonesBy,
    co.ownerUserId ? owners.get(co.ownerUserId) : undefined
  );
}

/** Resolve an id OR a name down to the canonical id (null if unknown). */
export async function resolveId(
  idOrName: string | null | undefined
): Promise<string | null> {
  if (!idOrName) return null;
  const list = await allCompanies();
  if (list.some((c) => c.id === idOrName)) return idOrName;
  const s = String(idOrName).toLowerCase();
  const m = list.find((c) => (c.name || "").toLowerCase() === s);
  return m ? m.id : null;
}

/** Rename-safe display name for a customer id (''/null tolerant). */
export async function nameFor(id: string | null | undefined): Promise<string> {
  if (!id) return "";
  const co = await getCompany(id);
  return co ? co.name : "";
}

export async function byName(
  name: string | null | undefined
): Promise<CustomerDoc | null> {
  if (!name) return null;
  const s = String(name).toLowerCase();
  const list = await allCompanies();
  const m = list.find((c) => (c.name || "").toLowerCase() === s);
  return m ? get(m.id) : null;
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

/* ---------------- writes (decompose CustomerRecordInput -> identity rows) ---------------- */

function contentKey(d: CustomerDoc): string {
  const rest: Partial<CustomerDoc> = { ...d };
  for (const k of META_KEYS) delete rest[k];
  return JSON.stringify(rest);
}

async function userIdForName(name: string | undefined): Promise<string | null> {
  const n = (name || "").trim().toLowerCase();
  if (!n) return null;
  const users = await allUsers();
  return users.find((u) => u.name.toLowerCase() === n)?.id ?? null;
}

/**
 * Write one normalized record through to the identity tables.
 * Site matching: incoming location id against legacyLocId THEN site id;
 * unmatched incoming ids are treated as legacy ids so existing doc
 * references keep resolving. Contact matching: exact display name (the same
 * key the composition emits, and the only contact key legacy docs have).
 */
async function writeRecord(rec: CustomerDoc, prev: CustomerDoc | null): Promise<void> {
  const t = Date.now();
  const existingCo = await getCompany(rec.id);

  // D83 semantics: updatedAt only advances when content actually changed.
  if (prev && existingCo && contentKey(rec) === contentKey(prev)) return;

  const ownerUserId = rec.owner
    ? await userIdForName(rec.owner)
    : (existingCo?.ownerUserId ?? null);

  await saveCompany({
    id: rec.id,
    name: rec.name,
    type: rec.type,
    lifecycle: existingCo?.lifecycle ?? "none",
    keywords: existingCo?.keywords ?? [],
    website: existingCo?.website ?? null,
    mainPhone: existingCo?.mainPhone ?? null,
    address: existingCo?.address ?? null,
    city: existingCo?.city ?? null,
    state: existingCo?.state ?? null,
    zip: existingCo?.zip ?? null,
    pricingTier: rec.pricingTier ?? existingCo?.pricingTier ?? null,
    ownerUserId,
    referredByContactId: existingCo?.referredByContactId ?? null,
    createdAt: existingCo?.createdAt ?? t,
    updatedAt: t,
  });

  // ----- sites (full-replace within this record) -----
  const existingSites = await sitesForCompany(rec.id);
  const bySiteKey = new Map<string, SiteRow>();
  for (const s of existingSites) {
    if (s.legacyLocId) bySiteKey.set(s.legacyLocId, s);
    bySiteKey.set(s.id, s);
  }
  const keptSiteIds = new Set<string>();
  for (const loc of rec.locations) {
    const match = loc.id ? bySiteKey.get(loc.id) : undefined;
    const id = match?.id ?? mintId("st");
    keptSiteIds.add(id);
    await saveSite({
      id,
      companyId: rec.id,
      name: loc.label || "",
      // Unmatched incoming ids are legacy ids by definition — preserve them
      // so quotes/projects that stored them keep resolving.
      legacyLocId: match ? match.legacyLocId : (loc.id ?? null),
      isPrimary: !!loc.primary,
      address: loc.address ?? null,
      city: loc.city ?? null,
      state: loc.state ?? null,
      lat: loc.lat == null ? null : String(loc.lat),
      lng: loc.lng == null ? null : String(loc.lng),
      venueKind: loc.venueKind || "proscenium",
      travelMiles: loc.travelMiles == null ? null : String(loc.travelMiles),
      travelMin: loc.travelMin == null ? null : String(loc.travelMin),
      driveFolderId: match?.driveFolderId ?? null,
      createdAt: match?.createdAt ?? t,
      updatedAt: t,
    });
  }
  for (const s of existingSites) {
    if (!keptSiteIds.has(s.id)) await softDeleteSite(s.id);
  }

  // ----- contacts (full-replace within this record, matched by name) -----
  const existingContacts = await contactsForCompany(rec.id);
  const byContactName = new Map(existingContacts.map((c) => [displayName(c), c]));
  const keptContactIds = new Set<string>();
  for (const ct of rec.contacts) {
    const match = byContactName.get(ct.name);
    const id = match?.id ?? mintId("ct");
    keptContactIds.add(id);
    const { first, last } = match
      ? { first: match.firstName, last: match.lastName }
      : splitName(ct.name);
    await saveContact({
      id,
      firstName: first,
      lastName: last,
      homeCompanyId: rec.id,
      title: ct.role || "",
      pricingTier: match?.pricingTier ?? null,
      status: match?.status ?? "active",
      userId: match?.userId ?? null,
      ownerUserId: match?.ownerUserId ?? ownerUserId,
      isPrimary: !!ct.primary,
      createdAt: match?.createdAt ?? t,
      updatedAt: t,
    });
    // Email/phone carry the ONE value the legacy shape holds: upsert it as
    // the primary channel without disturbing extra channels added via the
    // People screens; blank means "not provided", never "clear".
    if ((ct.email || "").trim()) {
      const current = await emailsFor(id);
      if (!current.length) {
        await setEmails(id, [{ value: ct.email, label: "work", isPrimary: true }]);
      } else if (current[0].email !== ct.email.trim()) {
        const db = await getDb();
        await db
          .update(contactEmails)
          .set({ email: ct.email.trim() })
          .where(eq(contactEmails.id, current[0].id));
      }
    }
    const phone = (ct.phone || "").trim();
    if (phone) {
      const current = await phonesFor(id);
      if (!current.length) {
        await setPhones(id, [{ value: phone, label: "work", isPrimary: true }]);
      } else if (current[0].phone !== phone) {
        const db = await getDb();
        await db
          .update(contactPhones)
          .set({ phone })
          .where(eq(contactPhones.id, current[0].id));
      }
    }
  }
  for (const c of existingContacts) {
    if (!keptContactIds.has(c.id)) await softDeleteContact(c.id);
  }
}

/**
 * Replace the whole directory (legacy full-replace semantics — records not
 * in the new list are soft-deleted). Still used by resetToSeed and the CSV
 * import path.
 */
export async function setDirectory(
  records: CustomerRecordInput[] | null | undefined
): Promise<void> {
  if (!Array.isArray(records)) return;
  const next = records.map(normalizeRecord).filter((c) => c.id);
  const existing = await all();
  const prevById = new Map(existing.map((c) => [c.id, c]));
  const keep = new Set(next.map((c) => c.id));
  for (const rec of next) {
    await writeRecord(rec, prevById.get(rec.id) ?? null);
  }
  for (const old of existing) {
    if (!keep.has(old.id)) await softDeleteCompany(old.id);
  }
}

export async function upsert(
  record: CustomerRecordInput | null | undefined
): Promise<void> {
  if (!record || !record.id) return;
  const prev = await get(record.id);
  await writeRecord(normalizeRecord(record), prev);
}

/**
 * Soft-delete a customer (company + its sites; contacts keep the historical
 * home-company link but stop composing once the company is gone).
 */
export async function remove(id: string | null | undefined): Promise<void> {
  if (!id) return;
  await softDeleteCompany(id);
}

/* ---------------- locations / venues ---------------- */

export async function locationsForId(
  id: string | null | undefined
): Promise<CustomerLocation[] | null> {
  if (!id) return null;
  const co = await getCompany(id);
  if (!co) return null;
  const siteRows = await sitesForCompany(id);
  return siteRows.map(composeLocation);
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
  if (!id) return null;
  const siteRows = await sitesForCompany(id);
  const hit = locId
    ? siteRows.find((s) => s.legacyLocId === locId || s.id === locId)
    : undefined;
  if (hit) return composeLocation(hit);
  return primaryLoc(siteRows.map(composeLocation));
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
  if (!id) return null;
  const co = await getCompany(id);
  if (!co) return null;
  const rows = await contactsForCompany(id);
  const ids = rows.map((c) => c.id);
  const [emailsBy, phonesBy] = await Promise.all([
    emailsForContacts(ids),
    phonesForContacts(ids),
  ]);
  return rows.map((c) => composeContact(c, emailsBy.get(c.id), phonesBy.get(c.id)));
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
