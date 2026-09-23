import { createHash } from "node:crypto";
import { requireUser } from "@/lib/session";
import type { CatalogPart } from "@/lib/stores/catalog";
import type { PartSpecFields } from "@/lib/bid-spec";

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

function publicProductMetadata(part: CatalogPart) {
  const metadata = part.productMetadata;
  if (!metadata) return null;
  return {
    productFamily: metadata.productFamily || null,
    specSection: metadata.specSection || null,
    specArticle: metadata.specArticle || null,
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

export function publicCatalogPart(part: CatalogPart & PartSpecFields) {
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
    productMetadata: publicProductMetadata(part),
    spec: part.specBody?.trim() ? { sectionId: part.specSectionId || null, body: part.specBody.trim() } : null,
    updatedAt: part.updatedAt ?? null,
    pricedAt: part.pricedAt ?? null,
  };
}

export function apiEnvelope<T>(data: T, extraMeta: Record<string, unknown> = {}) {
  return { data, meta: { apiVersion: "1", generatedAt: Date.now(), ...extraMeta }, links: {} };
}

export function catalogEtag(parts: CatalogPart[]): string {
  const source = parts.map((part) => `${part.id}:${part.updatedAt || 0}:${part.pricedAt || 0}`).join("|");
  return `"${createHash("sha1").update(source).digest("hex")}"`;
}

export function unauthorizedMessage(error: unknown): string {
  return error instanceof Error && error.message.includes("token") ? error.message : "Authentication required.";
}
