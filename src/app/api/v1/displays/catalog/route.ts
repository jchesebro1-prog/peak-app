import { NextResponse } from "next/server";
import { list as listCatalog } from "@/lib/stores/catalog";
import { apiEnvelope, authorizeDisplaysRequest, catalogEtag, publicCatalogPart, unauthorizedMessage } from "@/lib/displays-api";
import type { SpecCatalogPart } from "@/lib/bid-spec";

export async function GET(req: Request) {
  try {
    await authorizeDisplaysRequest(req);
  } catch (error) {
    return NextResponse.json({ error: unauthorizedMessage(error) }, { status: 401 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const category = (url.searchParams.get("category") || "").trim();
  const since = Number(url.searchParams.get("updated_since") || 0);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 500), 1), 2000);
  const parts = (await listCatalog()) as SpecCatalogPart[];
  const etag = catalogEtag(parts);
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { etag } });
  const data = parts
    .filter((part) => !since || (part.updatedAt || part.pricedAt || 0) > since)
    .filter((part) => !category || part.category === category)
    .filter((part) => !q || [part.sku, part.desc, part.mfr, part.manufacturerPartNumber, part.manufacturerModelNumber].some((value) => value?.toLowerCase().includes(q)))
    .sort((a, b) => (b.updatedAt || b.pricedAt || 0) - (a.updatedAt || a.pricedAt || 0) || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(publicCatalogPart);
  return NextResponse.json(apiEnvelope(data, { count: data.length, readOnly: true }), {
    headers: { etag, "cache-control": "private, max-age=60", "x-api-read-only": "true" },
  });
}
