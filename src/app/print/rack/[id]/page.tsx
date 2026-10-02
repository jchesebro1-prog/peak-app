import { notFound } from "next/navigation";
import { RackSheets } from "@/components/rack/RackSheets";
import { rackSheetCss } from "@/components/rack/rack-sheet-css";
import { loadRackForSheets } from "@/lib/rack/load";
import { parseRackSheet } from "@/lib/rack/sheet-format";
import { verifyPrintToken } from "@/lib/quote-pdf/token";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rack submittal", robots: { index: false, follow: false } };

/** The 120 s print token — fails closed; module-level so the clock read stays out of the component body (react-hooks/purity). */
function tokenOk(t: string | undefined, id: string): boolean {
  return !!t && verifyPrintToken(process.env.AUTH_SECRET || "", t, "rack", id, Date.now());
}
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Signed print route for a rack's submittal sheets (#296). Outside the team
 * login (middleware exempts /print/); the token is the only key, checked
 * before any read. `?sheet=elevation|schedule|power` (default elevation) —
 * one sheet per render, so each PDF has one page orientation.
 */
export default async function PrintRackPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!tokenOk(first(sp.t), id)) notFound();
  const sheet = parseRackSheet(first(sp.sheet));
  const data = await loadRackForSheets(id);
  if (!data) notFound();
  return (
    <main>
      <style>{rackSheetCss(sheet)}</style>
      <RackSheets sheet={sheet} data={data} />
    </main>
  );
}
