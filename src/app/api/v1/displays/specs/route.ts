import { NextResponse } from "next/server";
import { list as listCatalog } from "@/lib/stores/catalog";
import { apiEnvelope, authorizeDisplaysRequest, decodeDisplaysCursor, displayTimestamp, displaysRateHeaders, displaysRateLimit, encodeDisplaysCursor, isAfterDisplaysCursor, unauthorizedMessage, publicCatalogPart } from "@/lib/displays-api";
import type { SpecCatalogPart } from "@/lib/bid-spec";

export async function GET(req: Request) {
  try {
    await authorizeDisplaysRequest(req);
  } catch (error) {
    return NextResponse.json({ error: unauthorizedMessage(error) }, { status: 401 });
  }
  const rate = displaysRateLimit(req);
  if (!rate.ok) return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: { ...displaysRateHeaders(rate), "retry-after": String(Math.ceil(rate.retryAfterMs / 1000)) } });
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 500), 1), 2000);
  let cursor;
  try {
    cursor = decodeDisplaysCursor(url.searchParams.get("cursor"));
  } catch {
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400, headers: displaysRateHeaders(rate) });
  }
  const parts = (await listCatalog() as SpecCatalogPart[])
    .filter((part) => !!part.specBody?.trim())
    .sort((a, b) => displayTimestamp(b) - displayTimestamp(a) || a.id.localeCompare(b.id))
    .filter((part) => !cursor || isAfterDisplaysCursor(part, cursor));
  const page = parts.slice(0, limit);
  const data = page.map(publicCatalogPart);
  const nextCursor = page.length === limit && page.at(-1) ? encodeDisplaysCursor(page.at(-1)!) : null;
  return NextResponse.json(apiEnvelope(data, { count: data.length, nextCursor, readOnly: true }), { headers: { "cache-control": "private, max-age=60", "x-api-read-only": "true", ...displaysRateHeaders(rate) } });
}
