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
import { locationById } from "@/lib/stores/customers";
import { getSettings, type AppSettingsData } from "@/lib/settings";
import { allUsers } from "@/lib/users";
import { firstName } from "@/lib/team";
import { AVG_MPH } from "@/lib/geo";
import {
  dataUrlBytes,
  jpegInfo,
  renderLetterPdf,
  type LetterBlock,
  type LetterDoc,
} from "@/lib/pdf";

/**
 * IDEAS #36 — one-click renewal outreach. The ✉ on a renewal row runs this:
 * this year's quote is minted from LAST YEAR'S PRICE VERBATIM (Jeff's call,
 * MASTER-QUESTIONS F8), the proposal letter is rendered to a real PDF and
 * attached, and a ready-to-send draft lands in the SALES shared mailbox,
 * linked to the renewal's job/record. The caller redirects to the Inbox with
 * the composer open; sending stamps the #37 renewalOutreach worklist state.
 *
 * Idempotent by design: the quote is keyed on `renewalOf` and the draft on
 * the thread link, so clicking ✉ twice re-opens the same draft — and an
 * AI-drafted renewal (the ✨ button, D1/D40) for the same job is upgraded in
 * place (PDF attached, link flagged) instead of duplicated.
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
  rates?: { curtainMinutes?: number } | null;
  total?: number | null;
};

/** This cycle's renewal quote for a completed flame job — reused when it
 *  already exists, otherwise minted at last year's price verbatim (F8). */
