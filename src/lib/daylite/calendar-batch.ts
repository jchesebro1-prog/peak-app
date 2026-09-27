import { isRateLimit } from "@/lib/gmail/config";
import {
  classify,
  eventKey,
  googleEventFor,
  matchOwner,
  ymd,
  type DayliteEvent,
  type ParseError,
  type ParsedCalendar,
  type RosterUser,
  type SeriesGroup,
  type WallClockEventBody,
} from "./calendar-events";
import { norm } from "./ids";

/**
 * Daylite calendar import (#219) — preview, pending selection and the
 * budgeted batch runner. No DB and no network: insert / record / now are
 * injected (calendar-import.ts passes the live ones; the spec harness passes
 * fakes), so Google is never touched by a test.
 */

/** doc-store blobs row: { [eventKey]: { eventId, owner, at } }, one top-level key per event. */
export const DAYLITE_CALENDAR_BLOB = "dayliteCalendarImport";
/** Per request; the page's maxDuration is 60 s. */
export const BATCH_BUDGET_MS = 45_000;
/** One insert's worst case: calendar.ts aborts at 5 s, plus a token refresh. */
export const INSERT_WORST_CASE_MS = 7_000;
/** Consecutive failures for one owner in one batch before that owner stops. */
export const OWNER_STOP_AFTER = 5;

export type ImportedMark = { eventId: string; owner: string; at: number };
export type ImportedMap = Record<string, ImportedMark>;
export type CalendarState = "connected" | "no-calendar" | "not-connected" | "gmail-off";
export type PlanOptions = { fromYmd: string | null };

export type OwnerPreview = {
  owner: string;
  userId: string | null;
  userName: string | null;
  /** Why no user matched ("" when one did). */
  matchNote: string;
  calendar: CalendarState | "no-user";
  oneOffs: number;
  alreadyImported: number;
  toImport: number;
  series: { name: string; count: number }[];
  seriesRows: number;
  defaultInclude: boolean;
};

export type CalendarPreview = {
  owners: OwnerPreview[];
  errors: ParseError[];
  fromYmd: string | null;
  totals: {
    rows: number;
    oneOffs: number;
    seriesCount: number;
    seriesRows: number;
    duplicates: number;
    alreadyImported: number;
    toImport: number;
  };
};

export type PendingEvent = { key: string; owner: string; mailboxKey: string; body: WallClockEventBody };

export type BatchDeps = {
  insert: (mailboxKey: string, body: WallClockEventBody) => Promise<{ id: string }>;
  record: (patch: ImportedMap) => Promise<void>;
  now: () => number;
};

export type OwnerTally = { written: number; alreadyThere: number; failed: number; lastError: string };

export type BatchResult = {
  stoppedFor: "done" | "budget" | "quota";
  pendingAtStart: number;
  written: number;
  alreadyThere: number;
  failed: number;
  /** Pending events not attempted in this call (stopped owners excluded). */
  remaining: number;
  /** Failed this call — the client sends them back as skipKeys. */
  failedKeys: string[];
  stoppedOwners: string[];
  byOwner: Record<string, OwnerTally>;
  quotaMessage: string;
};

export function sanitizeImported(raw: Record<string, unknown>): ImportedMap {
  const out: ImportedMap = {};
  for (const [k, v] of Object.entries(raw || {})) {
    if (!v || typeof v !== "object") continue;
    const m = v as Partial<ImportedMark>;
    if (typeof m.eventId !== "string" || !m.eventId) continue;
    out[k] = { eventId: m.eventId, owner: typeof m.owner === "string" ? m.owner : "", at: typeof m.at === "number" ? m.at : 0 };
  }
  return out;
}

type Planned = { key: string; event: DayliteEvent };

/** One-offs after the date filter, each keyed once (a repeated key counts as a duplicate). */
export function planOneOffs(
  parsed: ParsedCalendar,
  opts: PlanOptions
): { planned: Planned[]; duplicates: number; series: SeriesGroup[]; seriesRows: number } {
  const { oneOffs, series } = classify(parsed.rows);
  const seen = new Set<string>();
  const planned: Planned[] = [];
  let duplicates = 0;
  for (const event of oneOffs) {
    if (opts.fromYmd && ymd(event.start) < opts.fromYmd) continue;
    const key = eventKey(event);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    planned.push({ key, event });
  }
  return { planned, duplicates, series, seriesRows: series.reduce((n, g) => n + g.count, 0) };
}

export function buildPreview(
  parsed: ParsedCalendar,
  users: RosterUser[],
  calendarByUserId: Record<string, CalendarState>,
  done: ImportedMap,
  opts: PlanOptions
): CalendarPreview {
  const plan = planOneOffs(parsed, opts);
  const byOwner = new Map<string, OwnerPreview>();
  const ownerRow = (name: string): OwnerPreview => {
    const k = norm(name);
    const existing = byOwner.get(k);
    if (existing) return existing;
    const m = matchOwner(name, users);
    const calendar: OwnerPreview["calendar"] = m.ok ? calendarByUserId[m.user.id] ?? "not-connected" : "no-user";
    const row: OwnerPreview = {
      owner: name,
      userId: m.ok ? m.user.id : null,
      userName: m.ok ? m.user.name : null,
      matchNote: m.ok ? "" : m.reason,
      calendar,
      oneOffs: 0,
      alreadyImported: 0,
      toImport: 0,
      series: [],
      seriesRows: 0,
      defaultInclude: calendar === "connected",
    };
    byOwner.set(k, row);
    return row;
  };
  for (const e of parsed.rows) ownerRow(e.owner);
  for (const p of plan.planned) {
    const o = ownerRow(p.event.owner);
    o.oneOffs++;
    if (done[p.key]) o.alreadyImported++;
    else o.toImport++;
  }
  for (const g of plan.series) {
    const o = ownerRow(g.owner);
    o.series.push({ name: g.name, count: g.count });
    o.seriesRows += g.count;
  }
  const owners = [...byOwner.values()].sort((a, b) => a.owner.localeCompare(b.owner));
  const sum = (f: (o: OwnerPreview) => number) => owners.reduce((n, o) => n + f(o), 0);
  return {
    owners,
    errors: parsed.errors,
    fromYmd: opts.fromYmd,
    totals: {
      rows: parsed.rows.length,
      oneOffs: plan.planned.length,
      seriesCount: plan.series.length,
      seriesRows: plan.seriesRows,
      duplicates: plan.duplicates,
      alreadyImported: sum((o) => o.alreadyImported),
      toImport: sum((o) => o.toImport),
    },
  };
}

