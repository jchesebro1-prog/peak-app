import Link from "next/link";
import type { SessionUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { chicagoTime, slotLabel } from "@/lib/triage/clock";
import { loadTriageView, triageNow, triageUserFromSession, type TriageView } from "@/lib/triage/service";
import { HOME_LIMIT } from "@/lib/triage/view";
import TriageRows from "./triage-rows";

/**
 * Morning triage — the "Start here" card at the top of Home (spec "Home
 * card"): the top 10 rows of this slot's frozen list, its label and build
 * time, and See more → /triage. A failure here never breaks Home.
 */
export default async function StartHereCard({ user }: { user: SessionUser }) {
  let view: TriageView | null = null;
  let teammates: string[] = [];
  try {
    view = await loadTriageView(triageUserFromSession(user), triageNow());
  } catch (err) {
    view = null;
    console.error("[triage] Start here card failed", err);
  }
  // A teammate-lookup failure only costs the Reassign list; it must not blank the card.
  try {
    teammates = (await activeUsers()).map((u) => u.name).filter((n) => n !== user.name);
  } catch (err) {
    console.error("[triage] Start here teammate lookup failed", err);
  }
  if (!view) {
    return (
      <section className="pk-card" style={{ marginBottom: 22, padding: "14px 17px", fontSize: 12.5, color: "#8a6d1f" }}>
        Start here couldn’t load your list — <Link href="/triage" style={{ color: "var(--accent)" }}>try the full list</Link>.
      </section>
    );
  }
  // Render-time reads are guarded: an unexpectedly shaped snapshot must not throw (Home has no error.tsx).
  const rows = Array.isArray(view.rows) ? view.rows : [];
  const top = rows.slice(0, HOME_LIMIT);
  const snap = view.snapshot;
  const errors = Array.isArray(snap?.errors) ? snap.errors : [];
  const header = snap && (snap.slot === "morning" || snap.slot === "midday") ? `${slotLabel(snap.slot)} · built ${chicagoTime(snap.builtAt)}` : "Today’s list";
  return (
    <section className="pk-card" style={{ marginBottom: 22, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, padding: "14px 17px 6px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: "#16181d" }}>Start here</span>
          <span style={{ fontSize: 12, color: "#8c919c" }}>
            {header}
          </span>
        </div>
        <Link href="/triage" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
          See more{rows.length > top.length ? ` (${rows.length})` : ""} →
        </Link>
      </div>
      {view.note && <div style={{ fontSize: 12, color: "#8a6d1f", padding: "0 17px" }}>{view.note}</div>}
      {errors.map((e) => (
        <div key={e.source} style={{ fontSize: 12, color: "#8a6d1f", padding: "0 17px" }}>{e.message}</div>
      ))}
      <div style={{ padding: "0 17px 8px" }}>
        <TriageRows rows={top} readOnly={false} teammates={teammates} />
      </div>
    </section>
  );
}
