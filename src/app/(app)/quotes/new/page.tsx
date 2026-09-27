import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { all as allCustomers } from "@/lib/stores/customers";
import { intakeCustomersFrom } from "@/lib/intake-customer";
import { get as getQuote } from "@/lib/stores/quotes";
import { displayQuoteNumber } from "@/lib/estimate-number";
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
import { venueTypesFrom } from "@/lib/venue-types";

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
  const [, sp, customerDocs, settings] = await Promise.all([requireUser(), searchParams, allCustomers(), getSettings()]);
  const h = readHandoff(sp);

  // #244 — the shared builder (lib/intake-customer), also used by the Grid intake.
  const customers: IntakeCustomer[] = intakeCustomersFrom(customerDocs);

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
      replacing = { id: old.id, number: displayQuoteNumber(old), type, lines: quoteLineCount(old), editPath: quoteEditPath(old) };
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
      venueTypes={venueTypesFrom(settings.venueTypes)}
    />
  );
}
