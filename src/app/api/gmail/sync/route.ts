import { NextResponse } from "next/server";
import { AUTO_SYNC_MIN_AGE_MS } from "@/lib/gmail/config";
import { checkMailIfStale } from "@/lib/stores/comms";
import { syncAllGoogleTasks } from "@/lib/google/tasks-sync";

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

  return NextResponse.json({ ...r, googleTasks });
}
