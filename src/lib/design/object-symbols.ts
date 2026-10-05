/* ------------------------------------------------------------------ *
 * The Grid — object drawings: the resolution rule (#300, D609).
 *
 * Pure and client-safe. A device draws its part's own `symbol` drawing,
 * else its device type's drawing, else nothing (the caller falls back to
 * the generic SymbolShape). The riser view prefers the part's `riser`
 * drawing and otherwise uses whatever the plan resolved to.
 *
 * Clients never resolve documents themselves: the editor, set and riser
 * pages receive a `Record<partId, ObjectSymbolUrls>` built server-side by
 * symbolUrlsFor (object-symbols-server.ts) for the parts in view.
 * ------------------------------------------------------------------ */
import { isDocumentId, type PartDocument, type PartDocumentLink } from "@/lib/part-docs/types";
import type { PartLite } from "./grid-bom";
import { typeKeyOfPart, type DeviceType } from "./device-types";

/** Document ids (`PD-…`) found for one part. */
export type SymbolDocs = { partSymbol?: string; partRiser?: string; typeSymbol?: string };
/** Served URLs (`/api/part-documents/<id>`); absent = draw the generic symbol. */
export type ObjectSymbolUrls = { plan?: string; riser?: string };

/** The signed-in serve route for a drawing document. */
export function partDocumentUrl(id: string): string {
  return `/api/part-documents/${encodeURIComponent(id)}`;
}

/** plan = part symbol → type symbol; riser = part riser → plan. A malformed
 *  id is treated as absent, so nothing but a `PD-…` id reaches a URL. */
export function resolveObjectSymbol(d: SymbolDocs): ObjectSymbolUrls {
  const ok = (v: string | undefined) => (isDocumentId(v) ? v : undefined);
  const plan = ok(d.partSymbol) ?? ok(d.typeSymbol);
  const riser = ok(d.partRiser) ?? plan;
  const out: ObjectSymbolUrls = {};
  if (plan) out.plan = partDocumentUrl(plan);
  if (riser) out.riser = partDocumentUrl(riser);
  return out;
}

/** The catalog key a Grid part's drawings are linked under (`partSku`), or
 *  null for a part that can only draw through its device type. Part
 *  documents are keyed by catalog SKU (CatalogPart.id = sku); a Grid part
 *  reaches its catalog row through `pricingPartId` (a library symbol made
 *  from a catalog part has id = pricingPartId = the catalog id; a
 *  catalog-fallback row's id IS the catalog id). Virtual `asm:` / `allow:`
 *  parts, allowances and assemblies have no catalog row. */
export function symbolKeyOfPart(p: PartLite): string | null {
  if (p.allowance || p.kind === "assembly") return null;
  const k = String(p.pricingPartId || p.id || "").trim();
  return !k || k.startsWith("asm:") || k.startsWith("allow:") ? null : k;
}

/**
 * #300 (D609) — the per-part drawing URLs, built from document and link rows
 * already in hand. Pure: the one rule symbolUrlsFor applies on both its paths
 * (a batched query, or the editor's already-loaded documents and links).
 *
 * `docs` must be LIVE documents and `links` LIVE links (the stores' reads
 * already exclude removed rows); extra rows are ignored. A link counts only
 * when its own kind is a drawing kind and its id is well formed; a
 * document's own kind is authoritative and one with no stored file
 * (link-only, never fetched) is skipped, so the serve route never redirects
 * an `<image>` to an external sourceUrl. attachDocument keeps one current
 * link per kind; should two ever be live, the newest wins (ties to the later
 * one). A part with no drawing of its own falls back to its device type's
 * (archived types never draw). Only parts with a URL are returned.
 */
export function symbolUrlsFromRows(
  parts: readonly PartLite[],
  types: readonly DeviceType[],
  docs: readonly Pick<PartDocument, "id" | "kind" | "blobKey">[],
  links: readonly Pick<PartDocumentLink, "partSku" | "documentId" | "kind" | "createdAt">[]
): Record<string, ObjectSymbolUrls> {
  const keys = new Set(parts.map(symbolKeyOfPart).filter((k): k is string => !!k));
  const kindOf = new Map<string, string>();
  for (const d of docs) if (d.blobKey && (d.kind === "symbol" || d.kind === "riser")) kindOf.set(d.id, d.kind);

  // partSku → { symbol, riser } — stable ascending sort by createdAt, last wins.
  const own = new Map<string, { symbol?: string; riser?: string }>();
  const live = links.filter((l) => keys.has(l.partSku) && (l.kind === "symbol" || l.kind === "riser") && isDocumentId(l.documentId));
  for (const l of [...live].sort((a, b) => a.createdAt - b.createdAt)) {
    const kind = kindOf.get(l.documentId);
    if (kind !== "symbol" && kind !== "riser") continue;
    const slot = own.get(l.partSku) ?? {};
    slot[kind] = l.documentId;
    own.set(l.partSku, slot);
  }
  const typeSymbol = new Map<string, string>();
  for (const t of types) if (!t.archived && isDocumentId(t.symbolDocId) && kindOf.get(t.symbolDocId) === "symbol") typeSymbol.set(t.key, t.symbolDocId);

  const out: Record<string, ObjectSymbolUrls> = {};
  for (const p of parts) {
    if (!p.id || Object.hasOwn(out, p.id)) continue;
    const key = symbolKeyOfPart(p);
    const mine = key ? own.get(key) : undefined;
    const urls = resolveObjectSymbol({ partSymbol: mine?.symbol, partRiser: mine?.riser, typeSymbol: typeSymbol.get(typeKeyOfPart(p)) });
    if (urls.plan || urls.riser) out[p.id] = urls;
  }
  return out;
}
