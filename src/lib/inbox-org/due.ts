/**
 * Inbox organization §7 "Due date" — a promise's due phrase → epoch-ms,
 * always 5:00 pm America/Chicago (the task calendar's due stamp,
 * `dueStampForDay`). Anchored on the Chicago day the message was sent.
 * Checked in this order, so a compound phrase resolves to its most specific
 * part ("EOD Friday" is Friday, "end of next week" is next Friday):
 *
 *  1. an explicit date (10/22, 10/22/2026, 2026-10-22, Oct 22, October 22nd,
 *     22 October). With no year it is this year's date; one that passed
 *     within the last ~180 days falls back to the default (a stale or
 *     mistyped date, not next year), an older one rolls to next year.
 *     A dated year in the past also falls back to the default.
 *  2. "end of next week" → the following week's Friday
 *  3. "end of (the) week" / "EOW" → the Friday on or after the anchor
 *     (Sat/Sun → next Friday)
 *  4. "end of (the) month" / "month end" / "EOM" → the month's last day
 *  5. a weekday name with "next week" ("Wednesday of next week") → that day
 *     of the following week
 *  6. a weekday name ("Thursday", "thurs", "by EOD Friday", "COB Thursday" —
 *     EOD/COB are only a time of day here) → its next occurrence after the anchor
 *  7. "next week" → the following Monday
 *  8. "tomorrow" → the next calendar day
 *  9. "today" / "tonight" / "EOD" / "end of (the) day" / "COB" → that day
 * 10. anything else → 2 business days (Mon–Fri) after the anchor
 * Pure.
 */
import { addDays } from "@/lib/drive-plan/day";
import { dayKey } from "@/lib/triage/clock";
import { dueStampForDay, workDaysAfter } from "@/lib/task-plan/due";
import { weekdayOf } from "@/lib/visit-plan/hours";
import { DEFAULT_WORK_HOURS } from "@/lib/visit-plan/settings";

export const DEFAULT_DUE_BUSINESS_DAYS = 2;
/** A yearless date further in the past than this rolls to next year. */
export const PAST_DATE_ROLL_DAYS = 180;

const BUSINESS_WEEK = { ...DEFAULT_WORK_HOURS, days: [1, 2, 3, 4, 5] };
const DAY_MS = 86_400_000;

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\b\\.?";
const WEEKDAYS: Array<[RegExp, number]> = [
  [/\bsun(?:day)?\b/, 0], [/\bmon(?:day)?\b/, 1], [/\btue(?:s|sday)?\b/, 2], [/\bwed(?:s|nesday)?\b/, 3],
  [/\bthu(?:r|rs|rsday)?\b/, 4], [/\bfri(?:day)?\b/, 5], [/\bsat(?:urday)?\b/, 6],
];

const pad = (n: number) => String(n).padStart(2, "0");
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / DAY_MS);

function validDay(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2200)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** "default" = a real date that already passed (use the default rule);
 *  null = not a valid date (keep reading the phrase). */
type DateHit = string | "default" | null;

function datedDay(anchor: string, m: number, d: number, year?: number): DateHit {
  if (year !== undefined) {
    const k = validDay(year < 100 ? 2000 + year : year, m, d);
    return k === null ? null : k >= anchor ? k : "default";
  }
  const y0 = Number(anchor.slice(0, 4));
  const k = validDay(y0, m, d);
  if (!k) return null;
  if (k >= anchor) return k;
  return daysBetween(k, anchor) > PAST_DATE_ROLL_DAYS ? validDay(y0 + 1, m, d) : "default";
}

function explicitDate(t: string, anchor: string): DateHit {
  let m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(t);
  if (m) return datedDay(anchor, Number(m[2]), Number(m[3]), Number(m[1]));
  m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/.exec(t);
  if (m) return datedDay(anchor, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
  m = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`).exec(t);
  if (m) return datedDay(anchor, MONTHS[m[1].slice(0, 3)], Number(m[2]), m[3] ? Number(m[3]) : undefined);
  m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?`).exec(t);
  if (m) return datedDay(anchor, MONTHS[m[2].slice(0, 3)], Number(m[1]), m[3] ? Number(m[3]) : undefined);
  return null;
}

function resolveDay(text: string, anchor: string): string | null {
  const t = text.toLowerCase();
  const wd = weekdayOf(anchor);
  const nextMonday = addDays(anchor, ((1 - wd + 7) % 7) || 7);
  const date = explicitDate(t, anchor);
  if (date === "default") return null;
  if (date) return date;
  if (/\bend of next week\b/.test(t)) return addDays(nextMonday, 4);
  if (/\b(?:end of (?:the |this )?week|eow)\b/.test(t)) return addDays(anchor, (5 - wd + 7) % 7);
  if (/\b(?:end of (?:the |this )?month|month[- ]end|eom)\b/.test(t)) {
    const [y, mo] = anchor.split("-").map(Number);
    return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  }
  // several weekdays named ("Friday or Monday"): the one written first wins
  let named: { day: number; at: number } | null = null;
  for (const [re, day] of WEEKDAYS) {
    const at = t.search(re);
    if (at >= 0 && (!named || at < named.at)) named = { day, at };
  }
  if (named) {
    const day = named.day;
    if (/\bnext week\b/.test(t)) return addDays(nextMonday, (day + 6) % 7);
    return addDays(anchor, ((day - wd + 7) % 7) || 7);
  }
  if (/\bnext week\b/.test(t)) return nextMonday;
  if (/\btomorrow\b/.test(t)) return addDays(anchor, 1);
  if (/\b(?:today|tonight|eod|end of (?:the )?day|close of business|cob)\b/.test(t)) return anchor;
  return null;
}

export function resolveDue(dueText: string, messageAt: number): number {
  const anchor = dayKey(messageAt);
  const day = resolveDay(String(dueText ?? ""), anchor) ?? workDaysAfter(anchor, 14, BUSINESS_WEEK)[DEFAULT_DUE_BUSINESS_DAYS - 1];
  return dueStampForDay(day);
}
