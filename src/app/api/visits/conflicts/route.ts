import { requireUser } from "@/lib/session";
import { getVisit } from "@/lib/stores/site-visits";
import type { Conflict } from "@/lib/visit-plan/check";

/** Up to 20 s of routing across ten visits, plus headroom. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Total wall-clock budget for one request. */
const BADGE_TOTAL_BUDGET_MS = 20_000;
const MAX_IDS = 10;

/**
 * Spec 2026-10-09 site-visit scheduling — conflict badges for visits on a page
 * (the company record). A GET route, not a server action: Next dispatches a
 * page's server actions one at a time, so a 20 s badge load as an action would
 * queue the Edit dialog's booking check, Save and Delete behind it. Computed on
 * load for every person on each visit, always viewing as the signed-in user
 * (other people's Google event titles stay hidden). At most 10 ids per call.
 */
export async function GET(request: Request) {
  // Outside any try: a signed-out request redirects to the login page.
  const me = await requireUser();
  const ids = [...new Set(new URL(request.url).searchParams.getAll("ids").filter((x) => !!x && x.length <= 40))].slice(0, MAX_IDS);
  const out: Record<string, Conflict[]> = {};
  if (ids.length) {
    const { loadBookingCheck } = await import("@/lib/visit-plan/load");
    // One shared deadline for the whole call: each check has its own routing
    // budget, so without this ten visits could run for minutes. Once spent, the
    // remaining visits are simply not checked (no badge).
    const deadline = Date.now() + BADGE_TOTAL_BUDGET_MS;
    for (const id of ids) {
      if (Date.now() >= deadline) {
        console.warn("[visit-booking] badge budget spent; remaining visits not checked");
        break;
      }
      const v = await getVisit(id);
      if (!v || v.stage !== "scheduled" || v.startAt == null || v.endAt == null) continue;
      try {
        const r = await loadBookingCheck(
          { visitId: v.id, customerId: v.customerId, locationId: v.locationId, address: v.address, startAt: v.startAt, endAt: v.endAt, lead: v.assignedTo, attendees: v.attendees },
          { viewerId: me.id, nearby: false }
        );
        const many = r.people.length > 1;
        const list = r.people.flatMap((p) => p.conflicts.map((c) => ({ kind: c.kind, text: many ? `${p.person}: ${c.text}` : c.text })));
        if (list.length) out[id] = list;
      } catch (err) {
        console.error("[visit-booking] badge check failed:", id, err);
      }
    }
  }
  return Response.json(out, { headers: { "cache-control": "private, no-store" } });
}
