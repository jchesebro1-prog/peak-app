import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { activeUsers, userCan } from "@/lib/users";
import { chicagoTime, slotLabel } from "@/lib/triage/clock";
import { loadTriageView, triageNow, triageUserFromSession } from "@/lib/triage/service";
import TriageRows from "@/components/triage/triage-rows";
import HomeTabs from "../home-tabs";

export const metadata = { title: "Start here — Quartzite-6" };

/**
 * Morning triage — the full ranked list ("See more" from Home's Start here
 * card). Admins (manage_users) can switch to a teammate's list, read-only.
 */
export default async function TriagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const isAdmin = can("manage_users", user.roles);
  const roster = await activeUsers();
  const wanted = typeof sp.user === "string" ? sp.user : "";
  const other = isAdmin && wanted && wanted !== user.id ? roster.find((u) => u.id === wanted) ?? null : null;
  const target = other ? { id: other.id, name: other.name, canApprove: userCan(other, "approve") } : triageUserFromSession(user);
  const viewingSelf = target.id === user.id;
  const view = await loadTriageView(target, triageNow());
  const teammates = roster.map((u) => u.name).filter((n) => n !== user.name);

  return (
    <HomeTabs active="dashboard">
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#16181d", margin: 0 }}>Start here</h1>
        <span style={{ fontSize: 12.5, color: "#8c919c" }}>
          {viewingSelf ? "Your" : `${target.name}’s`} {slotLabel(view.snapshot.slot).toLowerCase()} · built {chicagoTime(view.snapshot.builtAt)} · {view.rows.length} items
        </span>
      </div>
      {isAdmin && (
        <nav style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "8px 0 12px" }} aria-label="Person">
          {roster.map((u) => {
            const on = u.id === target.id;
            return (
              <Link
                key={u.id}
                href={u.id === user.id ? "/triage" : `/triage?user=${encodeURIComponent(u.id)}`}
                style={{
                  fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 7, textDecoration: "none",
                  color: on ? "color-mix(in srgb, var(--accent) 70%, #000)" : "#5b616e",
                  background: on ? "color-mix(in srgb, var(--accent) 10%, #fff)" : "#f1f2f5",
                }}
              >
                {u.name}
              </Link>
            );
          })}
        </nav>
      )}
      {view.note && <div style={{ fontSize: 12, color: "#8a6d1f", margin: "6px 0" }}>{view.note}</div>}
      {view.snapshot.errors.map((e) => (
        <div key={e.source} style={{ fontSize: 12, color: "#8a6d1f", margin: "6px 0" }}>{e.message}</div>
      ))}
      <section className="pk-card" style={{ padding: "4px 18px 8px" }}>
        <TriageRows rows={view.rows} readOnly={!viewingSelf} teammates={teammates} />
      </section>
    </HomeTabs>
  );
}
