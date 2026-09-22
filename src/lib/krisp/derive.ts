import type { KrispNoteBlock, RecordingRecord } from "@/lib/stores/recordings";

/**
 * Pure, DB-free rules over Krisp output (Recordings spec §4). Everything the
 * app does with a Krisp meeting is deterministic (D89): this module turns the
 * raw `notes.blocks` tree into summary sections / key points / action items,
 * matches Krisp's assignee names to Peak users, and routes summary sections
 * into Survey / Inspection fields. Spec-tested in scripts/test-review-and-
 * spec.ts against a fixture shaped like the Hortonville HS site visit.
 *
 * Krisp does NOT publish the `NoteBlock.type` enum, so every rule here is a
 * heuristic over `type` and `text` and unknown types are treated as prose —
 * nothing in this file may throw on a block it doesn't recognise.
 */

/* ---------- deriveSummary ---------- */

export type DerivedActionItem = {
  key: string;
  title: string;
  assigneeName: string | null;
  dueDate: string | null;
};

export type DerivedSummary = {
  summary: { title: string; description: string }[];
  keyPoints: string[];
  actionItems: DerivedActionItem[];
};

const HEADING_TYPE_RE = /head|title|section/i;
const KEYPOINTS_TITLE_RE = /key ?points?|highlights?/i;
const ACTION_TITLE_RE = /action|next steps?|to.?dos?|tasks?/i;
const ACTION_TYPE_RE = /action|task|todo|checkbox/i;

function textOf(b: unknown): string {
  if (!b || typeof b !== "object") return "";
  const t = (b as KrispNoteBlock).text;
  return typeof t === "string" ? t.trim() : "";
}

function childrenOf(b: unknown): KrispNoteBlock[] {
  if (!b || typeof b !== "object") return [];
  const c = (b as KrispNoteBlock).children;
  return Array.isArray(c) ? c.filter((x) => x && typeof x === "object") : [];
}

function typeOf(b: unknown): string {
  if (!b || typeof b !== "object") return "";
  const t = (b as KrispNoteBlock).type;
  return typeof t === "string" ? t : "";
}

function isHeadingType(b: KrispNoteBlock): boolean {
  return HEADING_TYPE_RE.test(typeOf(b));
}

function isActionBlock(b: KrispNoteBlock): boolean {
  return b.completed !== undefined || ACTION_TYPE_RE.test(typeOf(b));
}

/** Every text line in a subtree, depth-first, nested levels as "- " bullets. */
function flattenLines(blocks: KrispNoteBlock[], depth = 0): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    const t = textOf(b);
    if (t) out.push(depth > 0 ? `${"  ".repeat(depth - 1)}- ${t}` : t);
    const kids = childrenOf(b);
    if (kids.length) out.push(...flattenLines(kids, t ? depth + 1 : depth));
  }
  return out;
}

/** Every block in a subtree that carries text (for list-shaped children). */
function flattenBlocks(blocks: KrispNoteBlock[]): KrispNoteBlock[] {
  const out: KrispNoteBlock[] = [];
  for (const b of blocks) {
    if (textOf(b)) out.push(b);
    out.push(...flattenBlocks(childrenOf(b)));
  }
  return out;
}

function assigneeNameOf(b: KrispNoteBlock): string | null {
  const a = b.assignee;
  if (typeof a === "string") return a.trim() || null;
  if (a && typeof a === "object") {
    const o = a as Record<string, unknown>;
    const first = typeof o.first_name === "string" ? o.first_name.trim() : "";
    const last = typeof o.last_name === "string" ? o.last_name.trim() : "";
    const full = [first, last].filter(Boolean).join(" ");
    if (full) return full;
    if (typeof o.name === "string" && o.name.trim()) return o.name.trim();
    if (typeof o.email === "string" && o.email.trim()) return o.email.trim();
  }
  return null;
}

function dueDateOf(b: KrispNoteBlock): string | null {
  const d = b.due_date ?? (b as Record<string, unknown>).dueDate;
  return typeof d === "string" && d.trim() ? d.trim() : null;
}

/**
 * Small, dependency-free 64-bit-ish string hash (two FNV-1a 32-bit lanes),
 * returned as 10 hex chars. Node-free so this module can be imported by the
 * "From recording" client panel as well as the server poller.
 */
export function shortHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x0100019b) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 10);
}

export function normalizeActionTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/g, "").trim();
}

/**
 * Stable action-item key: hash of the normalized title + its ordinal among
 * same-titled items (Krisp blocks carry no id — spec §1.1). Rerunning over
 * the same notes yields identical keys, so dispositions survive (§4.1).
 */
