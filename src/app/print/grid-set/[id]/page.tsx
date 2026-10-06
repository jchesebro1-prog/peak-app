import { notFound } from "next/navigation";
import { DrawingSetSheets } from "@/components/drawing/drawing-set-sheets";
import { loadDrawingSetData, type DrawingSetAssets } from "@/lib/design/drawing-set-data";
import { printPageCss } from "@/lib/design/grid-drawing-set";
import { hasOption } from "@/lib/design/grid-options";
import { gridSetAssetTokenId, parseGridSetId } from "@/lib/design/grid-set-print";
import { signPrintToken, verifyPrintToken } from "@/lib/quote-pdf/token";
import { getProject } from "@/lib/stores/grid-projects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Drawing set", robots: { index: false, follow: false } };
export const maxDuration = 60;

/** The 120 s print token — fails closed; module-level so the clock read stays out of the component body (react-hooks/purity). */
function tokenOk(t: string | undefined, id: string): boolean {
  return !!t && verifyPrintToken(process.env.AUTH_SECRET || "", t, "grid-set", id, Date.now());
}

/** One asset's own token: the page signs only assets it draws for this set (adaptation 6). */
function assetUrl(setId: string, kind: "sheet" | "doc", assetId: string): string {
  const t = signPrintToken(process.env.AUTH_SECRET || "", "grid-set", gridSetAssetTokenId(setId, kind, assetId), Date.now());
  return `/print/grid-set/${encodeURIComponent(setId)}/asset/${kind}/${encodeURIComponent(assetId)}?t=${encodeURIComponent(t)}`;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * #301 slice C (R8) — the signed print route for a Grid design's drawing set
 * (headless Chrome has no session; middleware exempts /print/). id =
 * `<projectId>~<optionId>`; the token is checked before any read; the option
 * must exist exactly (no fallback to another option). 11×17. Every sheet
 * source and symbol drawing loads through a token-scoped asset route.
 */
export default async function PrintGridSetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!tokenOk(first(sp.t), id)) notFound();
  const parsed = parseGridSetId(id);
  if (!parsed) notFound();
  const project = await getProject(parsed.projectId);
  if (!project || !hasOption(project, parsed.optionId)) notFound();
  const assets: DrawingSetAssets = { sheet: (src) => assetUrl(id, "sheet", src.id), doc: (docId) => assetUrl(id, "doc", docId) };
  const data = await loadDrawingSetData(project, { requestedOption: parsed.optionId, requestedSize: "b", assets });
  return (
    <main>
      <style>{printPageCss(data.size)}</style>
      <DrawingSetSheets data={data} assets={assets} />
    </main>
  );
}
