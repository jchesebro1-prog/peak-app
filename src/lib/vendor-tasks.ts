/**
 * #122 — vendor rows + the owner's Home Queue tasks (spec §2, §4). DB-backed:
 * ONE catalog read, ONE profiles read, one assignments read per call, so the
 * daily cron over every vendor is bounded. The derivation itself is pure
 * (lib/vendor-status.ts).
 */
import { list as listParts } from "@/lib/stores/catalog";
import { getSettings } from "@/lib/settings";
import { activeUsers } from "@/lib/users";
import { allAssignments, createAssignment, type Assignment } from "@/lib/stores/assignments";
import { allVendorProfiles, blankProfile, vendorCompanies, type VendorProfile } from "@/lib/stores/vendors";
import {
  catalogEffectiveAtFor,
  manufacturerDirectory,
  newestList,
  partCountFor,
  resolveCatalogOwner,
  vendorStatus,
  vendorTasks,
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
  /** Newest OPEN auto task for this vendor (any status key) — the list's
   *  "owner task" column and the detail header. */
  openTask: { id: string; title: string; assignee: string } | null;
};

export type VendorsData = {
  rows: VendorRow[];
  /** Every catalog manufacturer with its claim owner (name resolved). */
  directory: Array<ManufacturerEntry & { vendorName: string }>;
  /** Display name of the resolved catalog owner, null when nobody is active. */
  ownerName: string | null;
};

type Context = VendorsData & { assignments: Assignment[] };

const autoPrefix = (vendorId: string) => `auto: vendor ${vendorId} `;

async function loadContext(onlyId?: string): Promise<Context> {
  const [companies, profiles, parts, settings, assignments, users] = await Promise.all([
    vendorCompanies(),
    allVendorProfiles(),
    listParts(),
    getSettings(),
    allAssignments(),
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
      const status = vendorStatus({ lastList, catalogEffectiveAt, now });
      const open = assignments
        .filter((a) => !a.done && a.source.startsWith(autoPrefix(c.id)))
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        profile,
        partCount: partCountFor(parts, profile.manufacturers),
        catalogEffectiveAt,
        lastList,
        status,
        openTask: open ? { id: open.id, title: open.title, assignee: open.assignee } : null,
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
  return { rows, directory, ownerName: owner?.name ?? null, assignments };
}

export async function loadVendors(onlyId?: string): Promise<VendorsData> {
  const { rows, directory, ownerName } = await loadContext(onlyId);
  return { rows, directory, ownerName };
}

/**
 * Spec §2: zero or one task per vendor, created AT MOST ONCE per
 * `source` key ("auto: vendor <id> <status> <effectiveAt>") — skipped when
 * any assignment with that key exists, open OR done, so a completed task is
 * never re-opened and a second save never duplicates. Runs after a ledger
 * save (logPriceListAction) and inside the daily cron route.
 */
export async function ensureVendorAssignments(
  vendorId?: string,
  by = "Quartzite"
): Promise<{ checked: number; created: number; owner: string | null }> {
  const ctx = await loadContext(vendorId);
  const seen = new Set(ctx.assignments.map((a) => a.source));
  let created = 0;
  for (const r of ctx.rows) {
    const spec = vendorTasks(r.status, r);
    if (!spec || seen.has(spec.source) || !ctx.ownerName) continue;
    await createAssignment({
      title: spec.title,
      assignee: ctx.ownerName,
      createdBy: by,
      link: { kind: "company", id: r.id, label: r.name },
      source: spec.source,
    });
    seen.add(spec.source);
    created++;
  }
  return { checked: ctx.rows.length, created, owner: ctx.ownerName };
}
