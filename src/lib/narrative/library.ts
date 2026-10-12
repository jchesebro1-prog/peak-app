import { partsAndImagesBySku } from "@/lib/catalog-rename/live-reads";
import { listManufacturers, manufacturerImageLookup } from "@/lib/stores/manufacturers";
import { isLineToken, MAX_LIBRARY_SKUS, type KeyProductLibraryRow } from "@/app/(app)/estimator/narrative";

/** A client-sent alias longer than this is ignored (a real SKU never is). */
const MAX_ALIAS_SKU = 200;

/**
 * #293 — what the Estimator's narrative column needs per sku: whether it's a
 * live catalog part, its description (Draft's fallback text), its saved
 * paragraph + stamp, and its primary visible image. Batched primary-key reads
 * — never the whole catalog. Every distinct requested sku gets a row, so the
 * client caches misses too.
 *
 * Manufacturer section Part 1: a part with no photo also reports its
 * manufacturer image (what the document prints instead). A `line:<id>` token
 * (an allowance line, or a custom line with no real sku) has no library
 * entry and gets no row.
 */
export async function keyProductLibrary(
  skus: readonly string[],
  /** #332: an assembly line's sku → its primary member's (client-computed,
   *  quote-line-members.ts `memberAliases` — assembly lines only, from the
   *  line's own components, the same rule the printed photo and key-product
   *  datasheet use): that sku's row reads the member part — its paragraph,
   *  photo and manufacturer fallback — and says so in `viaSku`. Only entries
   *  for requested skus count. */
  aliases?: Readonly<Record<string, string>> | null,
): Promise<Record<string, KeyProductLibraryRow>> {
  const wanted = [
    ...new Set(
      (skus || [])
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter((s) => s && !isLineToken(s))
    ),
  ].slice(0, MAX_LIBRARY_SKUS);
  if (!wanted.length) return {};
  const via = new Map<string, string>();
  for (const sku of wanted) {
    const m = aliases && Object.hasOwn(aliases, sku) ? aliases[sku] : undefined;
    const member = typeof m === "string" ? m.trim() : "";
    if (member && member !== sku && !isLineToken(member) && member.length <= MAX_ALIAS_SKU) via.set(sku, member);
  }
  const read = (sku: string) => via.get(sku) ?? sku;
  // #304: keyed by the requested sku — a line loaded from a sent revision may
  // still name a renamed part's old SKU.
  const { parts: bySku, images } = await partsAndImagesBySku([...new Set(wanted.map(read))]);
  const needsFallback = [...bySku].some(([sku, p]) => !images.get(sku)?.[0] && (p.mfr || "").trim());
  const look = needsFallback ? manufacturerImageLookup(await listManufacturers()) : () => null;
  const out: Record<string, KeyProductLibraryRow> = {};
  for (const sku of wanted) {
    const p = bySku.get(read(sku));
    const text = p?.narrativeText && p.narrativeText.trim() ? p.narrativeText : null;
    const photoDocId = p ? images.get(read(sku))?.[0]?.id ?? null : null;
    const mfr = (p?.mfr || "").trim();
    const fallbackDocId = p && !photoDocId && mfr ? look(mfr) : null;
    out[sku] = {
      inCatalog: !!p,
      desc: p?.desc || "",
      paragraph: text,
      paragraphUpdatedAt: text ? p?.narrativeUpdatedAt ?? null : null,
      paragraphUpdatedBy: text ? p?.narrativeUpdatedBy ?? null : null,
      photoDocId,
      fallbackDocId,
      fallbackLabel: fallbackDocId ? mfr : null,
      ...(p && via.has(sku) ? { viaSku: p.sku } : {}),
    };
  }
  return out;
}
