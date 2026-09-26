import type { SpecDocHeader } from "@/lib/specs/spec-document";

/**
 * Spec builder file name + long issue date (#205 Phase B, design §4). Pure —
 * the builder shows the same name the download route sends.
 */

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-07-30" → "July 30, 2026", parsed by hand so no timezone can shift the day. */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return "";
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** `<number>_<name>_Spec <section>_<title>_<MM-DD-YYYY>.docx` (the North HS pattern); blanks dropped. */
export function specFileName(header: SpecDocHeader, section: { number: string; title: string }): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(header.issueDate || "");
  const bits = [header.projectNumber, header.projectName, `Spec ${section.number}`, section.title, m ? `${m[2]}-${m[3]}-${m[1]}` : ""];
  const name = bits.map((b) => (b || "").replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean).join("_");
  return `${name}.docx`;
}
