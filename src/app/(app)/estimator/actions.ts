"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import {
  approve,
  attestApproval,
  claimReview,
  create,
  get,
  getAll,
  requestChanges,
  requireApprovalToAdvance,
  setStatus,
  STAGES,
  submitForReview,
  update,
  validateAttestationNote,
  canAttestApproval,
  type Quote,
  type QuoteReview,
  type QuoteStatus,
} from "@/lib/stores/quotes";
import { travelForId } from "@/lib/stores/customers";
import type { QuoteLite, TravelLite } from "./types";
import type { DraftedLine } from "./ai-scope-modal";
import { get as getSurvey, type SurveyRecord } from "@/lib/stores/surveys";
import {
  get as getInspection,
  type InspectionRecord,
} from "@/lib/stores/inspections";
import { list as catalogList, mergeUpsert } from "@/lib/stores/catalog";
import type { CatalogSearch, PaymentTerms, SpecMob, SpecSection, VendorQuote } from "./types";
import { blobEnabled, dataUrlToBytes, putBlob, safeName } from "@/lib/blob";
import { VENDOR_QUOTE_BLOB_PREFIX, ownsVendorQuoteBlobPath } from "@/lib/vendor-quote-file";
import type { SuggestPart } from "./estimator-data";
import { totals } from "./pricing";
import { activeUsers } from "@/lib/users";

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
  spec?: { sections: SpecSection[]; mobs: SpecMob[] };
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
  sections: SpecSection[];
  mobs: SpecMob[];
  /** Always sent in full (#143) — the stored list is replaced, so removing a
   *  vendor quote in the builder actually removes it from the doc. */
  vendorQuotes: VendorQuote[];
};

export type SaveResult = {
  ok: boolean;
  id: string | null;
  revNum: number;
  updatedAt: number;
  review: QuoteReview | null;
  status: QuoteStatus | null;
  /** What was actually stored (#143) — attachments moved into Blob storage
   *  come back as blobPath so the next save doesn't re-upload the bytes. */
  vendorQuotes?: VendorQuote[];
  /** Set on `ok: false` when the record was created but a requested status
   *  transition was refused (punch #60: setStatus's approval gate). */
  error?: string;
};

export type ReviewSync = {
  ok: boolean;
  review: QuoteReview | null;
  status: QuoteStatus | null;
  /** Set on `ok: false` — a typed, UI-displayable reason (punch #60: never a
   *  raw thrown exception for an expected rejection like "not yet approved"). */
  error?: string;
};

function refresh() {
  revalidatePath("/", "layout");
}

async function syncOf(id: string): Promise<ReviewSync> {
  const q = await get(id);
  return { ok: !!q, review: q?.review ?? null, status: q?.status ?? null };
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
    value: payload.value,
    margin: payload.margin,
    status: payload.status,
    source: "estimator",
    spec: { sections: payload.sections, mobs: payload.mobs },
  };
  let q: Quote | null = null;
  let statusError: string | undefined;
  /* #143: keep only the vendor quotes something still references. Deleting a
     system, or moving one to another estimate, would otherwise strand its
     record — and its attachment — on this document forever.

     "Something" is NOT just the live spec (#143 re-review): every recallable
     revision names records too, and with Blob storage off the data-URL in the
     record is the only copy of the vendor's file. Pruning a record a sent
     revision still points at would make that revision unrecallable — the line
     would come back priced but anonymous — so those keep their STORED copy,
     while the builder's own copy wins for anything a live line references. */
  const liveVq = vendorIdsInSections(payload.sections);
  const prior = loadedId ? await get(loadedId) : null;
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
        revNum: 1,
        updatedAt: Date.now(),
        review: null,
        status: null,
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
    } as QuotePatch);
    if (payload.status !== "draft") {
      // Punch #60: setStatus's approval gate now applies here too. A brand
      // new quote can never already carry an approval record, so this can
      // only succeed for "lost" — and "won"/"sent" would always be refused.
      // Catch rather than let a raw exception blow up an otherwise-successful
      // save: the quote stays created (in draft), just not advanced.
      try {
        q = await setStatus(created.id, payload.status);
      } catch (e) {
        statusError = e instanceof Error ? e.message : "That status change was refused.";
      }
    }
    q = q || created;
  }
  refresh();
  return {
    ok: !!q && !statusError,
    id: q?.id ?? null,
    revNum: Math.max(1, q?.revisions?.length || 1),
    updatedAt: q?.updatedAt ?? Date.now(),
    review: q?.review ?? null,
    status: q?.status ?? null,
    vendorQuotes: storedVendorQuotes,
    ...(statusError ? { error: statusError } : {}),
  };
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
  const q = (query || "").trim().toLowerCase();
  const pool = (await getAll()).filter((quote) => quote.id !== excludeId);
  const matched = q
    ? pool.filter(
        (quote) =>
          quote.name.toLowerCase().includes(q) || quote.customer.toLowerCase().includes(q)
      )
    : pool;
  return matched.slice(0, Math.max(1, limit)).map((quote) => ({
    id: quote.id,
    name: quote.name,
    customer: quote.customer,
    status: quote.status,
    updatedAt: quote.updatedAt,
  }));
}

