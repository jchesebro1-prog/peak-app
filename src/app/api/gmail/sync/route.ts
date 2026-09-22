import { NextResponse } from "next/server";
import { AUTO_SYNC_MIN_AGE_MS } from "@/lib/gmail/config";
import { checkMailIfStale } from "@/lib/stores/comms";
import { syncAllGoogleTasks } from "@/lib/google/tasks-sync";
import { reconcileRecordings } from "@/lib/krisp/reconcile";
import { archiveRecordings } from "@/lib/krisp/archive";
import { ensureVendorAssignments } from "@/lib/vendor-tasks";

// #97 — the Gmail import/poll can take longer than the platform default
export const maxDuration = 60;

/**
 * Cron-triggered Gmail sync (D74) — the serverless half of "sync is server
 * side, always current". Vercel Cron (vercel.json) calls this on a schedule
 * with `Authorization: Bearer ${CRON_SECRET}` (Vercel adds the header
 * automatically when the CRON_SECRET env var exists); any external pinger can
 * do the same. Middleware exempts this path from the session gate, so the
 * secret is the ONLY auth — the route is disabled entirely (503) until
 * CRON_SECRET is configured. The sync itself is throttled by atomic
 * per-mailbox claims, so an aggressive schedule is safe.
 *
 * D146 rides this same trigger for the Google Tasks Home Queue sync: rather
 * than add a second vercel.json cron entry (a second scheduling mechanism
 * for what's conceptually the same "poll Google on a timer" job this route
 * already exists for), syncAllGoogleTasks() runs as an extra step here. It's
 * wrapped in its own try/catch so a Tasks-side failure can never fail the
 * Gmail sync this route was built for; a hiccup is reported in the response
 * body, not thrown.
 *
 * The Recordings feature (spec §3.2 + §5.2) adds two more steps on the same
 * pattern: `reconcileRecordings()` polls Krisp for transcripts that are
 * still processing (≤ 5 per Krisp account per pass), and
 * `archiveRecordings()` moves settled audio from Blob to the Drive archive
 * (≤ 5 per run). Both are own-try/catch and never throw; on Hobby this
 * makes them daily, and the Vercel upgrade only shortens the cadence.
 *
 * #122 adds ensureVendorAssignments() the same way — the vendor spec's
 * "daily cron" is this route.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== "Bearer " + secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const r = await checkMailIfStale(AUTO_SYNC_MIN_AGE_MS);

  let googleTasks: Awaited<ReturnType<typeof syncAllGoogleTasks>> | { error: string };
  try {
    googleTasks = await syncAllGoogleTasks();
  } catch (err) {
    googleTasks = { error: (err as Error).message };
  }

  let recordings: Awaited<ReturnType<typeof reconcileRecordings>> | { error: string };
  try {
    recordings = await reconcileRecordings();
  } catch (err) {
    recordings = { error: (err as Error).message };
  }

  let recordingsArchive: Awaited<ReturnType<typeof archiveRecordings>> | { error: string };
  try {
    recordingsArchive = await archiveRecordings();
  } catch (err) {
    recordingsArchive = { error: (err as Error).message };
  }

  // #122 — vendor price-list freshness (spec §4): one catalog read, one
  // profiles read, at most one new Home Queue task per (vendor, status,
  // date) key. Own try/catch like the other riders on this daily trigger.
  let vendors: Awaited<ReturnType<typeof ensureVendorAssignments>> | { error: string };
  try {
    vendors = await ensureVendorAssignments(undefined, "Quartzite (daily check)");
  } catch (err) {
    vendors = { error: (err as Error).message };
  }

  return NextResponse.json({ ...r, googleTasks, recordings, recordingsArchive, vendors });
}
