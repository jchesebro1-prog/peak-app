/**
 * The Specs module's text engine (Phase A, #205).
 *
 * Bodies in the spec library are plain text, one item per line, indented two
 * spaces per level (a tab counts as one level). This module is the ONLY place
 * that turns that text into numbered outline lines, so the part editor's live
 * preview, the section editor's preview and Phase B's docx builder cannot
 * disagree about what a body prints as.
 *
 * Pure on purpose: no store imports, no Date.now(), no environment. That is
 * what lets the same function run in a client component and in a server
 * action, and what makes every rule below testable in the pure harness.
 */

export const OUTLINE_LABELS = ["A.", "1.", "a.", "1)", "a)"] as const;
export const MAX_OUTLINE_DEPTH = OUTLINE_LABELS.length;

export type OutlineLine = { depth: number; label: string; text: string };
export type OutlineResult = { lines: OutlineLine[]; warnings: string[] };

/**
 * "article" — a Part 1 / Part 3 article body, whose top level prints A., B., C.
 * "entry"   — a product entry body. The product's own letter has already
 *             consumed the first level, so the body's top level prints 1., 2.
 */
export type OutlineContext = "article" | "entry";

export type PlaceholderContext = {
  /** Part 2 article titles present in the document being assembled. */
  articles?: string[];
  /** The enclosing article's acceptable manufacturers, in order. */
  manufacturers?: string[];
  project?: { number?: string; name?: string; phase?: string; issueDate?: string };
  section?: { number?: string; title?: string };
};

