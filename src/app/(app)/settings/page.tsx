import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getSettings } from "@/lib/settings";
import { allUsers } from "@/lib/users";
import SettingsClient from "./settings-client";

export const metadata = { title: "Settings — Peak Backend" };

export default async function SettingsPage() {
  const me = await requireUser();
  const isAdmin = can("manage_users", me.roles);
  const settings = await getSettings();
  const users = isAdmin ? await allUsers() : [];

  return (
    <div className="pk-content" style={{ maxWidth: 1080, padding: "26px 30px 64px" }}>
      <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>
        Settings
      </div>
      <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5, marginBottom: 22 }}>
        Manage team members, roles, and what each person can do.
      </div>

      {!isAdmin ? (
        <div
          className="pk-card"
          style={{ padding: "48px 24px", textAlign: "center" }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: "#f1f2f5",
              color: "#8c919c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              margin: "0 auto 14px",
            }}
          >
            🔒
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            Admin access required
          </div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6 }}>
            Only users with the Admin role can manage the team. Ask an admin if
            you need access.
          </div>
        </div>
      ) : (
        <SettingsClient
          meId={me.id}
          meName={me.name}
          settings={{
            companyName: settings.companyName,
            accent: settings.accent,
            federalHolidays: settings.federalHolidays,
            seedDemo: settings.seedDemo,
            feedbackEmail: settings.feedbackEmail,
          }}
          offices={settings.offices.map((o) => ({
            id: o.id,
            name: o.name,
            line: `${o.street}, ${o.city}, ${o.state} ${o.zip}`,
            phone: o.phone || "",
          }))}
          users={users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            roles: u.roles,
            color: u.color,
            initials: u.initials,
            active: u.active,
          }))}
        />
      )}
    </div>
  );
}
