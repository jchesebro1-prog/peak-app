"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import {
  create,
  get,
  getAll,
  checkApprovalGate,
  isApprovalGateRefusal,
  retireReplacedDraftSafely,
  setStatus,
  setQuoteStage,
  setQuotePipeline,
  statusFailureMessage,
  resolveSaveStatusChange,
  STAGES,
  update,
  type Quote,
  type QuoteReview,
  type QuoteStatus,
} from "@/lib/stores/quotes";
import { travelForId } from "@/lib/stores/customers";
import { clearPricedPor, sourceForSave } from "@/lib/portal-quote-mode";
import { declinePortalAcceptance } from "@/lib/portal-quotes";
import type { QuoteLite, TravelLite } from "./types";
import { withSanitizedKeyProducts } from "./narrative";
import { COVER_SUMMARY_MAX, NOT_INCLUDED_MAX, cleanPlainText, withSanitizedOutputFields } from "@/lib/estimate-output/fields";
import type { DraftedLine } from "./ai-scope-modal";
import { get as getSurvey, type SurveyRecord } from "@/lib/stores/surveys";
import {
  get as getInspection,
  type InspectionRecord,
} from "@/lib/stores/inspections";
import { get as catalogGet, list as catalogList, mergeUpsert } from "@/lib/stores/catalog";
import { copySectionForTarget } from "./copy-system";
import { normalizeSystemOrder, sanitizeGroups, sanitizeSectionGroupMeta, withoutGroupMeta, type SystemGroup } from "@/lib/estimate-groups/groups";
import { copyPricingFor } from "./copy-pricing";
import { seedMarginOf, usableTierMargin } from "./tier-reprice";
import type { CatalogSearch, PaymentTerms, SpecMob, SpecSection, VendorQuote } from "./types";
import { blobEnabled, dataUrlToBytes, putBlob, safeName } from "@/lib/blob";
import { VENDOR_QUOTE_BLOB_PREFIX, ownsVendorQuoteBlobPath } from "@/lib/vendor-quote-file";
import { reconcileEstimatorValue, sanitizeSystemSell, totals } from "./pricing";
import {
  maxApplicableCredit,
  quoteRewardCredit,
  rewardCreditOf,
  sanitizeRewardCredit,
  withoutRewardCredit,
  withRewardCredit,
} from "@/lib/rewards/credit-line";
import { companyCredit } from "@/lib/stores/reward-ledger";
import { normalizePdfOptions, type QuotePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";
import type { QuotePdfView } from "@/lib/quote-pdf/state";
import { activeUsers } from "@/lib/users";
import { displayQuoteNumber, quoteSearchRank } from "@/lib/estimate-number";
import { PRICING_TIER_LABEL } from "@/lib/identity/config";
import { quoteNextStepFor } from "@/lib/quote-next-step-server";
import type { QuoteNextStepView } from "@/lib/quote-next-step";
import { isFabricPart } from "@/lib/fabric-part";
import { rackFactsOrUndefined } from "@/lib/rack/part-facts";
import { setQuotePeopleAs } from "@/lib/quote-people";
import { partSearchHaystack } from "@/lib/catalog-rename/sku";
import { quoteSpecFollowingRenames } from "@/lib/stores/catalog-renames";

export async function saveEstimatorCustomPartAction(input: {
  sku: string;
  desc: string;
  category: string;
  unit: string;
  cost: number;
  list: number;
  mfr: string;
  manufacturerPartNumber: string;
  priceGoodThrough: string;
}): Promise<{ ok: true; sku: string } | { ok: false; error: string }> {
  await requireUser();
  const sku = input.sku.trim();
  const desc = input.desc.trim();
  if (!sku || sku.toUpperCase() === "CUSTOM") return { ok: false, error: "A catalog SKU is required." };
  if (!desc || !Number.isFinite(input.cost) || input.cost < 0 || !Number.isFinite(input.list) || input.list <= 0) {
    return { ok: false, error: "Catalog parts need a description, cost, and sell price." };
  }
  /* #302: mergeUpsert MERGES OVER a live part with this SKU — never let a
     custom part silently rewrite a real one. (A soft-deleted SKU reads null,
     so re-creating one is fine.) */
  if (await catalogGet(sku)) {
    return {
      ok: false,
      error: `${sku} is already in the catalog \u2014 add it with "+ Add part from catalog", or use a different SKU.`,
    };
  }
  await mergeUpsert(sku, {
    desc,
    category: input.category.trim() || "Custom Parts",
    unit: input.unit.trim() || "ea",
    cost: input.cost,
    list: input.list,
    mfr: input.mfr.trim() || undefined,
    manufacturerPartNumber: input.manufacturerPartNumber.trim() || undefined,
    note: input.priceGoodThrough ? `Price good through ${input.priceGoodThrough}` : undefined,
  });
  revalidatePath("/catalog");
  return { ok: true, sku };
}
import {
  createTask,
  setTaskStatus as setTaskStatusStore,
  updateTask as updateTaskStore,
  removeTask as removeTaskStore,
  STATUSES as TASK_STATUSES,
  type TaskStatus,
} from "@/lib/stores/tasks";
import { applyTaskTemplate } from "@/lib/stores/task-templates";

/**
 * Estimator server actions — thin, session-gated wrappers over the quotes
 * store (the prototype called window.QuoteStore directly). The estimator
 * writes the prototype's exact payload field names; `contactName` and
 * `quoteNote` ride along on the quote doc exactly as they did in the
 * prototype (the Quote type doesn't promote them — spec/unknown fields
 * round-trip through the doc store).
 */

/** Quote doc fields the estimator writes beyond the promoted Quote columns. */
type QuoteExtras = {
  contactName?: string;
  quoteNote?: string;
  assumptions?: string;
  paymentTerms?: PaymentTerms;
  spec?: { sections: SpecSection[]; mobs: SpecMob[]; groups?: SystemGroup[] };
  /** #143: top-level, NOT inside `spec` — the attachment proxy route reads
   *  `quote.vendorQuotes`, and file bytes buried in `spec` would be copied
   *  into every revision snapshot. */
  vendorQuotes?: VendorQuote[];
};

type QuotePatch = Partial<Quote> & QuoteExtras;

export type SavePayload = {
  name: string;
  customer: string;
  customerId: string | null;
  locationId: string | null;
  contactName: string;
  quoteNote: string;
  assumptions: string;
  installTimeframe: string;
  paymentTerms: PaymentTerms;
  /** User-named quote category (#110); "" clears it. */
  category: string;
  value: number;
  margin: number;
  status: QuoteStatus;
  /** #180 review — the status this tab last received FROM THE SERVER (a
   *  page load, or a prior save/status-change response), never touched by
   *  an optimistic local update. `status` above is what the user currently
   *  sees, which can differ from this for two different reasons — a
   *  genuine, not-yet-confirmed change THIS tab made, or a stale tab that
   *  hasn't heard about a change made ELSEWHERE. saveQuoteAction tells them
   *  apart by also comparing against the server's actual current status. */
  baseStatus: QuoteStatus;
  sections: SpecSection[];
  mobs: SpecMob[];
  /** Phase 2a: the named system groups. Optional — an older caller that omits it keeps the stored groups. */
  groups?: SystemGroup[];
  /** Always sent in full (#143) — the stored list is replaced, so removing a
   *  vendor quote in the builder actually removes it from the doc. */
  vendorQuotes: VendorQuote[];
  /** #222 — the preview's Show-on-PDF choices; the saved PDF prints with them. */
  pdfOptions: QuotePdfOptions;
  /** #301 — the cover fields (R14). Optional so an older caller saves as before. */
  coverSummary?: string;
  notIncluded?: string;
  /** #160 / D205 — sent on the create save only: the draft this quote replaces. */
  replaces?: string;
};

export type SaveResult = {
  ok: boolean;
  id: string | null;
  /** #223 — the saved quote's estimate number, for the header (null when nothing was saved). */
  number: string | null;
  revNum: number;
  updatedAt: number;
  review: QuoteReview | null;
  status: QuoteStatus | null;
  /** Daylite stage bar (Task 6) — a brand-new quote is created with no id
   *  (and so no stage bar) until this save returns; these let the client
   *  show the right stage highlighted immediately, with no extra round trip. */
  pipelineId: string | null;
  stage: string | null;
  /** What was actually stored (#143) — attachments moved into Blob storage
   *  come back as blobPath so the next save doesn't re-upload the bytes. */
  vendorQuotes?: VendorQuote[];
  /** Set on `ok: false` when the record was created but a requested status
   *  transition was refused (punch #60: setStatus's approval gate). */
  error?: string;
  /** Set on `ok: true` (review round 3) — an informational note the user
   *  should see even though nothing failed: a stale tab's status display
   *  was refreshed because someone else moved it elsewhere, but this save
   *  never asked to change status itself, so it's not an error. */
  notice?: string;
  /** #222 — the saved PDF's state after this save (pending when a render was scheduled). */
  pdf?: QuotePdfView | null;
  /** #284 — the next-step view after this save (a first save is what makes
   *  the control appear; an edit can clear an approval). */
  next?: QuoteNextStepView | null;
  /** #282 phase 2 — the Rewards credit actually stored (after the server's
   *  clamp), so the builder can match its credit line to it. */
  rewardCredit?: number;
};

export type ReviewSync = {
  ok: boolean;
  review: QuoteReview | null;
  status: QuoteStatus | null;
  /** Set on `ok: false` — a typed, UI-displayable reason (punch #60: never a
   *  raw thrown exception for an expected rejection like "not yet approved"). */
  error?: string;
  /** #284 — the next-step control's view, re-evaluated for this viewer. */
  next?: QuoteNextStepView | null;
  /** #284 — set on `ok: false` when the approval gate itself refused, so the
   *  banner can offer the next step (Submit for approval) right there. */
  gateRefused?: boolean;
};

function refresh() {
  revalidatePath("/", "layout");
}

async function syncOf(id: string, user: { name: string; roles: string[] }): Promise<ReviewSync> {
  const q = await get(id);
  return {
    ok: !!q,
    review: q?.review ?? null,
    status: q?.status ?? null,
    next: q ? await quoteNextStepFor(q, user) : null,
  };
}

/** Client-callable twin of ReviewSync for the Daylite stage bar (Task 6) — the
 *  estimator's useTransition callers need the pipeline fields back too. */
export type StageSync = {
  ok: boolean;
  status: QuoteStatus | null;
  review: QuoteReview | null;
  pipelineId: string | null;
  stage: string | null;
  error?: string;
  /** #284 — see ReviewSync.next / gateRefused. */
  next?: QuoteNextStepView | null;
  gateRefused?: boolean;
};

async function stageSyncOf(id: string, user: { name: string; roles: string[] }): Promise<StageSync> {
  const q = await get(id);
  return {
    ok: !!q,
    status: q?.status ?? null,
    review: q?.review ?? null,
    pipelineId: q?.pipelineId ?? null,
    stage: q?.stage ?? null,
    next: q ? await quoteNextStepFor(q, user) : null,
  };
}

/**
 * Move vendor-quote attachments into Blob storage when the token exists
 * (D116's seam, #143). Runs with the REAL quote id in hand — a brand-new
 * quote has none until create() returns, and an earlier attempt wrote the
 * path under an id that did not exist yet, so nothing ever matched. Without
 * a token the data-URL stays in the document, exactly as the proxy route's
 * local fallback expects.
 *
 * It is also the gate on an incoming `blobPath`: since #143 that field comes
 * from the browser, so it is honoured only for a path this record can claim.
 */
async function storeVendorQuotes(
  quoteId: string,
  vendorQuotes: VendorQuote[]
): Promise<VendorQuote[]> {
  const canUpload = blobEnabled();
  const out: VendorQuote[] = [];
  for (const vq of vendorQuotes) {
    const att = vq.attachment;
    if (!att) {
      out.push(vq);
      continue;
    }
    /* #143 re-review: `blobPath` reaches this action FROM THE BROWSER now —
       the upload route hands it back and it rides along in the save payload —
       so it is untrusted input, not a server fact. Unvalidated, a crafted
       save would point a vendor quote at any object in the private Blob store
       and the authenticated download proxy would stream it. The path is only
       honoured when it is this record's own file (ownsVendorQuoteBlobPath);
       anything else is dropped and the dataUrl branch takes over.
       The path check runs even with Blob off, so a planted path can never be
       persisted at all. */
    const stored = ownsVendorQuoteBlobPath(att.blobPath, vq.id) ? att.blobPath : undefined;
    if (att.blobPath && !stored) {
      console.warn(
        "[estimator] refused a vendor-quote blobPath that is not this record's:",
        att.blobPath
      );
    }
    if (stored) {
      // Already in storage under this record's id (the upload route's normal
      // path): nothing to do. Any residual dataUrl is dropped so the bytes
      // stop riding in every later save payload.
      out.push(
        att.dataUrl
          ? { ...vq, attachment: { name: att.name, mime: att.mime, blobPath: stored } }
          : vq
      );
      continue;
    }
    if (!canUpload || !att.dataUrl) {
      // Keep the record, never a path it cannot claim.
      out.push(att.blobPath ? { ...vq, attachment: { name: att.name, mime: att.mime } } : vq);
      continue;
    }
    try {
      const { bytes, mime } = dataUrlToBytes(att.dataUrl);
      const up = await putBlob(
        `${VENDOR_QUOTE_BLOB_PREFIX}${quoteId}/${vq.id}-${safeName(att.name || "quote")}`,
        bytes,
        att.mime || mime
      );
      out.push({
        ...vq,
        attachment: { name: att.name, mime: att.mime || mime, blobPath: up.pathname },
      });
    } catch (e) {
      // A failed upload must not lose the file: keep the data-URL, which the
      // proxy route still serves.
      console.error("[estimator] vendor quote blob upload failed:", e);
      out.push(vq);
    }
  }
  return out;
}

/** Vendor-quote ids the items of a spec's sections still reference (#143). */
function vendorIdsInSections(sections: SpecSection[] | undefined | null): Set<string> {
  const out = new Set<string>();
  (Array.isArray(sections) ? sections : []).forEach((sec) =>
    (sec?.items || []).forEach((it) => {
      if (it && it.vendorQuoteId) out.add(it.vendorQuoteId);
    })
  );
  return out;
}

/** Same, for a revision's opaque `spec` payload. */
function vendorIdsInSpec(spec: unknown): Set<string> {
  const sections = (spec as { sections?: SpecSection[] } | null | undefined)?.sections;
  return vendorIdsInSections(sections);
}

/** Narrow a stored `quote.vendorQuotes` blob (typed `unknown` on Quote). */
function vendorQuoteRows(raw: unknown): VendorQuote[] {
  return Array.isArray(raw)
    ? (raw as VendorQuote[]).filter((v) => !!v && typeof v === "object" && typeof v.id === "string")
    : [];
}

/**
 * Save — port of the prototype's doSave(): update when a quote is loaded,
 * create otherwise. spec = { sections, mobs } (sections round-trip the
 * builder; mobs flow to the project on win).
 */
export async function saveQuoteAction(
  loadedId: string | null,
  payload: SavePayload
): Promise<SaveResult> {
  const user = await requireUser();
  // Read before the patch is built: a portal-catalog quote's `source` must
  // survive a plain Estimator save (#245 Task 13) — staff price its
  // price-on-request lines right here before sending, and a save that
  // silently reclassified it to "estimator" would drop the Portal panel,
  // the customer's "in review" copy and every portal-only rule for good.
  // Every other quote keeps the prior unconditional "estimator" stamp.
  const prior = loadedId ? await get(loadedId) : null;
  // #248 Task 4: source stamping goes through the shared sourceForSave —
  // portal-catalog (the only portal source the Estimator ever loads; a
  // portal-service quote redirects to its own builder before reaching here)
  // keeps its source across this save exactly like before.
  const savedSource = sourceForSave(prior?.source, "estimator");
  // #245 Task 13 (spec §4.3, controller decision 6): `por` clears on any
  // item staff have now priced; `portalReview` clears once none remain —
  // scoped to a portal-catalog quote so no other save's behavior changes.
  // #250 (design pick 5): a priced curtain line (`portalConfirm`) also holds
  // `portalReview` open on Save — it clears only when the quote is sent
  // (setStatus already does that unconditionally), never here.
  const isPortalCatalog = savedSource === "portal-catalog";
  // #267: a system's typed sell / $25 rounding is only kept when valid
  // (sellOverride finite, > 0, ≤ $10M; priceRound exactly 25) — dropped
  // otherwise, before anything prices or stores the sections.
  // #293: key-product blocks are shape-cleaned server-side whatever the client posts.
  // #301: the output fields (discipline, client goals, cover text) are cleaned the same way.
  const sellSanitizedRaw = Array.isArray(payload.sections) ? payload.sections.map(sanitizeSystemSell).map(withSanitizedKeyProducts).map(withSanitizedOutputFields) : payload.sections;
  // Phase 2a: the groups are sanitised (an older caller without `groups` keeps
  // the stored ones) and the sections normalised BEFORE the Rewards credit is
  // settled, so the credit always lands on the true last system. built/groupId
  // are hardened (built only when exactly true, groupId only when a string).
  const groups = sanitizeGroups(payload.groups ?? (prior?.spec as { groups?: unknown } | null | undefined)?.groups);
  const sellSanitized = Array.isArray(sellSanitizedRaw) ? normalizeSystemOrder(sellSanitizedRaw.map(sanitizeSectionGroupMeta), groups) : sellSanitizedRaw;
  // #282 phase 2: a negative price only on the Rewards credit line, and that
  // line clamped to what the customer can spend here — refused, not stored,
  // when any other line carries one.
  const credit = await settleRewardCredit(sellSanitized, prior, payload.customerId || null, loadedId, can("create", user.roles));
  if (!credit.ok) {
    return {
      ok: false,
      id: loadedId,
      number: prior ? displayQuoteNumber(prior) : null,
      revNum: Math.max(1, prior?.revisions?.length || 1),
      updatedAt: prior?.updatedAt ?? Date.now(),
      review: prior?.review ?? null,
      status: prior?.status ?? null,
      pipelineId: prior?.pipelineId ?? null,
      stage: prior?.stage ?? null,
      error: credit.error,
    };
  }
  const postedSections = credit.sections;
  const { sections: savedSections, anyPor, anyConfirm } = isPortalCatalog
    ? clearPricedPor(postedSections)
    : { sections: postedSections, anyPor: false, anyConfirm: false };
  // #242 final: the review-limit gate auto-approves on the STORED value, so it
  // is the server's own totals() over the posted sections — a posted value
  // that disagrees beyond rounding is replaced, never trusted. (#267: it
  // sanitizes each section's system sell itself, same rule as above.)
  const priced = reconcileEstimatorValue(postedSections, { value: payload.value, margin: payload.margin });
  if (priced.adjusted) {
    console.warn("[estimator] saveQuoteAction: posted value", payload.value, "≠ recomputed", priced.value, "— stored the recomputed value");
  }
  // #254 review: the tier stamp is persisted ONLY with the lines, here, on
  // create and update alike — resolved server-side from the customer +
  // contact being saved (never trusted from the client). The Estimator
  // re-prices its lines against the same resolution (resolveTierAction), so
  // the stamp and the lines it seeded always land in the same write.
  const { resolveTier } = await import("@/lib/pricing-tiers");
  const tier = await resolveTier(payload.customerId || null, payload.contactName || "");
  // `status` is deliberately NOT one of these fields — see the loadedId
  // branch below (security review, 2026-09-25): quotes.update() is an
  // unguarded field merge with no approval gate, no history stamp, and no
  // spawnFromQuote trigger, so a status change must never ride it.
  const patch: QuotePatch = {
    name: payload.name,
    customer: payload.customer,
    customerId: payload.customerId || null,
    locationId: payload.locationId || null,
    contactName: payload.contactName || "",
    quoteNote: payload.quoteNote || "",
    assumptions: payload.assumptions || "",
    installTimeframe: payload.installTimeframe || "TBD",
    paymentTerms: payload.paymentTerms,
    category: (payload.category || "").trim(),
    value: priced.value,
    margin: priced.margin,
    pricingTier: tier.tier,
    tierMargin: tier.margin,
    source: savedSource,
    spec: { sections: normalizeSystemOrder(savedSections, groups), mobs: payload.mobs, groups },
    pdfOptions: normalizePdfOptions(payload.pdfOptions),
    // #301 (R14): not content fields — they never re-render the estimate PDF.
    ...(typeof payload.coverSummary === "string" ? { coverSummary: cleanPlainText(payload.coverSummary, COVER_SUMMARY_MAX) } : {}),
    ...(typeof payload.notIncluded === "string" ? { notIncluded: cleanPlainText(payload.notIncluded, NOT_INCLUDED_MAX) } : {}),
    ...(isPortalCatalog && !anyPor && !anyConfirm ? { portalReview: null } : {}),
  };
  // #304: an Estimator tab opened before a model-number rename still holds the
  // old SKUs — move the live spec onto the renamed parts (sku + model) before
  // it is written, so a save never re-introduces a retired SKU. Revisions are
  // frozen and never touched here.
  patch.spec = await quoteSpecFollowingRenames(patch.spec);
  let q: Quote | null = null;
  let statusError: string | undefined;
  let statusNotice: string | undefined = credit.notice;
  let pdfState: QuotePdfView | null = null;
  /* #143: keep only the vendor quotes something still references. Deleting a
     system, or moving one to another estimate, would otherwise strand its
     record — and its attachment — on this document forever.

     "Something" is NOT just the live spec (#143 re-review): every recallable
     revision names records too, and with Blob storage off the data-URL in the
     record is the only copy of the vendor's file. Pruning a record a sent
     revision still points at would make that revision unrecallable — the line
     would come back priced but anonymous — so those keep their STORED copy,
     while the builder's own copy wins for anything a live line references. */
  const liveVq = vendorIdsInSections(savedSections);
  const revVq = new Set<string>();
  (prior?.revisions || []).forEach((r) =>
    vendorIdsInSpec(r.spec).forEach((id) => revVq.add(id))
  );
  const keptVq = new Map<string, VendorQuote>();
  vendorQuoteRows(prior?.vendorQuotes).forEach((vq) => {
    if (revVq.has(vq.id)) keptVq.set(vq.id, vq);
  });
  (payload.vendorQuotes || []).forEach((vq) => {
    if (liveVq.has(vq.id) || revVq.has(vq.id)) keptVq.set(vq.id, vq);
  });
  let storedVendorQuotes: VendorQuote[] = [...keptVq.values()];
  if (loadedId) {
    storedVendorQuotes = await storeVendorQuotes(loadedId, storedVendorQuotes);
    q = await update(loadedId, { ...patch, vendorQuotes: storedVendorQuotes } as QuotePatch);
    // #222: pending BEFORE any status change below, so a send in this same
    // save waits for this save's render instead of copying the previous file.
    if (q) pdfState = await scheduleQuotePdf(loadedId);
    // Security review (2026-09-25), D84/punch #60: a changed status can only
    // reach the DB through the gated setStatus() path — the approval gate,
    // status history and spawnFromQuote all live there, and `update()`
    // above deliberately never carries `status` (see `patch`'s own comment).
    // Reachable here whenever Save fires with a changed status dropdown
    // before (or instead of) changeStatus's own setStatusAction call — the
    // "use server" action is also callable directly, bypassing the client
    // dropdown's own transition rules entirely.
    //
    // #180 review 2/3: whether (and how) to act on a possibly-changed
    // status is `resolveSaveStatusChange` (quotes.ts) — a pure function so
    // it's testable directly (this "use server" file can't be called from
    // a plain test harness) and so this file carries no copy of the
    // condition that could drift from what's actually tested. Compared
    // against `q.status` (just returned by update() above), not the
    // `prior` read from the top of this function — prior is a snapshot
    // taken before the vendor-quote pruning and the update() call, so using
    // it here would reopen a narrower version of the exact same staleness
    // gap `baseStatus` exists to close.
    if (q) {
      const decision = resolveSaveStatusChange(payload.status, payload.baseStatus, q.status);
      if (decision.kind === "apply") {
        try {
          q = (await setStatus(loadedId, payload.status, user.name)) ?? q;
        } catch (e) {
          // Same split as the create branch below: the gate's refusal is
          // the user's to read (#174); the field edits above are still saved.
          statusError = statusFailureMessage(
            e,
            "estimator/actions saveQuoteAction: setStatus on an existing quote threw"
          );
        }
      } else if (decision.kind === "stalePassive") {
        // Nothing this save asked for was refused — the other field edits
        // succeeded normally, so this stays ok:true with an informational
        // notice, not an error.
        statusNotice = decision.notice;
      } else if (decision.kind === "staleConflict") {
        statusError = decision.error;
      }
    }
  } else {
    // #62 gave every mint a retry budget; `insertWithPrefixedId` THROWS once an
    // id collision outlasts it (doc-store.ts). Rare, but this is a save button —
    // it must come back as a typed message, not a raw 500. The sibling
    // setStatus call below already does this; create() was the one gap.
    let created: Quote;
    try {
      created = await create({ ...patch, owner: user.name });
    } catch (e) {
      return {
        ok: false,
        id: null,
        number: null,
        revNum: 1,
        updatedAt: Date.now(),
        review: null,
        status: null,
        pipelineId: null,
        stage: null,
        error:
          e instanceof Error
            ? e.message
            : "Could not create the quote — please try again.",
      };
    }
    // create() promotes only the declared columns — stamp the extras + status.
    // The vendor-quote attachments can only be stored now: this is the first
    // moment the real quote id exists to key their Blob path by (#143).
    storedVendorQuotes = await storeVendorQuotes(created.id, storedVendorQuotes);
    q = await update(created.id, {
      contactName: payload.contactName || "",
      quoteNote: payload.quoteNote || "",
      assumptions: payload.assumptions || "",
      paymentTerms: payload.paymentTerms,
      category: (payload.category || "").trim(),
      vendorQuotes: storedVendorQuotes,
      pdfOptions: normalizePdfOptions(payload.pdfOptions),
    } as QuotePatch);
    // #222: same ordering as the update branch.
    if (q) pdfState = await scheduleQuotePdf(created.id);
    if (payload.status !== "draft") {
      // Punch #60: setStatus's approval gate now applies here too. A brand
      // new quote can never already carry an approval record, so this can
      // only succeed for "lost" — and "won"/"sent" would always be refused.
      // Catch rather than let a raw exception blow up an otherwise-successful
      // save: the quote stays created (in draft), just not advanced.
      // #174: the gate's refusal is the user's to read; a spawn defect is
      // not, and used to arrive here looking exactly the same.
      try {
        // #180 review: `?? q` so a null result (defensive; setStatus only
        // returns null for an unrecognised status or a missing doc, neither
        // reachable here) never erases the update() result already in `q`.
        q = (await setStatus(created.id, payload.status, user.name)) ?? q;
      } catch (e) {
        statusError = statusFailureMessage(
          e,
          "estimator/actions saveQuoteAction: setStatus on a newly created quote threw"
        );
      }
    }
    q = q || created;
    // D205: the replaced draft goes only once its replacement exists.
    await retireReplacedDraftSafely(payload.replaces, created.id, "estimator");
  }
  refresh();
  return {
    ok: !!q && !statusError,
    id: q?.id ?? null,
    number: q ? displayQuoteNumber(q) : null,
    revNum: Math.max(1, q?.revisions?.length || 1),
    updatedAt: q?.updatedAt ?? Date.now(),
    review: q?.review ?? null,
    status: q?.status ?? null,
    // Daylite stage bar (Task 6) — normalized on read (normalizeQuotePipeline);
    // null for a service quote (quoteType set to something other than system).
    pipelineId: q?.pipelineId ?? null,
    stage: q?.stage ?? null,
    vendorQuotes: storedVendorQuotes,
    pdf: pdfState,
    next: q ? await quoteNextStepFor(q, user) : null,
    // #282 follow-up: a save that moved the quote to Lost cleared its credit.
    rewardCredit: q?.status === "lost" ? quoteRewardCredit(q) : credit.credit,
    ...(statusError ? { error: statusError } : {}),
    ...(statusNotice ? { notice: statusNotice } : {}),
  };
}

/**
 * #282 phase 2 — the Rewards credit a save may store (spec §5):
 * - a negative price/qty on any line but the credit line refuses the save;
 * - a won quote keeps the credit it had (its redeem is on the ledger — the
 *   builder can't move it; the credit follows the status);
 * - a lost quote carries none (#282 follow-up: going Lost clears the credit
 *   and a save can't put one back — the locked branch re-homes the stored
 *   amount, which is 0);
 * - no customer drops it (the builder also drops it when the customer
 *   changes; the clamp below is always against the customer being saved);
 * - otherwise it is clamped to that company's available credit (balance −
 *   credit on its OTHER open quotes) and the quote's pre-credit total, in
 *   whole dollars rounded down (#282 points follow-up — 1 point = $1);
 * - without `create` the credit can't grow past what the quote already had.
 */
async function settleRewardCredit(
  sections: SpecSection[],
  prior: Quote | null,
  customerId: string | null,
  loadedId: string | null,
  mayApply: boolean
): Promise<{ ok: true; sections: SpecSection[]; credit: number; notice?: string } | { ok: false; error: string }> {
  if (!Array.isArray(sections)) return { ok: true, sections, credit: 0 };
  const posted = rewardCreditOf(sections);
  let max: number;
  if (prior && (prior.status === "won" || prior.status === "lost")) {
    // Locked: re-home the stored amount (the negative-line check still runs).
    const locked = quoteRewardCredit(prior);
    const check = sanitizeRewardCredit(sections, Number.POSITIVE_INFINITY);
    if (!check.ok) return check;
    const maxId = sections.reduce((m, s) => Math.max(m, ...(s?.items || []).map((it) => (typeof it?.id === "number" ? it.id : 0))), 0);
    const out = withRewardCredit(check.sections, locked, maxId + 1);
    return { ok: true, sections: out, credit: rewardCreditOf(out) };
  }
  if (!customerId || !(posted > 0)) max = 0;
  else {
    const { available } = await companyCredit(customerId, loadedId);
    max = maxApplicableCredit(available, totals(withoutRewardCredit(sections), 0).grand);
    if (!mayApply) max = Math.min(max, prior && (prior.customerId || null) === customerId ? quoteRewardCredit(prior) : 0);
  }
  const res = sanitizeRewardCredit(sections, max);
  if (!res.ok) return res;
  // #282 points follow-up: the credit is whole dollars (points); a legacy
  // cents credit is rounded down on its next save and says so.
  const notice =
    res.rounded && res.credit > 0
      ? `Rewards credit rounded down to whole dollars (${fmtMoney(res.credit)}) — credit applies as whole points.`
      : res.clamped && res.credit > 0
      ? `Rewards credit reduced to ${fmtMoney(res.credit)} — that's what this customer has available.`
      : res.clamped
      ? "Rewards credit removed — this customer has no credit available for this quote."
      : undefined;
  return { ok: true, sections: res.sections, credit: res.credit, ...(notice ? { notice } : {}) };
}

function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Search other estimates for the "move system" picker (sibling of the
 * "delete system" control). Substring match on name/customer, case-
 * insensitive; excludes the estimate being moved FROM. An empty query
 * returns the most-recently-updated estimates (getAll() is already
 * newest-first) rather than nothing, so the picker isn't empty on open.
 */
export async function searchQuotesAction(
  query: string,
  excludeId: string | null,
  limit = 20
): Promise<QuoteLite[]> {
  await requireUser();
  const q = (query || "").trim();
  const pool = (await getAll()).filter((quote) => quote.id !== excludeId);
  // #223 — the one quote search rule: estimate number (EST-1005, 1005), old
  // id, name, customer; exact-number hits first, newest-first within a tier.
  const matched = q
    ? pool
        .map((quote, i) => ({ quote, i, r: quoteSearchRank(quote, q) }))
        .filter((x): x is { quote: Quote; i: number; r: number } => x.r !== null)
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map((x) => x.quote)
    : pool;
  return matched.slice(0, Math.max(1, limit)).map((quote) => ({
    id: quote.id,
    number: displayQuoteNumber(quote),
    name: quote.name,
    customer: quote.customer,
    status: quote.status,
    updatedAt: quote.updatedAt,
  }));
}

export type MoveSystemTarget = { kind: "new" } | { kind: "existing"; quoteId: string };

export type MoveSystemResult =
  | { ok: true; targetId: string; targetName: string; targetNumber: string }
  | { ok: false; error: string };

/**
 * Moves a system (SpecSection) out of the current estimate and into a new
 * one or an already-existing one — sibling of "delete system". Never
 * touches the source quote: removal from the source is purely a client-side
 * `setSections` change, persisted only when the user hits Save there (same
 * as delete). The section's id is regenerated so it can never collide with
 * an id already present in the target quote.
 *
 * #143 re-review: a vendor line's money is on the item, but its file, terms,
 * notes and material list are on a VendorQuote record BESIDE the spec — so
 * those records travel with the section. Without that the target resolved the
 * moved line against whatever it already held under that id (nothing, or,
 * worse, a different vendor's quote), and the source's next save pruned the
 * only copy of the file away.
 */
export async function moveSystemToEstimateAction(
  section: SpecSection,
  target: MoveSystemTarget,
  sourceContext: {
    customerId: string | null;
    locationId: string | null;
    customer: string;
    contactName: string;
  },
  vendorQuotes: VendorQuote[] = []
): Promise<MoveSystemResult> {
  const user = await requireUser();
  // #267: a moved system keeps its own price — sanitized like a save.
  // #282 phase 2: the Rewards credit belongs to the source quote's customer —
  // it never travels with a moved system.
  // #293: blocks travel as-is (ids are kept) — sanitized like a save.
  const [movedRaw] = withoutRewardCredit([withSanitizedKeyProducts({ ...sanitizeSystemSell(section), id: "sys" + Date.now() })]);
  // #301: a moved system keeps its discipline, goals and cover paragraph — cleaned like a save.
  // Phase 2b: a client-posted section may carry the derived `alternate` stamp / group id —
  // stripped ONCE here, before the value is computed, so the new estimate's stored value counts it.
  const moved = withoutGroupMeta(withSanitizedOutputFields(movedRaw));
  const placed = await placeSystemInEstimate(moved, target, {
    newName: moved.name + " (moved)",
    sourceContext,
    vendorQuotes,
    owner: user.name,
  });
  if (!placed.ok) return placed;
  return { ok: true, targetId: placed.targetId, targetName: placed.targetName, targetNumber: placed.targetNumber };
}

/**
 * Persist a system into another estimate — the shared tail of Move and Copy
 * (#266). `placed` already carries its new section id. An existing target
 * gains the section at the end; a new target is created as a draft for the
 * source's customer/venue/contact, named `newName`, optionally stamped with
 * a pricing tier (Copy). Either way value/margin are recomputed through
 * totals(), the PDF is rescheduled, and the app is revalidated.
 *
 * #143 re-review: a vendor line's money is on the item, but its file, terms,
 * notes and material list are on a VendorQuote record BESIDE the spec — so
 * those records travel with the section. Without that the target resolved the
 * line against whatever it already held under that id (nothing, or, worse, a
 * different vendor's quote), and the source's next save pruned the only copy
 * of the file away. Trust the section, not the caller's list: only records
 * this section's own items name travel. Ids are globally unique (Date.now +
 * random), so they are carried as-is, and a target that already holds one
 * keeps a single record under it (the carried copy).
 */
async function placeSystemInEstimate(
  placed: SpecSection,
  target: MoveSystemTarget,
  opts: {
    newName: string;
    sourceContext: { customerId: string | null; locationId: string | null; customer: string; contactName: string };
    vendorQuotes: VendorQuote[];
    owner: string;
    tier?: { pricingTier: string; tierMargin: number };
  }
): Promise<{ ok: true; targetId: string; targetName: string; targetNumber: string } | { ok: false; error: string }> {
  const placedIds = vendorIdsInSections([placed]);
  const placedVq = vendorQuoteRows(opts.vendorQuotes).filter((vq) => placedIds.has(vq.id));

  if (target.kind === "existing") {
    const existing = await get(target.quoteId);
    if (!existing) {
      return { ok: false, error: "That estimate could not be found." };
    }
    const existingSpec = existing.spec as
      | { sections?: SpecSection[]; mobs?: SpecMob[]; groups?: SystemGroup[] }
      | null
      | undefined;
    // Phase 2a: the target keeps its own (sanitised) groups; the moved system lands ungrouped.
    const existingGroups = sanitizeGroups(existingSpec?.groups);
    // #282 phase 2: the target's own Rewards credit stays on ITS last system —
    // re-pinned after the order is normalised, so it really is the last one.
    const appended = normalizeSystemOrder([...(existingSpec?.sections || []), ...withoutRewardCredit([withoutGroupMeta(placed)])], existingGroups);
    const maxItemId = appended.reduce((m, sec) => Math.max(m, ...(sec?.items || []).map((it) => (typeof it?.id === "number" ? it.id : 0))), 0);
    const mergedSections = withRewardCredit(appended, rewardCreditOf(appended), maxItemId + 1);
    const t = totals(mergedSections, 0);
    const carried = placedVq.length
      ? await storeVendorQuotes(target.quoteId, placedVq)
      : [];
    const updated = await update(target.quoteId, {
      spec: { sections: normalizeSystemOrder(mergedSections, existingGroups), mobs: existingSpec?.mobs || [], groups: existingGroups },
      value: t.grand,
      margin: t.margin,
      ...(carried.length
        ? {
            vendorQuotes: [
              ...vendorQuoteRows(existing.vendorQuotes).filter((vq) => !placedIds.has(vq.id)),
              ...carried,
            ],
          }
        : {}),
    } as QuotePatch);
    if (!updated) {
      return { ok: false, error: "That estimate could not be found." };
    }
    // #222 fix wave 1: the target's document gained a section.
    await scheduleQuotePdf(updated.id);
    refresh();
    return { ok: true, targetId: updated.id, targetName: updated.name, targetNumber: displayQuoteNumber(updated) };
  }

  const t = totals(withoutRewardCredit([placed]), 0);
  let created: Quote;
  try {
    created = await create({
      name: opts.newName,
      customer: opts.sourceContext.customer,
      customerId: opts.sourceContext.customerId,
      locationId: opts.sourceContext.locationId,
      source: "estimator",
      status: "draft",
      spec: { sections: withoutRewardCredit([withoutGroupMeta(placed)]), mobs: [] },
      value: t.grand,
      margin: t.margin,
      owner: opts.owner,
      ...(opts.tier ? { pricingTier: opts.tier.pricingTier, tierMargin: opts.tier.tierMargin } : {}),
    });
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error
          ? e.message
          : "Could not create the new estimate — please try again.",
    };
  }
  // create() promotes only the declared Quote columns — contactName rides
  // along on the doc like it does for saveQuoteAction's fresh-create path.
  const withContact = await update(created.id, {
    contactName: opts.sourceContext.contactName || "",
    // Same as saveQuoteAction's fresh-create path: the Blob path can only be
    // keyed by the real quote id, which exists for the first time here.
    ...(placedVq.length
      ? { vendorQuotes: await storeVendorQuotes(created.id, placedVq) }
      : {}),
  } as QuotePatch);
  await scheduleQuotePdf(created.id);
  refresh();
  return { ok: true, targetId: created.id, targetName: (withContact || created).name, targetNumber: displayQuoteNumber(withContact || created) };
}

