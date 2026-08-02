import {
  findDraftByLink,
  saveDraft,
  setDraftAttachments,
  setLink,
  updateDraft,
  type CommAttachment,
} from "@/lib/stores/comms";
import {
  byRenewalOf,
  create as createQuote,
  get as getQuote,
  type Quote,
} from "@/lib/stores/quotes";
import { get as getFlameJob, type FlameJob } from "@/lib/stores/flame-jobs";
import {
  get as getInspection,
  levelMeta,
  type InspectionRecord,
} from "@/lib/stores/inspections";
import { get as getCustomer, locationById } from "@/lib/stores/customers";
import { getSettings, type AppSettingsData } from "@/lib/settings";
import { allUsers } from "@/lib/users";
import { firstName } from "@/lib/team";
import { coordsOf, driveMiles, driveMinutes, nearest } from "@/lib/geo";
import { getTravelRates } from "@/lib/stores/pricing";
import {
  compute as computeFlame,
  getRates as getFlameRates,
  type FlameTestPricing,
  type FlameTestRates,
  type FlameTestVenueInput,
} from "@/lib/flametest-engine";
import {
  computeEstimate as computeInspection,
  getRates as getInspectionRates,
  type InspectionEstimate,
  type InspectionRates,
  type InspectionVenueInput,
} from "@/lib/inspection-engine";
import {
  dataUrlBytes,
  jpegInfo,
  renderLetterPdf,
  type LetterBlock,
  type LetterDoc,
} from "@/lib/pdf";
import { renderField } from "@/lib/templates";

/**
 * IDEAS #36 — one-click renewal outreach. The ✉ on a renewal row runs this:
 * this year's quote is RE-PRICED AT CURRENT RATES (Jeff's Jul-12 call,
 * updating the F8 default — see D69) from the same venue/scope data as last
 * year's job, the proposal letter is rendered to a real PDF and attached,
 * and a ready-to-send draft lands in the SALES shared mailbox, linked to the
 * renewal's job/record. The email body always cites LAST YEAR'S PRICE for
 * comparison, and when the number moved it says why — built by diffing the
 * rate snapshot stored on last year's quote against today's rates (plus
 * travel/scope changes). Internal knobs (margin) are never named to the
 * customer; they fall back to generic "current rates" phrasing. The caller
 * redirects to the Inbox with the composer open; sending stamps the #37
 * renewalOutreach worklist state.
 *
 * Idempotent by design: the quote is keyed on `renewalOf` and the draft on
 * the thread link, so clicking ✉ twice re-opens the same
 * draft with a freshly re-priced PDF (hand-edits preserved, D75).
 */

export type RenewalOutreachResult = { threadId: string; quoteId: string };

/* ---------------- shared display helpers ---------------- */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthYear(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return MONTHS[d.getMonth()] + " " + d.getFullYear();
}

function money(n: number | null | undefined): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

function num1(n: number | null | undefined): string {
  const v = Math.round((+(n || 0)) * 10) / 10;
  return v.toLocaleString("en-US", {
    minimumFractionDigits: v % 1 ? 1 : 0,
    maximumFractionDigits: 1,
  });
}

function fmtDate(ms: number | null | undefined): string {
  const d = ms ? new Date(ms) : new Date();
  return d.getMonth() + 1 + "/" + d.getDate() + "/" + d.getFullYear();
}

/** Rates need cents — money() rounds to whole dollars. */
function usd2(n: number | null | undefined): string {
  return "$" + (Math.round((n || 0) * 100) / 100).toFixed(2);
}

/** "a" · "a and b" · "a, b, and c". */
function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return items[0] + " and " + items[1];
  return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
}

/** What the ✉ flow learned while minting this year's quote — feeds the
 *  email's price-comparison sentence (D69). */
type RenewalPricing = {
  quote: Quote;
  /** Last year's price (0 = unknown, e.g. seed-era records). */
  lastPrice: number;
  /** Customer-safe phrases explaining a changed price (may be empty). */
  reasons: string[];
};

/**
 * The email's price paragraph: always cites last year's price when known,
 * and explains a change (or falls back to generic "current rates" wording
 * when the components can't be reconstructed).
 */