export type MoveSystemTarget = { kind: "new" } | { kind: "existing"; quoteId: string };

export type MoveSystemResult =
  | { ok: true; targetId: string; targetName: string }
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
  const moved: SpecSection = { ...section, id: "sys" + Date.now() };
  // Trust the section, not the caller's list: only records this section's own
  // items name travel. Ids are globally unique (Date.now + random), so they
  // are carried as-is and can never shadow a record already on the target.
  const movedIds = vendorIdsInSections([moved]);
  const movedVq = vendorQuoteRows(vendorQuotes).filter((vq) => movedIds.has(vq.id));

  if (target.kind === "existing") {
    const existing = await get(target.quoteId);
    if (!existing) {
      return { ok: false, error: "That estimate could not be found." };
    }
    const existingSpec = existing.spec as
      | { sections?: SpecSection[]; mobs?: SpecMob[] }
      | null
      | undefined;
    const mergedSections = [...(existingSpec?.sections || []), moved];
    const t = totals(mergedSections, 0);
    const carried = movedVq.length
      ? await storeVendorQuotes(target.quoteId, movedVq)
      : [];
    const updated = await update(target.quoteId, {
      spec: { sections: mergedSections, mobs: existingSpec?.mobs || [] },
      value: t.grand,
      margin: t.margin,
      ...(carried.length
        ? {
            vendorQuotes: [
              ...vendorQuoteRows(existing.vendorQuotes).filter((vq) => !movedIds.has(vq.id)),
              ...carried,
            ],
          }
        : {}),
    } as QuotePatch);
    if (!updated) {
      return { ok: false, error: "That estimate could not be found." };
    }
    refresh();
    return { ok: true, targetId: updated.id, targetName: updated.name };
  }

  const t = totals([moved], 0);
  let created: Quote;
  try {
    created = await create({
      name: moved.name + " (moved)",
      customer: sourceContext.customer,
      customerId: sourceContext.customerId,
      locationId: sourceContext.locationId,
      source: "estimator",
      status: "draft",
      spec: { sections: [moved], mobs: [] },
      value: t.grand,
      margin: t.margin,
      owner: user.name,
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
    contactName: sourceContext.contactName || "",
    // Same as saveQuoteAction's fresh-create path: the Blob path can only be
    // keyed by the real quote id, which exists for the first time here.
    ...(movedVq.length
      ? { vendorQuotes: await storeVendorQuotes(created.id, movedVq) }
      : {}),
  } as QuotePatch);
  refresh();
  return { ok: true, targetId: created.id, targetName: (withContact || created).name };
}

