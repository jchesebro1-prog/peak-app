import { accessTokenFor } from "@/lib/gmail/connections";

/**
 * Thin Google Tasks v1 client (D146) — plain fetch, bearer auth, zero deps,
 * mirroring src/lib/google/calendar.ts's `gcal` pattern (which itself
 * mirrors src/lib/gmail/api.ts's `gapi` pattern, D36). Tokens come from the
 * same gmail_connections rows; calls only work for mailboxes whose grant
 * includes TASKS_SCOPE (callers check hasTasksScope() first — a call
 * without it just 403s and should be caught, same convention as Calendar).
 *
 * List naming: the mirror list is called "Peak" (PEAK_LIST_NAME below),
 * matching scripts/reminders-agent.ts's Apple Reminders list name (its
 * QUEUE_AGENT_LIST default) — same convention across both integrations so a
 * person using both surfaces sees one familiar list name in either app
 * (D146).
 */

const TASKS_BASE = "https://www.googleapis.com/tasks/v1";

/** The Google Tasks list every mirrored Home Queue item lands in. */
export const PEAK_LIST_NAME = "Peak";

async function gtasks<T>(mailboxKey: string, path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessTokenFor(mailboxKey);
  if (!token) throw new Error("Mailbox not connected: " + mailboxKey);
  const res = await fetch(TASKS_BASE + path, {
    ...init,
    // A hung Google endpoint must never hang the cron run that calls this
    // (src/lib/google/tasks-sync.ts) — errors land in the caller's catch,
    // same budget src/lib/google/calendar.ts uses for the dashboard render.
    signal: AbortSignal.timeout(5000),
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error("Tasks API " + path + " -> " + res.status + " " + (await res.text()));
  }
  return (await res.json()) as T;
}

/* ---- types (only the fields the sync needs) ---- */

type GoogleTaskList = { id: string; title: string };
type GoogleTaskRaw = { id: string; title?: string; notes?: string; status?: string; due?: string };

export type GoogleTask = {
  id: string;
  title: string;
  notes: string;
  completed: boolean;
};

function toTask(t: GoogleTaskRaw): GoogleTask {
  return {
    id: t.id,
    title: t.title || "",
    notes: t.notes || "",
    completed: t.status === "completed",
  };
}

/**
 * Find the mailbox's "Peak" task list, creating it on first use. The Tasks
 * API has no "get list by title" call, so this pages through tasklists.list
 * (a personal account has a handful of lists at most — one 100-row page
 * covers every real case, and the loop below only runs a second time if it
 * somehow doesn't).
 */
/**
 * Accepted low-probability race: two concurrent syncs for the SAME user
 * (e.g. an overlapping manual retry during the daily cron) could each find
 * no "Peak" list yet and both create one, since Google Tasks enforces no
 * title uniqueness. Cosmetic if it happens (a stray empty duplicate list) —
 * the sync itself stays correct either way (it lists tasks by whichever id
 * this call returns). Not guarded further: the daily cron alone can't hit
 * this, and closing it properly needs a lock this doc-store doesn't have,
 * the same trade-off already made for #74/#80/#85/#86's concurrency edges.
 */
export async function findOrCreatePeakList(mailboxKey: string): Promise<string> {
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({ maxResults: "100" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await gtasks<{ items?: GoogleTaskList[]; nextPageToken?: string }>(
      mailboxKey,
      "/users/@me/lists?" + params.toString()
    );
    const found = (page.items || []).find((l) => l.title === PEAK_LIST_NAME);
    if (found) return found.id;
    pageToken = page.nextPageToken;
  } while (pageToken);

  const created = await gtasks<GoogleTaskList>(mailboxKey, "/users/@me/lists", {
    method: "POST",
    body: JSON.stringify({ title: PEAK_LIST_NAME }),
  });
  return created.id;
}

/**
 * Every task currently in the list, completed or not. The sync needs both:
 * open ones to dedupe new mirrors against, completed ones to detect a
 * checked-off assignment for write-back (showCompleted/showHidden are both
 * required — Google's default list view hides completed tasks after a
 * while, and the sync would otherwise "lose" a completion before it can
 * read it back).
 */
export async function listTasks(mailboxKey: string, listId: string): Promise<GoogleTask[]> {
  const out: GoogleTask[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      showCompleted: "true",
      showHidden: "true",
      maxResults: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await gtasks<{ items?: GoogleTaskRaw[]; nextPageToken?: string }>(
      mailboxKey,
      "/lists/" + encodeURIComponent(listId) + "/tasks?" + params.toString()
    );
    out.push(...(page.items || []).map(toTask));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Create a mirrored task. `dueMs` is optional (0/undefined = no due date).
 * Google Tasks' `due` field carries date resolution only — the time-of-day
 * portion is accepted but ignored by every Tasks client — so this always
 * sends midnight UTC on the due day rather than the queue item's precise ms
 * (same rounding Calendar's all-day-event helper applies, for the same
 * reason).
 */
export async function insertTask(
  mailboxKey: string,
  listId: string,
  input: { title: string; notes: string; dueMs?: number }
): Promise<{ id: string }> {
  const body: Record<string, unknown> = { title: input.title, notes: input.notes };
  if (input.dueMs) {
    body.due = new Date(input.dueMs).toISOString().slice(0, 10) + "T00:00:00.000Z";
  }
  const created = await gtasks<GoogleTaskRaw>(
    mailboxKey,
    "/lists/" + encodeURIComponent(listId) + "/tasks",
    { method: "POST", body: JSON.stringify(body) }
  );
  return { id: created.id };
}

/** Mark a task completed — the app-closed-it direction (mirrors
 *  reminders-agent.ts's jxaComplete). */
export async function completeTask(mailboxKey: string, listId: string, taskId: string): Promise<void> {
  await gtasks<GoogleTaskRaw>(
    mailboxKey,
    "/lists/" + encodeURIComponent(listId) + "/tasks/" + encodeURIComponent(taskId),
    { method: "PATCH", body: JSON.stringify({ status: "completed" }) }
  );
}

/** Delete a task outright. Not called by the sync today — the reconciliation
 *  model completes rather than deletes a closed mirror, matching the
 *  Reminders agent — but exposed for API completeness (the brief's list of
 *  operations to wrap) and for a possible future "clear finished mirrors"
 *  maintenance pass. 404/410 (already gone) is swallowed, matching
 *  Calendar's deleteEvent(). */
export async function deleteTask(mailboxKey: string, listId: string, taskId: string): Promise<void> {
  const token = await accessTokenFor(mailboxKey);
  if (!token) throw new Error("Mailbox not connected: " + mailboxKey);
  const res = await fetch(
    TASKS_BASE + "/lists/" + encodeURIComponent(listId) + "/tasks/" + encodeURIComponent(taskId),
    {
      method: "DELETE",
      signal: AbortSignal.timeout(5000),
      headers: { Authorization: "Bearer " + token },
    }
  );
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error("Tasks API delete -> " + res.status + " " + (await res.text()));
  }
}
