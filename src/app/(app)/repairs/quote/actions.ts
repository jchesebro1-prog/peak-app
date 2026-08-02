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
import {
  CATEGORIES,
  PRIORITIES,
  createFromQuote,
  type RepairSourceKind,
} from "@/lib/stores/repair-jobs";
import {
  getRates,
  setRates,
  computeEstimate,
  type RepairPartInput,
  type TripVenueInput,
} from "@/lib/repair-engine";
import { resolveTier } from "@/lib/pricing-tiers";
import { getSettings } from "@/lib/settings";
import { getTravelRates } from "@/lib/stores/pricing";
import { coordsOf, nearest, driveMiles, driveMinutes } from "@/lib/geo";

/**
 * Repair quote mutations (repair twin of the flame-test quote actions).
 * The client builder previews pricing live; the source of truth is here — we
 * re-price server-side from the customer's venue coords + the persisted
 * rates so a saved quote's value always matches the engine. The saved
 * `repair` subdoc carries everything repair-jobs' createFromQuote() reads
 * (category, priority, title, scope, source, items, parts, laborHours,
 * contact, venues), so approving spawns the job cleanly.
 *
 * Margin / mileage / labor knobs mutate the global repair rates blob,
 * exactly like the flame-test quote's setRates before a save.
 */

type PostedVenue = { id: string; label: string };
type PostedPart = { name: string; qty: number; cost: number };

