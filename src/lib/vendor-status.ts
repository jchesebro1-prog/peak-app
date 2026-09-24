/**
 * #122 — vendor freshness, PURE and DB-free
 * (docs/superpowers/specs/2026-09-21-vendors-module-design.md §2).
 * Imported by the store, the server pages, the daily cron AND the client tab
 * components (types + status meta), so nothing here may reach a store, the
 * DB, or a "use client" module. Dates are epoch-ms.
 *
 * Catalog dating comes from the catalog spec (#133): `effectivePriceDate`,
 * `mfrKey`, `OUTDATED_AFTER_MS` in src/lib/catalog-books.ts.
 */
import { OUTDATED_AFTER_MS, effectivePriceDate, mfrKey } from "@/lib/catalog-books";
import { dateYear } from "@/lib/format";
import { isVendorType } from "@/lib/identity/config";

export type PriceListEntry = {
  id: string;
  receivedAt: number;
  effectiveAt: number;
  note: string;
  loggedBy: string;
};
export type VendorDiscounts = { note: string; percentOffList: number | null; terms: string };
export type VendorRegistration = { program: string; url: string; accountNumber: string; notes: string };

/** One catalog manufacturer (grouped by mfrKey) and which vendor claims it. */
export type ManufacturerEntry = { name: string; count: number; vendorId: string | null };

export const VENDOR_STATUS_KEYS = ["no-list", "no-claims", "newer-list", "outdated", "current"] as const;
export type VendorStatusKey = (typeof VENDOR_STATUS_KEYS)[number];

