import { notFound } from "next/navigation";
import { FlameLetterView } from "@/app/(app)/flame-tests/letter/letter-view";
import { InspectionLetterView } from "@/app/(app)/inspections/letter/letter-view";
import { RepairLetterView } from "@/app/(app)/repairs/letter/letter-view";
import { pdfKindForQuoteType, type PdfKind } from "@/lib/quote-pdf/state";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { get as getQuote } from "@/lib/stores/quotes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Proposal", robots: { index: false, follow: false } };

/** The 120 s print token (#222) — fails closed on anything but a valid,
 *  unexpired signature for exactly this kind + id. Module-level so the
 *  clock read stays out of the component body (react-hooks/purity). */
function tokenOk(t: string | undefined, kind: PdfKind, id: string): boolean {
  return !!t && verifyPrintToken(process.env.AUTH_SECRET || "", t, kind, id, Date.now());
}

/**
 * Signed print route for the three service proposal letters (#222). Same
 * rules as /print/quote/[id]: token first, then the quote must be the kind the
 * URL names. The letter views are the same components the team's letter pages
 * render; their toolbars are .pk-no-print, so page.pdf() (print media) drops them.
 */
export default async function PrintLetterPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ kind, id }, sp] = await Promise.all([params, searchParams]);
  if (kind !== "flame" && kind !== "repair" && kind !== "inspection") notFound();
  const t = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  if (!tokenOk(t, kind, id)) notFound();
  const q = await getQuote(id);
  if (!q || pdfKindForQuoteType(q.quoteType) !== kind) notFound();
  return (
    <>
      <style>{"nextjs-portal{display:none!important}"}</style>
      {kind === "flame" ? <FlameLetterView id={id} /> : kind === "repair" ? <RepairLetterView id={id} /> : <InspectionLetterView id={id} />}
    </>
  );
}