export type CopySystemTarget = MoveSystemTarget | { kind: "same" };

export type CopySystemResult =
  | { ok: true; kind: "same"; section: SpecSection; costsUpdated: number; tierRepriced: number }
  | {
      ok: true;
      kind: "new" | "existing";
      targetId: string;
      targetName: string;
      targetNumber: string;
      costsUpdated: number;
      tierRepriced: number;
      tierLabel: string | null;
    }
  | { ok: false; error: string };

/**
 * #266 — Copy a system to a new estimate, an existing one, or within this
 * estimate ("same"). The source is never touched. The copy is RE-PRICED for
 * where it lands (copy-system.ts): catalog parts and fixture components take
 * today's catalog cost, then lines still at the source tier's seed move to
 * the DESTINATION customer's tier; hand-priced lines keep their own margin
 * on the new cost; custom, curtain, allowance, vendor-quote, labor and POR
 * lines keep their cost.
 *
 * Destination tier: "same" keeps the source's stamp (no tier move); "new"
 * resolves the source customer + contact and stamps it on the created quote
 * (as saveQuoteAction would); "existing" reads the target's stored stamp,
 * else resolves its customer + contact.
 *
 * "same" persists nothing — the client appends the returned section (and
 * re-ids its lines) and the normal Save persists it. "new"/"existing"
 * persist exactly like Move (placeSystemInEstimate), carrying the section's
 * vendor-quote records under the SAME ids: their Blob files are keyed by
 * record id and never deleted, so source and copy share the file.
 */
