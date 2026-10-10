/**
 * Scheduling preferences (spec 2026-10-09 "Buffer", "Staying over"; specs 2
 * and 3 extend the same blobs with optional fields). No table, no migration —
 * the dashboard_layouts:<userId> idiom:
 *   schedule_defaults            { driveBufferMin }        admin, Settings → Field
 *   schedule_prefs:<userId>      { driveBufferMin | null } the rep, Account
 *   stay_over:<userId>           { "YYYY-MM-DD": true }    one key per day
 *   drive_sync:<userId>          { lastSyncAt, legacyCleanedAt, staleAt }
 * Blobs survive the go-live demo wipe.
 */
import { getBlob, setBlob } from "@/db/doc-store";
import { isDayKey } from "@/lib/drive-plan/day";

export const SCHEDULE_DEFAULTS_BLOB = "schedule_defaults";
export const DEFAULT_DRIVE_BUFFER_MIN = 15;
export const MAX_DRIVE_BUFFER_MIN = 120;

export type ScheduleDefaults = { driveBufferMin: number };
export type UserSchedulePrefs = { driveBufferMin: number | null };
/** staleAt: when markDriveStale last ran — a sync that started before it
 *  must not stamp the rep fresh (drive-sync compares it with its start). */
export type DriveSyncState = { lastSyncAt: number; legacyCleanedAt: number | null; staleAt?: number };

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

export async function getDriveSyncState(userId: string): Promise<DriveSyncState> {
  const raw = await getBlob<Record<string, unknown>>(syncId(userId), {});
  return {
    lastSyncAt: typeof raw.lastSyncAt === "number" ? raw.lastSyncAt : 0,
    legacyCleanedAt: typeof raw.legacyCleanedAt === "number" ? raw.legacyCleanedAt : null,
    staleAt: typeof raw.staleAt === "number" ? raw.staleAt : 0,
  };
}

export async function setDriveSyncState(userId: string, patch: Partial<DriveSyncState>): Promise<void> {
  const clean: Record<string, unknown> = {};
  if (typeof patch?.lastSyncAt === "number" && Number.isFinite(patch.lastSyncAt)) clean.lastSyncAt = patch.lastSyncAt;
  if (typeof patch?.staleAt === "number" && Number.isFinite(patch.staleAt)) clean.staleAt = patch.staleAt;
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