/** Header fields persisted immediately as they change (prototype behavior). */
export async function updateQuoteMetaAction(
  id: string,
  meta: {
    name?: string;
    customerId?: string | null;
    locationId?: string | null;
    customer?: string;
    contactName?: string;
    quoteNote?: string;
    assumptions?: string;
    installTimeframe?: string;
    category?: string;
  }
): Promise<{ ok: boolean; pricingTier?: string; tierMargin?: number }> {
  await requireUser();
  if (!id) return { ok: false };
  // Allowlist the header fields only — never forward the raw client object.
  // The runtime type is not enforced by TS, so a caller could otherwise slip
  // in `review`/`status`/`value`/`owner` and self-approve or re-price a quote,
  // bypassing the permission-gated review actions below. Approval/status/price
  // changes have their own checked mutators (approveReviewAction, setStatus…).
  const patch: QuotePatch = {};
  if (typeof meta.name === "string") patch.name = meta.name.trim();
  if ("customerId" in meta) patch.customerId = meta.customerId;
  if ("locationId" in meta) patch.locationId = meta.locationId;
  if (typeof meta.customer === "string") patch.customer = meta.customer;
  if (typeof meta.contactName === "string") patch.contactName = meta.contactName;
  if (typeof meta.quoteNote === "string") patch.quoteNote = meta.quoteNote;
  if (typeof meta.assumptions === "string") patch.assumptions = meta.assumptions;
  if (typeof meta.installTimeframe === "string") patch.installTimeframe = meta.installTimeframe.trim();
  if (typeof meta.category === "string") patch.category = meta.category.trim();

  // Item 11 (D87): a customer/contact change re-resolves the pricing tier
  // SERVER-side (never trusted from the client) and re-stamps the quote.
  // The stamp SEEDS pricing tools; it never rewrites existing line prices.
  let stamped: { pricingTier: string; tierMargin: number } | null = null;
  if ("customerId" in meta || typeof meta.contactName === "string") {
    const { get: getQuote } = await import("@/lib/stores/quotes");
    const cur = await getQuote(id);
    const effCustomerId =
      "customerId" in meta ? (meta.customerId ?? null) : (cur?.customerId ?? null);
    const effContact =
      typeof meta.contactName === "string"
        ? meta.contactName
        : ((cur as { contactName?: string } | null)?.contactName ?? "");
    const { resolveTier } = await import("@/lib/pricing-tiers");
    const r = await resolveTier(effCustomerId, effContact);
    patch.pricingTier = r.tier;
    patch.tierMargin = r.margin;
    stamped = { pricingTier: r.tier, tierMargin: r.margin };
  }

  const q = await update(id, patch);
  refresh();
  return { ok: !!q, ...(stamped ?? {}) };
}

export async function setStatusAction(
  id: string,
  status: QuoteStatus
): Promise<ReviewSync> {
  await requireUser();
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
    const gate = requireApprovalToAdvance(cur?.review ?? null, status === "won" ? "won" : "send");
    if (!gate.ok) {
      return {
        ok: false,
        review: cur?.review ?? null,
        status: cur?.status ?? null,
        error: gate.error,
      };
    }
  }
  try {
    await setStatus(id, status);
  } catch (e) {
    const cur = await get(id);
    return {
      ok: false,
      review: cur?.review ?? null,
      status: cur?.status ?? null,
      error: e instanceof Error ? e.message : "That status change was refused.",
    };
  }
  refresh();
  return syncOf(id);
}

export async function submitReviewAction(
  id: string,
  reviewer: string | null
): Promise<ReviewSync> {
  const user = await requireUser();
  if (!id) return { ok: false, review: null, status: null };
  await submitForReview(id, { by: user.name, reviewer: reviewer || null });
  refresh();
  return syncOf(id);
}

export async function claimReviewAction(id: string): Promise<ReviewSync> {
  const user = await requireUser();
  if (!id || !can("approve", user.roles))
    return { ok: false, review: null, status: null };
  await claimReview(id, user.name);
  refresh();
  return syncOf(id);
}

