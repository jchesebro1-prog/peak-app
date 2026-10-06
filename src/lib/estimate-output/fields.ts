import type { SpecSection } from "@/app/(app)/estimator/types";

/**
 * #301 slice A — the estimate-output fields on a system (SpecSection.discipline,
 * clientGoals, coverText) and on the quote (coverSummary, notIncluded), and
 * their cleaning. Pure and client-safe (type-only imports): the Estimator UI,
 * the save actions, the survey save and the harness all use these.
 */

export type ScopeDiscipline = NonNullable<SpecSection["discipline"]>;
/** The survey's DisciplineKey set (survey-intake.ts) — the harness pins the two equal. */
export const DISCIPLINES: readonly ScopeDiscipline[] = ["lighting", "rigging", "curtain", "av"];
export const DISCIPLINE_LABEL: Record<ScopeDiscipline, string> = { lighting: "Lighting", rigging: "Rigging", curtain: "Curtains", av: "AV" };

export const CLIENT_GOALS_MAX = 1_000;
export const COVER_TEXT_MAX = 1_500;
export const COVER_SUMMARY_MAX = 3_000;
export const NOT_INCLUDED_MAX = 3_000;
export const WEBSITE_MAX = 200;

/** Keeps tab (9), newline (10) and every printable character; drops other C0 controls and DEL. */
function stripControls(s: string): string {
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c === 9 || c === 10 || (c >= 32 && c !== 127)) out += ch;
  }
  return out;
}

/** Plain text as stored: CRLF → LF, controls dropped, trimmed, capped. "" for a non-string. */
export function cleanPlainText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return stripControls(v.replace(/\r\n?/g, "\n")).trim().slice(0, max).trimEnd();
}

export function sanitizeDiscipline(v: unknown): ScopeDiscipline | null {
  return typeof v === "string" && (DISCIPLINES as readonly string[]).includes(v) ? (v as ScopeDiscipline) : null;
}

/** R19: word-boundary keywords, first rule wins. `track` is never a keyword on
 *  its own — "Track lighting" is lighting, "Curtain track" is a curtain. */
const DISCIPLINE_RULES: ReadonlyArray<readonly [ScopeDiscipline, RegExp]> = [
  ["lighting", /\blight(?:s|ing)?\b|\bdimm(?:er|ers|ing)\b|\bfixtures?\b/i],
  ["rigging", /\brigging\b|\bhoists?\b|\bbattens?\b/i],
  ["curtain", /\bcurtains?\b|\bdrape(?:s|ry)?\b|\bvalances?\b|\bcycs?\b|\bcyclorama\b|\bsoft goods\b/i],
  ["av", /\bav\b|\ba\/v\b|\baudio\b|\bvideo\b|\bsound\b|\bprojection\b/i],
];

/** For goal matching and display only — never stored by inference (D-b). */
export function inferDiscipline(name: unknown): ScopeDiscipline | null {
  if (typeof name !== "string" || !name.trim()) return null;
  for (const [d, re] of DISCIPLINE_RULES) if (re.test(name)) return d;
  return null;
}

/** Stored, else inferred from the name; a labor system never has one (R2). */
export function effectiveDiscipline(sec: Pick<SpecSection, "kind" | "name" | "discipline">): ScopeDiscipline | null {
  if (sec.kind === "labor") return null;
  return sanitizeDiscipline(sec.discipline) ?? inferDiscipline(sec.name);
}

/** The Discipline select's blank option. */
export function autoDisciplineLabel(name: string): string {
  const d = inferDiscipline(name);
  return d ? `Discipline: auto (${DISCIPLINE_LABEL[d]})` : "Discipline: —";
}

export function withDiscipline<T extends SpecSection>(sec: T, v: unknown): T {
  const out = { ...sec };
  const d = sanitizeDiscipline(v);
  if (d) out.discipline = d;
  else delete out.discipline;
  return out;
}

/** Server-side save rule (beside withSanitizedKeyProducts): a section that
 *  carries none of the three keys passes through untouched (same object);
 *  otherwise each is cleaned and a blank one is removed. */
export function withSanitizedOutputFields<T extends SpecSection>(sec: T): T {
  if (!sec || typeof sec !== "object") return sec;
  if (!("discipline" in sec) && !("clientGoals" in sec) && !("coverText" in sec)) return sec;
  const out = { ...sec };
  const d = sanitizeDiscipline(sec.discipline);
  if (d) out.discipline = d;
  else delete out.discipline;
  const g = cleanPlainText(sec.clientGoals, CLIENT_GOALS_MAX);
  if (g) out.clientGoals = g;
  else delete out.clientGoals;
  const c = cleanPlainText(sec.coverText, COVER_TEXT_MAX);
  if (c) out.coverText = c;
  else delete out.coverText;
  return out;
}

/** "Use selection as cover" — the selected intro text as one paragraph. */
export function coverTextFromSelection(text: string): string {
  return cleanPlainText(String(text || "").replace(/\s*\n\s*/g, " "), COVER_TEXT_MAX);
}

/** From site visit: fills blank goals, appends after a blank line, never duplicates. */
export function appendGoals(current: string | undefined, add: string): string {
  const cur = (current || "").trim();
  const a = cleanPlainText(add, CLIENT_GOALS_MAX);
  if (!a) return current || "";
  if (!cur) return a;
  if (cur.includes(a)) return current || "";
  return cleanPlainText(cur + "\n\n" + a, CLIENT_GOALS_MAX);
}

/** Absent (never stored) → the Settings default list; "" stays empty (D-e). */
export function effectiveNotIncluded(stored: unknown, fallback: string): string {
  return typeof stored === "string" ? stored : fallback;
}

/* ---- Settings → Estimate output (R17): one settings blob ---- */

export const ESTIMATE_OUTPUT_BLOB = "estimate_output_defaults";
export type EstimateOutputDefaults = { notIncluded: string; website: string };

export function sanitizeEstimateOutputDefaults(raw: unknown): EstimateOutputDefaults {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const lines = cleanPlainText(o.notIncluded, NOT_INCLUDED_MAX)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return { notIncluded: lines.join("\n"), website: cleanPlainText(o.website, WEBSITE_MAX).replace(/\s+/g, " ") };
}
