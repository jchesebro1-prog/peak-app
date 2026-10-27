import { fmtFeet, parseFeet } from "./units";

/** #370: what a length box does with its draft. */
export type LengthDecision =
  | { kind: "none" } // the draft is still what the box showed — nothing was edited, so nothing is committed
  | { kind: "bad" } // the text isn't a length
  | { kind: "settle"; ft: number } // a valid edit that lands on the current length: just reformat the box
  | { kind: "commit"; ft: number };

/**
 * Enter or blur in a length box. The box shows `value` rounded to the inch, so an untouched draft must never
 * commit (31.2345 shows as 31'-3" and would otherwise snap to 31.25 on a bare tab-through). Escape sets the
 * draft back to `fmtFeet(value)`, which this reads as "none" — a revert never commits.
 */
export function decideLengthCommit(draft: string, value: number): LengthDecision {
  if (draft === fmtFeet(value)) return { kind: "none" };
  const ft = parseFeet(draft);
  if (ft === null) return { kind: "bad" };
  return Math.abs(ft - value) > 1e-6 ? { kind: "commit", ft } : { kind: "settle", ft };
}

/** True for an element the user types into — editor shortcuts (undo, delete, Escape) leave those alone. */
export function isTypingTarget(t: { tagName?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!t) return false;
  const tag = (t.tagName || "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable === true;
}
