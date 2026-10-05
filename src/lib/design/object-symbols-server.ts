// SERVER ONLY — reads part_document_links / part_documents (never import from a client file).
import { documentLinksForParts, getDocuments } from "@/lib/stores/part-documents";
import { isDocumentId } from "@/lib/part-docs/types";
import type { PartLite } from "./grid-bom";
import { typeKeyOfPart, type DeviceType } from "./device-types";
import { resolveObjectSymbol, type ObjectSymbolUrls, type SymbolDocs } from "./object-symbols";

/**
 * #300 (D609) — the per-part drawing URLs for the parts in view. SERVER ONLY.
 *
 * Part documents are keyed by catalog SKU (`part_document_links.partSku` =
 * CatalogPart.id = sku). A Grid part reaches its catalog row through
 * `pricingPartId` (a library symbol made from a catalog part has
 * id = pricingPartId = the catalog id; a catalog-fallback row's id IS the
 * catalog id), so the key is `pricingPartId ?? id`. Virtual `asm:` /
 * `allow:` parts, allowances and assemblies have no catalog row and are
 * never queried — they can only draw through a device type.
 *
 * Two reads in all, however many parts: one batched query for the live
 * links of every distinct key, then one batched read of the linked documents
 * plus the device types' drawings (a document's own kind is authoritative,
 * and a removed document never draws). Only parts with a URL are returned.
 */
export async function symbolUrlsFor(parts: readonly PartLite[], types: readonly DeviceType[]): Promise<Record<string, ObjectSymbolUrls>> {
  const keyOf = (p: PartLite): string | null => {
    if (p.allowance || p.kind === "assembly") return null;
    const k = String(p.pricingPartId || p.id || "").trim();
    return !k || k.startsWith("asm:") || k.startsWith("allow:") ? null : k;
  };
  const keys = [...new Set(parts.map(keyOf).filter((k): k is string => !!k))];

  // Live drawing links of every key in view — one batched query.
  const links = keys.length
    ? (await documentLinksForParts(keys)).filter((l) => (l.kind === "symbol" || l.kind === "riser") && isDocumentId(l.documentId))
    : [];
  const typeDoc = new Map<string, string>();
  for (const t of types) if (!t.archived && isDocumentId(t.symbolDocId)) typeDoc.set(t.key, t.symbolDocId);

  // One batched read of every candidate document (part links + type drawings):
  // a document's own kind is authoritative and a removed one never draws.
  const wanted = [...links.map((l) => l.documentId), ...typeDoc.values()];
  const kindOf = wanted.length ? new Map((await getDocuments(wanted)).map((d) => [d.id, d.kind])) : new Map<string, string>();

  // partSku → { symbol, riser } (attachDocument keeps one current link per
  // kind; should two ever be live, the newest wins).
  const own = new Map<string, { symbol?: string; riser?: string }>();
  for (const l of [...links].sort((a, b) => a.createdAt - b.createdAt)) {
    const kind = kindOf.get(l.documentId);
    if (kind !== "symbol" && kind !== "riser") continue;
    const slot = own.get(l.partSku) ?? {};
    slot[kind] = l.documentId;
    own.set(l.partSku, slot);
  }
  const typeSymbol = new Map([...typeDoc].filter(([, id]) => kindOf.get(id) === "symbol"));

  const out: Record<string, ObjectSymbolUrls> = {};
  for (const p of parts) {
    if (!p.id || Object.hasOwn(out, p.id)) continue;
    const key = keyOf(p);
    const mine = key ? own.get(key) : undefined;
    const docs: SymbolDocs = {
      partSymbol: mine?.symbol,
      partRiser: mine?.riser,
      typeSymbol: typeSymbol.get(typeKeyOfPart(p)),
    };
    const urls = resolveObjectSymbol(docs);
    if (urls.plan || urls.riser) out[p.id] = urls;
  }
  return out;
}
