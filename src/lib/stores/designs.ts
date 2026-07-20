import {
  getDoc,
  listDocs,
  nextPrefixedId,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";

/**
 * SandboxStore — the Design Dashboard's data layer. Port of app/sandbox.js
 * (rss_sandbox_v2) onto the doc-store, RECORD SURFACE ONLY.
 *
 * A sandbox for budgetary system designs, DELIBERATELY kept separate from
 * the quotes pipeline: nothing here is a real quote. Designs are priced
 * budgetary-only until deliberately promoted via designToQuotePartial()
 * (requote: true — budgetary numbers do NOT carry forward as final).
 *
 * Ids are D-### from base 100 (first created design is D-101).
 *
 * The review subdoc lives ON the design record (d.review) — the same shape
 * the Reviews screen and nav badges read from quotes (store.js rv()):
 * state / reviewer / submittedBy / submittedAt / decidedBy / decidedAt / note.
 * It is distinct from the doc-store's server-owned `review` column (office
 * triage), which this module never touches.
 *
 * The Quick Design screen saves its full designer/drawing state onto the
 * record as `config` (a deep-copied JSON blob). The server treats it as
 * opaque — canvas/pricing logic is NOT ported here.
 *
 * Prototype details that do not port to the server:
 * - localStorage cache/read/write/ensure — replaced by doc-store rows.
 * - migrate()'s SEED_OWNERS / SEED_CUST backfill maps — legacy repairs for
 *   pre-owner / pre-customer-link localStorage saves; the DB seeds already
 *   carry owner, review, and the customer link.
 * - migrate()'s customerId backfill via window.CustomerStore.resolveId —
 *   same reason. (designToQuotePartial's resolveId/nameFor lookups ARE
 *   ported, inline, via doc-store reads of the "customers" collection.)
 * - window.Team.CURRENT — replaced by explicit actor parameters falling
 *   back to DEFAULT_ACTOR (the prototype's own literal fallback).
 * - AppSettings.seedDemo lazy seeding inside ensure() — seeding is explicit
 *   via src/db/seeds/designs.ts.
 */

const DAY = 86400000;

/** Prototype fallback for window.Team.CURRENT (team.js default identity). */
const DEFAULT_ACTOR = "Jeff Chesebro";

function now(): number {
  return Date.now();
}

/* ---------- record shapes ---------- */

export type ReviewState = "none" | "in_review" | "approved" | "changes";

/** Review subdoc — field-name parity with store.js/sandbox.js rv(). */
export type DesignReview = {
  state: ReviewState;
  reviewer: string | null;
  submittedBy: string | null;
  submittedAt: number | null;
  decidedBy: string | null;
  decidedAt: number | null;
  note: string;
};

/**
 * Immutable point-in-time snapshot of the design's config + headline
 * numbers (Quick Design passes name/tier/budget/venue/size/width/depth/
 * grid/systems/customer/config/by — kept open like the prototype).
 */
export type DesignRevision = Record<string, unknown> & { rev: number; at: number };

export type DesignRecord = {
  id: string; // D-### (base 100)
  name: string;
  customer: string;
  customerId: string | null;
  locationId: string | null;
  venue: string;
  size: string; // seed values: 'small' | 'medium' | 'large'
  tier: string; // seed values: 'good' | 'better' | 'best'
  width: number;
  depth: number;
  grid: number;
  owner: string;
  review: DesignReview;
  systems: string[];
  budget: number;
  updatedAt: number;
  /** Revision history — travels WITH the design record so it persists. */
  revisions?: DesignRevision[];
  /** Opaque drawing/designer state saved by the Quick Design screen. Not interpreted server-side. */
  config?: Record<string, unknown> | null;
};

/** The partial that promotes a budgetary design into a real quote (port of toQuotePartial's return). */
export type DesignQuotePartial = {
  name: string;
  customerId: string | null;
  locationId: string | null;
  customer: string;
  value: number;
  margin: number;
  source: "sandbox";
  requote: true;
  spec: {
    venue: string;
    size: string;
    tier: string;
    width: number;
    depth: number;
    grid: number;
    systems: string[];
    fromDesign: string;
  };
};

/** Port of rv(state, o). */
function rv(state: ReviewState, o: Partial<DesignReview> = {}): DesignReview {
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

/** Port of migrate() defaults: every record carries owner + review. */
function normalizeDesign(d: DesignRecord): DesignRecord {
  if (!d.owner) d.owner = DEFAULT_ACTOR;
  if (!d.review) d.review = rv("none");
  return d;
}

/* ---------- CRUD ---------- */

/** All designs, newest activity first (port of getAll). */
export async function getAllDesigns(): Promise<DesignRecord[]> {
  const list = await listDocs<DesignRecord>("designs");
  return list.map(normalizeDesign).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getDesign(id: string): Promise<DesignRecord | null> {
  const d = await getDoc<DesignRecord>("designs", id);
  return d ? normalizeDesign(d) : null;
}

export async function createDesign(
  partial: Partial<DesignRecord> = {}
): Promise<DesignRecord> {
  const t = now();
  const id = partial.id || (await nextPrefixedId("designs", "D", 100));
  const d: DesignRecord = {
    name: "Untitled design",
    venue: "",
    size: "medium",
    tier: "better",
    width: 0,
    depth: 0,
    grid: 0,
    systems: [],
    budget: 0,
    customerId: null,
    locationId: null,
    customer: "",
    owner: DEFAULT_ACTOR,
    review: rv("none"),
    ...partial,
    id,
    updatedAt: t,
  };
  if (!d.review) d.review = rv("none");
  await upsertDoc<DesignRecord>("designs", d);
  return d;
}

/** Shallow-merge patch, bump updatedAt (port of update). */
export async function updateDesign(
  id: string,
  patch: Partial<DesignRecord>
): Promise<DesignRecord | null> {
  return patchDoc<DesignRecord>("designs", id, (d) => ({
    ...d,
    ...patch,
    id,
    updatedAt: now(),
  }));
}

/** Soft delete (port of remove — also used when a design is promoted to a quote). */
export async function removeDesign(id: string): Promise<void> {
  await softDeleteDoc("designs", id);
}

/* ---------- revision history ---------- */

export async function designRevisions(id: string): Promise<DesignRevision[]> {
  const d = await getDesign(id);
  return (d && d.revisions) || [];
}

export async function addDesignRevision(
  id: string,
  snap: Record<string, unknown> = {}
): Promise<DesignRevision | null> {
  let out: DesignRevision | null = null;
  const res = await patchDoc<DesignRecord>("designs", id, (d) => {
    const revs = Array.isArray(d.revisions) ? d.revisions : [];
    // Object.assign({ rev, at }, snap) — snap may override rev/at, like the prototype.
    const r = { rev: revs.length + 1, at: now(), ...snap } as DesignRevision;
    d.revisions = [...revs, r];
    d.updatedAt = now();
    out = r;
    return d;
  });
  return res ? out : null;
}

/* ---------- review & approval workflow ---------- */

export async function submitDesignForReview(
  id: string,
  opts: { reviewer?: string | null; by?: string | null } = {}
): Promise<DesignRecord | null> {
  return patchDoc<DesignRecord>("designs", id, (d) => {
    d.review = rv("in_review", {
      reviewer: opts.reviewer || null,
      submittedBy: opts.by || DEFAULT_ACTOR,
      submittedAt: now(),
    });
    d.updatedAt = now();
    return d;
  });
}

export async function claimDesignReview(
  id: string,
  by?: string | null
): Promise<DesignRecord | null> {
  const d = await getDesign(id);
  if (!d || !d.review) return null;
  return patchDoc<DesignRecord>("designs", id, (doc) => {
    doc.review = doc.review || rv("none");
    doc.review.reviewer = by || DEFAULT_ACTOR;
    doc.updatedAt = now();
    return doc;
  });
}

export async function approveDesign(
  id: string,
  opts: { by?: string | null; note?: string } = {}
): Promise<DesignRecord | null> {
  return patchDoc<DesignRecord>("designs", id, (d) => {
    d.review = d.review || rv("in_review");
    d.review.state = "approved";
    d.review.decidedBy = opts.by || DEFAULT_ACTOR;
    d.review.reviewer = d.review.reviewer || d.review.decidedBy;
    d.review.decidedAt = now();
    d.review.note = opts.note || "";
    d.updatedAt = now();
    return d;
  });
}

export async function requestDesignChanges(
  id: string,
  opts: { by?: string | null; note?: string } = {}
): Promise<DesignRecord | null> {
  return patchDoc<DesignRecord>("designs", id, (d) => {
    d.review = d.review || rv("in_review");
    d.review.state = "changes";
    d.review.decidedBy = opts.by || DEFAULT_ACTOR;
    d.review.decidedAt = now();
    d.review.note = opts.note || "";
    d.updatedAt = now();
    return d;
  });
}

/* ---------- promotion to the pipeline ---------- */

/** Identity core (D85): delegate to the CustomerStore seam — the inline
 *  doc-store ports read a collection that is no longer written. */
async function resolveCustomerId(idOrName: string | null | undefined): Promise<string | null> {
  const { resolveId } = await import("./customers");
  return resolveId(idOrName);
}

/** Rename-safe display name for a customer id (via the store seam). */
async function customerNameFor(id: string): Promise<string> {
  const { nameFor } = await import("./customers");
  return nameFor(id);
}

/**
 * Build the partial that promotes a budgetary design into a real quote.
 * The budgetary value is passed only as a starting reference; requote: true
 * flags that it must be re-priced against live catalog books before final.
 * The canonical customer link flows FORWARD by id (rename-safe).
 */
export async function designToQuotePartial(id: string): Promise<DesignQuotePartial | null> {
  const d = await getDesign(id);
  if (!d) return null;
  const cid = d.customerId || (await resolveCustomerId(d.customer)) || null;
  const cname = cid ? (await customerNameFor(cid)) || d.customer || "" : d.customer || "";
  return {
    name: d.name,
    customerId: cid,
    locationId: d.locationId || null,
    customer: cname,
    value: d.budget,
    margin: 0,
    source: "sandbox",
    requote: true,
    spec: {
      venue: d.venue,
      size: d.size,
      tier: d.tier,
      width: d.width,
      depth: d.depth,
      grid: d.grid,
      systems: d.systems,
      fromDesign: d.id,
    },
  };
}

/* ---------- formatting (ported for parity) ---------- */

export function timeAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const diff = now() - ts;
  const d = Math.floor(diff / DAY);
  if (d <= 0) {
    const h = Math.floor(diff / 3600000);
    return h <= 0 ? "just now" : h + "h ago";
  }
  if (d === 1) return "yesterday";
  if (d < 14) return d + "d ago";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ---------- seed reset ---------- */

/** Port of resetToSeed(): replace the collection with the demo seed set. */
export async function resetDesignsToSeed(): Promise<DesignRecord[]> {
  const { designsSeed } = await import("@/db/seeds/designs");
  const existing = await listDocs<DesignRecord>("designs");
  for (const d of existing) await softDeleteDoc("designs", d.id);
  const seeds = designsSeed();
  for (const d of seeds) await upsertDoc<DesignRecord>("designs", d);
  return seeds;
}
