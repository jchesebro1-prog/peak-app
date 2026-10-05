// SERVER ONLY — reads part_document_links / part_documents (never import from a client file).
import { documentLinksForParts, getDocuments } from "@/lib/stores/part-documents";
import { isDocumentId, type PartDocument, type PartDocumentLink } from "@/lib/part-docs/types";
import type { PartLite } from "./grid-bom";
import type { DeviceType } from "./device-types";
import { symbolKeyOfPart, symbolUrlsFromRows, type ObjectSymbolUrls } from "./object-symbols";

/**
 * #300 (D609) — the per-part drawing URLs for the parts in view. SERVER ONLY.
 * The rule itself is the pure symbolUrlsFromRows (object-symbols.ts); this
 * only supplies the rows.
 *
 * `loaded` — the editor page already loads every live document and link
 * (loadPartDocsState), so it passes them and nothing is queried. Without it
 * (drawing set, riser) there are two reads in all, however many parts: one
 * batched query for the live links of every distinct key, then one batched
 * read of the linked documents plus the device types' drawings.
 */
export async function symbolUrlsFor(
  parts: readonly PartLite[],
  types: readonly DeviceType[],
  loaded?: { docs: readonly PartDocument[]; links: readonly PartDocumentLink[] }
): Promise<Record<string, ObjectSymbolUrls>> {
  if (loaded) return symbolUrlsFromRows(parts, types, loaded.docs, loaded.links);

  const keys = [...new Set(parts.map(symbolKeyOfPart).filter((k): k is string => !!k))];
  // Live drawing links of every key in view — one batched query.
  const links = keys.length
    ? (await documentLinksForParts(keys)).filter((l) => (l.kind === "symbol" || l.kind === "riser") && isDocumentId(l.documentId))
    : [];
  // One batched read of every candidate document (part links + type drawings).
  const wanted = [...links.map((l) => l.documentId), ...types.filter((t) => !t.archived && isDocumentId(t.symbolDocId)).map((t) => t.symbolDocId as string)];
  const docs = wanted.length ? await getDocuments(wanted) : [];
  return symbolUrlsFromRows(parts, types, docs, links);
}
