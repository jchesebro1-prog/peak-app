"use client";

import { useMemo, type CSSProperties } from "react";
import { CUSTOMER_TYPES } from "@/app/(app)/companies/lib";
import { CustomerCombobox } from "@/components/customer-combobox";
import EntityQuickAdd, { INPUT, LABEL, emptyVenueQuickAdd, type QuickAddValues } from "@/components/entity-quick-add";
import { venueTypeOptions, type VenueType } from "@/lib/venue-types";
import type { IntakeCustomer, IntakeCustomerChoice } from "@/app/(app)/quotes/new/types";

/**
 * Customer · Venue · Contact — the guided-intake picker (#244), lifted out of
 * the quote intake (quotes/new/intake-form.tsx) unchanged so the Grid's
 * new-design intake links a customer the same way. Controlled: the caller
 * owns one CustomerVenueContact value; the server half is
 * lib/intake-customer resolveIntakeCustomer, fed by customerChoiceOf(value).
 */

const ADD_NEW = "__add_new__";
const SKIP = "__skip__";

export type CustomerVenueContact = {
  customerMode: "pick" | "new";
  customerId: string;
  newCustomer: QuickAddValues["customer"];
  locationMode: "pick" | "new" | "skip";
  locationId: string;
  newLocation: QuickAddValues["venue"];
  contactMode: "pick" | "new" | "skip";
  contactName: string;
  newContact: QuickAddValues["contact"];
};

const EMPTY_CONTACT: QuickAddValues["contact"] = { name: "", role: "", email: "", phone: "" };

/** #216 — a new venue starts on the first live venue type. */
export function defaultVenueKindOf(venueTypes: VenueType[]): string | undefined {
  return venueTypeOptions(venueTypes)[0]?.key;
}

/** The picker's opening state — a seeded customer/venue/contact picks them,
 *  otherwise venue and contact start skipped. */
export function initialCustomerVenueContact(
  seed: { customerId: string; locationId: string; contactName: string },
  venueTypes: VenueType[]
): CustomerVenueContact {
  return {
    customerMode: "pick",
    customerId: seed.customerId,
    newCustomer: { name: "", type: CUSTOMER_TYPES[0] || "" },
    locationMode: seed.locationId ? "pick" : "skip",
    locationId: seed.locationId,
    newLocation: emptyVenueQuickAdd(defaultVenueKindOf(venueTypes)),
    contactMode: seed.contactName ? "pick" : "skip",
    contactName: seed.contactName,
    newContact: { ...EMPTY_CONTACT },
  };
}

/** A picked customer, or a new one with a name. */
export function customerReadyOf(v: CustomerVenueContact): boolean {
  return (v.customerMode === "pick" && !!v.customerId) || (v.customerMode === "new" && v.newCustomer.name.trim().length > 0);
}

/** The server payload half (raw — the server trims). */
export function customerChoiceOf(v: CustomerVenueContact): IntakeCustomerChoice {
  return {
    customerMode: v.customerMode,
    customerId: v.customerId,
    newCustomerName: v.newCustomer.name,
    newCustomerType: v.newCustomer.type,
    locationMode: v.locationMode,
    locationId: v.locationId,
    newLocationName: v.newLocation.locationName,
    newLocationKind: v.newLocation.venueKind,
    newLocationCity: v.newLocation.city,
    newLocationState: v.newLocation.state,
    contactMode: v.contactMode,
    contactName: v.contactName,
    newContactName: v.newContact.name,
    newContactRole: v.newContact.role,
    newContactEmail: v.newContact.email,
    newContactPhone: v.newContact.phone,
  };
}

function locationLine(l: IntakeCustomer["locations"][number]): string {
  const where = [l.city, l.state].filter(Boolean).join(", ");
  return where ? `${l.label || "Venue"} — ${where}` : l.label || "Venue";
}

