import { createHash } from "node:crypto";
import { norm } from "./ids";

/**
 * Daylite calendar events → Google Calendar (#219) — pure: no DB, no network.
 *
 * Parses Daylite's "Calendar Events" export (tab-separated; quoted cells; a
 * blank header column after "Duration (HH:MM)" and after "Name" plus a
 * trailing one; a narrow no-break space U+202F before AM/PM; Daylite's \"
 * escape inside quoted cells), splits repeating series from one-offs, derives
 * the dedup key and builds the Google event body.
 *
 * Times are WALL-CLOCK in the business zone. They go to Google as a local
 * dateTime + timeZone and are never converted through UTC. addMinutes uses
 * Date.UTC only as a zone-free calendar — no offset is ever applied.
 *
 * Spec: docs/superpowers/specs/2026-09-26-daylite-calendar-import-design.md
 */

export const BUSINESS_TZ = "America/Chicago";
/** A series is the same owner + name at least this many times (spec). */
export const SERIES_MIN = 4;
const DAY_MIN = 1440;

export type WallClock = { y: number; m: number; d: number; hh: number; mm: number };

export type DayliteEvent = {
  /** 1-based physical line in the file (header = 1). */
  line: number;
  owner: string;
  name: string;
  category: string;
  start: WallClock;
  /** Minutes. All-day rows keep the raw span (1440 per day). */
  durationMin: number;
  allDay: boolean;
  linked: string;
  details: string;
  status: string;
};

export type ParseError = { line: number; reason: string };
export type ParsedCalendar = { rows: DayliteEvent[]; errors: ParseError[] };
export type SeriesGroup = { owner: string; name: string; count: number };
export type RosterUser = { id: string; name: string };
export type OwnerMatch = { ok: true; user: RosterUser } | { ok: false; reason: string };

/** Google's view of a time: a local dateTime + its IANA zone, or an all-day date. */
export type ZonedTime = { dateTime: string; timeZone: string } | { date: string };
export type WallClockEventBody = {
  id: string;
  summary: string;
  description: string;
  start: ZonedTime;
  end: ZonedTime;
};

const COLS = {
  hhmm: "Duration (HH:MM)",
  category: "Category",
  start: "Start Date",
  status: "Status",
  name: "Name",
  linked: "Linked",
  owner: "Owner",
  details: "Details",
} as const;
type ColKey = keyof typeof COLS;
const REQUIRED: readonly string[] = [COLS.hhmm, COLS.start, COLS.name, COLS.owner];

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * Tab-separated rows with their 1-based physical line. A quoted cell may hold
 * tabs and newlines; inside quotes both `""` and Daylite's `\"` mean a
 * literal quote, and `\\` a literal backslash. Strips a BOM; drops rows whose
 * cells are all empty.
 */
export function splitTsv(text: string): { line: number; cells: string[] }[] {
  let s = text || "";
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  const endRow = () => {
    cells.push(field);
    field = "";
    if (cells.some((c) => c !== "")) out.push({ line: rowLine, cells });
    cells = [];
  };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === "\\" && (s[i + 1] === '"' || s[i + 1] === "\\")) {
        field += s[i + 1];
        i++;
      } else if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === "\n") line++;
        field += c;
      }
      continue;
    }
    if (c === '"' && field === "") {
      inQuotes = true;
      continue;
    }
    if (c === "\t") {
      cells.push(field);
      field = "";
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      endRow();
      line++;
      rowLine = line;
      continue;
    }
    field += c;
  }
  if (field !== "" || cells.length) endRow();
  return out;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** "M/D/YY, h:mm AM" (U+202F, U+00A0 or a plain space before AM/PM). */
export function parseStart(raw: string): WallClock | null {
  const s = (raw || "").replace(/[  ]/g, " ").trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4}),?\s+(\d{1,2}):(\d{2})\s*([AaPp])[Mm]$/.exec(s);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const h12 = Number(m[4]);
  const mm = Number(m[5]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || h12 < 1 || h12 > 12 || mm > 59) return null;
  const pm = m[6].toUpperCase() === "P";
  const hh = h12 === 12 ? (pm ? 12 : 0) : pm ? h12 + 12 : h12;
  return { y, m: mo, d, hh, mm };
}

