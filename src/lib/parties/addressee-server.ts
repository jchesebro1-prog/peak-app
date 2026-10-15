import { getDoc } from "@/db/doc-store";
import { getCompany } from "@/lib/identity/companies";
import { contactsForCompany, displayName, getContact } from "@/lib/identity/contacts";
import type { Quote } from "@/lib/stores/quotes";
import { bidDocLine, type DocAddressee } from "./addressee";
import type { Party } from "./rules";

/**
 * #348 slice 2b-i — who a customer document is addressed to. Server-only (reads parties, companies, contacts).
 *
 * Precedence: an explicit bidder party id (must be a live GC/EC bidder row on THIS quote) → the awarded bidder
 * (`q.bid.awardedPartyId`) → null (today's output, byte-identical). An explicit id that isn't a valid bidder here
 * falls back to the awarded default, never to a wrong company. The owner stays the quote's customer.
 */
/** The party when it is a live GC/EC bidder row on THIS quote, else null. */
export async function bidderPartyFor(quoteId: string, id: string | null | undefined): Promise<Party | null> {
  if (!id) return null;
  const p = await getDoc<Party>("record_parties", id);
  return p && p.recordType === "quote" && p.recordId === quoteId && !!p.bid && (p.role === "gc" || p.role === "ec") ? p : null;
}

export async function documentAddressee(
  q: Pick<Quote, "id" | "customer" | "customerId" | "bid">,
  partyId?: string | null
): Promise<DocAddressee | null> {
  const party = (await bidderPartyFor(q.id, partyId)) ?? (await bidderPartyFor(q.id, q.bid?.awardedPartyId ?? null));
  if (!party) return null;
  const company = await getCompany(party.companyId);
  if (!company) return null;
  const contact = (await getContact(party.contactId)) ?? (await contactsForCompany(party.companyId))[0] ?? null;
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
