// SERVER ONLY — imports sharp (native). Never import from a "use client" file.
/**
 * Batch 6 / #67 — draws one app icon PNG: the Branding logo fitted inside a
 * padded square on its background (app-icon.ts), else the built-in mark.
 * Rendered once per (version, size, maskable) per server process and kept in
 * a small in-memory cache; the HTTP response is cached by version too.
 */
import sharp from "sharp";
import { ICON_DARK_BG, ICON_FILL, ICON_FILL_MASKABLE, logoBytes, type IconSize, type IconSource } from "@/lib/app-icon";

/** public/icon.svg (D117), inline so the server never reads /public at run time. Pinned equal in the harness. */
export const BUILTIN_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <!-- Q-6 app icon (D117): flat brand mark on near-black. -->
  <rect width="512" height="512" rx="112" fill="#0e0f12"/>
  <g transform="translate(58,124) scale(6)" fill="none">
    <circle cx="20" cy="22" r="16" stroke="#9aa0ab" stroke-width="7"/>
    <path d="M23 25 L39 41" stroke="#9aa0ab" stroke-width="7"/>
    <path d="M58 3 C 50 10, 45 17, 43.5 25.5" stroke="#b08d4a" stroke-width="7"/>
    <circle cx="50" cy="30.5" r="9.5" stroke="#b08d4a" stroke-width="7"/>
  </g>
</svg>
`;

const MAX_INPUT_PIXELS = 50_000_000;
const cache = new Map<string, Buffer>();
const CACHE_MAX = 32;

async function builtin(size: number, maskable: boolean): Promise<Buffer> {
  // The mark already carries its own margin; a maskable copy is squared (no rounded corners) on the same near-black.
  const svg = maskable ? BUILTIN_ICON_SVG.replace('rx="112" ', "") : BUILTIN_ICON_SVG;
  return sharp(Buffer.from(svg), { density: Math.max(72, Math.ceil((72 * size) / 512)) })
    .resize(size, size)
    .flatten({ background: ICON_DARK_BG })
    .png()
    .toBuffer();
}

async function fromLogo(src: IconSource, size: number, maskable: boolean): Promise<Buffer | null> {
  const bytes = logoBytes(src.dataUrl);
  if (!bytes) return null;
  const box = Math.max(1, Math.round(size * (maskable ? ICON_FILL_MASKABLE : ICON_FILL)));
  try {
    // An SVG rasterises at a density that covers the box; a bitmap is just resized.
    const isSvg = src.dataUrl.startsWith("data:image/svg+xml");
    const logo = await sharp(bytes, { failOn: "error", limitInputPixels: MAX_INPUT_PIXELS, ...(isSvg ? { density: 288 } : {}) })
      .resize({ width: box, height: box, fit: "inside" })
      .png()
      .toBuffer();
    return await sharp({ create: { width: size, height: size, channels: 4, background: src.background } })
      .composite([{ input: logo, gravity: "centre" }])
      .flatten({ background: src.background })
      .png()
      .toBuffer();
  } catch {
    return null;
  }
}

/** The icon PNG for this source (null → the built-in mark). A logo sharp can't read falls back to the mark too. */
export async function renderAppIcon(src: IconSource | null, version: string, size: IconSize, maskable: boolean): Promise<Buffer> {
  const key = `${version}:${size}:${maskable ? "m" : "a"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const png = (src && (await fromLogo(src, size, maskable))) || (await builtin(size, maskable));
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, png);
  return png;
}
