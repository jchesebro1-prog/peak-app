import { createHash } from "node:crypto";
import { requireUser } from "@/lib/session";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { PartSpecFields } from "@/lib/bid-spec";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { hasPrintableSpec, type SpecCategoryArticle } from "@/lib/specs/articles";
import type { SpecSection } from "@/lib/specs/sections";

/** Sections + articles the Displays API needs to resolve canonical ids to the
 *  printable CSI number / title it has always returned (D-SPEC-5). */
export type SpecLookup = { sections: SpecSection[]; articles: SpecCategoryArticle[] };

/**
 * Read-only Displays Manager boundary. A deployment may provide a dedicated
 * bearer token for an external consumer; local/dev callers can use the normal
 * authenticated session until that integration credential exists.
 */
export async function authorizeDisplaysRequest(req: Request): Promise<void> {
  const configured = process.env.DISPLAYS_API_TOKEN?.trim();
  const header = req.headers.get("authorization") || "";
  if (configured && header === `Bearer ${configured}`) return;
  if (configured && header.startsWith("Bearer ")) throw new Error("Invalid Displays Manager token.");
  await requireUser();
}

function publicProductMetadata(part: CatalogPart & PartSpecFields, lib?: SpecLookup) {
  const metadata = part.productMetadata;
  if (!metadata) return null;
  const section = part.specSectionId ? lib?.sections.find((s) => s.id === part.specSectionId) : undefined;
  const article = part.specArticleId ? lib?.articles.find((a) => a.id === part.specArticleId) : undefined;
  return {
    productFamily: metadata.productFamily || null,
    specSection: section?.number || metadata.specSection || null,
    specArticle: article?.title || metadata.specArticle || null,
    specLanguageKey: metadata.specLanguageKey || null,
    researchStatus: metadata.researchStatus || null,
    source: metadata.source
      ? {
          manufacturerUrl: metadata.source.manufacturerUrl || null,
          sourceDocumentName: metadata.source.sourceDocumentName || null,
          sourceDocumentDate: metadata.source.sourceDocumentDate ?? null,
          researchedAt: metadata.source.researchedAt ?? null,
        }
      : null,
    // Never return private Blob keys. External consumers get metadata and a
    // browser-safe URL; the authenticated Peak proxy remains the document gate.
    datasheets: (metadata.datasheets || []).map((file) => ({
      kind: file.kind,
      fileName: file.fileName,
      sourceUrl: file.sourceUrl || null,
      verifiedAt: file.verifiedAt ?? null,
    })),
    accessories: (metadata.accessories || []).map((accessory) => ({
      sku: accessory.sku || null,
      manufacturerPartNumber: accessory.manufacturerPartNumber || null,
      description: accessory.description,
      required: accessory.required ?? false,
    })),
  };
}

export function publicCatalogPart(part: CatalogPart & PartSpecFields, lib?: SpecLookup) {
  return {
    id: part.id,
    sku: part.sku,
    description: part.desc,
    category: part.category,
    unit: part.unit,
    manufacturer: part.mfr || "",
    manufacturerPartNumber: part.manufacturerPartNumber || "",
    manufacturerModelNumber: part.manufacturerModelNumber || "",
    trade: part.trade || null,
    listPrice: part.list,
    mapPrice: part.mapPrice ?? null,
    datasheets: part.datasheetName
      ? [{ name: part.datasheetName, url: `/api/part-datasheet/${encodeURIComponent(part.sku)}` }]
      : (part.productMetadata?.datasheets || []).map((file) => ({ name: file.fileName, url: `/api/part-datasheet/${encodeURIComponent(part.sku)}` })),
    productMetadata: publicProductMetadata(part, lib),
    spec: hasPrintableSpec(part)
      ? { sectionId: part.specSectionId || null, articleId: part.specArticleId || null, title: part.specTitle || null, body: part.specBody!.trim() }
      : null,
    updatedAt: part.updatedAt ?? null,
    pricedAt: part.pricedAt ?? null,
  };
}

export function apiEnvelope<T>(data: T, extraMeta: Record<string, unknown> = {}) {
  return { data, meta: { apiVersion: "1", generatedAt: Date.now(), ...extraMeta }, links: {} };
}

export function catalogEtag(parts: CatalogPart[], lib?: SpecLookup): string {
  const partsPart = parts.map((part) => `${part.id}:${part.updatedAt || 0}:${part.pricedAt || 0}`).join("|");
  // publicProductMetadata's specSection/specArticle (and publicCatalogPart's
  // spec.title) derive from lib.sections[].number / lib.articles[].title, not
  // from anything on the part itself — a section renumber or article rename
  // must still bust a client's If-None-Match, or a conditional GET returns a
  // 304 carrying stale metadata. Sort by id so ordering never affects the hash.
  // (updated_since filtering upstream is per-part timestamp only, so it won't
  // surface a library-only rename either — accepted limitation, same reason.)
  const sectionsPart = (lib?.sections || [])
    .map((s) => `${s.id}:${s.updatedAt || 0}`)
    .sort()
    .join("|");
  const articlesPart = (lib?.articles || [])
    .map((a) => `${a.id}:${a.updatedAt || 0}`)
    .sort()
    .join("|");
  const source = `${partsPart}::${sectionsPart}::${articlesPart}`;
  return `"${createHash("sha1").update(source).digest("hex")}"`;
}

export type DisplaysCursor = { updatedAt: number; id: string };

/** Stable, opaque cursor for the public catalog ordering (newest first, id tie-break). */
export function encodeDisplaysCursor(part: Pick<CatalogPart, "id" | "updatedAt" | "pricedAt">): string {
  const value: DisplaysCursor = { updatedAt: part.updatedAt || part.pricedAt || 0, id: part.id };
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeDisplaysCursor(raw: string | null): DisplaysCursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<DisplaysCursor>;
    const updatedAt = value.updatedAt;
    const id = value.id;
    if (!Number.isFinite(updatedAt) || typeof id !== "string" || !id) throw new Error("invalid");
    return { updatedAt: updatedAt as number, id };
  } catch {
    throw new Error("Invalid cursor.");
  }
}

export function displayTimestamp(part: Pick<CatalogPart, "updatedAt" | "pricedAt">): number {
  return part.updatedAt || part.pricedAt || 0;
}

export function isAfterDisplaysCursor(
  part: Pick<CatalogPart, "id" | "updatedAt" | "pricedAt">,
  cursor: DisplaysCursor
): boolean {
  const timestamp = displayTimestamp(part);
  return timestamp < cursor.updatedAt || (timestamp === cursor.updatedAt && part.id.localeCompare(cursor.id) > 0);
}

export function unauthorizedMessage(error: unknown): string {
  return error instanceof Error && error.message.includes("token") ? error.message : "Authentication required.";
}

const DISPLAY_RATE_LIMIT = 120;
const DISPLAY_RATE_WINDOW_MS = 60_000;

export function displaysRateLimit(req: Request) {
  const bearer = req.headers.get("authorization") || "";
  const identity = bearer.startsWith("Bearer ")
    ? createHash("sha256").update(bearer).digest("hex")
    : clientIp(req) || "session";
  return rateLimit(`displays-api:${identity}`, DISPLAY_RATE_LIMIT, DISPLAY_RATE_WINDOW_MS);
}

export function displaysRateHeaders(result: ReturnType<typeof displaysRateLimit>): Record<string, string> {
  return {
    "RateLimit-Limit": String(DISPLAY_RATE_LIMIT),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil((Date.now() + (result.ok ? DISPLAY_RATE_WINDOW_MS : result.retryAfterMs)) / 1000)),
  };
}
