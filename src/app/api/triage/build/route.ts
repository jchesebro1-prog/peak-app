import { NextResponse } from "next/server";
import { cronAuthFailure, parseSlotParam } from "@/lib/triage/cron";
import { buildSlotForAll } from "@/lib/triage/service";

export const maxDuration = 60;

/**
 * Morning triage — the midday list (spec "Snapshots and refresh"). Vercel
 * Cron calls `/api/triage/build?slot=midday` once a day at 17:00 UTC (noon
 * CDT, 11:00 CST — still "midday" for today's Chicago date). The morning
 * list rides the daily Gmail cron instead. `?slot=morning` builds any user's
 * missing morning list by hand — a slot that already has a snapshot is left
 * as it is (D709). It stops starting new users 50 s in; whoever it skipped
 * builds on first view. Middleware exempts this path from the session gate,
 * so CRON_SECRET is the only auth.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const fail = cronAuthFailure(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (fail) return NextResponse.json({ error: fail.error }, { status: fail.status });
  const slot = parseSlotParam(new URL(req.url).searchParams.get("slot")) ?? "midday";
  const started = Date.now();
  try {
    const result = await buildSlotForAll(slot, started, { deadlineMs: started + 50_000 });
    return NextResponse.json({ slot, ...result });
  } catch (err) {
    console.error("[triage] build route failed", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
