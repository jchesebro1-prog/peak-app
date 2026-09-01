import Link from "next/link";
import { requireUser } from "@/lib/session";
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { timeAgo } from "@/lib/stores/surveys";
import { VISIT_STAGE_META } from "@/lib/lead-thread";
import VisitRequests, { type VisitRequestVM } from "./visit-requests";

export const metadata = { title: "Sales site visits — Quartzite-6" };

function dateTime(ms: number | null): string {
  if (!ms) return "Unscheduled";
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Sales owns the request-to-visit handoff. A visit may create a Venue
 * Assessment, but its intake, ownership, and scheduling live here. */
export default async function SiteVisitsPage() {
  const [user, visits] = await Promise.all([requireUser(), allVisits()]);
  const me = user.name;
  const queue = visits
    .filter(
      (v) =>
        v.stage === "requested" || v.stage === "open" || (v.stage === "claimed" && v.assignedTo === me)
    )
    .sort(
      (a, b) =>
        (a.stage === "claimed" ? 1 : 0) - (b.stage === "claimed" ? 1 : 0) ||
        a.createdAt - b.createdAt
    );
  const rows: VisitRequestVM[] = queue.map((v) => {
    const status = VISIT_STAGE_META[v.stage];
    return {
      id: v.id,
      customer: v.customer || v.id,
      reason: v.reason,
      preferredTiming: v.preferredTiming,
      requestedLine: `Requested by ${v.createdBy || "—"} · ${timeAgo(v.createdAt)}`,
      stageLabel: status.label,
      stageInk: status.ink,
      stageSoft: status.soft,
      stageBd: status.bd,
      surveyId: v.surveyId,
      leadId: v.leadId,
      mine: v.stage === "claimed",
    };
  });
  const scheduled = visits
    .filter((v) => v.stage === "scheduled" && v.startAt != null)
    .sort((a, b) => (a.startAt || 0) - (b.startAt || 0));

  return (
    <div className="pk-content" style={{ maxWidth: 1120 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, letterSpacing: "-.02em" }}>Sales site visits</h1>
          <p style={{ margin: "5px 0 0", color: "#6b7079", fontSize: 13.5 }}>
            Qualify, claim, and schedule on-site sales work. Completed capture lives in Venue Assessments.
          </p>
        </div>
        <Link href="/calendar" style={{ color: "var(--accent)", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
          Open calendar →
        </Link>
      </div>

      <VisitRequests rows={rows} />

      <section>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", margin: "22px 0 8px" }}>
          Scheduled visits
        </div>
        <div style={{ background: "#fff", border: "1px solid #ececf0", borderRadius: 13, overflow: "hidden" }}>
          {scheduled.length ? scheduled.map((v: SiteVisit) => (
            <div key={v.id} style={{ padding: "13px 16px", borderBottom: "1px solid #f4f5f8", display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{v.venue || v.customer}</div>
                <div style={{ color: "#6b7079", fontSize: 12, marginTop: 3 }}>{v.reason}{v.assignedTo ? ` · ${v.assignedTo}` : ""}</div>
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#5b616e" }}>{dateTime(v.startAt)}</div>
            </div>
          )) : (
            <div style={{ padding: "18px 16px", color: "#8c919c", fontSize: 13 }}>No visits are scheduled yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
