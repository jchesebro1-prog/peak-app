import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/grid-projects";
import { resolveOptionId } from "@/lib/design/grid-options";
import { conduitRiserSheetNumber, resolveSheetSize } from "@/lib/design/grid-drawing-set";
import { conduitRiserSheetPages } from "@/lib/design/conduit-riser-server";
import { geometryToDxf } from "@/lib/design/conduit-riser/dxf";
import { attachmentDisposition } from "@/lib/document-files";
import { safeName } from "@/lib/blob";

export const dynamic = "force-dynamic";
// The loader reads the catalog, fixtures and virtual parts — same budget as the riser page.
export const maxDuration = 60;

const notFound = (error: string) => NextResponse.json({ error }, { status: 404, headers: { "cache-control": "private, no-store" } });

/**
 * #321 — one lighting control riser sheet (E-502, E-503…) as a DXF for CAD:
 * `?option=` resolves like the set, `?size=b|d` like the set (else the saved
 * size), `?page=` is 1-based. The geometry is the drawing set's own page, so
 * the printed sheet and the file can't disagree; no title block.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Outside the try: a signed-out request redirects to the login page.
  await requireUser();
  try {
    const { id } = await params;
    let projectId: string;
    try {
      projectId = decodeURIComponent(id);
    } catch {
      return notFound("Design not found."); // a malformed escape is just an unknown design
    }
    const project = await getProject(projectId);
    if (!project) return notFound("Design not found.");
    const url = new URL(request.url);
    const optionId = resolveOptionId(project, url.searchParams.get("option"));
    const size = resolveSheetSize(url.searchParams.get("size"), project.drawingSet?.size);
    const pages = await conduitRiserSheetPages(project, optionId, size);
    if (!pages.length) return notFound("This design has no lighting control riser yet — add a conduit run first.");
    const n = Number(url.searchParams.get("page") ?? "1");
    if (!Number.isInteger(n) || n < 1 || n > pages.length) return notFound("That riser sheet doesn't exist.");
    const page = pages[n - 1];
    const name = `${safeName(project.name || project.id)}-${conduitRiserSheetNumber(n - 1)}-lighting-control-riser.dxf`;
    return new Response(geometryToDxf(page.geo, page), {
      headers: {
        "content-type": "application/dxf",
        "content-disposition": attachmentDisposition(name),
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[grid] conduit riser DXF failed", e);
    return new Response("The DXF couldn't be built.", { status: 500, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
  }
}
