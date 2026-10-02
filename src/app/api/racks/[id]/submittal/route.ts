import { attachmentDisposition } from "@/lib/document-files";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { loadRackForSheets } from "@/lib/rack/load";
import { scheduleCsv } from "@/lib/rack/submittal";
import { RACK_NOT_FOUND, RACK_SUBMITTAL_DEADLINE_MS, rackSubmittalFiles } from "@/lib/rack/submittal-server";
import { safeName } from "@/lib/blob";
import { requireUser } from "@/lib/session";
import { createStoredZip } from "@/lib/zip";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

const RACK_ID = /^SA-[A-Z0-9-]{1,60}$/;
const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });

/**
 * #296 — a rack's submittal for staff. Default: a zip of `<rack>/` with the
 * elevation, schedule and power/heat PDFs (headless Chrome through the signed
 * print route), schedule.csv, datasheets.pdf and 00-gaps.txt.
 * `?part=csv`: just the schedule CSV (no Chrome).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  // Outside the try: a signed-out request redirects to the login page.
  await requireUser();
  const started = Date.now();
  try {
    const { id: raw } = await params;
    const id = decodeURIComponent(raw);
    if (!RACK_ID.test(id)) return text(RACK_NOT_FOUND, 404);
    const url = new URL(request.url);

    if (url.searchParams.get("part") === "csv") {
      const data = await loadRackForSheets(id);
      if (!data) return text(RACK_NOT_FOUND, 404);
      const folder = safeName(data.rec.label || data.rec.id);
      return new Response(scheduleCsv(data.submittal), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": attachmentDisposition(`${folder}-schedule.csv`),
          "cache-control": "private, no-store",
        },
      });
    }

    const h = request.headers;
    const where = printOriginFor(process.env, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
    if ("error" in where) return text(where.error, 503);
    const built = await rackSubmittalFiles(id, where, { deadline: started + RACK_SUBMITTAL_DEADLINE_MS });
    if (!built.ok) return text(built.error, built.error === RACK_NOT_FOUND ? 404 : 500);
    const gapLines = built.gaps.map((g) => [g.kind, g.sku, g.label, g.detail].map((v) => v.replace(/[\t\r\n]+/g, " ")).join("\t"));
    const zip = createStoredZip([
      { name: `${built.folder}/00-gaps.txt`, data: Buffer.from((gapLines.length ? gapLines.join("\n") : "No gaps.") + "\n", "utf8") },
      ...built.files.map((f) => ({ name: `${built.folder}/${f.name}`, data: f.data })),
    ]);
    return new Response(new Uint8Array(zip), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": attachmentDisposition(`${built.folder}-submittal.zip`),
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("[rack] submittal build failed", e);
    return text("The submittal couldn't be built.", 500);
  }
}
