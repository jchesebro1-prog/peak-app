/**
 * Scheduling preferences (spec 2026-10-09 "Buffer", "Staying over"; specs 2
 * and 3 extend the same blobs with optional fields). No table, no migration —
 * the dashboard_layouts:<userId> idiom:
 *   schedule_defaults            { driveBufferMin }        admin, Settings → Field
 *                                (also { workHours, sameAreaMin, dailyDriveLimitMin,
 *                                nearbyLookaheadDays } — spec 2026-10-09 site-visit scheduling)
 *   schedule_prefs:<userId>      { driveBufferMin | null } the rep, Account
 *                                (also { workHours | null })
 *   stay_over:<userId>           { "YYYY-MM-DD": true }    one key per day
 *   drive_sync:<userId>          { lastSyncAt, legacyCleanedAt, staleAt,
 *                                  legacyRetry, legacyCursorMs, syncingUntil }
 * Blobs survive the go-live demo wipe.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getBlob, setBlob } from "@/db/doc-store";
import { blobs } from "@/db/doc-tables";
import { isDayKey } from "@/lib/drive-plan/day";
import {
  cleanSchedulingInput,
  cleanWorkHours,
  readSchedulingSettings,
  type SchedulingSettings,
  type WorkHours,
} from "@/lib/visit-plan/settings";

export const SCHEDULE_DEFAULTS_BLOB = "schedule_defaults";
export const DEFAULT_DRIVE_BUFFER_MIN = 15;
export const MAX_DRIVE_BUFFER_MIN = 120;

export type ScheduleDefaults = { driveBufferMin: number };
export type UserSchedulePrefs = { driveBufferMin: number | null };
/** staleAt: when markDriveStale last ran — a sync that started before it
 *  must not stamp the rep fresh (drive-sync compares it with its start).
 *  legacyRetry: D144 blocks whose delete failed after a complete scan, retried
 *  by later drive syncs (no re-scan). legacyCursorMs: where a scan cut off by
 *  its read cap resumes. The sync lease (syncingUntil) is not part of this
 *  state — only acquire/releaseDriveSyncLease touch it. */
export type LegacyRetry = Record<string, { startMs: number; tries: number }>;
export type DriveSyncState = {
  lastSyncAt: number;
  legacyCleanedAt: number | null;
  staleAt?: number;
  legacyRetry?: LegacyRetry;
  legacyCursorMs?: number;
};

const prefsId = (userId: string) => `schedule_prefs:${userId}`;
const stayId = (userId: string) => `stay_over:${userId}`;
const syncId = (userId: string) => `drive_sync:${userId}`;

/** Whole minutes clamped to 0–120; blank / non-numeric = unset (null). */
export function cleanBufferMin(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  if (typeof v !== "number" && typeof v !== "string") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(MAX_DRIVE_BUFFER_MIN, Math.max(0, Math.round(n)));
}

export function bufferMinFor(defaults: ScheduleDefaults, prefs: UserSchedulePrefs): number {
  return prefs.driveBufferMin ?? defaults.driveBufferMin;
}

export async function getScheduleDefaults(): Promise<ScheduleDefaults> {
  const raw = await getBlob<Record<string, unknown>>(SCHEDULE_DEFAULTS_BLOB, {});
  return { driveBufferMin: cleanBufferMin(raw.driveBufferMin) ?? DEFAULT_DRIVE_BUFFER_MIN };
}

export type SaveScheduleDefaultsResult = { ok: true; driveBufferMin: number } | { ok: false; error: string };

/** Refuses blank / non-numeric input instead of silently storing the 15-minute fallback. */
export async function saveScheduleDefaults(input: { driveBufferMin: unknown }): Promise<SaveScheduleDefaultsResult> {
  const driveBufferMin = cleanBufferMin(input?.driveBufferMin);
  if (driveBufferMin == null) return { ok: false, error: `Enter a number of minutes (0–${MAX_DRIVE_BUFFER_MIN}).` };
  await setBlob(SCHEDULE_DEFAULTS_BLOB, { driveBufferMin });
  return { ok: true, driveBufferMin };
}

export async function getUserSchedulePrefs(userId: string): Promise<UserSchedulePrefs> {
  const raw = await getBlob<Record<string, unknown>>(prefsId(userId), {});
  return { driveBufferMin: cleanBufferMin(raw.driveBufferMin) };
}

