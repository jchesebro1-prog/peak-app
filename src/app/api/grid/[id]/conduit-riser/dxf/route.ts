import { requireUser } from "@/lib/session";
import { conduitRiserDxfResponse } from "@/lib/design/conduit-riser-server";

export const dynamic = "force-dynamic";
// The loader reads the catalog, fixtures and virtual parts — same budget as the riser page.
export const maxDuration = 60;

/**
 * #321 — one lighting control riser sheet (E-502, E-503…) as a DXF for CAD:
 * `?option=` resolves like the set, `?size=b|d` like the set (else the saved
 * size), `?page=` is 1-based. The logic lives in `conduitRiserDxfResponse`
 * so the harness can call it; this route only signs the request in.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // A signed-out request redirects to the login page.
  await requireUser();
  const { id } = await params;
  return conduitRiserDxfResponse(id, new URL(request.url).searchParams);
}
