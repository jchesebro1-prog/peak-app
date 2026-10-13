/**
 * AI daily brief — the model's answer, made safe (spec §1 step 4). Model text
 * is untrusted: the summary becomes capped plain text, and Do-these-first
 * keeps only keys that are rows of the snapshot (3–5, padded from the top
 * rows when the model gives fewer). Pure, client-safe.
 */
import { z } from "zod";
import type { BriefDoFirst, BriefText } from "./types";

export const BRIEF_SUMMARY_MAX = 900;
export const BRIEF_WHY_MAX = 160;
export const DO_FIRST_MIN = 3;
export const DO_FIRST_MAX = 5;

/** Structured-output schema for the `brief` call. */
export const BriefSchema = z.strictObject({
  summary: z.string(),
  doFirst: z.array(z.strictObject({ key: z.string(), why: z.string() })),
});

/** Cap at `max` chars, cutting on a word boundary and ending with "…". */
function cap(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd() + "…";
}

/**
 * Plain text: control characters dropped, markdown emphasis / headings /
 * bullets / code ticks removed, whitespace collapsed to single spaces, capped.
 * HTML is left as text — React escapes it.
 */
export function cleanBriefText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const s = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|__|\*|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cap(s, max);
}

/**
 * The model's raw output → `{ summary, doFirst }`, or null when it fails the
 * schema or has no summary (the caller then uses the rule-built brief).
 * `rowKeys` are the snapshot's row keys in rank order; `reasons` (by key) fill
 * the why of padded items.
 */
export function sanitizeBrief(raw: unknown, rowKeys: readonly string[], reasons: Readonly<Record<string, string>> = {}): BriefText | null {
  const parsed = BriefSchema.safeParse(raw);
  if (!parsed.success) return null;
  const summary = cleanBriefText(parsed.data.summary, BRIEF_SUMMARY_MAX);
  if (!summary) return null;
  const allowed = new Set(rowKeys);
  const seen = new Set<string>();
  const doFirst: BriefDoFirst[] = [];
  for (const item of parsed.data.doFirst) {
    if (doFirst.length >= DO_FIRST_MAX) break;
    const key = item.key.trim();
    if (!allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    doFirst.push({ key, why: cleanBriefText(item.why, BRIEF_WHY_MAX) });
  }
  const want = Math.min(DO_FIRST_MIN, rowKeys.length);
  for (const key of rowKeys) {
    if (doFirst.length >= want) break;
    if (seen.has(key)) continue;
    seen.add(key);
    doFirst.push({ key, why: cleanBriefText(reasons[key] ?? "", BRIEF_WHY_MAX) });
  }
  return { summary, doFirst };
}
