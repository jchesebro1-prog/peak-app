/**
 * AI daily brief — quiet quotes (spec §3). A quote is quiet when it is mine,
 * still `sent`, its last history entry is the move to sent at least 5
 * business days ago (Chicago), and no inbound message arrived after that on
 * a thread linked to the quote, or on the customer's thread whose subject
 * names the estimate number. At most 8, oldest sent first. Pure, client-safe.
 */
import { businessDaysBetween } from "@/lib/triage/clock";
import { displayQuoteNumber, type QuoteNumberFields } from "@/lib/estimate-number";
import type { Direction } from "@/lib/stores/comms";
import type { Quote } from "@/lib/stores/quotes";
import { lastSentAt } from "./fresh";
import type { QuietQuote } from "./types";

export const QUIET_BUSINESS_DAYS = 5;
export const QUIET_MAX = 8;

export type QuietQuoteInput = Pick<Quote, "id" | "name" | "customer" | "customerId" | "status" | "owner" | "preparedBy" | "history"> & QuoteNumberFields;
export type QuietThreadInput = {
  customerId: string | null;
  subject: string;
  link: { type: string; id: string } | null;
  messages: ReadonlyArray<{ direction: Direction; at: number }>;
};

const norm = (s: string | null | undefined) => (s || "").trim().toLowerCase();

/** The quote's person: its owner, falling back to preparedBy (one person follows up — quoteOwnerName's rule). `me` is normalized (trimmed, lower case). */
function isMine(q: Pick<Quote, "owner" | "preparedBy">, me: string): boolean {
  const who = norm(q.owner) || norm(q.preparedBy);
  return !!me && who === me;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The subject names the number as a whole token (EST-1001 ≠ EST-10012), case-insensitive. */
function subjectNames(subject: string, number: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9])${escapeRe(number)}(?![A-Za-z0-9]|-\\d)`, "i").test(subject || "");
}

function repliedAfter(q: QuietQuoteInput, number: string, sentAt: number, threads: readonly QuietThreadInput[]): boolean {
  for (const t of threads) {
    const linked = t.link?.type === "quote" && t.link.id === q.id;
    const named = !!q.customerId && t.customerId === q.customerId && subjectNames(t.subject, number);
    if (!linked && !named) continue;
    if (t.messages.some((m) => m.direction === "in" && m.at > sentAt)) return true;
  }
  return false;
}

export function selectQuietQuotes(
  quotes: readonly QuietQuoteInput[],
  threads: readonly QuietThreadInput[],
  me: { name: string },
  now: number
): QuietQuote[] {
  const myName = norm(me.name);
  const out: QuietQuote[] = [];
  for (const q of quotes) {
    if (q.status !== "sent" || !isMine(q, myName)) continue;
    const sentAt = lastSentAt(q);
    if (sentAt === null) continue;
    const days = businessDaysBetween(sentAt, now);
    if (days < QUIET_BUSINESS_DAYS) continue;
    const number = displayQuoteNumber(q);
    if (repliedAfter(q, number, sentAt, threads)) continue;
    out.push({ quoteId: q.id, number, name: q.name || number, customer: q.customer || "", sentAt, days });
  }
  out.sort((a, b) => a.sentAt - b.sentAt || a.quoteId.localeCompare(b.quoteId));
  return out.slice(0, QUIET_MAX);
}

/** Is this quote `meName`'s to follow up (owner, else preparedBy) — the quiet selector's own rule. */
export function quoteIsMine(q: Pick<Quote, "owner" | "preparedBy">, meName: string): boolean {
  return isMine(q, norm(meName));
}
