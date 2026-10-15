import { getDoc } from "@/db/doc-store";
import { getCompany } from "@/lib/identity/companies";
import { contactsForCompany, displayName, emailsFor, getContact } from "@/lib/identity/contacts";
import type { ContactRow } from "@/db/schema";
import { get as getQuote, touchQuoteContent, type Quote } from "@/lib/stores/quotes";
import { bidDocLine, type DocAddressee } from "./addressee";
import type { Party } from "./rules";

/**
 * #348 slice 2b-i — who a customer document is addressed to. Server-only (reads parties, companies, contacts).
 *
 * Precedence: an explicit bidder party id (must be a live GC/EC bidder row on THIS quote) → the awarded bidder
 * (`q.bid.awardedPartyId`) → null (today's output, byte-identical). An explicit id that isn't a valid bidder here
 * falls back to the awarded default, never to a wrong company — unless `{ strict: true }`, which returns null instead. The owner stays the quote's customer.
 */
/** The party when it is a live GC/EC bidder row on THIS quote, else null. */
export async function bidderPartyFor(quoteId: string, id: string | null | undefined): Promise<Party | null> {
  if (!id) return null;
  const p = await getDoc<Party>("record_parties", id);
  return p && p.recordType === "quote" && p.recordId === quoteId && !!p.bid && (p.role === "gc" || p.role === "ec") ? p : null;
}

/** The person a bidder document is addressed to: the party's own contact, else the bidder company's PRIMARY
 *  contact (never just the alphabetically first), else none. */
export async function addresseeContact(party: Pick<Party, "contactId" | "companyId">): Promise<ContactRow | null> {
  return (await getContact(party.contactId)) ?? (await contactsForCompany(party.companyId)).find((c) => c.isPrimary) ?? null;
}

/** #348 2b-ii — who an email to this bidder goes to: the addressee contact and that contact's first email ("" when none). */
export async function bidderRecipient(
  party: Pick<Party, "contactId" | "companyId">
): Promise<{ contactId: string | null; name: string; firstName: string; email: string }> {
  const contact = await addresseeContact(party);
  const email = contact ? ((await emailsFor(contact.id))[0]?.email ?? "").trim() : "";
  return { contactId: contact?.id ?? null, name: contact ? displayName(contact) : "", firstName: (contact?.firstName || "").trim(), email };
}

/**
 * #348 2b-i — Send & track's default recipient once a bidder is awarded: the awarded bidder's addressee contact
 * (addresseeContact) and that contact's primary email. null when nothing is awarded (or the awarded row / company
 * is gone) — the caller keeps the owner's defaults. `email` is "" when the contact has none (the caller then
 * falls back too); `firstName` is for the greeting.
 */
export async function awardedRecipient(
  q: Pick<Quote, "id" | "bid">
): Promise<{ partyId: string; contactId: string | null; name: string; firstName: string; email: string } | null> {
  const party = await bidderPartyFor(q.id, q.bid?.awardedPartyId ?? null);
  if (!party || !(await getCompany(party.companyId))) return null;
  const r = await bidderRecipient(party);
  return { partyId: party.id, ...r };
}

/**
 * #348 2b-i — after a party's contact changed: when it is the AWARDED bidder on a quote, its Attn line is on the
 * customer document, so stamp the quote's content (touchQuoteContent — Send then waits for the re-render) and
 * return true; the caller schedules the PDF. Anything else (another bidder, a lead / project row, no change) → false.
 */
export async function touchAwardedAddressee(party: Pick<Party, "id" | "recordType" | "recordId" | "contactId">, prevContactId: string | null | undefined): Promise<boolean> {
  if (party.recordType !== "quote" || (prevContactId ?? null) === (party.contactId ?? null)) return false;
  const q = await getQuote(party.recordId);
  if (!q || q.bid?.awardedPartyId !== party.id) return false;
  return !!(await touchQuoteContent(q.id));
}

export async function documentAddressee(
  q: Pick<Quote, "id" | "customer" | "customerId" | "bid">,
  partyId?: string | null,
  opts?: { strict?: boolean }
): Promise<DocAddressee | null> {
  // strict: the explicit id or nothing — a signed per-bidder render must never fall back to the awarded bidder.
  const party = opts?.strict ? await bidderPartyFor(q.id, partyId) : (await bidderPartyFor(q.id, partyId)) ?? (await bidderPartyFor(q.id, q.bid?.awardedPartyId ?? null));
  if (!party) return null;
  const company = await getCompany(party.companyId);
  if (!company) return null;
  const contact = await addresseeContact(party);
  // Live company name first, the denormalized q.customer as fallback — quoteDocumentDataFor's `cust?.name || q.customer` order.
  const ownerName = ((await getCompany(q.customerId))?.name || q.customer || "").trim();
  return {
    companyName: company.name,
    contactName: contact ? displayName(contact) : "",
    contactRole: contact?.title || "",
    ownerName,
    bidLine: bidDocLine(q.bid),
  };
}
