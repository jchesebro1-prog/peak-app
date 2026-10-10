import { NextResponse } from "next/server";
import { cronAuthFailure, parseSlotParam } from "@/lib/triage/cron";
import { buildSlotForAll } from "@/lib/triage/service";

export const maxDuration = 60;

/**
 * Morning triage — the midday list (spec "Snapshots and refresh"). Vercel
 * Cron calls `/api/triage/build?slot=midday` once a day at 17:00 UTC (noon
 * CDT, 11:00 CST — still "midday" for today's Chicago date). The morning
 * list rides the daily Gmail cron instead. `?slot=morning` rebuilds the
 * morning list by hand. Middleware exempts this path from the session gate,
 * so CRON_SECRET is the only auth.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const fail = cronAuthFailure(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (fail) return NextResponse.json({ error: fail.error }, { status: fail.status });
  const slot = parseSlotParam(new URL(req.url).searchParams.get("slot")) ?? "midday";
  const result = await buildSlotForAll(slot, Date.now());
  return NextResponse.json({ slot, ...result });
}
