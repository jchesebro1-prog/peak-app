import type { PortalService } from "@/lib/portal-service-scope";
import type { ServiceRequest } from "@/lib/portal-service-pricing";

/**
 * `/portal/service` — pure, client-safe URL + quote-scope helpers (#248 Task
 * 3, spec §2). No server imports at runtime (the two `import type`s above are
 * erased at compile time), so this module is safe for both the server page
 * and the "use client" form to pull in, mirroring portal-catalog-view.ts's
 * `parseCatalogParams`.
 */

export type ServiceParams = {
  /** null when `type` is missing/unrecognized — the page falls back to a
   *  default (flame) rather than treating this as a caller error. */
  service: PortalService | null;
  /** `?venue=` may repeat; de-duplicated, capped, in the order given. */
  venueIds: string[];
  /** `?from=<quoteId>` — "Quote again" (spec §1); takes priority over
   *  `type`/`venue` when it resolves to a usable quote. */
  fromQuoteId: string | null;
};

type RawParams = Record<string, string | string[] | undefined>;

const MAX_TEXT = 200;
const MAX_VENUES = 100;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] ?? "" : v ?? "").slice(0, MAX_TEXT);
}

function cleanIds(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const out: string[] = [];
  for (const s of arr) {
    if (typeof s !== "string") continue;
    const t = s.trim().slice(0, MAX_TEXT);
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_VENUES) break;
  }
  return out;
}

/**
 * `?type=flame|inspection&level=1|2&venue=<id>(repeatable)&from=<quoteId>` →
 * a typed, capped, de-duplicated view of the intake's URL state. `level`
 * only matters for `type=inspection` and defaults to 1 (Annual) when absent
 * or not literally "2" — an inspection quote is never level-less. Pure: every
 * id this returns is re-checked against the caller's own data server-side
 * (the customer's own venues, `portalListsQuote` for `from`) before it's
 * trusted for anything.
 */
export function parseServiceParams(sp: RawParams): ServiceParams {
  const type = first(sp.type).trim();
  let service: PortalService | null = null;
  if (type === "flame") service = { kind: "flame" };
  else if (type === "inspection") service = { kind: "inspection", level: first(sp.level).trim() === "2" ? 2 : 1 };
  return {
    service,
    venueIds: cleanIds(sp.venue),
    fromQuoteId: first(sp.from).trim() || null,
  };
}

/** Minimal structural view of a saved flame-test quote subdoc — the same
 *  shape portal-service-scope.ts reads, duplicated here rather than shared
 *  (a pure, client-safe module can't import a server module just for its
 *  private types). */
type FlameSubdocLike = { venues?: Array<{ id?: string | null; curtains?: number }> };
/** Minimal structural view of a saved inspection quote subdoc. */
type InspectionSubdocLike = { level?: number | string; venues?: Array<{ id?: string | null; lineSets?: number }> };

/**
 * "Quote again" (spec §1, §3): a flame_test/inspection quote's own saved
 * scope, as a `ServiceRequest` the form can pre-fill from — or null when the
 * quote isn't one of these two types, or its subdoc has no usable venue rows.
 * Pure — callers gate WHICH quote reaches this (tenant/ownership, via
 * `portalListsQuote`) before calling it; this never re-derives that.
 */
export function serviceRequestFromQuote(q: {
  quoteType?: string | null;
  flameTest?: unknown;
  inspection?: unknown;
}): ServiceRequest | null {
  if (q.quoteType === "flame_test") {
    const sub = q.flameTest as FlameSubdocLike | null | undefined;
    const venues = (sub?.venues || []).flatMap((v) =>
      v && typeof v.id === "string" && v.id && typeof v.curtains === "number"
        ? [{ venueId: v.id, count: v.curtains }]
        : []
    );
    return venues.length ? { service: { kind: "flame" }, venues } : null;
  }
  if (q.quoteType === "inspection") {
    const sub = q.inspection as InspectionSubdocLike | null | undefined;
    const level: 1 | 2 = Number(sub?.level) === 2 ? 2 : 1;
    const venues = (sub?.venues || []).flatMap((v) =>
      v && typeof v.id === "string" && v.id && typeof v.lineSets === "number"
        ? [{ venueId: v.id, count: v.lineSets }]
        : []
    );
    return venues.length ? { service: { kind: "inspection", level }, venues } : null;
  }
  return null;
}
