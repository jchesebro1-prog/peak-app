"use client";

import { useEffect, useRef, useState } from "react";
import { printZoom } from "@/lib/design/drawing-labels";

/**
 * PDF page renderer (D95). Loads pdf.js lazily on the client and paints one
 * page to a canvas at a chosen zoom.
 *
 * The worker is served from /pdf.worker.min.mjs rather than bundled: pdf.js
 * ships its worker as a separate ES module and pointing at a static URL
 * avoids fighting the bundler over worker resolution.
 *
 * That file is a COPY of pdfjs-dist's build output, kept in sync by the
 * `sync:pdf-worker` npm script (run from `postinstall`). It has to be
 * re-copied whenever pdfjs-dist moves: pdf.js refuses to run a worker whose
 * version doesn't match the main-thread API, and — the reason this is
 * wired to postinstall rather than left to memory — a stale copy means a
 * pdfjs security bump doesn't actually reach the code that opens the PDF.
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

/**
 * Parsed documents, shared per source (#209 final review I6): a drawing set
 * puts the same PDF sheet on several plan pages (one per system), and each
 * used to download and parse it again. Small LRU — a session rarely has more
 * than a handful of plan sheets open; a failed load is evicted so a retry
 * can succeed.
 */
const DOC_CACHE_MAX = 6;
const docCache = new Map<string, Promise<PdfDoc>>();

function loadDoc(dataUrl: string): Promise<PdfDoc> {
  const hit = docCache.get(dataUrl);
  if (hit) {
    docCache.delete(dataUrl);
    docCache.set(dataUrl, hit);
    return hit;
  }
  const p = (async () => {
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    // The document arrives either as a base64 data-URL (in-database
    // sheets) or as a plain URL (Blob storage via the sheet proxy, D116).
    const src = dataUrl.startsWith("data:")
      ? { data: Uint8Array.from(atob(dataUrl.split(",")[1] || ""), (c) => c.charCodeAt(0)) }
      : { url: dataUrl };
    return (await pdfjs.getDocument({
      ...src,
      // Render glyphs as paths instead of installing @font-face rules.
      // pdf.js otherwise awaits document.fonts, which can never settle in
      // embedded/headless browsers — the render promise then hangs
      // forever and the page stays blank with no error. Paths cost a
      // little speed and buy a viewer that always paints.
      disableFontFace: true,
      useSystemFonts: false,
    }).promise) as unknown as PdfDoc;
  })();
  p.catch(() => {
    if (docCache.get(dataUrl) === p) docCache.delete(dataUrl);
  });
  docCache.set(dataUrl, p);
  while (docCache.size > DOC_CACHE_MAX) docCache.delete(docCache.keys().next().value as string);
  return p;
}

export default function PdfCanvas({
  dataUrl,
  page,
  zoom,
  printBox,
  onLoaded,
  onSize,
  onRendered,
  onError,
}: {
  dataUrl: string;
  page: number;
  zoom: number;
  /** Print sizing (#209 I6): when set, `zoom` is ignored and the page is
   *  rasterized at about 200 dpi across the width it prints at inside this
   *  inch box, capped at 12 MP (drawing-labels printZoom). */
  printBox?: { w: number; h: number };
  onLoaded: (pages: number) => void;
  onSize: (w: number, h: number) => void;
  /** Fired once the requested page has actually finished painting to the
   *  canvas. Unlike `onSize` (fired as soon as the canvas is sized, before
   *  the render promise resolves — see the render effect below), this is
   *  safe for a caller that needs the plan to be visibly on screen, e.g. a
   *  print-readiness flag (#209). Optional — existing callers are unaffected. */
  onRendered?: () => void;
  /** Fired when the document fails to load, or the requested page fails to
   *  render (a genuine failure — never for an in-flight render cancelled by
   *  paging/unmount). Optional. */
  onError?: (message: string) => void;
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
        const doc = await loadDoc(dataUrl);
        if (dead) return;
        docRef.current = doc;
        onLoaded(doc.numPages);
        setErr(null);
      } catch (e) {
        if (!dead) {
          const msg = e instanceof Error ? e.message : "Could not open this PDF.";
          setErr(msg);
          onError?.(msg);
        }
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
        const base = printBox ? pg.getViewport({ scale: 1 }) : null;
        const scale = base && printBox ? printZoom(base.width, base.height, printBox.w, printBox.h) : zoom;
        const viewport = pg.getViewport({ scale });
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        onSize(canvas.width, canvas.height);
        const t = pg.render({ canvasContext: ctx, viewport, canvas });
        task = t;
        await t.promise;
        if (!cancelled) onRendered?.();
      } catch (e) {
        // A cancelled render throws and is expected when paging quickly; any
        // other failure must surface rather than leaving a blank page.
        const msg = e instanceof Error ? e.message : String(e);
        if (!cancelled && !/cancel/i.test(msg)) {
          setErr(msg);
          onError?.(msg);
        }
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
  }, [page, zoom, loading, printBox?.w, printBox?.h]);

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
