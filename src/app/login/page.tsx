import { redirect } from "next/navigation";
import { auth, devLoginEnabled, googleConfigured } from "@/auth";
import { getSettings } from "@/lib/settings";
import { activeUsers } from "@/lib/users";
import LoginButtons from "./login-buttons";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.active) redirect("/");

  const settings = await getSettings();
  const devLogin = devLoginEnabled();
  const roster = devLogin
    ? (await activeUsers()).map((u) => ({
        id: u.id,
        name: u.name,
        initials: u.initials,
        color: u.color,
        roleLabel: u.roles.join(" · "),
      }))
    : [];
  const markLetter = "Q"; // Quartzite-6 (the software; companyName is the operating company)

  return (
    <div className="pk-login">
      <div style={{ width: 380, maxWidth: "94vw" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            justifyContent: "center",
            marginBottom: 18,
          }}
        >
          <div
            className="pk-mark"
            style={{ width: 38, height: 38, borderRadius: 9, fontSize: 15 }}
          >
            {markLetter}
          </div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
            <div style={{ color: "#fff", fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>
              Quartzite-6
            </div>
            <div style={{ color: "#9aa0ab", fontSize: 10.5, fontWeight: 500 }}>
              {settings.companyName}
            </div>
          </div>
          <span className="pk-beta">BETA</span>
        </div>

        <div className="pk-login-card">
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>
            Sign in
          </div>
          <div style={{ fontSize: 12.5, color: "#9aa0ab", marginTop: 4, marginBottom: 18 }}>
            Team access only — your account must be on the team list.
          </div>
          <LoginButtons
            google={googleConfigured()}
            devLogin={devLogin}
            roster={roster}
          />
        </div>

        <div
          style={{
            textAlign: "center",
            marginTop: 14,
            fontSize: 11.5,
            color: "#6b7079",
          }}
        >
          Need access? Ask an admin to add you in Settings → Team.
        </div>
      </div>
    </div>
  );
}
