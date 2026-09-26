import type { SpecSection } from "@/lib/specs/sections";

/**
 * [FILL IN: …] blanks in a section's Part 1/3 (#205 Phase B, D327). Pure.
 * A blank is keyed by its article and its position in that article's body
 * (`${articleId}#${n}`, n from 1) — two "number of days" blanks in one
 * article are two fields. A saved answer whose key no longer exists is
 * "stale": shown in the builder, never applied elsewhere.
 *
 * Positions shift when the library text changes, so each answer also stores
 * the label of the blank it was written for (`SpecDocument.fillInLabels`,
 * normalized by `fillInLabelKey`). An answer whose stored label no longer
 * matches the blank now at its key is stale too — it never silently lands
 * in a different blank. An answer saved before labels were stored (no label)
 * keeps applying by position, as before (#205 spec builder final fix 4).
 */

const FILL_IN_RE = /\[FILL IN:\s*([^\]]*)\]/g;
/** Words of lead-in text shown before a blank in the builder's field label. */
const CONTEXT_WORDS = 6;

export type FillInSlot = {
  key: string;
  part: 1 | 3;
  articleId: string;
  articleTitle: string;
  index: number;
  label: string;
  /** Up to ~6 words of the text just before the blank on its line ("…
   *  Submit shop drawings within"), so two "number of days" blanks in one
   *  article read differently in the builder. "" when the blank opens its line. */
  context: string;
};

/** The comparable form of a blank's label: whitespace collapsed, lowercase. */
export function fillInLabelKey(label: string): string {
  return String(label || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** The last few words before `at` on the same line, other blanks shown as "…". */
function contextBefore(body: string, at: number): string {
  const lineStart = body.lastIndexOf("\n", at - 1) + 1;
  const words = body
    .slice(lineStart, at)
    .replace(FILL_IN_RE, "…")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (!words.length) return "";
  const tail = words.slice(-CONTEXT_WORDS).join(" ");
  return words.length > CONTEXT_WORDS ? `… ${tail}` : tail;
}

export function fillInSlots(section: SpecSection): FillInSlot[] {
  const out: FillInSlot[] = [];
  const scan = (part: 1 | 3) => {
    for (const a of part === 1 ? section.part1 : section.part3) {
      let n = 0;
      for (const m of a.body.matchAll(FILL_IN_RE)) {
        n++;
        out.push({
          key: `${a.id}#${n}`,
          part,
          articleId: a.id,
          articleTitle: a.title,
          index: n,
          label: m[1].trim(),
          context: contextBefore(a.body, m.index ?? 0),
        });
      }
    }
  };
  scan(1);
  scan(3);
  return out;
}

/** An answer's stored label disagrees with the blank's live label. No stored
 *  label = an answer from before labels were kept: never a mismatch. */
function labelMismatch(labels: Record<string, string> | undefined, key: string, liveLabel: string): boolean {
  const stored = labels?.[key];
  return stored != null && stored !== "" && fillInLabelKey(stored) !== fillInLabelKey(liveLabel);
}

export function applyFillIns(body: string, articleId: string, answers: Record<string, string>, labels?: Record<string, string>): string {
  let n = 0;
  return String(body || "").replace(FILL_IN_RE, (whole, label: string) => {
    n++;
    const key = `${articleId}#${n}`;
    if (labelMismatch(labels, key, label)) return whole;
    const v = (answers[key] || "").replace(/\s+/g, " ").trim();
    return v || whole;
  });
}

/** Saved answers that no longer print: their key is gone, or the blank now
 *  at their key has a different label than the one they were written for. */
export function staleFillInKeys(section: SpecSection, answers: Record<string, string>, labels?: Record<string, string>): string[] {
  const live = new Map(fillInSlots(section).map((s) => [s.key, s.label]));
  return Object.keys(answers).filter((k) => {
    if ((answers[k] || "").trim() === "") return false;
    const label = live.get(k);
    return label == null || labelMismatch(labels, k, label);
  });
}
