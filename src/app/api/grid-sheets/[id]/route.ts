import { requireUser } from "@/lib/session";
import { getDoc } from "@/db/doc-store";
import { serveGridSheet } from "@/lib/grid-sheet-serve";
import type { GridSheet } from "@/lib/stores/grid-projects";

/**
 * Authenticated plan-sheet proxy (D116). The Blob store is PRIVATE —
 * customer venue drawings never get world-readable URLs — so the browser
 * fetches sheets from here: signed-in session required, bytes streamed
 * straight through from Blob. Sheets still stored in-database are decoded
 * from their data-URL and served the same way (the drawing set loads every
 * sheet through here; the editor still gets their data-URL directly).
 * #301 slice C: the serving body lives in serveGridSheet, shared with the
 * signed Grid set print's asset route.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const sheet = await getDoc<GridSheet>("grid_sheets", decodeURIComponent(id));
  if (!sheet) return new Response("Not found", { status: 404 });
  return serveGridSheet(sheet);
}
