import Link from "next/link";
import { requireUser } from "@/lib/session";
import { firstName, can } from "@/lib/team";

export default async function HomePage() {
  const user = await requireUser();
  return (
    <div className="pk-content">
      <div className="pk-page-title">Welcome back, {firstName(user.name)}</div>
      <div className="pk-page-sub">
        Peak Backend is being rebuilt for production, phase by phase. You’re
        signed in — Phase 1 (accounts, team & roles) is live.
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 14,
          marginTop: 18,
        }}
      >
        <div className="pk-card" style={{ padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Team & roles</div>
          <div style={{ fontSize: 12.5, color: "#9aa0ab", marginTop: 4, lineHeight: 1.5 }}>
            The roster, roles and permissions from the prototype are live.
            {can("manage_users", user.roles)
              ? " Manage who can sign in:"
              : " Admins manage who can sign in."}
          </div>
          {can("manage_users", user.roles) && (
            <Link
              href="/settings"
              className="pk-btn-accent"
              style={{ display: "inline-block", marginTop: 12, textDecoration: "none" }}
            >
              Open Settings → Team
            </Link>
          )}
        </div>

        <div className="pk-card" style={{ padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>What’s next</div>
          <div style={{ fontSize: 12.5, color: "#9aa0ab", marginTop: 4, lineHeight: 1.6 }}>
            Phase 2 ports the data stores (customers, quotes, leads, projects,
            flame tests, repairs, inspections, surveys). Then the dashboard
            widgets land here: follow-ups, reviews, renewals due.
          </div>
        </div>

        <div className="pk-card" style={{ padding: 18 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Your account</div>
          <div style={{ fontSize: 12.5, color: "#9aa0ab", marginTop: 4, lineHeight: 1.6 }}>
            Signed in as {user.name} ({user.email}) — {user.roles.join(" · ")}.
          </div>
        </div>
      </div>
    </div>
  );
}
