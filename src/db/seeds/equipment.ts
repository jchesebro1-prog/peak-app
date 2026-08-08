import type { EquipmentItem } from "@/lib/stores/equipment-items";
import type { EquipmentLocation } from "@/lib/stores/equipment-locations";

/**
 * Rentals module demo fixtures (D129, no prototype ancestor) — a small,
 * representative gear book across the five equipment categories, seeded
 * across two locations so stock-by-location has something to show.
 */

export function equipmentLocationsSeed(): EquipmentLocation[] {
  return [
    { id: "loc-1", name: "Main Warehouse", address: "" },
    { id: "loc-2", name: "Job Trailer", address: "" },
  ];
}

export function equipmentItemsSeed(): EquipmentItem[] {
  return [
    { id: "eq-1", sku: "SPK-QSC-K12", name: "QSC K12.2 Speaker", category: "speakers", manufacturer: "QSC", dayRate: 45, weekRate: 180, monthRate: 500, active: true, stock: [{ locationId: "loc-1", qty: 8 }] },
    { id: "eq-2", sku: "MON-JBL-EON", name: "JBL EON Monitor", category: "monitors", manufacturer: "JBL", dayRate: 35, weekRate: 140, monthRate: 400, active: true, stock: [{ locationId: "loc-1", qty: 6 }] },
    { id: "eq-3", sku: "LT-CHV-ROGUE", name: "Chauvet Rogue R2 Wash", category: "lighting", manufacturer: "Chauvet Professional", dayRate: 60, weekRate: 240, monthRate: 700, active: true, stock: [{ locationId: "loc-1", qty: 12 }, { locationId: "loc-2", qty: 4 }] },
    { id: "eq-4", sku: "CON-YAM-CL5", name: "Yamaha CL5 Console", category: "consoles", manufacturer: "Yamaha", dayRate: 200, weekRate: 800, monthRate: 2200, active: true, stock: [{ locationId: "loc-1", qty: 2 }] },
    { id: "eq-5", sku: "IO-ETC-NET3", name: "ETC Net3 Gateway", category: "control-io", manufacturer: "ETC", dayRate: 25, weekRate: 100, monthRate: 280, active: true, stock: [{ locationId: "loc-1", qty: 4 }] },
  ];
}
