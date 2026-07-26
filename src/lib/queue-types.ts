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
  | "inspection-renewal"
  | "site-visit";

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
  "site-visit": "Site visit",
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

const DAY = 86_400_000;

/** Day-bucket label for a single queue row's due date, shared by QueueView
 *  (queue/view.tsx, which also uses `tone` to color the row) and the Home
 *  queue card (page.tsx, which uses only `.text`). `ts === 0` (undated)
 *  renders "". Lives here (dependency-free), not in `lib/queue.ts`, for the
 *  same reason as `queueCardCounts` above; re-exported from `lib/queue.ts`
 *  for server callers. */
export function queueDueLabel(ts: number, now: number): { text: string; tone: string } {
  if (!ts) return { text: "", tone: "#9aa0ab" };
  const days = Math.round((ts - now) / DAY);
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, tone: "#c4553a" };
  if (days === 0) return { text: "Today", tone: "#c07f28" };
  if (days === 1) return { text: "Tomorrow", tone: "#c07f28" };
  if (days <= 7) return { text: `${days}d`, tone: "#5b616e" };
  return {
    text: new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    tone: "#9aa0ab",
  };
}
