/**
 * Base-venue defaults (Jeff, 2026-07-21).
 *
 * Every company that is a *customer* (a place Peak designs/installs) gets one
 * base venue when it's created; the venue kind is inferred from the company
 * name because that is the only signal the data carries (the Daylite import
 * labels customers by lifecycle, not church-vs-school). Partner companies
 * (vendors, contractors, architects, engineers) are relationships, not install
 * sites — they get NO venue; their office address lives on the company record.
 *
 * Shared by scripts/import-daylite.ts and the company-create flow
 * (stores/customers.ts) so the two never drift.
 */

/** Company `type` values that are partners, not install venues → no base venue. */
export const PARTNER_TYPES = new Set([
  "Architect",
  "Electrical Contractor",
  "General Contractor",
  "Engineer",
  "Vendor",
  "Competitor",
  "Consultant",
]);

const CHURCH_RE = /church|parish|chapel|ministr|baptist|luther|cathol|methodist|presby|congregation|worship|sanctuary|gospel|\btemple\b|synagogue/i;
const SCHOOL_RE = /school|district|\bhigh\b|element|middle|academy|college|univers|\bisd\b|charter|educat/i;

/**
 * The base-venue kind for a company, or null when it should get no venue.
 * `church` → sanctuary; `proscenium` → the auditorium/house (also the default).
 */
export function baseVenueKind(type: string, name: string): string | null {
  if (PARTNER_TYPES.has((type || "").trim())) return null;
  if (CHURCH_RE.test(name)) return "church";
  if (SCHOOL_RE.test(name)) return "proscenium";
  return "proscenium";
}