export async function copySystemToEstimateAction(
  section: SpecSection,
  target: CopySystemTarget,
  sourceContext: {
    customerId: string | null;
    locationId: string | null;
    customer: string;
    contactName: string;
    tierMargin: number | null;
  },
  vendorQuotes: VendorQuote[] = []
): Promise<CopySystemResult> {
  const user = await requireUser();
  // #293: blocks ride copySectionForTarget's section spread — sanitized first.
  section = withSanitizedKeyProducts(section);
  section = withSanitizedOutputFields(section);
  const { resolveTier } = await import("@/lib/pricing-tiers");
  const items = Array.isArray(section?.items) ? section.items : [];

  // #293 slice 2: today's catalog + resolved fixtures — shared with Load system.
  const { catalog, fixtures, renames } = await copyPricingFor(items);

  /* The destination tier. */
  const sourceTier = usableTierMargin(sourceContext?.tierMargin);
  let targetTier: number | null = sourceTier;
  let targetTierKey: string | null = null;
  let stamp: { pricingTier: string; tierMargin: number } | undefined;
  if (target.kind === "new") {
    const r = await resolveTier(sourceContext.customerId || null, sourceContext.contactName || "");
    targetTier = r.margin;
    targetTierKey = r.tier;
    stamp = { pricingTier: r.tier, tierMargin: r.margin };
  } else if (target.kind === "existing") {
    const existing = await get(target.quoteId);
    if (!existing) return { ok: false, error: "That estimate could not be found." };
    const stored = usableTierMargin(existing.tierMargin);
    if (stored != null) {
      targetTier = stored;
      targetTierKey = existing.pricingTier || null;
    } else {
      const r = await resolveTier(existing.customerId || null, existing.contactName || "");
      targetTier = r.margin;
      targetTierKey = r.tier;
    }
  }
  const tierMoved = usableTierMargin(targetTier) != null && seedMarginOf(sourceTier) !== seedMarginOf(targetTier);
  const tierLabel =
    tierMoved && targetTierKey
      ? (PRICING_TIER_LABEL as Record<string, string>)[targetTierKey] || targetTierKey
      : null;

  const copied = copySectionForTarget(sanitizeSystemSell(section), {
    newSectionId: "sys" + Date.now(),
    catalog,
    fixtures,
    sourceTierMargin: sourceTier,
    targetTierMargin: targetTier,
    // #304: lines naming a renamed part's old SKU land on the live SKU.
    renames,
  });

  if (target.kind === "same") {
    return {
      ok: true,
      kind: "same",
      section: copied.section,
      costsUpdated: copied.costsUpdated,
      tierRepriced: copied.tierRepriced,
    };
  }

  const placed = await placeSystemInEstimate(copied.section, target, {
    newName: section.name + " (copy)",
    sourceContext,
    vendorQuotes,
    owner: user.name,
    tier: stamp,
  });
  if (!placed.ok) return placed;
  return {
    ok: true,
    kind: target.kind,
    targetId: placed.targetId,
    targetName: placed.targetName,
    targetNumber: placed.targetNumber,
    costsUpdated: copied.costsUpdated,
    tierRepriced: copied.tierRepriced,
    tierLabel,
  };
}

