import { NextResponse } from "next/server";
import { AUTO_SYNC_MIN_AGE_MS } from "@/lib/gmail/config";
import { checkMailIfStale } from "@/lib/stores/comms";

/**
 * Cron-triggered Gmail sync (D74) — the serverless half of "sync is server
 * side, always current". Vercel Cron (vercel.json) calls this on a schedule
 * with `Authorization: Bearer ${CRON_SECRET}` (Vercel adds the header
 * automatically when the CRON_SECRET env var exists); any external pinger can
 * do the same. Middleware exempts this path from the session gate, so the
 * secret is the ONLY auth — the route is disabled entirely (503) until
 * CRON_SECRET is configured. The sync itself is throttled by atomic
 * per-mailbox claims, so an aggressive schedule is safe.
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
  return NextResponse.json(r);
}