async function ensureFlameRenewalQuote(
  job: FlameJob,
  me: string
): Promise<Quote> {
  const existing = await byRenewalOf(job.id);
  if (existing && existing.quoteType === "flame_test") return existing;

  const prior = job.quoteId ? await getQuote(job.quoteId) : null;
  const priorFt =
    prior && prior.quoteType === "flame_test" && prior.flameTest
      ? (prior.flameTest as FlameTestDoc)
      : null;
  // seed-era jobs may predate their quote — reconstruct the subdoc from the job
  const ft: FlameTestDoc = priorFt || {
    venues: (job.venues || []).map((v) => ({
      id: v.id,
      label: v.label,
      curtains: v.curtains,
    })),
    curtainsTotal: job.curtainsTotal,
    contact: job.contact,
    origin: null,
    trip: null,
    rates: null,
    total: job.value,
  };
  const year = new Date().getFullYear();
  return createQuote({
    name: (job.customer || "Customer") + " — Flame test renewal " + year,
    customer: job.customer || prior?.customer || "",
    customerId: job.customerId || prior?.customerId || null,
    locationId: job.locationId || prior?.locationId || null,
    value: job.value || prior?.value || 0, // last year's price, verbatim (F8)
    margin: prior?.margin || 0,
    source: "flametest",
    quoteType: "flame_test",
    owner: me,
    contact: job.contact || prior?.contact || null,
    flameTest: ft,
    renewalOf: job.id,
  });
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

  const blocks: LetterBlock[] = [
    {
      kind: "p",
      text:
        `This proposal outlines the services ${companyName} would perform for the annual ` +
        `flame test at ${venueName} of roughly ${curtainsLabel}, per NFPA 705 — ` +
        `Recommended Practice for a Field Flame Test, outlined below:`,
    },
    {
      kind: "quote",
      text:
        "NFPA 705 §1.1.1: This recommended practice provides guidance to enforcement " +
        "officials for the field application of an open flame to textiles and films " +
        "that have been in use in the field or for which reliable laboratory data " +
        "are not available.",
    },
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
    const mph = AVG_MPH || 50;
    const oneWayHours = mph ? oneWayMiles / mph : 0;
    const curtainMin = (ft.rates && ft.rates.curtainMinutes) || 5;
    const inspectionHours = (curtainsTotal * curtainMin) / 60;
    blocks.push({
      kind: "p",
      text:
        `The distance from ${companyName} (${originCity}) to ${venueName} is ` +
        `approximately ${num1(oneWayMiles)} miles. Travel time is about ` +
        `${num1(oneWayHours)} hours each way, and the on-site testing should take ` +
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
    tag: "Flame Test Proposal",
    meta: [
      { label: "Date:", value: fmtDate(quote.createdAt) },
      { label: "Venue Name:", value: venueName, strong: true },
      { label: "Location:", value: locationLabel },
    ],
    re: `Flame Testing at ${venueName}`,
    greeting: contact?.name || "Sir or Madam",
    blocks,
    costLine: `The above services will cost ${money(quote.value != null ? quote.value : ft.total || 0)}.`,
    costTail: "Sales/Use taxes are not included.",
    taxNote:
      "Sales tax, if required, will be billed at the local sales tax rates in force " +
      "at the time of billing.",
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
  total?: number | null;
  contact?: FtContact;
};

/** This cycle's renewal quote for a completed inspection — reused when it
 *  already exists, otherwise minted at last year's price verbatim (F8),
 *  scoped to THIS record's venue + level (records are per-venue, D53). */
async function ensureInspectionRenewalQuote(
  rec: InspectionRecord,
  me: string
): Promise<Quote> {
  const existing = await byRenewalOf(rec.id);
  if (existing && existing.quoteType === "inspection") return existing;

  const prior = rec.quoteId ? await getQuote(rec.quoteId) : null;
  const priorIn =
    prior && prior.quoteType === "inspection" && prior.inspection
      ? (prior.inspection as InspectionDoc)
      : null;
  const priorVenues = priorIn?.venues || [];
  const singleVenuePrior = priorVenues.length === 1;

  const venue: InVenue = {
    id: rec.locationId,
    label: rec.venue || "Venue",
    lineSets: rec.lineSets || 0,
  };
  const insp: InspectionDoc = {
    level: rec.level || priorIn?.level || 1,
    scope: (priorIn?.scope || rec.scope || "").trim(),
    office: priorIn?.office || "",
    venues: [venue],
    lineSetsTotal: rec.lineSets || 0,
    // trip/hours only carry over when the prior quote WAS this single venue —
    // a multi-venue quote's travel math doesn't apportion per venue
    inspectHours: singleVenuePrior ? (priorIn?.inspectHours ?? null) : null,
    trip: singleVenuePrior ? (priorIn?.trip ?? null) : null,
    total: rec.value || 0,
    contact: rec.contact
      ? { name: rec.contact, role: "", email: rec.contactEmail || "" }
      : priorIn?.contact || null,
  };
  const lm = levelMeta(rec.level);
  const year = new Date().getFullYear();
  return createQuote({
    name:
      (rec.customer || "Customer") +
      " — " +
      lm.label +
      " inspection renewal " +
      year,
    customer: rec.customer || prior?.customer || "",
    customerId: rec.customerId || prior?.customerId || null,
    locationId: rec.locationId || null,
    value: rec.value || 0, // last year's venue share, verbatim (F8)
    margin: prior?.margin || 0,
    source: "inspection",
    quoteType: "inspection",
    owner: me,
    contact: insp.contact,
    inspection: insp,
    renewalOf: rec.id,
  });
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

  const blocks: LetterBlock[] = [
    {
      kind: "p",
      text:
        `This proposal outlines the services ${companyName} would perform for ` +
        `${cadence} at ${venueName}, covering roughly ${lineSetsLabel}, outlined below:`,
    },
    {
      kind: "quote",
      text:
        "A rigging inspection checks every accessible component of the system — " +
        "anything that leaves the ground — against current federal regulations and " +
        "theatrical industry standards (OSHA, NFPA, ANSI E1). Every finding is " +
        "documented in a written report, sorted Urgent / Necessary / Basic, with " +
        "photographs and recommended corrections.",
    },
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
    const mph = AVG_MPH || 50;
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
    costLine: `The above services will cost ${money(quote.value != null ? quote.value : insp.total || 0)}.`,
    costTail: "Sales/Use taxes are not included.",
    taxNote:
      "Sales tax, if required, will be billed at the local sales tax rates in force " +
      "at the time of billing.",
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
  copyIsOverride: boolean;
  attachment: CommAttachment;
  me: string;
}): Promise<string> {
  const existing = await findDraftByLink(opts.linkType, opts.linkId);
  if (existing) {
    // one renewal, one draft: refresh the quote PDF; adopt the copy only when
    // the caller supplied it (the ✨ AI path) — hand-edits are never clobbered
    await setDraftAttachments(existing.id, [opts.attachment]);
    if (opts.copyIsOverride)
      await updateDraft(existing.id, {
        subject: opts.copy.subject,
        body: opts.copy.body,
      });
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
 * `copy` overrides the built-in template (used by the ✨ AI draft path).
 */
export async function flameRenewalOutreach(
  jobId: string,
  me: string,
  copy?: Copy
): Promise<RenewalOutreachResult | null> {
  const job = await getFlameJob(jobId);
  if (!job || job.stage !== "completed") return null;

  const [quote, settings] = await Promise.all([
    ensureFlameRenewalQuote(job, me),
    getSettings(),
  ]);
  const pdf = renderLetterPdf(await flameLetterDoc(quote, settings));
  const attachment = pdfAttachment(
    "Flame-test-renewal-" + quote.id + ".pdf",
    pdf
  );

  const contact = job.contact || null;
  const customer = job.customer || "your venue";
  const lastLabel = monthYear(job.completedAt);
  const template: Copy = {
    subject: "Annual flame test renewal — " + (job.customer || ""),
    body:
      `Hi ${firstName(contact?.name || "") || "there"},\n\n` +
      `Our records show the annual flame test at ${customer}` +
      (job.venue ? ` (${job.venue})` : "") +
      (lastLabel ? ` was last performed in ${lastLabel}` : ` is coming due`) +
      `, which makes it due for renewal. Per NFPA 705 these tests are performed ` +
      `yearly to keep your curtains and soft goods compliant.\n\n` +
      `I've attached this year's quote` +
      (job.value > 0
        ? ` — we're holding it at last year's price of ${money(job.value)}`
        : ``) +
      `. If it looks good, just reply here and we'll get this year's test on ` +
      `the schedule.\n\n` +
      `Thanks,\n${firstName(me)}\n${settings.companyName || "Peak Systems Group"}`,
  };

  const threadId = await upsertRenewalDraft({
    linkType: "flame_job",
    linkId: job.id,
    linkLabel: (job.venue || customer) + " — renewal",
    customerId: job.customerId || null,
    customer: job.customer || "",
    contactName: contact?.name || "",
    to: contact?.email || "",
    copy: copy || template,
    copyIsOverride: !!copy,
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
  me: string,
  copy?: Copy
): Promise<RenewalOutreachResult | null> {
  const rec = await getInspection(recordId);
  if (!rec || rec.stage !== "completed") return null;

  const [quote, settings] = await Promise.all([
    ensureInspectionRenewalQuote(rec, me),
    getSettings(),
  ]);
  const pdf = renderLetterPdf(await inspectionLetterDoc(quote, settings));
  const attachment = pdfAttachment(
    "Rigging-inspection-renewal-" + quote.id + ".pdf",
    pdf
  );

  const lm = levelMeta(rec.level);
  const cadenceShort = lm.key === 2 ? "five-year Level 2" : "annual Level 1";
  const customer = rec.customer || "your venue";
  const template: Copy = {
    subject: lm.label + " rigging inspection renewal — " + (rec.customer || ""),
    body:
      `Hi ${firstName(rec.contact || "") || "there"},\n\n` +
      `Our records show the ${cadenceShort} rigging inspection at ` +
      `${customer}` +
      (rec.venue ? ` (${rec.venue})` : "") +
      ` is due for renewal.\n\n` +
      `I've attached this year's quote` +
      (rec.value > 0
        ? ` — we're holding it at last year's price of ${money(rec.value)}`
        : ``) +
      `. If it looks good, just reply here and we'll get this year's inspection ` +
      `on the schedule.\n\n` +
      `Thanks,\n${firstName(me)}\n${settings.companyName || "Peak Systems Group"}`,
  };

  const threadId = await upsertRenewalDraft({
    linkType: "inspection",
    linkId: rec.id,
    linkLabel: (rec.venue || customer) + " — renewal",
    customerId: rec.customerId || null,
    customer: rec.customer || "",
    contactName: rec.contact || "",
    to: rec.contactEmail || "",
    copy: copy || template,
    copyIsOverride: !!copy,
    attachment,
    me,
  });
  return { threadId, quoteId: quote.id };
}
