import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { can } from "@/lib/team";
import { navData } from "@/lib/nav-counts";
import Nav from "@/components/nav/Nav";
import { SyncProvider } from "@/lib/sync/SyncProvider";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const settings = await getSettings();
  const { counts, bell } = await navData(user.name);

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
        />
        <main className="pk-main">{children}</main>
      </div>
    </SyncProvider>
  );
}