/** "HH:MM" with any number of hours ("600:00") → minutes. */
export function parseDurationHHMM(raw: string): number | null {
  const m = /^(\d{1,4}):(\d{2})$/.exec((raw || "").trim());
  if (!m || Number(m[2]) > 59) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function parseCalendarTsv(text: string): ParsedCalendar {
  const table = splitTsv(text);
  if (!table.length) return { rows: [], errors: [{ line: 1, reason: "The file is empty." }] };
  const header = table[0].cells.map((h) => h.trim());
  const missing = REQUIRED.filter((h) => !header.includes(h));
  if (missing.length)
    return {
      rows: [],
      errors: [
        {
          line: table[0].line,
          reason: `Missing column${missing.length > 1 ? "s" : ""} ${missing.join(", ")} — is this Daylite's Calendar Events export?`,
        },
      ],
    };
  const idx = {} as Record<ColKey, number>;
  for (const k of Object.keys(COLS) as ColKey[]) idx[k] = header.indexOf(COLS[k]);
  const cell = (cells: string[], k: ColKey) => (idx[k] < 0 ? "" : cells[idx[k]] ?? "").trim();

  const rows: DayliteEvent[] = [];
  const errors: ParseError[] = [];
  for (const { line, cells } of table.slice(1)) {
    const name = cell(cells, "name");
    const owner = cell(cells, "owner");
    if (!name) {
      errors.push({ line, reason: "No event name." });
      continue;
    }
    if (!owner) {
      errors.push({ line, reason: `"${name}" has no owner.` });
      continue;
    }
    const startRaw = cell(cells, "start");
    const start = parseStart(startRaw);
    if (!start) {
      errors.push({ line, reason: `Unreadable start date "${startRaw}".` });
      continue;
    }
    const durRaw = cell(cells, "hhmm");
    const dur = parseDurationHHMM(durRaw);
    if (dur == null) {
      errors.push({ line, reason: `Unreadable duration "${durRaw}".` });
      continue;
    }
    const allDay = dur >= DAY_MIN && start.hh === 0 && start.mm === 0;
    rows.push({
      line,
      owner,
      name,
      category: cell(cells, "category"),
      start,
      durationMin: allDay ? dur : dur || 60,
      allDay,
      linked: cell(cells, "linked"),
      details: cell(cells, "details"),
      status: cell(cells, "status"),
    });
  }
  return { rows, errors };
}

export function seriesKey(e: { owner: string; name: string }): string {
  return norm(e.owner) + "|" + norm(e.name);
}

/** Owner + name (case/space-insensitive) ≥ SERIES_MIN times is a series; all its rows are skipped. */
export function classify(rows: DayliteEvent[]): { oneOffs: DayliteEvent[]; series: SeriesGroup[] } {
  const groups = new Map<string, SeriesGroup>();
  for (const e of rows) {
    const k = seriesKey(e);
    const g = groups.get(k);
    if (g) g.count++;
    else groups.set(k, { owner: e.owner, name: e.name, count: 1 });
  }
  const series = [...groups.values()]
    .filter((g) => g.count >= SERIES_MIN)
    .sort((a, b) => b.count - a.count || a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name));
  const inSeries = new Set(series.map(seriesKey));
  return { oneOffs: rows.filter((e) => !inSeries.has(seriesKey(e))), series };
}

export function ymd(w: { y: number; m: number; d: number }): string {
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`;
}

function localIso(w: WallClock): string {
  return `${ymd(w)}T${pad(w.hh)}:${pad(w.mm)}:00`;
}

/** Wall-clock + minutes. Date.UTC is used as a zone-free calendar only. */
export function addMinutes(w: WallClock, minutes: number): WallClock {
  const t = new Date(Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm) + minutes * 60_000);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), hh: t.getUTCHours(), mm: t.getUTCMinutes() };
}

/**
 * The dedup key: sha256 of normalized owner | normalized name | local start |
 * durationMin, first 24 hex characters. Stored in the dayliteCalendarImport
 * blob — changing this function re-imports everything as duplicates.
 */
export function eventKey(e: Pick<DayliteEvent, "owner" | "name" | "start" | "durationMin">): string {
  const s = e.start;
  const at = `${ymd(s)}T${pad(s.hh)}:${pad(s.mm)}`;
  return createHash("sha256")
    .update([norm(e.owner), norm(e.name), at, String(e.durationMin)].join("|"))
    .digest("hex")
    .slice(0, 24);
}

/** Google event ids are base32hex (a–v, 0–9), 5–1024 chars: "dlc" + 24 hex fits. */
export function googleEventId(key: string): string {
  return "dlc" + key;
}

export function googleEventFor(e: DayliteEvent, timeZone: string = BUSINESS_TZ): WallClockEventBody {
  const summary = (e.category ? `[${e.category}] ` : "") + e.name;
  const description = [e.details, e.linked ? `Linked: ${e.linked}` : "", "Imported from Daylite"]
    .filter(Boolean)
    .join("\n\n");
  const id = googleEventId(eventKey(e));
  if (e.allDay) {
    const days = Math.max(1, Math.ceil(e.durationMin / DAY_MIN));
    return {
      id,
      summary,
      description,
      start: { date: ymd(e.start) },
      end: { date: ymd(addMinutes(e.start, days * DAY_MIN)) },
    };
  }
  return {
    id,
    summary,
    description,
    start: { dateTime: localIso(e.start), timeZone },
    end: { dateTime: localIso(addMinutes(e.start, e.durationMin)), timeZone },
  };
}

function firstLast(n: string): string | null {
  const t = n.split(" ").filter(Boolean);
  return t.length >= 2 ? t[0] + " " + t[t.length - 1] : null;
}

/** Exact case-insensitive full name, else first + last token. Ambiguity is a refusal. */
export function matchOwner(owner: string, users: RosterUser[]): OwnerMatch {
  const n = norm(owner);
  if (!n) return { ok: false, reason: "No owner name." };
  const exact = users.filter((u) => norm(u.name) === n);
  if (exact.length === 1) return { ok: true, user: exact[0] };
  if (exact.length > 1) return { ok: false, reason: `More than one team member is named ${owner}.` };
  const fl = firstLast(n);
  const loose = fl ? users.filter((u) => firstLast(norm(u.name)) === fl) : [];
  if (loose.length === 1) return { ok: true, user: loose[0] };
  if (loose.length > 1) return { ok: false, reason: `More than one team member matches ${owner}.` };
  return { ok: false, reason: `No team member named ${owner}.` };
}

/** Today's date (YYYY-MM-DD) in the given zone. */
export function todayYmdIn(nowMs: number, timeZone: string = BUSINESS_TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    new Date(nowMs)
  );
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
