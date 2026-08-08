/**
 * Assembles the one-click zip: datasheet PDF + spec .docx + rough
 * drawings PDF (#40). archiver streams into a Buffer via a PassThrough —
 * the simplest correct pattern for an in-memory zip with this library.
 *
 * Bundle format is locked: exactly three named entries — datasheets.pdf,
 * spec.docx, drawings.pdf.
 *
 * archiver@8 is pure ESM and has NO default factory export (the
 * `archiver("zip", opts)` call from older majors / most online examples
 * doesn't exist here — confirmed against node_modules/archiver/lib/core.js
 * and @types/archiver/index.d.ts): the real API is `new ZipArchive(opts)`,
 * a stream.Transform subclass, imported as a named export.
 */
import { ZipArchive } from "archiver";
import { PassThrough } from "node:stream";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { walkBundle } from "./client-package";
import { mergeDatasheets } from "./datasheet-merge";
import { drawPlanDataPage } from "./plan-to-pdf";
import { buildSpecDocx } from "@/lib/bid-spec-docx";
import type { BomRow, SpecCatalogPart } from "@/lib/bid-spec";
import type { PlanData } from "@/app/(app)/design/quick/plan-svg";

export async function buildClientPackageZip(input: {
  bom: BomRow[];
  catalog: SpecCatalogPart[];
  engagementId: string;
  projectName: string;
  customer: string;
  preparedBy: string;
  /** Plan/riser pages to render into the rough-drawings PDF, titled. */
  drawings: Array<{ title: string; plan: PlanData }>;
}): Promise<Uint8Array> {
  const bundle = await walkBundle(input);
  const datasheetPdf = await mergeDatasheets(bundle);
  const specDocx = await buildSpecDocx(bundle.spec);

  const drawingsDoc = await PDFDocument.create();
  for (const d of input.drawings) {
    await drawPlanDataPage(drawingsDoc, d.plan, { title: d.title });
  }
  if (input.drawings.length === 0) {
    // Nothing silently missing — a zip with no drawings page would look
    // like a bug, not an empty state, so say so on the page itself.
    const p = drawingsDoc.addPage([612, 200]);
    const font = await drawingsDoc.embedFont(StandardFonts.Helvetica);
    p.drawText("No plan or riser available for this project yet.", { x: 50, y: 100, size: 12, font });
  }
  const drawingsPdf = await drawingsDoc.save();

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  pass.on("data", (c: Buffer) => chunks.push(c));
  archive.pipe(pass);
  archive.append(Buffer.from(datasheetPdf), { name: "datasheets.pdf" });
  archive.append(Buffer.from(specDocx), { name: "spec.docx" });
  archive.append(Buffer.from(drawingsPdf), { name: "drawings.pdf" });
  const done = new Promise<void>((resolve, reject) => {
    pass.on("end", resolve);
    archive.on("error", reject);
  });
  await archive.finalize();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}
