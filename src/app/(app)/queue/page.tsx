import { requireUser } from "@/lib/session";
import { loadQueue, queueNow } from "@/lib/queue";
import { allAssignments } from "@/lib/stores/assignments";
import { activeUsers } from "@/lib/users";
import QueueView from "./view";
import HomeTabs from "../home-tabs";

export const metadata = { title: "My Queue — Peak Backend" };
export const dynamic = "force-dynamic";

/**
 * My Queue (D93) — one person's open commitments, assembled from records
 * that already exist plus ad-hoc assignments. `?who=` lets the team see each
 * other's queues: shared visibility is the thing a personal Reminders list
 * cannot give you, and it is why this screen exists at all.
 */
export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ who?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const roster = await activeUsers();
  const names = roster.map((u) => u.name);
  const who = sp.who && names.includes(sp.who) ? sp.who : user.name;

  const [items, assignments] = await Promise.all([loadQueue(who), allAssignments()]);
  const recentlyDone = assignments
    .filter((a) => a.done && a.assignee === who)
    .slice(0, 8);

  return (
    <>
      {/* D98: no pk-content wrapper exists on this route (QueueView renders
          edge-to-edge below) — the bar gets its own so it lines up with the
          padded tab bars on the other three hub routes. QueueView is
          untouched. */}
      <div className="pk-content" style={{ paddingBottom: 0 }}>
        <HomeTabs active="queue" />
      </div>
      <QueueView
        me={user.name}
        who={who}
        roster={names}
        items={items}
        recentlyDone={recentlyDone.map((a) => ({
          id: a.id,
          title: a.title,
          doneAt: a.doneAt || 0,
          doneVia: a.doneVia || "app",
        }))}
        now={queueNow()}
      />
    </>
  );
}
