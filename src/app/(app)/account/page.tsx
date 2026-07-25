import { requireUser } from "@/lib/session";
import { CATEGORIES, getPrefs, invitesOn } from "@/lib/stores/notif-prefs";
import {
  gmailEnabled,
  hasCalendarScope,
  personalKey,
} from "@/lib/gmail/config";
import NotifControls from "./notif-controls";
import InviteToggle from "./invite-toggle";

export const metadata = { title: "Account settings — Quartzite-6" };

export default async function AccountPage() {
  const user = await requireUser();
  const prefs = await getPrefs(user.name);
  const invites = await invitesOn(user.name);

  // C7 — self-serve mailbox connect: teammates manage their OWN inbox here
  // (the admin Settings page manages shared boxes). Connection status +
  // calendar grant for MY personal mailbox only.
  const gmailOn = gmailEnabled();
  const myKey = personalKey(user.id);
  let conn: { address: string; initialImportDone: boolean; calendarOn: boolean } | null = null;
  if (gmailOn) {
    const { getConnectionInfo } = await import("@/lib/gmail/connections");
    const info = await getConnectionInfo(myKey);
    if (info)
      conn = {
        address: info.address,
        initialImportDone: info.initialImportDone,
        calendarOn: hasCalendarScope(info.scope),
      };
  }
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

      {/* ---- my mailbox (C7 — self-serve Gmail connect) ---- */}
      <div className="pk-card" style={{ padding: "17px 18px", marginTop: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>My mailbox</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
              {!gmailOn
                ? "Gmail isn't enabled on this deployment yet — the Inbox stays simulated."
                : conn
                  ? conn.address +
                    (conn.initialImportDone ? " · history imported" : " · use Send / Receive in the Inbox to import history") +
                    (conn.calendarOn ? " · calendar on" : "")
                  : "Connect your own Gmail so the Inbox sends and receives as you — and your dashboard calendar lights up."}
            </div>
          </div>
          {gmailOn && !conn && (
            <a
              className="pk-btn-accent"
              href={"/api/gmail/connect?mailbox=" + encodeURIComponent(myKey)}
              style={{ flexShrink: 0, textDecoration: "none" }}
            >
              Connect my mailbox
            </a>
          )}
          {gmailOn && conn && !conn.calendarOn && (
            <a
              className="pk-btn-outline"
              href={"/api/gmail/connect?mailbox=" + encodeURIComponent(myKey) + "&calendar=1"}
              title="Re-runs the Google consent with Calendar access added — enables the dashboard calendar and direct site-visit events"
              style={{ flexShrink: 0, textDecoration: "none" }}
            >
              Enable calendar
            </a>
          )}
          {gmailOn && conn && conn.calendarOn && (
            <span style={{ fontSize: 11, fontWeight: 600, color: "#1f7a52", background: "#e8f3ee", border: "1px solid #cfe6db", padding: "3px 10px", borderRadius: 20, flexShrink: 0 }}>
              Connected
            </span>
          )}
        </div>
      </div>

      {/* ---- site-visit calendar invites (D76) ---- */}
      <InviteToggle initialOn={invites} />
    </div>
  );
}
