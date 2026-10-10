"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { remove, upsert } from "@/lib/stores/customers";
import { addNoteRecord, canDeleteNote, getNote, removeNote } from "@/lib/stores/notes";
import {
  coordsOf,
  estimate,
  nearest,
  officesFromSettings,
  route,
} from "@/lib/geo";
import type { AddressHitVM, LocationInput, RouteVM, SaveCustomerInput } from "./types";
import { LIFECYCLES } from "@/lib/identity/config";
import { resolveFieldDefs, validateFieldValues } from "@/lib/customer-fields";
import { getSettings } from "@/lib/settings";
import { getCompanySummary, type CompanySummary } from "@/lib/company-summary";
import { applyVenueMoveRule, saveVenue } from "@/lib/identity/venue-save";
import { setNameAutoForLocIds } from "@/lib/identity/sites";
import { deriveLocationLabels, venueTypesFrom, type SaveVenueInput, type SaveVenueResult } from "@/lib/venue-types";

/**
 * Customers mutations — thin wrappers over CustomerStore. The Customers screen
 * pushes its authoring record through upsert()/normalizeRecord(), exactly like
 * the prototype's _syncStore(). Each action revalidates the whole app layout so
 * Designs / Quotes / Projects re-resolve names, venues and travel by id.
 */

/** Create (no id) or update (id present) a customer. Silent no-op on empty name. */
export async function saveCustomerAction(input: SaveCustomerInput) {
  await requireUser();
  const name = (input.name || "").trim();
  if (!name) return { ok: false as const, id: "" };
  const id = input.id || "c" + Date.now();
  // #23 Details — validated server-side, never trusted from the client.
  // Absent field = absent from the upsert input = PRESERVE (write-when-
  // provided, see stores/customers.ts writeRecord).
  const extras: {
    lifecycle?: string;
    keywords?: string[];
    custom?: Record<string, string | number | boolean | null>;
  } = {};
  if (
    input.lifecycle !== undefined &&
    (LIFECYCLES as readonly string[]).includes(input.lifecycle)
  ) {
    extras.lifecycle = input.lifecycle; // unknown value → field ignored (preserve)
  }
  if (input.keywords !== undefined) {
    const seen = new Set<string>();
    extras.keywords = input.keywords
      .map((k) => (k || "").trim().slice(0, 40))
      .filter((k) => {
        if (!k) return false;
        const lc = k.toLowerCase();
        if (seen.has(lc)) return false; // case-insensitive dedupe
        seen.add(lc);
        return true;
      })
      .slice(0, 20);
  }
  if (input.custom !== undefined) {
    const defs = resolveFieldDefs((await getSettings()).customerFieldDefs);
    extras.custom = validateFieldValues(defs, input.custom);
  }
  // #216 — "Location — Type" names for venues the form marked deriveName;
  // every other venue keeps its label (and is a fixed name they number against).
  const rawLocs = input.locations || [];
  const types = rawLocs.some((l) => l.deriveName) ? venueTypesFrom((await getSettings()).venueTypes) : [];
  const labels = deriveLocationLabels(
    rawLocs.map((l) => ({
      label: (l.label || "").trim(),
      locationName: (l.locationName || "").trim(),
      venueKind: l.venueKind || "proscenium",
      derive: !!l.deriveName,
    })),
    name,
    types
  );
  // #216 — the same move rule as the venue dialog (venueMoveRule): an
  // untouched address keeps the stored coordinates/zip, a moved venue drops
  // the old coordinates, zip and drive distance unless the form sent new ones.
  const locations = await applyVenueMoveRule(
    id,
    rawLocs.map((l, i) => ({
      id: l.id,
      locationName: (l.locationName || "").trim(),
      label: labels[i] || "Venue",
      primary: !!l.primary,
      address: (l.address || "").trim(),
      city: (l.city || "").trim(),
      state: (l.state || "").trim(),
      // #137 — undefined stays undefined (= preserve); normalizeRecord trims.
      zip: l.zip,
      kind: l.kind,
      lat: l.lat,
      lng: l.lng,
      venueKind: l.venueKind || "proscenium",
      travelMiles: l.travelMiles,
      travelMin: l.travelMin,
    }))
  );
  await upsert({
    id,
    name,
    type: input.type || "",
    pricingTier: (input.pricingTier || "").trim() || null,
    locations,
    contacts: (input.contacts || [])
      .filter((c) => (c.name || "").trim())
      .map((c) => ({
        name: (c.name || "").trim(),
        role: (c.role || "").trim(),
        email: (c.email || "").trim(),
        phone: (c.phone || "").trim(),
        mobile: c.mobile,
        primary: !!c.primary,
      })),
    ...extras,
  });
  // #216 — venues whose name this save derived follow future type renames.
  const derivedLocIds = rawLocs.filter((l) => l.deriveName && l.id).map((l) => l.id as string);
  if (derivedLocIds.length) await setNameAutoForLocIds(id, derivedLocIds, true);
  revalidatePath("/", "layout");
  return { ok: true as const, id };
}

/** #216 — create or update ONE venue (the venue dialog, the inbox quick-add).
 *  Same permission as saveCustomerAction. The name is derived server-side. */
