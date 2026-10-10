import type { Assignment } from "@/lib/stores/assignments";
import type { CommThread } from "@/lib/stores/comms";
import type { renewals as flameRenewalsFn } from "@/lib/stores/flame-jobs";
import type { renewals as inspectionRenewalsFn } from "@/lib/stores/inspections";
import type { LeadRecord } from "@/lib/stores/leads";
import type { Quote } from "@/lib/stores/quotes";
import type { RecordingRecord } from "@/lib/stores/recordings";
import type { SiteVisit } from "@/lib/stores/site-visits";
import type { TaskRecord } from "@/lib/stores/tasks";
import type { OpenWork } from "../dedupe";
import type { TriageHooks } from "../hooks";
import type { TriageCandidate, TriageSource, TriageUser } from "../types";

/**
 * The whole-collection reads the feeds share. One `FeedData` lives for one
 * build (all users in `buildSlotForAll`, or one lazy view): each reader
 * creates its promise on first call and returns the same promise after, so a
 * collection is scanned once however many feeds and users ask. The arrays
 * are shared — `select*` functions must treat them as read-only.
 */
export type FlameRenewalJob = Awaited<ReturnType<typeof flameRenewalsFn>>[number];
export type InspectionRenewalRecord = Awaited<ReturnType<typeof inspectionRenewalsFn>>[number];

export type FeedData = {
  threads(): Promise<CommThread[]>;
  quotes(): Promise<Quote[]>;
  leads(): Promise<LeadRecord[]>;
  tasks(): Promise<TaskRecord[]>;
  assignments(): Promise<Assignment[]>;
  recordings(): Promise<RecordingRecord[]>;
  visits(): Promise<SiteVisit[]>;
  flameRenewals(): Promise<FlameRenewalJob[]>;
  inspectionRenewals(): Promise<InspectionRenewalRecord[]>;
};

/** What every feed is given: whose list, one clock, the active roster, the optional hooks. */
export type FeedCtx = {
  me: TriageUser;
  now: number;
  users: readonly { id: string; name: string }[];
  hooks: TriageHooks;
  data: FeedData;
};

export type FeedResult = { candidates: TriageCandidate[]; openWork?: OpenWork[] };

/** One source. `load` may throw — the builder notes it and keeps the others. */
export type TriageFeed = { source: TriageSource; load: (ctx: FeedCtx) => Promise<FeedResult> };
