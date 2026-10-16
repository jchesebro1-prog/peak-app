/**
 * Batch 6 / #67 (Jeff 2026-10-15) — the app icon comes from the Settings →
 * Branding logo. Pure: which logo, on which background, the icon file names
 * and their cache-busting version. Rendering (sharp) is in app-icon-render.ts;
 * the files are served at /icons/app/<file> (exempt from the session gate, so
 * the login page, a home-screen install and the iOS touch-icon fetch work).
 *
 * The dark-on-white logo (`logoDark`, made for white documents) is padded on
 * white; with only the nav logo (`logoLight`, made for the dark nav bar) it is
 * padded on the nav's near-black. With neither, the icon is the built-in
 * mark (public/icon.svg, D117).
 */
import { createHash } from "node:crypto";

export type IconSettings = { logoLight?: string | null; logoDark?: string | null };
export type IconSource = { dataUrl: string; background: string };

/** The nav / theme near-black (layout.tsx themeColor, public/icon.svg). */
export const ICON_DARK_BG = "#0e0f12";
export const ICON_LIGHT_BG = "#ffffff";

/** The sizes served: 32 (favicon), 180 (apple-touch-icon), 192 / 512 (manifest). */
export const ICON_SIZES = [32, 180, 192, 512] as const;
export type IconSize = (typeof ICON_SIZES)[number];

/** Share of the square the logo may fill: 80 % ("any"), 60 % for a maskable
 *  icon (its safe zone is the centre circle of 80 % diameter). */
export const ICON_FILL = 0.8;
export const ICON_FILL_MASKABLE = 0.6;

const LOGO_RE = /^data:image\/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=\s]+$/;

/** The logo to draw and its background, or null → the built-in mark. */
export function iconSource(s: IconSettings): IconSource | null {
  const dark = typeof s.logoDark === "string" && LOGO_RE.test(s.logoDark) ? s.logoDark : null;
  if (dark) return { dataUrl: dark, background: ICON_LIGHT_BG };
  const light = typeof s.logoLight === "string" && LOGO_RE.test(s.logoLight) ? s.logoLight : null;
  if (light) return { dataUrl: light, background: ICON_DARK_BG };
  return null;
}

/** A short version that changes whenever the drawn logo (or its background) changes. */
export function iconVersion(s: IconSettings): string {
  const src = iconSource(s);
  if (!src) return "default";
  return createHash("sha1").update(src.background).update("\n").update(src.dataUrl).digest("hex").slice(0, 12);
}

/** "512.png" / "512-maskable.png" → { size, maskable }, else null (an unknown size or name). */
export function parseIconFile(name: string): { size: IconSize; maskable: boolean } | null {
  const m = /^(\d{2,3})(-maskable)?\.png$/.exec(String(name || ""));
  if (!m) return null;
  const size = Number(m[1]);
  if (!(ICON_SIZES as readonly number[]).includes(size)) return null;
  return { size: size as IconSize, maskable: !!m[2] };
}

export function iconHref(size: IconSize, version: string, maskable = false): string {
  return `/icons/app/${size}${maskable ? "-maskable" : ""}.png?v=${encodeURIComponent(version)}`;
}

/** The manifest's icons: 192 + 512 ("any") and a padded 512 maskable. */
export function manifestIcons(version: string): Array<{ src: string; sizes: string; type: string; purpose: "any" | "maskable" }> {
  return [
    { src: iconHref(192, version), sizes: "192x192", type: "image/png", purpose: "any" },
    { src: iconHref(512, version), sizes: "512x512", type: "image/png", purpose: "any" },
    { src: iconHref(512, version, true), sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];
}

/** The decoded logo bytes, or null for a malformed data URL. */
export function logoBytes(dataUrl: string): Buffer | null {
  const i = dataUrl.indexOf(";base64,");
  if (i < 0) return null;
  const buf = Buffer.from(dataUrl.slice(i + 8), "base64");
  return buf.length ? buf : null;
}

/** Cache-Control for an icon: a request that names the current version is immutable; anything else revalidates soon. */
export function iconCacheControl(requested: string | null, current: string): string {
  return requested && requested === current ? "public, max-age=31536000, immutable" : "public, max-age=300";
}
