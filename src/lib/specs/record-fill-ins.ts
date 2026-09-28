import { contextBefore, fillInLabelKey } from "@/lib/specs/fill-ins";

/**
 * `[bracket]` job values in spec record text (design §4, Task 6). Record
 * text is checked into the library, but some of its lines carry a per-job
 * number or choice that will differ on every project — "Supply [1]
 * transporter.", "Color [Cream, Ivory]." — written inline as the DEFAULT the
 * text prints when nobody has answered it yet.
 *
 * Any `[...]` that is NOT `[FILL IN: ...]` (that syntax stays a Part 1/3
 * blank, see fill-ins.ts) is a job-value slot. Slots are keyed `${specId}#${n}`
 * — the same shape as a fill-in key, but specId names a spec record, not an
 * article — and answers/labels live in the same `SpecDocument.fillIns` /
 * `fillInLabels` maps the builder already has, so the two kinds of blank
 * share one storage seam without colliding: `staleJobValueKeys` only looks at
 * an answer key whose specId half is a key of the `slotsBySpec` map it was
 * given, so a Part 1/3 `ar-…#n` key that happens to pass through here is
 * silently ignored, not misread as a stale job value.
 *
 * The staleness rule mirrors D332 (fill-ins.ts): an answer is stale when its
 * key no longer names a slot, or when the label it was written for
 * (normalized default text) no longer matches — so a value never lands in
 * the wrong bracket just because the text shifted and slot #2 is now a
 * different bracket.
 *
 * Pure: no store imports, no Date.now(), no environment.
 */

const JOB_VALUE_RE = /\[(?!FILL IN:)([^\[\]\n]*)\]/g;

export type JobValueSlot = {
  key: string;
  specId: string;
  index: number;
  defaultText: string;
  /** Up to ~6 words of text just before the bracket on its line, for the
   *  builder's checklist ("Job values" group) to tell two blanks apart. */
  context: string;
};

/** An answer's stored label disagrees with the slot's live default text. No
 *  stored label = an answer from before labels were kept: never a mismatch. */
function labelMismatch(labels: Record<string, string> | undefined, key: string, liveLabel: string): boolean {
  const stored = labels?.[key];
  return stored != null && stored !== "" && fillInLabelKey(stored) !== fillInLabelKey(liveLabel);
}

export function jobValueSlots(specId: string, text: string): JobValueSlot[] {
  const out: JobValueSlot[] = [];
  let n = 0;
  for (const m of String(text || "").matchAll(JOB_VALUE_RE)) {
    n++;
    out.push({
      key: `${specId}#${n}`,
      specId,
      index: n,
      defaultText: m[1].trim(),
      context: contextBefore(text, m.index ?? 0),
    });
  }
  return out;
}

/** `mark` (preview only, Task 9 fix round) wraps each answered value in
 *  JOB_VALUE_MARK_OPEN/CLOSE so `answeredSpans` can find it after the
 *  outline is rendered; the printed text never carries marks. */
export function applyJobValues(
  text: string,
  specId: string,
  answers: Record<string, string>,
  labels?: Record<string, string>,
  mark?: boolean
): string {
  let n = 0;
  return String(text || "").replace(JOB_VALUE_RE, (whole, defaultText: string) => {
    n++;
    const key = `${specId}#${n}`;
    if (labelMismatch(labels, key, defaultText.trim())) return whole;
    const v = (answers[key] || "").replace(/\s+/g, " ").trim();
    if (!v) return whole;
    return mark ? JOB_VALUE_MARK_OPEN + v + JOB_VALUE_MARK_CLOSE : v;
  });
}

/** Private-use characters (never typed, never printed) that bracket an
 *  answered job value in the marked render only. */
export const JOB_VALUE_MARK_OPEN = "\uE000";
export const JOB_VALUE_MARK_CLOSE = "\uE001";

/** Where the answered job values sit in each rendered line (design §4:
 *  subtle highlight for answered values). `plain` is the entry's printed
 *  lines; `marked` is the same text rendered with `applyJobValues(…, true)`.
 *  Each marked line, with its marks stripped, must equal the plain line —
 *  otherwise (the marks changed how a line parsed, e.g. an answer that
 *  looks like an outline label) this returns undefined and the preview
 *  simply shows no answered highlight for that entry, so the printed text
 *  is never at the mercy of the marks. `[start, end)` offsets into the
 *  plain line text; an empty list = no answered value on that line. */
export function answeredSpans(
  plain: ReadonlyArray<{ text: string }>,
  marked: ReadonlyArray<{ text: string }>
): Array<Array<{ start: number; end: number }>> | undefined {
  if (plain.length !== marked.length) return undefined;
  const out: Array<Array<{ start: number; end: number }>> = [];
  for (let i = 0; i < plain.length; i++) {
    const spans: Array<{ start: number; end: number }> = [];
    let text = "";
    let open = -1;
    for (const ch of marked[i].text) {
      if (ch === JOB_VALUE_MARK_OPEN) {
        if (open >= 0) return undefined;
        open = text.length;
      } else if (ch === JOB_VALUE_MARK_CLOSE) {
        if (open < 0) return undefined;
        if (text.length > open) spans.push({ start: open, end: text.length });
        open = -1;
      } else text += ch;
    }
    if (open >= 0 || text !== plain[i].text) return undefined;
    out.push(spans);
  }
  return out;
}

/** Saved answers that no longer print: their key's specId isn't in the map
 *  it was given at all (a Part 1/3 fill-in key, or a spec this caller isn't
 *  scoping), their key names no slot for that spec, or the slot now at their
 *  key has a different default text than the one they were written for. */
export function staleJobValueKeys(
  slotsBySpec: Map<string, JobValueSlot[]>,
  answers: Record<string, string>,
  labels?: Record<string, string>
): string[] {
  return Object.keys(answers).filter((key) => {
    if ((answers[key] || "").trim() === "") return false;
    const hash = key.lastIndexOf("#");
    if (hash < 0) return false;
    const specId = key.slice(0, hash);
    const slots = slotsBySpec.get(specId);
    if (!slots) return false;
    const slot = slots.find((s) => s.key === key);
    if (!slot) return true;
    return labelMismatch(labels, key, slot.defaultText);
  });
}

/** Splits text into plain/bracket segments for preview highlighting (amber
 *  unanswered, subtle answered — the caller decides which, per design §4). */
export function jobValueSegments(text: string): Array<{ text: string; bracket: boolean }> {
  const s = String(text || "");
  const out: Array<{ text: string; bracket: boolean }> = [];
  let last = 0;
  for (const m of s.matchAll(JOB_VALUE_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: s.slice(last, i), bracket: false });
    out.push({ text: m[0], bracket: true });
    last = i + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), bracket: false });
  return out;
}

