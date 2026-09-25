/**
 * Venue availability — pure engine (no DB/store imports; safe in both a
 * client component and a server action, same discipline as
 * consulting-schedule.ts). Parses a venue's external calendar feed (.ics)
 * and a hand-edited CSV of open/blocked windows into one common shape
 * (`AvailWindow`), and answers "is this venue free for this booking?"
 * against it. Storage and network fetching live elsewhere
 * (src/lib/stores/venue-calendars.ts, src/lib/venue-calendar-fetch.ts) —
 * this file only ever turns text into windows and windows into an answer.
 *
 * Timestamps are epoch-ms, `end` is EXCLUSIVE, same convention the rest of
 * the app uses. There is no single app-wide timezone constant (the office
 * record's own `timezone`, defaulting to "America/Chicago", is threaded
 * through wherever one is needed — see src/app/(app)/page.tsx and
 * src/lib/krisp/archive.ts) — every function here that needs one takes an
 * optional `tz` parameter with that same default, so a caller that already
 * has the office's timezone can pass it through.
 *
 * `parseCsv` is reused from the Import hub's own parser (src/app/(app)/
 * import/parse.ts) — it's already self-contained (no store/DB imports), the
 * same guarantee this file needs, so there's no reason to fork a second CSV
 * tokenizer for one more screen.
 */

import { parseCsv } from "@/app/(app)/import/parse";

export type AvailWindow = {
  id: string;
  kind: "open" | "blocked";
  /** epoch-ms, inclusive */
  start: number;
  /** epoch-ms, EXCLUSIVE */
  end: number;
  allDay: boolean;
  label: string;
  source: "manual" | "csv" | "ics";
};

export type VenueCalendar = {
  locationId: string;
  icsUrl: string | null;
  /** Last SUCCESSFUL fetch — what `icsWindows` reflects. */
  icsFetchedAt: number | null;
  /** Last attempt regardless of outcome (success or failure) — the backoff
   *  clock: a failing feed retries at a much shorter interval than a
   *  healthy one's routine refresh, but still isn't re-hit on every single
   *  scheduler popover. */
  icsAttemptAt: number | null;
  icsError: string | null;
  /** manual + csv-imported windows */
  windows: AvailWindow[];
  /** windows parsed from the last successful icsUrl fetch */
  icsWindows: AvailWindow[];
  updatedAt: number;
  updatedBy: string;
};

export const DEFAULT_TZ = "America/Chicago";
export const DAY_MS = 86400000;

/** A fresh, empty calendar for a venue with no record yet. */
export function emptyVenueCalendar(locationId: string): VenueCalendar {
  return {
    locationId,
    icsUrl: null,
    icsFetchedAt: null,
    icsAttemptAt: null,
    icsError: null,
    windows: [],
    icsWindows: [],
    updatedAt: 0,
    updatedBy: "",
  };
}

/* ---------------- timezone math (no deps) ---------------- */

/** local(t) - t, in ms, for the given zone at instant `t` — positive east of
 *  UTC, negative west. Falls back to 0 (UTC) if `tz` isn't a valid IANA zone
 *  rather than throwing, so a garbled TZID degrades to UTC instead of
 *  blowing up the whole parse. */
function tzOffsetMs(utcMs: number, tz: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return asUtc - utcMs;
  } catch {
    return 0;
  }
}

/** Wall-clock local time in `tz` -> UTC ms. Two passes so a DST boundary
 *  (where the offset itself changes between the first guess and the real
 *  answer) still converges. */
export function zonedTimeToUtc(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  s: number,
  tz: string
): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const off1 = tzOffsetMs(guess, tz);
  const t1 = guess - off1;
  const off2 = tzOffsetMs(t1, tz);
  return guess - off2;
}

/** The local calendar date/weekday (0=Sun..6=Sat) `ms` falls on in `tz`. */
function localDateParts(
  ms: number,
  tz: string
): { y: number; mo: number; d: number; h: number; mi: number; s: number; weekday: number } {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = dtf.formatToParts(new Date(ms));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      y: Number(get("year")),
      mo: Number(get("month")),
      d: Number(get("day")),
      h: Number(get("hour")),
      mi: Number(get("minute")),
      s: Number(get("second")),
      weekday: WD[get("weekday")] ?? new Date(ms).getUTCDay(),
    };
  } catch {
    const d = new Date(ms);
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), weekday: d.getUTCDay() };
  }
}

