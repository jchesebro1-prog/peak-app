import type { OpenWork } from "../dedupe";
import type { TriageHooks } from "../hooks";
import type { TriageCandidate, TriageSource, TriageUser } from "../types";

/** What every feed is given: whose list, one clock, the active roster, the optional hooks. */
export type FeedCtx = {
  me: TriageUser;
  now: number;
  users: readonly { id: string; name: string }[];
  hooks: TriageHooks;
};

export type FeedResult = { candidates: TriageCandidate[]; openWork?: OpenWork[] };

/** One source. `load` may throw — the builder notes it and keeps the others. */
export type TriageFeed = { source: TriageSource; load: (ctx: FeedCtx) => Promise<FeedResult> };