function priceParagraph(p: RenewalPricing, kind: string): string {
  const newPrice = p.quote.value || 0;
  const closing = ` If it looks good, just reply here and we'll get this year's ${kind} on the schedule.`;
  if (newPrice > 0 && p.lastPrice > 0) {
    if (newPrice === p.lastPrice)
      return (
        `I've attached this year's quote — ${money(newPrice)}, unchanged ` +
        `from last year.` + closing
      );
    const dir = newPrice > p.lastPrice ? "increase" : "decrease";
    const why = p.reasons.length ? listJoin(p.reasons) : "our current rates";
    return (
      `I've attached this year's quote — ${money(newPrice)}, compared with ` +
      `${money(p.lastPrice)} last year. The ${dir} reflects ${why}.` + closing
    );
  }
  if (newPrice > 0)
    return `I've attached this year's quote — ${money(newPrice)}.` + closing;
  return `I've attached this year's quote.` + closing;
}

/* ---------------- letterhead ---------------- */

/** JPEG letterhead for the PDF: the uploaded dark logo when it's a JPEG,
 *  else the baked-in Peak letterhead, else null (typographic fallback —
 *  same ladder the on-screen letters use, D59). PNG logos can't be embedded
 *  without a decoder (see lib/pdf.ts), so they fall to the baked sheet. */