export async function saveUserSchedulePrefs(userId: string, input: { driveBufferMin: unknown }): Promise<UserSchedulePrefs> {
  const driveBufferMin = cleanBufferMin(input?.driveBufferMin);
  await setBlob(prefsId(userId), { driveBufferMin });
  return { driveBufferMin };
}

export async function driveBufferFor(userId: string): Promise<number> {
  const [defaults, prefs] = await Promise.all([getScheduleDefaults(), getUserSchedulePrefs(userId)]);
  return bufferMinFor(defaults, prefs);
}

/* ---- site-visit scheduling (spec 2026-10-09 site-visit scheduling) ------ */

export async function getSchedulingSettings(): Promise<SchedulingSettings> {
  return readSchedulingSettings(await getBlob<Record<string, unknown>>(SCHEDULE_DEFAULTS_BLOB, {}));
}

/** Admin save. setBlob merges top-level keys, so driveBufferMin is untouched. */
export async function saveSchedulingSettings(
  input: unknown
): Promise<{ ok: true; settings: SchedulingSettings } | { ok: false; error: string }> {
  const c = cleanSchedulingInput(input);
  if (!c.ok) return c;
  await setBlob(SCHEDULE_DEFAULTS_BLOB, { ...c.value });
  return { ok: true, settings: c.value };
}

export async function getUserWorkHours(userId: string): Promise<WorkHours | null> {
  const raw = await getBlob<Record<string, unknown>>(prefsId(userId), {});
  return cleanWorkHours(raw.workHours);
}

/** null = use the company default. */
export async function saveUserWorkHours(
  userId: string,
  input: unknown
): Promise<{ ok: true; workHours: WorkHours | null } | { ok: false; error: string }> {
  if (input === null) {
    await setBlob(prefsId(userId), { workHours: null });
    return { ok: true, workHours: null };
  }
  const h = cleanWorkHours(input, true);
  if (!h) return { ok: false, error: "Pick at least one day and an end after the start." };
  await setBlob(prefsId(userId), { workHours: h });
  return { ok: true, workHours: h };
}

export async function workHoursFor(userId: string): Promise<WorkHours> {
  const [s, own] = await Promise.all([getSchedulingSettings(), getUserWorkHours(userId)]);
  return own ?? s.workHours;
}

/** Only the days switched on. */
export async function getStayOvers(userId: string): Promise<Record<string, boolean>> {
  const raw = await getBlob<Record<string, unknown>>(stayId(userId), {});
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw)) if (isDayKey(k) && v === true) out[k] = true;
  return out;
}

/** One top-level key per day, so setBlob's atomic merge never loses a concurrent toggle. false = bad day key. */
export async function setStayOver(userId: string, dayKey: string, on: boolean): Promise<boolean> {
  if (!isDayKey(dayKey)) return false;
  await setBlob(stayId(userId), { [dayKey]: on === true });
  return true;
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function cleanLegacyRetry(v: unknown): LegacyRetry {
  const out: LegacyRetry = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [id, r] of Object.entries(v as Record<string, unknown>)) {
    const e = r as { startMs?: unknown; tries?: unknown } | null;
    if (id && e && finite(e.startMs) && finite(e.tries)) out[id] = { startMs: e.startMs, tries: e.tries };
  }
  return out;
}

export async function getDriveSyncState(userId: string): Promise<DriveSyncState> {
  const raw = await getBlob<Record<string, unknown>>(syncId(userId), {});
  return {
    lastSyncAt: typeof raw.lastSyncAt === "number" ? raw.lastSyncAt : 0,
    legacyCleanedAt: typeof raw.legacyCleanedAt === "number" ? raw.legacyCleanedAt : null,
    staleAt: typeof raw.staleAt === "number" ? raw.staleAt : 0,
    legacyRetry: cleanLegacyRetry(raw.legacyRetry),
    ...(finite(raw.legacyCursorMs) ? { legacyCursorMs: raw.legacyCursorMs } : {}),
  };
}

