import { requireUser } from "@/lib/session";
import { CATEGORIES, getPrefs } from "@/lib/stores/notif-prefs";
import NotifControls from "./notif-controls";

export const metadata = { title: "Account settings — Peak Backend" };

export default async function AccountPage() {
  const user = await requireUser();
  const prefs = await getPrefs(user.name);
  const rows = CATEGORIES.map((c) => ({
    key: c.key,
    label: c.label,
    desc: c.desc,
    on: prefs[c.key] !== false,
  }));
  const roleLabel = user.roles.join(" · ") || "Team member";

  return (
    <div className="pk-content" style={{ maxWidth: 760, padding: "26px 30px 64px" }}>
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>
        Account settings
      </div>
      <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5, marginBottom: 22 }}>
        Your personal preferences — only you see these.
      </div>

      {/* ---- identity ---- */}
      <div
        className="pk-card"
        style={{
          padding: "16px 18px",
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <span
          style={{
            width: 46,
            height: 46,
            borderRadius: "50%",
            background: user.color,
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 16,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          {user.initials}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.25 }}>
            {user.name}
          </div>
          {user.email && (
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11.5,
                color: "#aab0bb",
                marginTop: 2,
              }}
            >
              {user.email}
            </div>
          )}
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 3 }}>
            {roleLabel}
          </div>
        </div>
        <span
          className="ac-idfoot"
          style={{
            fontSize: 11.5,
            color: "#9aa0ab",
            textAlign: "right",
            maxWidth: 160,
            lineHeight: 1.4,
            flexShrink: 0,
          }}
        >
          Switch users from the account menu, top-right.
        </span>
      </div>

      {/* ---- to-do notifications ---- */}
      <NotifControls rows={rows} />
    </div>
  );
}
