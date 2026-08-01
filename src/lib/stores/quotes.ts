import {
  getDoc,
  insertWithPrefixedId,
  listDocs,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";
import { quotesSeed } from "@/db/seeds/quotes";
import { canSetPoReceived } from "@/lib/opportunities";

/**
 * QuoteStore — server port of app/store.js (localStorage key rss_pipeline_v2).
 *
 * The prototype's field names, id format (Q-#### from base 2041), stage
 * pipeline (draft → sent → won/lost), review state machine
 * (none / in_review / approved / changes) and history stamping are the spec —
 * ported exactly. Timestamps are epoch-ms numbers.
 *
 * Server-side deltas (documented, not behavioral inventions):
 * - `window.Team.CURRENT` fallbacks become explicit `by` / `owner` params the
 *   caller supplies from the session; the prototype's final 'Jeff Chesebro'
 *   owner fallback is preserved.
 * - remove() is a soft delete (doc-store semantics) instead of filtering the
 *   localStorage array.
 * - migrate()/read-cache logic was localStorage-era backfill and is dropped:
 *   seeds are born fully formed (owner, review, customerId links included).
 */

export const STAGES = ["draft", "sent", "won", "lost"] as const;

/** Same literal fallback the prototype used when no session actor is passed. */
const DEFAULT_ACTOR = "Jeff Chesebro";
export type QuoteStatus = (typeof STAGES)[number];

export const STAGE_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  won: "Won",
  lost: "Lost",
};

const DAY = 86400000;

export type ReviewState = "none" | "in_review" | "approved" | "changes";

/**
 * How an "approved" review got its approval record (punch #60 / builds on
 * D84's review state machine):
 * - "in_app"  — someone with the `approve` permission approved it through
 *   the review queue (claimReview/approve, unchanged).
 * - "attested" — the estimator (or anyone) approved their OWN quote by
 *   supplying a mandatory note naming who reviewed it and how (e.g. a phone
 *   call or Teams review) — real reviews here often happen off-platform, and
 *   a hard `can("approve")` gate would block that legitimate workflow.
 * Absent/null on legacy docs decided before this field existed (seed data,
 * pre-punch-60 approvals) — those are still valid approvals, just with an
 * unknown method.
 */
export type ApprovalMethod = "in_app" | "attested";

export type QuoteReview = {
  state: ReviewState;
  reviewer: string | null;
  submittedBy: string | null;
  submittedAt: number | null;
  decidedBy: string | null;
  decidedAt: number | null;
  note: string;
  /** Set alongside decidedBy/decidedAt whenever state becomes "approved". */
  method?: ApprovalMethod | null;
};

export type QuoteHistoryEntry = {
  at: number;
  from?: QuoteStatus;
  to: QuoteStatus;
};

export type Quote = {
  id: string;
  name: string;
  /** Denormalized display name — fallback when customerId is not linked. */
  customer: string;
  /** Canonical Customers-directory link (null when unlinked, e.g. Harbor Rep). */
  customerId: string | null;
  locationId: string | null;
  value: number;
  margin: number;
  /** Customer pricing tier stamped at creation (item 11, D87) — resolved
   *  contact → company → base, re-stamped when the customer/contact changes
   *  and when a revision is cut. Never shown to the customer. */
  pricingTier?: string | null;
  /** The tier's margin fraction as it stood at stamp time (0.30 = 30%) —
   *  the SEED for pricing tools; `margin` above stays the blended actual. */
  tierMargin?: number | null;
  status: QuoteStatus;
  /** 'estimator' | 'quick' */
  source: string;
  /** 'system' (default) | 'flame_test' | 'repair' | 'inspection' | 'consulting' — absent on seed rows. */
  quoteType?: string;
  /** Flame-test engine subdoc (owned by the flame-test module). */
  flameTest?: unknown;
  /** Repair engine subdoc (owned by the repairs module). */
  repair?: unknown;
  /** Inspection engine subdoc (owned by the inspections module). */
  inspection?: unknown;
  /** Consulting engagement subdoc (owned by the consulting module, D90). */
  consulting?: unknown;
  contact?: unknown;
  owner: string;
  /** Estimator/Quick Design spec subdoc. */
  spec?: unknown;
  /** Non-binding portal acceptance (IDEAS #47 P3): a customer accepted this
   *  quote in the portal. Purely a follow-up flag — the team confirms by
   *  marking the quote Won, which runs the normal spawn machinery. */
  portalAcceptance?: { at: number; by: string; byEmail: string } | null;
  /** Renewal provenance (IDEAS #36): the completed flame job / inspection
   *  record this quote renews — the ✉ one-click outreach reuses an existing
   *  renewal quote for the cycle instead of minting a duplicate. */
  renewalOf?: string | null;
  /** PO received on a WON quote (#18, D119) — an annex flag, NOT a fifth
   *  pipeline status. Set/cleared only via setPoReceived; meaningless (null)
   *  on draft/sent/lost. Absent on pre-D119 docs — read with `?? null`. */
  poReceivedAt?: number | null;
  review: QuoteReview;
  createdAt: number;
  updatedAt: number;
  history: QuoteHistoryEntry[];
  /** Append-only priced snapshots (punch item 24). Absent on pre-D84 quotes. */
  revisions?: QuoteRevision[];
};

