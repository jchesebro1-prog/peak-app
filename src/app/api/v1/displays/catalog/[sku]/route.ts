import { NextResponse } from "next/server";
import { get } from "@/lib/stores/catalog";
import { apiEnvelope, authorizeDisplaysRequest, displaysRateHeaders, displaysRateLimit, unauthorizedMessage, publicCatalogPart } from "@/lib/displays-api";
import type { SpecCatalogPart } from "@/lib/bid-spec";
import { allSections } from "@/lib/stores/spec-sections";
import { allArticles } from "@/lib/stores/spec-articles";
import { loadPartDocsState } from "@/lib/part-docs/load";

export async function GET(req: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    await authorizeDisplaysRequest(req);
  } catch (error) {
    return NextResponse.json({ error: unauthorizedMessage(error) }, { status: 401 });
  }
  const rate = displaysRateLimit(req);
  if (!rate.ok) return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: { ...displaysRateHeaders(rate), "retry-after": String(Math.ceil(rate.retryAfterMs / 1000)) } });
  const [sections, articles] = await Promise.all([allSections(), allArticles()]);
  const { sku } = await params;
  const part = (await get(decodeURIComponent(sku))) as SpecCatalogPart | null;
  if (!part) return NextResponse.json({ error: "Catalog item not found." }, { status: 404 });
  const docs = (await loadPartDocsState([part])).index;
  return NextResponse.json(apiEnvelope(publicCatalogPart(part, { sections, articles, docs }), { readOnly: true }), { headers: { "cache-control": "private, max-age=60", "x-api-read-only": "true", ...displaysRateHeaders(rate) } });
}
