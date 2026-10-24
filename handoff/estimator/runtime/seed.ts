/**
 * Estimator handoff — typed, read-only access to the slice's `data/*.js` globals
 * (written by handoff/estimator/slice.ts). Each getter returns an empty value when its
 * global is absent (no slice built yet), so the app still mounts.
 *
 *   data/rules.js      window.PEAK_RULES      { settings, blobs }
 *   data/team.js       window.PEAK_TEAM       the roster: active users (no contact details) and inactive ones as
 *                                             { id, name, roles, status } only (names still resolve)
 *   data/customers.js  window.PEAK_CUSTOMERS  companies / sites / contacts the estimates reference
 *   data/fixtures.js   window.PEAK_FIXTURES   fixture / System / Hardware / rack records
 *   data/catalog-N.js  window.PEAK_CATALOG    catalog parts (pushed chunk by chunk)
 *   data/estimates.js  window.PEAK_ESTIMATES  system estimates (allow-listed quote fields)
 *   data/meta.js       window.PEAK_META       export time, slice version, counts
 */
import type { Quote } from "@/lib/stores/quotes";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { FixtureRecord } from "@/lib/fixture-assemblies";
import type { PaymentTerms } from "@/lib/estimating-core/types";

type Row = Record<string, unknown>;

/** A quote's `spec` subdoc as the Estimator stores it (the store types it `unknown`). */
export type SeedSpec = { sections?: unknown[]; groups?: unknown; document?: unknown };
/** A sliced quote: only slice-rules.ts QUOTE_FIELDS survive, so every field is optional but the id. */
export type SeedEstimate = Omit<Partial<Quote>, "spec"> & { id: string; spec?: SeedSpec; paymentTerms?: PaymentTerms };
/** A sliced catalog part (slice-rules.ts CATALOG_FIELDS) — `id` is the doc id (the sku). */
export type SeedPart = Partial<CatalogPart> & { id: string; sku?: string };
export type SeedFixture = Partial<FixtureRecord> & { id: string };
export type SeedRules = { settings: Row; blobs: Record<string, unknown> };
export type SeedTeamUser = { id: string; name: string; roles?: string[]; status?: string; title?: string; initials?: string; color?: string };
export type SeedCompany = Row & { id: string; name?: string; pricingTier?: string | null };
export type SeedSite = Row & { id: string; companyId?: string; name?: string; locationName?: string; city?: string; isPrimary?: boolean };
export type SeedContact = Row & { id: string; firstName?: string; lastName?: string; homeCompanyId?: string; title?: string; isPrimary?: boolean };
export type SeedCustomers = {
  companies: SeedCompany[];
  sites: SeedSite[];
  contacts: SeedContact[];
  contactEmails: Row[];
  contactPhones: Row[];
  geoCache: Array<{ key: string; data?: Row }>;
};
export type SeedMeta = {
  exportedAt: string | null;
  source: string | null;
  sliceVersion: number | null;
  counts: Record<string, number>;
};

type PeakGlobals = {
  PEAK_RULES?: Partial<SeedRules>;
  PEAK_TEAM?: SeedTeamUser[];
  PEAK_CUSTOMERS?: Partial<SeedCustomers>;
  PEAK_FIXTURES?: SeedFixture[];
  PEAK_CATALOG?: SeedPart[];
  PEAK_ESTIMATES?: SeedEstimate[];
  PEAK_META?: Partial<SeedMeta>;
};

const g = (): PeakGlobals => (typeof window === "undefined" ? {} : (window as unknown as PeakGlobals));
const arr = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);

export function seedCatalog(): SeedPart[] {
  return arr(g().PEAK_CATALOG);
}

export function seedRules(): SeedRules {
  const r = g().PEAK_RULES;
  return { settings: r?.settings ?? {}, blobs: r?.blobs ?? {} };
}

export function seedEstimates(): SeedEstimate[] {
  return arr(g().PEAK_ESTIMATES);
}

export function seedCustomers(): SeedCustomers {
  const c = g().PEAK_CUSTOMERS;
  return {
    companies: arr(c?.companies),
    sites: arr(c?.sites),
    contacts: arr(c?.contacts),
    contactEmails: arr(c?.contactEmails),
    contactPhones: arr(c?.contactPhones),
    geoCache: arr(c?.geoCache),
  };
}

export function seedTeam(): SeedTeamUser[] {
  return arr(g().PEAK_TEAM);
}

export function seedFixtures(): SeedFixture[] {
  return arr(g().PEAK_FIXTURES);
}

export function seedMeta(): SeedMeta {
  const m = g().PEAK_META;
  return { exportedAt: m?.exportedAt ?? null, source: m?.source ?? null, sliceVersion: m?.sliceVersion ?? null, counts: m?.counts ?? {} };
}
