import { parseTriageKey } from "./keys";

/**
 * Spec "Row actions" → Done. Task/assignment → done; thread → closed; call
 * to-do → open the meeting's to-do decision (accept as task / dismiss)
 * rather than guessing; lead/quote/visit/renewal → "Done for today" (a mark
 * that hides it in this snapshot only). Pure.
 */
export type DonePlan =
  | { kind: "task"; id: string }
  | { kind: "assignment"; id: string }
  | { kind: "thread"; id: string }
  | { kind: "open"; href: string }
  | { kind: "mark" };

export function donePlan(key: string): DonePlan | null {
  const k = parseTriageKey(key);
  if (!k) return null;
  switch (k.source) {
    case "task":
      return { kind: "task", id: k.id };
    case "assignment":
      return { kind: "assignment", id: k.id };
    case "email":
      return { kind: "thread", id: k.id };
    case "call":
      return { kind: "open", href: `/recordings/${encodeURIComponent(k.id)}?tab=actions` };
    default:
      return { kind: "mark" };
  }
}
