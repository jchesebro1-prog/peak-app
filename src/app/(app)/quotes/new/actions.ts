"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { get as getCustomer } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import { quoteEditPath, quoteServiceType, sameBuilder } from "./handoff";
import { saveCustomerAction } from "@/app/(app)/companies/actions";
import { toContactInput, toLocationInput } from "@/app/(app)/companies/lib";
import type { ContactInput, LocationInput } from "@/app/(app)/companies/types";
import { builderPath, isServiceType, type IntakeSubmit } from "./types";

/**
 * The guided "new quote" intake — resolves/creates the customer (and an
 * optional new venue/contact appended to its arrays) through the same
 * saveCustomerAction the Companies screen uses, then redirects straight into
 * the right builder pre-seeded with ?customer=. Calling saveCustomerAction
 * directly is fine here: both files are server-only ("use server"), so this
 * is a plain function call, not a client import.
 */

export async function createQuoteIntakeAction(
  input: IntakeSubmit
): Promise<{ ok: false; error: string }> {
  await requireUser();

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

  const creatingCustomer = input.customerMode === "new";
  const newCustomerName = (input.newCustomerName || "").trim();
  if (creatingCustomer && !newCustomerName) {
    return { ok: false, error: "Enter a name for the new customer." };
  }
  const pickedCustomerId = (input.customerId || "").trim();
  if (!creatingCustomer && !pickedCustomerId) {
    return { ok: false, error: "Pick a customer, or add a new one." };
  }

  const existing = !creatingCustomer ? await getCustomer(pickedCustomerId) : null;
  if (!creatingCustomer && !existing) {
    return { ok: false, error: "That customer couldn't be found — refresh and try again." };
  }

  const locations: LocationInput[] = (existing?.locations || []).map(toLocationInput);
  const contacts: ContactInput[] = (existing?.contacts || []).map(toContactInput);

  if (input.locationMode === "new") {
    locations.push({
      label: (input.newLocationLabel || "").trim() || "Venue",
      // First location on the record → primary. Never demotes one that's
      // already there.
      primary: locations.length === 0,
      address: "",
      city: (input.newLocationCity || "").trim(),
      state: (input.newLocationState || "").trim(),
      lat: null,
      lng: null,
      venueKind: "proscenium",
      travelMiles: null,
      travelMin: null,
    });
  }

  if (input.contactMode === "new") {
    const name = (input.newContactName || "").trim();
    if (name) {
      contacts.push({
        name,
        role: (input.newContactRole || "").trim(),
        email: (input.newContactEmail || "").trim(),
        phone: (input.newContactPhone || "").trim(),
        primary: contacts.length === 0,
      });
    }
  }

  let customerId = existing?.id || "";
  const needsSave = creatingCustomer || input.locationMode === "new" || input.contactMode === "new";
  if (needsSave) {
    const res = await saveCustomerAction({
      id: existing?.id,
      name: creatingCustomer ? newCustomerName : existing!.name,
      type: creatingCustomer ? (input.newCustomerType || "") : existing!.type || "",
      pricingTier: existing?.pricingTier ?? null,
      locations,
      contacts,
    });
    if (!res.ok) return { ok: false, error: "Couldn't save that customer — please try again." };
    customerId = res.id;
  }

  if (!customerId) return { ok: false, error: "Pick or create a customer first." };

  // #160: forward the venue/contact actually chosen — the builders used to
  // drop them and fall back to primaries.
  let venueId = input.locationMode === "pick" ? (input.locationId || "").trim() : "";
  if (input.locationMode === "new") {
    const before = new Set((existing?.locations || []).map((l) => l.id));
    const after = await getCustomer(customerId);
    venueId = (after?.locations || []).find((l) => l.id && !before.has(l.id))?.id || "";
  }
  const contact =
    input.contactMode === "pick"
      ? (input.contactName || "").trim()
      : input.contactMode === "new"
        ? (input.newContactName || "").trim()
        : "";

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