export default function CustomerVenueContactPicker({
  customers,
  value,
  onChange,
  venueTypes,
}: {
  customers: IntakeCustomer[];
  value: CustomerVenueContact;
  onChange: (next: CustomerVenueContact) => void;
  venueTypes: VenueType[];
}) {
  const defaultVenueKind = defaultVenueKindOf(venueTypes);
  const { customerMode, customerId, newCustomer, locationMode, locationId, newLocation, contactMode, contactName, newContact } = value;
  const set = (patch: Partial<CustomerVenueContact>) => onChange({ ...value, ...patch });

  const selectedCustomer = customerMode === "pick" ? customers.find((c) => c.id === customerId) || null : null;
  const locations = selectedCustomer?.locations || [];
  const contacts = selectedCustomer?.contacts || [];
  // A customer is "in play" once one is picked or a new one is being named —
  // that's when the venue/contact steps make sense to show at all.
  const hasCustomerContext = customerMode === "new" || !!customerId;

  // #160: the shared typeahead replaces the search box + closed <select>
  // pair, which filtered options nobody could see. Venue city and contact
  // names are searchable too.
  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        id: c.id,
        name: c.name,
        detail:
          [c.type, c.locations.map((l) => l.label).filter(Boolean).slice(0, 3).join(" · ")].filter(Boolean).join(" — ") ||
          undefined,
        searchText: [
          ...c.locations.map((l) => `${l.label} ${l.city} ${l.state}`),
          ...c.contacts.map((ct) => ct.name),
        ].join(" "),
      })),
    [customers]
  );

  function pickCustomer(id: string) {
    // switching customers invalidates whatever venue/contact was picked off
    // the previous one — reset back to skippable, not silently pointed at
    // the wrong record.
    set({
      ...(id === ADD_NEW ? { customerMode: "new", customerId: "" } : { customerMode: "pick", customerId: id }),
      locationMode: "skip",
      locationId: "",
      contactMode: "skip",
      contactName: "",
    });
  }

  function pickLocation(v: string) {
    if (v === ADD_NEW) set({ locationMode: "new" });
    else if (v === SKIP) set({ locationMode: "skip" });
    else set({ locationMode: "pick", locationId: v });
  }

  function pickContact(v: string) {
    if (v === ADD_NEW) set({ contactMode: "new" });
    else if (v === SKIP) set({ contactMode: "skip" });
    else set({ contactMode: "pick", contactName: v });
  }

  return (
    <>
      {/* ---- customer ---- */}
      <label style={LABEL}>Customer</label>
      {customerMode === "pick" ? (
        <>
          <CustomerCombobox
            options={customerOptions}
            value={customerId}
            onChange={(id) => pickCustomer(id)}
            placeholder="Search customers, venues or contacts…"
            inputStyle={INPUT}
          />
          <button type="button" onClick={() => pickCustomer(ADD_NEW)} style={{ ...inlineLinkStyle, marginTop: 7 }}>
            + Add new customer…
          </button>
        </>
      ) : (
        <EntityQuickAdd kind="customer" value={newCustomer} onChange={(v) => set({ newCustomer: v })} onCancel={() => pickCustomer("")} />
      )}

      {/* ---- venue (skippable) ---- */}
      <label style={LABEL}>Venue</label>
      {!hasCustomerContext && <div style={{ fontSize: 12, color: "#9aa0ab" }}>Pick a customer above first.</div>}
      {hasCustomerContext && locations.length > 0 && (
        <select value={locationMode === "new" ? ADD_NEW : locationMode === "skip" ? SKIP : locationId} onChange={(e) => pickLocation(e.target.value)} style={INPUT}>
          <option value={SKIP}>Skip for now — no venue yet</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {locationLine(l)}
            </option>
          ))}
          <option value={ADD_NEW}>+ Add new venue…</option>
        </select>
      )}
      {hasCustomerContext && locationMode === "new" && (
        <div style={{ marginTop: locations.length > 0 ? 8 : 0 }}>
          <EntityQuickAdd
            kind="venue"
            value={newLocation}
            onChange={(v) => set({ newLocation: v })}
            venueTypes={venueTypes}
            onCancel={() => set({ locationMode: "skip", newLocation: emptyVenueQuickAdd(defaultVenueKind) })}
          />
        </div>
      )}
      {hasCustomerContext && locationMode === "skip" && locations.length === 0 && (
        <div style={{ fontSize: 12, color: "#9aa0ab" }}>
          No venue yet —{" "}
          <button type="button" onClick={() => set({ locationMode: "new" })} style={inlineLinkStyle}>
            add one now
          </button>
          .
        </div>
      )}

      {/* ---- contact (skippable) ---- */}
      <label style={LABEL}>Contact</label>
      {!hasCustomerContext && <div style={{ fontSize: 12, color: "#9aa0ab" }}>Pick a customer above first.</div>}
      {hasCustomerContext && contacts.length > 0 && (
        <select value={contactMode === "new" ? ADD_NEW : contactMode === "skip" ? SKIP : contactName} onChange={(e) => pickContact(e.target.value)} style={INPUT}>
          <option value={SKIP}>Skip for now — no contact yet</option>
          {contacts.map((c) => (
            <option key={c.name} value={c.name}>
              {c.name}
              {c.role ? ` — ${c.role}` : ""}
            </option>
          ))}
          <option value={ADD_NEW}>+ Add new contact…</option>
        </select>
      )}
      {hasCustomerContext && contactMode === "new" && (
        <div style={{ marginTop: contacts.length > 0 ? 8 : 0 }}>
          <EntityQuickAdd
            kind="contact"
            value={newContact}
            onChange={(v) => set({ newContact: v })}
            onCancel={() => set({ contactMode: "skip", newContact: { ...EMPTY_CONTACT } })}
          />
        </div>
      )}
      {hasCustomerContext && contactMode === "skip" && contacts.length === 0 && (
        <div style={{ fontSize: 12, color: "#9aa0ab" }}>
          No contact yet —{" "}
          <button type="button" onClick={() => set({ contactMode: "new" })} style={inlineLinkStyle}>
            add one now
          </button>
          .
        </div>
      )}
    </>
  );
}

export const inlineLinkStyle: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "var(--accent)",
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "underline",
};
