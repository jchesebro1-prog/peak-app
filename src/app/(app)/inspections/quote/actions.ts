"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireUser } from "@/lib/session";
import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";
import { get as getCustomer, nameFor } from "@/lib/stores/customers";
import {
  create as createQuote,
  get as getQuote,
  update as updateQuote,
  retireReplacedDraftSafely,
  setStatus,
  statusFailureMessage,
} from "@/lib/stores/quotes";
import { levelMeta } from "@/lib/stores/inspections";
import {
  getRates,
  setRates,
  computeEstimate,
  type InspectionVenueInput,
} from "@/lib/inspection-engine";
import { resolveTier, serviceMarginFor } from "@/lib/pricing-tiers";
import { getTravelRates } from "@/lib/stores/pricing";
import { driveMiles, driveMinutes } from "@/lib/geo";
import { parseTravelOverride, savedTrip } from "@/lib/travel-plan";
import { deriveSeededMarker, normalizeLift, normalizePriceOverride, savedLift } from "@/lib/service-pricing";
import { getLiftRate, inspectionVenueInputsFrom, resolveQuoteOffice } from "@/lib/service-quote-inputs";
import { approveKeepsAcceptedPrice, sourceForSave } from "@/lib/portal-quote-mode";

function quoteFailure(formData: FormData, message: string): never {
  const id = String(formData.get("editingId") || "");
  const qs = new URLSearchParams({ ...(id ? { id } : {}), err: message });
  redirect("/inspections/quote?" + qs.toString());
}

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
  const replaces = String(formData.get("replaces") || "").trim();
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
  // #254 follow-up: an untiered customer prices/stamps at THIS service's own
  // default margin (baseRates.margin — same seed the builder knob uses), not
  // tier Base's registry margin (src/lib/pricing-tiers.ts serviceMarginFor).
  const serviceMargin = serviceMarginFor(tier, baseRates.margin);
  const quoteMargin = Number.isFinite(marginPts)
    ? Math.max(5, Math.min(50, marginPts)) / 100
    : serviceMargin;
  const rates = { ...baseRates, margin: quoteMargin };

  // resolve venue coords from the customer directory + nearest office
  const cust = await getCustomer(customerId);
  const venueInputs: Array<InspectionVenueInput & { id: string | null }> =
    inspectionVenueInputsFrom(venues, cust);

  const office = await resolveQuoteOffice();

  // same offline haversine tier the client inlines, so the saved value
  // matches the live preview — but bound to the LIVE Estimating Rules
  // travel rates (roadFactor/mph), not driveMiles/driveMinutes' hardcoded
  // defaults.
  const travelRates = await getTravelRates();
  // Flights over drive (spec 2026-09-25): the builder posts its Auto · Drive ·
  // Fly choice + crew/nights/airfare overrides as JSON; absent = auto.
  const travelOverride = parseTravelOverride(formData.get("travel"));
  // #217: a typed total (whole dollars, $1–$10,000,000) replaces the rounded
  // auto total exactly; the 5–50 clamp above bounds only the slider's margin.
  const priceOverride = normalizePriceOverride(formData.get("priceOverride"));
  // #275: an optional lift rental — count × rate (blank rate = the live
  // EQP-LIFT default); count 0 / absent = no lift.
  const lift = normalizeLift(formData.get("lift"), await getLiftRate());
  // #217 fix wave: whether this typed total is only the D286 reopen-seed for
  // an old off-grid sent price — never something anyone actually typed — is
  // derived from the STORED quote, not a client-posted flag (a client can't
  // fake or drop it, and it agrees with itself across every reopen), so next
  // year's renewal draft never calls it "hand-set" (priorHandSetPrice).
  const existingForMarker = editingId ? await getQuote(editingId) : null;
  const existingInsp = (existingForMarker?.inspection ?? null) as
    | { priceOverride?: number | null; priceOverrideSeeded?: boolean }
    | null;
  const priceOverrideSeeded = deriveSeededMarker({
    postedOverride: priceOverride,
    stored: existingForMarker
      ? {
          value: existingForMarker.value,
          status: existingForMarker.status,
          priceOverride: existingInsp?.priceOverride ?? null,
          priceOverrideSeeded: !!existingInsp?.priceOverrideSeeded,
        }
      : null,
  });
  const r = computeEstimate(
    {
      office: office || undefined,
      venues: venueInputs,
      level,
      travel: travelOverride,
      priceOverride,
      lift,
      geo: {
        driveMiles: (a, b) => driveMiles(a, b, travelRates),
        driveMinutes: (a, b) => driveMinutes(a, b, travelRates),
      },
    },
    rates,
    travelRates
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
    margin: r.effectiveMargin,
    pricingTier: tier.tier,
    tierMargin: serviceMargin,
    // #248 Task 4 (spec §5): a portal-generated quote (source
    // "portal-service") keeps that source across a staff save — the same
    // rule the Estimator applies to portal-catalog (D416).
    source: sourceForSave(existingForMarker?.source, "inspection"),
    quoteType: "inspection",
    // #242 final: the owner is set when the quote is CREATED (below) and kept
    // on every later save — the review limit follows the quote's owner, never
    // whoever saved it last.
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
      trip: savedTrip(r.trip),
      ...(travelOverride ? { travel: travelOverride } : {}),
      laborCost: Math.round(r.laborCost),
      ...(r.lift ? { lift: savedLift(r.lift, r) } : {}),
      cost: Math.round(r.cost),
      minFee: r.minFee,
      minApplied: r.minApplied,
      marginAmount: Math.round(r.marginAmount),
      autoTotal: Math.round(r.autoTotal),
      ...(r.priceOverride != null ? { priceOverride: r.priceOverride } : {}),
      ...(r.priceOverride != null && priceOverrideSeeded ? { priceOverrideSeeded: true } : {}),
      total: Math.round(r.total),
      contact,
    },
  };

  const q = editingId
    ? await updateQuote(editingId, payload)
    : await createQuote({ ...payload, owner: user.name });
  // D205: first save of a "Change type" replacement retires the old draft.
  // The new quote already exists, so a failed retire is logged, never thrown —
  // a throw would read as "nothing was written" and a re-save would duplicate.
  if (!editingId && q) {
    await retireReplacedDraftSafely(replaces, q.id, "inspections quote");
  }
  // #222: every save re-prints the proposal letter to the saved PDF.
  if (q) await scheduleQuotePdf(q.id);
  return (q && q.id) || editingId || null;
}

