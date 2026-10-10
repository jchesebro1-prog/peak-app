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
import { openWaitingTasksBy } from "@/lib/stores/tasks";
import { loadHomeAgenda } from "@/lib/agenda";
import { getSettings } from "@/lib/settings";
import { loadTaskPlans } from "@/lib/task-plan/load";
import { once } from "./once";

/** Home waits on the plan, so its Google read gets less than /calendar's 6 s. */
const HOME_PLAN_CALENDAR_MS = 2_500;

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
    /** #323 — my open "Waiting on customer" nudges: Home lists them apart from my own to-dos. */
    waitingOnOthers: once(() => openWaitingTasksBy("assigneeUserId", [user.id])),
    agenda: once(() => loadHomeAgenda(user.id, me)),
    // Auto task calendar: this user's plan, once per Home render. Google is read with a short limit
    // (Home waits on it); null = the plan couldn't be loaded (the card shows a note, Home still renders).
    taskPlan: once(async () => {
      const plans = await loadTaskPlans({ userIds: [user.id], meId: user.id, deps: { calendarTimeoutMs: HOME_PLAN_CALENDAR_MS } }).catch((err) => {
        console.error("[task-plan] home plan failed:", err);
        return null;
      });
      return plans?.[0] ?? null;
    }),
    boxCounts: once(() => Promise.all(boxes.map((b) => folderCounts(b.id, me)))),
    settings: once(getSettings),
  };
}

export type DashboardData = ReturnType<typeof makeDashboardData>;
