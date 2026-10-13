/**
 * Inbox organization §1 step 3 — record numbers written in free text
 * (subject, then body). Pure: this only finds and parses; whether a number
 * names a live record is the pipeline's job (a dead number is ignored there).
 */
import { ESTIMATE_PREFIX, parseEstimateNumber } from "@/lib/estimate-number";

export type FoundEstimateNumber = { raw: string; estNo: number; suffix: number | null; prefix: string };

const PREFIXES = [...new Set(Object.values(ESTIMATE_PREFIX))].join("|");

/** Not after a word char, `-`, or URL / address punctuation (`/` `.` `=` `?`
 *  `@`), so `TEST-1042`, `/REP-1234.pdf`, `?ref=EST-1042` miss. */
const BEFORE = "(?<![\\w\\-/.=?@])";
/** Not followed by a word char, `-<digit>` or `@` (`EST-1042-2026`,
 *  `est-1042@x.com` are no match at all rather than a wrong half-match). */
const AFTER = "(?!\\w)(?![-\\u2013\\u2014]\\d)(?!@)";

/** `EST-1042`, `EST–1042-2`. The prefix must be upper-case as printed —
 *  except EST, the everyday system-quote prefix people retype as `est-1042`
 *  (no English word is spelled est-<digits>); lower-case `con-`/`rep-`/`rnt-`
 *  collide with ordinary text ("con-2026", "rep-2026") and are not read. The
 *  number is 4+ digits (the shared counter starts at 1001); an optional
 *  `-N` suffix of 1–3 digits. */
const ESTIMATE_RE = new RegExp(`${BEFORE}(${PREFIXES}|[Ee][Ss][Tt])[-\\u2013\\u2014](\\d{4,9})(?:[-\\u2013\\u2014](\\d{1,3}))?${AFTER}`, "g");

/** Every display estimate number in `text`, deduped, in order of appearance.
 *  Each match is checked by `parseEstimateNumber` (suffix 0 is refused); a
 *  `-1` suffix names the first quote, so it reads as the bare number. */
export function findEstimateNumbers(text: string): FoundEstimateNumber[] {
  const out: FoundEstimateNumber[] = [];
  const seen = new Set<string>();
  for (const m of String(text ?? "").matchAll(ESTIMATE_RE)) {
    const canonical = `${m[1].toUpperCase()}-${m[2]}${m[3] ? "-" + m[3] : ""}`;
    const p = parseEstimateNumber(canonical);
    if (!p || !p.prefix) continue;
    const suffix = p.suffix === 1 ? null : p.suffix;
    const key = `${p.prefix}|${p.estNo}|${suffix ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ raw: m[0], estNo: p.estNo, suffix, prefix: p.prefix });
  }
  return out;
}

/** Internal record ids: projects `P-####` (kind project) and `S-####` (kind
 *  order), leads `L-####`. Upper-case only, bounded the same way. */
const RECORD_RE = new RegExp(`${BEFORE}([PSL])-(\\d{4,9})${AFTER}`, "g");

export function findRecordIds(text: string): { projects: string[]; leads: string[] } {
  const projects: string[] = [];
  const leads: string[] = [];
  for (const m of String(text ?? "").matchAll(RECORD_RE)) {
    const id = `${m[1]}-${m[2]}`;
    const list = m[1] === "L" ? leads : projects;
    if (!list.includes(id)) list.push(id);
  }
  return { projects, leads };
}
