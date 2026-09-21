/**
 * Recurrence presets (S13 full-build, "A" scope) — a small fixed set mapped
 * to single-line RRULEs. No custom interval/end-date builder and no
 * "this and following" editing: acting on an expanded instance id only
 * touches that one occurrence, which is Google's native behavior for
 * singleEvents=true expansion — nothing extra to build for that part.
 */

export const RECURRENCE_PRESETS = [
  { value: "", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
] as const;

export type RecurrencePreset = (typeof RECURRENCE_PRESETS)[number]["value"];

const RRULE_BY_PRESET: Record<Exclude<RecurrencePreset, "">, string> = {
  daily: "RRULE:FREQ=DAILY",
  weekly: "RRULE:FREQ=WEEKLY",
  monthly: "RRULE:FREQ=MONTHLY",
  yearly: "RRULE:FREQ=YEARLY",
};

/** Preset → Google `recurrence` array (undefined = omit the field entirely,
 *  since PATCHing recurrence: [] doesn't reliably clear it — omission plus
 *  an explicit null does; callers handle the "clearing" case separately). */
export function rruleFor(preset: string): string[] | undefined {
  if (!preset) return undefined;
  const rule = RRULE_BY_PRESET[preset as Exclude<RecurrencePreset, "">];
  return rule ? [rule] : undefined;
}

/** Google recurrence line → our preset, for populating the edit modal.
 *  Anything we don't recognize (a custom RRULE made outside the app) falls
 *  back to "" so the dropdown shows "Does not repeat" rather than crash. */
export function presetFromRrule(line: string | undefined): string {
  if (!line) return "";
  for (const [preset, rule] of Object.entries(RRULE_BY_PRESET)) {
    if (line.startsWith(rule)) return preset;
  }
  return "";
}
