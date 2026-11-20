import { NextResponse } from "next/server";
import { AUTO_SYNC_MIN_AGE_MS } from "@/lib/gmail/config";
import { checkMailIfStale } from "@/lib/stores/comms";
import { reconcileRecordings } from "@/lib/krisp/reconcile";
import { archiveRecordings } from "@/lib/krisp/archive";
import { syncAllMeetings } from "@/lib/meetings/sync";
import { getSettings } from "@/lib/settings";
import { syncDrivePhotos } from "@/lib/part-docs/drive-photo-sync";
import { cronPhotoBudgetMs } from "@/lib/part-docs/drive-photo-view";

// #97 — the Gmail import/poll can take longer than the platform default
export const maxDuration = 60;

/** The meetings rider ends by here, so the photo rider keeps its 10 s minimum before its 45 s cutoff. */
const BRIEF_CRON_CUTOFF_MS = 35_000;

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
 * The Recordings feature (spec §3.2 + §5.2) adds two more steps on the same
 * pattern: `reconcileRecordings()` polls Krisp for transcripts that are
 * still processing (≤ 5 per Krisp account per pass), and
 * `archiveRecordings()` moves settled audio from Blob to the Drive archive
 * (≤ 5 per run). Both are own-try/catch and never throw; on Hobby this
 * makes them daily, and the Vercel upgrade only shortens the cadence.
 *
 * #283 adds the Peak Product Photos sync the same way.
 *
 * #323 adds the Krisp meeting sync (syncAllMeetings) the same way.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const started = Date.now();
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== "Bearer " + secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // #335 — no Inbox-organization AI pass here: a call needs ~35 s and this
  // route's 60 s is already shared by the import (40 s budget) and the
  // riders below. The pass runs on the Inbox tick / Send-Receive and the
  // server timer instead; pending threads simply wait for one of those.
  const r = await checkMailIfStale(AUTO_SYNC_MIN_AGE_MS, { aiPass: false });

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

  // #323 — Krisp meeting sync for every connected rep (rolling 14-day window). AHEAD of the brief and
  // draft riders (D920) so it keeps its window: whatever is left before the 35 s rider cutoff, at most
  // 20 s, every rep skipped when under 5 s is left. A Krisp call already in flight can run its own 20 s
  // timeout past the cutoff (35 + 20 = 55 s, under the 60 s ceiling); the briefs, drafts and photos
  // below then find no time and skip — briefs build lazily on Home, photos run tomorrow. Home loads and
  // the Inbox tick sync meetings too, so a skipped cron run only delays. Own try/catch like the other riders.
  let meetings: Awaited<ReturnType<typeof syncAllMeetings>> | { error: string };
  try {
    meetings = await syncAllMeetings(Math.max(0, Math.min(20_000, BRIEF_CRON_CUTOFF_MS - (Date.now() - started))));
  } catch (err) {
    meetings = { error: (err as Error).message };
  }

  // #283 — Peak Product Photos: one budgeted pass on this daily trigger,
  // budgeted against a 45 s cutoff (the sync's hard deadline is budget +
  // 10 s, leaving ~5 s under the 60 s ceiling for the last shrink + store),
  // skipped when under 10 s is left (cronPhotoBudgetMs), and skipped quietly
  // when no photos account is set. Own try/catch like the other riders.
  let drivePhotos: unknown;
  try {
    if (!(await getSettings()).catalogPhotosMailbox) drivePhotos = { skipped: "no photos account" };
    else {
      const budget = cronPhotoBudgetMs(45_000 - (Date.now() - started));
      drivePhotos = budget > 0 ? await syncDrivePhotos(budget) : { skipped: "no time left" };
    }
  } catch (err) {
    drivePhotos = { error: (err as Error).message };
  }

  return NextResponse.json({ ...r, recordings, recordingsArchive, meetings, drivePhotos });
}
