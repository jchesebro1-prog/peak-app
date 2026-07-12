import {
  getDoc,
  listDocs,
  nextPrefixedId,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";
import { quotesSeed } from "@/db/seeds/quotes";

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
export type QuoteStatus = (typeof STAGES)[number];

export const STAGE_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  won: "Won",
  lost: "Lost",
};

const DAY = 86400000;

export type ReviewState = "none" | "in_review" | "approved" | "changes";

export type QuoteReview = {
  state: ReviewState;
  reviewer: string | null;
  submittedBy: string | null;
  submittedAt: number | null;
  decidedBy: string | null;
  decidedAt: number | null;
  note: string;
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
  status: QuoteStatus;
  /** 'estimator' | 'quick' */
  source: string;
  /** 'system' (default) | 'flame_test' | 'repair' | 'inspection' — absent on seed rows. */
  quoteType?: string;
  /** Flame-test engine subdoc (owned by the flame-test module). */
  flameTest?: unknown;
  /** Repair engine subdoc (owned by the repairs module). */
  repair?: unknown;
  /** Inspection engine subdoc (owned by the inspections module). */
  inspection?: unknown;
  contact?: unknown;
  owner: string;
  /** Estimator/Quick Design spec subdoc. */
  spec?: unknown;
  review: QuoteReview;
  createdAt: number;
  updatedAt: number;
  history: QuoteHistoryEntry[];
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
  };
}

/** All quotes, newest activity first (port of getAll). */
export async function getAll(): Promise<Quote[]> {
  const list = await listDocs<Quote>("quotes");
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function get(id: string): Promise<Quote | null> {
  return getDoc<Quote>("quotes", id);
}

/** Create a new quote; returns the created record. Id: Q-#### from base 2041. */
export async function create(partial: Partial<Quote> = {}): Promise<Quote> {
  const id = partial.id || (await nextPrefixedId("quotes", "Q", 2041));
  const t = Date.now();
  const q: Quote = {
    id,
    name: partial.name || "Untitled estimate",
    customer: partial.customer || "",
    customerId: partial.customerId || null,
    locationId: partial.locationId || null,
    value: Math.round(partial.value || 0),
    margin: partial.margin || 0,
    status: "draft",
    source: partial.source || "quick",
    quoteType: partial.quoteType || "system",
    flameTest: partial.flameTest || null,
    repair: partial.repair || null,
    inspection: partial.inspection || null,
    contact: partial.contact || null,
    owner: partial.owner || "Jeff Chesebro",
    spec: partial.spec || null,
    review: rv("none"),
    createdAt: t,
    updatedAt: t,
    history: [{ at: t, to: "draft" }],
  };
  await upsertDoc<Quote>("quotes", q);
  return q;
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

/** Move through the pipeline; stamps history [{at, from, to}]. No-op write when unchanged. */
export async function setStatus(
  id: string,
  status: QuoteStatus
): Promise<Quote | null> {
  if (!STAGES.includes(status)) return null;
  const q = await getDoc<Quote>("quotes", id);
  if (!q || q.status === status) return q;
  return patchDoc<Quote>("quotes", id, (doc) => {
    const t = Date.now();
    doc.history = doc.history || [];
    doc.history.push({ at: t, from: doc.status, to: status });
    doc.status = status;
    doc.updatedAt = t;
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