/** Header fields persisted immediately as they change (prototype behavior). */
export async function updateQuoteMetaAction(
  id: string,
  meta: {
    customerId?: string | null;
    locationId?: string | null;
    customer?: string;
    contactName?: string;
    quoteNote?: string;
    assumptions?: string;
    installTimeframe?: string;
    category?: string;
    name?: string;
    coverSummary?: string;
    notIncluded?: string;
  }
): Promise<{ ok: boolean; pdf?: QuotePdfView | null }> {
  await requireUser();
  if (!id) return { ok: false };
  // Allowlist the header fields only — never forward the raw client object.
  // The runtime type is not enforced by TS, so a caller could otherwise slip
  // in `review`/`status`/`value`/`owner` and self-approve or re-price a quote,
  // bypassing the permission-gated review actions below. Approval/status/price
  // changes have their own checked mutators (approveReviewAction, setStatus…).
  const patch: QuotePatch = {};
  if ("customerId" in meta) patch.customerId = meta.customerId;
  if ("locationId" in meta) patch.locationId = meta.locationId;
  if (typeof meta.customer === "string") patch.customer = meta.customer;
  if (typeof meta.contactName === "string") patch.contactName = meta.contactName;
  if (typeof meta.quoteNote === "string") patch.quoteNote = meta.quoteNote;
  if (typeof meta.assumptions === "string") patch.assumptions = meta.assumptions;
  if (typeof meta.installTimeframe === "string") patch.installTimeframe = meta.installTimeframe.trim();
  if (typeof meta.category === "string") patch.category = meta.category.trim();
  // #301: the cover fields autosave like the cover note; neither is content, so no re-render.
  if (typeof meta.coverSummary === "string") patch.coverSummary = cleanPlainText(meta.coverSummary, COVER_SUMMARY_MAX);
  if (typeof meta.notIncluded === "string") patch.notIncluded = cleanPlainText(meta.notIncluded, NOT_INCLUDED_MAX);
  // #160: the click-to-edit Estimator title. Blank never clears a name.
  if (typeof meta.name === "string" && meta.name.trim()) patch.name = meta.name.trim();

  // #254 review: the tier stamp is NOT written here any more. It is saved
  // only with the lines (saveQuoteAction), so a header autosave can never
  // leave a stamp that the stored lines weren't re-priced to. The Estimator
  // resolves the tier for display/re-pricing through resolveTierAction.

  const q = await update(id, patch);
  // #222 fix wave 1: header fields print on the customer document — a write
  // that changed one (patchQuote stamps contentChangedAt with this write's
  // updatedAt) re-renders it; a category-only edit doesn't.
  // The preview takes the scheduled state back so it shows "Updating PDF…".
  const pdf = q && q.contentChangedAt === q.updatedAt ? await scheduleQuotePdf(q.id) : undefined;
  refresh();
  return { ok: !!q, ...(pdf ? { pdf } : {}) };
}