/** Re-price + persist a repair quote; returns the saved quote id. */
async function persist(formData: FormData): Promise<string | null> {
  const user = await requireUser();
  const editingId = String(formData.get("editingId") || "");
  const customerId = String(formData.get("customerId") || "");
  const quoteName = String(formData.get("quoteName") || "").trim();
  const contactName = String(formData.get("contactName") || "").trim();
  const contactRole = String(formData.get("contactRole") || "").trim();
  const contactEmail = String(formData.get("contactEmail") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  const catRaw = String(formData.get("category") || "");
  const category = CATEGORIES.some((c) => c.key === catRaw) ? catRaw : "other";
  const priRaw = String(formData.get("priority") || "");
  const priority = PRIORITIES.some((p) => p.key === priRaw) ? priRaw : "standard";

  let venues: PostedVenue[] = [];
  try {
    venues = JSON.parse(String(formData.get("venues") || "[]"));
  } catch {
    venues = [];
  }
  let items: string[] = [];
  try {
    items = JSON.parse(String(formData.get("items") || "[]"));
  } catch {
    items = [];
  }
  let parts: PostedPart[] = [];
  try {
    parts = JSON.parse(String(formData.get("parts") || "[]"));
  } catch {
    parts = [];
  }
  if (!customerId || !venues.length) return null;

  // Mileage/labor knobs stay global rates. MARGIN went per-quote with
  // customer tiers (item 11, D87/D88): the tier seeds it, the knob
  // overrides it for THIS quote only.
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
  const venueInputs: Array<TripVenueInput & { id: string | null }> = venues.map((v) => {
    const loc = locById.get(v.id);
    const coords = loc ? coordsOf(loc) : null;
    return {
      id: v.id || null,
      label: v.label || loc?.label || "Venue",
      coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
      oneWayMiles: loc?.travelMiles ?? null,
      oneWayMin: loc?.travelMin ?? null,
    };
  });

  const settings = await getSettings();
  const offices = Array.isArray(settings.offices) ? settings.offices : [];
  const firstCoords = venueInputs.map((v) => v.coords).find((c) => c && c.lat != null) || null;
  const office = (firstCoords ? nearest(offices, firstCoords) : null) || offices[0] || null;

  const hoursEach = Math.max(0, Number(formData.get("laborHours")) || 0);
  const crewSize = Math.max(1, Math.round(Number(formData.get("crewSize")) || 1));
  const emergency = priority === "emergency";
  const partInputs: RepairPartInput[] = parts.map((p) => ({
    name: p.name,
    qty: p.qty,
    cost: p.cost,
  }));

  // same offline haversine tier the client inlines, so the saved value
  // matches the live preview — but bound to the LIVE Estimating Rules
  // travel rates (roadFactor/mph), not driveMiles/driveMinutes' hardcoded
  // defaults.
  const travelRates = await getTravelRates();
  const r = computeEstimate(
    {
      office: office || undefined,
      venues: venueInputs,
      laborHours: hoursEach * crewSize,
      parts: partInputs,
      emergency,
      geo: {
        driveMiles: (a, b) => driveMiles(a, b, travelRates),
        driveMinutes: (a, b) => driveMinutes(a, b, travelRates),
      },
    },
    rates
  );

  const custName = (await nameFor(customerId)) || cust?.name || "";
  const contact = contactName
    ? { name: contactName, role: contactRole, email: contactEmail }
    : null;

  const sourceKind = String(formData.get("sourceKind") || "");
  const sourceRef = String(formData.get("sourceRef") || "");
  const sourceLog = String(formData.get("sourceLog") || "");
  const sourceLabel = String(formData.get("sourceLabel") || "");
  const source = sourceKind
    ? {
        kind: sourceKind as RepairSourceKind,
        ...(sourceRef ? { refId: sourceRef } : {}),
        ...(sourceLog ? { logId: Number(sourceLog) } : {}),
        label: sourceLabel || "From " + sourceKind,
      }
    : null;

  const scopeItems = items.map((s) => s.trim()).filter(Boolean);
  const name = quoteName || custName + " — Repair";

  const payload = {
    name,
    customer: custName,
    customerId: customerId || null,
    locationId: venueInputs[0].id ?? null,
    value: Math.round(r.total),
    margin: r.margin,
    pricingTier: tier.tier,
    tierMargin: tier.margin,
    source: "repair",
    quoteType: "repair",
    owner: user.name,
    contact,
    repair: {
      rates: r.rates,
      office: office ? office.name || office.id || "" : "",
      category,
      priority,
      title: scopeItems[0] || name,
      scope: notes,
      source,
      items: scopeItems.map((label) => ({ label, qty: 1, note: "" })),
      parts: r.parts.map((p) => ({ name: p.name, qty: p.qty, cost: p.cost })),
      // laborHours is total crew-hours (what the job tracks); hoursEach ×
      // crewSize round-trips the builder inputs
      laborHours: r.laborHours,
      hoursEach,
      crewSize,
      emergency: r.emergency,
      venues: venueInputs.map((v) => ({ id: v.id, label: v.label })),
      trip: {
        miles: r.trip.miles,
        minutes: r.trip.minutes,
        mileageCost: Math.round(r.trip.mileageCost),
        timeCost: Math.round(r.trip.timeCost),
        method: r.trip.method,
      },
      laborCost: Math.round(r.laborCost),
      serviceCost: Math.round(r.serviceCost),
      serviceSell: Math.round(r.serviceSell),
      minCallout: r.minCallout,
      calloutApplied: r.calloutApplied,
      partsCost: Math.round(r.partsCost),
      partsSell: Math.round(r.partsSell),
      partsMargin: r.partsMargin,
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

export async function saveRepairQuote(formData: FormData): Promise<void> {
  const id = await persist(formData);
  revalidatePath("/", "layout");
  if (id) redirect("/repairs/quote?id=" + encodeURIComponent(id) + "&saved=1");
}

export async function approveRepairQuote(formData: FormData): Promise<void> {
  const id = await persist(formData);
  if (!id) {
    revalidatePath("/", "layout");
    return;
  }
  // accept → mark won, which spins up the approved repair job. Bypasses the
  // punch #60 approval gate: this screen IS the approval — accepting a repair
  // quote here is a self-contained flow with no separate estimator review
  // queue to check a record against, unlike the estimator's send/won paths.
  await setStatus(id, "won", undefined, { bypassApprovalGate: "engine-owned-flow" });
  await createFromQuote(id);
  revalidatePath("/", "layout");
  redirect("/repairs/quote?id=" + encodeURIComponent(id) + "&approved=1");
}
