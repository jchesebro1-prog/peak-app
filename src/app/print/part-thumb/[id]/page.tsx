import { notFound } from "next/navigation";
import { verifyPrintToken } from "@/lib/quote-pdf/token";
import { getDocument } from "@/lib/stores/part-documents";
import PartThumbCanvas from "./thumb-canvas";

export const dynamic = "force-dynamic";
export const metadata = { title: "Datasheet thumbnail", robots: { index: false, follow: false } };

/** The 120 s print token (#222/#245) — fails closed on anything but a valid,
 *  unexpired signature for exactly this datasheet id. Module-level so the
 *  clock read stays out of the component body (react-hooks/purity). */
function tokenOk(t: string | undefined, id: string): boolean {
  return !!t && verifyPrintToken(process.env.AUTH_SECRET || "", t, "part-thumb", id, Date.now());
}

/**
 * Signed print route for the datasheet page-1 thumbnail batch (#245).
 * Headless Chrome loads this with a 120 s token; the client component opens
 * the datasheet PDF with pdf.js (same engine as the design pdf-canvas) and
 * paints page 1 to a canvas, then flags the page ready. Outside the team
 * login (middleware exempts /print/); the token is the only key, checked
 * before any read.
 */
export default async function PrintPartThumbPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const t = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  if (!tokenOk(t, id)) notFound();
  const doc = await getDocument(id);
  if (!doc || doc.kind !== "datasheet" || !doc.blobKey) notFound();
  return (
    <main style={{ margin: 0, background: "#fff" }}>
      <PartThumbCanvas id={id} token={t!} />
    </main>
  );
}
