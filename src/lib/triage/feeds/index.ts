import type { TriageFeed } from "./context";
import { emailFeed } from "./email";
import { callsFeed } from "./calls";
import { tasksFeed } from "./tasks";
import { leadsFeed } from "./leads";
import { visitsFeed } from "./visits";
import { quotesFeed } from "./quotes";
import { renewalsFeed } from "./renewals";

/** Every source the triage list reads, one module each (spec "Feeds"). Server-only. */
export const FEEDS: readonly TriageFeed[] = [emailFeed, callsFeed, tasksFeed, leadsFeed, visitsFeed, quotesFeed, renewalsFeed];
