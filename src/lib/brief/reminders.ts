/**
 * AI daily brief (spec §5) — the phone reminders, as pure data: the two
 * daily local notifications, the Account pref's key, and who gets them.
 * Imported by the client component (`NativeBriefReminders`) and the layout,
 * so it holds no store and no Capacitor import.
 */
import { BRIEF_TIMES } from "./slots";

/** `notif_prefs` key for "Brief reminders on this phone" (default ON — see `briefRemindersOn`). */
export const BRIEF_REMINDERS_PREF_KEY = "brief_reminders";

export const BRIEF_REMINDER_TITLE = "Daily brief";

/** 6:45 / 13:45 — the slots' clock times, read on the phone's own clock (not Chicago's). Ids are fixed so a reschedule replaces, never duplicates. */
export const BRIEF_REMINDERS = [
  { id: 64501, ...BRIEF_TIMES.morning, body: "Your morning brief is ready" },
  { id: 64502, ...BRIEF_TIMES.midday, body: "Your afternoon brief is ready" },
] as const;

export const BRIEF_REMINDER_IDS: readonly number[] = BRIEF_REMINDERS.map((r) => r.id);

/** Where a tap goes — Home scrolls to the brief card on `?brief=1`. */
export const BRIEF_REMINDER_TARGET = "/?brief=1";

export type ReminderNotification = {
  id: number;
  title: string;
  body: string;
  schedule: { on: { hour: number; minute: number }; repeats: true };
};

/** The two notifications as `LocalNotifications.schedule({ notifications })` takes them. */
export function reminderNotifications(): ReminderNotification[] {
  return BRIEF_REMINDERS.map((r) => ({
    id: r.id,
    title: BRIEF_REMINDER_TITLE,
    body: r.body,
    schedule: { on: { hour: r.hour, minute: r.minute }, repeats: true as const },
  }));
}

export function isBriefReminderId(id: unknown): boolean {
  return typeof id === "number" && BRIEF_REMINDER_IDS.includes(id);
}

/** Pilot + the Daily brief switch — the brief (and so its reminders) exists for this person. */
export function briefOnFor(userId: string, settings: { users: readonly string[]; features: { brief?: boolean } }): boolean {
  return !!userId && settings.users.includes(userId) && !!settings.features.brief;
}
