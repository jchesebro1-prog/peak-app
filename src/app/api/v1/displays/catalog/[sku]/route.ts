import { NextResponse } from "next/server";
import { get } from "@/lib/stores/catalog";
import { apiEnvelope, authorizeDisplaysRequest, unauthorizedMessage, publicCatalogPart } from "@/lib/displays-api";
import type { SpecCatalogPart } from "@/lib/bid-spec";

export async function GET(req: Request, { params }: { params: Promise<{ sku: string }> }) {
  try {
    await authorizeDisplaysRequest(req);
  } catch (error) {
    return NextResponse.json({ error: unauthorizedMessage(error) }, { status: 401 });
  }
  const { sku } = await params;
  const part = (await get(decodeURIComponent(sku))) as SpecCatalogPart | null;
  if (!part) return NextResponse.json({ error: "Catalog item not found." }, { status: 404 });
  return NextResponse.json(apiEnvelope(publicCatalogPart(part), { readOnly: true }), { headers: { "cache-control": "private, max-age=60", "x-api-read-only": "true" } });
}
