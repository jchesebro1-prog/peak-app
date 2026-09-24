/**
 * #43 — one memoised loader bundle per request. Widgets read through this
 * so a store is fetched at most once regardless of how many widgets share
 * it, and never at all if no widget on the layout needs it.
 */
import type { SessionUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { getAll as getQuotes } from "@/lib/stores/quotes";
import { getAllProjects } from "@/lib/stores/projects";
import { all as getCustomers } from "@/lib/stores/customers";
import { allEngagements } from "@/lib/stores/engagements";
import { getAllDesigns } from "@/lib/stores/designs";
import { getAll as getSurveys } from "@/lib/stores/surveys";
import { open as openLeads, followUps } from "@/lib/stores/leads";
import { threadsIn, unreadCount, folderCounts, mailboxes as commMailboxes } from "@/lib/stores/comms";
import { list as catalogList } from "@/lib/stores/catalog";
import { loadQueue } from "@/lib/queue";
import { loadHomeAgenda } from "@/lib/agenda";
import { getSettings } from "@/lib/settings";
import { once } from "./once";

export function makeDashboardData(user: SessionUser) {
  const me = user.name;
  const boxes = commMailboxes(me, { userColor: user.color });
  return {
    boxes,
    quotes: once(getQuotes),
    projects: once(getAllProjects),
    customers: once(getCustomers),
    engagements: once(allEngagements),
    designs: once(getAllDesigns),
    surveys: once(getSurveys),
    openLeads: once(openLeads),
    myFollowUps: once(() => followUps({ owner: me })),
    needsThreads: once(() => threadsIn("needs", null, me)),
    inboxUnread: once(() => unreadCount(me)),
    roster: once(activeUsers),
    catalogParts: once(catalogList),
    queueItems: once(() => loadQueue(me)),
    agenda: once(() => loadHomeAgenda(user.id, me)),
    boxCounts: once(() => Promise.all(boxes.map((b) => folderCounts(b.id, me)))),
    settings: once(getSettings),
  };
}

export type DashboardData = ReturnType<typeof makeDashboardData>;
