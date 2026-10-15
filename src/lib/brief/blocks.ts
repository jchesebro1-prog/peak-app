/**
 * AI daily brief — the card's three blocks, in Jeff's order (2026-10-15):
 * Emails, then Estimates, then Tasks. Which block a triage row belongs to,
 * the block cap, and the ★ ordering shared by the card VM (`card-vm.ts`), the
 * Listen text (`speech.ts`), the rule-built summary (`fallback.ts`) and the
 * prompt (`prompt.ts`). Pure, client-safe.
 *
 * Every triage source maps to a block (the Record is exhaustive):
 *   email                               → Emails (customers waiting on a reply — court = me)
 *   quote, lead, renewal                → Estimates (approvals / portal review / sent back, leads ready to quote, renewals)
 *   task, assignment, call, visit       → Tasks (overdue / due-today / at-risk, meeting call to-dos, today's visits)
 * A call to-do is a Task, not an Email: it is an action item from a meeting
 * with no thread and no pre-draft, like the promise-tasks Jeff put in Tasks.
 * A Do-these-first key that doesn't parse as a triage key has no block and
 * is dropped.
 */
import { parseTriageKey } from "@/lib/triage/keys";
import { TRIAGE_SOURCES, type TriageSource } from "@/lib/triage/types";

export const BRIEF_BLOCKS = ["emails", "estimates", "tasks"] as const;
export type BriefBlockId = (typeof BRIEF_BLOCKS)[number];

export const BRIEF_BLOCK_TITLE: Record<BriefBlockId, string> = { emails: "Emails", estimates: "Estimates", tasks: "Tasks" };

export const BLOCK_OF_SOURCE: Record<TriageSource, BriefBlockId> = {
  email: "emails",
  quote: "estimates",
  lead: "estimates",
  renewal: "estimates",
  task: "tasks",
  assignment: "tasks",
  call: "tasks",
  visit: "tasks",
};

/** Item rows a block shows (triage rows, quiet quotes, promise-tasks); a ★ pick past the cap still shows. */
export const BLOCK_CAP = 5;

const isSource = (s: unknown): s is TriageSource => typeof s === "string" && (TRIAGE_SOURCES as readonly string[]).includes(s);

/** A row's source: its key's prefix (the key is what the brief stores), else the row's own field; null = no block. */
export function rowSource(r: { key: string; source?: unknown }): TriageSource | null {
  return parseTriageKey(r.key)?.source ?? (isSource(r.source) ? r.source : null);
}

export function blockOfKey(key: string): BriefBlockId | null {
  const s = parseTriageKey(key)?.source;
  return s ? BLOCK_OF_SOURCE[s] : null;
}

/** Picks (in the model's order) float to the top of their group; the rest keep rank order. */
export function starFirst<T extends { key: string }>(rows: readonly T[], picks: readonly string[]): T[] {
  const rank = new Map(picks.map((k, i) => [k, i]));
  const starred = rows.filter((r) => rank.has(r.key)).sort((a, b) => rank.get(a.key)! - rank.get(b.key)!);
  return [...starred, ...rows.filter((r) => !rank.has(r.key))];
}

/**
 * The cap over a block's items in display order: every starred item stays,
 * and the others fill what is left of BLOCK_CAP, in order. Returns the kept
 * items and the hidden ones.
 */
export function capBlock<T>(items: readonly T[], starred: (t: T) => boolean, cap = BLOCK_CAP): { shown: T[]; hidden: T[] } {
  let room = Math.max(0, cap - items.filter(starred).length);
  const shown: T[] = [];
  const hidden: T[] = [];
  for (const it of items) {
    if (starred(it)) shown.push(it);
    else if (room > 0) {
      shown.push(it);
      room--;
    } else hidden.push(it);
  }
  return { shown, hidden };
}
