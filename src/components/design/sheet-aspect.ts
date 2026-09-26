/**
 * A plan sheet page's height ÷ width, measured in the browser the same way
 * the Grid editor does (image natural size; PDF page viewport) — the aspect
 * a GridRoute stamps so its length is recomputable anywhere (D110). Used by
 * the riser's Connect tool (#GDS), which draws a route without the plan open.
 * Browser-only: call it from event handlers, never during render.
 */

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{ getViewport: (o: { scale: number }) => { width: number; height: number } }>;
};

export async function measureSheetAspect(sheet: { name: string; mime: string; src: string }, page = 1): Promise<number> {
  const isPdf = sheet.mime === "application/pdf" || sheet.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return new Promise<number>((resolve, reject) => {
      const img = new Image();
      img.onload = () =>
        img.naturalWidth > 0 ? resolve(img.naturalHeight / img.naturalWidth) : reject(new Error("The plan sheet has no size."));
      img.onerror = () => reject(new Error("Could not load the plan sheet."));
      img.src = sheet.src;
    });
  }
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const src = sheet.src.startsWith("data:")
    ? { data: Uint8Array.from(atob(sheet.src.split(",")[1] || ""), (c) => c.charCodeAt(0)) }
    : { url: sheet.src };
  const doc = (await pdfjs.getDocument({ ...src, disableFontFace: true, useSystemFonts: false }).promise) as unknown as PdfDoc;
  const pg = await doc.getPage(Math.min(Math.max(1, page), doc.numPages));
  const vp = pg.getViewport({ scale: 1 });
  if (!(vp.width > 0)) throw new Error("The plan sheet has no size.");
  return vp.height / vp.width;
}