export async function saveInspectionQuote(formData: FormData): Promise<void> {
  let id: string | null;
  try {
    id = await persist(formData);
  } catch (error) {
    // `persist()` opens with requireUser(), which sends an expired session to
    // /login BY throwing — a catch in the app directory must never eat that
    // (same first line as home-actions.ts’s stage-move catch).
    unstable_rethrow(error);
    console.error("saveInspectionQuote: quote save failed", error);
    quoteFailure(formData, "Couldn’t save the inspection quote — please try again.");
  }
  revalidatePath("/", "layout");
  if (id) redirect("/inspections/quote?id=" + encodeURIComponent(id) + "&saved=1");
}

export async function approveInspectionQuote(formData: FormData): Promise<void> {
  let id: string | null;
  try {
    // #248 final review (controller decision 1): an accepted portal-service
    // quote approves at the price the customer already accepted — persist()
    // would re-price it at today's rates/tier first, which a mileage-rate
    // or margin edit between Accept and Approve could quietly change out
    // from under the accepted number. Same permission check persist() would
    // have made (requireUser()), just made directly since persist() is
    // skipped.
    const editingId = String(formData.get("editingId") || "");
    const existing = editingId ? await getQuote(editingId) : null;
    if (existing && approveKeepsAcceptedPrice(existing)) {
      const user = await requireUser();
      await setStatus(editingId, "won", user.name, { bypassApprovalGate: "engine-owned-flow" });
      id = editingId;
    } else {
      id = await persist(formData);
      if (!id) {
        revalidatePath("/", "layout");
        return;
      }
      await setStatus(id, "won", undefined, { bypassApprovalGate: "engine-owned-flow" });
    }
  } catch (error) {
    // `persist()` opens with requireUser(), which sends an expired session to
    // /login BY throwing — a catch in the app directory must never eat that
    // (same first line as home-actions.ts’s stage-move catch).
    unstable_rethrow(error);
    // #174: the one shared branch, with this screen's own wording as the
    // fallback. Everything landing here today IS a defect — the call above
    // passes `bypassApprovalGate: "engine-owned-flow"`, so the approval gate
    // cannot refuse it — and it is logged as one. If that bypass is ever
    // dropped, the gate's own sentence reaches the user instead of being
    // flattened into "please try again".
    quoteFailure(
      formData,
      statusFailureMessage(error, "approveInspectionQuote: quote approval failed", "Couldn’t approve the inspection quote — please try again.")
    );
  }
  revalidatePath("/", "layout");
  redirect("/inspections/quote?id=" + encodeURIComponent(id) + "&approved=1");
}
