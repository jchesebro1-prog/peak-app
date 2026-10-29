/**
 * vCard 3.0 for the public contact card (Save contact). Pure. RFC 2426:
 * escape `\` `,` `;` and newlines in text values; fold lines longer than
 * 75 octets with CRLF + one space.
 */

export type VCardInput = {
  name: string;
  org?: string;
  title?: string;
  workPhone?: string;
  cellPhone?: string;
  email?: string;
  url?: string;
  /** Raw base64 of a JPEG (no data: prefix). */
  photoJpegBase64?: string;
};

const esc = (s: string): string =>
  s.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");

function fold(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let limit = 75;
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > limit) {
      out.push(cur);
      cur = " " + ch;
      limit = 75;
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function buildVCard(v: VCardInput): string {
  const name = (v.name || "").trim();
  const sp = name.lastIndexOf(" ");
  const first = sp > 0 ? name.slice(0, sp) : name;
  const last = sp > 0 ? name.slice(sp + 1) : "";
  const raw: string[] = ["BEGIN:VCARD", "VERSION:3.0", `FN:${esc(name)}`, `N:${esc(last)};${esc(first)};;;`];
  if (v.org?.trim()) raw.push(`ORG:${esc(v.org.trim())}`);
  if (v.title?.trim()) raw.push(`TITLE:${esc(v.title.trim())}`);
  if (v.workPhone?.trim()) raw.push(`TEL;TYPE=WORK,VOICE:${esc(v.workPhone.trim())}`);
  if (v.cellPhone?.trim()) raw.push(`TEL;TYPE=CELL:${esc(v.cellPhone.trim())}`);
  if (v.email?.trim()) raw.push(`EMAIL;TYPE=INTERNET:${esc(v.email.trim())}`);
  if (v.url?.trim()) raw.push(`URL:${v.url.trim()}`);
  if (v.photoJpegBase64) raw.push(`PHOTO;ENCODING=b;TYPE=JPEG:${v.photoJpegBase64}`);
  raw.push("END:VCARD");
  return raw.flatMap(fold).join("\r\n") + "\r\n";
}

export function vcardFileName(name: string): string {
  const clean = String(name || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return (clean || "contact") + ".vcf";
}

/**
 * Content-Disposition for the vCard download. Header values must be Latin-1,
 * so the plain `filename` is an ASCII fallback and `filename*` carries the
 * real UTF-8 name (RFC 6266 / 8187).
 */
export function contentDispositionFor(name: string): string {
  const full = vcardFileName(name).replace(/["\\]/g, "");
  const ascii = full
    .replace(/[ŁłØøĐđßÆæ]/g, (c) => ({ Ł: "L", ł: "l", Ø: "O", ø: "o", Đ: "D", đ: "d", ß: "ss", Æ: "AE", æ: "ae" })[c] ?? "")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "").replace(/\s+/g, " ").trim();
  const fallback = /[A-Za-z0-9]/.test(ascii.replace(/\.vcf$/, "")) ? ascii : "contact.vcf";
  const star = encodeURIComponent(full).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${fallback}"; filename*=UTF-8''${star}`;
}