export async function saveVenueAction(input: SaveVenueInput): Promise<SaveVenueResult> {
  await requireUser();
  const res = await saveVenue(input);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

/** Soft-delete a customer (prototype: setDirectory full-replace dropped it).
 *  Gated on `create`, like deleting a design, consulting project or project (#278). */
export async function deleteCustomerAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false as const, error: "You can't delete companies." };
  if (!id) return { ok: false as const, error: "Missing company id." };
  await remove(id);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Live address search for the edit modal (geo.search / Nominatim). */
export async function searchAddressAction(query: string): Promise<AddressHitVM[]> {
  await requireUser();
  const { pacedSearch } = await import("@/lib/address-verify/nominatim-pacer");
  const hits = await pacedSearch(query, { limit: 6 }, { maxWaitMs: 3_000 });
  return hits.map((h) => ({
    title: h.title,
    sub: h.sub,
    street: h.street,
    city: h.city,
    state: h.state,
    zip: h.zip,
    lat: h.lat,
    lng: h.lng,
  }));
}

/**
 * Fetch a real driving route (OSRM) from the nearest office to a venue and
 * return {miles, minutes} to prefill the manual override fields — the
 * prototype's "Route" button. Falls back to the haversine estimate.
 */
export async function routeLocationAction(loc: LocationInput): Promise<RouteVM> {
  await requireUser();
  const offices = await officesFromSettings();
  const coords = coordsOf(loc);
  if (!coords) return { miles: null, minutes: null, officeName: "nearest office" };
  const office = nearest(offices, coords);
  const officeName = office ? office.name : "nearest office";
  const routed = office ? await route(office, coords) : null;
  if (routed) return { miles: routed.miles, minutes: routed.minutes, officeName };
  const est = await estimate(offices, { ...loc, ...coords, travelMiles: null, travelMin: null });
  return { miles: est.miles, minutes: est.minutes, officeName };
}

/** Companies map — the pop-out panel's data for one company (pin/list
 *  click). requireUser() gates it like every other data read here; a
 *  missing/deleted company reads as `null`, not a thrown 404. */
export async function getCompanySummaryAction(id: string): Promise<CompanySummary | null> {
  await requireUser();
  return getCompanySummary(String(id || ""));
}

/* ---- customer portal access (IDEAS #47) ---- */

export async function createPortalGrantAction(input: {
  customerId: string;
  name: string;
  email: string;
}) {
  const user = await requireUser();
  const { get } = await import("@/lib/stores/customers");
  const { createGrant, grantPath } = await import("@/lib/portal");
  const cust = await get(String(input.customerId || ""));
  const name = String(input.name || "").trim();
  const email = String(input.email || "").trim();
  if (!cust) return { ok: false as const, error: "Unknown customer." };
  if (!name || !email)
    return { ok: false as const, error: "A name and email are required." };
  const grant = await createGrant({
    customerId: cust.id,
    name,
    email,
    createdBy: user.name,
  });
  revalidatePath("/companies/" + encodeURIComponent(cust.id));
  return { ok: true as const, path: grantPath(grant) };
}

export async function revokePortalGrantAction(input: {
  customerId: string;
  grantId: string;
}) {
  await requireUser();
  const { revokeGrant } = await import("@/lib/portal");
  await revokeGrant(String(input.grantId || ""));
  revalidatePath("/companies/" + encodeURIComponent(String(input.customerId || "")));
  return { ok: true as const };
}

/** #21 — the Activity card's note composer. parentKind "customer" is the
 *  only v1 composer; the NoteRecord is attachable by design (lead/project/
 *  quote surfaces come later with no migration). */
export async function addCustomerNoteAction(customerId: string, text: string) {
  const me = await requireUser();
  const t = (text || "").trim();
  if (!customerId || !t) return { ok: false as const, error: "Write a note first." };
  try {
    await addNoteRecord(
      { parentKind: "customer", parentId: customerId, customerId, text: t },
      me.name
    );
  } catch (err) {
    // #80: insertWithPrefixedId THROWS once an id collision outlasts its retry
    // budget (doc-store.ts). Rare, but this is a button press — report it
    // through the failure shape this action already has instead of letting a
    // raw exception escape as a 500.
    console.error("addCustomerNoteAction: note mint failed", err);
    return { ok: false as const, error: "Couldn’t save that note — please try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Delete a user-authored note from the Activity feed (soft delete). The UI
 *  only ever offers this for a note with a deletableNoteId (customer-feed-
 *  rows.ts's noteFeedRows), i.e. never for a system-authored entry — but
 *  that's a UI convenience, not the gate: the server re-checks against the
 *  real record (canDeleteNote, notes.ts) so a stale client or a direct call
 *  can't delete someone else's note or a system entry. Throws on refusal —
 *  the ConfirmButton this feeds shows a thrown Error's message inline. */
export async function removeCustomerNoteAction(customerId: string, noteId: string) {
  const me = await requireUser();
  if (!noteId) throw new Error("Nothing to delete.");
  const note = await getNote(noteId);
  if (!note) throw new Error("That note is already gone.");
  const gate = canDeleteNote(note, { name: me.name, roles: me.roles });
  if (!gate.ok) throw new Error(gate.error);
  await removeNote(noteId);
  revalidatePath("/companies/" + encodeURIComponent(customerId));
  return { ok: true as const };
}
