import { sameName } from "@/lib/quote-approval-rules";
import { triageKey, type RenewalKind } from "../keys";
import type { TriageCandidate, TriageFact } from "../types";
import type { FeedCtx, TriageFeed } from "./context";

export type RenewalRow = {
  kind: RenewalKind;
  id: string;
  customer: string;
  venue: string;
  owner: string;
  /** #37 outreach already stamped this cycle → it's in "Awaiting reply", not "To contact". */
  contacted: boolean;
  renewal: { state: string; days: number; dueAt: number | null };
};

/** The #37 "To contact" worklists, mine by job owner: past due (overdue) or in the outreach window (due_soon). */
export function selectRenewals(rows: readonly RenewalRow[], ctx: Pick<FeedCtx, "me" | "now">): TriageCandidate[] {
  const out: TriageCandidate[] = [];
  for (const r of rows) {
    if (r.contacted || !sameName(r.owner, ctx.me.name)) continue;
    const fact: TriageFact | null =
      r.renewal.state === "overdue"
        ? { kind: "renewal_past_due", days: r.renewal.days }
        : r.renewal.state === "due_soon"
          ? { kind: "renewal_window", days: r.renewal.days }
          : null;
    if (!fact) continue;
    out.push({
      key: triageKey.renewal(r.kind, r.id),
      source: "renewal",
      title: `${r.kind === "flame" ? "Flame test" : "Inspection"} renewal: ${r.customer || r.id}`,
      sub: r.venue || "",
      href: r.kind === "flame" ? "/flame-tests?rv=contact" : "/inspections?rv=contact",
      since: r.renewal.dueAt || 0,
      facts: [fact],
    });
  }
  return out;
}

export const renewalsFeed: TriageFeed = {
  source: "renewal",
  async load(ctx) {
    const [flames, inspections] = await Promise.all([ctx.data.flameRenewals(), ctx.data.inspectionRenewals()]);
    const rows: RenewalRow[] = [
      ...flames.map((j) => ({ kind: "flame" as const, id: j.id, customer: j.customer, venue: j.venue, owner: j.owner, contacted: !!j.renewalOutreach, renewal: j._renewal })),
      ...inspections.map((r) => ({ kind: "inspection" as const, id: r.id, customer: r.customer, venue: r.venue, owner: r.owner, contacted: !!r.renewalOutreach, renewal: r._renewal })),
    ];
    return { candidates: selectRenewals(rows, ctx) };
  },
};
