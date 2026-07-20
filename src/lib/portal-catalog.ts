import { list as allParts, type CatalogPart } from "@/lib/stores/catalog";

/**
 * Customer-facing catalog slice (IDEAS #48 — self-serve equipment picker).
 *
 * The full catalog (~10k parts) is an internal tool: it mixes sellable stage
 * equipment with raw components, AV-rack hardware, and internal accessories,
 * and every row carries Peak's cost. This module exposes only the curated,
 * customer-appropriate categories, and only the fields a customer may see —
 * NEVER cost or margin. It also drops rows flagged "verify price" (unconfirmed
 * pricing shouldn't be quoted to a customer) and rows with no list price.
 *
 * Both the estimate page (to populate the picker) and submitPortalEstimate (to
 * validate what a customer submitted) derive "is this customer-buyable?" from
 * CUSTOMER_CATEGORIES here — a customer can never add an off-list SKU.
 */

/** Categories a customer may browse/buy. Everything else is internal-only. */
export const CUSTOMER_CATEGORIES: readonly string[] = [
  "Manual Hoist",
  "Motorized Hoist",
  "Loftblocks",
  "Headblocks",
  "Mule Block",
  "Floor Block",
  "Arbor",
  "Standard Arbor",
  "Front Arbor",
  "Shoes",
  "Rope Lock",
  "Track",
  "Pipe",
  "Fixtures",
  "Lamp",
  "Cable",
  "Cable Assemblies",
  "Connectors",
  "Atmospherics",
  "Hardware",
];
const ALLOWED = new Set(CUSTOMER_CATEGORIES);

/** A catalog part as the customer sees it — LIST price only, no cost/margin. */
export type CustomerPart = {
  sku: string;
  desc: string;
  category: string;
  unit: string;
  list: number;
};

function buyable(p: CatalogPart): boolean {
  return (
    ALLOWED.has(p.category) &&
    !p.note && // unconfirmed pricing — don't quote it to a customer
    typeof p.list === "number" &&
    p.list > 0
  );
}

/**
 * The curated, client-safe catalog for the portal picker.
 * With a tier margin (item 11 D, D88) the customer price is RE-DERIVED from
 * cost at that margin (cost ÷ (1 − m)); parts without a cost keep list.
 * Still list-only fields client-side — no cost or margin crosses over.
 */
export async function customerCatalog(margin?: number | null): Promise<CustomerPart[]> {
  const parts = await allParts();
  const m = margin != null && margin > 0 && margin < 1 ? margin : null;
  return parts
    .filter(buyable)
    .map((p) => ({
      sku: p.sku,
      desc: p.desc,
      category: p.category,
      unit: p.unit || "ea",
      list:
        m != null && typeof p.cost === "number" && p.cost > 0
          ? Math.round((p.cost / (1 - m)) * 100) / 100
          : p.list,
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.desc.localeCompare(b.desc));
}

/** Server-side guard: may a customer add this catalog part? (category gate.) */
export function isCustomerBuyable(p: CatalogPart | null | undefined): p is CatalogPart {
  return !!p && buyable(p);
}
