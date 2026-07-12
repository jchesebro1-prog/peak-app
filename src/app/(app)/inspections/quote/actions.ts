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
import { createFromQuote, levelMeta } from "@/lib/stores/inspections";
import {
  getRates,
  setRates,
  computeEstimate,
  type InspectionVenueInput,
} from "@/lib/inspection-engine";
import { getSettings } from "@/lib/settings";
import { coordsOf, nearest, driveMiles, driveMinutes } from "@/lib/geo";

/**
 * Inspection quote mutations (inspection twin of the flame-test / repair
 * quote actions). The client builder previews pricing live; the source of
 * truth is here — we re-price server-side from the customer's venue coords +
 * the persisted rates so a saved quote's value always matches the engine.
 * The saved `inspection` subdoc carries everything the inspections store's
 * createFromQuote() reads (level, scope, venues with line-set counts,
 * contact), so approving spawns the requested inspection(s) cleanly.
 *
 * Margin / mileage / labor knobs mutate the global inspection rates blob,
 * exactly like the other service quotes.
 */

type PostedVenue = { id: string; label: string; lineSets: number };

/** Re-price + persist an inspection quote; returns the saved quote id. */
async function persist(formData: FormData): Promise<string | null> {
  const user = await requireUser();
  const editingId = String(formData.get("editingId") || "");
  const customerId = String(formData.get("customerId") || "");
  const quoteName = String(formData.get("quoteName") || "").trim();
  const contactName = String(formData.get("contactName") || "").trim();
  const contactRole = String(formData.get("contactRole") || "").trim();
  const contactEmail = String(formData.get("contactEmail") || "").trim();
  const notes = String(formData.get("notes") || "").trim();
  const level = levelMeta(String(formData.get("level") || "1")).key;

  let venues: PostedVenue[] = [];
  try {
    venues = JSON.parse(String(formData.get("venues") || "[]"));
  } catch {
    venues = [];
  }
  if (!customerId || !venues.length) return null;

  // knobs → global rates (same seam as the other service quotes)
  const marginPts = Number(formData.get("margin"));
  const mileageRate = Number(formData.get("mileageRate"));
  const laborRate = Number(formData.get("laborRate"));
  const patch: Record<string, number> = {};
  if (Number.isFinite(marginPts)) patch.margin = Math.max(10, Math.min(50, marginPts)) / 100;
  if (Number.isFinite(mileageRate) && mileageRate >= 0) patch.mileageRate = mileageRate;
  if (Number.isFinite(laborRate) && laborRate >= 0) patch.laborRate = laborRate;
  if (Object.keys(patch).length) await setRates(patch);
  const rates = await getRates();

  // resolve venue coords from the customer directory + nearest office
  const cust = await getCustomer(customerId);
  const locById = new Map((cust?.locations || []).map((l) => [l.id, l]));
  const venueInputs: Array<InspectionVenueInput & { id: string | null }> = venues.map((v) => {
    const loc = locById.get(v.id);
    const coords = loc ? coordsOf(loc) : null;
    return {
      id: v.id || null,
      label: v.label || loc?.label || "Venue",
      lineSets: Math.max(0, Math.round(Number(v.lineSets) || 0)),
      coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
      oneWayMiles: loc?.travelMiles ?? null,
      oneWayMin: loc?.travelMin ?? null,
    };
  });

  const settings = await getSettings();
  const offices = Array.isArray(settings.offices) ? settings.offices : [];
  const firstCoords = venueInputs.map((v) => v.coords).find((c) => c && c.lat != null) || null;
  const office = (firstCoords ? nearest(offices, firstCoords) : null) || offices[0] || null;

  const r = computeEstimate(
    {
      office: office || undefined,
      venues: venueInputs,
      level,
      // same offline haversine tier the client inlines, so the saved value
      // matches the live preview
      geo: { driveMiles, driveMinutes },
    },
    rates
  );

  const custName = (await nameFor(customerId)) || cust?.name || "";
  const contact = contactName
    ? { name: contactName, role: contactRole, email: contactEmail }
    : null;

  const name =
    quoteName || custName + " — " + levelMeta(level).label + " inspection";

  const payload = {
    name,
    customer: custName,
    customerId: customerId || null,
    locationId: venueInputs[0].id ?? null,
    value: Math.round(r.total),
    margin: r.margin,
    source: "inspection",
    quoteType: "inspection",
    owner: user.name,
    contact,
    inspection: {
      rates: r.rates,
      office: office ? office.name || office.id || "" : "",
      level,
      scope: notes,
      venues: venueInputs.map((v) => ({ id: v.id, label: v.label, lineSets: v.lineSets })),
      lineSetsTotal: r.lineSetsTotal,
      inspectHours: r.inspectHours,
      baseHours: r.baseHours,
      levelMult: r.levelMult,
      trip: {
        miles: r.trip.miles,
        minutes: r.trip.minutes,
        mileageCost: Math.round(r.trip.mileageCost),
        timeCost: Math.round(r.trip.timeCost),
        method: r.trip.method,
      },
      laborCost: Math.round(r.laborCost),
      cost: Math.round(r.cost),
      minFee: r.minFee,
      minApplied: r.minApplied,
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

export async function saveInspectionQuote(formData: FormData): Promise<void> {
  const id = await persist(formData);
  revalidatePath("/", "layout");
  if (id) redirect("/inspections/quote?id=" + encodeURIComponent(id) + "&saved=1");
}

export async function approveInspectionQuote(formData: FormData): Promise<void> {
  const id = await persist(formData);
  if (!id) {
    revalidatePath("/", "layout");
    return;
  }
  // accept → mark won, which spawns the requested inspection record(s)
  await setStatus(id, "won");
  await createFromQuote(id);
  revalidatePath("/", "layout");
  redirect("/inspections/quote?id=" + encodeURIComponent(id) + "&approved=1");
}
