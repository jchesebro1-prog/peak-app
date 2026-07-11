import type { CatalogPart } from "@/lib/stores/catalog";

/**
 * Master catalog seed — verbatim port of app/catalog-data.js MASTER_CATALOG
 * (every part, every list/cost). Document ids are the SKUs. A function to
 * match the seed convention (no relative dates here, but shape is uniform).
 */

export function catalogSeed(): CatalogPart[] {
  return [
    // ---- Fabrics (curtain configurator pulls these) ----
    { id: "RB-MV-MN", sku: "RB-MV-MN", desc: "25 oz Memorable Velour", category: "Fabric", unit: "sq ft", list: 6.40, cost: 4.20, mfr: "Rose Brand", costPerSqft: 4.20 },
    { id: "RB-MARVEL", sku: "RB-MARVEL", desc: "21 oz Marvel Velour", category: "Fabric", unit: "sq ft", list: 5.30, cost: 3.45, mfr: "Rose Brand", costPerSqft: 3.45 },
    { id: "RB-EN-16", sku: "RB-EN-16", desc: "16 oz Encore Velour", category: "Fabric", unit: "sq ft", list: 3.95, cost: 2.60, mfr: "Rose Brand", costPerSqft: 2.60 },
    { id: "RB-COM-16", sku: "RB-COM-16", desc: "16 oz Commando Cloth", category: "Fabric", unit: "sq ft", list: 3.20, cost: 2.10, mfr: "Rose Brand", costPerSqft: 2.10 },
    { id: "RB-SCRIM", sku: "RB-SCRIM", desc: "Sharkstooth Scrim", category: "Fabric", unit: "sq ft", list: 2.75, cost: 1.80, mfr: "Rose Brand", costPerSqft: 1.80 },
    { id: "RB-BOBNET", sku: "RB-BOBNET", desc: "Bobbinet, 30′ wide", category: "Fabric", unit: "sq ft", list: 3.60, cost: 2.35, mfr: "Rose Brand", costPerSqft: 2.35 },
    { id: "RB-MUS", sku: "RB-MUS", desc: "Seamless Muslin", category: "Fabric", unit: "sq ft", list: 1.70, cost: 1.10, mfr: "Rose Brand", costPerSqft: 1.10 },
    { id: "RB-POLY", sku: "RB-POLY", desc: "12 oz Poly Pop", category: "Fabric", unit: "sq ft", list: 2.10, cost: 1.35, mfr: "Rose Brand", costPerSqft: 1.35 },

    // ---- Labor & travel rates (the Labor configurator reads `cost` by SKU) ----
    // Per-discipline crew / overtime / supervisor, plus shared shop, engineering
    // and travel rates. Generic across scopes — discipline picks the rate set.
    { id: "RIG-LBR", sku: "RIG-LBR", desc: "Rigging — install labor", category: "Labor", unit: "hr", list: 75, cost: 50, discipline: "RIG", role: "labor" },
    { id: "RIG-OT", sku: "RIG-OT", desc: "Rigging — overtime labor", category: "Labor", unit: "hr", list: 110, cost: 75, discipline: "RIG", role: "ot" },
    { id: "RIG-SUP", sku: "RIG-SUP", desc: "Rigging — supervisor", category: "Labor", unit: "hr", list: 110, cost: 75, discipline: "RIG", role: "sup" },
    { id: "LIG-LBR", sku: "LIG-LBR", desc: "Lighting — install labor", category: "Labor", unit: "hr", list: 68, cost: 45, discipline: "LIG", role: "labor" },
    { id: "LIG-OT", sku: "LIG-OT", desc: "Lighting — overtime labor", category: "Labor", unit: "hr", list: 90, cost: 60, discipline: "LIG", role: "ot" },
    { id: "LIG-SUP", sku: "LIG-SUP", desc: "Lighting — supervisor", category: "Labor", unit: "hr", list: 110, cost: 75, discipline: "LIG", role: "sup" },
    { id: "AUD-LBR", sku: "AUD-LBR", desc: "Audio — install labor", category: "Labor", unit: "hr", list: 72, cost: 48, discipline: "AUD", role: "labor" },
    { id: "AUD-OT", sku: "AUD-OT", desc: "Audio — overtime labor", category: "Labor", unit: "hr", list: 105, cost: 70, discipline: "AUD", role: "ot" },
    { id: "AUD-SUP", sku: "AUD-SUP", desc: "Audio — supervisor", category: "Labor", unit: "hr", list: 108, cost: 72, discipline: "AUD", role: "sup" },
    { id: "VID-LBR", sku: "VID-LBR", desc: "Video — install labor", category: "Labor", unit: "hr", list: 72, cost: 48, discipline: "VID", role: "labor" },
    { id: "VID-OT", sku: "VID-OT", desc: "Video — overtime labor", category: "Labor", unit: "hr", list: 105, cost: 70, discipline: "VID", role: "ot" },
    { id: "VID-SUP", sku: "VID-SUP", desc: "Video — supervisor", category: "Labor", unit: "hr", list: 108, cost: 72, discipline: "VID", role: "sup" },
    { id: "SHP-PM", sku: "SHP-PM", desc: "Shop — project management", category: "Labor", unit: "hr", list: 135, cost: 90, role: "shop" },
    { id: "SHP-IN", sku: "SHP-IN", desc: "Shop — in-house fabrication", category: "Labor", unit: "hr", list: 60, cost: 40, role: "shop" },
    { id: "DRF-SUB", sku: "DRF-SUB", desc: "Engineering — drawings & submittals", category: "Labor", unit: "hr", list: 75, cost: 50, role: "shop" },
    { id: "TVL-MIL", sku: "TVL-MIL", desc: "Travel — vehicle mileage", category: "Labor", unit: "mi", list: 1, cost: 1, role: "travel" },
    { id: "TVL-HTL", sku: "TVL-HTL", desc: "Travel — lodging per room / night", category: "Labor", unit: "night", list: 140, cost: 140, role: "travel" },
    { id: "TVL-FOD", sku: "TVL-FOD", desc: "Travel — per diem / meals", category: "Labor", unit: "day", list: 70, cost: 70, role: "travel" },
    { id: "EQP-LIFT", sku: "EQP-LIFT", desc: "Equipment — lift rental", category: "Labor", unit: "ea", list: 750, cost: 750, role: "equip" },
  ];
}
