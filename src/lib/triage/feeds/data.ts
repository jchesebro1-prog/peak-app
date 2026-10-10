import { getAll as allThreads } from "@/lib/stores/comms";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { getAll as allLeads } from "@/lib/stores/leads";
import { allTasks } from "@/lib/stores/tasks";
import { allAssignments } from "@/lib/stores/assignments";
import { allRecordings } from "@/lib/stores/recordings";
import { allVisits } from "@/lib/stores/site-visits";
import { renewals as flameRenewals } from "@/lib/stores/flame-jobs";
import { renewals as inspectionRenewals } from "@/lib/stores/inspections";
import type { FeedData } from "./context";

/** The raw readers behind a `FeedData` (a test seam: pass counting stubs). */
export type FeedDataSources = { [K in keyof FeedData]: () => ReturnType<FeedData[K]> };

export const STORE_SOURCES: FeedDataSources = {
  threads: allThreads,
  quotes: allQuotes,
  leads: allLeads,
  tasks: allTasks,
  assignments: allAssignments,
  recordings: allRecordings,
  visits: allVisits,
  flameRenewals: () => flameRenewals({ dueOnly: true }),
  inspectionRenewals: () => inspectionRenewals({ dueOnly: true }),
};

/**
 * A per-build memoized loader (one per `buildSlotForAll`, one per lazy view):
 * each collection is read the first time a feed asks and shared after that —
 * by every feed and every user of the build. A failed read stays failed for
 * the whole build (each feed that needed it notes its own error).
 */
export function createFeedData(src: FeedDataSources = STORE_SOURCES): FeedData {
  const memo = <T>(read: () => Promise<T>): (() => Promise<T>) => {
    let p: Promise<T> | null = null;
    return () => (p ??= Promise.resolve().then(read));
  };
  return {
    threads: memo(src.threads),
    quotes: memo(src.quotes),
    leads: memo(src.leads),
    tasks: memo(src.tasks),
    assignments: memo(src.assignments),
    recordings: memo(src.recordings),
    visits: memo(src.visits),
    flameRenewals: memo(src.flameRenewals),
    inspectionRenewals: memo(src.inspectionRenewals),
  };
}
