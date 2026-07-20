/**
 * Queue shapes + labels (D93) — dependency-free so the "use client" view can
 * import the VALUES (SOURCE_LABEL) without dragging the stores, and
 * therefore PGlite, into the browser bundle. The assembly itself lives in
 * `lib/queue.ts`, which is server-only. Same lesson as `consulting/tabs.ts`.
 */

export type QueueSource =
  | "assignment"
  | "quote-review"
  | "phase-review"
  | "checklist"
  | "milestone"
  | "project-task"
  | "flame-renewal"
  | "inspection-renewal";

export type QueueItem = {
  /** Stable across runs — the Reminders agent's dedupe key. */
  key: string;
  source: QueueSource;
  title: string;
  /** What it hangs off, for display: customer / project / engagement. */
  context: string;
  /** epoch-ms; 0 = undated. */
  due: number;
  /** In-app link to where the work actually happens. */
  href: string;
  /** Only assignment items can be completed from outside the app. */
  writable: boolean;
};

export const SOURCE_LABEL: Record<QueueSource, string> = {
  assignment: "Assigned",
  "quote-review": "Quote review",
  "phase-review": "Phase review",
  checklist: "Standards",
  milestone: "Milestone",
  "project-task": "Project task",
  "flame-renewal": "Flame renewal",
  "inspection-renewal": "Inspection renewal",
};

/** Open/overdue tallies for the Home queue card. `due === 0` means undated,
 *  never overdue — the same rule QueueView applies. `loadQueue` already
 *  returns only open items, so `open` is simply the item count. Lives here
 *  (dependency-free), not in `lib/queue.ts`, so the "use client" QueueView
 *  can import it without dragging the stores — and therefore PGlite — into
 *  the browser bundle; re-exported from `lib/queue.ts` for server callers. */
export function queueCardCounts(
  items: QueueItem[],
  now: number
): { open: number; overdue: number } {
  let overdue = 0;
  for (const i of items) if (i.due && i.due < now) overdue++;
  return { open: items.length, overdue };
}
