import { notFound } from "next/navigation";
import QuoteDocument, { QUOTE_PRINT_CSS } from "@/app/(app)/estimator/quote-document";
import { quoteDocumentDataFor } from "@/lib/quote-pdf/quote-document-data";
import { pdfKindForQuoteType, type PdfKind } from "@/lib/quote-pdf/state";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { get as getCustomer } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Quote", robots: { index: false, follow: false } };

/** The 120 s print token (#222) — fails closed on anything but a valid,
 *  unexpired signature for exactly this kind + id. Module-level so the
 *  clock read stays out of the component body (react-hooks/purity). */
function tokenOk(t: string | undefined, kind: PdfKind, id: string): boolean {
  return !!t && verifyPrintToken(process.env.AUTH_SECRET || "", t, kind, id, Date.now());
}

/**
 * Signed print route for an Estimator quote (#222). Headless Chrome loads this
 * with a 120 s token and prints it to the saved PDF. Outside the team login
 * (middleware exempts /print/); the token is the only key, checked before any
 * read. Renders from saved data only — the same QuoteDocument the team sees.
 */
export default async function PrintQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const t = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  if (!tokenOk(t, "quote", id)) notFound();
  const q = await getQuote(id);
  if (!q || pdfKindForQuoteType(q.quoteType) !== "quote") notFound();
  const [cust, settings] = await Promise.all([getCustomer(q.customerId), getSettings()]);
  return (
    <main>
      <style>{QUOTE_PRINT_CSS}</style>
      <QuoteDocument {...quoteDocumentDataFor(q, cust, settings)} />
    </main>
  );
}
