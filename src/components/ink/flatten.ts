/* Flatten an InkPad drawing (#344 C3): background then ink on a white base, long edge ≤ 1600,
   JPEG 0.85. Browser-only (Image, canvas). A background that fails to load — or taints the
   canvas — still exports the ink on white, so Done is never blocked. */

import { renderInk, type InkDoc } from "@/lib/ink/model";
import { exportSize, svgDataUrl } from "@/lib/ink/view";

export type InkBackground = { kind: "svg"; svg: string; w: number; h: number } | { kind: "image"; url: string; w: number; h: number };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error("image timeout")), 15_000);
    img.onload = () => {
      clearTimeout(timer);
      // decode() makes sure the bitmap is ready before drawImage (Safari can paint an SVG blank otherwise)
      const ready = typeof img.decode === "function" ? img.decode().catch(() => undefined) : Promise.resolve();
      ready.then(() => resolve(img), () => resolve(img));
    };
    img.onerror = () => { clearTimeout(timer); reject(new Error("image failed")); };
    img.src = src;
  });
}

function toJpeg(w: number, h: number, k: number, doc: InkDoc, img: HTMLImageElement | null): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  const release = () => { c.width = 0; c.height = 0; }; // free the backing store now (iOS caps total canvas memory)
  if (!ctx) { release(); return Promise.reject(new Error("no canvas")); }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  if (img) ctx.drawImage(img, 0, 0, w, h);
  ctx.save();
  renderInk(ctx, doc, k);
  ctx.restore();
  return new Promise((resolve, reject) => {
    try {
      c.toBlob((b) => { release(); if (b) resolve(b); else reject(new Error("toBlob returned null")); }, "image/jpeg", 0.85);
    } catch (err) {
      release();
      reject(err); // a tainted (cross-origin) canvas throws here
    }
  });
}

export async function flattenInk(bg: InkBackground, doc: InkDoc): Promise<Blob> {
  const { w, h, k } = exportSize(bg.w, bg.h, bg.kind === "svg");
  const img = await loadImage(bg.kind === "svg" ? svgDataUrl(bg.svg) : bg.url).catch(() => null);
  try {
    return await toJpeg(w, h, k, doc, img);
  } catch (err) {
    if (!img) throw err;
    return toJpeg(w, h, k, doc, null); // never block Done: ink on white
  }
}