/** #287 task B — what setQuotePeopleAction hands back to the Estimator. */
export type QuotePeopleSync = {
  ok: boolean;
  error?: string;
  /** The stored names after the call (unchanged on a refusal). */
  owner: string;
  preparedBy: string;
  /** The next-step control re-evaluated — a new lead estimator changes its buttons. */
  next: QuoteNextStepView | null;
  pdf?: QuotePdfView | null;
};

/**
 * #287 task B — Lead estimator (`owner`) and Prepared by (`preparedBy`),
 * saved the moment either select changes. Deliberately NOT part of Save or
 * updateQuoteMetaAction: their allowlists exclude `owner` because the owner's
 * review limit drives auto-approval. The guard (create to change either; only
 * an approver hands a quote to someone else) lives in setQuotePeopleAs.
 */
export async function setQuotePeopleAction(
  id: string,
  people: { owner?: string; preparedBy?: string }
): Promise<QuotePeopleSync> {
  const user = await requireUser();
  const input = people && typeof people === "object" ? people : {};
  const r = await setQuotePeopleAs(id, user, {
    ...("owner" in input ? { owner: input.owner } : {}),
    ...("preparedBy" in input ? { preparedBy: input.preparedBy } : {}),
  });
  const q = r.ok ? r.quote : await get(id);
  const next = q ? await quoteNextStepFor(q, user) : null;
  if (!r.ok) return { ok: false, error: r.error, owner: r.owner, preparedBy: r.preparedBy, next };
  // Both names print on the customer document — re-render it (as a header
  // autosave does) when this write changed them.
  const pdf = r.changed && q && q.contentChangedAt === q.updatedAt ? await scheduleQuotePdf(q.id) : undefined;
  if (r.changed) refresh();
  return { ok: true, owner: r.owner, preparedBy: r.preparedBy, next, ...(pdf ? { pdf } : {}) };
}

