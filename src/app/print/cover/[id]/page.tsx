import { notFound } from "next/navigation";
import { headers } from "next/headers";
import letterhead from "@/app/(app)/estimator/peak-letterhead.jpg";
import CoverDocument, { COVER_PRINT_CSS } from "@/components/estimate-output/cover-document";
import { loadCoverDocumentProps } from "@/lib/estimate-output/cover-loader";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { pdfKindForQuoteType } from "@/lib/quote-pdf/state";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { get as getQuote } from "@/lib/stores/quotes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Estimate cover", robots: { index: false, follow: false } };

/** The 120 s print token — fails closed; module-level so the clock read stays out of the component body (react-hooks/purity). */
function tokenOk(t: string | undefined, id: string): boolean {
  return !!t && verifyPrintToken(process.env.AUTH_SECRET || "", t, "cover", id, Date.now());
}
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * #301 slice A — the signed print route for a system estimate's cover PDF.
 * Outside the team login (middleware exempts /print/); the token is the only
 * key, checked before any read. Renders the LIVE quote (D-p). The link
 * line's origin is this request's print origin (QUOTE_PDF_ORIGIN in prod).
 */
export default async function PrintCoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const t = first(sp.t);
  if (!tokenOk(t, id)) notFound();
  const q = await getQuote(id);
  if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") notFound();
  const h = await headers();
  const where = printOriginFor(process.env, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
  const props = await loadCoverDocumentProps(q, { origin: "origin" in where ? where.origin : null, letterheadSrc: letterhead.src });
  return (
    <main>
      <style>{COVER_PRINT_CSS}</style>
      <CoverDocument {...props} />
    </main>
  );
}
