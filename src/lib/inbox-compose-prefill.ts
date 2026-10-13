/**
 * Inbox compose init — the `?subject=` / `?body=` / `?contact=` prefill
 * (AI daily brief §4 "Send nudge": the Home card opens the composer with a
 * quiet quote's nudge email). Read on the server by inbox/page.tsx; the
 * values only fill the composer — nothing sends until the person presses
 * Send. Lengths are capped here, server-side, whatever the URL carries.
 * Pure, client-safe.
 */
import { COMPOSE_BODY_MAX, COMPOSE_SUBJECT_MAX } from "@/lib/brief/card-vm";

export const COMPOSE_CONTACT_MAX = 120;

export type ComposePrefill = {
  /** A subject or body was given — the composer opens even without a customer. */
  active: boolean;
  subject: string;
  body: string;
  /** The contact's name to address (matched by name in the customer's people). */
  contact: string;
};

const CTRL_LINE = /[\u0000-\u001f\u007f]+/g;
const CTRL_BODY = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** One line: control characters (newlines included) become spaces; trimmed; capped. */
function oneLine(v: unknown, max: number): string {
  return (typeof v === "string" ? v : "").replace(CTRL_LINE, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function composePrefillFrom(params: { subject?: unknown; body?: unknown; contact?: unknown }): ComposePrefill {
  const subject = oneLine(params.subject, COMPOSE_SUBJECT_MAX);
  const body = (typeof params.body === "string" ? params.body : "").replace(/\r\n?/g, "\n").replace(CTRL_BODY, "").trim().slice(0, COMPOSE_BODY_MAX);
  const contact = oneLine(params.contact, COMPOSE_CONTACT_MAX);
  return { active: !!(subject || body), subject, body, contact };
}

type CustomerLike = { contacts: ReadonlyArray<{ name: string; email: string }>; primaryName: string; primaryEmail: string };

/**
 * Who a `?new=<customer>` composer addresses. A plain `?new=` keeps its old
 * rule (the customer's primary contact). A prefilled one addresses only the
 * named contact, matched by name among the customer's people — an unknown
 * or unnamed contact leaves To blank rather than guessing.
 */
export function prefillRecipient(customer: CustomerLike | undefined, prefill: ComposePrefill): { to: string; contactName: string } {
  if (!prefill.active) return { to: customer?.primaryEmail || "", contactName: customer?.primaryName || "" };
  const want = prefill.contact.trim().toLowerCase();
  if (!want) return { to: "", contactName: "" };
  const hit = (customer?.contacts || []).find((c) => c.name.trim().toLowerCase() === want && c.email.trim());
  return hit ? { to: hit.email.trim(), contactName: hit.name } : { to: "", contactName: prefill.contact };
}
