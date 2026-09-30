"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
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
import { resolveTier, serviceMarginFor } from "@/lib/pricing-tiers";
import { parseTravelOverride, savedTrip } from "@/lib/travel-plan";
import { deriveSeededMarker, normalizeLift, normalizePriceOverride, savedLift } from "@/lib/service-pricing";
import { settleServiceCreditFor } from "@/lib/stores/reward-ledger";
import { grossQuoteValue } from "@/lib/rewards/credit-line";
import { netServiceTotal } from "@/lib/rewards/service-credit";
import { flameVenueInputsFrom, getLiftRate, resolveQuoteOffice } from "@/lib/service-quote-inputs";
import { approveKeepsAcceptedPrice, sourceForSave } from "@/lib/portal-quote-mode";

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
async function persist(formData: FormData, out?: { creditNote?: string }): Promise<string | null> {
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
  const venueInputs: FlameTestVenueInput[] = flameVenueInputsFrom(venues, cust);

  const office = await resolveQuoteOffice();

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
  const existingFt = (existingForMarker?.flameTest ?? null) as
    | { priceOverride?: number | null; priceOverrideSeeded?: boolean }
    | null;
  const priceOverrideSeeded = deriveSeededMarker({
    postedOverride: priceOverride,
    stored: existingForMarker
      ? {
          // #282 phase 3: the pre-credit price — the builder's reopen-seed reads the same.
          value: grossQuoteValue(existingForMarker),
          status: existingForMarker.status,
          priceOverride: existingFt?.priceOverride ?? null,
          priceOverrideSeeded: !!existingFt?.priceOverrideSeeded,
        }
      : null,
  });
  const r = compute(
    { lift, office: office || undefined, venues: venueInputs, travel: travelOverride, priceOverride },
    rates,
    travelRates
  );

  // #282 phase 3 (spec §5): the Rewards credit applies AFTER the engine's
  // final total (the $25 rounding, a typed total and the lift are all in
  // r.total). Re-checked here against the company's available credit right
  // now — the posted amount is only ever clamped down; `create` is needed to
  // grow it; a won/lost quote keeps its own; a customer change drops it.
  const credit = await settleServiceCreditFor({
    posted: formData.get("rewardCredit"),
    total: Math.round(r.total),
    customerId: customerId || null,
    source: sourceForSave(existingForMarker?.source, "flametest"),
    mayApply: can("create", user.roles),
    prior: existingForMarker,
  });
  if (out && credit.notice) out.creditNote = credit.notice;

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
    // #282 phase 3: net of any Rewards credit (what the customer pays).
    value: netServiceTotal(r.total, credit.credit),
    margin: r.effectiveMargin,
    pricingTier: tier.tier,
    tierMargin: serviceMargin,
    // #248 Task 4 (spec §5): a portal-generated quote (source
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
      ...(r.lift ? { lift: savedLift(r.lift, r) } : {}),
      cost: Math.round(r.cost),
      marginAmount: Math.round(r.marginAmount),
      autoTotal: Math.round(r.autoTotal),
      ...(r.priceOverride != null ? { priceOverride: r.priceOverride } : {}),
      ...(r.priceOverride != null && priceOverrideSeeded ? { priceOverrideSeeded: true } : {}),
      total: Math.round(r.total),
      ...(credit.credit > 0 ? { rewardCredit: credit.credit } : {}),
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
  // #282 phase 3: set when the server clamped or dropped the Rewards credit.
  const note: { creditNote?: string } = {};
  try {
    id = await persist(formData, note);
  } catch (error) {
    // `persist()` opens with requireUser(), which sends an expired session to
    // /login BY throwing — a catch in the app directory must never eat that
    // (same first line as home-actions.ts’s stage-move catch).
    unstable_rethrow(error);
    console.error("saveFlameQuote: quote save failed", error);
    quoteFailure(formData, "Couldn’t save the flame-test quote — please try again.");
  }
  revalidatePath("/", "layout");
  if (id)
    redirect(
      "/flame-tests/quote?id=" + encodeURIComponent(id) + "&saved=1" + (note.creditNote ? "&credit=" + encodeURIComponent(note.creditNote) : "")
    );
}

export async function approveFlameQuote(formData: FormData): Promise<void> {
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
      statusFailureMessage(error, "approveFlameQuote: quote approval failed", "Couldn’t approve the flame-test quote — please try again.")
    );
  }
  revalidatePath("/", "layout");
  redirect("/flame-tests/quote?id=" + encodeURIComponent(id) + "&approved=1");
}
