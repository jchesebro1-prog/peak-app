"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import {
  get as getCustomer,
  type CustomerContact,
  type CustomerLocation,
} from "@/lib/stores/customers";
import { saveCustomerAction } from "@/app/(app)/companies/actions";
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

function toLocationInput(l: CustomerLocation): LocationInput {
  return {
    id: l.id,
    label: l.label || "",
    primary: !!l.primary,
    address: l.address || "",
    city: l.city || "",
    state: l.state || "",
    lat: l.lat == null || l.lat === "" ? null : Number(l.lat),
    lng: l.lng == null || l.lng === "" ? null : Number(l.lng),
    venueKind: l.venueKind || "proscenium",
    travelMiles: l.travelMiles,
    travelMin: l.travelMin,
  };
}

function toContactInput(c: CustomerContact): ContactInput {
  return {
    name: c.name,
    role: c.role || "",
    email: c.email || "",
    phone: c.phone || "",
    primary: !!c.primary,
  };
}

export async function createQuoteIntakeAction(
  input: IntakeSubmit
): Promise<{ ok: false; error: string }> {
  await requireUser();

  if (!isServiceType(input.type)) return { ok: false, error: "Unknown quote type." };

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

  redirect(builderPath(input.type, customerId));
}
