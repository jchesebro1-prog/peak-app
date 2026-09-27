"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Client renderer for the datasheet page-1 thumbnail print route (#242).
 * Loads pdf.js exactly as src/components/design/pdf-canvas.tsx does (worker
 * at /pdf.worker.min.mjs; disableFontFace so an embedded/headless browser's
 * render promise can never hang forever waiting on document.fonts), fetches
 * the PDF bytes from the signed sibling `/file` route, paints page 1 at
 * 800px width to <canvas id="thumb">, then flags the page ready —
 * `document.body.dataset.ready = "1"` is the only signal
 * renderDatasheetThumbnail's headless Chrome waits on before screenshotting
 * the canvas.
 */
const THUMB_WIDTH = 800;

export default function PartThumbCanvas({ id, token }: { id: string; token: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch(`/print/part-thumb/${encodeURIComponent(id)}/file?t=${encodeURIComponent(token)}`);
        if (!res.ok) throw new Error(`Could not load the datasheet (${res.status}).`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const doc = await pdfjs.getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false }).promise;
        if (dead) return;
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const scale = THUMB_WIDTH / base.width;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        if (!dead) document.body.dataset.ready = "1";
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : "Could not render this PDF.");
      }
    })();
    return () => {
      dead = true;
    };
  }, [id, token]);

  if (err) {
    return (
      <div style={{ padding: 20, fontSize: 13, color: "#a0442b" }}>
        Could not render this datasheet: {err}
      </div>
    );
  }

  return <canvas id="thumb" ref={canvasRef} />;
}
