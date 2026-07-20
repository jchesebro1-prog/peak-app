"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { remove, upsert } from "@/lib/stores/customers";
import {
  coordsOf,
  estimate,
  nearest,
  officesFromSettings,
  route,
} from "@/lib/geo";
import type { AddressHitVM, LocationInput, RouteVM, SaveCustomerInput } from "./types";

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
  await upsert({
    id,
    name,
    type: input.type || "",
    pricingTier: (input.pricingTier || "").trim() || null,
    locations: (input.locations || []).map((l) => ({
      id: l.id,
      label: (l.label || "").trim() || "Venue",
      primary: !!l.primary,
      address: (l.address || "").trim(),
      city: (l.city || "").trim(),
      state: (l.state || "").trim(),
      lat: l.lat,
      lng: l.lng,
      venueKind: l.venueKind || "proscenium",
      travelMiles: l.travelMiles,
      travelMin: l.travelMin,
    })),
    contacts: (input.contacts || [])
      .filter((c) => (c.name || "").trim())
      .map((c) => ({
        name: (c.name || "").trim(),
        role: (c.role || "").trim(),
        email: (c.email || "").trim(),
        phone: (c.phone || "").trim(),
        primary: !!c.primary,
      })),
  });
  revalidatePath("/", "layout");
  return { ok: true as const, id };
}

/** Soft-delete a customer (prototype: setDirectory full-replace dropped it). */
export async function deleteCustomerAction(id: string) {
  await requireUser();
  if (!id) return { ok: false as const };
  await remove(id);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Live address search for the edit modal (geo.search / Nominatim). */
export async function searchAddressAction(query: string): Promise<AddressHitVM[]> {
  await requireUser();
  const { search } = await import("@/lib/geo");
  const hits = await search(query, { limit: 6 });
  return hits.map((h) => ({
    title: h.title,
    sub: h.sub,
    city: h.city,
    state: h.state,
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
