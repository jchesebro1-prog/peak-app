import { NextResponse } from "next/server";
import { list as listCatalog } from "@/lib/stores/catalog";
import { apiEnvelope, authorizeDisplaysRequest, unauthorizedMessage, publicCatalogPart } from "@/lib/displays-api";
import type { SpecCatalogPart } from "@/lib/bid-spec";

export async function GET(req: Request) {
  try {
    await authorizeDisplaysRequest(req);
  } catch (error) {
    return NextResponse.json({ error: unauthorizedMessage(error) }, { status: 401 });
  }
  const data = (await listCatalog() as SpecCatalogPart[]).filter((part) => !!part.specBody?.trim()).map(publicCatalogPart);
  return NextResponse.json(apiEnvelope(data, { count: data.length, readOnly: true }), { headers: { "cache-control": "private, max-age=60", "x-api-read-only": "true" } });
}