/**
 * #254 review — read-only: the pricing tier a customer + contact resolves to
 * (contact's own tier → company tier → Base), for the Estimator to re-price
 * against on a pick, saved quote or not. Writes nothing: the stamp is
 * persisted only with the lines, by saveQuoteAction.
 */
export async function resolveTierAction(
  customerId: string | null,
  contactName: string
): Promise<{ ok: true; pricingTier: string; tierMargin: number; label: string } | { ok: false }> {
  await requireUser();
  try {
    const { resolveTier } = await import("@/lib/pricing-tiers");
    const r = await resolveTier(typeof customerId === "string" && customerId ? customerId : null, typeof contactName === "string" ? contactName : "");
    return { ok: true, pricingTier: r.tier, tierMargin: r.margin, label: PRICING_TIER_LABEL[r.tier] || r.tier };
  } catch (e) {
    console.error("[estimator] resolveTierAction failed:", e);
    return { ok: false };
  }
}

export async function setStatusAction(
  id: string,
  status: QuoteStatus
): Promise<ReviewSync> {
  const user = await requireUser();
  if (!id || !STAGES.includes(status)) return { ok: false, review: null, status: null };
  // Punch #60 (D84 hole): marking a quote WON or SENT requires an approval
  // record — in-app or attested. Every other stage transition stays open to
  // any signed-in user, as before. Pre-checked here so the UI gets the same
  // typed error sendToCustomerAction/setStatusAction("won") always returned;
  // setStatus() now enforces this same gate itself (punch #60 follow-up — it
  // moved there so every OTHER caller inherits it too), so this pre-check and
  // the store are both consulting `requireApprovalToAdvance`/the review
  // record, never two different rules. The try/catch below is just a
  // backstop — it should never actually fire given this pre-check.
  if (status === "won" || status === "sent") {
    const cur = await get(id);
    // #242: the same decision setStatus makes — an approval that still holds,
    // or the quote owner's review limit.
    const gate = await checkApprovalGate(cur, status, user.name);
    if (!gate.ok) {
      return {
        ok: false,
        review: cur?.review ?? null,
        status: cur?.status ?? null,
        error: gate.error,
        gateRefused: true,
      };
    }
  }
  try {
    await setStatus(id, status, user.name);
  } catch (e) {
    const cur = await get(id);
    return {
      ok: false,
      review: cur?.review ?? null,
      status: cur?.status ?? null,
      // #174: with the pre-check above, a refusal reaching here is nearly
      // impossible — so what this backstop actually catches is a DEFECT, and
      // it must read (and log) as one rather than as a policy refusal.
      error: statusFailureMessage(e, `estimator/actions setStatusAction(${status}): setStatus threw`),
      gateRefused: isApprovalGateRefusal(e),
    };
  }
  refresh();
  return syncOf(id, user);
}

/**
 * Staff Decline (#245 Task 13, spec §4.4/§5) — the Portal panel's inline
 * textarea + button, no browser confirm(). Same session gate as the
 * Quotes-hub status action (`requireUser()` only — the panel's Approve
 * button reuses that action directly for the mirror-image "won" case).
 */
export async function declinePortalAcceptanceAction(
  quoteId: string,
  note: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!quoteId) return { ok: false, error: "Couldn't decline this quote — try again." };
  const r = await declinePortalAcceptance(quoteId, user.name, note);
  if (r.ok) refresh();
  return r;
}