/**
 * What a batch should write: planned one-offs of the included owners that are
 * neither recorded nor skipped, each aimed at the MATCHED owner's own mailbox.
 * An owner with no match or no entry in mailboxByUserId is dropped.
 */
export function selectPending(
  parsed: ParsedCalendar,
  users: RosterUser[],
  mailboxByUserId: Record<string, string>,
  done: ImportedMap,
  opts: PlanOptions & { owners: string[]; skipKeys: string[] }
): PendingEvent[] {
  const include = new Set(opts.owners.map(norm));
  const skip = new Set(opts.skipKeys);
  const mailboxCache = new Map<string, string | null>();
  const mailboxFor = (owner: string): string | null => {
    const k = norm(owner);
    if (!mailboxCache.has(k)) {
      const m = matchOwner(owner, users);
      mailboxCache.set(k, m.ok ? mailboxByUserId[m.user.id] ?? null : null);
    }
    return mailboxCache.get(k) ?? null;
  };
  const out: PendingEvent[] = [];
  for (const { key, event } of planOneOffs(parsed, opts).planned) {
    if (!include.has(norm(event.owner)) || done[key] || skip.has(key)) continue;
    const mailboxKey = mailboxFor(event.owner);
    if (!mailboxKey) continue;
    out.push({ key, owner: event.owner, mailboxKey, body: googleEventFor(event) });
  }
  return out;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function shortText(err: unknown): string {
  const m = messageOf(err);
  return m.length > 300 ? m.slice(0, 300) + "…" : m;
}

/** Google's per-user rate limit or its calendar usage limit — stop and resume later. */
export function isQuotaStop(err: unknown): boolean {
  return isRateLimit(err) || /quotaExceeded|usageLimits|usage limits exceeded/i.test(messageOf(err));
}

/** calendar.ts formats errors as "Calendar API <path> → <status> <body>". */
export function isAlreadyExists(err: unknown): boolean {
  return /→ 409\b/.test(messageOf(err));
}

/**
 * Write `pending` in order until done, out of budget, or stopped by quota.
 * A new insert starts only while a worst-case insert still fits (the first
 * always runs). Each success — or a 409 on our deterministic id — is recorded
 * immediately; a record failure throws (the resume's 409 records it later).
 */
export async function runCalendarBatch(
  pending: PendingEvent[],
  deps: BatchDeps,
  budgetMs: number = BATCH_BUDGET_MS
): Promise<BatchResult> {
  const started = deps.now();
  const res: BatchResult = {
    stoppedFor: "done",
    pendingAtStart: pending.length,
    written: 0,
    alreadyThere: 0,
    failed: 0,
    remaining: 0,
    failedKeys: [],
    stoppedOwners: [],
    byOwner: {},
    quotaMessage: "",
  };
  const streak = new Map<string, number>();
  const stopped = new Set<string>();
  const left = (from: number) => pending.slice(from).filter((q) => !stopped.has(q.owner)).length;
  let attempted = 0;

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    if (stopped.has(p.owner)) continue;
    if (attempted > 0 && deps.now() - started + INSERT_WORST_CASE_MS > budgetMs) {
      res.stoppedFor = "budget";
      res.remaining = left(i);
      return res;
    }
    attempted++;
    const tally = res.byOwner[p.owner] || (res.byOwner[p.owner] = { written: 0, alreadyThere: 0, failed: 0, lastError: "" });
    let mark: ImportedMark;
    try {
      const r = await deps.insert(p.mailboxKey, p.body);
      mark = { eventId: r.id || p.body.id, owner: p.owner, at: deps.now() };
      tally.written++;
      res.written++;
    } catch (err) {
      if (isAlreadyExists(err)) {
        mark = { eventId: p.body.id, owner: p.owner, at: deps.now() };
        tally.alreadyThere++;
        res.alreadyThere++;
      } else if (isQuotaStop(err)) {
        res.stoppedFor = "quota";
        res.quotaMessage = shortText(err);
        res.remaining = left(i);
        return res;
      } else {
        tally.failed++;
        tally.lastError = shortText(err);
        res.failed++;
        res.failedKeys.push(p.key);
        const n = (streak.get(p.owner) ?? 0) + 1;
        streak.set(p.owner, n);
        if (n >= OWNER_STOP_AFTER) {
          stopped.add(p.owner);
          res.stoppedOwners.push(p.owner);
        }
        continue;
      }
    }
    streak.set(p.owner, 0);
    await deps.record({ [p.key]: mark });
  }
  return res;
}
