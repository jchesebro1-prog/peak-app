import { NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/triage/cron";
import { ensureVenueGeoStatus } from "@/lib/address-verify/venue-geo";
import { syncAllDrivers } from "@/lib/drive-sync/sync";

export const maxDuration = 60;

/**
 * Address verification + drive time — the daily drive cron. Vercel Cron calls
 * `/api/drive/sync` once a day at 11:00 UTC (6:00 CDT, 5:00 CST), before the
 * Gmail/triage cron at 12:00, so the morning list reads fresh drive events.
 * It has its own route because the Gmail route's 60 s budget is already
 * shared by triage and the photo sync.
 *
 * Two steps: stamp any venue still missing a verification status
 * (`ensureVenueGeoStatus`, idempotent — a no-op once every row is stamped),
 * then re-sync every rep's drive events, least recently synced first, never
 * starting a rep past 50 s in (per-rep try/catch inside `syncAllDrivers`).
 * Middleware exempts this path from the session gate, so CRON_SECRET is the
 * only auth.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const fail = cronAuthFailure(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (fail) return NextResponse.json({ error: fail.error }, { status: fail.status });
  const started = Date.now();
  try {
    let venueGeo: Awaited<ReturnType<typeof ensureVenueGeoStatus>> | { error: string };
    try {
      venueGeo = await ensureVenueGeoStatus();
    } catch (err) {
      venueGeo = { error: (err as Error).message };
    }
    const budgetMs = Math.max(0, 50_000 - (Date.now() - started));
    const driveTime = await syncAllDrivers({ budgetMs, deadlineMs: started + 50_000 });
    return NextResponse.json({ venueGeo, ...driveTime });
  } catch (err) {
    console.error("[drive-time] sync route failed", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
