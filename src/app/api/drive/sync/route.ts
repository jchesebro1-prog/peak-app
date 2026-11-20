import { NextResponse } from "next/server";
import { cronAuthFailure } from "@/lib/cron-auth";
import { ensureVenueGeoStatus } from "@/lib/address-verify/venue-geo";
import { runEtcDailyRider } from "@/lib/dealer-api/etc/apply";

export const maxDuration = 60;

/**
 * The daily maintenance cron. Vercel Cron calls `/api/drive/sync` once a day
 * at 11:00 UTC (6:00 CDT, 5:00 CST). The path keeps its old name (it used to
 * run the drive-time sync, removed with Project Management) so vercel.json and
 * the middleware exemption stay as they were.
 *
 * Riders, in order: stamping
 * any venue still missing a verification status (`ensureVenueGeoStatus`,
 * idempotent); then #368's ETC daily price sync, in its own try/catch inside
 * `runEtcDailyRider` — it runs even when an earlier step failed, and does
 * nothing until an admin has imported ETC once, on a preview deploy, or with
 * ETC_SYNC_DISABLED=true.
 *
 * Middleware exempts this path from the session gate, so CRON_SECRET is the
 * only auth.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const fail = cronAuthFailure(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (fail) return NextResponse.json({ error: fail.error }, { status: fail.status });
  const started = Date.now();
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
    return NextResponse.json({ venueGeo, etcPrices: await etcPrices() });
  } catch (err) {
    console.error("[daily-cron] route failed", err);
    return NextResponse.json({ error: (err as Error).message, etcPrices: await etcPrices() }, { status: 500 });
  }
}
