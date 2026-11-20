/**
 * #122 — vendor rows (spec §2, §4). DB-backed: ONE catalog read, ONE profiles
 * read per call. The derivation itself is pure (lib/vendor-status.ts).
 */
import { list as listParts } from "@/lib/stores/catalog";
import { getSettings } from "@/lib/settings";
import { activeUsers } from "@/lib/users";
import { allVendorProfiles, blankProfile, vendorCompanies, type VendorProfile } from "@/lib/stores/vendors";
import {
  catalogEffectiveAtFor,
  manufacturerDirectory,
  newestList,
  partCountFor,
  resolveCatalogOwner,
  vendorStatus,
  type ManufacturerEntry,
  type PriceListEntry,
  type VendorStatusKey,
} from "@/lib/vendor-status";

export type VendorRow = {
  id: string;
  name: string;
  type: string;
  profile: VendorProfile;
  partCount: number;
  catalogEffectiveAt: number | null;
  lastList: PriceListEntry | null;
  status: VendorStatusKey;
};

export type VendorsData = {
  rows: VendorRow[];
  /** Every catalog manufacturer with its claim owner (name resolved). */
  directory: Array<ManufacturerEntry & { vendorName: string }>;
  /** Display name of the resolved catalog owner, null when nobody is active. */
  ownerName: string | null;
};

export async function loadVendors(onlyId?: string): Promise<VendorsData> {
  const [companies, profiles, parts, settings, users] = await Promise.all([
    vendorCompanies(),
    allVendorProfiles(),
    listParts(),
    getSettings(),
    activeUsers(),
  ]);
  const now = Date.now();
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const rows: VendorRow[] = companies
    .filter((c) => !onlyId || c.id === onlyId)
    .map((c) => {
      const profile = profileById.get(c.id) ?? blankProfile(c.id);
      const lastList = newestList(profile.priceLists);
      const catalogEffectiveAt = catalogEffectiveAtFor(parts, profile.manufacturers, settings);
      const status = vendorStatus({ lastList, catalogEffectiveAt, hasClaims: profile.manufacturers.length > 0, now });
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        profile,
        partCount: partCountFor(parts, profile.manufacturers),
        catalogEffectiveAt,
        lastList,
        status,
      };
    });
  // Only LIVE vendors own a manufacturer (#122 I1): nothing cascades from
  // softDeleteCompany to vendor_profiles, so a deleted vendor's claims would
  // otherwise keep the manufacturer out of the "Unclaimed manufacturers"
  // panel — hiding the one path that gives it back to a real vendor — and
  // label it with a raw id pointing at a /vendors/<id> that 404s.
  const live = profiles.filter((p) => nameById.has(p.id));
  const directory = manufacturerDirectory(parts, live).map((m) => ({
    ...m,
    vendorName: m.vendorId ? (nameById.get(m.vendorId) ?? m.vendorId) : "",
  }));
  const owner = resolveCatalogOwner(settings.catalogOwner, users);
  return { rows, directory, ownerName: owner?.name ?? null };
}