/**
 * An immutable snapshot of a quote's priced state (punch item 24). Modelled on
 * `DesignRevision` — append-only, never rewritten, `rev` is 1-based.
 *
 * **Why the payload is stored and not recomputed.** Flame-test / repair /
 * inspection quotes re-price from the *live* rate blobs whenever their builder
 * screen is opened (`stores/pricing.ts`: "the engines read the same blobs, so
 * every flame-test / repair quote reprices immediately"). Recomputing a
 * revision on recall would therefore return today's price, not the price that
 * was sent. The engine subdocs already hold a fully resolved breakdown at save
 * time — rates, trip, per-venue charges, totals — and the customer letters
 * already read exactly that, so snapshotting them captures what the customer
 * actually saw. Estimator quotes bake absolute per-line prices into `spec`, so
 * that copies faithfully too.
 *
 * `reason` distinguishes a deliberate save from the automatic snapshot taken on
 * send; the "sent" one is the version with contractual weight.
 */
export type QuoteRevision = {
  rev: number;
  at: number;
  by: string;
  reason: "manual" | "sent";
  note: string;
  /** Resolved figures as they stood when the snapshot was cut. */
  name: string;
  value: number;
  margin: number;
  /** Tier stamp frozen with the snapshot (item 11 B: per-revision). */
  pricingTier?: string | null;
  tierMargin?: number | null;
  status: QuoteStatus;
  quoteType?: string;
  /** Whichever priced payload this quote type carries — all already resolved. */
  spec?: unknown;
  flameTest?: unknown;
  repair?: unknown;
  inspection?: unknown;
  consulting?: unknown;
};

export type ReviewOpts = {
  /** Acting user (prototype: window.Team.CURRENT). */
  by?: string | null;
  reviewer?: string | null;
  note?: string;
};

function rv(state: ReviewState, o: Partial<QuoteReview> = {}): QuoteReview {
  return {
    state,
    reviewer: o.reviewer || null,
    submittedBy: o.submittedBy || null,
    submittedAt: o.submittedAt || null,
    decidedBy: o.decidedBy || null,
    decidedAt: o.decidedAt || null,
    note: o.note || "",
    method: o.method ?? null,
  };
}

/**
 * True once a quote carries a live approval RECORD — in-app or attested
 * (punch #60). This is the single predicate both `sendToCustomerAction` and
 * `setStatusAction("won")` must consult server-side; a hidden button is not
 * access control. Requesting changes or resubmitting moves `state` off
 * "approved", which correctly revokes a stale approval — a prior decision
 * doesn't authorize sending a since-edited quote.
 */
export function hasApproval(review: QuoteReview | null | undefined): boolean {
  return !!review && review.state === "approved";
}

export type ApprovalGateAction = "send" | "won";
export type ApprovalGateResult = { ok: true } | { ok: false; error: string };

/**
 * Server-side gate for the two transitions punch #60 locks down. Pure (no
 * I/O) so it's unit-testable without a DB: callers fetch the quote, pass its
 * `review`, and get back a typed ok/error the UI can display verbatim
 * instead of a raw thrown exception.
 */
export function requireApprovalToAdvance(
  review: QuoteReview | null | undefined,
  action: ApprovalGateAction
): ApprovalGateResult {
  if (hasApproval(review)) return { ok: true };
  return {
    ok: false,
    error:
      action === "send"
        ? "This quote needs an approval on record before it can be sent to the customer."
        : "This quote needs an approval on record before it can be marked Won.",
  };
}

export type AttestationValidation = { ok: true; note: string } | { ok: false; error: string };

