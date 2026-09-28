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
import { getRates, setRates, compute, type FlameTestVenueInput } from "@/lib/flametest-engine";
import { getTravelRates } from "@/lib/stores/pricing";
import { resolveTier } from "@/lib/pricing-tiers";
import { parseTravelOverride, savedTrip } from "@/lib/travel-plan";
import { deriveSeededMarker, normalizePriceOverride } from "@/lib/service-pricing";
import { flameVenueInputsFrom, resolveQuoteOffice } from "@/lib/service-quote-inputs";
import { sourceForSave } from "@/lib/portal-quote-mode";

/**
 * Flame-test quote mutations (server port of Flame Test Quote.dc.html
 * save()/approve()). The client builder previews pricing live; the source of
 * truth is here — we re-price server-side from the customer's venue coords +
 * the persisted rates so a saved quote's value always matches the engine.
 *
 * Margin / mileage / labor knobs mutate the global flametest rates blob,
 * exactly like the prototype's FlameTest.setRates before a save.
 */

type PostedVenue = {
  id: string;
  label: string;
  curtains: number;
  /** #217: the builder's typed Testing cell (null/absent = computed). */
  testingOverride?: number | string | null;
};

function quoteFailure(formData: FormData, message: string): never {
  const id = String(formData.get("editingId") || "");
  const qs = new URLSearchParams({ ...(id ? { id } : {}), err: message });
  redirect("/flame-tests/quote?" + qs.toString());
}

/** Re-price + persist a flame-test quote; returns the saved quote id. */
async function persist(formData: FormData): Promise<string | null> {
  const user = await requireUser();
  const editingId = String(formData.get("editingId") || "");
  const customerId = String(formData.get("customerId") || "");
  const quoteName = String(formData.get("quoteName") || "").trim();
  const replaces = String(formData.get("replaces") || "").trim();
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
  const venueInputs: FlameTestVenueInput[] = flameVenueInputsFrom(venues, cust);

  const office = await resolveQuoteOffice();

  const travelRates = await getTravelRates();
  // Flights over drive (spec 2026-09-25): the builder posts its Auto · Drive ·
  // Fly choice + crew/nights/airfare overrides as JSON; absent = auto.
  const travelOverride = parseTravelOverride(formData.get("travel"));
  // #217: a typed total (whole dollars, $1–$10,000,000) replaces the rounded
  // auto total exactly; the 5–50 clamp above bounds only the slider's margin.
  const priceOverride = normalizePriceOverride(formData.get("priceOverride"));
  // #217 fix wave: whether this typed total is only the D286 reopen-seed for
  // an old off-grid sent price — never something anyone actually typed — is
  // derived from the STORED quote, not a client-posted flag (a client can't
  // fake or drop it, and it agrees with itself across every reopen), so next
  // year's renewal draft never calls it "hand-set" (priorHandSetPrice).
  const existingForMarker = editingId ? await getQuote(editingId) : null;
  const existingFt = (existingForMarker?.flameTest ?? null) as
    | { priceOverride?: number | null; priceOverrideSeeded?: boolean }
    | null;
  const priceOverrideSeeded = deriveSeededMarker({
    postedOverride: priceOverride,
    stored: existingForMarker
      ? {
          value: existingForMarker.value,
          status: existingForMarker.status,
          priceOverride: existingFt?.priceOverride ?? null,
          priceOverrideSeeded: !!existingFt?.priceOverrideSeeded,
        }
      : null,
  });
  const r = compute(
    { office: office || undefined, venues: venueInputs, travel: travelOverride, priceOverride },
    rates,
    travelRates
  );

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
    name:
      quoteName ||
      `${venueInputs[0]?.label || custName} — Flame Test ${new Date().getFullYear()}`,
    customer: custName,
    customerId: customerId || null,
    locationId: venueInputs[0].id ?? null,
    value: Math.round(r.total),
    margin: r.effectiveMargin,
    pricingTier: tier.tier,
    tierMargin: tier.margin,
    // #246 Task 4 (spec §5): a portal-generated quote (source
    // "portal-service") keeps that source across a staff save — the same
    // rule the Estimator applies to portal-catalog (D416).
    source: sourceForSave(existingForMarker?.source, "flametest"),
    quoteType: "flame_test",
    // #242 final: the owner is set when the quote is CREATED (below) and kept
    // on every later save — the review limit follows the quote's owner, never
    // whoever saved it last.
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
        ...(v.testingOverride != null ? { testingOverride: v.testingOverride } : {}),
      })),
      curtainsTotal: r.curtainsTotal,
      trip: savedTrip(r.trip),
      ...(travelOverride ? { travel: travelOverride } : {}),
      rawCost: Math.round(r.rawCost),
      baseFee: Math.round(r.baseFee),
      baseApplied: r.baseApplied,
      cost: Math.round(r.cost),
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
    await retireReplacedDraftSafely(replaces, q.id, "flame-tests quote");
  }
  // #222: every save re-prints the proposal letter to the saved PDF.
  if (q) await scheduleQuotePdf(q.id);
  return (q && q.id) || editingId || null;
}

export async function saveFlameQuote(formData: FormData): Promise<void> {
  let id: string | null;
  try {
    id = await persist(formData);
  } catch (error) {
    // `persist()` opens with requireUser(), which sends an expired session to
    // /login BY throwing — a catch in the app directory must never eat that
    // (same first line as home-actions.ts’s stage-move catch).
    unstable_rethrow(error);
    console.error("saveFlameQuote: quote save failed", error);
    quoteFailure(formData, "Couldn’t save the flame-test quote — please try again.");
  }
  revalidatePath("/", "layout");
  if (id) redirect("/flame-tests/quote?id=" + encodeURIComponent(id) + "&saved=1");
}

export async function approveFlameQuote(formData: FormData): Promise<void> {
  let id: string | null;
  try {
    id = await persist(formData);
    if (!id) {
      revalidatePath("/", "layout");
      return;
    }
    await setStatus(id, "won", undefined, { bypassApprovalGate: "engine-owned-flow" });
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
      statusFailureMessage(error, "approveFlameQuote: quote approval failed", "Couldn’t approve the flame-test quote — please try again.")
    );
  }
  revalidatePath("/", "layout");
  redirect("/flame-tests/quote?id=" + encodeURIComponent(id) + "&approved=1");
}
