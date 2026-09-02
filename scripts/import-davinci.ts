/** Import the reviewed DaVinci catalog export into catalog_parts. */
import { readFileSync } from "node:fs";
import { getDb } from "../src/db";
import { get, mergeUpsert, type CatalogPart } from "../src/lib/stores/catalog";
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";

type ExportPart = Record<string, unknown> & { id: string; sku: string; desc: string; category: string };

async function main() {
  const file = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!file) throw new Error("usage: npm run davinci:import -- <exports/catalog.json> --yes");
  const { hosted } = resolveDbTarget("DaVinci catalog import");
  requireHostedConfirmation(hosted, process.argv);
  const parts = JSON.parse(readFileSync(file, "utf8")) as ExportPart[];
  await getDb();
  let inserted = 0; let updated = 0; let pricingReview = 0;
  for (const part of parts) {
    const sku = part.sku || part.id;
    const existing = await get(sku);
    const patch: Record<string, unknown> = {
      desc: part.desc, category: part.category || "Unmapped / DaVinci", unit: part.unit || "EA",
      mfr: part.manufacturer || "ETC", source: part.source, ports: part.ports,
      resources: part.resources, properties: part.properties, accessories: part.accessories,
      visual: part.visual, pricingStatus: part.pricingStatus || "missing",
    };
    for (const key of Object.keys(patch)) if (patch[key] === undefined) delete patch[key];
    if (!existing) { patch.list = part.list ?? null; patch.cost = part.cost ?? null; }
    if (part.pricingStatus === "missing") { patch.note = existing?.note || "DaVinci import — pricing review required"; pricingReview++; }
    await mergeUpsert(sku, patch as Partial<Omit<CatalogPart, "id" | "sku">>);
    if (existing) updated++; else inserted++;
    if ((inserted + updated) % 250 === 0) console.log(`  …${inserted + updated}/${parts.length}`);
  }
  console.log(`DaVinci import complete: ${inserted} inserted, ${updated} updated, ${pricingReview} pricing-review rows.`);
}
main().catch((error) => { console.error(error); process.exit(1); });
