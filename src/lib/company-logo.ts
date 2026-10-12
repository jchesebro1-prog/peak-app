/**
 * Grid notes #8 — a customer company's logo (the datasheet book cover's
 * top-right mark). Pure, client-safe rules: what may be uploaded, the size
 * cap, the magic-byte sniff, and the copy. The sharp step and the store are
 * company-logo-server.ts / stores/company-logos.ts.
 */

/** The upload itself (the server action body cap is 1200 kB — multipart needs room). */
export const COMPANY_LOGO_MAX_BYTES = 1_000_000;
/** Stored logos are shrunk to fit this box (longest side, never enlarged). */
export const COMPANY_LOGO_MAX_EDGE = 800;
export const COMPANY_LOGO_ACCEPT = "image/png,image/jpeg,image/webp";

export const COMPANY_LOGO_COPY = {
  heading: "Logo",
  hint: "Prints on the datasheet book's cover. PNG, JPEG or WebP, up to 1 MB. No logo prints the company name instead.",
  empty: "No logo yet — the company name prints instead.",
  upload: "Upload logo…",
  replace: "Replace…",
  remove: "Remove",
  notImage: "Use a PNG, JPEG or WebP image.",
  svg: "SVG isn't supported — use PNG, JPEG or WebP.",
  tooBig: "That image is over 1 MB — use a smaller file.",
  emptyFile: "That file is empty.",
  unreadable: "Couldn't read this image — save it as PNG or JPEG.",
  noCompany: "That company could not be found.",
} as const;

export type LogoKind = "png" | "jpeg" | "webp";

/** What the file's first bytes say it is — never the name or the browser's type. */
export function sniffLogo(head: Uint8Array): LogoKind | "svg" | null {
  const b = head;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  // Any markup whose root is <svg> — after an XML declaration, comments or a <!DOCTYPE> — is SVG.
  const text = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 1024)).trimStart().toLowerCase();
  if (text.startsWith("<") && /<svg[\s>]/.test(text)) return "svg";
  return null;
}

/** The upload gate: size first (an empty or oversized file never reaches sharp), then the bytes' own type. */
export function checkLogoUpload(bytes: Uint8Array): { ok: true; kind: LogoKind } | { ok: false; error: string } {
  if (!bytes.byteLength) return { ok: false, error: COMPANY_LOGO_COPY.emptyFile };
  if (bytes.byteLength > COMPANY_LOGO_MAX_BYTES) return { ok: false, error: COMPANY_LOGO_COPY.tooBig };
  const kind = sniffLogo(bytes.subarray(0, 512));
  if (kind === "svg") return { ok: false, error: COMPANY_LOGO_COPY.svg };
  if (!kind) return { ok: false, error: COMPANY_LOGO_COPY.notImage };
  return { ok: true, kind };
}

/** A stored logo: always a PNG data URL (pdf-lib embeds PNG; transparency kept). */
export type CompanyLogo = { dataUrl: string; width: number; height: number; updatedAt: number; updatedBy: string };

const STORED = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

/** A stored record read back defensively — anything off reads as "no logo". */
export function sanitizeCompanyLogo(raw: unknown): CompanyLogo | null {
  const r = raw as Partial<CompanyLogo> | null | undefined;
  if (!r || typeof r !== "object" || typeof r.dataUrl !== "string" || !STORED.test(r.dataUrl)) return null;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  return { dataUrl: r.dataUrl, width: n(r.width), height: n(r.height), updatedAt: n(r.updatedAt), updatedBy: typeof r.updatedBy === "string" ? r.updatedBy : "" };
}
