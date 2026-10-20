/* Assessment reminders (Jeff 2026-10-15 #10) — #353 review M3: when a finding's `nextDue` or a venue's
   `nextAssessmentAt` changes or is cleared, the open `T-asr-…` reminders for the old date are closed (marked done).
   Called right after those writes (saveFinding / transitionFinding / voidFinding, setNextAssessmentAt) and by the
   daily sweep as the catch-all for every other path (offline pushes, merges). Never throws into the caller's save. */
import { and, eq, like, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { DOC_TABLES } from "@/db/doc-tables";
import { setTaskStatus } from "@/lib/stores/tasks";
import { reminderTaskPrefix, staleReminderIds } from "./reminders";

const likePrefix = (p: string) => p.replace(/[\\%_]/g, (c) => "\\" + c) + "%";

/** Ids of live, not-done reminder tasks whose id starts with `prefix` (default: every reminder). One query. */
export async function openReminderTaskIds(prefix = "T-asr-"): Promise<string[]> {
  const db = await getDb();
  const t = DOC_TABLES.tasks;
  const rows = await db
    .select({ id: t.id })
    .from(t)
    .where(and(eq(t.deleted, false), like(t.id, likePrefix(prefix)), ne(sql`coalesce(${t.doc}->>'status', '')`, "done")));
  return rows.map((r) => r.id);
}

/** Close the open reminders for one record whose day no longer matches `currentDue` (null = cleared: all of them).
 *  `openIds` (every open reminder, from the sweep's one read) saves the per-record query. Returns the closed ids. */
export async function closeStaleReminderTasks(kind: "finding" | "venue", ref: string, currentDue: number | null | undefined, openIds?: readonly string[]): Promise<string[]> {
  const open = openIds ?? (await openReminderTaskIds(reminderTaskPrefix(kind, ref)));
  const stale = staleReminderIds(open, kind, ref, currentDue);
  for (const id of stale) await setTaskStatus(id, "done");
  return stale;
}

/** The save-path hook: only when the date actually moved; logs and swallows a failure (the sweep retries). */
export async function closeRemindersIfDateChanged(kind: "finding" | "venue", ref: string, before: number | null | undefined, after: number | null | undefined): Promise<void> {
  if ((before ?? null) === (after ?? null)) return;
  try {
    await closeStaleReminderTasks(kind, ref, after ?? null);
  } catch (err) {
    console.error("[assessment-reminders] closing stale reminders failed", kind, ref, err);
  }
}
