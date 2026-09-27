import { getBlob, setBlob } from "@/db/doc-store";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { insertZonedEvent } from "@/lib/google/calendar";
import { activeUsers } from "@/lib/users";
import {
  DAYLITE_CALENDAR_BLOB,
  buildPreview,
  runCalendarBatch,
  sanitizeImported,
  selectPending,
  type BatchDeps,
  type BatchResult,
  type CalendarPreview,
  type CalendarState,
  type ImportedMap,
} from "./calendar-batch";
import { BUSINESS_TZ, parseCalendarTsv, todayYmdIn, type RosterUser } from "./calendar-events";

/**
 * Daylite calendar import (#219) — server glue: the active roster, each
 * user's personal mailbox grant, the dedup blob, and the live Google insert.
 * The file text arrives on every call and is re-parsed; no copy of the
 * events is kept beyond the dedup map.
 */

export async function loadImported(): Promise<ImportedMap> {
  return sanitizeImported(await getBlob<Record<string, unknown>>(DAYLITE_CALENDAR_BLOB, {}));
}

async function roster(): Promise<RosterUser[]> {
  return (await activeUsers()).map((u) => ({ id: u.id, name: u.name }));
}

/** Per user: may we write to their primary calendar? */
export async function calendarStates(users: RosterUser[]): Promise<Record<string, CalendarState>> {
  const out: Record<string, CalendarState> = {};
  if (!gmailEnabled()) {
    for (const u of users) out[u.id] = "gmail-off";
    return out;
  }
  await Promise.all(
    users.map(async (u) => {
      const info = await getConnectionInfo(personalKey(u.id));
      out[u.id] = !info ? "not-connected" : hasCalendarScope(info.scope) ? "connected" : "no-calendar";
    })
  );
  return out;
}

function fromYmdFor(fromToday: boolean, now: number): string | null {
  return fromToday ? todayYmdIn(now, BUSINESS_TZ) : null;
}

export async function previewCalendarImport(
  text: string,
  opts: { fromToday: boolean; now?: number }
): Promise<CalendarPreview> {
  const parsed = parseCalendarTsv(text);
  const users = await roster();
  const [states, done] = await Promise.all([calendarStates(users), loadImported()]);
  return buildPreview(parsed, users, states, done, { fromYmd: fromYmdFor(opts.fromToday, opts.now ?? Date.now()) });
}

const liveDeps: BatchDeps = {
  insert: (mailboxKey, body) => insertZonedEvent(mailboxKey, body),
  record: (patch) => setBlob(DAYLITE_CALENDAR_BLOB, patch),
  now: () => Date.now(),
};

export async function importCalendarBatch(
  text: string,
  opts: { fromToday: boolean; owners: string[]; skipKeys: string[]; now?: number },
  deps: BatchDeps = liveDeps
): Promise<BatchResult> {
  const parsed = parseCalendarTsv(text);
  const users = await roster();
  const [states, done] = await Promise.all([calendarStates(users), loadImported()]);
  const mailboxByUserId: Record<string, string> = {};
  for (const u of users) if (states[u.id] === "connected") mailboxByUserId[u.id] = personalKey(u.id);
  const pending = selectPending(parsed, users, mailboxByUserId, done, {
    fromYmd: fromYmdFor(opts.fromToday, opts.now ?? Date.now()),
    owners: opts.owners,
    skipKeys: opts.skipKeys,
  });
  return runCalendarBatch(pending, deps);
}
