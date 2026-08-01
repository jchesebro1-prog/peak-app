"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { get as getCustomer, nameFor } from "@/lib/stores/customers";
import {
  create as createQuote,
  update as updateQuote,
  setStatus,
} from "@/lib/stores/quotes";
import { syncFromQuotes } from "@/lib/stores/flame-jobs";
import { getRates, setRates, compute, type FlameTestVenueInput } from "@/lib/flametest-engine";
import { getTravelRates } from "@/lib/stores/pricing";
import { resolveTier } from "@/lib/pricing-tiers";
import { getSettings } from "@/lib/settings";
import { coordsOf, nearest } from "@/lib/geo";

/**
 * Flame-test quote mutations (server port of Flame Test Quote.dc.html
 * save()/approve()). The client builder previews pricing live; the source of
 * truth is here — we re-price server-side from the customer's venue coords +
 * the persisted rates so a saved quote's value always matches the engine.
 *
 * Margin / mileage / labor knobs mutate the global flametest rates blob,
 * exactly like the prototype's FlameTest.setRates before a save.
 */

type PostedVenue = { id: string; label: string; curtains: number };

/** Re-price + persist a flame-test quote; returns the saved quote id. */
async function persist(formData: FormData): Promise<string | null> {
  const user = await requireUser();
  const editingId = String(formData.get("editingId") || "");
  const customerId = String(formData.get("customerId") || "");
  const quoteName = String(formData.get("quoteName") || "").trim();
  const contactName = String(formData.get("contactName") || "").trim();
  const contactRole = String(formData.get("contactRole") || "").trim();
  const contactEmail = String(formData.get("contactEmail") || "").trim();

  let venues: PostedVenue[] = [];
  try {
    venues = JSON.parse(String(formData.get("venues") || "[]"));
  } catch {
    venues = [];
  }
  if (!customerId || !venues.length) return null;

  // Mileage/labor knobs stay global rates (prototype FlameTest.setRates).
  // MARGIN went per-quote with customer tiers (item 11, D87): the customer's
  // tier seeds it, the builder knob overrides it for THIS quote only — one
  // quote's margin no longer reprices every future flame quote.
  const marginPts = Number(formData.get("margin"));
  const mileageRate = Number(formData.get("mileageRate"));
  const laborRate = Number(formData.get("laborRate"));
  const patch: Record<string, number> = {};
  if (Number.isFinite(mileageRate) && mileageRate >= 0) patch.mileageRate = mileageRate;
  if (Number.isFinite(laborRate) && laborRate >= 0) patch.laborRate = laborRate;
  if (Object.keys(patch).length) await setRates(patch);
  const baseRates = await getRates();
  const tier = await resolveTier(customerId, contactName);
  const quoteMargin = Number.isFinite(marginPts)
    ? Math.max(5, Math.min(50, marginPts)) / 100
    : tier.margin;
  const rates = { ...baseRates, margin: quoteMargin };

  // resolve venue coords from the customer directory + nearest office
  const cust = await getCustomer(customerId);
  const locById = new Map((cust?.locations || []).map((l) => [l.id, l]));
  const venueInputs: FlameTestVenueInput[] = venues.map((v) => {
    const loc = locById.get(v.id);
    const coords = loc ? coordsOf(loc) : null;
    return {
      id: v.id,
      label: v.label || loc?.label || "Venue",
      curtains: v.curtains,
      coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
      oneWayMiles: loc?.travelMiles ?? null,
      oneWayMin: loc?.travelMin ?? null,
    };
  });

  const settings = await getSettings();
  const offices = Array.isArray(settings.offices) ? settings.offices : [];
  const firstCoords = venueInputs.map((v) => v.coords).find((c) => c && c.lat != null) || null;
  const office = (firstCoords ? nearest(offices, firstCoords) : null) || offices[0] || null;

  const travelRates = await getTravelRates();
  const r = compute({ office: office || undefined, venues: venueInputs }, rates, travelRates);

  const custName = (await nameFor(customerId)) || cust?.name || "";
  const contact = contactName
    ? { name: contactName, role: contactRole, email: contactEmail }
    : null;
  const origin = office
    ? {
        name: office.name || "",
        street: office.street || "",
        city: office.city || "",
        state: office.state || "",
        zip: office.zip || "",
      }
    : null;

  const payload = {
    name: quoteName || custName + " — Flame test",
    customer: custName,
    customerId: customerId || null,
    locationId: venueInputs[0].id ?? null,
    value: Math.round(r.total),
    margin: r.margin,
    pricingTier: tier.tier,
    tierMargin: tier.margin,
    source: "flametest",
    quoteType: "flame_test",
    owner: user.name,
    contact,
    flameTest: {
      rates: r.rates,
      office: office ? office.name || office.id || "" : "",
      origin,
      venues: r.perVenue.map((v) => ({
        id: v.id,
        label: v.label,
        curtains: v.curtains,
        testingCost: Math.round(v.laborCost),
      })),
      curtainsTotal: r.curtainsTotal,
      trip: {
        miles: r.trip.miles,
        minutes: r.trip.minutes,
        mileageCost: Math.round(r.trip.mileageCost),
        timeCost: Math.round(r.trip.timeCost),
        method: r.trip.method,
      },
      rawCost: Math.round(r.rawCost),
      baseFee: Math.round(r.baseFee),
      baseApplied: r.baseApplied,
      cost: Math.round(r.cost),
      marginAmount: Math.round(r.marginAmount),
      total: Math.round(r.total),
      contact,
    },
  };

  const q = editingId
    ? await updateQuote(editingId, payload)
    : await createQuote(payload);
  return (q && q.id) || editingId || null;
}

export async function saveFlameQuote(formData: FormData): Promise<void> {
  const id = await persist(formData);
  revalidatePath("/", "layout");
  if (id) redirect("/flame-tests/quote?id=" + encodeURIComponent(id) + "&saved=1");
}

export async function approveFlameQuote(formData: FormData): Promise<void> {
  const id = await persist(formData);
  if (!id) {
    revalidatePath("/", "layout");
    return;
  }
  // accept → mark won, which spins up the approved flame-test job
  await setStatus(id, "won");
  await syncFromQuotes();
  revalidatePath("/", "layout");
  redirect("/flame-tests/quote?id=" + encodeURIComponent(id) + "&approved=1");
}
