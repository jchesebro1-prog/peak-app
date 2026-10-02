/**
 * #296 — the one server loader for the printed rack sheets (the signed print
 * route, the staff preview and Task 12's zip). SERVER ONLY (reads stores and
 * settings): never import from a client component.
 */
import { fixtureSkus, type FixtureRecord } from "@/lib/fixture-assemblies";
import { getSettings } from "@/lib/settings";
import { getMany } from "@/lib/stores/catalog";
import { getFixture } from "@/lib/stores/fixtures";
import type { Office } from "@/lib/settings";
import { rackPartInfo } from "./part-facts";
import { rackDateLabel } from "./sheet-format";
import { rackSubmittal, type RackSubmittal } from "./submittal";
import type { RackPartInfo, RackPartLookup } from "./types";

/** Branding the sheets print: Settings → Branding, the same source the letters and cut sheets read. */
export type RackSheetCompany = { name: string; logoDark: string | null; offices: Office[] };

export type LoadedRackSheets = {
  rec: FixtureRecord;
  lookup: RackPartLookup;
  submittal: RackSubmittal;
  /** Today in America/Chicago, e.g. "Oct 2, 2026". */
  dateLabel: string;
  /** The clock read behind `dateLabel` (the title block formats its own date from it). */
  now: number;
  company: RackSheetCompany;
};

/** A saved rack's sheet data, or null when the id is missing, deleted or not a rack. */
export async function loadRackForSheets(id: string, now: number = Date.now()): Promise<LoadedRackSheets | null> {
  if (!id) return null;
  const rec = await getFixture(id);
  if (!rec || rec.kind !== "rack") return null;
  const skus = fixtureSkus(rec);
  const [parts, settings] = await Promise.all([skus.length ? getMany(skus) : Promise.resolve([]), getSettings()]);
  const bySku = new Map(parts.map((p) => [p.sku, p] as const));
  // Every referenced SKU resolves: a SKU missing from the catalog is found:false.
  // The catalog row carries its `category`, so a Labor row resolves `internal` (left out of totals/datasheets).
  const infos = new Map<string, RackPartInfo>(skus.map((sku) => [sku, rackPartInfo(bySku.get(sku), sku)] as const));
  const lookup: RackPartLookup = (sku) => infos.get(sku);
  return {
    rec,
    lookup,
    submittal: rackSubmittal(rec, lookup),
    dateLabel: rackDateLabel(now),
    now,
    company: { name: settings.companyName || "", logoDark: settings.logoDark ?? null, offices: settings.offices || [] },
  };
}
