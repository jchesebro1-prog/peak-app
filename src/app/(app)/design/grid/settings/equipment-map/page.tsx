import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getMany } from "@/lib/stores/catalog";
import { listFixtures } from "@/lib/stores/fixtures";
import { getCatalogRates } from "@/lib/stores/pricing";
import { getEquipmentMap } from "@/lib/stores/equipment-map";
import { mapSkus } from "@/lib/design/equipment-map";
import { EQUIPMENT_ROWS } from "@/lib/design/equipment-vocab";
import { LEGACY_HINTS, legacyHintSkus, legacyHintText } from "@/lib/design/equipment-legacy-hints";
import { assemblyOptions, equipmentMapView, mapSummary } from "@/lib/design/equipment-map-view";
import { fixtureSkus } from "@/lib/fixture-assemblies";
import { GridSettingsTabs } from "../settings-tabs";
import EquipmentMapClient from "./equipment-map-client";

export const metadata = { title: "Equipment map — Grid settings — Quartzite-6" };
export const dynamic = "force-dynamic";
/** listFixtures() can run #210's one-time conversion on its first read (15 s budget). */
export const maxDuration = 60;

/**
 * Grid Settings → Equipment map (#GEM, spec §3). Every equation item × tier
 * → catalog part / assembly / confirmed allowance. Admin-only (manage_users —
 * the Estimating Rules gate). Read-only on load: nothing here writes. Reads
 * the map, every fixture/system, and ONLY the catalog SKUs they reference
 * (one getMany) — never the whole book.
 */
export default async function EquipmentMapPage() {
  const user = await requireUser();
  if (!can("manage_users", user.roles)) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", marginBottom: 20 }}>Equipment map</div>
        <div className="pk-card" style={{ padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            The Equipment map decides what Auto designs are priced with, so it is limited to admins (same as Estimating Rules).
            If a design says an item needs a part, ask an admin to map it here.
          </div>
        </div>
      </div>
    );
  }

  const [map, fixtureList, rates] = await Promise.all([getEquipmentMap(), listFixtures(), getCatalogRates()]);
  const fixtures = new Map(fixtureList.map((f) => [f.id, f]));
  const skus = new Set(mapSkus(map, fixtures));
  for (const f of fixtureList) for (const sku of fixtureSkus(f)) skus.add(sku);
  const parts = new Map((skus.size ? await getMany([...skus]) : []).map((p) => [p.sku, p]));
  const ctx = { parts, fixtures, margin: rates.defaultMargin };
  const hints = Object.fromEntries(
    EQUIPMENT_ROWS.map((r) => [r.key, { text: legacyHintText(LEGACY_HINTS[r.key]), skus: legacyHintSkus(LEGACY_HINTS[r.key]) }])
  );
  const rows = equipmentMapView(map, ctx, hints);

  return (
    <div className="pk-content" style={{ maxWidth: 1080 }}>
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>Grid settings</div>
      <div style={{ fontSize: 13.5, color: "#8c919c", margin: "4px 0 14px" }}>
        What Auto designs are priced with — every equation item, per tier, from the catalog.
      </div>
      <GridSettingsTabs active="equipment" />
      <EquipmentMapClient rows={rows} assemblies={assemblyOptions(fixtureList, ctx)} summary={mapSummary(rows)} />
    </div>
  );
}
