import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { list as listCatalog } from "@/lib/stores/catalog";
import { buildClientPackageManifest, packageNeedsFixtures } from "@/lib/client-package";
import { listFixtures } from "@/lib/stores/fixtures";
import { loadPartDocsState } from "@/lib/part-docs/load";

/**
 * Read-only package readiness seam (punch #40). Private Blob pathnames never
 * leave the server; consumers receive the authenticated part-document
 * viewer URL instead (#207). The eventual PDF/ZIP writer and the readiness UI use the
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
  const catalog = await listCatalog();
  const { index } = await loadPartDocsState(catalog);
  const fixtures = packageNeedsFixtures(project.placements || []) ? new Map((await listFixtures()).map((f) => [f.id, f])) : null;
  const manifest = buildClientPackageManifest(project, catalog, null, index, (id) => fixtures?.get(id));
  const url = (documentId: string) => `/api/part-documents/${encodeURIComponent(documentId)}`;
  return NextResponse.json({
    ...manifest,
    documents: manifest.documents.map((d) => ({ ...d, url: url(d.documentId) })),
    items: manifest.items.map((item) => ({
      ...item,
      datasheet: item.datasheet ? { ...item.datasheet, url: url(item.datasheet.documentId) } : null,
      specsheet: item.specsheet ? { ...item.specsheet, url: url(item.specsheet.documentId) } : null,
    })),
  });
}
