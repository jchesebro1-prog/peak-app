import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";
import { get as getEquipmentItem } from "@/lib/stores/equipment-items";
import { get as getEquipmentLocation } from "@/lib/stores/equipment-locations";
import { getSettings } from "@/lib/settings";
import { money, fullDate } from "@/lib/format";
import { renderLetterPdf, type LetterBlock, type LetterDoc } from "@/lib/pdf";
import { letterheadJpeg, signerFor } from "@/lib/renewal-outreach";

/**
 * Rental agreement PDF — /rentals/quote/letter?id=<quoteId>, linked from the
 * rental quote builder's "Preview rental agreement" action (controls.tsx).
 *
 * There is no existing page that calls `renderLetterPdf()` directly to
 * mirror 1:1 (`grep -rl "renderLetterPdf" src/app` comes back empty): the
 * on-screen /flame-tests/letter and /inspections/letter pages are plain
 * print-styled HTML (window.print()), and the only real caller of
 * `renderLetterPdf`/`LetterDoc` is lib/renewal-outreach.ts's
 * flameLetterDoc()/inspectionLetterDoc(), which builds a PDF Buffer purely
 * to attach to a renewal email — never served over HTTP. Rentals has no
 * renewal-outreach flow, so this route composes a `LetterDoc` the same way
 * those two functions do (reusing their `letterheadJpeg()`/`signerFor()`
 * helpers, now exported from renewal-outreach.ts) and serves the
 * `renderLetterPdf()` Buffer directly as the HTTP response — the same
 * generated-Buffer-to-Response wiring /api/spec/[id]/docx/route.ts and
 * /import/export/route.ts already use for their own generated documents.
 */

type RtLine = {
  itemId?: string;
  locationId?: string;
  qty?: number;
  startDate?: number;
  endDate?: number;
  /** Auto-priced TOTAL for one unit across the whole booked date range
   *  (equipment-bookings.ts's documented contract) — qty * rate is the
   *  line's sell price, never rate * days again. */
  rate?: number;
};
type RentalDoc = { lines?: RtLine[] } | null;
type RtContact = { name?: string; role?: string; email?: string } | null;

export async function GET(req: Request): Promise<Response> {
  await requireUser();

  const url = new URL(req.url);
  const id = (url.searchParams.get("id") || "").trim();
  const quote = id ? await getQuote(id) : null;
  if (!quote || quote.quoteType !== "rental") {
    return new Response("Rental quote not found", { status: 404 });
  }

  const rd: RentalDoc = (quote.rental as RentalDoc) || {};
  const lines = rd.lines || [];
  if (!lines.length) {
    return new Response("This rental quote has no gear lines", { status: 400 });
  }

  const settings = await getSettings();
  const companyName = settings.companyName || "Peak Systems Group";
  const accent = settings.accent || "#7b3f8a";
  const customerName = quote.customer || "Customer";
  const contact = (quote.contact as RtContact) || null;

  const lineDetails = await Promise.all(
    lines.map(async (l) => {
      const [item, loc] = await Promise.all([
        l.itemId ? getEquipmentItem(l.itemId) : null,
        l.locationId ? getEquipmentLocation(l.locationId) : null,
      ]);
      const qty = Math.max(1, Math.round(Number(l.qty) || 0));
      const rate = Number(l.rate) || 0;
      return {
        name: item?.name || l.itemId || "Equipment",
        location: loc?.name || "",
        qty,
        startDate: l.startDate || 0,
        endDate: l.endDate || 0,
        // qty * rate — rate is already the line's full-range total for ONE
        // unit, so this is the sell price for the whole line (never
        // rate * days, which the store's rate already bakes in).
        lineTotal: rate * qty,
      };
    })
  );

  const total = lineDetails.reduce((sum, l) => sum + l.lineTotal, 0);

  const starts = lineDetails.map((l) => l.startDate).filter((n) => n > 0);
  const ends = lineDetails.map((l) => l.endDate).filter((n) => n > 0);
  const rentalPeriod =
    starts.length && ends.length
      ? `${fullDate(Math.min(...starts))} – ${fullDate(Math.max(...ends))}`
      : "—";

  const blocks: LetterBlock[] = [
    {
      kind: "p",
      text:
        `${companyName} proposes to rent the equipment listed below to ` +
        `${customerName} for the period shown. Each line reflects the ` +
        `total rental price for that item across its full booked date range.`,
    },
    ...lineDetails.map(
      (l): LetterBlock => ({
        kind: "p",
        text:
          `${l.qty} × ${l.name}` +
          (l.location ? ` (from ${l.location})` : "") +
          ` — ${fullDate(l.startDate)} to ${fullDate(l.endDate)} — ${money(l.lineTotal)}`,
      })
    ),
  ];

  const head = await letterheadJpeg(settings);

  const doc: LetterDoc = {
    companyName,
    accent,
    headerJpeg: head.jpeg,
    headerFull: head.full,
    tag: "Rental Agreement",
    meta: [
      { label: "Date:", value: fullDate(quote.createdAt) },
      { label: "Customer:", value: customerName, strong: true },
      { label: "Rental period:", value: rentalPeriod },
    ],
    re: `Equipment Rental for ${customerName}`,
    greeting: contact?.name || "Sir or Madam",
    blocks,
    costLine: `The above equipment rental will cost ${money(total)}.`,
    costTail:
      "This total covers the equipment listed above for the dates shown. " +
      "Delivery, setup, operation, and consumables are quoted separately " +
      "unless noted above.",
    taxNote:
      "Sales tax, if required, will be billed at the local sales tax rates in force at the time of billing.",
    signer: await signerFor(quote.owner || "Jeff Chesebro"),
  };

  const pdf = renderLetterPdf(doc);
  const filename = `Rental-agreement-${quote.id}.pdf`;

  return new Response(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
