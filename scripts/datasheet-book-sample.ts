/**
 * #329 — writes a sample datasheet book from generated fixture PDFs (no DB,
 * no Blob): portrait, landscape, rotated 90/180/270 pages with an offset
 * crop box, an accessory covered by its fixture's sheet, one doc shared by
 * two SKUs, a corrupt file and parts with no datasheet.
 *   npx tsx scripts/datasheet-book-sample.ts <out.pdf> [letterhead.png|letterhead.jpg]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { buildDatasheetBook } from "@/lib/part-docs/datasheet-book-server";
import type { BookPart } from "@/lib/part-docs/datasheet-book";
import type { Letterhead } from "@/lib/letterhead";

async function sheet(label: string, pages: Array<{ size: [number, number]; rotate?: number; crop?: [number, number, number, number] }>): Promise<Buffer> {
  const d = await PDFDocument.create();
  const font = await d.embedFont(StandardFonts.HelveticaBold);
  pages.forEach((p, i) => {
    const page = d.addPage(p.size);
    if (p.crop) page.setCropBox(...p.crop);
    if (p.rotate) page.setRotation(degrees(p.rotate));
    const [w, h] = p.size;
    page.drawRectangle({ x: 10, y: 10, width: w - 20, height: h - 20, borderColor: rgb(0.2, 0.4, 0.8), borderWidth: 2 });
    page.drawText(`${label} — p${i + 1}${p.rotate ? ` /Rotate ${p.rotate}` : ""}`, { x: 40, y: h - 60, size: 20, font });
    page.drawText("(content top = user-space top)", { x: 40, y: h - 90, size: 12, font });
  });
  return Buffer.from(await d.save());
}

function sampleLetterhead(bytes: Buffer, png: boolean): Letterhead {
  // Pixel size from the PNG IHDR or the JPEG SOF0/SOF2 marker; good enough for a sample.
  let w = 600, h = 120;
  if (png) {
    w = bytes.readUInt32BE(16);
    h = bytes.readUInt32BE(20);
  } else {
    for (let i = 2; i + 9 < bytes.length; ) {
      if (bytes[i] !== 0xff) break;
      const marker = bytes[i + 1], len = bytes.readUInt16BE(i + 2);
      if (marker === 0xc0 || marker === 0xc2) { h = bytes.readUInt16BE(i + 5); w = bytes.readUInt16BE(i + 7); break; }
      i += 2 + len;
    }
  }
  return { companyName: "Peak Systems Group", image: { jpeg: bytes, png: png ? bytes : null, full: w / h > 4, w, h } };
}

async function main(): Promise<void> {
  const out = process.argv[2] || "datasheet-book-sample.pdf";
  const L: [number, number] = [612, 792];
  const docs = new Map([
    ["PD-s4", { bytes: await sheet("ETC Source Four", [{ size: L }, { size: L }]) }],
    ["PD-cs", { bytes: await sheet("ETC ColorSource Spot", [{ size: [792, 612] }]) }],
    ["PD-x32", { bytes: await sheet("Behringer X32", [{ size: L, rotate: 90 }, { size: L, rotate: 270, crop: [36, 36, 540, 720] }]) }],
    ["PD-meyer", { bytes: await sheet("Meyer Sound ULTRA-X40", [{ size: L, rotate: 180 }]) }],
    ["PD-bad", { bytes: Buffer.from("not a pdf") }],
  ]);
  const parts: BookPart[] = [
    { sku: "ETC:S4 26", mfr: "ETC", model: "S4 26", desc: "Source Four 26° ellipsoidal, black", docId: "PD-s4" },
    { sku: "ETC:S4 Lens 10", mfr: "Etc", model: "S4 Lens Tube 10", desc: "Lens tube 10° — rides on the Source Four datasheet", docId: "PD-s4", coveredBy: ["ETC:S4 26"] },
    { sku: "ETC:S4 Lens 2", mfr: "ETC", model: "S4 Lens Tube 2", desc: "Lens tube 2°", docId: "PD-s4", coveredBy: ["ETC:S4 26"] },
    { sku: "ETC:CS Spot", mfr: "ETC", model: "ColorSource Spot", desc: "ColorSource Spot LED ellipsoidal with a deliberately long description that has to wrap onto a second and maybe a third line in the index table so we can see truncation", docId: "PD-cs" },
    { sku: "Behringer:X32", mfr: "Behringer", model: "X32", desc: "Digital mixing console, 40 inputs", docId: "PD-x32" },
    { sku: "Behringer:X32 Rack", mfr: "Behringer", model: "X32 Rack", desc: "Rack-mount mixer (same datasheet)", docId: "PD-x32" },
    { sku: "Meyer:ULTRA-X40", mfr: "Meyer Sound", model: "ULTRA-X40", desc: "Point-source loudspeaker", docId: "PD-meyer" },
    { sku: "Clear-Com:HME", mfr: "Clear-Com", model: "FreeSpeak II", desc: "Wireless beltpack", docId: "PD-bad" },
    { sku: "CBL-50", mfr: "", model: "", desc: "Custom DMX cable, 50 ft", docId: null, reason: "No datasheet on file" },
    { sku: "Rose:Pipe", mfr: "Rose Brand", model: "Pipe 21", desc: "Schedule 40 pipe", docId: null, reason: "Datasheet not required" },
  ];
  const r = await buildDatasheetBook({
    subtitleLines: ["Lincoln High School — Auditorium Renovation", "Lincoln Public Schools", "Estimate EST-1042 · Rev 2", "October 12, 2026"],
    parts,
    docs,
    // A letterhead image (Grid notes #9 shape): a PNG, or a JPEG; sized as a logo (full: false) unless it is wide.
    letterhead: process.argv[3] ? sampleLetterhead(readFileSync(process.argv[3]), /\.png$/i.test(process.argv[3])) : null,
  });
  if (!r.ok) throw new Error(`book not built: ${r.cause} ${r.detail}`);
  writeFileSync(out, r.bytes);
  console.log(`${out}: ${r.pageCount} pages (${r.frontPages} front), unmergeable ${r.unmergeable.join(",")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
