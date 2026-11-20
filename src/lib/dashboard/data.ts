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
import { open as openLeads, followUps } from "@/lib/stores/leads";
import { list as catalogList } from "@/lib/stores/catalog";
import { getSettings } from "@/lib/settings";
import { loadBidReportData } from "@/lib/parties/bid-report-server";
import { once } from "./once";

export function makeDashboardData(user: SessionUser) {
  const me = user.name;
  return {
    quotes: once(getQuotes),
    customers: once(getCustomers),
    engagements: once(allEngagements),
    designs: once(getAllDesigns),
    openLeads: once(openLeads),
    myFollowUps: once(() => followUps({ owner: me })),
    roster: once(activeUsers),
    catalogParts: once(catalogList),
    settings: once(getSettings),
    /** #348 slice 6 — Reports › Bids by GC/EC: delivered bidder rows only (bounded query). */
    bidReport: once(loadBidReportData),
  };
}

export type DashboardData = ReturnType<typeof makeDashboardData>;
