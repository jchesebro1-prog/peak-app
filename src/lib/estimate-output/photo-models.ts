import { isLineToken, resolveKeyProducts } from "@/app/(app)/estimator/narrative";
import type { SpecItem, SpecSection } from "@/app/(app)/estimator/types";
import { lineModel, partModel, type ModelPartLike } from "@/lib/catalog-rename/sku";
import { findLine, findSection } from "@/lib/package-doc/chips";
import { docLineNodes } from "@/lib/package-doc/text";
import type { PackageDoc } from "@/lib/package-doc/types";

/**
 * Estimate photo wrap (spec 2026-10-16 §2) — the model-number tag on a
 * key-product photo. Customer documents print the Model # only (#304):
 * `lineModel(line, part)`. A placeholder image (allowance / custom device)
 * is tagged only with the line's own Model # / MFR P/N. Pure; client-safe.
 */

export const PHOTO_TAG_MAX = 60;

export function cleanTag(v: unknown): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, PHOTO_TAG_MAX) : "";
}

/** `ownPhoto`: the part's own photo or its manufacturer's image (not a kind placeholder).
 *  `partModel`: the server's part-aware lineModel for that sku. `ownModel`: lineOwnModel(line). */
export function photoTagText(i: { ownPhoto: boolean; partModel?: string | null; ownModel?: string | null }): string {
  const own = cleanTag(i.ownModel);
  return i.ownPhoto ? cleanTag(i.partModel) || own : own;
}

/**
 * sku → tag text for the photo skus a document prints, built next to the
 * photo read: the first printing line for each sku (a system's key product,
 * else a package-document anchor) and its live catalog part, read under
 * `readSku` (an assembly line's aliased member — the part whose photo prints).
 * Skips line tokens, skus with no live part, empty models and `__proto__`.
 */
export function keyProductModelsFor(i: {
  sections: readonly SpecSection[];
  document?: PackageDoc | null;
  skus: readonly string[];
  parts: ReadonlyMap<string, ModelPartLike>;
  readSku?: (sku: string) => string;
}): Record<string, string> {
  const want = new Set((i.skus || []).filter((s) => typeof s === "string" && s && s !== "__proto__" && !isLineToken(s)));
  const lineOf = new Map<string, SpecItem>();
  for (const sec of Array.isArray(i.sections) ? i.sections : []) {
    if (!sec) continue;
    for (const r of resolveKeyProducts(sec)) if (r.status === "ok" && want.has(r.kp.sku) && !lineOf.has(r.kp.sku)) lineOf.set(r.kp.sku, r.item);
  }
  for (const n of docLineNodes(i.document)) {
    const a = n.attrs;
    const s = a?.sku;
    if (typeof s !== "string" || !want.has(s) || lineOf.has(s)) continue;
    const line = findLine(findSection(i.sections, a.sectionId), a.lineKey);
    if (line) lineOf.set(s, line);
  }
  const read = i.readSku ?? ((s: string) => s);
  const out: Record<string, string> = {};
  for (const sku of want) {
    const part = i.parts.get(read(sku));
    if (!part) continue;
    const line = lineOf.get(sku);
    const m = cleanTag(line ? lineModel(line, part) : partModel(part));
    if (m) out[sku] = m;
  }
  return out;
}
