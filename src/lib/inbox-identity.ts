/**
 * #125 — identity source. A thread resolves (and quick-adds) from ONE
 * address: by default the thread counterpart (`contactEmail`); when the
 * user picks a message in the sidebar's "Linking from", that message's own
 * address — its From for inbound, its first recipient for outbound — with
 * the thread contact as the fallback for messages that stored no address
 * (app-sent replies, pre-#125 imports). Pure: `parseAddress` is the only
 * runtime import and it is DB-free, so test:specs covers this file.
 */
import type { CommMessage, CommThread } from "@/lib/stores/comms";
import { parseAddress } from "@/lib/gmail/mime";

export type IdentityAddress = { email: string; name: string; messageId: string };

export type IdentityThread = Pick<
  CommThread,
  "identityMessageId" | "messages" | "contactEmail" | "contactName"
>;

function lc(s: string | undefined | null): string {
  return (s || "").trim().toLowerCase();
}

/** First non-empty address in a To header ("AP <ap@x.org>, b@x.org"). Skips
 *  parts with no real address ("", "Nobody <>") — parseAddress's fallback
 *  reads a malformed "Name <>" as the literal text when the angle brackets
 *  are empty, so an "@" is required, not just a non-empty string. */
export function firstRecipient(
  to: string | undefined | null
): { name: string; email: string } | null {
  for (const part of (to || "").split(",")) {
    const a = parseAddress(part);
    if (a.email && a.email.includes("@")) return a;
  }
  return null;
}

export function identityAddressFor(t: IdentityThread): IdentityAddress | null {
  const id = t.identityMessageId;
  if (!id) return null;
  const m: CommMessage | undefined = (t.messages || []).find((x) => x.id === id);
  if (!m) return null;
  if (m.direction === "in") {
    const email = lc(m.fromEmail) || lc(t.contactEmail);
    return email ? { email, name: m.author || t.contactName || "", messageId: m.id } : null;
  }
  const r = firstRecipient(m.to);
  const email = r ? r.email : lc(t.contactEmail);
  if (!email) return null;
  return { email, name: r ? r.name : t.contactName || "", messageId: m.id };
}

/** The address the resolver keys off: the identity message's when one is
 *  picked, else the thread counterpart. "" when the thread has neither. */
export function resolveAddressFor(t: IdentityThread): string {
  return identityAddressFor(t)?.email ?? lc(t.contactEmail);
}
