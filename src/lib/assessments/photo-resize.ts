"use client";

/* Assessments engine (#340) — shrink a camera photo on the device before it is queued or uploaded: a 1600 px long
   edge as JPEG q0.8 (a 4000×3000 phone shot becomes a few hundred KB). No EXIF dependency: `takenAt` is the file's
   last-modified time. The browser applies the camera's rotation when it decodes, so the output is upright.
   Client-only — nothing here may import a server module. */

import { PHOTO_CAPS } from "./photos";

export const HEIC_MESSAGE = "HEIC isn't supported — set the camera to Most Compatible";

/** Fit (width, height) inside a `longEdge` box, keeping the aspect ratio. Never upscales; never below 1 px. */
export function scaledSize(width: number, height: number, longEdge: number): { width: number; height: number } {
  const w = Math.max(1, Math.round(width) || 0);
  const h = Math.max(1, Math.round(height) || 0);
  const k = Math.min(1, longEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * k)), height: Math.max(1, Math.round(h * k)) };
}

/** Why this file can't be used as a photo, or null. An untyped file (some cameras) is allowed through to the decoder. */
export function photoFileProblem(f: { name: string; type: string; size: number }): string | null {
  const type = (f.type || "").toLowerCase();
  if (/^image\/hei[cf]/.test(type) || /\.hei[cf]$/i.test(f.name || "")) return HEIC_MESSAGE;
  if (type && !type.startsWith("image/")) return "That file isn't an image.";
  if (f.size > PHOTO_CAPS.originalBytes) return "That photo is over 25 MB.";
  return null;
}

type Decoded = { source: CanvasImageSource; width: number; height: number; close: () => void };

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to an <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => undefined };
  } catch {
    throw new Error("That file couldn't be read as a photo.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function resizePhoto(file: File): Promise<{ blob: Blob; takenAt: number }> {
  const problem = photoFileProblem(file);
  if (problem) throw new Error(problem);
  const d = await decode(file);
  try {
    const { width, height } = scaledSize(d.width, d.height, PHOTO_CAPS.longEdge);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't resize photos.");
    ctx.fillStyle = "#ffffff"; // a transparent PNG would otherwise turn black in a JPEG
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(d.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", PHOTO_CAPS.quality));
    if (!blob || blob.type !== "image/jpeg") throw new Error("This browser can't save photos as JPEG.");
    canvas.width = canvas.height = 0; // release the pixel buffer promptly (iOS caps total canvas memory)
    return { blob, takenAt: file.lastModified || Date.now() };
  } finally {
    d.close();
  }
}

/** Local dev without Blob only: re-encode an already-shrunk JPEG smaller (edge 1200 → 900 → 640, q0.7 → 0.5) until it
 *  is at most `maxBytes`, so it fits the 400 KB inline cap. Returns the smallest attempt if none fits. */
export async function shrinkForInline(blob: Blob, maxBytes: number): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  try {
    let best = blob;
    for (const edge of [1200, 900, 640]) {
      for (const q of [0.7, 0.5]) {
        const { width, height } = scaledSize(bmp.width, bmp.height, edge);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return best;
        ctx.drawImage(bmp, 0, 0, width, height);
        const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
        canvas.width = canvas.height = 0;
        if (out && out.size < best.size) best = out;
        if (best.size <= maxBytes) return best;
      }
    }
    return best;
  } finally {
    bmp.close();
  }
}
