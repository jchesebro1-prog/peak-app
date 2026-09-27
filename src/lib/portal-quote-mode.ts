/** Firm vs review, validity, accept eligibility, card guard (#242, spec §2.3/§4). Pure. */
export type ModeLine = { por: boolean };
export function quoteMode(lines: readonly ModeLine[]): { mode: "firm" | "review"; porCount: number; reason: string | null } {
  const porCount = lines.filter((l) => l.por).length;
  if (!porCount) return { mode: "firm", porCount, reason: null };
  return { mode: "review", porCount, reason: `${porCount} ${porCount === 1 ? "line is" : "lines are"} price on request` };
}
export function firmValidUntil(generatedAt: number, validityDays: number): number {
  return generatedAt + Math.max(1, Math.round(validityDays)) * 86400000;
}
export function canAcceptPortal(
  q: { status: string; portalAcceptance?: unknown; portalFirm?: { validUntil: number } | null },
  now: number
): { ok: boolean; reason?: "not-sent" | "accepted" | "expired" } {
  if (q.status !== "sent") return { ok: false, reason: "not-sent" };
  if (q.portalAcceptance) return { ok: false, reason: "accepted" };
  if (q.portalFirm && now > q.portalFirm.validUntil) return { ok: false, reason: "expired" };
  return { ok: true };
}
function luhn(d: string): boolean {
  let sum = 0, alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}
/** A 13–19 digit run (spaces/dashes allowed between digits) that passes Luhn. */
export function looksLikeCardNumber(text: string): boolean {
  for (const m of text.matchAll(/\d(?:[ -]?\d){12,18}/g)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) return true;
  }
  return false;
}
export const PURCHASE_METHODS = ["po", "card", "check", "other"] as const;
export const PURCHASE_METHOD_LABEL: Record<(typeof PURCHASE_METHODS)[number], string> = { po: "Purchase order", card: "Credit card", check: "Check", other: "Other" };
