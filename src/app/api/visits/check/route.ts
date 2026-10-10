import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { parseBookingCheckParam } from "@/lib/visit-plan/input";

/** One booking check: calendar reads + up to 10 s of routing, plus headroom. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const CHECK_FAILED = "Couldn't check conflicts — you can still schedule.";

/**
 * Spec 2026-10-09 site-visit scheduling — the booking screen's live check
 * (nearby days + conflicts). A GET route, not a server action: Next runs a
 * page's server actions one at a time, so a slow check would queue Save /
 * Schedule behind it; the hook also aborts a superseded check here. `input` is
 * the JSON-encoded booking input (size-capped, cleaned against the roster).
 * Always views as the signed-in user, so other people's Google event titles
 * stay hidden. Conflicts never block a save.
 */
export async function GET(request: Request) {
  // Outside any try: a signed-out request redirects to the login page.
  const me = await requireUser();
  const headers = { "cache-control": "private, no-store" };
  const roster = (await activeUsers()).map((u) => u.name);
  const input = parseBookingCheckParam(new URL(request.url).searchParams.get("input"), roster);
  if (!input) return Response.json({ error: "Bad booking check input." }, { status: 400, headers });
  try {
    const { loadBookingCheck } = await import("@/lib/visit-plan/load");
    return Response.json(await loadBookingCheck(input, { viewerId: me.id }), { headers });
  } catch (err) {
    console.error("[visit-booking] check failed:", err);
    return Response.json({ error: CHECK_FAILED }, { headers });
  }
}
