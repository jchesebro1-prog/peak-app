import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { activeUsers } from "@/lib/users";
import { devLoginEnabled } from "@/auth";
import { can } from "@/lib/team";
import { navData } from "@/lib/nav-counts";
import Nav, { type RosterEntry } from "@/components/nav/Nav";
import { SyncProvider } from "@/lib/sync/SyncProvider";
import PopHeader from "@/components/popout/pop-header";
import LiveSync from "@/components/popout/live-sync";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const devLogin = devLoginEnabled();
  const roster: RosterEntry[] = devLogin
    ? (await activeUsers()).map((u) => ({
        id: u.id,
        name: u.name,
        initials: u.initials,
        color: u.color,
      }))
    : [];
  const { counts, bell } = await navData(user.name, can("approve", user.roles), user.id);

  return (
    <SyncProvider>
      <div className="pk-shell">
        <Nav
          counts={counts}
          bell={bell}
          user={{
            id: user.id,
            name: user.name,
            initials: user.initials,
            color: user.color,
            roleLabel: user.roles.join(" · "),
            isAdmin: can("manage_users", user.roles),
          }}
          companyName={settings.companyName}
          logoLight={settings.logoLight || null}
          feedbackEmail={settings.feedbackEmail}
          devLogin={devLogin}
          roster={roster}
        />
        {/* Pop-out windows (spec §2, §5): the slim header shows only in a
            pop-out (html.pk-pop); LiveSync keeps every window current. */}
        <PopHeader />
        <main className="pk-main">{children}</main>
      </div>
      <LiveSync />
    </SyncProvider>
  );
}