/* ---------------- id helpers ---------------- */

let anonCounter = 0;
function shortId(prefix: string): string {
  anonCounter = (anonCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${anonCounter.toString(36)}`;
}

/* ==================================================================
 * ICS
 * ================================================================== */

type IcsDate = { ms: number; allDay: boolean; y: number; mo: number; d: number; h: number; mi: number; s: number };

function unfoldIcs(text: string): string[] {
  const raw = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

/** BEGIN:VEVENT..END:VEVENT property lines, one array per event. Anything
 *  nested inside the event (VALARM, …) is skipped rather than mistaken for
 *  an event-level property. Malformed/unbalanced BEGIN/END never throws —
 *  a dangling event at EOF is simply dropped. */
function extractEventBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] | null = null;
  let depth = 0;
  for (const raw of lines) {
    const upper = raw.toUpperCase();
    if (upper === "BEGIN:VEVENT") {
      current = [];
      depth = 0;
      continue;
    }
    if (!current) continue;
    if (upper === "END:VEVENT") {
      blocks.push(current);
      current = null;
      continue;
    }
    if (upper.startsWith("BEGIN:")) {
      depth++;
      continue;
    }
    if (upper.startsWith("END:")) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) current.push(raw);
  }
  return blocks;
}

function parseIcsLine(line: string): { name: string; params: Record<string, string>; value: string } | null {
  const idx = line.indexOf(":");
  if (idx < 0) return null;
  const left = line.slice(0, idx);
  const value = line.slice(idx + 1);
  const segs = left.split(";");
  const name = (segs[0] || "").trim().toUpperCase();
  if (!name) return null;
  const params: Record<string, string> = {};
  for (let i = 1; i < segs.length; i++) {
    const eq = segs[i].indexOf("=");
    if (eq < 0) continue;
    const k = segs[i].slice(0, eq).trim().toUpperCase();
    const v = segs[i].slice(eq + 1).trim().replace(/^"|"$/g, "");
    if (k) params[k] = v;
  }
  return { name, params, value };
}

function unescapeIcsText(v: string): string {
  return v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

/** One ICS date-or-date-time value (DTSTART/DTEND/EXDATE/UNTIL). Returns
 *  null on anything unparsable rather than throwing. */
function parseIcsDateValue(value: string, params: Record<string, string>, tz: string): IcsDate | null {
  const v = value.trim();
  const dateOnly = params.VALUE === "DATE" || /^\d{8}$/.test(v);
  if (dateOnly) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (!m) return null;
    const [, ys, mos, ds] = m;
    const y = Number(ys), mo = Number(mos), d = Number(ds);
    return { ms: zonedTimeToUtc(y, mo, d, 0, 0, 0, tz), allDay: true, y, mo, d, h: 0, mi: 0, s: 0 };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return null;
  const [, ys, mos, ds, hs, mis, ss, z] = m;
  const y = Number(ys), mo = Number(mos), d = Number(ds), h = Number(hs), mi = Number(mis), s = Number(ss);
  if (z) return { ms: Date.UTC(y, mo - 1, d, h, mi, s), allDay: false, y, mo, d, h, mi, s };
  const zone = params.TZID || tz;
  return { ms: zonedTimeToUtc(y, mo, d, h, mi, s, zone), allDay: false, y, mo, d, h, mi, s };
}

/** ISO 8601 duration ("PT2H30M", "P1D", "P1DT2H") -> ms, or null. */
function parseIcsDuration(value: string): number | null {
  const m = /^([+-]?)P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  const [, , w, d, h, mi, s] = m;
  const ms =
    (Number(w) || 0) * 7 * DAY_MS +
    (Number(d) || 0) * DAY_MS +
    (Number(h) || 0) * 3600000 +
    (Number(mi) || 0) * 60000 +
    (Number(s) || 0) * 1000;
  return ms ? sign * ms : (w || d || h || mi || s ? 0 : null);
}

const BYDAY_INDEX: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function addLocalDays(p: { y: number; mo: number; d: number }, n: number): { y: number; mo: number; d: number } {
  const dt = new Date(Date.UTC(p.y, p.mo - 1, p.d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return { y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
function addLocalMonths(p: { y: number; mo: number; d: number }, n: number): { y: number; mo: number; d: number } | null {
  const target = new Date(Date.UTC(p.y, p.mo - 1 + n, 1));
  const y = target.getUTCFullYear();
  const mo = target.getUTCMonth() + 1;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  if (p.d > daysInMonth) return null; // e.g. Jan 31 -> Feb: no such day, skip (common RRULE convention)
  return { y, mo, d: p.d };
}

type RruleParams = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY" | null;
  interval: number;
  count: number | null;
  until: number | null;
  byday: number[] | null;
};

function parseRrule(rrule: string, tz: string): RruleParams {
  const parts: Record<string, string> = {};
  for (const kv of rrule.split(";")) {
    const eq = kv.indexOf("=");
    if (eq < 0) continue;
    parts[kv.slice(0, eq).trim().toUpperCase()] = kv.slice(eq + 1).trim();
  }
  const freq = (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const).includes(parts.FREQ as "DAILY")
    ? (parts.FREQ as RruleParams["freq"])
    : null;
  const interval = Math.max(1, parseInt(parts.INTERVAL || "1", 10) || 1);
  const count = parts.COUNT ? Math.max(0, parseInt(parts.COUNT, 10) || 0) : null;
  const until = parts.UNTIL ? parseIcsDateValue(parts.UNTIL, {}, tz)?.ms ?? null : null;
  const byday = parts.BYDAY
    ? parts.BYDAY.split(",")
        .map((s) => BYDAY_INDEX[s.trim().toUpperCase().slice(-2)])
        .filter((n): n is number => n != null)
    : null;
  return { freq, interval, count, until, byday };
}

const MAX_RRULE_OCCURRENCES = 5000;

/** Every occurrence start of `rrule` from `dtstart`, bounded by COUNT/UNTIL
 *  and by `to` (recursion is forward-only and monotonic, so once an
 *  occurrence is past `to` every later one is too) and by a hard safety cap
 *  regardless of COUNT/UNTIL being open-ended. EXDATE-matched instants are
 *  dropped. Returns instant ms only — duration is applied by the caller. */
function expandRrule(dtstart: IcsDate, rrule: string, exdates: number[], to: number, tz: string): number[] {
  const { freq, interval, count, until, byday } = parseRrule(rrule, tz);
  if (!freq) return [dtstart.ms];
  const exSet = new Set(exdates);
  const out: number[] = [];
  let produced = 0;
  let generated = 0;

  const emit = (y: number, mo: number, d: number): "continue" | "stop" => {
    generated++;
    if (generated > MAX_RRULE_OCCURRENCES) return "stop";
    const ms = dtstart.allDay ? zonedTimeToUtc(y, mo, d, 0, 0, 0, tz) : zonedTimeToUtc(y, mo, d, dtstart.h, dtstart.mi, dtstart.s, tz);
    if (until != null && ms > until) return "stop";
    if (ms > to) return "stop";
    if (count != null && produced >= count) return "stop";
    produced++;
    if (!exSet.has(ms)) out.push(ms);
    return "continue";
  };

  if (freq === "DAILY") {
    let cur = { y: dtstart.y, mo: dtstart.mo, d: dtstart.d };
    for (;;) {
      if (emit(cur.y, cur.mo, cur.d) === "stop") break;
      cur = addLocalDays(cur, interval);
    }
  } else if (freq === "WEEKLY") {
    const days = byday && byday.length ? byday : [localDateParts(dtstart.ms, tz).weekday];
    // Anchor the week to the Sunday on/before dtstart's local date.
    const start = { y: dtstart.y, mo: dtstart.mo, d: dtstart.d };
    const startWeekday = localDateParts(dtstart.ms, tz).weekday;
    const anchor = addLocalDays(start, -startWeekday);
    let cursor = 0; // days since anchor
    outer: for (;;) {
      const weekIdx = Math.floor(cursor / 7);
      if (weekIdx % interval === 0) {
        const dow = cursor % 7;
        if (days.includes(dow)) {
          const day = addLocalDays(anchor, cursor);
          // Skip occurrences before dtstart itself.
          const dayMs = zonedTimeToUtc(day.y, day.mo, day.d, 0, 0, 0, tz);
          if (dayMs >= zonedTimeToUtc(start.y, start.mo, start.d, 0, 0, 0, tz)) {
            if (emit(day.y, day.mo, day.d) === "stop") break outer;
          }
        }
      }
      cursor++;
      if (cursor > MAX_RRULE_OCCURRENCES * 8) break; // hard backstop
      if (generated > MAX_RRULE_OCCURRENCES) break;
    }
  } else if (freq === "MONTHLY") {
    let n = 0;
    for (;;) {
      const next = addLocalMonths({ y: dtstart.y, mo: dtstart.mo, d: dtstart.d }, n * interval);
      n++;
      if (generated > MAX_RRULE_OCCURRENCES) break;
      if (!next) {
        if (n * interval > 1200) break; // ~100 years of misses — give up
        continue;
      }
      if (emit(next.y, next.mo, next.d) === "stop") break;
    }
  } else if (freq === "YEARLY") {
    let n = 0;
    for (;;) {
      const y = dtstart.y + n * interval;
      n++;
      const daysInMonth = new Date(Date.UTC(y, dtstart.mo, 0)).getUTCDate();
      if (dtstart.d > daysInMonth) {
        if (n * interval > 400) break;
        continue;
      }
      if (emit(y, dtstart.mo, dtstart.d) === "stop") break;
    }
  }
  return out;
}

/**
 * Parse an .ics feed's VEVENTs into blocked windows, expanded within
 * [from, to). Cancelled and transparent events are dropped (they don't
 * indicate real busy time); anything unparsable is skipped rather than
 * aborting the whole feed — a single malformed event never loses the rest.
 * Completely garbled input (no VEVENT blocks at all) returns [].
 */
export function parseIcs(text: string, opts: { from: number; to: number; tz?: string }): AvailWindow[] {
  const tz = opts.tz || DEFAULT_TZ;
  const out: AvailWindow[] = [];
  if (!text || typeof text !== "string") return out;
  let blocks: string[][];
  try {
    blocks = extractEventBlocks(unfoldIcs(text));
  } catch {
    return out;
  }
  for (const block of blocks) {
    try {
      let uid = "";
      let summary = "";
      let status = "";
      let transp = "";
      let dtstart: IcsDate | null = null;
      let dtend: IcsDate | null = null;
      let duration: number | null = null;
      let rrule: string | null = null;
      const exdates: number[] = [];
      for (const raw of block) {
        const line = parseIcsLine(raw);
        if (!line) continue;
        switch (line.name) {
          case "UID":
            uid = line.value.trim();
            break;
          case "SUMMARY":
            summary = unescapeIcsText(line.value);
            break;
          case "STATUS":
            status = line.value.trim().toUpperCase();
            break;
          case "TRANSP":
            transp = line.value.trim().toUpperCase();
            break;
          case "DTSTART":
            dtstart = parseIcsDateValue(line.value, line.params, tz);
            break;
          case "DTEND":
            dtend = parseIcsDateValue(line.value, line.params, tz);
            break;
          case "DURATION":
            duration = parseIcsDuration(line.value);
            break;
          case "RRULE":
            rrule = line.value.trim();
            break;
          case "EXDATE":
            for (const part of line.value.split(",")) {
              const ex = parseIcsDateValue(part, line.params, tz);
              if (ex) exdates.push(ex.ms);
            }
            break;
          default:
            break;
        }
      }
      if (!dtstart) continue;
      if (status === "CANCELLED") continue;
      if (transp === "TRANSPARENT") continue;

      const durMs = dtend ? dtend.ms - dtstart.ms : duration != null ? duration : dtstart.allDay ? DAY_MS : 0;
      const label = summary || "Busy";

      const starts = rrule ? expandRrule(dtstart, rrule, exdates, opts.to, tz) : [dtstart.ms];
      let n = 0;
      for (const startMs of starts) {
        const endMs = startMs + durMs;
        if (endMs <= opts.from || startMs >= opts.to) continue;
        out.push({
          id: `ics:${uid || shortId("ev")}:${startMs}`,
          kind: "blocked",
          start: startMs,
          end: endMs,
          allDay: dtstart.allDay,
          label,
          source: "ics",
        });
        n++;
        if (n > MAX_RRULE_OCCURRENCES) break;
      }
    } catch {
      // one malformed event never takes down the rest of the feed
      continue;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/* ==================================================================
 * CSV
 * ================================================================== */

export type CsvRowError = { line: number; message: string };

/**
 * Two example rows (a "closed for the season" block and a booked-open
 * window) plus a recurring-feeling rehearsal block and a timed event — the
 * columns a hand-edited spreadsheet needs. `type` accepts a few common
 * synonyms so a copy-pasted schedule doesn't need retyping.
 */
export const AVAILABILITY_CSV_TEMPLATE =
  "type,start,end,label\n" +
  "blocked,2026-10-05,2026-10-05,Weekly rehearsal block\n" +
  "blocked,2026-11-26,2026-11-27,Thanksgiving break\n" +
  "open,2026-10-01,2026-12-31,Open for booking (fall season)\n" +
  "blocked,2026-10-12 18:00,2026-10-12 22:00,Community theater event\n" +
  "available,2027-01-04,2027-01-15,Open — winter break\n";

function normalizeKind(raw: string): "open" | "blocked" | null {
  const s = raw.trim().toLowerCase();
  if (["open", "available", "free"].includes(s)) return "open";
  if (["blocked", "busy", "unavailable", "closed"].includes(s)) return "blocked";
  return null;
}

/** One CSV date cell -> {ms, hasTime}, or null if unparsable. Accepts
 *  YYYY-MM-DD, YYYY-MM-DD HH:MM / YYYY-MM-DDTHH:MM (24h), and M/D/YYYY with
 *  an optional "h:mm AM/PM" — the shape Excel round-trips a pasted sheet
 *  into most often. */
function parseCsvDateCell(raw: string, tz: string): { ms: number; hasTime: boolean } | null {
  const s = raw.trim();
  if (!s) return null;

  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(s);
  if (m) {
    const [, ys, mos, ds, hs, mis] = m;
    const hasTime = hs != null;
    const ms = zonedTimeToUtc(Number(ys), Number(mos), Number(ds), hasTime ? Number(hs) : 0, hasTime ? Number(mis) : 0, 0, tz);
    return { ms, hasTime };
  }

  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm))?$/.exec(s);
  if (m) {
    const [, mos, ds, ys, hs, mis, ap] = m;
    let year = Number(ys);
    if (year < 100) year += 2000;
    const hasTime = hs != null;
    let hour = hasTime ? Number(hs) : 0;
    if (hasTime && ap) {
      const isPm = ap.toLowerCase() === "pm";
      if (isPm && hour < 12) hour += 12;
      if (!isPm && hour === 12) hour = 0;
    }
    const ms = zonedTimeToUtc(year, Number(mos), Number(ds), hour, hasTime ? Number(mis) : 0, 0, tz);
    return { ms, hasTime };
  }

  return null;
}

/**
 * `type,start,end,label` CSV -> windows + per-row errors (1-indexed with
 * the header counted, so "line 2" is the first data row — matches what a
 * spreadsheet's row numbers would show). Never throws; a whole-file
 * problem (no header, empty) comes back as a single error at line 0.
 */
export function parseAvailabilityCsv(text: string, tz: string = DEFAULT_TZ): { windows: AvailWindow[]; errors: CsvRowError[] } {
  const errors: CsvRowError[] = [];
  const windows: AvailWindow[] = [];
  let parsed: { ok: boolean; error?: string; headers: string[]; rows: string[][] };
  try {
    parsed = parseCsv(text);
  } catch {
    return { windows, errors: [{ line: 0, message: "Could not read that file." }] };
  }
  if (!parsed.ok) return { windows, errors: [{ line: 0, message: parsed.error || "Could not parse the file." }] };

  const idx = (name: string) => parsed.headers.findIndex((h) => h.trim().toLowerCase() === name);
  const typeIdx = idx("type");
  const startIdx = idx("start");
  const endIdx = idx("end");
  const labelIdx = idx("label");
  if (typeIdx < 0 || startIdx < 0 || endIdx < 0) {
    return { windows, errors: [{ line: 0, message: "Missing required column(s) — expected type, start, end." }] };
  }

  parsed.rows.forEach((row, i) => {
    const lineNo = i + 2;
    const rawType = (row[typeIdx] || "").trim();
    const rawStart = (row[startIdx] || "").trim();
    const rawEnd = (row[endIdx] || "").trim();
    const label = labelIdx >= 0 ? (row[labelIdx] || "").trim() : "";
    if (!rawType && !rawStart && !rawEnd) return;

    const kind = normalizeKind(rawType);
    if (!kind) {
      errors.push({ line: lineNo, message: `Unrecognized type "${rawType}" — use open or blocked.` });
      return;
    }
    const s = parseCsvDateCell(rawStart, tz);
    if (!s) {
      errors.push({ line: lineNo, message: `Could not read start date "${rawStart}".` });
      return;
    }
    const e = parseCsvDateCell(rawEnd, tz);
    if (!e) {
      errors.push({ line: lineNo, message: `Could not read end date "${rawEnd}".` });
      return;
    }
    const allDay = !s.hasTime && !e.hasTime;
    // All-day end is written inclusive ("through Oct 5") — bump to the
    // exclusive boundary the rest of the app uses.
    const endMs = allDay ? e.ms + DAY_MS : e.ms;
    if (endMs <= s.ms) {
      errors.push({ line: lineNo, message: "End must be on or after start." });
      return;
    }
    windows.push({
      id: shortId("csv"),
      kind,
      start: s.ms,
      end: endMs,
      allDay,
      label,
      source: "csv",
    });
  });

  return { windows, errors };
}

/* ==================================================================
 * checking + display
 * ================================================================== */

export type AvailabilityStatus = "none" | "available" | "conflict" | "outside-open";

export type AvailabilityCheck = {
  status: AvailabilityStatus;
  conflicts: AvailWindow[];
};

function overlaps(w: AvailWindow, start: number, end: number): boolean {
  return w.start < end && w.end > start;
}

function isFullyCovered(start: number, end: number, opens: AvailWindow[]): boolean {
  const clipped = opens
    .map((w): [number, number] => [Math.max(w.start, start), Math.min(w.end, end)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let cursor = start;
  for (const [a, b] of clipped) {
    if (a > cursor) return false;
    if (b > cursor) cursor = b;
  }
  return cursor >= end;
}

/**
 * Is [start, end) available at this venue? Blocked windows always win; with
 * no blocked conflict, any open windows on file must fully cover the range
 * or the range reads as "outside the venue's open times"; with no windows
 * of either kind at all, there's simply no data to judge by.
 */
export function checkAvailability(cal: VenueCalendar | null | undefined, start: number, end: number): AvailabilityCheck {
  if (!cal || (!cal.windows.length && !cal.icsWindows.length)) return { status: "none", conflicts: [] };
  const all = [...cal.windows, ...cal.icsWindows];
  const blocked = all.filter((w) => w.kind === "blocked" && overlaps(w, start, end));
  if (blocked.length) return { status: "conflict", conflicts: blocked };
  const opens = all.filter((w) => w.kind === "open");
  if (opens.length) {
    const covering = opens.filter((w) => overlaps(w, start, end));
    if (!isFullyCovered(start, end, covering)) return { status: "outside-open", conflicts: [] };
  }
  return { status: "available", conflicts: [] };
}

/** Every window (any source) overlapping [from, to), sorted for display. */
export function windowsBetween(cal: VenueCalendar | null | undefined, from: number, to: number): AvailWindow[] {
  if (!cal) return [];
  const all = [...cal.windows, ...cal.icsWindows];
  return all.filter((w) => overlaps(w, from, to)).sort((a, b) => a.start - b.start);
}

/** A fresh id for a manually-added window (store-side; exported so the
 *  store and its callers share exactly one id scheme with the csv/ics ones
 *  above). */
export function newWindowId(): string {
  return shortId("aw");
}