export function actionItemKey(title: string, ordinal: number): string {
  return shortHash(`${normalizeActionTitle(title)}#${ordinal}`);
}

/**
 * Walk Krisp's block tree into the record's derived fields (spec §4.1).
 *
 * - heading-typed block (`/head|title|section/i`) with children → one
 *   summary section: title = its text, description = children's text joined
 *   by "\n", nested levels as "- " bullets. A heading with NO children adopts
 *   the non-heading siblings that follow it (flat exports), until the next
 *   heading.
 *   - heading text `/key ?points?|highlights?/i` → its lines become keyPoints
 *   - heading text `/action|next steps?|to.?dos?|tasks?/i` → its lines become
 *     action items (and no section — the Home Queue handles them, §4.2/§4.4)
 * - any block with `completed !== undefined` or a `/action|task|todo|checkbox/i`
 *   type → an action item wherever it sits
 * - top-level prose with no heading parent → one trailing section titled "Notes"
 * - unknown types are prose; blocks with no text contribute nothing; never throws
 */
export function deriveSummary(notes: { blocks: KrispNoteBlock[] } | null | undefined): DerivedSummary {
  const summary: DerivedSummary["summary"] = [];
  const keyPoints: string[] = [];
  const rawActions: { title: string; assigneeName: string | null; dueDate: string | null }[] = [];
  const notesLines: string[] = [];

  const blocks: KrispNoteBlock[] = Array.isArray(notes?.blocks)
    ? notes!.blocks.filter((b) => b && typeof b === "object")
    : [];

  const pushAction = (b: KrispNoteBlock) => {
    const title = textOf(b);
    if (!title) return;
    rawActions.push({ title, assigneeName: assigneeNameOf(b), dueDate: dueDateOf(b) });
  };

  // Action items anywhere in the tree by shape/type (not by heading).
  const collectActionsDeep = (list: KrispNoteBlock[]) => {
    for (const b of list) {
      if (isActionBlock(b)) pushAction(b);
      collectActionsDeep(childrenOf(b));
    }
  };

  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (isHeadingType(b)) {
      const rawTitle = textOf(b);
      const title = rawTitle || "Section";
      let kids = childrenOf(b);
      i++;
      if (!kids.length) {
        // flat export: adopt following non-heading siblings
        const adopted: KrispNoteBlock[] = [];
        while (i < blocks.length && !isHeadingType(blocks[i])) {
          adopted.push(blocks[i]);
          i++;
        }
        kids = adopted;
      }
      if (KEYPOINTS_TITLE_RE.test(title)) {
        keyPoints.push(...flattenLines(kids).map((l) => l.replace(/^(\s*-\s*)+/, "")));
        collectActionsDeep(kids);
      } else if (ACTION_TITLE_RE.test(title)) {
        // every text-bearing block under an action heading is an item
        for (const item of flattenBlocks(kids)) pushAction(item);
      } else {
        const description = flattenLines(kids).join("\n");
        // a heading with neither text nor content contributes nothing
        if (description || rawTitle) summary.push({ title, description });
        collectActionsDeep(kids);
      }
      continue;
    }
    // non-heading at top level
    if (isActionBlock(b)) {
      pushAction(b);
      collectActionsDeep(childrenOf(b));
    } else {
      const lines = flattenLines([b]);
      notesLines.push(...lines);
      collectActionsDeep(childrenOf(b));
    }
    i++;
  }

  if (notesLines.length) summary.push({ title: "Notes", description: notesLines.join("\n") });

  // stable keys: ordinal among same normalized titles
  const seen = new Map<string, number>();
  const actionItems: DerivedActionItem[] = rawActions.map((a) => {
    const norm = normalizeActionTitle(a.title);
    const ordinal = seen.get(norm) ?? 0;
    seen.set(norm, ordinal + 1);
    return { key: actionItemKey(a.title, ordinal), ...a };
  });

  return { summary, keyPoints, actionItems };
}

/* ---------- matchAssignee ---------- */

export type AssignableUser = { id: string; name: string };

/**
 * Krisp's assignee name → a Peak user, or null (spec §4.2). Exact
 * case-insensitive full-name match first; otherwise a UNIQUE first-word
 * match — the same rule the Peak/Assign Gmail label interpreter uses
 * (src/lib/gmail/label-interpret.ts, #96: two active users can share a
 * first name, so require exactly one match and never guess). Ambiguity or
 * no match → null and the picker defaults to the recorder.
 */
