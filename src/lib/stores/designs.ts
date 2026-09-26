import {
  getDoc,
  insertWithPrefixedId,
  listDocs,
  patchDoc,
  softDeleteDoc,
  upsertDoc,
} from "@/db/doc-store";
import { create as createQuote, update as updateQuote, get as getQuoteById, type Quote } from "@/lib/stores/quotes";
import { getProject } from "@/lib/stores/grid-projects";
import { buildGridQuote } from "@/lib/design/grid-quote";

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
  /** Equipment-map completeness of the chosen tier at save time (#GEM
   *  D-GEM-10) — set whenever any line of that tier still needs a part.
   *  Additive: missing/undefined on every pre-#GEM record reads as complete
   *  (the dashboard and guard both treat a missing field as needsPart: 0). */
  incomplete?: { needsPart: number };
  updatedAt: number;
  /** Revision history — travels WITH the design record so it persists. */
  revisions?: DesignRevision[];
  /** Opaque drawing/designer state saved by the Quick Design screen. Not interpreted server-side. */
  config?: Record<string, unknown> | null;
  /** Which editor built this design (D108/D-grid-merge). Missing/undefined
   *  on every pre-merge record reads as "quick" — the original Quick Design
   *  canvas. Locked at creation: the two modes store completely different
   *  shapes (`config` blob vs. `gridProjectId` link) and there is no
   *  conversion between them. */
  layoutMode?: "quick" | "manual";
  /** Linked `grid_projects` row (The Grid's plan-sheet editor) — set only
   *  when layoutMode is "manual". The project's own store, BOM engine and
   *  revision log stay untouched; this is a pointer, not a copy. */
  gridProjectId?: string | null;
  /** Draft quote this design has been promoted to, if any — mirrors
   *  `grid_projects.quoteId`'s re-quote-in-place pattern. Promoting again
   *  updates this same quote (while it's still a draft) instead of minting
   *  a new one, and the design record itself is never deleted. */
  quoteId?: string | null;
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
  /** Customer's resolved pricing tier (punch #65) — always stamped so the
   *  Estimator seeds labor/curtain margins from the real tier, not a
   *  hardcoded default. */
  pricingTier: string;
  tierMargin: number;
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
  const designs = list.map(normalizeDesign).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return Promise.all(designs.map(withLiveGridBudget));
}

export async function getDesign(id: string): Promise<DesignRecord | null> {
  const d = await getDoc<DesignRecord>("designs", id);
  return d ? withLiveGridBudget(normalizeDesign(d)) : null;
}

/** Manual/Grid designs do not have a reliable parametric `budget` snapshot.
 * Read their current BOM total instead, so the Designs dashboard cannot show
 * the creation-time zero after a designer has placed equipment. Quick Design
 * records retain their saved equation result. */
async function withLiveGridBudget(d: DesignRecord): Promise<DesignRecord> {
  if (d.layoutMode !== "manual" || !d.gridProjectId) return d;
  const project = await getProject(d.gridProjectId);
  if (!project) return d;
  const optionId = project.options?.[0]?.id;
  if (!optionId) return d;
  try {
    const built = await buildGridQuote(project, optionId);
    if (built.ok) return { ...d, budget: built.build.value };
  } catch {
    // A dashboard read must not fail because a partially edited Grid cannot
    // currently be priced; the persisted budget remains the safe fallback.
  }
  return d;
}

export async function createDesign(
  partial: Partial<DesignRecord> = {}
): Promise<DesignRecord> {
  const t = now();
  const build = (id: string): DesignRecord => {
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
    return d;
  };
  if (partial.id) {
    const d = build(partial.id);
    await upsertDoc<DesignRecord>("designs", d);
    return d;
  }
  return insertWithPrefixedId<DesignRecord>("designs", "D", 100, build);
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
 *
 * This is the single choke point all three promote paths (Quick Design's
 * addToQuotesAction, and both promoteDesignAction copies) pass through, so
 * the customer's real pricing tier is resolved and stamped HERE (punch
 * #65) — no caller may leave pricingTier/tierMargin unset. Without this,
 * the Estimator's freshLabor()/curtain draft seed hardcodes 30% whenever
 * tierMargin is missing, which silently mispriced every non-Base tier.
 */
export async function designToQuotePartial(id: string): Promise<DesignQuotePartial | null> {
  const d = await getDesign(id);
  if (!d) return null;
  const cid = d.customerId || (await resolveCustomerId(d.customer)) || null;
  const cname = cid ? (await customerNameFor(cid)) || d.customer || "" : d.customer || "";
  const { resolveTier } = await import("@/lib/pricing-tiers");
  const resolvedTier = await resolveTier(cid);
  return {
    name: d.name,
    customerId: cid,
    locationId: d.locationId || null,
    customer: cname,
    value: d.budget,
    margin: 0,
    source: "sandbox",
    requote: true,
    pricingTier: resolvedTier.tier,
    tierMargin: resolvedTier.margin,
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

/**
 * Shared promotion flow for Quick-layout designs (punch #75): Quick Design's
 * addToQuotesAction and the Designs dashboard's promoteDesignAction (quick
 * records only — manual-layout records delegate to The Grid's own
 * createDraftQuoteAction instead, see design/designs/actions.ts) both go
 * through here for the common build-partial → create-or-update-quote steps.
 *
 * Re-quote-in-place (D-grid-merge): a design is no longer deleted when
 * promoted — it stays budgetary/visible, and `quoteId` tracks the linked
 * draft. A later promote updates that SAME quote in place as long as it's
 * still a draft (mirrors the pattern `grid_projects.quoteId` already used);
 * once the quote has moved past draft, promoting again mints a new one
 * rather than silently rewriting a quote a customer may have seen.
 *
 * Returns null when the design can't be found (mirrors
 * designToQuotePartial); callers decide how to surface that (throw vs.
 * `{ok:false}`).
 */
export async function promoteDesignToQuote(
  id: string,
  owner: string
): Promise<Quote | null> {
  const d = await getDesign(id);
  if (!d) return null;
  const partial = await designToQuotePartial(id);
  if (!partial) return null;

  const existing = d.quoteId ? await getQuoteById(d.quoteId) : null;
  if (existing && existing.status === "draft") {
    const q = await updateQuote(existing.id, { ...(partial as unknown as Partial<Quote>), owner });
    return q;
  }

  const q = await createQuote({ ...(partial as unknown as Partial<Quote>), owner });
  // designToQuotePartial's requote is always true by type, but keep the
  // conditional — it's what all three original call sites did.
  if (partial.requote) {
    await updateQuote(q.id, { requote: true } as unknown as Partial<Quote>);
  }
  await updateDesign(id, { quoteId: q.id });
  return q;
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
