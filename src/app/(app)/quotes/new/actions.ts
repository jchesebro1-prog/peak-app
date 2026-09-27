"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { get as getCustomer } from "@/lib/stores/customers";
import { resolveIntakeCustomer, validateIntakeCustomer } from "@/lib/intake-customer";
import { get as getQuote } from "@/lib/stores/quotes";
import { get as getThread, visibleTo } from "@/lib/stores/comms";
import { linkThreadToNewQuote, threadQuoteLinkStatus } from "@/lib/gmail/linking";
import { quoteEditPath, quoteServiceType, sameBuilder } from "./handoff";
import { builderPath, isServiceType, type IntakeSubmit } from "./types";

/** I1/I4 review — where the "This thread is linked to X" banner's "open it"
 *  points. Small and self-contained on purpose: the fuller LINK_KIND_COLOR/
 *  linkHref table (inbox/page.tsx) also carries colours the intake page
 *  doesn't need. */
function linkedRecordHref(link: { type: string; id: string }): string {
  const id = encodeURIComponent(link.id);
  if (link.type === "quote") return `/quotes?id=${id}`;
  if (link.type === "lead") return `/leads?lead=${id}`;
  if (link.type === "survey") return `/venue-assessments?id=${id}`;
  if (link.type === "inspection") return `/inspections?id=${id}`;
  if (link.type === "project") return `/projects`;
  if (link.type === "flame_job") return `/flame-tests/results?job=${id}`;
  return "#";
}

/**
 * The guided "new quote" intake — resolves/creates the customer (and an
 * optional new venue/contact appended to its arrays) through the same
 * saveCustomerAction the Companies screen uses, then redirects straight into
 * the right builder pre-seeded with ?customer=. Calling saveCustomerAction
 * directly is fine here: both files are server-only ("use server"), so this
 * is a plain function call, not a client import.
 */

export type IntakeResult =
  | { ok: false; error: string }
  /** I4 review — the thread this intake was opened from already links
   *  something that isn't an inbox-minted draft for this customer; the
   *  form shows "open it" (href) / "create another" (resubmits with
   *  confirmReplaceLink: true). */
  | { ok: false; linkedElsewhere: { type: string; id: string; label: string; href: string } };

export async function createQuoteIntakeAction(input: IntakeSubmit): Promise<IntakeResult> {
  const me = await requireUser();

  if (!isServiceType(input.type)) return { ok: false, error: "Unknown quote type." };

  // #110: a custom category is just a system quote with a user-named label —
  // the label is the one thing the card requires.
  const category = (input.category || "").trim();
  if (input.type === "custom" && !category) return { ok: false, error: "Name the category." };

  // D205 — "Change type" on a draft. Re-checked here: the quote may have been
  // sent since the intake opened.
  const replacesId = (input.replaces || "").trim();
  const old = replacesId ? await getQuote(replacesId) : null;
  if (replacesId && (!old || old.status !== "draft")) {
    return { ok: false, error: "That quote is no longer a draft — start a new quote instead." };
  }
  if (old && sameBuilder(input.type, quoteServiceType(old))) redirect(quoteEditPath(old));

  // #123/I4 review — validated BEFORE any customer/venue/contact save side
  // effect (it used to run after saveCustomerAction, which meant a bad or
  // inaccessible thread id left behind a customer/venue/contact the failed
  // request had no use for).
  const threadId = (input.threadId || "").trim();
  const thread = threadId ? await getThread(threadId) : null;
  if (threadId && (!thread || !visibleTo(thread, me.name))) {
    return {
      ok: false,
      error: "That email thread couldn't be found — start the quote from the Quotes hub instead.",
    };
  }

  // #244 — the customer checks now live in lib/intake-customer (shared with
  // the Grid intake); same order, same messages, still before any write.
  const check = validateIntakeCustomer(input);
  if (!check.ok) return { ok: false, error: check.error };
  const { creatingCustomer, pickedCustomerId } = check;

  // I4 follow-up review — checked here, BEFORE saveCustomerAction runs
  // below: a thread already linked to something else used to only get
  // caught by linkThreadToNewQuote's own check, by which point a brand-new
  // customer/venue/contact had already been saved — a refusal stranded it,
  // and "Create another" minted a second one on retry. A new customer
  // (creatingCustomer) can never be the SAME customer an existing inbox
  // draft already belongs to, so it never reads as a reusable "same
  // customer" match here — only as a conflict, same as any other type of
  // existing link. linkThreadToNewQuote re-checks this at mint time too
  // (the authoritative check — this is purely to fail BEFORE any write).
  if (threadId && thread) {
    const candidateCustomerId = creatingCustomer ? null : pickedCustomerId || null;
    const preStatus = await threadQuoteLinkStatus(thread, candidateCustomerId);
    if (preStatus.kind === "conflict" && !input.confirmReplaceLink) {
      return {
        ok: false,
        linkedElsewhere: {
          type: preStatus.link.type,
          id: preStatus.link.id,
          label: preStatus.link.label || preStatus.link.id,
          href: linkedRecordHref(preStatus.link),
        },
      };
    }
  }

  // #244 — resolve/create the customer, append a new venue/contact, and read
  // back what was chosen (lib/intake-customer, moved verbatim from here).
  const resolved = await resolveIntakeCustomer(input);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { customerId, customerName, locationId: venueId, contactName: contact } = resolved;

  // #123 — opened from an Inbox thread ("+ New quote"): the builders only
  // mint a quote on their first save, so mint the draft here to have an id
  // to link, link the thread to it, and go back to the thread instead of the
  // builder. `thread` was already resolved + visibility-checked up top.
  if (threadId && thread) {
    // I1 review — the venue/contact's full record, so the builder each
    // service type opens into shows the same venue/contact this thread had
    // instead of a blank slate (see linkThreadToNewQuote's doc comment for
    // which type reads which fields).
    const record = await getCustomer(customerId);
    const venueRecord = venueId ? (record?.locations || []).find((l) => l.id === venueId) : null;
    const contactRecord = contact ? (record?.contacts || []).find((c) => c.name === contact) : null;
    const made = await linkThreadToNewQuote(
      threadId,
      {
        customerId,
        customer: customerName,
        locationId: venueId || null,
        locationLabel: venueRecord?.label || "",
        contactName: contact,
        contactRole: contactRecord?.role || "",
        contactEmail: contactRecord?.email || "",
        quoteType: input.type === "custom" ? "system" : input.type,
        category: input.type === "custom" ? category : "",
        owner: me.name,
        name: input.name,
      },
      { confirmReplace: !!input.confirmReplaceLink }
    );
    if (!made.ok) {
      if (made.reason === "not-found")
        return { ok: false, error: "That email thread couldn't be found." };
      return {
        ok: false,
        linkedElsewhere: {
          type: made.link.type,
          id: made.link.id,
          label: made.link.label || made.link.id,
          href: linkedRecordHref(made.link),
        },
      };
    }
    revalidatePath("/", "layout");
    redirect(`/inbox?thread=${encodeURIComponent(threadId)}`);
  }

  redirect(
    builderPath(input.type, customerId, {
      category,
      name: input.name,
      venue: venueId,
      contact,
      replaces: old ? old.id : "",
    })
  );
}