/** Chip colours follow the app's status-chip families (comms statusMeta). */
export const VENDOR_STATUS_META: Record<VendorStatusKey, { label: string; ink: string; soft: string; bd: string }> = {
  current: { label: "Current", ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
  "newer-list": { label: "Newer list received", ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  outdated: { label: "Outdated", ink: "#b4543a", soft: "#f8ece7", bd: "#eccfc4" },
  "no-list": { label: "No list logged", ink: "#8c919c", soft: "#f1f2f5", bd: "#e4e7ec" },
  "no-claims": { label: "No manufacturers claimed", ink: "#8c6b1f", soft: "#fbf3dd", bd: "#f0e2bd" },
};

/** Spec §1: the default catalog owner, by display name, when Settings has none. */
export const DEFAULT_CATALOG_OWNER_NAME = "Jena Tolksdorf";

/** The two fields this module reads off a part. Callers pass CatalogPart[]
 *  (assignable); fixtures pass literals. The cast at the effectivePriceDate
 *  call keeps this independent of how the catalog plan typed its parameter. */
export type DatedPart = { mfr?: string; pricedAt?: number };
type CatalogPartArg = Parameters<typeof effectivePriceDate>[0];
type SettingsLike = Parameters<typeof effectivePriceDate>[1];

export function newestList(lists: PriceListEntry[] | undefined): PriceListEntry | null {
  let best: PriceListEntry | null = null;
  for (const l of lists || []) if (!best || l.effectiveAt > best.effectiveAt) best = l;
  return best;
}

export function manufacturerKeySet(manufacturers: string[]): Set<string> {
  const keys = new Set<string>();
  for (const m of manufacturers) {
    const k = mfrKey(m);
    if (k) keys.add(k);
  }
  return keys;
}

/** Spec §2: `catalogEffectiveAt` = the NEWEST effectivePriceDate across parts
 *  whose mfrKey is one of the vendor's manufacturers (priceBooks() uses the
 *  oldest for the banner — different question). Null when nothing is dated. */
export function catalogEffectiveAtFor(parts: DatedPart[], manufacturers: string[], settings: SettingsLike): number | null {
  const keys = manufacturerKeySet(manufacturers);
  if (!keys.size) return null;
  let newest: number | null = null;
  for (const p of parts) {
    if (!keys.has(mfrKey(p.mfr || ""))) continue;
    const at = effectivePriceDate(p as CatalogPartArg, settings);
    if (at != null && (newest == null || at > newest)) newest = at;
  }
  return newest;
}

export function partCountFor(parts: Array<{ mfr?: string }>, manufacturers: string[]): number {
  const keys = manufacturerKeySet(manufacturers);
  if (!keys.size) return 0;
  let n = 0;
  for (const p of parts) if (keys.has(mfrKey(p.mfr || ""))) n++;
  return n;
}

export function vendorStatus(input: {
  lastList: PriceListEntry | null;
  catalogEffectiveAt: number | null;
  hasClaims?: boolean;
  now: number;
}): VendorStatusKey {
  const { lastList, catalogEffectiveAt, hasClaims = true, now } = input;
  if (!lastList) return "no-list";
  if (!hasClaims) return "no-claims";
  if (lastList.effectiveAt > (catalogEffectiveAt ?? 0)) return "newer-list";
  if (now - Math.max(lastList.effectiveAt, catalogEffectiveAt ?? 0) > OUTDATED_AFTER_MS) return "outdated";
  return "current";
}

export type VendorTaskSpec = { title: string; source: string };

/** The dedupe key ensureVendorAssignments() matches on (spec §2). */
export function vendorTaskSource(vendorId: string, status: VendorStatusKey, at: number): string {
  return `auto: vendor ${vendorId} ${status} ${at}`;
}

export function vendorTasks(
  status: VendorStatusKey,
  vendor: { id: string; name: string; lastList: PriceListEntry | null; catalogEffectiveAt: number | null }
): VendorTaskSpec | null {
  if (status === "newer-list" && vendor.lastList) {
    return {
      title: `Update catalog: ${vendor.name} price list effective ${dateYear(vendor.lastList.effectiveAt)}`,
      source: vendorTaskSource(vendor.id, status, vendor.lastList.effectiveAt),
    };
  }
  if (status === "outdated") {
    const at = Math.max(vendor.lastList?.effectiveAt ?? 0, vendor.catalogEffectiveAt ?? 0);
    return {
      title: `Request updated price list from ${vendor.name}`,
      source: vendorTaskSource(vendor.id, status, at),
    };
  }
  return null;
}

/** Spec §1: Settings pick if still active, else "Jena Tolksdorf", else the
 *  first active Admin, else null. Generic so UserRow and test fixtures both fit. */
export function resolveCatalogOwner<U extends { id: string; name: string; roles: string[]; status?: string }>(
  catalogOwner: { userId: string } | null | undefined,
  users: U[]
): U | null {
  const active = users.filter((u) => (u.status ?? "active") === "active");
  if (catalogOwner?.userId) {
    const hit = active.find((u) => u.id === catalogOwner.userId);
    if (hit) return hit;
  }
  const named = active.find((u) => u.name === DEFAULT_CATALOG_OWNER_NAME);
  if (named) return named;
  return active.find((u) => (u.roles || []).includes("Admin")) ?? null;
}

/** mfrKey → vendor id, over every profile's aliases. */
export function claimOwnerByKey(profiles: Array<{ id: string; manufacturers: string[] }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of profiles) {
    for (const m of p.manufacturers) {
      const k = mfrKey(m);
      if (k && !out.has(k)) out.set(k, p.id);
    }
  }
  return out;
}

/** Every catalog manufacturer (grouped by mfrKey, first spelling seen wins),
 *  with its claim owner; count-desc then name. Unbranded parts are skipped. */
export function manufacturerDirectory(
  parts: Array<{ mfr?: string }>,
  profiles: Array<{ id: string; manufacturers: string[] }>
): ManufacturerEntry[] {
  const owner = claimOwnerByKey(profiles);
  const by = new Map<string, { name: string; count: number }>();
  for (const p of parts) {
    const name = (p.mfr || "").trim();
    const key = mfrKey(name);
    if (!key) continue;
    const e = by.get(key);
    if (e) e.count += 1;
    else by.set(key, { name, count: 1 });
  }
  return [...by.entries()]
    .map(([key, e]) => ({ name: e.name, count: e.count, vendorId: owner.get(key) ?? null }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function unclaimedManufacturers(
  parts: Array<{ mfr?: string }>,
  profiles: Array<{ id: string; manufacturers: string[] }>
): ManufacturerEntry[] {
  return manufacturerDirectory(parts, profiles).filter((m) => !m.vendorId);
}

/** Inbox link sidebar (spec §3): the customer picker's optgroups. */
export function groupCompanyOptions(
  companies: Array<{ id: string; name: string; type: string }>
): Array<{ label: "Customers" | "Vendors"; options: Array<{ value: string; label: string }> }> {
  const sorted = companies
    .map((c) => ({ value: c.id, label: c.name, vendor: isVendorType(c.type) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const pick = (vendor: boolean) => sorted.filter((o) => o.vendor === vendor).map(({ value, label }) => ({ value, label }));
  return (
    [
      { label: "Customers" as const, options: pick(false) },
      { label: "Vendors" as const, options: pick(true) },
    ] as Array<{ label: "Customers" | "Vendors"; options: Array<{ value: string; label: string }> }>
  ).filter((g) => g.options.length > 0);
}