export function matchAssignee<U extends AssignableUser>(
  name: string | null | undefined,
  users: readonly U[]
): U | null {
  const needle = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!needle) return null;
  const exact = users.filter((u) => u.name.trim().toLowerCase().replace(/\s+/g, " ") === needle);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const first = needle.split(" ")[0];
  const byFirst = users.filter((u) => u.name.trim().split(/\s+/)[0].toLowerCase() === first);
  return byFirst.length === 1 ? byFirst[0] : null;
}

/* ---------- prefill routing (spec §4.4) ---------- */

export type SurveyPrefillTarget =
  | { kind: "map"; field: "measurements"; key: string }
  | { kind: "text"; field: "notes" | "scopeOfWork" }
  | { kind: "skip" };

export type InspectionPrefillTarget =
  | { kind: "map"; field: "measurements" | "venueInfo"; key: string }
  | { kind: "text"; field: "narrative" }
  | { kind: "skip" };

/** Rule-table entries: a `map` target without `key` takes "From recording · <title>". */
type SurveyRuleTarget =
  | { kind: "map"; field: "measurements"; key?: string }
  | { kind: "text"; field: "notes" | "scopeOfWork" }
  | { kind: "skip" };
type InspectionRuleTarget =
  | { kind: "map"; field: "measurements" | "venueInfo"; key?: string }
  | { kind: "text"; field: "narrative" }
  | { kind: "skip" };

export type PrefillRule = {
  match: RegExp;
  survey: SurveyRuleTarget;
  inspection: InspectionRuleTarget;
};

/** Spec §4.4 table, in order — first matching rule wins. */
export const PREFILL_RULES: readonly PrefillRule[] = [
  {
    match: /measure|dimension|size|height|width|depth|proscenium|grid/i,
    survey: { kind: "map", field: "measurements" },
    inspection: { kind: "map", field: "measurements" },
  },
  {
    match: /rigging|lineset|line set|batten|arbor|fly/i,
    survey: { kind: "text", field: "notes" },
    inspection: { kind: "text", field: "narrative" },
  },
  {
    match: /curtain|drape|soft goods|track|border|valance/i,
    survey: { kind: "text", field: "scopeOfWork" },
    inspection: { kind: "text", field: "narrative" },
  },
  {
    // v1: survey notes (typed access fields are a follow-up); inspection venueInfo["Access"]
    match: /access|dock|elevator|door|lift|parking|hours|badge/i,
    survey: { kind: "text", field: "notes" },
    inspection: { kind: "map", field: "venueInfo", key: "Access" },
  },
  {
    // handled by §4.2 (action items → Home Queue), never inserted as prose
    match: /next step|follow.?up|action/i,
    survey: { kind: "skip" },
    inspection: { kind: "skip" },
  },
];

export const PREFILL_DEFAULT: PrefillRule = {
  match: /.*/,
  survey: { kind: "text", field: "notes" },
  inspection: { kind: "text", field: "narrative" },
};

export function prefillMapKey(title: string): string {
  return `From recording · ${title.trim()}`;
}

export type PrefillRoute = { survey: SurveyPrefillTarget; inspection: InspectionPrefillTarget };

/** Route a summary section title to its Survey + Inspection targets (spec §4.4). */
export function routePrefill(sectionTitle: string): PrefillRoute {
  const title = (sectionTitle ?? "").trim();
  const rule = PREFILL_RULES.find((r) => r.match.test(title)) ?? PREFILL_DEFAULT;
  const survey: SurveyPrefillTarget =
    rule.survey.kind === "map"
      ? { kind: "map", field: rule.survey.field, key: rule.survey.key ?? prefillMapKey(title) }
      : rule.survey;
  const inspection: InspectionPrefillTarget =
    rule.inspection.kind === "map"
      ? { kind: "map", field: rule.inspection.field, key: rule.inspection.key ?? prefillMapKey(title) }
      : rule.inspection;
  return { survey, inspection };
}

/** The text Insert appends to the target (spec §4.4). */
export function prefillInsertText(recId: string, title: string, description: string): string {
  return `\n\n[from ${recId}] ${title}: ${description}`;
}

/** Stable key for a summary section (prefill.insertedKeys) — title-based, ordinal-safe. */
export function summarySectionKey(title: string, ordinal: number): string {
  return shortHash(`${normalizeActionTitle(title)}#${ordinal}`);
}

/* ---------- ⌘K ---------- */

/** Summary titles + descriptions joined — the ⌘K search text (spec §4.5). */
export function summarySearchText(rec: Pick<RecordingRecord, "summary">): string {
  return (rec.summary ?? [])
    .flatMap((s) => [s.title, s.description])
    .filter(Boolean)
    .join(" ");
}
