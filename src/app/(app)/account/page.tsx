import { requireUser } from "@/lib/session";
import { CATEGORIES, getPrefs } from "@/lib/stores/notif-prefs";
import { getSettings } from "@/lib/settings";
import { getUser } from "@/lib/users";
import NotifControls from "./notif-controls";
import OfficePicker from "./office-picker";
import DashboardLayoutEditor from "@/components/dashboard-layout-editor";
import { getDashboardOverride } from "@/lib/stores/notif-prefs";

export const metadata = { title: "Account settings — Quartzite-6" };

export default async function AccountPage() {
  const user = await requireUser();
  const prefs = await getPrefs(user.name);
  // D144 — "Based out of" (self-service; Settings -> Team's admin form
  // edits the same users.officeId field but needs manage_users).
  const [settings, myRow, dashboardOverride] = await Promise.all([
    getSettings(),
    getUser(user.id),
    getDashboardOverride(user.name),
  ]);
  const officeOptions = settings.offices.map((o) => ({ id: o.id, name: o.name }));
  const myOfficeId = myRow?.officeId || "";

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
          flexWrap: "wrap",
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
        <div style={{ minWidth: 180, flex: 1 }}>
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

      {/* ---- based out of (D144) ---- */}
      <OfficePicker offices={officeOptions} initialOfficeId={myOfficeId} />

      <DashboardLayoutEditor
        mode="personal"
        company={settings.dashboardDefaults}
        initial={dashboardOverride}
      />

      {/* ---- to-do notifications ---- */}
      <NotifControls rows={rows} />

    </div>
  );
}