/**
 * Move a system quote to a pipeline stage from the estimator header's Daylite
 * stage bar (Task 6). Thin wrapper — all the real logic (approval gate on a
 * status-changing move, history, revision-on-send, spawn) lives in
 * setQuoteStage/setStatus; a same-status-tag move is a plain stage write. A
 * stage that changes the quote's status inherits setStatus's approval gate
 * exactly like setStatusAction above and THROWS on refusal, caught here the
 * same way — never a second source of truth for the gate.
 */
export async function setQuoteStageAction(id: string, stageId: string): Promise<StageSync> {
  const user = await requireUser();
  if (!id || !stageId) return { ok: false, status: null, review: null, pipelineId: null, stage: null };
  let q: Awaited<ReturnType<typeof setQuoteStage>>;
  try {
    q = await setQuoteStage(id, stageId, user.name);
  } catch (e) {
    const cur = await get(id);
    return {
      ok: false,
      status: cur?.status ?? null,
      review: cur?.review ?? null,
      pipelineId: cur?.pipelineId ?? null,
      stage: cur?.stage ?? null,
      // #174: only the approval gate's own refusal reaches the user verbatim;
      // anything else is a defect — logged, shown as the generic line.
      error: statusFailureMessage(e, `estimator/actions setQuoteStageAction(${stageId}): setQuoteStage threw`),
      gateRefused: isApprovalGateRefusal(e),
    };
  }
  // setQuoteStage also refuses by returning null (no throw) — a stage id
  // outside the quote's pipeline, a lost quote, or a non-pipeline quote (see
  // its own doc comment). Left unchecked, this used to fall through to
  // stageSyncOf(id), which reads the UNCHANGED doc and reports ok:true — the
  // bar would silently revert to its old stage with no error banner.
  if (!q) {
    const cur = await get(id);
    return {
      ok: false,
      status: cur?.status ?? null,
      review: cur?.review ?? null,
      pipelineId: cur?.pipelineId ?? null,
      stage: cur?.stage ?? null,
      error: "That stage isn't available for this quote — refresh and try again.",
    };
  }
  refresh();
  return stageSyncOf(id, user);
}

/**
 * Switch a draft system quote to another quote pipeline (Estimate/Design ⇄
 * BID SPEC) from the header's pipeline select. setQuotePipeline refuses
 * (returns null, never throws) outside draft or for an unknown pipeline id.
 */
export async function setQuotePipelineAction(id: string, pipelineId: string): Promise<StageSync> {
  const user = await requireUser();
  if (!id || !pipelineId) return { ok: false, status: null, review: null, pipelineId: null, stage: null };
  const q = await setQuotePipeline(id, pipelineId);
  if (!q) {
    const cur = await get(id);
    return {
      ok: false,
      status: cur?.status ?? null,
      review: cur?.review ?? null,
      pipelineId: cur?.pipelineId ?? null,
      stage: cur?.stage ?? null,
      error: "That pipeline change was refused.",
    };
  }
  refresh();
  return stageSyncOf(id, user);
}

/* ============================================================
   D4 — Draft quote scope + line items from a survey / inspection
   ============================================================

   The AI only DRAFTS a scope paragraph and suggested line items (description /
   qty / unit — NEVER a price; pricing is the estimator's job, guardrail D6).
   Nothing is persisted here; the client renders the draft for the estimator to
   review, then inserts the scope / adds lines (price blank) via the estimator's
   own add-line path. This action just reads the source and calls the AI fn. */

export type DraftScopeResult =
  | { ok: true; scope: string; lines: DraftedLine[] }
  | { ok: false; error: string };

/** Plain-text "key: value" line, dropped when the value is empty. */
function kv(label: string, value: unknown): string {
  const v = (value == null ? "" : String(value)).trim();
  return v ? `${label}: ${v}` : "";
}

/** Non-empty measurements/facts as indented "  - key: value" lines. */
function recordLines(rec: Record<string, string> | undefined): string {
  if (!rec) return "";
  return Object.entries(rec)
    .filter(([, v]) => (v == null ? "" : String(v)).trim())
    .map(([k, v]) => `  - ${k}: ${String(v).trim()}`)
    .join("\n");
}

/** Flatten a field survey's brief + field capture into plain-text findings. */
function surveyFindings(s: SurveyRecord): string {
  const parts: string[] = [
    kv("Venue type", s.venueType),
    kv("Reason for visit", s.reason),
    kv("Scope of work (field)", s.scopeOfWork),
    kv("Field notes", s.notes),
    s.conditions?.length ? kv("Site conditions", s.conditions.join(", ")) : "",
    kv("Install timeframe", s.installTimeframe),
  ];
  const access = [
    kv("loading dock", s.loadingDock),
    kv("elevator", s.elevatorSize),
    kv("floor", s.floorType),
    kv("access door", s.accessDoorSize),
    s.liftNeeded
      ? `lift: ${s.liftNeeded}${s.liftSupplier ? ` (${s.liftSupplier})` : ""}`
      : "",
  ].filter(Boolean);
  if (access.length) parts.push("Access/logistics: " + access.join("; "));
  const meas = recordLines(s.measurements);
  if (meas) parts.push("Measurements:\n" + meas);
  return parts.filter(Boolean).join("\n");
}

/** Flatten an inspection report (findings/logs + measurements) into plain text. */
function inspectionFindings(ins: InspectionRecord): string {
  const parts: string[] = [
    kv("Venue type", ins.venueType),
    kv("Overall condition", ins.condition),
    kv("Scope", ins.scope),
    kv("Narrative", ins.narrative),
  ];
  if (ins.logs?.length) {
    const issues = ins.logs.map((lg, i) => {
      const bits = [`[${lg.severity}] ${lg.problem}`.trim()];
      if (lg.location) bits.push(`location: ${lg.location}`);
      if (lg.explanation) bits.push(lg.explanation);
      if (lg.solution) bits.push(`recommended: ${lg.solution}`);
      if (lg.standards?.length) bits.push(`standards: ${lg.standards.join(", ")}`);
      return `  ${i + 1}. ${bits.join(" — ")}`;
    });
    parts.push("Issues found:\n" + issues.join("\n"));
  }
  const facts = recordLines(ins.venueInfo);
  if (facts) parts.push("Venue facts:\n" + facts);
  const meas = recordLines(ins.measurements);
  if (meas) parts.push("Measurements:\n" + meas);
  return parts.filter(Boolean).join("\n");
}

