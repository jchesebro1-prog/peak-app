import { NextResponse } from "next/server";
import { list as listCatalog } from "@/lib/stores/catalog";
import { apiEnvelope, authorizeDisplaysRequest, catalogEtag, decodeDisplaysCursor, displayTimestamp, displaysRateHeaders, displaysRateLimit, encodeDisplaysCursor, isAfterDisplaysCursor, publicCatalogPart, unauthorizedMessage } from "@/lib/displays-api";
import type { SpecCatalogPart } from "@/lib/bid-spec";
import { allSections } from "@/lib/stores/spec-sections";
import { allArticles } from "@/lib/stores/spec-articles";

export async function GET(req: Request) {
  try {
    await authorizeDisplaysRequest(req);
  } catch (error) {
    return NextResponse.json({ error: unauthorizedMessage(error) }, { status: 401 });
  }
  const rate = displaysRateLimit(req);
  if (!rate.ok) return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: { ...displaysRateHeaders(rate), "retry-after": String(Math.ceil(rate.retryAfterMs / 1000)) } });
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const category = (url.searchParams.get("category") || "").trim();
  const since = Number(url.searchParams.get("updated_since") || 0);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 500), 1), 2000);
  let cursor;
  try {
    cursor = decodeDisplaysCursor(url.searchParams.get("cursor"));
  } catch {
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400, headers: displaysRateHeaders(rate) });
  }
  const [sections, articles] = await Promise.all([allSections(), allArticles()]);
  const lib = { sections, articles };
  const parts = (await listCatalog()) as SpecCatalogPart[];
  const etag = catalogEtag(parts);
  if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { etag, ...displaysRateHeaders(rate) } });
  const filteredParts = parts
    .filter((part) => !since || displayTimestamp(part) > since)
    .filter((part) => !category || part.category === category)
    .filter((part) => !q || [part.sku, part.desc, part.mfr, part.manufacturerPartNumber, part.manufacturerModelNumber].some((value) => value?.toLowerCase().includes(q)))
    .sort((a, b) => displayTimestamp(b) - displayTimestamp(a) || a.id.localeCompare(b.id))
    .filter((part) => !cursor || isAfterDisplaysCursor(part, cursor));
  const page = filteredParts.slice(0, limit);
  const data = page.map((p) => publicCatalogPart(p, lib));
  const nextCursor = page.length === limit && page.at(-1) ? encodeDisplaysCursor(page.at(-1)!) : null;
  return NextResponse.json(apiEnvelope(data, { count: data.length, nextCursor, readOnly: true }), {
    headers: { etag, "cache-control": "private, max-age=60", "x-api-read-only": "true", ...displaysRateHeaders(rate) },
  });
}
