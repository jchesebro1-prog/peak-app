import { requireUser } from "@/lib/session";
import { all as allCustomers, type CustomerDoc } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import QuoteIntakeForm from "./intake-form";
import {
  intakeInitial,
  quoteContactName,
  quoteEditPath,
  quoteLineCount,
  quoteServiceType,
  readHandoff,
  type IntakeReplacing,
} from "./handoff";
import type { IntakeCustomer } from "./types";

export const metadata = { title: "New quote — Quartzite-6" };

/**
 * Guided "new quote" intake — the landing screen behind the "+ New quote"
 * split menu (quotes/controls.tsx) and a company's "+ New quote" (#160).
 * Picks (or quick-creates) the customer, venue and contact a quote is for,
 * plus an optional name, then hands off to the right builder via builderPath.
 *
 * /quotes/new?type=<ServiceType>&customer=&venue=&contact=&name=
 * /quotes/new?replaces=<quoteId>  — "Change type" on a DRAFT (D205): pre-fills
 *   from that quote with its current type selected. A non-draft is ignored.
 * /quotes/new?customer=&contact=&thread=<id>  — the Inbox's "+ New quote"
 *   (#123, lib/inbox-links newQuoteHref): the intake mints the draft quote,
 *   links the thread to it, and returns to /inbox?thread= instead of the
 *   builder.
 */
export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [, sp, customerDocs] = await Promise.all([requireUser(), searchParams, allCustomers()]);
  const h = readHandoff(sp);

  const customers: IntakeCustomer[] = customerDocs
    .map((c: CustomerDoc) => ({
      id: c.id,
      name: c.name,
      type: c.type || "",
      locations: (c.locations || []).map((l) => ({
        id: l.id || "",
        label: l.label || "",
        city: l.city || "",
        state: l.state || "",
        primary: !!l.primary,
      })),
      contacts: (c.contacts || []).map((ct) => ({
        name: ct.name,
        role: ct.role || "",
        primary: !!ct.primary,
      })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  let seed = {
    type: h.type,
    category: h.category,
    customerId: h.customerId,
    venueId: h.venueId,
    contactName: h.contactName,
    name: h.name,
  };
  let replacing: IntakeReplacing | null = null;
  if (h.replaces) {
    const old = await getQuote(h.replaces);
    if (old && old.status === "draft") {
      const type = quoteServiceType(old);
      replacing = { id: old.id, type, lines: quoteLineCount(old), editPath: quoteEditPath(old) };
      seed = {
        type,
        category: old.category || "",
        customerId: old.customerId || "",
        venueId: old.locationId || "",
        contactName: quoteContactName(old),
        name: old.name || "",
      };
    }
  }

  return (
    <QuoteIntakeForm
      customers={customers}
      initial={intakeInitial(seed, customers)}
      replacing={replacing}
      threadId={h.threadId}
    />
  );
}
