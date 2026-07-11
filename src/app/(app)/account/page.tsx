import { requireUser } from "@/lib/session";

export const metadata = { title: "Account settings — Peak Backend" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <div className="pk-content" style={{ maxWidth: 720 }}>
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>
        Account settings
      </div>
      <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5, marginBottom: 22 }}>
        Personal preferences — just yours, not the whole team’s.
      </div>

      <div className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
          <span
            style={{
              width: 42,
              height: 42,
              borderRadius: "50%",
              background: user.color,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {user.initials}
          </span>
          <span>
            <span style={{ display: "block", fontSize: 15, fontWeight: 600 }}>
              {user.name}
            </span>
            <span
              style={{
                display: "block",
                fontSize: 11.5,
                color: "#9aa0ab",
                fontFamily: "var(--font-mono)",
                marginTop: 2,
              }}
            >
              {user.email} · {user.roles.join(" · ")}
            </span>
          </span>
        </div>
      </div>

      <div className="pk-card" style={{ padding: "17px 18px" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Notifications</div>
        <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
          Per-category to-do notification toggles (from the prototype’s Account
          Settings screen) arrive with the notification center in Phase 2 —
          they need the data stores that feed the bell.
        </div>
      </div>
    </div>
  );
}