export async function approveReviewAction(id: string): Promise<ReviewSync> {
  const user = await requireUser();
  if (!id || !can("approve", user.roles))
    return { ok: false, review: null, status: null };
  await approve(id, { by: user.name });
  refresh();
  return syncOf(id);
}

export async function requestChangesAction(
  id: string,
  note: string
): Promise<ReviewSync> {
  const user = await requireUser();
  if (!id || !can("approve", user.roles) || !(note || "").trim())
    return { ok: false, review: null, status: null };
  await requestChanges(id, { by: user.name, note: note.trim() });
  refresh();
  return syncOf(id);
}

/**
 * "Send to customer →" — moves the approved quote to sent (prototype port).
 *
 * Punch #60 (D84 hole): this used to be `requireUser()` and nothing else —
 * ANY signed-in user could send an unreviewed quote, because the review gate
 * was UI-only (the button was just hidden). Now it requires an approval
 * record — in-app (someone with `approve` used the review queue) OR
 * attested (the estimator self-approved with a mandatory note naming who
 * reviewed it and how, e.g. a phone call). See `requireApprovalToAdvance`.
 */
export async function sendToCustomerAction(id: string): Promise<ReviewSync> {
  await requireUser();
  if (!id) return { ok: false, review: null, status: null };
  const cur = await get(id);
  const gate = requireApprovalToAdvance(cur?.review ?? null, "send");
  if (!gate.ok) {
    return {
      ok: false,
      review: cur?.review ?? null,
      status: cur?.status ?? null,
      error: gate.error,
    };
  }
  // setStatus() also enforces this same gate internally now (punch #60
  // follow-up — moved into the store so every caller inherits it); the
  // try/catch is a backstop that should never actually fire given the
  // pre-check above, not a second source of truth.
  try {
    await setStatus(id, "sent");
  } catch (e) {
    return {
      ok: false,
      review: cur?.review ?? null,
      status: cur?.status ?? null,
      error: e instanceof Error ? e.message : "That status change was refused.",
    };
  }
  refresh();
  return syncOf(id);
}

/**
 * Attested approval (punch #60): the estimator approves their OWN quote by
 * naming who actually reviewed it and how (a phone call, a Teams review,
 * etc.) rather than routing it through the in-app review queue. Deliberately
 * NOT gated on `can("approve", ...)` — real reviews here often happen
 * verbally and the estimator is frequently a different person from the
 * reviewer, so a hard permission gate would block legitimate work. The note
 * is the only thing that makes the approval attributable to a named human,
 * so it is mandatory and validated server-side (`validateAttestationNote`) —
 * an empty or whitespace-only note is rejected, not silently accepted.
 */
export async function attestApprovalAction(
  id: string,
  note: string
): Promise<ReviewSync> {
  const user = await requireUser();
  if (!id) return { ok: false, review: null, status: null };
  const cur = await get(id);
  if (!cur) return { ok: false, review: null, status: null, error: "Quote not found." };
  // Punch #60: ownership is enforced HERE, on the server — not by hiding the
  // button. The UI only offers "Attest approval" to the quote's owner
  // (`rbCanAttest`), but a hidden control is not an access control; that was
  // the original defect. Attesting is self-approval, so it is limited to the
  // estimator whose quote it is. Anyone holding `approve` may also attest —
  // they could approve it outright through the review queue anyway.
  if (cur.owner !== user.name && !can("approve", user.roles)) {
    return {
      ok: false,
      review: cur.review ?? null,
      status: cur.status ?? null,
      error: "Only the quote's owner can attest an approval on it.",
    };
  }
  // Punch #60 (Jeff 2026-08-01): attestation records an OFF-platform review;
  // it is not a way around an in-app one. A formal "request changes" blocks
  // it until the author resubmits.
  const attestable = canAttestApproval(cur.review ?? null);
  if (!attestable.ok) {
    return {
      ok: false,
      review: cur.review ?? null,
      status: cur.status ?? null,
      error: attestable.error,
    };
  }
  const validated = validateAttestationNote(note);
  if (!validated.ok) {
    return {
      ok: false,
      review: cur.review ?? null,
      status: cur.status ?? null,
      error: validated.error,
    };
  }
  const updated = await attestApproval(id, { by: user.name, note: validated.note });
  if (!updated) {
    return { ok: false, review: null, status: null, error: "Quote not found." };
  }
  refresh();
  return syncOf(id);
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
 * In-memory substring match over sku/desc/mfr (optionally scoped to a category),
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
    .filter((p) => (cat ? (p.category || "") === cat : true))
    .map((p) => {
      const sku = (p.sku || "").toLowerCase();
      const desc = (p.desc || "").toLowerCase();
      const mfr = (p.mfr || "").toLowerCase();
      const cat = (p.category || "").toLowerCase();
      if (!q) return { p, score: 0 };
      let score = -1;
      if (sku === q || desc === q) score = 5;
      else if (sku.startsWith(q) || desc.startsWith(q)) score = 4;
      else if (desc.includes(q) || sku.includes(q)) score = 2;
      else if (cat.includes(q) || mfr.includes(q)) score = 1;
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
  }));
  return { hits, total: scored.length };
}

