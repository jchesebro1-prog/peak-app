/**
 * Estimator handoff — the quote lifecycle rules of src/lib/stores/quotes.ts, ported as PURE functions
 * (that module reaches the database, so it can never be bundled). Field names, id format (Q-#### from
 * 2041), review records, history entries, revisions and the approval gate are copied verbatim; each
 * function names its original. What the prototype leaves out — the install spawn, the Rewards ledger,
 * PDFs, assignments, the system-library index — lives in the store-side caller (quote-repo.ts), not here.
 * Plan: PR 2 Task 4.
 */
import type { EstimateEmailEntry, Quote, QuoteHistoryEntry, QuoteReview, QuoteRevision, QuoteRevisionDocFields, QuoteStatus, ReviewOpts } from "@/lib/stores/quotes";
import type { SpecSection } from "@/lib/estimating-core/types";
import { normalizePackageSelection } from "@/lib/estimate-output/package-selection";
import { withoutEstimateFields } from "@/lib/estimate-number";
import { isBoxSaleQuoteType, isBoxSaleSource } from "@/lib/estimate-box-sale/rules";
import { grossQuoteValue, quoteRewardCredit, withRewardCredit, withoutRewardCredit } from "@/lib/rewards/credit-line";
import { serviceCreditSubdocKey } from "@/lib/rewards/service-credit";
import { cleanPackageFiles } from "@/lib/estimate-output/package-files";
import { latestSentRevision, nextSendRevNo } from "@/lib/quote-pdf/state";
import { REOPEN_AUTOSAVE_NOTE, reopenTarget, sameWonContent, tracksWonVersion, WON_SNAPSHOT_NOTE, isReopen, wonRevision } from "@/lib/quote-won-version";
import { carriesPipeline, firstStage, quotePipelineFor, quoteStageForStatus, type Pipelines, type QuotePipeline } from "@/lib/pipelines";
import { approvalHolds, approverOnTransition, autoSnapshotStale, canAutoApprove, NO_REVIEW_LIMITS, quoteOwnerName, type AutoApprovalEval, type ReviewLimitContext } from "@/lib/review-limits";
import { approvalFingerprint } from "@/lib/approval-snapshot";
import { totals } from "@/lib/estimating-core/pricing";
import { repriceForRevise, type RepriceCatalogPart } from "@/lib/estimate-reprice/rules";
import type { BonusRates } from "@/lib/estimate-bonus/flags";
import { isBonusEligibleQuote } from "@/lib/estimate-bonus/rules";
import { buildBonusRecord, defaultAlternatesTaken, quoteHasBonusLines } from "@/lib/estimate-bonus/record";

/* ------------------------------------------------------------------ stages */

export const STAGES = ["draft", "sent", "won", "lost"] as const satisfies readonly QuoteStatus[];

export const STAGE_LABEL: Record<QuoteStatus, string> = { draft: "Draft", sent: "Sent", won: "Won", lost: "Lost" };

/** quotes.ts DEFAULT_ACTOR — the literal fallback when no actor is passed. */
export const DEFAULT_ACTOR = "Jeff Chesebro";

export const isQuoteStatus = (s: unknown): s is QuoteStatus => typeof s === "string" && (STAGES as readonly string[]).includes(s);

export type SaveStatusDecision =
  | { kind: "apply" }
  | { kind: "unchanged" }
  | { kind: "stalePassive"; notice: string }
  | { kind: "staleConflict"; error: string };

/** quotes.ts resolveSaveStatusChange — verbatim. */
export function resolveSaveStatusChange(payloadStatus: QuoteStatus, baseStatus: QuoteStatus, currentStatus: QuoteStatus): SaveStatusDecision {
  if (payloadStatus === currentStatus) return { kind: "unchanged" };
  if (payloadStatus !== baseStatus && currentStatus === baseStatus) return { kind: "apply" };
  if (payloadStatus === baseStatus) {
    return {
      kind: "stalePassive",
      notice: `This quote's status changed elsewhere while you had it open — it's now "${STAGE_LABEL[currentStatus]}". Your edits saved normally.`,
    };
  }
  return {
    kind: "staleConflict",
    error: `This quote's status changed elsewhere since you last saw it — it's "${STAGE_LABEL[currentStatus]}", not "${STAGE_LABEL[payloadStatus]}". Your other edits saved; the status shown here has been refreshed.`,
  };
}

