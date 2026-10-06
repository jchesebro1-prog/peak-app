import { getDoc } from "@/db/doc-store";
import { gridSetAssetTokenId, parseGridSetId } from "@/lib/design/grid-set-print";
import { serveGridSheet } from "@/lib/grid-sheet-serve";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { getProject, type GridSheet } from "@/lib/stores/grid-projects";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404 });

/** #301 slice C (R8b) — one plan-sheet source for the signed Grid set print:
 *  its own asset token first (the page signed it), then the sheet must be on
 *  that project's sheet list. No team session (headless Chrome fetches it). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string; sheetId: string }> }) {
  const { id, sheetId } = await ctx.params;
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!verifyPrintToken(process.env.AUTH_SECRET || "", t, "grid-set", gridSetAssetTokenId(id, "sheet", sheetId), Date.now())) return notFound();
  const parsed = parseGridSetId(id);
  if (!parsed) return notFound();
  const [project, sheet] = await Promise.all([getProject(parsed.projectId), getDoc<GridSheet>("grid_sheets", sheetId)]);
  if (!project || !sheet || sheet.projectId !== project.id || !(project.sheetIds || []).includes(sheet.id)) return notFound();
  return serveGridSheet(sheet);
}
