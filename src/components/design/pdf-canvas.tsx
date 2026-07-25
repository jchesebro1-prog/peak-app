"use client";

import { useEffect, useRef, useState } from "react";

/**
 * PDF page renderer (D95). Loads pdf.js lazily on the client and paints one
 * page to a canvas at a chosen zoom.
 *
 * The worker is served from /pdf.worker.min.mjs (copied out of pdfjs-dist at
 * install time) rather than bundled: pdf.js ships its worker as a separate
 * ES module and pointing at a static URL avoids fighting the bundler over
 * worker resolution.
 *
 * Non-PDF attachments never reach this component — the parent renders images
 * directly (see MarkupViewer).
 */

type PdfDoc = {
  numPages: number;
  getPage: (n: number) => Promise<{
    getViewport: (o: { scale: number }) => { width: number; height: number };
    render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas: HTMLCanvasElement }) => { promise: Promise<void>; cancel: () => void };
  }>;
};

export default function PdfCanvas({
  dataUrl,
  page,
  zoom,
  onLoaded,
  onSize,
}: {
  dataUrl: string;
  page: number;
  zoom: number;
  onLoaded: (pages: number) => void;
  onSize: (w: number, h: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<PdfDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load the document once per file.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        setLoading(true);
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        // The document arrives either as a base64 data-URL (in-database
        // sheets) or as a plain https URL (Blob storage, D116).
        const src = dataUrl.startsWith("data:")
          ? { data: Uint8Array.from(atob(dataUrl.split(",")[1] || ""), (c) => c.charCodeAt(0)) }
          : { url: dataUrl };
        const doc = (await pdfjs.getDocument({
          ...src,
          // Render glyphs as paths instead of installing @font-face rules.
          // pdf.js otherwise awaits document.fonts, which can never settle in
          // embedded/headless browsers — the render promise then hangs
          // forever and the page stays blank with no error. Paths cost a
          // little speed and buy a viewer that always paints.
          disableFontFace: true,
          useSystemFonts: false,
        }).promise) as unknown as PdfDoc;
        if (dead) return;
        docRef.current = doc;
        onLoaded(doc.numPages);
        setErr(null);
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : "Could not open this PDF.");
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
    // onLoaded is a stable setter from the parent; re-running on it would
    // reload the document on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataUrl]);

  // Paint the requested page whenever it or the zoom changes.
  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void } | null = null;
    (async () => {
      const doc = docRef.current;
      const canvas = canvasRef.current;
      if (!doc || !canvas) return;
      try {
        const pg = await doc.getPage(Math.min(page, doc.numPages));
        if (cancelled) return;
        const viewport = pg.getViewport({ scale: zoom });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        onSize(canvas.width, canvas.height);
        const t = pg.render({ canvasContext: ctx, viewport, canvas });
        task = t;
        await t.promise;
      } catch (e) {
        // A cancelled render throws and is expected when paging quickly; any
        // other failure must surface rather than leaving a blank page.
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled && !/cancel/i.test(msg)) setErr(msg);
      }
    })();
    return () => {
      cancelled = true;
      try {
        task?.cancel();
      } catch {
        /* already finished */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, zoom, loading]);

  if (err) {
    return (
      <div style={{ padding: 20, fontSize: 13, color: "#a0442b" }}>
        Could not render this PDF: {err}
      </div>
    );
  }

  return (
    <>
      {loading && (
        <div style={{ padding: 20, fontSize: 13, color: "#8c919c" }}>Loading document…</div>
      )}
      <canvas ref={canvasRef} style={{ display: loading ? "none" : "block" }} />
    </>
  );
}