/* ------------------------------------------------------------------ ids */

/** doc-store nextPrefixedId("quotes", "Q", 2041): one past the highest Q-<n> (and the last minted), at least Q-2042. Pure. */
export function nextQuoteId(ids: Iterable<string>, lastMinted: number | null = null): { id: string; n: number } {
  let max = 2041;
  for (const id of ids) {
    const m = /^Q-(\d+)$/.exec(id);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  if (typeof lastMinted === "number" && Number.isFinite(lastMinted)) max = Math.max(max, lastMinted);
  return { id: `Q-${max + 1}`, n: max + 1 };
}

/* ------------------------------------------------------------------ build / update */

function rv(state: QuoteReview["state"], o: Partial<QuoteReview> = {}): QuoteReview {
  return {
    state,
    reviewer: o.reviewer || null,
    submittedBy: o.submittedBy || null,
    submittedAt: o.submittedAt || null,
    decidedBy: o.decidedBy || null,
    decidedAt: o.decidedAt || null,
    note: o.note || "",
    method: o.method ?? null,
    approvedAgainst: o.approvedAgainst ?? null,
  };
}

/** quotes.ts buildQuote — the document create() writes. Pure. */
export function buildQuote(id: string, partial: Partial<Quote>, quoteType: string, pl: QuotePipeline | null, t: number): Quote {
  return {
    id,
    name: partial.name || "Untitled estimate",
    customer: partial.customer || "",
    customerId: partial.customerId || null,
    locationId: partial.locationId || null,
    contactName: partial.contactName || "",
    quoteNote: partial.quoteNote || "",
    scopeNarrative: partial.scopeNarrative || "",
    quoteBasis: partial.quoteBasis || "",
    preparedBy: partial.preparedBy || partial.owner || "",
    assumptions: partial.assumptions || "",
    termsText: partial.termsText || "",
    value: Math.round(partial.value || 0),
    margin: partial.margin || 0,
    pricingBasis: "markup", // #367: a doc the prototype builds is markup-basis (doc-basis.ts honours the stamp)
    pricingTier: partial.pricingTier ?? null,
    tierMargin: partial.tierMargin ?? null,
    status: "draft",
    source: partial.source || "quick",
    quoteType,
    category: partial.category || "",
    flameTest: partial.flameTest || null,
    repair: partial.repair || null,
    inspection: partial.inspection || null,
    consulting: partial.consulting || null,
    rental: partial.rental || null,
    contact: partial.contact || null,
    owner: partial.owner || DEFAULT_ACTOR,
    spec: partial.spec || null,
    renewalOf: partial.renewalOf || null,
    poReceivedAt: partial.poReceivedAt ?? null,
    review: rv("none"),
    createdAt: t,
    updatedAt: t,
    history: [{ at: t, to: "draft" }],
    ...(pl ? { pipelineId: pl.id, stage: firstStage(pl).id } : {}),
    ...(partial.leadId ? { leadId: partial.leadId } : {}),
    ...(typeof partial.coverSummary === "string" ? { coverSummary: partial.coverSummary } : {}),
    ...(typeof partial.notIncluded === "string" ? { notIncluded: partial.notIncluded } : {}),
    ...(partial.packageSelection ? { packageSelection: normalizePackageSelection(partial.packageSelection) } : {}),
    ...(Array.isArray(partial.findingKeys) && partial.findingKeys.length ? { findingKeys: partial.findingKeys } : {}),
    // Box goods sale: only a true on a system quote — every other creator writes the doc it wrote before.
    ...(partial.boxSale === true && isBoxSaleQuoteType(quoteType) && isBoxSaleSource(partial.source) ? { boxSale: true } : {}),
  };
}

/** The fields quotes.ts update() never lets a patch write — each has its own writer. */
export const UPDATE_OWNED_FIELDS = [
  "shareLink", "shareOpens", "wonRev", "packageFiles", "clientResponses", "bonusRecord", "estimatorBonusSplit", "packagePeakHeader",
  "pricingBasis", "repricedOnRevise", "bid", "bidScopeOnly", "estimateEmails", "packageSelection", "reviewComments", "emailSending", "findingKeys", "assistNudge", "assistNudgeLeaseUntil",
] as const;

/** quotes.ts update()'s mutator: the patch shallow-merged (numbers and owned fields stripped), updatedAt bumped, value rounded. Mutates `doc`. */
export function applyUpdate(doc: Quote, patch: Partial<Quote>, now: number): Quote {
  const clean = withoutEstimateFields(patch) as Partial<Quote> & Record<string, unknown>;
  for (const k of UPDATE_OWNED_FIELDS) delete clean[k];
  // Box goods sale: stored only as true on a system quote; false (or any other type) removes the key, so turning
  // it off leaves exactly a normal estimate's doc. A patch without the key leaves it alone.
  if ("boxSale" in clean) {
    const on = clean.boxSale === true && isBoxSaleQuoteType(clean.quoteType ?? doc.quoteType) && isBoxSaleSource(clean.source ?? doc.source);
    delete clean.boxSale;
    if (on) doc.boxSale = true;
    else delete doc.boxSale;
  }
  Object.assign(doc, clean, { updatedAt: now });
  if (typeof doc.value === "number") doc.value = Math.round(doc.value);
  return doc;
}

/* ------------------------------------------------------------------ revisions */

/** quotes.ts revisionDocFields — the header fields a revision freezes. Pure. */
export function revisionDocFields(doc: Quote): QuoteRevisionDocFields {
  const d = doc as Quote & { paymentTerms?: string | null };
  return {
    customer: d.customer || "",
    locationId: d.locationId ?? null,
    contactName: typeof d.contactName === "string" ? d.contactName : null,
    quoteNote: d.quoteNote || "",
    assumptions: d.assumptions || "",
    installTimeframe: d.installTimeframe || "",
    preparedBy: d.preparedBy || "",
    owner: d.owner || "",
    termsText: d.termsText || "",
    paymentTerms: typeof d.paymentTerms === "string" ? d.paymentTerms : null,
    pdfOptions: d.pdfOptions ?? null,
    portalFirm: d.portalFirm ?? null,
    source: d.source || "",
    coverSummary: d.coverSummary || "",
    notIncluded: typeof d.notIncluded === "string" ? d.notIncluded : null,
    packageFiles: cleanPackageFiles(d.packageFiles),
    ...(d.packageSelection ? { packageSelection: normalizePackageSelection(d.packageSelection) } : {}),
    awardedPartyId: d.bid?.awardedPartyId ?? null,
    ...(d.bid ? { bid: { ...d.bid, addenda: [...(d.bid.addenda || [])] } } : {}),
    // Box goods sale: only when on — a normal estimate's revision is byte-identical.
    ...(d.boxSale === true ? { boxSale: true } : {}),
  };
}

/** quotes.ts snapshotOf — the quote's priced state as a revision. Pure. */
export function snapshotOf(doc: Quote, rev: number, by: string, reason: QuoteRevision["reason"], note: string, now: number): QuoteRevision {
  return {
    rev,
    at: now,
    by,
    reason,
    note,
    name: doc.name,
    customerId: doc.customerId ?? null,
    value: doc.value,
    margin: doc.margin,
    pricingTier: doc.pricingTier ?? null,
    tierMargin: doc.tierMargin ?? null,
    status: doc.status,
    quoteType: doc.quoteType,
    spec: doc.spec ?? null,
    flameTest: doc.flameTest ?? null,
    repair: doc.repair ?? null,
    inspection: doc.inspection ?? null,
    consulting: doc.consulting ?? null,
    rental: doc.rental ?? null,
    vendorQuotes: doc.vendorQuotes ?? null,
    docFields: revisionDocFields(doc),
  };
}

/** quotes.ts pushRevision — appends a snapshot (a "sent" one stamps the next Rev). Mutates `doc`. */
export function pushRevision(doc: Quote, by: string, reason: QuoteRevision["reason"], note: string, now: number): QuoteRevision {
  const revs = Array.isArray(doc.revisions) ? doc.revisions : [];
  const r = snapshotOf(doc, revs.length + 1, by, reason, note, now);
  if (reason === "sent" && r.docFields) r.docFields = { ...r.docFields, revNo: nextSendRevNo(revs) };
  doc.revisions = [...revs, r];
  return r;
}

type IdedRecord = { id?: unknown };
const vendorQuoteRows = (raw: unknown): IdedRecord[] => (Array.isArray(raw) ? (raw as IdedRecord[]).filter((v) => !!v && typeof v === "object") : []);

/** quotes.ts mergeVendorQuotes — union by id, `incoming` wins. Pure. */
export function mergeVendorQuotes(current: unknown, incoming: unknown): unknown {
  const rows = vendorQuoteRows(incoming);
  if (!rows.length) return current ?? null;
  const byId = new Map<string, IdedRecord>();
  [...vendorQuoteRows(current), ...rows].forEach((v) => {
    if (typeof v.id === "string") byId.set(v.id, v);
  });
  return [...byId.values()];
}

/* ------------------------------------------------------------------ Rewards credit (the line only — the ledger is not in the prototype) */

/** quotes.ts clearRewardCredit — a lost quote carries no credit; value back to the gross. Mutates `doc`. */
export function clearRewardCredit(doc: Quote): void {
  const credit = quoteRewardCredit(doc);
  if (!(credit > 0)) return;
  const gross = grossQuoteValue(doc);
  const key = serviceCreditSubdocKey(doc.quoteType);
  const sub = key ? doc[key] : null;
  if (key && sub && typeof sub === "object" && "rewardCredit" in sub) {
    const next = { ...(sub as Record<string, unknown>) };
    delete next.rewardCredit;
    doc[key] = next;
  }
  const spec = doc.spec as { sections?: unknown } | null | undefined;
  if (spec && typeof spec === "object" && Array.isArray(spec.sections)) {
    doc.spec = { ...spec, sections: withoutRewardCredit(spec.sections as SpecSection[]) };
  }
  doc.value = gross;
}

/** quotes.ts withRestoredCredit — exactly `credit` on a recalled quote. Mutates `doc`. */
export function withRestoredCredit(doc: Quote, credit: number): void {
  const key = serviceCreditSubdocKey(doc.quoteType);
  if (key) {
    const sub = doc[key];
    if (!sub || typeof sub !== "object") return;
    const next = { ...(sub as Record<string, unknown>) };
    if (credit > 0) next.rewardCredit = credit;
    else delete next.rewardCredit;
    doc[key] = next;
    return;
  }
  const spec = doc.spec as { sections?: unknown } | null | undefined;
  if (!spec || typeof spec !== "object" || !Array.isArray(spec.sections)) return;
  const sections = spec.sections as SpecSection[];
  const maxId = sections.reduce((m, sec) => Math.max(m, ...((sec?.items || []) as { id?: unknown }[]).map((it) => (typeof it?.id === "number" ? it.id : 0))), 0);
  doc.spec = { ...spec, sections: withRewardCredit(sections, credit, maxId + 1) };
}

/* ------------------------------------------------------------------ reopen at the won version (Batch 5 #59) */

export type ReopenPlan = { target: QuoteRevision; credit: number; gross: number; rewrite: (s: unknown) => unknown };

/**
 * quotes.ts reopenPlanFor, with the Rewards credit fixed at 0 (the prototype has no ledger, and
 * applying credit is off): the won revision to put back when a won quote moves to draft/sent and
 * the live quote no longer matches it, else null. Pure.
 */
export function reopenPlanFor(q: Quote, status: QuoteStatus, rewrite: (s: unknown) => unknown = (s) => s): ReopenPlan | null {
  if (!isReopen(q.status, status) || !tracksWonVersion(q) || !wonRevision(q)) return null;
  const target = reopenTarget(q, status, rewrite);
  if (!target) return null;
  return { target, credit: 0, gross: grossQuoteValue({ ...target, quoteType: target.quoteType ?? q.quoteType }), rewrite };
}

/** quotes.ts applyReopen — the plan's version on `doc` (priced fields; the header stays). Mutates `doc`. */
export function applyReopen(doc: Quote, plan: ReopenPlan): void {
  const target = plan.target;
  doc.name = target.name;
  doc.value = Math.round(Math.max(0, plan.gross - plan.credit));
  doc.margin = target.margin;
  doc.pricingTier = target.pricingTier ?? doc.pricingTier ?? null;
  doc.tierMargin = target.tierMargin ?? doc.tierMargin ?? null;
  doc.spec = plan.rewrite(target.spec ?? null) ?? null;
  doc.flameTest = target.flameTest ?? null;
  doc.repair = target.repair ?? null;
  doc.inspection = target.inspection ?? null;
  doc.consulting = target.consulting ?? null;
  doc.rental = target.rental ?? null;
  withRestoredCredit(doc, plan.credit);
  doc.vendorQuotes = mergeVendorQuotes(doc.vendorQuotes, target.vendorQuotes);
}

/** quotes.ts asReopened — what the approval gate judges. Pure. */
export function asReopened(q: Quote, plan: ReopenPlan | null): Quote {
  if (!plan) return q;
  const copy: Quote = { ...q };
  applyReopen(copy, plan);
  return copy;
}

/* ------------------------------------------------------------------ the approval gate (#60, #242, #284, #287) */

export type ApprovalGateAction = "send" | "won";
export type ApprovalGateResult = { ok: true } | { ok: false; error: string };

/** quotes.ts requireApprovalToAdvance — verbatim. */
export function requireApprovalToAdvance(review: QuoteReview | null | undefined, action: ApprovalGateAction): ApprovalGateResult {
  if (!!review && review.state === "approved") return { ok: true };
  return {
    ok: false,
    error:
      action === "send"
        ? "This quote needs an approval on record before it can be sent to the customer."
        : "This quote needs an approval on record before it can be marked Won.",
  };
}

export type SetStatusOpts = {
  bypassApprovalGate?: "engine-owned-flow" | "historical-import" | "portal-firm";
  expectUpdatedAt?: number;
  alternatesTaken?: string[];
};

/** quotes.ts resolveStatusGate — verbatim. */
export function resolveStatusGate(status: QuoteStatus, review: QuoteReview | null | undefined, opts: SetStatusOpts = {}): ApprovalGateResult {
  if (opts.bypassApprovalGate === "engine-owned-flow" || opts.bypassApprovalGate === "historical-import") return { ok: true };
  if (opts.bypassApprovalGate === "portal-firm" && status === "sent") return { ok: true };
  if (status !== "won" && status !== "sent") return { ok: true };
  return requireApprovalToAdvance(review, status === "won" ? "won" : "send");
}

/** quotes.ts autoApprovedReview — verbatim. */
export function autoApprovedReview(ev: AutoApprovalEval, now: number, actor?: string | null, trigger?: "sent" | "won"): QuoteReview {
  const by = (actor || "").trim();
  return {
    state: "approved",
    reviewer: null,
    submittedBy: ev.ownerName || null,
    submittedAt: now,
    decidedBy: ev.ownerName || null,
    decidedAt: now,
    note: "",
    method: "auto_limit",
    approvedAgainst: null,
    auto: { kind: ev.kind, limit: ev.limit, value: ev.value, ...(by ? { triggeredBy: by } : {}), ...(by && trigger ? { trigger } : {}) },
  };
}

/** quotes.ts approverReview — verbatim. */
export function approverReview(approver: { by: string; method: "self" | "in_app" }, q: Quote, now: number): QuoteReview {
  const r = q.review;
  const inReview = r?.state === "in_review";
  const self = approver.method === "self";
  return {
    state: "approved",
    reviewer: approver.by,
    submittedBy: self ? quoteOwnerName(q) || approver.by : inReview ? r?.submittedBy || null : null,
    submittedAt: self ? now : inReview ? r?.submittedAt || null : null,
    decidedBy: approver.by,
    decidedAt: now,
    note: "",
    method: approver.method,
    auto: null,
    approvedAgainst: approvalFingerprint(q),
  };
}

export type ApprovalGateDecision = { ok: true; stamp: QuoteReview | null } | { ok: false; error: string };

/** quotes.ts decideApprovalGate — the ONE sent/won approval decision. Verbatim. */
export function decideApprovalGate(status: QuoteStatus, q: Quote, ctx: ReviewLimitContext, opts: SetStatusOpts = {}, now: number = Date.now(), actor: string | null = null): ApprovalGateDecision {
  const open = resolveStatusGate(status, null, opts);
  if (open.ok) return { ok: true, stamp: null };
  const trigger = status === "won" ? "won" : "sent";
  if (approvalHolds(q, ctx)) {
    if (q.review?.method !== "auto_limit") return { ok: true, stamp: null };
    const cur = canAutoApprove(q, ctx);
    return { ok: true, stamp: cur && autoSnapshotStale(q, cur) ? autoApprovedReview(cur, now, actor, trigger) : null };
  }
  const approver = approverOnTransition(q, ctx, actor);
  if (approver) return { ok: true, stamp: approverReview(approver, q, now) };
  const ev = canAutoApprove(q, ctx);
  if (ev) return { ok: true, stamp: autoApprovedReview(ev, now, actor, trigger) };
  return open;
}

export const APPROVAL_GATE_REFUSAL = "quotes/approval-gate-refused" as const;

/** quotes.ts ApprovalGateRefused — the gate's typed refusal (branded, not instanceof). */
export class ApprovalGateRefused extends Error {
  readonly approvalGateRefusal = APPROVAL_GATE_REFUSAL;
  readonly action: ApprovalGateAction;
  constructor(action: ApprovalGateAction, message: string) {
    super(message);
    this.name = "ApprovalGateRefused";
    this.action = action;
  }
}

export function isApprovalGateRefusal(e: unknown): e is ApprovalGateRefused {
  return typeof e === "object" && e !== null && (e as { approvalGateRefusal?: unknown }).approvalGateRefusal === APPROVAL_GATE_REFUSAL;
}

export const QUOTE_VERSION_CHANGED_MESSAGE = "This quote changed since you opened it — reload to review the current version.";

export const STATUS_CHANGE_FAILED = "Couldn’t apply that status change — the error has been logged. Please try again.";

/** quotes.ts statusFailureMessage — the gate's sentence verbatim, anything else logged and shown generically. */
export function statusFailureMessage(e: unknown, where: string, fallback: string = STATUS_CHANGE_FAILED): string {
  if (isApprovalGateRefusal(e)) return e.message;
  console.error(where, e);
  return fallback;
}

/* ------------------------------------------------------------------ the status move (setStatus's patch) */

export type StatusMoveInput = {
  status: QuoteStatus;
  by: string | null | undefined;
  now: number;
  /** decideApprovalGate's stamp, written in the same move. */
  autoStamp: QuoteReview | null;
  reopen: ReopenPlan | null;
  pipes: Pipelines | null;
  /** Won: the rename rewriter the won-version comparison uses (null = not tracked). */
  wonRewrite: ((s: unknown) => unknown) | null;
  alternatesTaken?: string[];
  /** The roster for the bonus record's user ids. */
  users: { id: string; name: string }[];
  /** #368 — Re-price on Revise's inputs (loadRepriceInputs, over the browser store); null = this move never re-prices
   *  (not a revise of an Estimator system estimate, or a historical import). */
  reprice?: { followRenames: (spec: unknown) => unknown; catalog: ReadonlyMap<string, RepriceCatalogPart>; bonusRates: BonusRates } | null;
};

/**
 * The mutator setStatus runs under the row lock, ported verbatim: the approval stamp, the reopen
 * (post-win edits snapshotted first), history, the won-version pointer, the bonus record, Lost
 * clearing the Rewards credit line, the pipeline stage snapping to the status, and the "sent"
 * revision. Mutates `doc`. Returns what happened (a revise = a move back to draft).
 */
export function applyStatusMove(doc: Quote, m: StatusMoveInput): { revised: boolean; reopened: boolean; sentCut: boolean } {
  const t = m.now;
  const actor = m.by || DEFAULT_ACTOR;
  let reopened = false;
  let revised = false;
  let sentCut = false;
  // #368: the quote's own stored value before this move — the re-price banner's delta is measured from it.
  // A sliced quote carries no stored `value` (slice-rules.ts never ships it), so the prototype reads the value a save would have
  // stored: totals() of the stored sections, rounded — never 0, which would show the whole total as the re-price's delta.
  const valueBeforeMove =
    typeof doc.value === "number" && Number.isFinite(doc.value)
      ? doc.value
      : Math.round(totals(((doc.spec as { sections?: SpecSection[] } | null | undefined)?.sections ?? []) as never, 0).grand);
  if (m.autoStamp) doc.review = m.autoStamp;
  if (m.reopen) {
    pushRevision(doc, actor, "manual", REOPEN_AUTOSAVE_NOTE, t);
    applyReopen(doc, m.reopen);
    reopened = true;
  }
  doc.history = doc.history || [];
  doc.history.push({ at: t, from: doc.status, to: m.status } satisfies QuoteHistoryEntry);
  if (m.status === "draft" && doc.status !== "draft") revised = true;
  doc.status = m.status;
  // #368 (spec §9.1): Re-price on Revise — the draft's plain catalog lines move to today's catalog cost (each keeps its cost-to-sell
  // ratio), renames followed, then the save's own derivations (discounts, bonus lines, value / markup). After a reopen, so the won
  // version is what re-prices; revisions are never touched. Stored only when a line changed — a revise that changed nothing clears an older one.
  if (m.reprice && revised) {
    const followed = m.reprice.followRenames(doc.spec ?? null) as { sections?: unknown; projectDiscounts?: unknown } | null;
    const rp = repriceForRevise(doc, followed, m.reprice.catalog, m.reprice.bonusRates);
    if (rp) {
      doc.spec = { ...(followed || {}), sections: rp.sections };
      doc.value = Math.round(rp.value);
      doc.margin = rp.margin;
      doc.repricedOnRevise = { at: t, by: m.by || DEFAULT_ACTOR, count: rp.count, delta: doc.value - valueBeforeMove, lines: rp.lines, typedSystems: rp.typedSystems };
    } else if (doc.repricedOnRevise) {
      delete doc.repricedOnRevise;
    }
  }
  if (m.status === "won" && m.wonRewrite) {
    const sent = latestSentRevision(doc.revisions);
    const sentLive = sent ? { ...sent, spec: m.wonRewrite(sent.spec ?? null) } : null;
    doc.wonRev = sent && sentLive && sameWonContent(sentLive, doc) ? sent.rev : pushRevision(doc, actor, "manual", WON_SNAPSHOT_NOTE, t).rev;
  } else if (m.status === "won") {
    doc.wonRev = null;
  }
  if (m.status === "won") {
    const secs = (doc.spec as { sections?: SpecSection[] } | undefined)?.sections;
    if (isBonusEligibleQuote(doc) && Array.isArray(secs) && quoteHasBonusLines(secs)) {
      try {
        const alts = new Set(secs.filter((x) => x.alternate === true).map((x) => x.id));
        const taken = m.alternatesTaken ? m.alternatesTaken.filter((aid) => alts.has(aid)) : defaultAlternatesTaken(secs, doc.clientResponses);
        doc.bonusRecord = buildBonusRecord({ sections: secs, owner: doc.owner, preparedBy: doc.preparedBy, split: doc.estimatorBonusSplit, alternatesTaken: taken, users: m.users, wonAt: t });
      } catch (e) {
        console.error("[bonus] record failed for", doc.id, e);
        doc.bonusRecord = null;
      }
    }
  } else if (doc.bonusRecord) {
    doc.bonusRecord = null;
  }
  if (m.status === "lost") clearRewardCredit(doc);
  if (m.pipes && carriesPipeline(doc.quoteType)) {
    const pl = quotePipelineFor(m.pipes, doc);
    doc.pipelineId = pl.id;
    const stage = quoteStageForStatus(pl, m.status, doc.stage);
    if (stage) doc.stage = stage;
  }
  if (m.status === "sent") {
    pushRevision(doc, actor, "sent", "Sent to customer", t);
    sentCut = true;
    doc.portalReview = null;
  }
  doc.updatedAt = t;
  return { revised, reopened, sentCut };
}

/* ------------------------------------------------------------------ the review workflow's writers (#60, #284, #287) */

/** quotes.ts validateAttestationNote — verbatim. */
export function validateAttestationNote(note: string | null | undefined): { ok: true; note: string } | { ok: false; error: string } {
  const trimmed = (note || "").trim();
  if (!trimmed) {
    return {
      ok: false,
      error:
        'An attested approval requires a note naming who reviewed this quote and how (e.g. "Reviewed by Jeff on a Teams call, 2026-08-01").',
    };
  }
  return { ok: true, note: trimmed };
}

/** quotes.ts canAttestApproval — verbatim: a reviewer's "changes" can't be attested past. */
export function canAttestApproval(review: QuoteReview | null | undefined): { ok: true } | { ok: false; error: string } {
  if (review?.state === "changes") {
    return {
      ok: false,
      error:
        "A reviewer asked for changes on this quote. Address them and resubmit for review — a self-attested approval can't override a review that happened in the app.",
    };
  }
  return { ok: true };
}

/** quotes.ts decidableUnderLock — an approver decides an in-review quote (or, approve-only, an unsubmitted draft) at the version shown. */
export function decidableUnderLock(q: Quote, opts: ReviewOpts): boolean {
  const state = q.review?.state || "none";
  const ok =
    state === "in_review" ||
    (!!opts.allowUnsubmitted &&
      q.status === "draft" &&
      (state === "none" || state === "changes" || (state === "approved" && !approvalHolds(q, opts.holdsCtx ?? NO_REVIEW_LIMITS))));
  if (!ok) return false;
  return typeof opts.expectUpdatedAt !== "number" || q.updatedAt === opts.expectUpdatedAt;
}

/** quotes.ts submitForReview's mutator. Mutates `q`. */
export function applySubmitForReview(q: Quote, opts: ReviewOpts, now: number): void {
  q.review = rv("in_review", { reviewer: opts.reviewer || null, submittedBy: opts.by || null, submittedAt: now });
  q.updatedAt = now;
}

/** quotes.ts withdrawReview's mutator — re-checked under the lock: only an in-review quote. Mutates `q`. */
export function applyWithdrawReview(q: Quote, now: number): void {
  if (q.review?.state !== "in_review") return;
  q.review = rv("none");
  q.updatedAt = now;
}

/** quotes.ts approve's mutator — a no-op unless decidableUnderLock. Mutates `q`. */
export function applyApprove(q: Quote, opts: ReviewOpts, now: number): void {
  if (!decidableUnderLock(q, opts)) return;
  const inReview = q.review?.state === "in_review";
  const review = q.review || rv("none");
  review.state = "approved";
  review.decidedBy = opts.by || null;
  review.reviewer = (inReview && review.reviewer) || review.decidedBy;
  review.decidedAt = now;
  review.note = opts.note || "";
  review.auto = null;
  review.method = "in_app";
  review.approvedAgainst = approvalFingerprint(q);
  q.review = review;
  q.updatedAt = now;
}

/** quotes.ts attestApproval's mutator (the caller validated the note). Mutates `q`. */
export function applyAttestApproval(q: Quote, opts: { by?: string | null; note: string }, now: number): void {
  const review = q.review || rv("in_review");
  review.state = "approved";
  review.decidedBy = opts.by || null;
  review.reviewer = review.reviewer || opts.by || null;
  review.decidedAt = now;
  review.note = opts.note;
  review.auto = null;
  review.method = "attested";
  review.approvedAgainst = approvalFingerprint(q);
  q.review = review;
  q.updatedAt = now;
}

/** quotes.ts requestChanges' mutator — same under-lock check as approve. Mutates `q`. */
export function applyRequestChanges(q: Quote, opts: ReviewOpts, now: number): void {
  if (!decidableUnderLock(q, opts)) return;
  const review = q.review;
  review.state = "changes";
  review.decidedBy = opts.by || null;
  review.reviewer = review.reviewer || review.decidedBy;
  review.decidedAt = now;
  review.note = opts.note || "";
  review.auto = null;
  review.approvedAgainst = null;
  q.review = review;
  q.updatedAt = now;
}

/** quotes.ts ESTIMATE_EMAILS_MAX. */
export const ESTIMATE_EMAILS_MAX = 50;

/** quotes.ts recordEstimateEmail's checks + mutator: a clean entry appended once per thread (no updatedAt bump). Returns whether it wrote. */
export function applyRecordEstimateEmail(doc: Quote, entry: EstimateEmailEntry): boolean {
  const threadId = typeof entry?.threadId === "string" ? entry.threadId.trim() : "";
  if (!threadId || threadId.length > 200) return false;
  if (!Number.isSafeInteger(entry.rev) || entry.rev < 0 || !Number.isFinite(entry.at)) return false;
  const clean: EstimateEmailEntry = {
    threadId,
    rev: entry.rev,
    at: entry.at,
    by: String(entry.by ?? "").slice(0, 200),
    to: String(entry.to ?? "").slice(0, 1000),
    ...(typeof entry.partyId === "string" && /^pty_[0-9a-f]{16}$/.test(entry.partyId) ? { partyId: entry.partyId } : {}),
  };
  const cur = Array.isArray(doc.estimateEmails) ? doc.estimateEmails : [];
  if (cur.some((e) => !!e && e.threadId === threadId)) return false;
  doc.estimateEmails = [...cur, clean].slice(-ESTIMATE_EMAILS_MAX);
  return true;
}
