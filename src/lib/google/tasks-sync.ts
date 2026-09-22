import { getUser } from "@/lib/users";
import { hasTasksScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo, listConnections } from "@/lib/gmail/connections";
import { loadQueue } from "@/lib/queue";
import { setAssignmentDone } from "@/lib/stores/assignments";
import { completeTask, findOrCreatePeakList, insertTask, listTasks, type GoogleTask } from "./tasks";

/**
 * Google Tasks two-way sync (D146) — the cloud-side sibling of
 * scripts/reminders-agent.ts, implementing the SAME reconciliation model
 * (see that file's top-of-file doc comment for the full rationale) against
 * a Google Tasks list instead of a local Reminders.app list.
 * Design: docs/superpowers/specs/2026-07-19-work-queue-reminders-sync-design.md
 * (written for the Reminders agent; D146 in DECISIONS.md records what
 * carries over unchanged and what's different here).
 *
 * Unlike the Reminders agent — a standalone Mac script polling a local list
 * over osascript because Apple publishes no cloud API for Reminders — this
 * runs SERVER-SIDE, as an extra step of the existing Gmail cron
 * (src/app/api/gmail/sync/route.ts). Google Tasks has a real cloud REST API,
 * so there's no "must run on someone's Mac" constraint here.
 *
 * Reconciliation model:
 *   - Every open queue item (any source) gets a task in "Peak" if it doesn't
 *     have one yet — one-way for derived items, the mirror only.
 *   - A queue item that disappears from the server (closed, done, or the
 *     assignee changed) gets its mirrored task marked completed.
 *   - Two-way ONLY for `source: "assignment"` items, per /api/queue's own
 *     write-back restriction: a task checked off in Google Tasks calls
 *     setAssignmentDone(id, true, "google-tasks"). Derived items never write
 *     back — a phone/Tasks checkbox must never approve a review or close a
 *     milestone.
 *
 * Dedupe mechanic — identical convention to reminders-agent.ts: each
 * mirrored task's `notes` field embeds a `peak-queue-key: <key>` marker
 * line (the same `key` loadQueue()/the queue route already treat as the
 * stable dedupe id), re-derived from Google's live state every run.
 *
 * Known limitation vs. the Reminders agent (see D146 — deliberate, not an
 * oversight): the Mac agent keeps a small ledger whose only job is
 * remembering "this key had a mirror and doesn't anymore while the queue
 * item is still open" (a hand delete), because Reminders' own state can't
 * tell that apart from "never created". This module has no equivalent —
 * deleting a mirrored Google Task outright gets it recreated on the next
 * run, because nothing here persists "seen and removed" separately from
 * Google's current list contents. Checking a task off (the supported way to
 * act on one, same as Reminders) is unaffected — that's a completed task
 * with an intact marker, read back correctly in step 2/3 below.
 */

const MARKER_RE = /^peak-queue-key:\s*(.+)$/m;

function keyOf(task: GoogleTask): string | null {
  const m = MARKER_RE.exec(task.notes || "");
  return m ? m[1].trim() : null;
}

type NoteableItem = { key: string; source: string; context?: string; href?: string };

function buildNotes(baseUrl: string, item: NoteableItem): string {
  const lines = [`peak-queue-key: ${item.key}`, `source: ${item.source}`];
  if (item.context) lines.push(item.context);
  if (item.href) lines.push(baseUrl + item.href);
  return lines.join("\n");
}

/** Absolute base URL for links embedded in a task's notes — same env chain
 *  gmail/config.ts's callbackUrl() reads, minus the callback-path suffix. */
function appBaseUrl(): string {
  return (
    process.env.GMAIL_REDIRECT_BASE ||
    process.env.AUTH_URL ||
    process.env.NEXTAUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/+$/, "");
}

export type TaskSyncStats = {
  /** true when nothing ran (not connected, no scope, or user missing) —
   *  syncAllGoogleTasks() uses this to skip a user without counting it as
   *  a failure. */
  skipped: boolean;
  reason?: string;
  created: number;
  completedLocally: number;
  wroteBack: number;
  hiccups: number;
};

function empty(reason: string): TaskSyncStats {
  return { skipped: true, reason, created: 0, completedLocally: 0, wroteBack: 0, hiccups: 0 };
}

/**
 * Reconcile one user's Google Tasks "Peak" list against their Home Queue.
 * Idempotent and safe to call on any cadence, including for a user who
 * isn't connected or hasn't opted in (returns a `skipped` stat instead of
 * throwing) — that's what lets syncAllGoogleTasks() fan out over every
 * connection without per-user guard logic of its own.
 */
