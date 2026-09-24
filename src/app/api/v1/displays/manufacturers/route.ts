import { NextResponse } from "next/server";
import { list as listCatalog } from "@/lib/stores/catalog";
import { apiEnvelope, authorizeDisplaysRequest, displaysRateHeaders, displaysRateLimit, unauthorizedMessage } from "@/lib/displays-api";

export async function GET(req: Request) {
  try {
    await authorizeDisplaysRequest(req);
  } catch (error) {
    return NextResponse.json({ error: unauthorizedMessage(error) }, { status: 401 });
  }
  const rate = displaysRateLimit(req);
  if (!rate.ok) return NextResponse.json({ error: "Rate limit exceeded." }, { status: 429, headers: { ...displaysRateHeaders(rate), "retry-after": String(Math.ceil(rate.retryAfterMs / 1000)) } });
  const parts = await listCatalog();
  const data = [...new Set(parts.map((part) => part.mfr).filter(Boolean))].sort();
  return NextResponse.json(apiEnvelope(data, { count: data.length, readOnly: true }), { headers: { "cache-control": "private, max-age=60", "x-api-read-only": "true", ...displaysRateHeaders(rate) } });
}
