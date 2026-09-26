import type { SpecSection } from "@/lib/specs/sections";

/**
 * [FILL IN: …] blanks in a section's Part 1/3 (#205 Phase B, D327). Pure.
 * A blank is keyed by its article and its position in that article's body
 * (`${articleId}#${n}`, n from 1) — two "number of days" blanks in one
 * article are two fields. A saved answer whose key no longer exists is
 * "stale": shown in the builder, never applied elsewhere.
 */

const FILL_IN_RE = /\[FILL IN:\s*([^\]]*)\]/g;

export type FillInSlot = { key: string; part: 1 | 3; articleId: string; articleTitle: string; index: number; label: string };

export function fillInSlots(section: SpecSection): FillInSlot[] {
  const out: FillInSlot[] = [];
  const scan = (part: 1 | 3) => {
    for (const a of part === 1 ? section.part1 : section.part3) {
      let n = 0;
      for (const m of a.body.matchAll(FILL_IN_RE)) {
        n++;
        out.push({ key: `${a.id}#${n}`, part, articleId: a.id, articleTitle: a.title, index: n, label: m[1].trim() });
      }
    }
  };
  scan(1);
  scan(3);
  return out;
}

export function applyFillIns(body: string, articleId: string, answers: Record<string, string>): string {
  let n = 0;
  return String(body || "").replace(FILL_IN_RE, (whole) => {
    n++;
    const v = (answers[`${articleId}#${n}`] || "").replace(/\s+/g, " ").trim();
    return v || whole;
  });
}

export function staleFillInKeys(section: SpecSection, answers: Record<string, string>): string[] {
  const live = new Set(fillInSlots(section).map((s) => s.key));
  return Object.keys(answers).filter((k) => !live.has(k) && (answers[k] || "").trim() !== "");
}