export async function setDriveSyncState(userId: string, patch: Partial<DriveSyncState>): Promise<void> {
  const clean: Record<string, unknown> = {};
  if (typeof patch?.lastSyncAt === "number" && Number.isFinite(patch.lastSyncAt)) clean.lastSyncAt = patch.lastSyncAt;
  if (typeof patch?.staleAt === "number" && Number.isFinite(patch.staleAt)) clean.staleAt = patch.staleAt;
  if (finite(patch?.legacyCursorMs)) clean.legacyCursorMs = patch.legacyCursorMs;
  if (patch && "legacyRetry" in patch) clean.legacyRetry = cleanLegacyRetry(patch.legacyRetry);
  if (patch && "legacyCleanedAt" in patch && (patch.legacyCleanedAt === null || (typeof patch.legacyCleanedAt === "number" && Number.isFinite(patch.legacyCleanedAt))))
    clean.legacyCleanedAt = patch.legacyCleanedAt;
  if (!Object.keys(clean).length) return;
  await setBlob(syncId(userId), clean);
}

/** Force the next calendar view / cron pass to re-sync these reps. staleAt
 *  lets a sync already in flight see the mark and leave the rep stale. */
export async function markDriveStale(userIds: string[], nowMs: number = Date.now()): Promise<void> {
  for (const id of userIds) await setDriveSyncState(id, { lastSyncAt: 0, staleAt: nowMs });
}

/* ---- the per-rep sync lease ---------------------------------------------
 * Concurrent syncs for one rep (cron, page-load stale check, a visit change's
 * after() resync) would each read Google, plan, and insert the same leg. Every
 * sync takes this lease first. Acquire is ONE conditional statement on the
 * drive_sync blob row (insert, or update only where syncingUntil is absent or
 * past), so two racing acquires can't both win. The lease expires on its own
 * (a crashed sync never wedges the rep). */

export const DRIVE_SYNC_LEASE_MS = 90_000;

/** The lease token (its syncingUntil) when acquired, null when another sync
 *  holds the rep. */
export async function acquireDriveSyncLease(userId: string, nowMs: number = Date.now(), ttlMs: number = DRIVE_SYNC_LEASE_MS): Promise<number | null> {
  const until = Math.round(nowMs + ttlMs);
  const patch = { syncingUntil: until };
  const db = await getDb();
  const rows = await db
    .insert(blobs)
    .values({ id: syncId(userId), data: patch, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: blobs.id,
      set: { data: sql`${blobs.data} || ${JSON.stringify(patch)}::jsonb`, updatedAt: Date.now() },
      setWhere: sql`coalesce(case when jsonb_typeof(${blobs.data}->'syncingUntil') = 'number' then (${blobs.data}->>'syncingUntil')::numeric end, 0) < ${Math.round(nowMs)}`,
    })
    .returning({ id: blobs.id });
  return rows.length ? until : null;
}

/** Extends the lease — atomically, only while syncingUntil is still exactly
 *  our token (another sync that took over an expired lease has a different
 *  one). Returns the new token (always a new number, so a stale holder's
 *  token can never match again) or null when the lease is no longer ours. */
export async function renewDriveSyncLease(userId: string, token: number, nowMs: number = Date.now(), ttlMs: number = DRIVE_SYNC_LEASE_MS): Promise<number | null> {
  const until = Math.max(Math.round(nowMs + ttlMs), Math.round(token) + 1);
  const db = await getDb();
  const rows = await db
    .update(blobs)
    .set({ data: sql`${blobs.data} || ${JSON.stringify({ syncingUntil: until })}::jsonb`, updatedAt: Date.now() })
    .where(
      and(
        eq(blobs.id, syncId(userId)),
        sql`case when jsonb_typeof(${blobs.data}->'syncingUntil') = 'number' then (${blobs.data}->>'syncingUntil')::numeric end = ${Math.round(token)}`
      )
    )
    .returning({ id: blobs.id });
  return rows.length ? until : null;
}

/** Frees the rep — only if the lease is still this token (an expired lease
 *  someone else has since taken is left alone). */
export async function releaseDriveSyncLease(userId: string, token: number): Promise<void> {
  const db = await getDb();
  await db
    .update(blobs)
    .set({ data: sql`${blobs.data} - 'syncingUntil'`, updatedAt: Date.now() })
    .where(
      and(
        eq(blobs.id, syncId(userId)),
        sql`case when jsonb_typeof(${blobs.data}->'syncingUntil') = 'number' then (${blobs.data}->>'syncingUntil')::numeric end = ${Math.round(token)}`
      )
    );
}
