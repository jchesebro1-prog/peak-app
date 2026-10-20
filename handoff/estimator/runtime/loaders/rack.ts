/**
 * Estimator handoff — the rack sheets' loader: src/lib/rack/load.ts (loadRackForSheets) over the browser store. The
 * fixture read is fixtures-repo's getFixtureLocal, the catalog read readers.getManyLocal (renames followed), the
 * branding settingsView() (Peak as-is). Everything after the reads — rackPartInfo, rackSubmittal, rackDateLabel — is the
 * app's own pure code. Plan: PR 2 Task 9.
 */
import { fixtureSkus } from "@/lib/fixture-assemblies";
import type { LoadedRackSheets } from "@/lib/rack/load";
import { rackPartInfo } from "@/lib/rack/part-facts";
import { rackDateLabel } from "@/lib/rack/sheet-format";
import { rackSubmittal } from "@/lib/rack/submittal";
import type { RackPartInfo, RackPartLookup } from "@/lib/rack/types";
import type { Office } from "@/lib/settings";
import type { HandoffStore } from "../store";
import { clock, refreshPortsFromStore, settingsView } from "../ports";
import { getFixtureLocal } from "../fixtures-repo";
import { getManyLocal } from "../readers";

/** A saved rack's sheet data, or null when the id is missing, deleted or not a rack. */
export async function loadRackForSheetsLocal(store: HandoffStore, id: string, now: number = clock.now()): Promise<LoadedRackSheets | null> {
  if (!id) return null;
  await refreshPortsFromStore(store);
  const rec = await getFixtureLocal(store, id);
  if (!rec || rec.kind !== "rack") return null;
  const skus = fixtureSkus(rec);
  const parts = skus.length ? await getManyLocal(store, skus) : [];
  const settings = settingsView();
  const bySku = new Map(parts.map((p) => [p.sku, p] as const));
  // Every referenced SKU resolves: a SKU missing from the catalog is found:false; a Labor row resolves `internal`.
  const infos = new Map<string, RackPartInfo>(skus.map((sku) => [sku, rackPartInfo(bySku.get(sku), sku)] as const));
  const lookup: RackPartLookup = (sku) => infos.get(sku);
  return {
    rec,
    lookup,
    submittal: rackSubmittal(rec, lookup),
    dateLabel: rackDateLabel(now),
    now,
    company: { name: (settings.companyName as string) || "", logoDark: (settings.logoDark as string | null | undefined) ?? null, offices: (settings.offices as Office[]) || [] },
  };
}
