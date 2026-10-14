/**
 * Inbox compose init — `?nudge=<quoteId>` (AI daily brief §4 "Send nudge":
 * the Home card opens the composer with a quiet quote's stored nudge email).
 * The page loads the quote on the server; this decides whether its nudge may
 * prefill the composer (fresh, usable, the viewer's quote), caps it, and
 * picks the recipient. Nothing travels in the URL but the quote id, and
 * nothing sends until the person presses Send. Pure, client-safe.
 */
import { nudgeFreshFor } from "@/lib/brief/fresh";
import { quoteIsMine } from "@/lib/brief/quiet";
import type { AssistNudge } from "@/lib/brief/types";
import type { QuoteHistoryEntry, QuoteStatus } from "@/lib/stores/quotes";

/** Server-side caps on a prefilled composer. */
export const COMPOSE_SUBJECT_MAX = 200;
export const COMPOSE_BODY_MAX = 5000;
export const COMPOSE_CONTACT_MAX = 120;

export type ComposePrefill = {
  subject: string;
  body: string;
  /** The quote's customer (may be null: the composer opens with no customer). */
  customerId: string | null;
  /** The quote's contact, to be matched by name among the customer's people. */
  contact: string;
};

const CTRL_LINE = /[\u0000-\u001f\u007f]+/g;
const CTRL_BODY = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** One line: control characters (newlines included) become spaces; trimmed; capped. */
export function capLine(v: unknown, max: number): string {
  return (typeof v === "string" ? v : "").replace(CTRL_LINE, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** A body: CRLF → LF, other control characters out (tabs and newlines kept); trimmed; capped. */
export function capBody(v: unknown, max: number): string {
  return (typeof v === "string" ? v : "").replace(/\r\n?/g, "\n").replace(CTRL_BODY, "").trim().slice(0, max);
}

type NudgeQuote = {
  status: QuoteStatus | string;
  history: readonly Pick<QuoteHistoryEntry, "at" | "to">[];
  owner: string;
  preparedBy?: string;
  customerId: string | null;
  contactName?: string;
  assistNudge?: AssistNudge | null;
};

/**
 * The prefill for `?nudge=<quoteId>`, or null: only a fresh nudge
 * (`nudgeFreshFor`: still sent, same send, made for the viewer) with no error
 * and a body, on a quote that is the viewer's to follow up (owner, else
 * preparedBy). A nudge made for the quote's previous owner is stale.
 */
export function nudgePrefill(q: NudgeQuote | null | undefined, me: { id: string; name: string }): ComposePrefill | null {
  const n = q?.assistNudge;
  if (!q || !n || n.error || !nudgeFreshFor(q, me.id) || !quoteIsMine(q, me.name)) return null;
  const body = capBody(n.emailBody, COMPOSE_BODY_MAX);
  if (!body) return null;
  return {
    subject: capLine(n.emailSubject, COMPOSE_SUBJECT_MAX),
    body,
    customerId: q.customerId || null,
    contact: capLine(q.contactName, COMPOSE_CONTACT_MAX),
  };
}

type CustomerLike = { contacts: ReadonlyArray<{ name: string; email: string }> };

/** Who a prefilled composer addresses: the named contact, matched by name among the customer's people — else To stays blank (never a guess). */
export function prefillRecipient(customer: CustomerLike | undefined, contact: string): { to: string; contactName: string } {
  const want = contact.trim().toLowerCase();
  if (!want) return { to: "", contactName: "" };
  const hit = (customer?.contacts || []).find((c) => c.name.trim().toLowerCase() === want && c.email.trim());
  return hit ? { to: hit.email.trim(), contactName: hit.name } : { to: "", contactName: contact };
}
