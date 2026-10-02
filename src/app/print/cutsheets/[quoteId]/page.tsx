import { notFound } from "next/navigation";
import { CutSheetPages, CLIENT_PRINT_CSS, SUBMITTAL_PRINT_CSS } from "@/components/cutsheets/cut-sheet-pages";
import { loadCutSheets } from "@/lib/curtain-cut-sheets/load";
import { verifyPrintToken } from "@/lib/quote-pdf/token";

export const dynamic = "force-dynamic";
export const metadata = { title: "Cut sheets", robots: { index: false, follow: false } };

/** The 120 s print token — fails closed; module-level so the clock read stays out of the component body (react-hooks/purity). */
function tokenOk(t: string | undefined, id: string): boolean {
  return !!t && verifyPrintToken(process.env.AUTH_SECRET || "", t, "cutsheets", id, Date.now());
}
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Signed print route for curtain cut sheets (#292 §5.1). Outside the team
 * login (middleware exempts /print/); the token is the only key, checked
 * before any read. `?style=submittal|client&sheet=CS-n` (sheet optional).
 */
export default async function PrintCutSheetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ quoteId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ quoteId }, sp] = await Promise.all([params, searchParams]);
  if (!tokenOk(first(sp.t), quoteId)) notFound();
  const style = first(sp.style) === "client" ? "client" : "submittal";
  const sheet = first(sp.sheet) || "";
  // One sheet (a client-package render) reads only its own photos.
  const loaded = await loadCutSheets(quoteId, { images: style === "client" ? "data" : "none", sheet: sheet || undefined });
  if (!loaded.ok) notFound();
  const models = loaded.models[style].filter((m) => !sheet || m.sheetNo === sheet);
  if (!models.length) notFound();
  return (
    <main>
      <style>{style === "submittal" ? SUBMITTAL_PRINT_CSS : CLIENT_PRINT_CSS}</style>
      <CutSheetPages models={models} style={style} photos={loaded.photos} />
    </main>
  );
}
