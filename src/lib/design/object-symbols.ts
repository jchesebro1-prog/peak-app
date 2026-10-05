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
import { isDocumentId } from "@/lib/part-docs/types";

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
