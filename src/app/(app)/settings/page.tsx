import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getSettings } from "@/lib/settings";
import { allUsers } from "@/lib/users";
import { gmailEnabled, personalKey, SHARED_KEYS } from "@/lib/gmail/config";
import { listConnections } from "@/lib/gmail/connections";
import SettingsClient from "./settings-client";

export const metadata = { title: "Settings — Peak Backend" };

const SHARED_LABEL: Record<string, string> = {
  sales: "Sales",
  installs: "Installs",
  info: "Info",
};

export default async function SettingsPage() {
  const me = await requireUser();
  const isAdmin = can("manage_users", me.roles);
  const settings = await getSettings();
  const users = isAdmin ? await allUsers() : [];

  // ---- Mailboxes (Gmail) — admin surface, env-gated ----
  const gmailOn = gmailEnabled();
  const connections = isAdmin && gmailOn ? await listConnections() : [];
  const connByKey = new Map(connections.map((c) => [c.mailboxKey, c]));
  const myKey = personalKey(me.id);
  const mailboxVMs = [
    {
      key: myKey,
      label: me.name,
      kind: "personal" as const,
      desc: "Your own inbox — send as yourself and log your threads.",
    },
    ...SHARED_KEYS.map((k) => ({
      key: k as string,
      label: SHARED_LABEL[k] || k,
      kind: "shared" as const,
      desc:
        k === "sales"
          ? "Quotes, bids & customer questions."
          : k === "installs"
            ? "Projects, scheduling & field coordination."
            : "General inbound — the address on the website.",
    })),
  ].map((mb) => {
    const c = connByKey.get(mb.key);
    return {
      ...mb,
      connected: !!c,
      address: c?.address || null,
      connectedBy: c?.connectedBy || null,
      initialImportDone: c?.initialImportDone ?? false,
      lastSyncAt: c?.lastSyncAt ?? null,
    };
  });

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
          gmail={{ enabled: gmailOn, mailboxes: mailboxVMs }}
          settings={{
            companyName: settings.companyName,
            accent: settings.accent,
            federalHolidays: settings.federalHolidays,
            seedDemo: settings.seedDemo,
            feedbackEmail: settings.feedbackEmail,
          }}
          offices={settings.offices.map((o) => ({
            id: o.id,
            type: o.type || "Main Office",
            name: o.name,
            street: o.street || "",
            city: o.city || "",
            state: o.state || "",
            zip: o.zip || "",
            lat: o.lat,
            lng: o.lng,
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
