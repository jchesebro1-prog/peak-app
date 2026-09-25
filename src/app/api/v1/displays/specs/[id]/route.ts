import { NextResponse } from "next/server";
import { get as getCatalog } from "@/lib/stores/catalog";
import { authorizeDisplaysRequest, apiEnvelope, displaysRateHeaders, displaysRateLimit, publicCatalogPart, unauthorizedMessage } from "@/lib/displays-api";
import type { SpecCatalogPart } from "@/lib/bid-spec";
import { hasPrintableSpec } from "@/lib/specs/articles";
import { allSections } from "@/lib/stores/spec-sections";
import { allArticles } from "@/lib/stores/spec-articles";

export async function GET(req: Request, context: { params: Promise<unknown> }) {
  try {
    await authorizeDisplaysRequest(req);
  } catch (error) {
    return NextResponse.json({ error: unauthorizedMessage(error) }, { status: 401 });
  }
  const rate = displaysRateLimit(req);
  if (!rate.ok) return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: { ...displaysRateHeaders(rate), "retry-after": String(Math.ceil(rate.retryAfterMs / 1000)) } });
  const [sections, articles] = await Promise.all([allSections(), allArticles()]);
  const { id } = (await context.params) as { id: string };
  const part = (await getCatalog(decodeURIComponent(id))) as SpecCatalogPart | null;
  if (!hasPrintableSpec(part)) {
    return NextResponse.json({ error: "Spec not found." }, { status: 404 });
  }
  return NextResponse.json(apiEnvelope(publicCatalogPart(part!, { sections, articles }), { readOnly: true }), {
    headers: { "cache-control": "private, max-age=60", "x-api-read-only": "true", ...displaysRateHeaders(rate) },
  });
}