/** 1 → A, 26 → Z, 27 → AA. */
function alpha(n: number): string {
  let out = "";
  let x = Math.max(1, Math.floor(n));
  while (x > 0) {
    const r = (x - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

/** Label for the n-th (1-based) item at a depth: A. / 1. / a. / 1) / a). */
export function outlineLabel(depth: number, n: number): string {
  switch (depth) {
    case 0:
      return alpha(n) + ".";
    case 1:
      return String(n) + ".";
    case 2:
      return alpha(n).toLowerCase() + ".";
    case 3:
      return String(n) + ")";
    default:
      return alpha(n).toLowerCase() + ")";
  }
}

/**
 * A label the author (or Word) already typed. Matches `A.` `a.` `1.` `1)`
 * `(a)` `(1)` followed by whitespace or end-of-string — and deliberately NOT
 * `1.1 `, which is an article number, not an outline label.
 */
const LABEL_RE = /^\(?(?:[A-Za-z]|\d{1,2})[.)](?:\s+|$)/;

export function stripLabel(text: string): string {
  return text.replace(LABEL_RE, "");
}

/**
 * Leading whitespace → level. A tab is one level; every two spaces is one.
 * An odd space count floors down (three spaces reads as one level, same as
 * two) — that is the right reading of "two spaces per level", so a stray
 * pasted space is silently absorbed rather than flagged.
 */
function depthOf(line: string): number {
  let levels = 0;
  let spaces = 0;
  for (const ch of line) {
    if (ch === "\t") levels++;
    else if (ch === " ") spaces++;
    else break;
  }
  return levels + Math.floor(spaces / 2);
}

export function parseOutline(body: string, context: OutlineContext = "article"): OutlineResult {
  const offset = context === "entry" ? 1 : 0;
  const counters = new Array<number>(MAX_OUTLINE_DEPTH).fill(0);
  const lines: OutlineLine[] = [];
  const warnings: string[] = [];
  // Source indentation of each currently open level: stack[i] is the indent of
  // the line rendered at depth i. A stack is what makes two lines with the SAME
  // indentation land at the SAME depth — tracking only the previous line's depth
  // does not, because clamping a jump raises the baseline and the next equally
  // indented sibling then sails through unclamped. This also buys, for free: a
  // deeper line always pushes exactly one level, so depth can never jump by
  // more than one; a first line at any indentation lands at depth 0 because
  // the stack starts empty; and the MAX_OUTLINE_DEPTH clamp below now affects
  // only the rendered depth, leaving the source structure on the stack intact.
  const open: number[] = [];
  let clamped = false;

  for (const raw of String(body || "").split(/\r?\n/)) {
    const text = stripLabel(raw.trim());
    if (!text) continue;

    const level = depthOf(raw);
    while (open.length && level < open[open.length - 1]) open.pop();
    if (!open.length || level > open[open.length - 1]) open.push(level);

    let depth = offset + open.length - 1;
    if (depth >= MAX_OUTLINE_DEPTH) {
      depth = MAX_OUTLINE_DEPTH - 1;
      clamped = true;
    }

    counters[depth]++;
    for (let j = depth + 1; j < MAX_OUTLINE_DEPTH; j++) counters[j] = 0;
    lines.push({ depth, label: outlineLabel(depth, counters[depth]), text });
  }

  if (clamped) {
    warnings.push(
      `Outline deeper than ${MAX_OUTLINE_DEPTH} levels — the deepest items print at level ${MAX_OUTLINE_DEPTH}.`
    );
  }
  return { lines, warnings };
}

export function outlineToText(lines: OutlineLine[], indent = "  "): string {
  return lines.map((l) => indent.repeat(l.depth) + l.label + " " + l.text).join("\n");
}

/**
 * Curtain-template slots. Replaces only the keys it is given and leaves every
 * other `{{…}}` untouched, so `substitutePlaceholders` can have the last word
 * (and warn) about anything nobody filled.
 */
export function fillSlots(text: string, slots: Record<string, string>): string {
  return String(text || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(slots, key) ? slots[key] : whole
  );
}

const SOLO_RE = /^\{\{\s*([\w.]+)\s*\}\}$/;
const ANY_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

export function substitutePlaceholders(
  body: string,
  ctx: PlaceholderContext
): { text: string; warnings: string[] } {
  const warnings: string[] = [];
  const lists: Record<string, string[] | undefined> = {
    articles: ctx.articles,
    manufacturers: ctx.manufacturers,
  };
  const scalars: Record<string, string | undefined> = {
    "project.number": ctx.project?.number,
    "project.name": ctx.project?.name,
    "project.phase": ctx.project?.phase,
    "project.issueDate": ctx.project?.issueDate,
    "section.number": ctx.section?.number,
    "section.title": ctx.section?.title,
  };

  const out: string[] = [];
  for (const raw of String(body || "").split(/\r?\n/)) {
    const lead = /^[ \t]*/.exec(raw)?.[0] ?? "";
    const solo = SOLO_RE.exec(raw.trim());
    if (solo && Object.hasOwn(lists, solo[1])) {
      const items = lists[solo[1]] ?? [];
      if (!items.length) {
        warnings.push(`{{${solo[1]}}} had no values — the line was dropped.`);
        continue;
      }
      // One level deeper than the placeholder's own line.
      for (const item of items) out.push(lead + "  " + item);
      continue;
    }
    out.push(
      raw.replace(ANY_RE, (whole, key: string) => {
        if (Object.hasOwn(lists, key)) {
          const items = lists[key] ?? [];
          if (!items.length) {
            warnings.push(`{{${key}}} had no values — printed as written.`);
            return whole;
          }
          return items.join(", ");
        }
        if (Object.hasOwn(scalars, key)) {
          const v = scalars[key];
          if (v == null || v === "") {
            warnings.push(`{{${key}}} has no value yet — printed as written.`);
            return whole;
          }
          return v;
        }
        warnings.push(`Unknown placeholder {{${key}}} — printed as written.`);
        return whole;
      })
    );
  }
  return { text: out.join("\n"), warnings: [...new Set(warnings)] };
}

/**
 * The pipeline every caller actually wants: substitute placeholders, then parse
 * the result as an outline, with BOTH warning lists merged. Compose the two by
 * hand only if you have a reason to — doing so is how a caller loses the
 * substitution's warnings without noticing.
 */
export function renderBody(
  body: string,
  opts?: { context?: OutlineContext; placeholders?: PlaceholderContext }
): OutlineResult {
  const sub = substitutePlaceholders(body, opts?.placeholders ?? {});
  const parsed = parseOutline(sub.text, opts?.context ?? "article");
  return { lines: parsed.lines, warnings: [...new Set([...sub.warnings, ...parsed.warnings])] };
}
