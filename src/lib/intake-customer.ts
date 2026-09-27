import { get as getCustomer, type CustomerDoc } from "@/lib/stores/customers";
import { saveCustomerAction } from "@/app/(app)/companies/actions";
import { toContactInput, toLocationInput } from "@/app/(app)/companies/lib";
import type { ContactInput, LocationInput } from "@/app/(app)/companies/types";
import type { IntakeCustomer, IntakeCustomerChoice } from "@/app/(app)/quotes/new/types";
import { getSettings } from "@/lib/settings";
import { venueTypeOptions, venueTypesFrom } from "@/lib/venue-types";

/**
 * The customer / venue / contact half of a guided intake (#244) — moved
 * verbatim out of the quote intake's createQuoteIntakeAction so the Grid's
 * new-design intake links a customer exactly the same way. Server-only
 * (it saves through saveCustomerAction, a plain call from server code).
 *
 * Two phases so the quote intake keeps its order: validateIntakeCustomer
 * (no reads, no writes) runs before the thread pre-check there, and
 * resolveIntakeCustomer (the reads + the one save) after it.
 */

/** The directory view-model an intake form picks from — the reduced shape
 *  the quote intake's page has always built, plus each venue's location
 *  name and address (#244, read by the Grid intake's cover page only). */
export function intakeCustomersFrom(docs: CustomerDoc[]): IntakeCustomer[] {
  return docs
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
        locationName: l.locationName || "",
        address: l.address || "",
      })),
      contacts: (c.contacts || []).map((ct) => ({
        name: ct.name,
        role: ct.role || "",
        primary: !!ct.primary,
      })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type IntakeCustomerCheck =
  | { ok: true; creatingCustomer: boolean; newCustomerName: string; pickedCustomerId: string }
  | { ok: false; error: string };

/** The customer is required: a picked id, or a named new customer. */
export function validateIntakeCustomer(input: IntakeCustomerChoice): IntakeCustomerCheck {
  const creatingCustomer = input.customerMode === "new";
  const newCustomerName = (input.newCustomerName || "").trim();
  if (creatingCustomer && !newCustomerName) {
    return { ok: false, error: "Enter a name for the new customer." };
  }
  const pickedCustomerId = (input.customerId || "").trim();
  if (!creatingCustomer && !pickedCustomerId) {
    return { ok: false, error: "Pick a customer, or add a new one." };
  }
  return { ok: true, creatingCustomer, newCustomerName, pickedCustomerId };
}

export type ResolvedIntakeCustomer = {
  ok: true;
  customerId: string;
  /** Display name — the picked record's, or the new customer's. */
  customerName: string;
  /** The chosen or newly added venue's customer-doc location id
   *  (docLocId of its site), "" when skipped. */
  locationId: string;
  /** The chosen or newly added contact's NAME (contacts have no id), "" when skipped. */
  contactName: string;
};

/**
 * Resolve (or create) the customer, append a new venue / contact to it, and
 * report what was chosen. Re-validates first (no side effect), so a caller
 * that skipped validateIntakeCustomer is still safe.
 */
export async function resolveIntakeCustomer(
  input: IntakeCustomerChoice
): Promise<ResolvedIntakeCustomer | { ok: false; error: string }> {
  const check = validateIntakeCustomer(input);
  if (!check.ok) return check;
  const { creatingCustomer, newCustomerName, pickedCustomerId } = check;

  const existing = !creatingCustomer ? await getCustomer(pickedCustomerId) : null;
  if (!creatingCustomer && !existing) {
    return { ok: false, error: "That customer couldn't be found — refresh and try again." };
  }

  const locations: LocationInput[] = (existing?.locations || []).map(toLocationInput);
  const contacts: ContactInput[] = (existing?.contacts || []).map(toContactInput);

  if (input.locationMode === "new") {
    const types = venueTypesFrom((await getSettings()).venueTypes);
    const kind = (input.newLocationKind || "").trim();
    locations.push({
      // A minted id so the new venue is findable after the save (it becomes
      // the site's legacyLocId → its docLocId).
      id: "l" + Date.now() + Math.random().toString(36).slice(2, 6),
      locationName: (input.newLocationName || "").trim(),
      label: "",
      deriveName: true,
      // First location on the record → primary. Never demotes one that's
      // already there.
      primary: locations.length === 0,
      address: "",
      city: (input.newLocationCity || "").trim(),
      state: (input.newLocationState || "").trim(),
      lat: null,
      lng: null,
      // #216 — an unknown/archived type falls back to the first live one.
      venueKind: venueTypeOptions(types).some((t) => t.key === kind)
        ? kind
        : (venueTypeOptions(types)[0]?.key ?? "proscenium"),
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
  let locationId = input.locationMode === "pick" ? (input.locationId || "").trim() : "";
  if (input.locationMode === "new") {
    const before = new Set((existing?.locations || []).map((l) => l.id));
    const after = await getCustomer(customerId);
    locationId = (after?.locations || []).find((l) => l.id && !before.has(l.id))?.id || "";
  }
  const contactName =
    input.contactMode === "pick"
      ? (input.contactName || "").trim()
      : input.contactMode === "new"
        ? (input.newContactName || "").trim()
        : "";

  return { ok: true, customerId, customerName: existing?.name || newCustomerName, locationId, contactName };
}
