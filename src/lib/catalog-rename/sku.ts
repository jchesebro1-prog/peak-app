/**
 * #304 — model-number SKUs. Pure, client-safe rules: the `Brand:Model` SKU a
 * rename writes, the model a customer document prints (`partModel`), and the
 * one search haystack every part search uses (old order numbers included).
 */

export const MODEL_SKU_MAX = 60;

export function cleanModel(model: string): string {
  return String(model ?? "").replace(/\s+/g, " ").trim();
}

/** `Brand:Model`. `/ \ # ? %` and control characters become `-` in both halves;
 *  the brand also loses any `:` (the brand/model separator is the FIRST colon —
 *  `partModel` reads the text after it, so a colon inside the model is harmless).
 *  Null when either half is blank or the SKU exceeds MODEL_SKU_MAX. */
export function modelSku(mfr: string, model: string): string | null {
  const brand = cleanModel(mfr).replace(/[/\\#?%:\u0000-\u001f\u007f]/g, "-");
  const m = cleanModel(model).replace(/[/\\#?%\u0000-\u001f\u007f]/g, "-");
  if (!brand || !m) return null;
  const sku = `${brand}:${m}`;
  return sku.length > MODEL_SKU_MAX ? null : sku;
}

export type ModelPartLike = { sku: string; manufacturerModelNumber?: string; manufacturerPartNumber?: string };

/** What a customer document prints for a part: Model # → MFR P/N → the SKU
 *  after any `Brand:` prefix → the SKU. Never the order # when a model exists. */
export function partModel(p: ModelPartLike): string {
  const model = p.manufacturerModelNumber?.trim();
  if (model) return model;
  const pn = p.manufacturerPartNumber?.trim();
  if (pn) return pn;
  const sku = String(p.sku ?? "");
  const i = sku.indexOf(":");
  return (i >= 0 ? sku.slice(i + 1).trim() : "") || sku;
}

export type SearchPartLike = ModelPartLike & { desc?: string; mfr?: string; formerSkus?: string[] };

export function partSearchHaystack(p: SearchPartLike): string {
  return [p.sku, p.desc, p.mfr, p.manufacturerPartNumber, p.manufacturerModelNumber, ...(p.formerSkus ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function partMatchesQuery(p: SearchPartLike, q: string): boolean {
  const tokens = String(q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = partSearchHaystack(p);
  return tokens.every((t) => hay.includes(t));
}

/** Staff rows: "Jupiter 4 · 80-0043" — the model first, the order # beside it. */
export function staffPartLabel(p: ModelPartLike): { primary: string; secondary: string } {
  const primary = partModel(p);
  const pn = p.manufacturerPartNumber?.trim() || "";
  return { primary, secondary: pn && pn.toLowerCase() !== primary.toLowerCase() ? pn : "" };
}

export type ModelLineLike = { sku?: string; manufacturerModelNumber?: string; manufacturerPartNumber?: string };

/** What a customer document prints for a quote line: the line's own Model #
 *  (frozen with the revision) → the catalog part's Model # → the line's MFR P/N
 *  → the part's `partModel` (P/N, SKU tail, SKU). "" with no line identity and
 *  no part. Never the order # when any Model # exists. */
export function lineModel(line: ModelLineLike, part?: Partial<ModelPartLike> | null): string {
  const own = line.manufacturerModelNumber?.trim();
  if (own) return own;
  const partModelNo = part?.manufacturerModelNumber?.trim();
  if (partModelNo) return partModelNo;
  const pn = line.manufacturerPartNumber?.trim();
  if (pn) return pn;
  if (part) return partModel({ sku: part.sku ?? line.sku ?? "", manufacturerPartNumber: part.manufacturerPartNumber });
  return "";
}
