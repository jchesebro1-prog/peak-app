/**
 * Pure address-text rules. Client-safe (no imports).
 *
 * addressKey — the place book's ONLY match rule: lowercase, every run of
 * non-letter/non-digit characters becomes one space, trimmed. Exact key
 * match only — no abbreviation folding, no fuzzy or name matching (spec).
 */
export function addressKey(text: string | null | undefined): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const URL_RE = /https?:\/\/|^www\./i;
const VIDEO_RE = /\b(zoom|teams|meet|webex)\b/i;

/**
 * A Google event location that can be driven to. Not stops: blank, a URL,
 * anything mentioning Zoom/Teams/Meet/Webex, or a bare phone number. Whether
 * it can actually be FOUND is the verifier's job, not this one's.
 */
export function isPhysicalLocation(text: string | null | undefined): boolean {
  const s = String(text ?? "").trim();
  if (!s) return false;
  if (URL_RE.test(s)) return false;
  if (VIDEO_RE.test(s)) return false;
  const noExt = s.replace(/\s*\b(ext|x)\.?\s*\d+\s*$/i, "");
  if (/^[\d\s().+-]+$/.test(noExt) && (noExt.match(/\d/g) || []).length >= 7) return false;
  return true;
}
