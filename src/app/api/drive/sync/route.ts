import { NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/triage/cron";
import { ensureVenueGeoStatus } from "@/lib/address-verify/venue-geo";
import { syncAllDrivers } from "@/lib/drive-sync/sync";
import { runAssessmentReminders } from "@/lib/assessments/reminders-server";
import { runEtcDailyRider } from "@/lib/dealer-api/etc/apply";

export const maxDuration = 60;

/**
 * Address verification + drive time — the daily drive cron. Vercel Cron calls
 * `/api/drive/sync` once a day at 11:00 UTC (6:00 CDT, 5:00 CST), before the
 * Gmail/triage cron at 11:45, so the morning list reads fresh drive events.
 * It has its own route because the Gmail route's 60 s budget is already
 * shared by triage and the photo sync.
 *
 * Jeff 2026-10-15 #10 rides first: the assessment reminders (30 days ahead, to
 * the venue's account rep), idempotent by task id, inside a 10 s deadline.
 *
 * Then two steps: stamp any venue still missing a verification status
 * (`ensureVenueGeoStatus`, idempotent — a no-op once every row is stamped),
 * then re-sync every rep's drive events, least recently synced first, never
 * starting a rep past 50 s in (per-rep try/catch inside `syncAllDrivers`).
 * #368 rides last: the ETC daily price sync (price-updates since the last
 * baseline, new ETC parts added), min(20 s, what's left of 55 s), in its own
 * try/catch inside `runEtcDailyRider` — it never fails the drive sync and runs
 * even when the drive sync failed. It does nothing until an admin has
 * imported ETC once, on a preview deploy, or with ETC_SYNC_DISABLED=true.
 *
 * Middleware exempts this path from the session gate, so CRON_SECRET is the
 * only auth.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const fail = cronAuthFailure(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (fail) return NextResponse.json({ error: fail.error }, { status: fail.status });
  const started = Date.now();
  let assessmentReminders: Awaited<ReturnType<typeof runAssessmentReminders>> | { error: string };
  try {
    assessmentReminders = await runAssessmentReminders({ deadlineMs: started + 10_000 });
  } catch (err) {
    console.error("[assessment-reminders] cron rider failed", err);
    assessmentReminders = { error: (err as Error).message };
  }
  // #368 — the ETC rider, in its own try/catch (runEtcDailyRider never throws; this is belt and braces).
  // It runs after the drive sync whether that succeeded or not.
  const etcPrices = async (): Promise<Awaited<ReturnType<typeof runEtcDailyRider>> | { error: string }> => {
    try {
      return await runEtcDailyRider(started);
    } catch {
      return { error: "ETC daily price sync failed" };
    }
  };
  try {
    let venueGeo: Awaited<ReturnType<typeof ensureVenueGeoStatus>> | { error: string };
    try {
      venueGeo = await ensureVenueGeoStatus();
    } catch (err) {
      venueGeo = { error: (err as Error).message };
    }
    const budgetMs = Math.max(0, 50_000 - (Date.now() - started));
    const driveTime = await syncAllDrivers({ budgetMs, deadlineMs: started + 50_000 });
    return NextResponse.json({ assessmentReminders, venueGeo, ...driveTime, etcPrices: await etcPrices() });
  } catch (err) {
    console.error("[drive-time] sync route failed", err);
    return NextResponse.json({ error: (err as Error).message, etcPrices: await etcPrices() }, { status: 500 });
  }
}
