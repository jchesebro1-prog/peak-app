import { customPartSell } from "./tier-reprice";
import type { CustomDraft, SpecItem, SpecSection } from "./types";

/**
 * #312 — a custom part reopens the Custom part form, pre-filled, so it can be
 * edited in place (labor, track and curtain lines already reopen their own
 * configurators). Pure: no React, no server imports.
 */

/** A hand-entered custom part — not labor, track, curtain, fixture, rack, vendor quote or a portal price-request. */
export function isCustomLineEditable(
  it: Pick<SpecItem, "custom" | "labor" | "track" | "curtain" | "fixture" | "rackId" | "vendorQuoteId" | "por" | "mob">,
): boolean {
  return !!it.custom && !it.labor && !it.track && !it.curtain && !it.fixture && !it.rackId && !it.vendorQuoteId && !it.por && !it.mob;
}

const money = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "");

/** The form's draft, filled from a stored custom line. Add to catalog always starts unticked. */
export function customDraftFromLine(it: SpecItem, today: string = new Date().toISOString().slice(0, 10)): CustomDraft {
  const autoSell = customPartSell(it.cost);
  return {
    desc: it.desc || "",
    manufacturer: it.manufacturer || "",
    manufacturerPartNumber: it.manufacturerPartNumber || "",
    vendor: "",
    priceGoodThrough: it.priceGoodThrough || today,
    link: it.link || "",
    allowance: it.allowance ? "1" : "",
    addToCatalog: "",
    specKey: it.specKey || "",
    sku: it.allowance || (it.sku || "").toUpperCase() === "CUSTOM" ? "" : it.sku || "",
    unit: it.unit || "ea",
    qty: String(it.qty),
    cost: money(it.cost),
    price: money(it.price),
    // Unit sell keeps following Unit cost only when it already is the auto sell.
    priceAuto: autoSell > 0 && Math.abs(autoSell - it.price) < 0.005 ? "1" : "",
  };
}

/**
 * The line `lineId` replaced IN PLACE by `fresh` (the fields the form owns).
 * Kept from the old line: id, position, lineOrder and every field the form does
 * not own (comment, internal note, option, specKey, …). An extended-sell
 * override survives only while the unit sell and quantity are unchanged.
 * A line no longer there leaves the section untouched.
 */
export function replaceCustomLine(sec: SpecSection, lineId: number, fresh: SpecItem): SpecSection {
  const at = sec.items.findIndex((it) => it.id === lineId);
  if (at < 0) return sec;
  const old = sec.items[at];
  const next: SpecItem = { ...old, ...fresh, id: old.id, custom: true };
  if (typeof old.lineOrder === "number") next.lineOrder = old.lineOrder;
  for (const k of ["manufacturer", "manufacturerPartNumber", "priceGoodThrough", "link", "allowance"] as const) {
    if (fresh[k] === undefined) delete next[k];
  }
  // The Spec select lives on Customer review now; the form never touches it.
  if (old.specKey) next.specKey = old.specKey;
  else delete next.specKey;
  if (old.extSellOverride != null && (old.price !== fresh.price || old.qty !== fresh.qty)) delete next.extSellOverride;
  const items = sec.items.slice();
  items[at] = next;
  return { ...sec, items };
}
