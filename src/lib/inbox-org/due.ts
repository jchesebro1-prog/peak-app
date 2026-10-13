/**
 * Inbox organization §7 "Due date" — a promise's due phrase → epoch-ms,
 * always 5:00 pm America/Chicago (the task calendar's due stamp,
 * `dueStampForDay`). Anchored on the Chicago day the message was sent.
 *
 *  - "today" / "EOD" / "end of (the) day" / "tonight" → that day
 *  - "tomorrow" → the next calendar day
 *  - an explicit date (10/22, 10/22/2026, 2026-10-22, Oct 22, October 22nd,
 *    22 October); with no year, the next such date on or after the anchor
 *  - "end of (the) week" → the Friday on or after the anchor (Sat/Sun → next Friday)
 *  - "next week" → the following Monday
 *  - "end of (the) month" / "month end" → the month's last day
 *  - a weekday name ("Thursday", "thurs") → its next occurrence after the anchor
 *  - anything else → 2 business days (Mon–Fri) after the anchor
 * Pure.
 */
import { addDays } from "@/lib/drive-plan/day";
import { dayKey } from "@/lib/triage/clock";
import { dueStampForDay, workDaysAfter } from "@/lib/task-plan/due";
import { weekdayOf } from "@/lib/visit-plan/hours";
import { DEFAULT_WORK_HOURS } from "@/lib/visit-plan/settings";

export const DEFAULT_DUE_BUSINESS_DAYS = 2;

const BUSINESS_WEEK = { ...DEFAULT_WORK_HOURS, days: [1, 2, 3, 4, 5] };

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const WEEKDAYS: Array<[RegExp, number]> = [
  [/\bsun(?:day)?\b/, 0], [/\bmon(?:day)?\b/, 1], [/\btue(?:s|sday)?\b/, 2], [/\bwed(?:s|nesday)?\b/, 3],
  [/\bthu(?:r|rs|rsday)?\b/, 4], [/\bfri(?:day)?\b/, 5], [/\bsat(?:urday)?\b/, 6],
];

const pad = (n: number) => String(n).padStart(2, "0");

function validDay(y: number, m: number, d: number): string | null {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000 && y <= 2200)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** With no year: this year's date, or next year's when it is before the anchor. */
function nextDate(anchor: string, m: number, d: number, year?: number): string | null {
  const y0 = Number(anchor.slice(0, 4));
  if (year !== undefined) return validDay(year < 100 ? 2000 + year : year, m, d);
  const k = validDay(y0, m, d);
  if (!k) return null;
  return k >= anchor ? k : validDay(y0 + 1, m, d);
}

function explicitDate(t: string, anchor: string): string | null {
  let m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(t);
  if (m) return validDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/.exec(t);
  if (m) return nextDate(anchor, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined);
  m = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`).exec(t);
  if (m) return nextDate(anchor, MONTHS[m[1].slice(0, 3)], Number(m[2]), m[3] ? Number(m[3]) : undefined);
  m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?`).exec(t);
  if (m) return nextDate(anchor, MONTHS[m[2].slice(0, 3)], Number(m[1]), m[3] ? Number(m[3]) : undefined);
  return null;
}

function resolveDay(text: string, anchor: string): string | null {
  const t = text.toLowerCase();
  const wd = weekdayOf(anchor);
  const date = explicitDate(t, anchor);
  if (date) return date;
  if (/\b(?:today|tonight|eod|end of (?:the )?day|close of business|cob)\b/.test(t)) return anchor;
  if (/\btomorrow\b/.test(t)) return addDays(anchor, 1);
  if (/\b(?:end of (?:the )?week|eow)\b/.test(t)) return addDays(anchor, (5 - wd + 7) % 7);
  if (/\bnext week\b/.test(t)) return addDays(anchor, ((1 - wd + 7) % 7) || 7);
  if (/\b(?:end of (?:the )?month|month[- ]end|eom)\b/.test(t)) {
    const [y, mo] = anchor.split("-").map(Number);
    return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
  }
  for (const [re, day] of WEEKDAYS) if (re.test(t)) return addDays(anchor, ((day - wd + 7) % 7) || 7);
  return null;
}

export function resolveDue(dueText: string, messageAt: number): number {
  const anchor = dayKey(messageAt);
  const day = resolveDay(String(dueText ?? ""), anchor) ?? workDaysAfter(anchor, 14, BUSINESS_WEEK)[DEFAULT_DUE_BUSINESS_DAYS - 1];
  return dueStampForDay(day);
}
