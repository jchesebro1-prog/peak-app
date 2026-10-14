import { NextResponse } from "next/server";
import { cronAuthFailure, parseSlotParam } from "@/lib/triage/cron";
import { buildSlotForAll } from "@/lib/triage/service";
import { buildBriefsForAll, runDraftsForAll } from "@/lib/brief/build";

export const maxDuration = 60;

/** Briefs + drafts end by here (10 s under maxDuration: a call is capped 5 s before it, then the writes and the response). */
const BRIEF_DEADLINE_MS = 50_000;

/**
 * Morning triage — the midday list (spec "Snapshots and refresh"). Vercel
 * Cron calls `/api/triage/build?slot=midday` once a day at 18:45 UTC (13:45
 * CDT, the midday boundary; 12:45 CST — the slot is passed explicitly, and
 * whoever views after 13:45 builds lazily anyway). The morning
 * list rides the daily Gmail cron instead. `?slot=morning` builds any user's
 * missing morning list by hand — a slot that already has a snapshot is left
 * as it is (D709). It stops starting new users 50 s in; whoever it skipped
 * builds on first view. Middleware exempts this path from the session gate,
 * so CRON_SECRET is the only auth.
 *
 * AI daily brief (spec §1): after the list, the same slot's brief for every
 * Assist pilot user with Daily brief on (a stored brief is kept; whoever
 * doesn't fit builds on first view), then the pre-made draft queue for those
 * users in whatever time is left. Each in its own try; everything ends by
 * 50 s (Assist calls are capped 5 s before that), under the 60 s ceiling.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const fail = cronAuthFailure(req.headers.get("authorization"), process.env.CRON_SECRET);
  if (fail) return NextResponse.json({ error: fail.error }, { status: fail.status });
  const slot = parseSlotParam(new URL(req.url).searchParams.get("slot")) ?? "midday";
  const started = Date.now();
  try {
    const result = await buildSlotForAll(slot, started, { deadlineMs: started + 50_000 });
    let briefs: Awaited<ReturnType<typeof buildBriefsForAll>> | { error: string };
    try {
      briefs = await buildBriefsForAll(slot, started, { deadlineMs: started + BRIEF_DEADLINE_MS });
    } catch (err) {
      console.error("[brief] cron build failed", err);
      briefs = { error: (err as Error).message };
    }
    let drafts: Awaited<ReturnType<typeof runDraftsForAll>> | { error: string } | null = null;
    try {
      if ("userIds" in briefs) drafts = await runDraftsForAll(briefs.userIds, started + BRIEF_DEADLINE_MS);
    } catch (err) {
      console.error("[brief] cron drafts failed", err);
      drafts = { error: (err as Error).message };
    }
    return NextResponse.json({ slot, ...result, briefs, drafts });
  } catch (err) {
    console.error("[triage] build route failed", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
