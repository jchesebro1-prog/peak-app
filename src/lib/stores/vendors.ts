import { getDoc, listDocs, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import type { CompanyRow } from "@/db/schema";
import { allCompanies, companyIdTaken, getCompany } from "@/lib/identity/companies";
import { VENDOR_COMPANY_TYPE, isVendorType } from "@/lib/identity/config";
import { upsert as upsertCustomer } from "@/lib/stores/customers";
import { mfrKey } from "@/lib/catalog-books";
import type { PriceListEntry, VendorDiscounts, VendorRegistration } from "@/lib/vendor-status";
export type { PriceListEntry, VendorDiscounts, VendorRegistration };

/* ============================================================
   Vendor profiles (#122) — docs/superpowers/specs/2026-09-21-vendors-module-design.md §1.
   A vendor IS a company (identity core, type === VENDOR_COMPANY_TYPE); this
   collection holds what the company row has no home for: the catalog
   manufacturer spellings the vendor supplies (aliases matched by mfrKey —
   one owner per manufacturer key), the price-list ledger (newest first),
   discount + project-registration notes, and a "contact for…" role per
   contact id. Document id = company id, so there is at most one profile
   per vendor and a vendor company with no profile yet reads as a blank.
   ============================================================ */

export type VendorProfile = {
  id: string; // company id
  manufacturers: string[]; // catalog `mfr` spellings this vendor supplies (aliases)
  priceLists: PriceListEntry[]; // newest first (by effectiveAt)
  discounts: VendorDiscounts;
  registration: VendorRegistration;
  contactRoles: Record<string, string>; // contactId → "what to contact them for"
  createdAt: number;
  updatedAt: number;
};

const now = () => Date.now();

function uid(p: string): string {
  return p + Math.random().toString(36).slice(2, 10);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function blankProfile(id: string, at: number = now()): VendorProfile {
  return {
    id,
    manufacturers: [],
    priceLists: [],
    discounts: { note: "", percentOffList: null, terms: "" },
    registration: { program: "", url: "", accountNumber: "", notes: "" },
    contactRoles: {},
    createdAt: at,
    updatedAt: at,
  };
}

function normalizeEntry(raw: unknown): PriceListEntry | null {
  const e = (raw && typeof raw === "object" ? raw : {}) as Partial<PriceListEntry>;
  const effectiveAt = numOrNull(e.effectiveAt);
  if (effectiveAt == null) return null;
  return {
    id: str(e.id) || uid("pl-"),
    receivedAt: numOrNull(e.receivedAt) ?? effectiveAt,
    effectiveAt,
    note: str(e.note),
    loggedBy: str(e.loggedBy),
  };
}

export function normalizeProfile(raw: Partial<VendorProfile> & { id: string }): VendorProfile {
  const base = blankProfile(raw.id, raw.createdAt ?? now());
  const d = (raw.discounts || {}) as Partial<VendorDiscounts>;
  const r = (raw.registration || {}) as Partial<VendorRegistration>;
  const priceLists = (Array.isArray(raw.priceLists) ? raw.priceLists : [])
    .map(normalizeEntry)
    .filter((e): e is PriceListEntry => !!e)
    .sort((a, b) => b.effectiveAt - a.effectiveAt || b.receivedAt - a.receivedAt);
  const seen = new Set<string>();
  const manufacturers = (Array.isArray(raw.manufacturers) ? raw.manufacturers : [])
    .map((m) => str(m).trim())
    .filter((m) => {
      const k = mfrKey(m);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const contactRoles: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.contactRoles || {})) {
    if (str(v).trim()) contactRoles[k] = str(v).trim();
  }
  return {
    ...base,
    manufacturers,
    priceLists,
    discounts: { note: str(d.note), percentOffList: numOrNull(d.percentOffList), terms: str(d.terms) },
    registration: {
      program: str(r.program),
      url: str(r.url),
      accountNumber: str(r.accountNumber),
      notes: str(r.notes),
    },
    contactRoles,
    createdAt: base.createdAt,
    updatedAt: raw.updatedAt ?? base.createdAt,
  };
}

/* ---------- reads ---------- */

export async function allVendorProfiles(): Promise<VendorProfile[]> {
  const rows = await listDocs<VendorProfile>("vendor_profiles");
  return rows.map(normalizeProfile);
}

/** The stored profile, or null — never mints a blank. */
export async function getVendorProfile(id: string): Promise<VendorProfile | null> {
  const doc = await getDoc<VendorProfile>("vendor_profiles", id);
  return doc ? normalizeProfile(doc) : null;
}

/** Stored profile, or an UNSAVED blank for a vendor company that has none yet. */
export async function vendorProfileFor(id: string): Promise<VendorProfile> {
  return (await getVendorProfile(id)) ?? blankProfile(id);
}

/** Companies of the vendor type (spec §1) — allCompanies() is name-sorted. */
export async function vendorCompanies(): Promise<CompanyRow[]> {
  return (await allCompanies()).filter((c) => isVendorType(c.type));
}

/** Is `id` a LIVE company of the vendor type? The scope check every
 *  vendor-record write runs first (`vendorOr()` in the vendors actions): a
 *  customer id must never reach the vendor_profiles collection, and a
 *  soft-deleted vendor is not writable either. */
export async function isVendorCompany(id: string): Promise<boolean> {
  const co = await getCompany(id);
  return !!co && isVendorType(co.type);
}

/** Which vendor owns a manufacturer (by mfrKey), or null. */
export async function vendorForManufacturer(mfr: string): Promise<string | null> {
  const key = mfrKey(mfr);
  if (!key) return null;
  const hit = (await allVendorProfiles()).find((p) => p.manufacturers.some((m) => mfrKey(m) === key));
  return hit ? hit.id : null;
}

/* ---------- writes ---------- */

async function writeProfile(next: VendorProfile): Promise<VendorProfile> {
  const doc = normalizeProfile({ ...next, updatedAt: now() });
  await upsertDoc<VendorProfile>("vendor_profiles", doc);
  return doc;
}

export async function saveVendorProfile(
  id: string,
  patch: Partial<Pick<VendorProfile, "discounts" | "registration" | "manufacturers" | "contactRoles">>
): Promise<VendorProfile> {
  const cur = await vendorProfileFor(id);
  return writeProfile({ ...cur, ...patch });
}

/** Append a ledger entry (spec §3 "Log price list"). Newest-first ordering is
 *  re-applied by normalizeProfile. */
export async function logPriceList(
  id: string,
  entry: { receivedAt: number; effectiveAt: number; note: string },
  loggedBy: string
): Promise<VendorProfile> {
  const cur = await vendorProfileFor(id);
  const rec: PriceListEntry = {
    id: uid("pl-"),
    receivedAt: entry.receivedAt,
    effectiveAt: entry.effectiveAt,
    note: (entry.note || "").trim(),
    loggedBy,
  };
  return writeProfile({ ...cur, priceLists: [rec, ...cur.priceLists] });
}

/** "Contact for…" per contact id; an empty role removes the entry. */
export async function setContactRole(id: string, contactId: string, role: string): Promise<VendorProfile> {
  const cur = await vendorProfileFor(id);
  const contactRoles = { ...cur.contactRoles };
  const r = (role || "").trim();
  if (r) contactRoles[contactId] = r;
  else delete contactRoles[contactId];
  return writeProfile({ ...cur, contactRoles });
}

/** A manufacturer belongs to at most one vendor — claiming MOVES it (spec §1).
 *  The spelling stored is the one claimed; matching is always by mfrKey. */
export async function claimManufacturer(vendorId: string, mfr: string): Promise<VendorProfile> {
  const spelling = (mfr || "").trim();
  const key = mfrKey(spelling);
  if (!key) throw new Error("Manufacturer name is empty.");
  const profiles = await allVendorProfiles();
  for (const p of profiles) {
    if (p.id === vendorId) continue;
    if (p.manufacturers.some((m) => mfrKey(m) === key)) {
      await writeProfile({ ...p, manufacturers: p.manufacturers.filter((m) => mfrKey(m) !== key) });
    }
  }
  const cur = profiles.find((p) => p.id === vendorId) ?? blankProfile(vendorId);
  if (cur.manufacturers.some((m) => mfrKey(m) === key)) return cur;
  return writeProfile({ ...cur, manufacturers: [...cur.manufacturers, spelling] });
}

export async function releaseManufacturer(vendorId: string, mfr: string): Promise<VendorProfile> {
  const key = mfrKey(mfr);
  const cur = await vendorProfileFor(vendorId);
  return writeProfile({ ...cur, manufacturers: cur.manufacturers.filter((m) => mfrKey(m) !== key) });
}

/**
 * New vendor company + its blank profile, through the customers seam (the
 * D85 write path: saveCompany, and — because PARTNER_TYPES carries the
 * vendor type — no base venue). Id = "v-" + mfrKey(name), suffixed only on
 * collision, so the seeded/claimed vendors get readable slugs.
 *
 * A slug is taken by ANY company row or profile document, soft-deleted
 * included (#122 C1): reusing a deleted vendor's slug would revive its
 * company row through saveCompany's upsert, soft-delete every contact and
 * site the empty lists below don't name, and — the unrecoverable part —
 * replace its profile document (ledger, claims, discounts, registration,
 * contact roles) with a blank. Hence a fresh id, and a blank profile written
 * only where none exists.
 */
export async function createVendorCompany(name: string): Promise<CompanyRow> {
  const clean = (name || "").trim();
  if (!clean) throw new Error("Vendor name is empty.");
  const base = mfrKey(clean) || "vendor";
  let id = "v-" + base;
  if ((await companyIdTaken(id)) || (await getVendorProfile(id))) {
    id = "v-" + base + "-" + Date.now().toString(36);
  }
  await upsertCustomer({ id, name: clean, type: VENDOR_COMPANY_TYPE, locations: [], contacts: [] });
  const co = await getCompany(id);
  if (!co) throw new Error("Vendor company was not created.");
  if (!(await getVendorProfile(id))) await writeProfile(blankProfile(id));
  return co;
}

/**
 * Soft delete the vendor PROFILE document (manufacturers/price lists/
 * discounts/registration/contactRoles) — NOT the vendor's underlying
 * company row (that's identity/companies.ts's softDeleteCompany, a
 * separate, already-existing delete). getVendorProfile/vendorProfileFor
 * already treat a missing doc as "blank" for a vendor with no profile yet,
 * so this is a well-defined, non-destructive-to-identity reset: the
 * company, its contacts and sites are untouched, and vendorForManufacturer
 * (allVendorProfiles → listDocs, tombstones excluded) correctly stops
 * finding any manufacturer this profile had claimed.
 */
export async function removeVendorProfile(id: string): Promise<void> {
  await softDeleteDoc("vendor_profiles", id);
}

/** The vendor company for a manufacturer name: an existing VENDOR whose
 *  name normalizes the same (mfrKey), else a new one named after it. */
export async function vendorCompanyNamed(mfr: string): Promise<CompanyRow> {
  const key = mfrKey(mfr);
  const hit = (await vendorCompanies()).find((c) => mfrKey(c.name) === key);
  return hit ?? createVendorCompany(mfr);
}
