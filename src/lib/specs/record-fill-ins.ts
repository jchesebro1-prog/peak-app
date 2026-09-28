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

export function applyJobValues(
  text: string,
  specId: string,
  answers: Record<string, string>,
  labels?: Record<string, string>
): string {
  let n = 0;
  return String(text || "").replace(JOB_VALUE_RE, (whole, defaultText: string) => {
    n++;
    const key = `${specId}#${n}`;
    if (labelMismatch(labels, key, defaultText.trim())) return whole;
    const v = (answers[key] || "").replace(/\s+/g, " ").trim();
    return v || whole;
  });
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

/**
 * The label to store beside a job-value answer (`fillInLabels[key]`), or
 * `null` when `key` is not a job value of a record this doc prints (Task 9).
 * `printed` is the assembly's `usedRecords` (`{ specId: revision }`); the
 * text scanned is the one that prints — a project-only override's when the
 * doc has one, else the record's own — so the label always matches the
 * bracket the builder showed. The label is the normalized default text, the
 * same form `labelMismatch` compares (D332 staleness).
 */
export function jobValueAnswerLabel(
  key: string,
  printed: Record<string, number>,
  records: ReadonlyArray<{ specId: string; specText: string }>,
  overrides: Record<string, { specText: string }>
): string | null {
  const k = String(key || "");
  const hash = k.lastIndexOf("#");
  if (hash <= 0) return null;
  const specId = k.slice(0, hash);
  if (!Object.prototype.hasOwnProperty.call(printed, specId)) return null;
  const ov = Object.prototype.hasOwnProperty.call(overrides, specId) ? overrides[specId] : undefined;
  const text = ov ? ov.specText : records.find((r) => r.specId === specId)?.specText;
  if (text == null) return null;
  const slot = jobValueSlots(specId, text).find((s) => s.key === k);
  return slot ? fillInLabelKey(slot.defaultText) : null;
}