export async function syncGoogleTasksForUser(userId: string): Promise<TaskSyncStats> {
  // Belt-and-suspenders on the docstring's "never throws" contract: these
  // two lookups sit before the function's own try/catches below, and while
  // syncAllGoogleTasks()'s own per-user try/catch already stops one user's
  // failure from aborting the whole fan-out, a caller that invokes this
  // function directly (bypassing that outer guard) deserves the same
  // never-throws guarantee the rest of this function already provides.
  const mailboxKey = personalKey(userId);
  let conn: Awaited<ReturnType<typeof getConnectionInfo>>;
  let user: Awaited<ReturnType<typeof getUser>>;
  try {
    conn = await getConnectionInfo(mailboxKey);
    if (!conn) return empty("not connected");
    if (!hasTasksScope(conn.scope)) return empty("tasks scope not granted");
    user = await getUser(userId);
    if (!user) return empty("user not found");
  } catch (err) {
    return empty("lookup failed: " + (err as Error).message);
  }

  const stats: TaskSyncStats = { skipped: false, created: 0, completedLocally: 0, wroteBack: 0, hiccups: 0 };
  const baseUrl = appBaseUrl();

  let listId: string;
  try {
    listId = await findOrCreatePeakList(mailboxKey);
  } catch (err) {
    return empty("could not open Peak list: " + (err as Error).message);
  }

  let existing: GoogleTask[];
  try {
    existing = await listTasks(mailboxKey, listId);
  } catch (err) {
    return empty("could not list tasks: " + (err as Error).message);
  }

  const markerMap = new Map<string, GoogleTask>();
  for (const t of existing) {
    const key = keyOf(t);
    if (key) markerMap.set(key, t);
  }

  const items = await loadQueue(user.name);
  const itemsByKey = new Map(items.map((i) => [i.key, i]));

  // 1) mirror every open item that doesn't have a task yet.
  for (const item of items) {
    if (markerMap.has(item.key)) continue;
    try {
      await insertTask(mailboxKey, listId, {
        title: item.title,
        notes: buildNotes(baseUrl, item),
        dueMs: item.due || undefined,
      });
      stats.created++;
    } catch (err) {
      stats.hiccups++;
      console.error(
        `[google-tasks-sync] could not create a task for "${item.key}": ${(err as Error).message}`
      );
    }
  }

  // 2) complete mirrors whose underlying queue item is gone (closed, done,
  //    or reassigned away from this person).
  for (const [key, task] of markerMap) {
    if (itemsByKey.has(key)) continue;
    if (task.completed) continue;
    try {
      await completeTask(mailboxKey, listId, task.id);
      stats.completedLocally++;
    } catch (err) {
      stats.hiccups++;
      console.error(`[google-tasks-sync] could not complete the task for "${key}": ${(err as Error).message}`);
    }
  }

  // 3) write back — assignment items only, per /api/queue's own
  //    write-back restriction.
  for (const item of items) {
    if (item.source !== "assignment" || !item.writable) continue;
    const task = markerMap.get(item.key);
    if (!task || !task.completed) continue;
    const id = item.key.slice("assignment:".length);
    try {
      await setAssignmentDone(id, true, "google-tasks");
      stats.wroteBack++;
    } catch (err) {
      stats.hiccups++;
      console.error(`[google-tasks-sync] write-back failed for "${item.key}": ${(err as Error).message}`);
    }
  }

  return stats;
}

/**
 * Fan out syncGoogleTasksForUser() over every personal mailbox that has
 * opted in. Called from the Gmail cron (src/app/api/gmail/sync/route.ts) —
 * see D146 for why this rides that existing schedule rather than a new cron
 * entry. One user's failure never aborts the others: syncGoogleTasksForUser
 * already isolates its own per-item errors into `hiccups`, and this loop's
 * own try/catch is a second layer of isolation in case something escapes
 * that (e.g. a loadQueue() throw).
 */
export async function syncAllGoogleTasks(): Promise<{
  usersSynced: number;
  created: number;
  completedLocally: number;
  wroteBack: number;
  hiccups: number;
}> {
  const totals = { usersSynced: 0, created: 0, completedLocally: 0, wroteBack: 0, hiccups: 0 };
  const connections = await listConnections();
  for (const c of connections) {
    if (!c.userId || !hasTasksScope(c.scope)) continue;
    try {
      const r = await syncGoogleTasksForUser(c.userId);
      if (r.skipped) continue;
      totals.usersSynced++;
      totals.created += r.created;
      totals.completedLocally += r.completedLocally;
      totals.wroteBack += r.wroteBack;
      totals.hiccups += r.hiccups;
    } catch (err) {
      totals.hiccups++;
      console.error(`[google-tasks-sync] sync failed for user ${c.userId}: ${(err as Error).message}`);
    }
  }
  return totals;
}
