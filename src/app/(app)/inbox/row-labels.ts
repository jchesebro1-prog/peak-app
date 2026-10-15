/**
 * The Gmail labels a thread carries, as chips (the Inbox row; #346 the
 * reader's Labels card). Pure — names in, chips out.
 */
import { isPlaceholderCustomerLabel } from "@/lib/gmail/peak-labels";
import type { LabelOpt } from "./types";

/** Gmail's inbox/sent/draft routing labels — the folder already says so. */
const ROUTING = ["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "ALL_MAIL"];

/** The cached `labelOptions` present on any of the thread's messages, in
 *  label order, at most `max`. System labels are useful context too
 *  (Starred, Important); the routing ones are left out. `skipPlaceholders`
 *  (#345) drops a `Peak/Customers/<placeholder>` label ("UNKNOWN" …). */
export function threadGmailLabels(
  messages: ReadonlyArray<{ gmailLabelIds?: string[] }>,
  labelOptions: LabelOpt[],
  opts: { max?: number; skipPlaceholders?: boolean } = {}
): LabelOpt[] {
  return labelOptions
    .filter((l) => l.type === "user" || !ROUTING.includes(l.id))
    .filter((l) => !opts.skipPlaceholders || !isPlaceholderCustomerLabel(l.name))
    .filter((l) => messages.some((m) => (m.gmailLabelIds || []).includes(l.id)))
    .slice(0, opts.max ?? 4);
}
