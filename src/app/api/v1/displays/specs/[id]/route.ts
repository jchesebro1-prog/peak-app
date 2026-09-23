import { NextResponse } from "next/server";
import { get as getCatalog } from "@/lib/stores/catalog";
import { authorizeDisplaysRequest, apiEnvelope, publicCatalogPart, unauthorizedMessage } from "@/lib/displays-api";
import type { SpecCatalogPart } from "@/lib/bid-spec";

export async function GET(req: Request, context: { params: Promise<unknown> }) {
  try {
    await authorizeDisplaysRequest(req);
  } catch (error) {
    return NextResponse.json({ error: unauthorizedMessage(error) }, { status: 401 });
  }
  const { id } = (await context.params) as { id: string };
  const part = (await getCatalog(decodeURIComponent(id))) as SpecCatalogPart | null;
  if (!part?.specBody?.trim()) {
    return NextResponse.json({ error: "Spec not found." }, { status: 404 });
  }
  return NextResponse.json(apiEnvelope(publicCatalogPart(part), { readOnly: true }), {
    headers: { "cache-control": "private, max-age=60", "x-api-read-only": "true" },
  });
}
