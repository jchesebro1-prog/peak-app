import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { list as listCatalog } from "@/lib/stores/catalog";

/**
 * Read-only Displays Manager seam. It deliberately exposes catalog metadata
 * and a browser-safe datasheet URL, never private blob keys or write methods.
 * The first version uses the app session; a scoped API credential can be
 * added later without changing the response contract.
 */
export async function GET(req: Request) {
  await requireUser();
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const category = (url.searchParams.get("category") || "").trim();
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 500), 1), 2000);
  const parts = await listCatalog();
  const filtered = parts
    .filter((part) => !category || part.category === category)
    .filter((part) => !q || [part.sku, part.desc, part.mfr, part.manufacturerPartNumber, part.manufacturerModelNumber]
      .some((value) => value?.toLowerCase().includes(q)))
    .slice(0, limit)
    .map((part) => ({
      id: part.id,
      sku: part.sku,
      description: part.desc,
      category: part.category,
      unit: part.unit,
      manufacturer: part.mfr || "",
      manufacturerPartNumber: part.manufacturerPartNumber || "",
      manufacturerModelNumber: part.manufacturerModelNumber || "",
      listPrice: part.list,
      cost: part.cost,
      mapPrice: part.mapPrice ?? null,
      datasheet: part.datasheetName
        ? { name: part.datasheetName, url: `/api/part-datasheet/${encodeURIComponent(part.sku)}` }
        : null,
      productMetadata: part.productMetadata ?? null,
      updatedAt: part.updatedAt ?? null,
      pricedAt: part.pricedAt ?? null,
    }));

  return NextResponse.json(
    { data: filtered, meta: { count: filtered.length, readOnly: true, source: "catalog" } },
    { headers: { "cache-control": "private, max-age=60" } },
  );
}