export type ResolvedCatalogSku = { sku: string; desc: string; unit: string; cost: number; list: number };

/**
 * Bulk SKU lookup for the estimator's CSV batch-add (PUNCHLIST #112). Matches
 * each requested SKU (trimmed, case-insensitive) against the catalog and
 * returns a map keyed by the SKU string exactly as the caller passed it, so
 * the importer can price catalog parts from a sku + quantity CSV. Unknown
 * SKUs are simply absent. Input is capped at 2000 SKUs per call.
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
    bySku.set(key, {
      sku: p.sku,
      desc: p.desc || "",
      unit: p.unit || "ea",
      cost: p.cost || 0,
      list: p.list || 0,
    });
  }
  for (const requested of wanted) {
    const hit = bySku.get(requested.trim().toLowerCase());
    if (hit) out[requested] = hit;
  }
  return out;
}

/**
 * Catalog-backed quick-add suggestions for a section (PUNCHLIST #14, decision
 * B — replaces the hardcoded SUGGEST/GENERIC_SUGGEST arrays, which listed
 * SKUs that mostly didn't exist in the real catalog). Exact match (trimmed,
 * case-insensitive) on `mfr` — sections now carry an editable manufacturer,
 * so this only returns anything once one is set. Empty input -> empty
 * result rather than an unfiltered top-N, matching decision B's spirit: a
 * real, validated suggestion or nothing, never a guess.
 */
export async function suggestPartsForMfr(mfr: string, limit = 4): Promise<SuggestPart[]> {
  await requireUser();
  const m = (mfr || "").trim().toLowerCase();
  if (!m) return [];

  const parts = await catalogList();
  return parts
    .filter((p) => (p.mfr || "").trim().toLowerCase() === m)
    .sort((a, b) => (a.desc || "").localeCompare(b.desc || ""))
    .slice(0, Math.max(1, limit))
    .map((p) => ({
      sku: p.sku,
      desc: p.desc,
      cost: p.cost || 0,
      price: p.list || 0,
      unit: p.unit || "ea",
    }));
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

export async function addQuoteTaskAction(formData: FormData) {
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

/** Apply a reusable task-template set (D149, #118) to this quote — thin
 *  FormData wrapper over task-templates.ts's applyTaskTemplate(), same
 *  no-op-on-bad-input convention as addQuoteTaskAction above. */
export async function applyQuoteTemplateAction(formData: FormData) {
  const me = await requireUser();
  const quoteId = String(formData.get("quoteId") || "");
  const setId = String(formData.get("setId") || "");
  if (!quoteId || !setId) return;
  await applyTaskTemplate(setId, { kind: "quote", id: quoteId }, me);
  revalidatePath("/", "layout");
}
