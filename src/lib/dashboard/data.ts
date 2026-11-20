/**
 * #43 — one memoised loader bundle per request. Widgets read through this
 * so a store is fetched at most once regardless of how many widgets share
 * it, and never at all if no widget on the layout needs it.
 */
import type { SessionUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { getAll as getQuotes } from "@/lib/stores/quotes";
import { all as getCustomers } from "@/lib/stores/customers";
import { allEngagements } from "@/lib/stores/engagements";
import { getAllDesigns } from "@/lib/stores/designs";
import { getAll as getSurveys } from "@/lib/stores/surveys";
import { open as openLeads, followUps } from "@/lib/stores/leads";
import { threadsIn, unreadCount, folderCounts, mailboxes as commMailboxes } from "@/lib/stores/comms";
import { list as catalogList } from "@/lib/stores/catalog";
import { getSettings } from "@/lib/settings";
import { loadBidReportData } from "@/lib/parties/bid-report-server";
import { once } from "./once";
import { mailboxViewer } from "@/lib/mailbox-viewer";

export function makeDashboardData(user: SessionUser) {
  const me = user.name;
  const boxes = commMailboxes(me, { userColor: user.color });
  // #349 — my mailbox by identity (id; a legacy name only while unique), read once
  const viewer = once(() => mailboxViewer(user));
  return {
    boxes,
    quotes: once(getQuotes),
    customers: once(getCustomers),
    engagements: once(allEngagements),
    designs: once(getAllDesigns),
    surveys: once(getSurveys),
    openLeads: once(openLeads),
    myFollowUps: once(() => followUps({ owner: me })),
    needsThreads: once(async () => threadsIn("needs", null, await viewer())),
    inboxUnread: once(async () => unreadCount(await viewer())),
    roster: once(activeUsers),
    catalogParts: once(catalogList),
    boxCounts: once(async () => {
      const v = await viewer();
      return Promise.all(boxes.map((b) => folderCounts(b.id, v)));
    }),
    settings: once(getSettings),
    /** #348 slice 6 — Reports › Bids by GC/EC: delivered bidder rows only (bounded query). */
    bidReport: once(loadBidReportData),
  };
}

export type DashboardData = ReturnType<typeof makeDashboardData>;
