/* A venue's "Next assessment" date field (Jeff 2026-10-15 #10; #353 review I1) — pure. A browser date input reports
   every keystroke of a typed year ("0002-03-04", "0020-…", "0202-…"), so the field saves only on blur / Enter and
   ignores any value with a year before 1900. Dates are noon local of the picked day, the findings register's rule. */

export const MIN_NEXT_ASSESSMENT_YEAR = 1900;
/** Epoch ms of 1900-01-01 (UTC): the server refuses anything earlier. */
export const MIN_NEXT_ASSESSMENT_MS = Date.UTC(MIN_NEXT_ASSESSMENT_YEAR, 0, 1);

/** `<input type="date">` value → `{ at }` (null = cleared), or `ignore` for a partial / pre-1900 / malformed value. */
export function parseNextAssessmentInput(s: string): { at: number | null } | "ignore" {
  const v = (s || "").trim();
  if (!v) return { at: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return "ignore";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < MIN_NEXT_ASSESSMENT_YEAR || mo < 1 || mo > 12 || d < 1 || d > 31) return "ignore";
  const ms = new Date(y, mo - 1, d, 12).getTime();
  return Number.isFinite(ms) ? { at: ms } : "ignore";
}

/** Stored epoch ms → the input's `yyyy-mm-dd` (local), "" for none. */
export function nextAssessmentInputValue(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