/**
 * Server-side validation for the attested-approval note (punch #60). The
 * note is MANDATORY for this path — it is the only thing that makes an
 * off-platform review attributable to a named human, so an empty or
 * whitespace-only note is rejected here, not just hidden in the UI.
 */
export function validateAttestationNote(note: string | null | undefined): AttestationValidation {
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

/**
 * May this quote be self-attested at all (punch #60, Jeff 2026-08-01)?
 *
 * Attestation exists to record a review that happened OFF platform — a phone
 * call, a Teams call. It is not a way around a review that happened ON it.
 * So a reviewer who formally pressed "request changes" cannot be attested
 * past: `changes` is an explicit human decision, and letting the quote's own
 * author overrule it with a self-written note would empty the review queue of
 * meaning. Clear the changes state the normal way (resubmit for review) and
 * the attested path opens back up.
 *
 * Enforced server-side. The UI also hides the control in this state, but that
 * is a convenience — the UI-only gate WAS the original #60 defect.
 */
export function canAttestApproval(
  review: QuoteReview | null | undefined
): { ok: true } | { ok: false; error: string } {
  if (review?.state === "changes") {
    return {
      ok: false,
      error:
        "A reviewer asked for changes on this quote. Address them and resubmit for review — a self-attested approval can't override a review that happened in the app.",
    };
  }
  return { ok: true };
}

/** All quotes, newest activity first (port of getAll). */
export async function getAll(): Promise<Quote[]> {
  const list = await listDocs<Quote>("quotes");
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function get(id: string): Promise<Quote | null> {
  return getDoc<Quote>("quotes", id);
}

/** The live (not lost) renewal quote already minted for a completed job /
 *  record this cycle, if any (IDEAS #36 idempotence). */
export async function byRenewalOf(recordId: string): Promise<Quote | null> {
  if (!recordId) return null;
  const list = await listDocs<Quote>("quotes");
  const live = list.filter(
    (q) => q.renewalOf === recordId && q.status !== "lost"
  );
  live.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return live[0] || null;
}

/** Create a new quote; returns the created record. Id: Q-#### from base 2041. */
export async function create(partial: Partial<Quote> = {}): Promise<Quote> {
  const t = Date.now();
  const build = (id: string): Quote => ({
    id,
    name: partial.name || "Untitled estimate",
    customer: partial.customer || "",
    customerId: partial.customerId || null,
    locationId: partial.locationId || null,
    value: Math.round(partial.value || 0),
    margin: partial.margin || 0,
    pricingTier: partial.pricingTier ?? null,
    tierMargin: partial.tierMargin ?? null,
    status: "draft",
    source: partial.source || "quick",
    quoteType: partial.quoteType || "system",
    flameTest: partial.flameTest || null,
    repair: partial.repair || null,
    inspection: partial.inspection || null,
    consulting: partial.consulting || null,
    contact: partial.contact || null,
    owner: partial.owner || "Jeff Chesebro",
    spec: partial.spec || null,
    renewalOf: partial.renewalOf || null,
    poReceivedAt: partial.poReceivedAt ?? null,
    review: rv("none"),
    createdAt: t,
    updatedAt: t,
    history: [{ at: t, to: "draft" }],
  });
  // Explicit caller-supplied id (not a minted one) — no race to guard, keep
  // the prior upsert semantics.
  if (partial.id) {
    const q = build(partial.id);
    await upsertDoc<Quote>("quotes", q);
    return q;
  }
  // Minted id: nextPrefixedId's max-scan lets two concurrent creates compute
  // the same Q-####; insert-if-absent + retry (D73) instead of the second
  // writer silently overwriting the first via upsertDoc.
  return insertWithPrefixedId<Quote>("quotes", "Q", 2041, build);
}

/** Shallow-merge updates into a quote; bumps updatedAt, rounds value. */
export async function update(
  id: string,
  patch: Partial<Quote>
): Promise<Quote | null> {
  return patchDoc<Quote>("quotes", id, (q) => {
    Object.assign(q, patch, { updatedAt: Date.now() });
    if (typeof q.value === "number") q.value = Math.round(q.value);
  });
}

/* ---- revisions (punch item 24) ---- */

/** Build a snapshot of a quote's current priced state. Pure. */
function snapshotOf(
  doc: Quote,
  rev: number,
  by: string,
  reason: QuoteRevision["reason"],
  note: string
): QuoteRevision {
  return {
    rev,
    at: Date.now(),
    by,
    reason,
    note,
    name: doc.name,
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
  };
}

/** Append a snapshot inside an existing patch callback. Returns the new revision. */
function pushRevision(
  doc: Quote,
  by: string,
  reason: QuoteRevision["reason"],
  note: string
): QuoteRevision {
  const revs = Array.isArray(doc.revisions) ? doc.revisions : [];
  const r = snapshotOf(doc, revs.length + 1, by, reason, note);
  doc.revisions = [...revs, r];
  return r;
}

export async function quoteRevisions(id: string): Promise<QuoteRevision[]> {
  const q = await getDoc<Quote>("quotes", id);
  return (q && Array.isArray(q.revisions) ? q.revisions : []) || [];
}

/**
 * Snapshot the quote as it stands. The caller saves first, then snapshots —
 * same order as `saveRevisionAction` on designs.
 */
export async function addQuoteRevision(
  id: string,
  opts: { by?: string | null; reason?: QuoteRevision["reason"]; note?: string } = {}
): Promise<QuoteRevision | null> {
  let out: QuoteRevision | null = null;
  const res = await patchDoc<Quote>("quotes", id, (doc) => {
    out = pushRevision(
      doc,
      opts.by || DEFAULT_ACTOR,
      opts.reason || "manual",
      opts.note || ""
    );
    doc.updatedAt = Date.now();
  });
  return res ? out : null;
}

/**
 * Recall an earlier revision onto the live quote.
 *
 * Non-destructive by construction: the current state is snapshotted FIRST, so
 * walking back never discards the direction that was walked away from — it just
 * becomes the newest revision. The recall itself is then recorded as another
 * revision, so the history reads as a continuous line rather than a jump.
 *
 * Refuses on `won` quotes. A won quote has already spawned a project, and the
 * project copies `value`/`margin` (and derives every procurement line cost from
 * `value`) once at conversion and never re-reads the quote — so rewriting the
 * numbers afterwards would silently desync the two with no way to repair it
 * (`projects.ts` bails early when a project already exists).
 */
export async function restoreQuoteRevision(
  id: string,
  rev: number,
  by?: string | null
): Promise<{ ok: false; reason: "not-found" | "no-such-rev" | "won" } | { ok: true; quote: Quote }> {
  const q = await getDoc<Quote>("quotes", id);
  if (!q) return { ok: false, reason: "not-found" };
  if (q.status === "won") return { ok: false, reason: "won" };
  const target = (q.revisions || []).find((r) => r.rev === rev);
  if (!target) return { ok: false, reason: "no-such-rev" };

  const actor = by || DEFAULT_ACTOR;
  const updated = await patchDoc<Quote>("quotes", id, (doc) => {
    // 1. preserve where we are now, 2. apply the old payload, 3. record the recall.
    pushRevision(doc, actor, "manual", `Auto-saved before recalling v${rev}`);
    doc.name = target.name;
    doc.value = Math.round(target.value);
    doc.margin = target.margin;
    doc.pricingTier = target.pricingTier ?? doc.pricingTier ?? null;
    doc.tierMargin = target.tierMargin ?? doc.tierMargin ?? null;
    doc.spec = target.spec ?? null;
    doc.flameTest = target.flameTest ?? null;
    doc.repair = target.repair ?? null;
    doc.inspection = target.inspection ?? null;
    pushRevision(doc, actor, "manual", `Recalled v${rev}`);
    doc.updatedAt = Date.now();
  });
  return updated ? { ok: true, quote: updated } : { ok: false, reason: "not-found" };
}

/**
 * Move through the pipeline; stamps history [{at, from, to}]. No-op write when unchanged.
 *
 * Sending also cuts an automatic revision (item 24 decision A) — that snapshot
 * is the record of what the customer was actually quoted, so it is taken here
 * rather than at any one call site: every legitimate transition funnels through
 * this function.
 */
export async function setStatus(
  id: string,
  status: QuoteStatus,
  by?: string | null
): Promise<Quote | null> {
  if (!STAGES.includes(status)) return null;
  const q = await getDoc<Quote>("quotes", id);
  if (!q || q.status === status) return q;
  return patchDoc<Quote>("quotes", id, (doc) => {
    const t = Date.now();
    doc.history = doc.history || [];
    doc.history.push({ at: t, from: doc.status, to: status });
    doc.status = status;
    if (status === "sent") {
      pushRevision(doc, by || DEFAULT_ACTOR, "sent", "Sent to customer");
    }
    doc.updatedAt = t;
  });
}

/**
 * Toggle the PO-received flag on a WON quote (#18, D119). Not a status
 * transition: no history entry, no revision, and none of the won/lost spawn
 * machinery runs (that all lives behind setStatus / setQuoteStatus). Refuses
 * (returns null) unless the quote is currently won.
 */
export async function setPoReceived(id: string, on: boolean): Promise<Quote | null> {
  const q = await getDoc<Quote>("quotes", id);
  if (!q || !canSetPoReceived(q.status)) return null;
  return patchDoc<Quote>("quotes", id, (doc) => {
    doc.poReceivedAt = on ? Date.now() : null;
    doc.updatedAt = Date.now();
  });
}

/** Soft delete (prototype filtered the array; server keeps a tombstone for sync). */
export async function remove(id: string): Promise<void> {
  await softDeleteDoc("quotes", id);
}

/* ---- review & approval workflow ---- */

export async function submitForReview(
  id: string,
  opts: ReviewOpts = {}
): Promise<Quote | null> {
  return patchDoc<Quote>("quotes", id, (q) => {
    q.review = rv("in_review", {
      reviewer: opts.reviewer || null,
      submittedBy: opts.by || null,
      submittedAt: Date.now(),
    });
    q.updatedAt = Date.now();
  });
}

export async function claimReview(
  id: string,
  by?: string | null
): Promise<Quote | null> {
  const q = await getDoc<Quote>("quotes", id);
  if (!q || !q.review) return null;
  return patchDoc<Quote>("quotes", id, (doc) => {
    doc.review.reviewer = by || null;
    doc.updatedAt = Date.now();
  });
}

export async function approve(
  id: string,
  opts: ReviewOpts = {}
): Promise<Quote | null> {
  return patchDoc<Quote>("quotes", id, (q) => {
    const review = q.review || rv("in_review");
    review.state = "approved";
    review.decidedBy = opts.by || null;
    review.reviewer = review.reviewer || review.decidedBy;
    review.decidedAt = Date.now();
    review.note = opts.note || "";
    review.method = "in_app";
    q.review = review;
    q.updatedAt = Date.now();
  });
}

export type AttestOpts = {
  /** The attesting user — always the caller, never a claimed identity. */
  by?: string | null;
  /** Mandatory — validated server-side by `validateAttestationNote` before
   *  this is called; re-checked here as a defense-in-depth backstop. */
  note: string;
};

/**
 * Attested approval (punch #60): the estimator approves their OWN quote by
 * naming who actually reviewed it and how (phone call, Teams, etc.) instead
 * of routing it through the in-app review queue. Produces the SAME
 * `QuoteReview` shape `approve()` does — state "approved", decidedBy/At set —
 * distinguished only by `method: "attested"`, so `hasApproval()` and every
 * downstream consumer treat the two paths identically.
 */
export async function attestApproval(
  id: string,
  opts: AttestOpts
): Promise<Quote | null> {
  const note = (opts.note || "").trim();
  if (!note) return null;
  return patchDoc<Quote>("quotes", id, (q) => {
    const review = q.review || rv("in_review");
    review.state = "approved";
    review.decidedBy = opts.by || null;
    review.reviewer = review.reviewer || opts.by || null;
    review.decidedAt = Date.now();
    review.note = note;
    review.method = "attested";
    q.review = review;
    q.updatedAt = Date.now();
  });
}

export async function requestChanges(
  id: string,
  opts: ReviewOpts = {}
): Promise<Quote | null> {
  return patchDoc<Quote>("quotes", id, (q) => {
    const review = q.review || rv("in_review");
    review.state = "changes";
    review.decidedBy = opts.by || null;
    review.decidedAt = Date.now();
    review.note = opts.note || "";
    q.review = review;
    q.updatedAt = Date.now();
  });
}

/** Replace all quotes with the seed pipeline (settings "reset demo data"). */
export async function resetToSeed(): Promise<void> {
  const existing = await listDocs<Quote>("quotes");
  for (const q of existing) await softDeleteDoc("quotes", q.id);
  for (const q of quotesSeed()) await upsertDoc<Quote>("quotes", q);
}

/** Relative-time label for updatedAt (pure; safe to call anywhere). */
export function timeAgo(ts?: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  const d = Math.floor(diff / DAY);
  if (d <= 0) {
    const h = Math.floor(diff / 3600000);
    if (h <= 0) return "just now";
    return h + "h ago";
  }
  if (d === 1) return "yesterday";
  if (d < 14) return d + "d ago";
  const date = new Date(ts);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
