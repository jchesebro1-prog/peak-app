import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";
import { removeManagedEvent, upsertManagedEvent } from "@/lib/google/calendar";
import { allUsers } from "@/lib/users";

export type ServiceCalendarKind = "flame" | "inspection" | "repair";

function eventId(kind: ServiceCalendarKind, id: string): string {
  const hex = Array.from(id.toLowerCase(), (c) => c.charCodeAt(0).toString(16)).join("");
  return `qz${kind.slice(0, 2)}${hex}`;
}

async function calendarMailbox(name: string): Promise<string | null> {
  if (!gmailEnabled() || !name) return null;
  const user = (await allUsers()).find((u) => u.name === name);
  if (!user) return null;
  const key = personalKey(user.id);
  const info = await getConnectionInfo(key);
  return info && hasCalendarScope(info.scope) ? key : null;
}

/** Sync one service scheduler row to the selected person's opted-in calendar. */
export async function syncServiceCalendar(input: {
  kind: ServiceCalendarKind;
  id: string;
  assignedTo: string;
  previousAssignedTo?: string;
  date: string;
  title: string;
  location?: string;
  description?: string;
}): Promise<void> {
  const id = eventId(input.kind, input.id);
  try {
    if (input.previousAssignedTo && input.previousAssignedTo !== input.assignedTo) {
      const oldKey = await calendarMailbox(input.previousAssignedTo);
      if (oldKey) await removeManagedEvent(oldKey, id);
    }
    const key = await calendarMailbox(input.assignedTo);
    if (!key || !input.date) return;
    await upsertManagedEvent(key, {
      id,
      title: input.title,
      date: input.date,
      location: input.location,
      description: input.description,
    });
  } catch (err) {
    // Scheduling is authoritative; a Google outage must not reject the job.
    console.error("[service-calendar] sync failed", input.kind, input.id, err);
  }
}

export async function removeServiceCalendar(input: {
  kind: ServiceCalendarKind;
  id: string;
  assignedTo: string;
}): Promise<void> {
  try {
    const key = await calendarMailbox(input.assignedTo);
    if (key) await removeManagedEvent(key, eventId(input.kind, input.id));
  } catch (err) {
    console.error("[service-calendar] remove failed", input.kind, input.id, err);
  }
}
