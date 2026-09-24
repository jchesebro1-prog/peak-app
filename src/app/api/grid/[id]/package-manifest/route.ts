import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { buildClientPackageManifest } from "@/lib/client-package";

/**
 * Read-only package readiness seam (punch #40). Private Blob pathnames never
 * leave the server; consumers receive the existing authenticated datasheet
 * proxy URL instead. The eventual PDF/ZIP writer and the readiness UI use the
 * same manifest builder.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireUser();
  const { id } = await params;
  const project = await getProject(decodeURIComponent(id));
  if (!project) return NextResponse.json({ error: "Design not found." }, { status: 404 });
  const manifest = buildClientPackageManifest(project, await listCatalog());
  return NextResponse.json({
    ...manifest,
    datasheets: manifest.datasheets.map(({ sku, name }) => ({
      sku,
      name,
      url: `/api/part-datasheet/${encodeURIComponent(sku)}`,
    })),
    items: manifest.items.map(({ datasheet, ...item }) => ({
      ...item,
      datasheet: datasheet ? { name: datasheet.name, url: `/api/part-datasheet/${encodeURIComponent(item.sku)}` } : null,
    })),
  });
}