async function letterheadJpeg(
  settings: AppSettingsData
): Promise<{ jpeg: Buffer | null; full: boolean }> {
  const logo = dataUrlBytes(settings.logoDark, "image/jpeg");
  if (logo && jpegInfo(logo)) return { jpeg: logo, full: false };
  try {
    const { readFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const file = path.join(
      process.cwd(),
      "src/app/(app)/flame-tests/letter/peak-letterhead.jpg"
    );
    const buf = await readFile(file);
    if (jpegInfo(buf)) return { jpeg: buf, full: true };
  } catch {
    // bundled deploys may not carry source assets — typographic fallback
  }
  return { jpeg: null, full: false };
}

/* ---------------- signature block ---------------- */

async function signerFor(
  owner: string
): Promise<{ name: string; title: string; email?: string }> {
  const users = await allUsers();
  const u = users.find((x) => x.name === owner) || null;
  return {
    name: owner,
    title: (u && u.roles && u.roles.length ? u.roles[0] : "") || "Estimator",
    email: (u && u.email) || undefined,
  };
}

/* ================= flame tests ================= */

type FtContact = { name?: string; role?: string; email?: string } | null;
type FtVenue = { id?: string | null; label?: string; curtains?: number };
type FlameTestDoc = {
  venues?: FtVenue[];
  curtainsTotal?: number | null;
  contact?: FtContact;
  origin?: { name?: string; street?: string; city?: string; state?: string; zip?: string } | null;
  trip?: { miles?: number; minutes?: number } | null;
  /** Rate snapshot the quote was priced with (persist saves r.rates). */
  rates?: Partial<FlameTestRates> | null;
  total?: number | null;
};

/** Customer-safe reasons why this year's flame price differs from last
 *  year's — diff of the rate snapshot stored on the prior quote vs today's
 *  rates, plus travel/scope movement. Margin changes stay generic (D69). */
function flameChangeReasons(
  priorFt: FlameTestDoc | null,
  r: FlameTestPricing
): string[] {
  const out: string[] = [];
  const old = priorFt?.rates || null;
  const cur = r.rates;
  let generic = false;
  if (old) {
    if (old.mileageRate != null && old.mileageRate !== cur.mileageRate)
      out.push(
        `the current federal mileage rate (${usd2(cur.mileageRate)}/mi, was ${usd2(old.mileageRate)})`
      );
    if (old.laborRate != null && old.laborRate !== cur.laborRate)
      out.push(
        `our current labor rate ($${cur.laborRate}/hr, was $${old.laborRate})`
      );
    if (old.curtainMinutes != null && old.curtainMinutes !== cur.curtainMinutes)
      out.push(
        `updated per-curtain testing time (${cur.curtainMinutes} min per curtain, was ${old.curtainMinutes})`
      );
    if (old.baseFee != null && old.baseFee !== cur.baseFee && r.baseApplied)
      out.push(
        `our minimum service fee ($${Math.round(cur.baseFee)}, was $${Math.round(old.baseFee)})`
      );
    if (old.margin != null && old.margin !== cur.margin) generic = true;
  } else {
    generic = true;
  }
  const oldMiles = priorFt?.trip?.miles;
  if (oldMiles != null && Math.abs(r.trip.miles - oldMiles) >= 2)
    out.push(
      `updated travel distance (${r.trip.miles} mi round trip, was ${Math.round(oldMiles)})`
    );
  const oldCurtains = priorFt?.curtainsTotal;
  if (oldCurtains != null && oldCurtains !== r.curtainsTotal)
    out.push(
      `the test now covering ${r.curtainsTotal} curtain${r.curtainsTotal === 1 ? "" : "s"} (was ${oldCurtains})`
    );
  if (generic && !out.length) return []; // → "our current rates" fallback
  if (generic) out.push("our updated pricing");
  return out;
}

/** This cycle's renewal quote for a completed flame job — reused when it
 *  already exists, otherwise RE-PRICED AT CURRENT RATES from last year's
 *  venue/curtain data (Jeff's Jul-12 call, D69; the email cites last year's
 *  price and the reasons for any change). */
async function ensureFlameRenewalQuote(
  job: FlameJob,
  me: string
): Promise<RenewalPricing> {
  const lastPrice = Math.round(job.value || 0);
  const existing = await byRenewalOf(job.id);
  if (existing && existing.quoteType === "flame_test")
    return { quote: existing, lastPrice, reasons: [] };

  const prior = job.quoteId ? await getQuote(job.quoteId) : null;
  const priorFt =
    prior && prior.quoteType === "flame_test" && prior.flameTest
      ? (prior.flameTest as FlameTestDoc)
      : null;

  // engine inputs: last year's venues + curtain counts, TODAY's directory
  // coords/travel numbers (job venues carry coords as a seed-era fallback)
  const srcVenues: FtVenue[] = priorFt?.venues?.length
    ? priorFt.venues
    : (job.venues || []).map((v) => ({
        id: v.id,
        label: v.label,
        curtains: v.curtains,
      }));
  const cust = job.customerId ? await getCustomer(job.customerId) : null;
  const locById = new Map((cust?.locations || []).map((l) => [l.id, l]));
  const jobVenueById = new Map(
    (job.venues || []).map((v) => [v.id ?? "", v])
  );
  const venueInputs: FlameTestVenueInput[] = srcVenues.map((v) => {
    const loc = v.id ? locById.get(v.id) : null;
    const jv = v.id ? jobVenueById.get(v.id) : null;
    const coords = loc
      ? coordsOf(loc)
      : jv && jv.lat != null
        ? { lat: jv.lat, lng: jv.lng }
        : null;
    return {
      id: v.id ?? null,
      label: v.label || loc?.label || "Venue",
      curtains: v.curtains,
      coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
      oneWayMiles: loc?.travelMiles ?? null,
      oneWayMin: loc?.travelMin ?? null,
    };
  });

  const settings = await getSettings();
  const offices = Array.isArray(settings.offices) ? settings.offices : [];
  const firstCoords =
    venueInputs.map((v) => v.coords).find((c) => c && c.lat != null) || null;
  const office =
    (firstCoords ? nearest(offices, firstCoords) : null) || offices[0] || null;

  const rates = await getFlameRates();
  const travelRates = await getTravelRates();
  const r = computeFlame(
    { office: office || undefined, venues: venueInputs },
    rates,
    travelRates
  );

  const origin = office
    ? {
        name: office.name || "",
        street: office.street || "",
        city: office.city || "",
        state: office.state || "",
        zip: office.zip || "",
      }
    : null;
  const contact = job.contact || prior?.contact || null;
  const year = new Date().getFullYear();
  const quote = await createQuote({
    name: (job.customer || "Customer") + " — Field Flame Inspection renewal " + year,
    customer: job.customer || prior?.customer || "",
    customerId: job.customerId || prior?.customerId || null,
    locationId: job.locationId || prior?.locationId || null,
    value: Math.round(r.total), // this year's price at current rates (D69)
    margin: r.margin,
    source: "flametest",
    quoteType: "flame_test",
    owner: me,
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
    renewalOf: job.id,
  });
  return { quote, lastPrice, reasons: flameChangeReasons(priorFt, r) };
}

/** The /flame-tests/letter proposal, composed for the PDF renderer. */
async function flameLetterDoc(
  quote: Quote,
  settings: AppSettingsData
): Promise<LetterDoc> {
  const companyName = settings.companyName || "Peak Systems Group";
  const ft = (quote.flameTest as FlameTestDoc) || {};

  const offices = Array.isArray(settings.offices) ? settings.offices : [];
  let origin = ft.origin;
  if (!origin || !(origin.city || origin.street)) {
    const o = offices[0] || ({} as (typeof offices)[number]);
    origin = { name: o.name || "", city: o.city || "", state: o.state || "" };
  }
  const originCity = origin.city || origin.name || "our office";
  const venueName = quote.customer || "the venue";

  const venues = ft.venues || [];
  const locList = await Promise.all(
    venues.map(async (v) => {
      let city = "";
      let state = "";
      if (quote.customerId) {
        const loc = await locationById(quote.customerId, v.id ?? null);
        if (loc) {
          city = loc.city || "";
          state = loc.state || "";
        }
      }
      return {
        label: v.label || "Venue",
        place: [city, state].filter(Boolean).join(", "),
        curtains: +(v.curtains || 0) || 0,
      };
    })
  );
  const single = locList.length === 1;
  const locationLabel = single
    ? locList[0]?.place || locList[0]?.label || "—"
    : locList.length + " venues";

  const curtainsTotal =
    ft.curtainsTotal != null
      ? ft.curtainsTotal
      : venues.reduce((a, v) => a + (+(v.curtains || 0) || 0), 0);
  const curtainsLabel =
    curtainsTotal + " curtain" + (curtainsTotal === 1 ? "" : "s");

  const ov = settings.templates;
  const blocks: LetterBlock[] = [
    {
      kind: "p",
      text: renderField(ov, "flame_proposal", "intro", {
        company: companyName,
        venue: venueName,
        curtainsLabel,
      }),
    },
    { kind: "quote", text: renderField(ov, "flame_proposal", "methodQuote", {}) },
  ];
  if (locList.length > 1) {
    blocks.push({
      kind: "bullets",
      heading: "Venues included",
      items: locList.map(
        (v) =>
          v.label +
          (v.place ? " — " + v.place : "") +
          " · " +
          v.curtains +
          " curtain" +
          (v.curtains === 1 ? "" : "s")
      ),
    });
  }
  const rtMiles = (ft.trip && ft.trip.miles) || 0;
  if (rtMiles > 0) {
    const oneWayMiles = rtMiles / 2;
    const mph = (await getTravelRates()).mph || 50;
    const oneWayHours = mph ? oneWayMiles / mph : 0;
    const curtainMin = (ft.rates && ft.rates.curtainMinutes) || 5;
    const inspectionHours = (curtainsTotal * curtainMin) / 60;
    blocks.push({
      kind: "p",
      text:
        `The distance from ${companyName} (${originCity}) to ${venueName} is ` +
        `approximately ${num1(oneWayMiles)} miles. Travel time is about ` +
        `${num1(oneWayHours)} hours each way, and the on-site inspection should take ` +
        `approximately ${num1(inspectionHours)} hours — for a total of roughly ` +
        `${num1(2 * oneWayHours + inspectionHours)} hours for the visit.`,
    });
  }

  const contact = (quote.contact as FtContact) || ft.contact || null;
  const head = await letterheadJpeg(settings);
  return {
    companyName,
    accent: settings.accent || "#7b3f8a",
    headerJpeg: head.jpeg,
    headerFull: head.full,
    tag: "Field Flame Inspection Proposal",
    meta: [
      { label: "Date:", value: fmtDate(quote.createdAt) },
      { label: "Venue Name:", value: venueName, strong: true },
      { label: "Location:", value: locationLabel },
    ],
    re: `Field Flame Inspection at ${venueName}`,
    greeting: contact?.name || "Sir or Madam",
    blocks,
    costLine: renderField(
      ov,
      "flame_proposal",
      rtMiles > 0 ? "priceLine" : "priceLineNoTravel",
      {
        curtainsLabel,
        price: money(quote.value != null ? quote.value : ft.total || 0),
      }
    ),
    costTail: renderField(ov, "flame_proposal", "costTail", {}),
    taxNote: renderField(ov, "flame_proposal", "taxNote", {}),
    signer: await signerFor(quote.owner || "Jeff Chesebro"),
  };
}

/* ================= inspections ================= */

type InVenue = { id?: string | null; label?: string; lineSets?: number };
type InspectionDoc = {
  level?: number;
  scope?: string;
  office?: string;
  venues?: InVenue[];
  lineSetsTotal?: number | null;
  inspectHours?: number | null;
  trip?: { miles?: number; minutes?: number } | null;
  /** Rate snapshot the quote was priced with (persist saves r.rates). */
  rates?: Partial<InspectionRates> | null;
  total?: number | null;
  contact?: FtContact;
};

/** Customer-safe reasons why this year's inspection price differs — rate
 *  snapshot diff + travel/scope movement; margin stays generic (D69). */
function inspectionChangeReasons(
  priorIn: InspectionDoc | null,
  r: InspectionEstimate,
  venueLabel: string
): string[] {
  const out: string[] = [];
  const old = priorIn?.rates || null;
  const cur = r.rates;
  let generic = false;
  if (old) {
    if (old.laborRate != null && old.laborRate !== cur.laborRate)
      out.push(
        `our current labor rate ($${cur.laborRate}/hr, was $${old.laborRate})`
      );
    if (old.mileageRate != null && old.mileageRate !== cur.mileageRate)
      out.push(
        `the current federal mileage rate (${usd2(cur.mileageRate)}/mi, was ${usd2(old.mileageRate)})`
      );
    if (old.lineSetMinutes != null && old.lineSetMinutes !== cur.lineSetMinutes)
      out.push(
        `updated per-line-set inspection time (${cur.lineSetMinutes} min, was ${old.lineSetMinutes})`
      );
    if (old.baseHours != null && old.baseHours !== cur.baseHours)
      out.push(
        `updated base on-site time (${cur.baseHours} hr per visit, was ${old.baseHours})`
      );
    if (
      r.level === 2 &&
      old.level2Mult != null &&
      old.level2Mult !== cur.level2Mult
    )
      out.push(`an updated five-year in-depth factor`);
    if (old.minFee != null && old.minFee !== cur.minFee && r.minApplied)
      out.push(
        `our minimum service fee ($${Math.round(cur.minFee)}, was $${Math.round(old.minFee)})`
      );
    if (old.margin != null && old.margin !== cur.margin) generic = true;
  } else {
    generic = true;
  }
  // a multi-venue prior quote shared one trip; this quote prices the venue
  // on its own — that alone moves the number, so say it plainly
  const priorVenueCount = priorIn?.venues?.length || 0;
  if (priorVenueCount > 1)
    out.push(
      `last year's visit combining ${priorVenueCount} venues on one trip — this quote covers ${venueLabel} on its own`
    );
  const oldLineSets = priorIn?.lineSetsTotal;
  if (
    priorVenueCount === 1 &&
    oldLineSets != null &&
    oldLineSets !== r.lineSetsTotal
  )
    out.push(
      `the inspection now covering ${r.lineSetsTotal} line set${r.lineSetsTotal === 1 ? "" : "s"} (was ${oldLineSets})`
    );
  const oldMiles = priorVenueCount === 1 ? priorIn?.trip?.miles : null;
  if (oldMiles != null && Math.abs(r.trip.miles - oldMiles) >= 2)
    out.push(
      `updated travel distance (${r.trip.miles} mi round trip, was ${Math.round(oldMiles)})`
    );
  if (generic && !out.length) return []; // → "our current rates" fallback
  if (generic) out.push("our updated pricing");
  return out;
}

/** This cycle's renewal quote for a completed inspection — reused when it
 *  already exists, otherwise RE-PRICED AT CURRENT RATES (D69) for THIS
 *  record's venue + level (records are per-venue, D53). */
async function ensureInspectionRenewalQuote(
  rec: InspectionRecord,
  me: string
): Promise<RenewalPricing> {
  const lastPrice = Math.round(rec.value || 0);
  const existing = await byRenewalOf(rec.id);
  if (existing && existing.quoteType === "inspection")
    return { quote: existing, lastPrice, reasons: [] };

  const prior = rec.quoteId ? await getQuote(rec.quoteId) : null;
  const priorIn =
    prior && prior.quoteType === "inspection" && prior.inspection
      ? (prior.inspection as InspectionDoc)
      : null;

  // engine input: this venue only, TODAY's directory coords/travel numbers
  const cust = rec.customerId ? await getCustomer(rec.customerId) : null;
  const loc = rec.locationId
    ? (cust?.locations || []).find((l) => l.id === rec.locationId) || null
    : null;
  const coords = loc ? coordsOf(loc) : null;
  const venueInput: InspectionVenueInput & { id: string | null } = {
    id: rec.locationId || null,
    label: rec.venue || loc?.label || "Venue",
    lineSets: Math.max(0, Math.round(Number(rec.lineSets) || 0)),
    coords: coords ? { lat: coords.lat, lng: coords.lng } : null,
    oneWayMiles: loc?.travelMiles ?? null,
    oneWayMin: loc?.travelMin ?? null,
  };

  const settings = await getSettings();
  const offices = Array.isArray(settings.offices) ? settings.offices : [];
  const office =
    (coords ? nearest(offices, coords) : null) || offices[0] || null;

  const level = levelMeta(rec.level).key;
  const rates = await getInspectionRates();
  const travelRates = await getTravelRates();
  const r = computeInspection(
    {
      office: office || undefined,
      venues: [venueInput],
      level,
      geo: {
        driveMiles: (a, b) => driveMiles(a, b, travelRates),
        driveMinutes: (a, b) => driveMinutes(a, b, travelRates),
      },
    },
    rates
  );

  const contact: FtContact = rec.contact
    ? { name: rec.contact, role: "", email: rec.contactEmail || "" }
    : priorIn?.contact || null;
  const lm = levelMeta(rec.level);
  const year = new Date().getFullYear();
  const quote = await createQuote({
    name:
      (rec.customer || "Customer") +
      " — " +
      lm.label +
      " inspection renewal " +
      year,
    customer: rec.customer || prior?.customer || "",
    customerId: rec.customerId || prior?.customerId || null,
    locationId: rec.locationId || null,
    value: Math.round(r.total), // this year's price at current rates (D69)
    margin: r.margin,
    source: "inspection",
    quoteType: "inspection",
    owner: me,
    contact,
    inspection: {
      rates: r.rates,
      office: office ? office.name || office.id || "" : "",
      level,
      scope: (priorIn?.scope || rec.scope || "").trim(),
      venues: [
        { id: venueInput.id, label: venueInput.label, lineSets: venueInput.lineSets },
      ],
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
    renewalOf: rec.id,
  });
  return {
    quote,
    lastPrice,
    reasons: inspectionChangeReasons(priorIn, r, venueInput.label || "this venue"),
  };
}

/** The /inspections/letter proposal, composed for the PDF renderer. */
async function inspectionLetterDoc(
  quote: Quote,
  settings: AppSettingsData
): Promise<LetterDoc> {
  const companyName = settings.companyName || "Peak Systems Group";
  const insp = (quote.inspection as InspectionDoc) || {};
  const lm = levelMeta(insp.level);
  const cadence =
    lm.key === 2
      ? "an in-depth Level 2 rigging inspection, performed every five years"
      : "the annual Level 1 rigging inspection";
  const venueName = quote.customer || "the venue";

  const venues = insp.venues || [];
  const locList = await Promise.all(
    venues.map(async (v) => {
      let city = "";
      let state = "";
      if (quote.customerId) {
        const loc = await locationById(quote.customerId, v.id ?? null);
        if (loc) {
          city = loc.city || "";
          state = loc.state || "";
        }
      }
      return {
        label: v.label || "Venue",
        place: [city, state].filter(Boolean).join(", "),
        lineSets: +(v.lineSets || 0) || 0,
      };
    })
  );
  const single = locList.length === 1;
  const locationLabel = single
    ? locList[0]?.place || locList[0]?.label || "—"
    : locList.length + " venues";
  const lineSetsTotal =
    insp.lineSetsTotal != null
      ? insp.lineSetsTotal
      : venues.reduce((a, v) => a + (+(v.lineSets || 0) || 0), 0);
  const lineSetsLabel =
    lineSetsTotal + " line set" + (lineSetsTotal === 1 ? "" : "s");
  const scope = (insp.scope || "").trim();

  const ov = settings.templates;
  const blocks: LetterBlock[] = [
    {
      kind: "p",
      text: renderField(ov, "inspection_proposal", "intro", {
        company: companyName,
        venue: venueName,
        cadence,
      }),
    },
    { kind: "quote", text: renderField(ov, "inspection_proposal", "standardsQuote", {}) },
  ];
  if (scope) blocks.push({ kind: "p", text: "Scope: " + scope });
  if (locList.length > 1) {
    blocks.push({
      kind: "bullets",
      heading: "Venues included",
      items: locList.map(
        (v) =>
          v.label +
          (v.place ? " — " + v.place : "") +
          " · " +
          v.lineSets +
          " line set" +
          (v.lineSets === 1 ? "" : "s")
      ),
    });
  }
  const rtMiles = (insp.trip && insp.trip.miles) || 0;
  if (rtMiles > 0) {
    const oneWayMiles = rtMiles / 2;
    const mph = (await getTravelRates()).mph || 50;
    const oneWayHours = mph ? oneWayMiles / mph : 0;
    const inspectHours = insp.inspectHours || 0;
    blocks.push({
      kind: "p",
      text:
        `The distance from ${companyName} (${insp.office || "our office"}) to ` +
        `${venueName} is approximately ${num1(oneWayMiles)} miles. Travel time is ` +
        `about ${num1(oneWayHours)} hours each way, and the on-site inspection ` +
        `should take approximately ${num1(inspectHours)} hours — for a total of ` +
        `roughly ${num1(2 * oneWayHours + inspectHours)} hours for the visit.`,
    });
  }

  const contact = (quote.contact as FtContact) || insp.contact || null;
  const head = await letterheadJpeg(settings);
  return {
    companyName,
    accent: settings.accent || "#7b3f8a",
    headerJpeg: head.jpeg,
    headerFull: head.full,
    tag: "Rigging Inspection Proposal",
    tagNote: "· " + lm.long,
    meta: [
      { label: "Date:", value: fmtDate(quote.createdAt) },
      { label: "Venue Name:", value: venueName, strong: true },
      { label: "Location:", value: locationLabel },
    ],
    re: `Rigging Inspection at ${venueName}`,
    greeting: contact?.name || "Sir or Madam",
    blocks,
    costLine: renderField(
      ov,
      "inspection_proposal",
      rtMiles > 0 ? "priceLine" : "priceLineNoTravel",
      {
        lineSetsLabel,
        price: money(quote.value != null ? quote.value : insp.total || 0),
      }
    ),
    costTail: renderField(ov, "inspection_proposal", "costTail", {}),
    taxNote: renderField(ov, "inspection_proposal", "taxNote", {}),
    signer: await signerFor(quote.owner || "Jeff Chesebro"),
  };
}

/* ================= the one-click flows ================= */

function pdfAttachment(name: string, bytes: Buffer): CommAttachment {
  return {
    name,
    mime: "application/pdf",
    size: bytes.length,
    dataUrl: "data:application/pdf;base64," + bytes.toString("base64"),
  };
}

type Copy = { subject: string; body: string };

/** Land (or refresh) the renewal draft and return its thread id. */
async function upsertRenewalDraft(opts: {
  linkType: "flame_job" | "inspection";
  linkId: string;
  linkLabel: string;
  customerId: string | null;
  customer: string;
  contactName: string;
  to: string;
  copy: Copy;
  attachment: CommAttachment;
  me: string;
}): Promise<string> {
  const existing = await findDraftByLink(opts.linkType, opts.linkId);
  if (existing) {
    // one renewal, one draft: refresh the quote PDF but never touch the
    // subject/body — template copy is written only on first creation, so
    // hand-edits to an existing draft are never clobbered (D75)
    await setDraftAttachments(existing.id, [opts.attachment]);
    if (!existing.link?.renewal)
      await setLink(existing.id, {
        type: opts.linkType,
        id: opts.linkId,
        label: existing.link?.label || opts.linkLabel,
        renewal: true,
      });
    return existing.id;
  }
  const thread = await saveDraft({
    mailbox: "sales",
    customerId: opts.customerId,
    customer: opts.customer,
    contactName: opts.contactName,
    to: opts.to,
    subject: opts.copy.subject,
    body: opts.copy.body,
    link: {
      type: opts.linkType,
      id: opts.linkId,
      label: opts.linkLabel,
      renewal: true,
    },
    attachments: [opts.attachment],
    me: opts.me,
  });
  return thread.id;
}

/**
 * ✉ one-click flame-test renewal outreach (IDEAS #36). Returns the draft
 * thread + quote ids, or null when the job isn't a completed renewal anchor.
 */
export async function flameRenewalOutreach(
  jobId: string,
  me: string
): Promise<RenewalOutreachResult | null> {
  const job = await getFlameJob(jobId);
  if (!job || job.stage !== "completed") return null;

  const [pricing, settings] = await Promise.all([
    ensureFlameRenewalQuote(job, me),
    getSettings(),
  ]);
  const quote = pricing.quote;
  const pdf = renderLetterPdf(await flameLetterDoc(quote, settings));
  const attachment = pdfAttachment(
    "Field-flame-inspection-renewal-" + quote.id + ".pdf",
    pdf
  );

  const contact = job.contact || null;
  const customer = job.customer || "your venue";
  const lastLabel = monthYear(job.completedAt);
  const ov = settings.templates;
  const template: Copy = {
    subject: renderField(ov, "flame_renewal_email", "subject", {
      customer: job.customer || "",
    }),
    body: renderField(ov, "flame_renewal_email", "body", {
      contactFirstName: firstName(contact?.name || "") || "there",
      customer,
      venueSuffix: job.venue ? ` (${job.venue})` : "",
      lastPerformedClause: lastLabel
        ? `was last performed in ${lastLabel}`
        : "is coming due",
      priceParagraph: priceParagraph(pricing, "inspection"),
      senderFirstName: firstName(me),
      company: settings.companyName || "Peak Systems Group",
    }),
  };

  const threadId = await upsertRenewalDraft({
    linkType: "flame_job",
    linkId: job.id,
    linkLabel: (job.venue || customer) + " — renewal",
    customerId: job.customerId || null,
    customer: job.customer || "",
    contactName: contact?.name || "",
    to: contact?.email || "",
    copy: template,
    attachment,
    me,
  });
  return { threadId, quoteId: quote.id };
}

/**
 * ✉ one-click inspection renewal outreach (IDEAS #36) — the L1/L2 mirror of
 * the flame flow (cadence per D54).
 */
export async function inspectionRenewalOutreach(
  recordId: string,
  me: string
): Promise<RenewalOutreachResult | null> {
  const rec = await getInspection(recordId);
  if (!rec || rec.stage !== "completed") return null;

  const [pricing, settings] = await Promise.all([
    ensureInspectionRenewalQuote(rec, me),
    getSettings(),
  ]);
  const quote = pricing.quote;
  const pdf = renderLetterPdf(await inspectionLetterDoc(quote, settings));
  const attachment = pdfAttachment(
    "Rigging-inspection-renewal-" + quote.id + ".pdf",
    pdf
  );

  const lm = levelMeta(rec.level);
  const cadenceShort = lm.key === 2 ? "five-year Level 2" : "annual Level 1";
  const customer = rec.customer || "your venue";
  const ov = settings.templates;
  const template: Copy = {
    subject: renderField(ov, "inspection_renewal_email", "subject", {
      levelLabel: lm.label,
      customer: rec.customer || "",
    }),
    body: renderField(ov, "inspection_renewal_email", "body", {
      contactFirstName: firstName(rec.contact || "") || "there",
      customer,
      venueSuffix: rec.venue ? ` (${rec.venue})` : "",
      cadenceShort,
      priceParagraph: priceParagraph(pricing, "inspection"),
      senderFirstName: firstName(me),
      company: settings.companyName || "Peak Systems Group",
    }),
  };

  const threadId = await upsertRenewalDraft({
    linkType: "inspection",
    linkId: rec.id,
    linkLabel: (rec.venue || customer) + " — renewal",
    customerId: rec.customerId || null,
    customer: rec.customer || "",
    contactName: rec.contact || "",
    to: rec.contactEmail || "",
    copy: template,
    attachment,
    me,
  });
  return { threadId, quoteId: quote.id };
}
