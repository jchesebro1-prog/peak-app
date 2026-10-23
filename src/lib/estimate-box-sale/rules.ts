import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { presentationForNewSystem } from "@/lib/estimate-output/fields";

/**
 * Box goods sale (spec docs/superpowers/specs/2026-10-21-box-goods-sale-design.md): an Estimator system estimate
 * that sells equipment + freight only. The customer gets the itemized BOM — the estimate PDF is the BOM view and the
 * client link opens the itemized list. `Quote.boxSale` is the one stored flag (absent = false). Nothing narrative is
 * ever deleted, so turning it off brings everything back. Pure and client-safe: type-only imports, the import-free
 * bonus flags and `presentationForNewSystem` (estimate-output/fields.ts, itself type-only).
 */

/** The server's save refusal, the browser's own refusal and the Build banner's first sentence — verbatim (spec). */
export const BOX_SALE_LABOR_MESSAGE = "A box goods sale can't include labor — remove the labor lines or turn off Box goods sale.";

type FlagQuote = { boxSale?: unknown; quoteType?: string | null; source?: string | null } | null | undefined;

/** Only an Estimator system estimate (quoteType absent or "system") can be a box goods sale. */
export function isBoxSaleQuoteType(quoteType: string | null | undefined): boolean {
  return !quoteType || quoteType === "system";
}

/** A portal-catalog / portal-service quote opened in the Estimator can't be a box goods sale (spec: portal catalog
 *  quotes don't change). Every other source can — an Estimator Save restamps those as "estimator" anyway
 *  (sourceForSave keeps only the two portal sources). */
export function isBoxSaleSource(source: string | null | undefined): boolean {
  return source !== "portal-catalog" && source !== "portal-service";
}

/** The live quote's flag: a stored `true` on an Estimator system estimate; anything else reads false. */
export function boxSaleOf(q: FlagQuote): boolean {
  return !!q && q.boxSale === true && isBoxSaleQuoteType(q.quoteType) && isBoxSaleSource(q.source);
}

/** A sent revision's frozen flag (docFields.boxSale). A revision cut before the field existed reads false.
 *  quoteAsOfRevision (src/lib/quote-share/view.ts) applies the same rule inline rather than importing this module. */
export function revisionBoxSale(rev: { docFields?: { boxSale?: unknown } | null } | null | undefined): boolean {
  return rev?.docFields?.boxSale === true;
}

/** What an Estimator Save stores: `posted` on a system estimate; an older caller that omits it keeps the stored
 *  flag; any other quote type never has one. */
export function boxSaleForSave(prior: FlagQuote, posted: unknown): boolean {
  if (!isBoxSaleQuoteType(prior?.quoteType) || !isBoxSaleSource(prior?.source)) return false;
  return posted === undefined ? prior?.boxSale === true : posted === true;
}

type LaborFlags = Pick<SpecItem, "labor" | "laborOverhead" | "laborTravel" | "bonus">;

/** Labor = `labor`, `laborOverhead` or `laborTravel` set (mobilization and travel lines count). The automatic
 *  bonus lines never count: the 2% estimator bonus stays on a box sale, and the server re-derives the 5% package
 *  bonus from the remaining lines (it exists only while the system has labor). */
export function lineIsLabor(it: LaborFlags | null | undefined): boolean {
  if (!it || isBonusItem(it)) return false;
  return it.labor === true || !!it.laborOverhead || !!it.laborTravel;
}

/** A system with labor: a `kind: "labor"` system, or any labor line. */
export function systemHasLabor(sec: Pick<SpecSection, "kind" | "items"> | null | undefined): boolean {
  if (!sec) return false;
  return sec.kind === "labor" || (Array.isArray(sec.items) ? sec.items : []).some((it) => lineIsLabor(it));
}

/** The names of the systems with labor, in order ("Untitled system" when blank). Junk reads as none. */
export function boxSaleLaborSystems(sections: ReadonlyArray<Pick<SpecSection, "name" | "kind" | "items">> | null | undefined): string[] {
  return (Array.isArray(sections) ? sections : [])
    .filter((s) => systemHasLabor(s))
    .map((s) => (typeof s.name === "string" && s.name.trim() ? s.name.trim() : "Untitled system"));
}

/** The save refusal for a box sale with labor, else null. */
export function boxSaleSaveProblem(boxSale: boolean, sections: ReadonlyArray<Pick<SpecSection, "name" | "kind" | "items">> | null | undefined): string | null {
  return boxSale && boxSaleLaborSystems(sections).length > 0 ? BOX_SALE_LABOR_MESSAGE : null;
}

/** The Estimator's and + New quote's copy. */
export const BOX_SALE_COPY = {
  label: "Box goods sale",
  switchHint: "Equipment + freight only. The customer gets the BOM PDF and the online BOM — no cover, narrative, datasheets or drawings. Turn it off to bring them back.",
  chipTitle: "Box goods sale — equipment + freight only; the customer gets the itemized BOM",
  cardSub: "Equipment + freight only — the customer gets the itemized BOM",
  laborSystems: "Systems with labor:",
} as const;

/** BOM quote tab, Show on BOM: a box sale can't have labor, so its Labor switch is not shown (2026-10-22). */
export function bomSwitchShown(flag: string, boxSale: boolean): boolean {
  return !(boxSale && flag === "bomLabor");
}

/** The note (and the locked Line prices tooltip) when the estimate-wide Prices toggle is off. A box sale hides the Client
 *  package tab, so it points at the Show prices toggle on the same BOM quote tab instead. */
export function bomPricesHiddenNote(boxSale: boolean): string {
  return boxSale
    ? "Prices are hidden on client documents. Turn on Show prices (Show on BOM)."
    : "Prices are hidden on client documents (Client package → Line detail).";
}

/** The Build banner: the refusal sentence, then the systems that carry labor. */
export function boxSaleLaborBanner(names: readonly string[]): string {
  return `${BOX_SALE_LABOR_MESSAGE} ${BOX_SALE_COPY.laborSystems} ${names.join(", ")}.`;
}

/** A new system's presentation: Itemized on a box sale, else the estimate's own rule (presentationForNewSystem —
 *  no system yet = Narrative). A system loaded From library keeps its own (it prints itemized on a box sale anyway). */
export function newSystemPresentation(sections: ReadonlyArray<Pick<SpecSection, "presentation">>, boxSale: boolean): NonNullable<SpecSection["presentation"]> {
  return boxSale ? "itemized" : presentationForNewSystem(sections);
}
