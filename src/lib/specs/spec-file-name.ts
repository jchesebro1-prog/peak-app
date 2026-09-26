import type { SpecDocHeader } from "@/lib/specs/spec-document";

/**
 * Spec builder file name + long issue date (#205 Phase B, design §4). Pure —
 * the builder shows the same name the download route sends.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-07-30" → [year, month, day] strings, parsed by hand so no timezone can shift the day; null if not that shape. */
function isoParts(iso: string): [string, string, string] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? [m[1], m[2], m[3]] : null;
}

/** "2026-07-30" → "July 30, 2026". */
export function longDate(iso: string): string {
  const d = isoParts(iso);
  return d ? `${MONTHS[Number(d[1]) - 1]} ${Number(d[2])}, ${d[0]}` : "";
}

/** `<number>_<name>_Spec <section>_<title>_<MM-DD-YYYY>.docx` (the North HS pattern); blanks dropped. */
export function specFileName(header: SpecDocHeader, section: { number: string; title: string }): string {
  const d = isoParts(header.issueDate);
  const bits = [header.projectNumber, header.projectName, `Spec ${section.number}`, section.title, d ? `${d[1]}-${d[2]}-${d[0]}` : ""];
  const name = bits.map((b) => (b || "").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean).join("_");
  return `${name}.docx`;
}