export async function draftQuoteScopeAction(input: {
  surveyId?: string;
  inspectionId?: string;
}): Promise<DraftScopeResult> {
  await requireUser();

  try {
    let sourceLabel: string;
    let customerName: string | undefined;
    let venue: string | undefined;
    let findings: string;

    if (input.surveyId) {
      const s = await getSurvey(input.surveyId);
      if (!s) return { ok: false, error: "That field survey could not be found." };
      sourceLabel = "field survey";
      customerName = s.customer || undefined;
      venue = s.venue || undefined;
      findings = surveyFindings(s);
    } else if (input.inspectionId) {
      const ins = await getInspection(input.inspectionId);
      if (!ins) return { ok: false, error: "That inspection could not be found." };
      sourceLabel = "inspection";
      customerName = ins.customer || undefined;
      venue = ins.venue || undefined;
      findings = inspectionFindings(ins);
    } else {
      return { ok: false, error: "No survey or inspection was specified." };
    }

    if (!findings.trim()) {
      return {
        ok: false,
        error: "That " + sourceLabel + " has no findings to draft from yet.",
      };
    }

    // Rules-based scope assembly (S12/D83 — Jeff: "it should just generate
    // estimate scopes, that is it"; items stay manual, no model call). The
    // scope is the record's own captured fields, standard-labeled: the
    // field-captured scope/narrative first, then the context an estimator
    // needs while pricing. Deterministic — same record, same text.
    const header =
      "Scope of work — from " +
      sourceLabel +
      (venue ? " at " + venue : "") +
      (customerName ? " (" + customerName + ")" : "") +
      ":";
    const scope = header + "\n\n" + findings;
    return { ok: true, scope, lines: [] };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Catalog search for the estimator's "Add part from catalog" picker (team-only).
 * In-memory substring match over sku/desc/mfr/MFR P/N/Model #/former SKUs (#304; optionally scoped to a category),
 * ranked so prefix hits on the SKU or description come first. Returns up to
 * `limit` hits plus the pre-cap total so the UI can say "refine to narrow".
 */
export async function searchCatalog(
  query: string,
  category = "",
  limit = 40
): Promise<CatalogSearch> {
  await requireUser();
  const q = (query || "").trim().toLowerCase();
  const cat = (category || "").trim();
  if (!q && !cat) return { hits: [], total: 0 };

  const parts = await catalogList();
  const scored = parts
    // #264: "Fabric" means every fabric part (isFabricPart — Fabric, or
    // Theatrical/Soft Goods sold per sq ft); any other category is exact.
    .filter((p) => (!cat ? true : cat === "Fabric" ? isFabricPart(p) : (p.category || "") === cat))
    .map((p) => {
      const sku = (p.sku || "").toLowerCase();
      const desc = (p.desc || "").toLowerCase();
      const cat = (p.category || "").toLowerCase();
      // #304: the Model # and old order numbers rank like the SKU does.
      const names = [sku, (p.manufacturerModelNumber || "").toLowerCase(), ...(p.formerSkus ?? []).map((s) => s.toLowerCase())].filter(Boolean);
      if (!q) return { p, score: 0 };
      let score = -1;
      if (names.includes(q) || desc === q) score = 5;
      else if (names.some((n) => n.startsWith(q)) || desc.startsWith(q)) score = 4;
      else if (desc.includes(q) || names.some((n) => n.includes(q))) score = 2;
      else if (cat.includes(q) || partSearchHaystack(p).includes(q)) score = 1; // mfr, MFR P/N …
      return { p, score };
    })
    .filter((s) => s.score >= 0)
    .sort((a, b) => b.score - a.score || (a.p.desc || "").localeCompare(b.p.desc || ""));

  const hits = scored.slice(0, Math.max(1, limit)).map(({ p }) => ({
    sku: p.sku,
    desc: p.desc,
    category: p.category || "",
    unit: p.unit || "ea",
    cost: p.cost || 0,
    list: p.list || 0,
    mfr: p.mfr || "",
    ...(p.pricedAt ? { pricedAt: p.pricedAt } : {}),
    ...(p.manufacturerModelNumber?.trim() ? { model: p.manufacturerModelNumber.trim() } : {}),
    ...(p.manufacturerPartNumber?.trim() ? { mpn: p.manufacturerPartNumber.trim() } : {}),
    rack: rackFactsOrUndefined(p),
  }));
  return { hits, total: scored.length };
}

export type ResolvedCatalogSku = {
  sku: string;
  desc: string;
  unit: string;
  cost: number;
  list: number;
  mfr?: string;
  manufacturerPartNumber?: string;
  manufacturerModelNumber?: string;
};

/**
 * Bulk SKU lookup for the estimator's CSV batch-add (PUNCHLIST #112). Matches
 * each requested SKU (trimmed, case-insensitive) against the catalog and
 * returns a map keyed by the SKU string exactly as the caller passed it, so
 * the importer can price catalog parts from a sku + quantity CSV. Unknown
 * SKUs are simply absent. Input is capped at 2000 SKUs per call.
 * #262: also carries the manufacturer / printed part & model numbers for the Parts list export.
 */
export async function resolveCatalogSkusAction(
  skus: string[]
): Promise<Record<string, ResolvedCatalogSku>> {
  await requireUser();
  const wanted = (skus || []).slice(0, 2000).filter((s) => typeof s === "string" && s.trim());
  const out: Record<string, ResolvedCatalogSku> = {};
  if (!wanted.length) return out;

  const parts = await catalogList();
  const bySku = new Map<string, ResolvedCatalogSku>();
  for (const p of parts) {
    const key = (p.sku || "").trim().toLowerCase();
    if (!key || bySku.has(key)) continue;
    const mfr = (p.mfr || "").trim();
    const mpn = (p.manufacturerPartNumber || "").trim();
    const mmn = (p.manufacturerModelNumber || "").trim();
    bySku.set(key, {
      sku: p.sku,
      desc: p.desc || "",
      unit: p.unit || "ea",
      cost: p.cost || 0,
      list: p.list || 0,
      ...(mfr ? { mfr } : {}),
      ...(mpn ? { manufacturerPartNumber: mpn } : {}),
      ...(mmn ? { manufacturerModelNumber: mmn } : {}),
    });
  }
  for (const requested of wanted) {
    const hit = bySku.get(requested.trim().toLowerCase());
    if (hit) out[requested] = hit;
  }
  return out;
}

/* ---------------- travel, on demand (punch #89) ----------------
   The Estimator used to precompute a travel estimate for EVERY customer and
   venue in the directory and ship the whole map to the client. #84 collapsed
   the query cost (thousands of round trips → 2), but the map itself still
   scaled with the directory: measured at ~1,700 companies it was 5,100
   entries, ~327 KiB of the page's ~1.05 MiB payload, all so the client could
   answer ONE lookup at a time.

   Both client consumers only ever want the current selection —
   `travelEstNow()` for the loaded customer, and `reapplyAutoTrips()` fired
   from the customer/venue pickers with the id the user just chose. So the
   page now precomputes only the loaded quote's own estimate and the client
   asks for the rest here, one selection at a time. */
export async function travelForSelectionAction(
  customerId: string | null,
  locationId: string | null
): Promise<TravelLite | null> {
  await requireUser();
  if (!customerId) return null;
  const est = await travelForId(customerId, locationId || undefined);
  if (!est) return null;
  return {
    miles: est.miles ?? null,
    minutes: est.minutes ?? null,
    officeName: est.office?.name ?? null,
  };
}

/* ---------------- quote tasks (PUNCHLIST #17 remainder) ----------------
   Thin wrappers over the shared tasks store, mirroring projects/actions.ts's
   addTaskAction/setTaskStatusAction/updateTaskAction — same store, same
   shape, kept as separate action functions per-route (each route owns its
   own "use server" file in this app) rather than importing across routes.
   setTaskStatusAction/updateTaskAction there are already parent-agnostic
   (they only ever touch taskId), so only "add" needs a quote-specific
   version — it writes quoteId instead of projectId. */

export async function addQuoteTaskAction(formData: FormData): Promise<{ ok: true } | { ok: false; error: string } | void> {
  const me = await requireUser();
  const quoteId = String(formData.get("quoteId") || "");
  const title = String(formData.get("title") || "").trim();
  const section = String(formData.get("section") || "Review");
  const assigneeUserId = String(formData.get("assigneeUserId") || "") || null;
  const due = String(formData.get("dueAt") || "");
  if (!quoteId || !title) return;
  const assigneeName = assigneeUserId
    ? (await activeUsers()).find((u) => u.id === assigneeUserId)?.name || ""
    : "";
  try {
    await createTask(
      {
        title,
        section,
        quoteId,
        assigneeUserId,
        assigneeName,
        dueAt: due ? new Date(due + "T12:00:00").getTime() : null,
      },
      me
    );
  } catch (error) {
    console.error("addQuoteTaskAction: task mint failed", error);
    return { ok: false, error: "Couldn’t add that task — please try again." };
  }
  revalidatePath("/", "layout");
}

export async function setQuoteTaskStatusAction(formData: FormData) {
  await requireUser();
  const taskId = String(formData.get("taskId") || "");
  const status = String(formData.get("status") || "");
  if (!taskId || !(TASK_STATUSES as readonly string[]).includes(status)) return;
  await setTaskStatusStore(taskId, status as TaskStatus);
  revalidatePath("/", "layout");
}

export async function updateQuoteTaskAction(formData: FormData) {
  await requireUser();
  const taskId = String(formData.get("taskId") || "");
  if (!taskId) return;
  const patch: Record<string, unknown> = {};
  if (formData.has("assigneeUserId")) {
    const uid = String(formData.get("assigneeUserId") || "") || null;
    patch.assigneeUserId = uid;
    patch.assigneeName = uid ? (await activeUsers()).find((u) => u.id === uid)?.name || "" : "";
  }
  if (formData.has("dueAt")) {
    const d = String(formData.get("dueAt") || "");
    patch.dueAt = d ? new Date(d + "T12:00:00").getTime() : null;
  }
  if (formData.has("notes")) patch.notes = String(formData.get("notes") || "");
  await updateTaskStore(taskId, patch);
  revalidatePath("/", "layout");
}

/** Delete a quote task (soft delete). Parent-agnostic like set-status/update
 *  above — only ever touches taskId — but kept as its own per-route wrapper
 *  for the same "use server" convention as the rest of this file. */
export async function removeQuoteTaskAction(formData: FormData) {
  await requireUser();
  const taskId = String(formData.get("taskId") || "");
  if (!taskId) return;
  await removeTaskStore(taskId);
  revalidatePath("/", "layout");
}

/** Apply a reusable task-template set (D149, #118) to this quote — thin
 *  FormData wrapper over task-templates.ts's applyTaskTemplate(), same
 *  no-op-on-bad-input convention as addQuoteTaskAction above. */
export async function applyQuoteTemplateAction(formData: FormData): Promise<{ ok: true } | { ok: false; error: string } | void> {
  const me = await requireUser();
  const quoteId = String(formData.get("quoteId") || "");
  const setId = String(formData.get("setId") || "");
  if (!quoteId || !setId) return;
  try {
    await applyTaskTemplate(setId, { kind: "quote", id: quoteId }, me);
  } catch (error) {
    console.error("applyQuoteTemplateAction: task template failed", error);
    return { ok: false, error: error instanceof Error ? error.message : "Couldn’t apply that template — please try again." };
  }
  revalidatePath("/", "layout");
}
