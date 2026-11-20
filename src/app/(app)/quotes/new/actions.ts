"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { get as getCustomer } from "@/lib/stores/customers";
import { resolveIntakeCustomer, validateIntakeCustomer } from "@/lib/intake-customer";
import { get as getQuote } from "@/lib/stores/quotes";
import { quoteEditPath, quoteServiceType, sameBuilder } from "./handoff";
import { builderPath, isServiceType, type IntakeSubmit } from "./types";

/**
 * The guided "new quote" intake — resolves/creates the customer (and an
 * optional new venue/contact appended to its arrays) through the same
 * saveCustomerAction the Companies screen uses, then redirects straight into
 * the right builder pre-seeded with ?customer=. Calling saveCustomerAction
 * directly is fine here: both files are server-only ("use server"), so this
 * is a plain function call, not a client import.
 */

export type IntakeResult = { ok: false; error: string };

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

  // #244 — the customer checks now live in lib/intake-customer (shared with
  // the Grid intake); same order, same messages, still before any write.
  const check = validateIntakeCustomer(input);
  if (!check.ok) return { ok: false, error: check.error };
  const { creatingCustomer, pickedCustomerId } = check;

  // #244 — resolve/create the customer, append a new venue/contact, and read
  // back what was chosen (lib/intake-customer, moved verbatim from here).
  const resolved = await resolveIntakeCustomer(input);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { customerId, customerName, locationId: venueId, contactName: contact } = resolved;

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
