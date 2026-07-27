import { getDoc, listDocs, nextPrefixedId, patchDoc, upsertDoc } from "@/db/doc-store";
import type { QuoteReview } from "@/lib/stores/quotes";
import {
  approvalIsStale,
  openChecklistItems,
  openComments,
} from "@/lib/consulting-review";
import type { Annotation, Calibration } from "@/lib/annotations";
import {
  engagementSyncAction,
  milestoneSeeds,
  normalizeEngagementStatus,
  type ConsultingScope,
  type EngagementStage,
} from "@/lib/consulting-stages";

/* ------------------------------------------------------------------ *
 * Consulting engagements (D90).
 * Design: docs/superpowers/specs/2026-07-19-consulting-module-design.md.
 * Own record type on purpose (spec §Architecture 3): fixed project stage
 * lists fight per-engagement phases, and consulting would need
 * hand-filtering out of every installs surface. Spawned idempotently from
 * WON `consulting` quotes (quotes→engagements sync, same pattern as
 * repair-jobs). Server-authoritative — NOT in SYNCABLE_COLLECTIONS.
 * Id prefix is CE- (not the spec's C-): C- is the live comm-thread prefix
 * (C-1032…), and a second C- line would be ambiguous everywhere ids
 * surface. Deviation recorded in DECISIONS.md D90.
 * ------------------------------------------------------------------ */

function uid(p?: string): string {
  return (p || "x") + Math.random().toString(36).slice(2, 8);
}

const NO_REVIEW: QuoteReview = {
  state: "none",
  reviewer: null,
  submittedBy: null,
  submittedAt: null,
  decidedBy: null,
  decidedAt: null,
  note: "",
};

/** Doc-store attachment (CommAttachment pattern + provenance) — data-URL
 *  payloads inside the doc, same approach as comms attachments/D59 logos. */
export type EngagementDoc = {
  id: string; // uid('ed-')
  name: string;
  mime: string;
  size: number; // bytes
  dataUrl: string;
  addedBy: string;
  addedAt: number;
};

/** Anchor — what a review comment is about (D92). Keeps the trail itemized
 *  instead of the single free-text `review.note` that carried every review
 *  before this. `annotation` is reserved for the markup canvas (spec §B,
 *  not built yet); it parses today so stored comments survive that landing. */
export type CommentAnchor =
  | { kind: "review" }
  | { kind: "document"; docId: string }
  | { kind: "checklist"; itemId: string }
  | { kind: "lineItem"; lineId: string }
  | { kind: "annotation"; annotationId: string };

/** One itemized comment on a review (D92). Append-only: resolving adds
 *  fields, it never rewrites or removes the original body. */
export type ReviewComment = {
  id: string; // uid('rc-')
  author: string;
  at: number;
  body: string;
  anchor: CommentAnchor;
  /** Threading — replies point at their parent comment id. */
  parentId: string | null;
  state: "open" | "resolved" | "waived";
  /** Marks this comment as one of the edits required to clear a send-back. */
  required: boolean;
  resolvedBy: string | null;
  resolvedAt: number | null;
  /** Required when state is 'waived'. */
  waiveReason: string;
};

/** A frozen record of one artifact as it stood at approval (D92). The file
 *  bytes live in a `review_snapshots` doc, not here — this keeps the
 *  engagement document small (see snapshotId). */
export type PinnedDoc = {
  docId: string;
  name: string;
  size: number;
  /** The attachment's addedAt — our version marker. A re-upload produces a
   *  new doc id and a new stamp, which is what makes staleness detectable. */
  version: number;
};

/** What an approval attests to (D92). If the phase's attachment set no
 *  longer matches `docs`, the approval is stale and the phase wants
 *  re-review — see approvalIsStale(). */
export type ApprovalPin = {
  at: number;
  by: string;
  docs: PinnedDoc[];
  /** Doc-store id in `review_snapshots` holding the frozen file copies. */
  snapshotId: string | null;
};

/** One Peak-standards line on a phase review (D91). Stamped from the
 *  per-phase template at submission and then frozen — editing a template
 *  never rewrites checklists already stamped, because a review is a
 *  point-in-time record. */
export type ChecklistItem = {
  id: string; // uid('ck-')
  text: string;
  state: "open" | "checked" | "waived";
  /** Who checked/waived it, and when. Null while open. */
  by: string | null;
  at: number | null;
  /** Required when state is 'waived' — a waive with no reason is not a waive. */
  reason: string;
};

export type EngagementPhase = {
  id: string; // uid('ph-')
  name: string; // from the phase menu; free rename allowed
  status: "pending" | "active" | "complete";
  /** Internal Peak review — the ONLY thing that gates progress (spec:
   *  customer approvals / architect comments / PE stamps happen in the
   *  world but do not gate the app). Same shape as quote reviews so these
   *  surface in the existing Reviews queue. */
  review: QuoteReview;
  attachments: EngagementDoc[];
  /** Peak-standards checklist (D91). Optional on read: engagements created
   *  before D91 have no checklist — treat absent as empty everywhere. */
  checklist?: ChecklistItem[];
  /** Itemized review comments (D92) — the accountability trail. Optional
   *  for the same back-compat reason. */
  comments?: ReviewComment[];
  /** What an approval actually approved (D92): the artifacts + versions
   *  frozen at the moment of approval. Absent until first approval. */
  approvalPin?: ApprovalPin | null;
  /** Document markup (D95), across all of this phase's attachments.
   *  Optional for the same back-compat reason as the fields above. */
  annotations?: Annotation[];
  /** Real-world scale per document+page (D96), set by calibrating against a
   *  known dimension on the drawing. */
  calibrations?: Calibration[];
};

export type EngagementMilestone = {
  id: string; // uid('ms-')
  name: string;
  targetDate: number; // epoch-ms; 0 = not scheduled yet
  completedAt?: number | null;
  amount?: number | null; // feeds the Reports billing forecast (forecast-only)
};

export type EngagementDecision = {
  id: string; // uid('dc-')
  at: number;
  by: string;
  decision: string;
  context: string;
};

export type EngagementMeeting = {
  id: string; // uid('mt-')
  at: number;
  attendees: string;
  minutes: string;
  decisionIds: string[];
  /** Link to the recording of a virtual meeting (D91). Deliberately a link,
   *  not an upload: Zoom/Meet/Teams already host the video. */
  recordingUrl?: string;
  /** The phase review this meeting covered, when it was a design review. */
  phaseId?: string | null;
  /** Title for the meetings list; falls back to the date when empty. */
  title?: string;
};

export type EngagementSubmittal = {
  id: string; // uid('sb-')
  kind: "submittal" | "rfi";
  ref: string;
  received: number;
  respondedAt?: number | null;
  status: "open" | "answered" | "closed";
  notes: string;
};

/** People-with-roles row — the shape item 16 E requires on projects too;
 *  built here first, shared later (spec §Dependencies). */
export type EngagementPerson = {
  id: string; // uid('pr-')
  person: string; // team-member NAME (app convention)
  role: string;
};

/* Six-stage lifecycle (spec §1, D123). Stored docs may still carry the old
 * 4-status vocabulary — every read below normalizes via LEGACY_STATUS_MAP
 * (lazy migration), and patchEngagement upgrades the literal on the doc's
 * next write. The label map keeps its historical export name so consumers
 * (design/page.tsx, venues) survive unchanged. The open-until-Closed rule
 * (D113 item 11) lives in lib/consulting-stages with the other pure stage
 * helpers — client components import it without dragging in the doc-store. */
export type EngagementStatus = EngagementStage;
export {
  ENGAGEMENT_STAGES,
  ENGAGEMENT_STAGE_KEYS,
  ENGAGEMENT_STAGE_TONE,
  ENGAGEMENT_STATUS_LABEL,
  LEGACY_STATUS_MAP,
  normalizeEngagementStatus,
} from "@/lib/consulting-stages";
export type { ConsultingScope, EngagementStage } from "@/lib/consulting-stages";

export type ConsultingEngagement = {
  id: string; // 'CE-####'
  name: string;
  /** Denormalized display name — same convention as quotes/projects. */
  customer: string;
  /** Identity-core company slug (D85). */
  companyId: string | null;
  siteIds: string[];
  contactName: string;
  people: EngagementPerson[];
  /** Source consulting quote — the paid commitment. */
  quoteId: string;
  /** Linked budgetary designs (D-### records in stores/designs). Spec-gen source. */
  designIds: string[];
  /** If Peak bids the resulting install: an ordinary system quote id.
   *  A reference, never a conversion (spec §Lifecycle). */
  installQuoteId: string | null;
  /** #35 minimal architect link — dumb {company, contact} strings by design,
   *  slated to migrate into item 20's people/roles model. Read `?? null`
   *  (absent on every pre-#35 doc). */
  architect?: { company: string; contact: string } | null;
  status: EngagementStatus;
  phases: EngagementPhase[];
  milestones: EngagementMilestone[];
  decisions: EngagementDecision[];
  meetings: EngagementMeeting[];
  submittals: EngagementSubmittal[];
  documents: EngagementDoc[];
  createdAt: number;
  updatedAt: number;
};

/** Default phase menu (spec §phases) — admin-editable in Settings
 *  (AppSettingsData.consultingPhases), stored overrides win when non-empty. */
export const DEFAULT_CONSULTING_PHASES: string[] = [
  "Assessment",
  "Schematic Design",
  "Design Development",
  "Final Documents",
  "Bid Support",
  "Construction Oversight",
];

/** Stored list if non-empty, else the defaults (mirrors mergedVisitReasons). */
export function mergedConsultingPhases(stored?: string[] | null): string[] {
  const list = (stored || []).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_CONSULTING_PHASES;
}

export function makePhase(name: string): EngagementPhase {
  return {
    id: uid("ph-"),
    name,
    status: "pending",
    review: { ...NO_REVIEW },
    attachments: [],
    checklist: [],
    comments: [],
    approvalPin: null,
  };
}

/* ---------- Peak-standards checklists (D91) ---------- */

/** Default per-phase checklist templates, keyed by phase name. Overridden in
 *  Settings (`AppSettingsData.reviewChecklistTemplates`). A phase with no
 *  template stamps an empty checklist and says so in the UI — better than
 *  inventing standards nobody agreed to. */
export const DEFAULT_REVIEW_CHECKLISTS: Record<string, string[]> = {
  "Schematic Design": [
    "Scope matches the signed consulting quote",
    "Venue dimensions verified against the site survey",
    "Existing infrastructure documented (power, rigging, structure)",
    "Budget range communicated to the customer",
  ],
  "Design Development": [
    "Fixture/equipment selections match Peak's vendor lanes",
    "Circuiting and load calculations complete",
    "Rigging capacities confirmed against structural limits",
    "Control system topology documented",
    "Sightlines and mounting positions checked",
  ],
  "Final Documents": [
    "Drawings coordinated with architectural and electrical sets",
    "Equipment schedule matches the drawings",
    "Specifications complete for every specified product",
    "Owner training and closeout requirements stated",
    "Peak contact information current on every sheet",
  ],
  "Bid Support": [
    "Bid documents match the approved final design",
    "Substitution criteria stated",
    "Addenda log current",
  ],
  "Construction Oversight": [
    "Punch list captured and dated",
    "Field deviations documented against the design",
    "Owner sign-off obtained",
  ],
};

/** Stored overrides win when the phase has one; otherwise the defaults. */
export function checklistTemplateFor(
  phaseName: string,
  stored?: Record<string, string[]> | null
): string[] {
  const override = (stored || {})[phaseName];
  if (override) return override.map((s) => s.trim()).filter(Boolean);
  return DEFAULT_REVIEW_CHECKLISTS[phaseName] || [];
}

export function makeChecklist(texts: string[]): ChecklistItem[] {
  return texts.map((text) => ({
    id: uid("ck-"),
    text,
    state: "open" as const,
    by: null,
    at: null,
    reason: "",
  }));
}

/* The pure status helpers live in `lib/consulting-review.ts` so the
 * "use client" view can import them without pulling the doc-store — and
 * therefore PGlite — into the browser bundle. Re-exported here so server
 * callers can keep importing everything engagement-shaped from one module. */
export { approvalIsStale, openChecklistItems, openComments };

/** Lazy migration (spec §1): stored legacy statuses surface as their mapped
 *  stage on every read; the doc itself upgrades on its next write. */
function normalizeEngagement(e: ConsultingEngagement): ConsultingEngagement {
  const s = normalizeEngagementStatus(String(e.status));
  return s === e.status ? e : { ...e, status: s };
}

export async function allEngagements(): Promise<ConsultingEngagement[]> {
  const list = await listDocs<ConsultingEngagement>("consulting_engagements");
  return list
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map(normalizeEngagement);
}

export async function getEngagement(
  id: string
): Promise<ConsultingEngagement | null> {
  const e = await getDoc<ConsultingEngagement>("consulting_engagements", id);
  return e ? normalizeEngagement(e) : null;
}

export async function patchEngagement(
  id: string,
  mut: (d: ConsultingEngagement) => void
): Promise<void> {
  await patchDoc<ConsultingEngagement>("consulting_engagements", id, (d) => {
    // Lazy-migration write half: any write to a legacy-status doc upgrades
    // the stored literal to the mapped stage (reads already normalize).
    d.status = normalizeEngagementStatus(String(d.status));
    mut(d);
    d.updatedAt = Date.now();
  });
}

/** The consulting payload a consulting-quote builder writes onto the quote
 *  (quotes.ts `consulting?: unknown` — this module owns the shape).
 *  #35 rebuild: new saves write `scopes` (structured line items, total =
 *  scope fees) + `assumptions` (the TICKED library texts, frozen at save) +
 *  `leadId` (auto-lead traceability). `scope`/`feeMode`/`fees` are the
 *  pre-rebuild shape — kept so old quotes render read-only; read all three
 *  new fields with `?? []` / `?? null`. */
export type ConsultingQuotePayload = {
  scope: string;
  feeMode: "fixed" | "milestones";
  /** feeMode 'fixed' → one row; 'milestones' → the fee schedule. */
  fees: Array<{ name: string; amount: number }>;
  terms: string;
  /** Phase names chosen at quote time — seeds the engagement's phases. */
  phases: string[];
  /** #35 structured scopes — id: uid('sc-'). */
  scopes?: ConsultingScope[];
  /** #35 ticked assumption texts, frozen at save. */
  assumptions?: string[];
  /** #35 auto-lead: the open lead this proposal logged against / created. */
  leadId?: string | null;
};

type QuoteLike = {
  id: string;
  name?: string;
  customer?: string;
  customerId?: string | null;
  locationId?: string | null;
  contact?: unknown;
  status?: string;
  quoteType?: string;
  consulting?: ConsultingQuotePayload;
};

function fromQuote(
  q: QuoteLike,
  status: EngagementStage
): Omit<ConsultingEngagement, "id"> {
  const now = Date.now();
  const pay = q.consulting;
  const phases = (pay?.phases?.length
    ? pay.phases
    : DEFAULT_CONSULTING_PHASES
  ).map(makePhase);
  const milestones: EngagementMilestone[] = milestoneSeeds(pay || {}).map(
    (m) => ({
      id: uid("ms-"),
      name: m.name,
      targetDate: 0,
      completedAt: null,
      amount: m.amount,
    })
  );
  const contactName =
    typeof q.contact === "object" && q.contact && "name" in q.contact
      ? String((q.contact as { name?: unknown }).name || "")
      : "";
  return {
    name: q.name || "Consulting engagement",
    customer: q.customer || "",
    companyId: q.customerId || null,
    siteIds: q.locationId ? [q.locationId] : [],
    contactName,
    people: [],
    quoteId: q.id,
    designIds: [],
    installQuoteId: null,
    architect: null,
    status,
    phases,
    milestones,
    decisions: [],
    meetings: [],
    submittals: [],
    documents: [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function getEngagementByQuote(
  quoteId: string
): Promise<ConsultingEngagement | null> {
  const all = await listDocs<ConsultingEngagement>("consulting_engagements");
  const hit = all.find((e) => e.quoteId === quoteId) || null;
  return hit ? normalizeEngagement(hit) : null;
}

/** The engagement referencing this quote either as its source (quoteId) or
 *  as Peak's own bid on the spec (installQuoteId). Selected-quote lookups
 *  ONLY — full scan, same cost class as getEngagementByQuote; never call
 *  per row. */
export async function getEngagementForQuoteRef(
  quoteId: string
): Promise<ConsultingEngagement | null> {
  const all = await listDocs<ConsultingEngagement>("consulting_engagements");
  const hit =
    all.find((e) => e.quoteId === quoteId) ||
    all.find((e) => e.installQuoteId === quoteId) ||
    null;
  return hit ? normalizeEngagement(hit) : null;
}

/** Idempotently make sure a consulting quote has its engagement, born at
 *  least at `minStage` (spec §1 spawn model): sent → proposal_sent, won →
 *  awarded. An existing engagement only ever ADVANCES proposal_sent →
 *  awarded — a stage a human moved past proposal_sent is never touched.
 *  (Same idempotence contract as the old createFromQuote it replaces.) */
export async function ensureEngagementForQuote(
  quoteId: string,
  minStage: "proposal_sent" | "awarded"
): Promise<ConsultingEngagement | null> {
  const existing = await getEngagementByQuote(quoteId);
  if (existing) {
    if (minStage === "awarded" && existing.status === "proposal_sent") {
      await patchEngagement(existing.id, (d) => {
        d.status = "awarded";
      });
      return getEngagement(existing.id);
    }
    return existing;
  }
  const q = await getDoc<QuoteLike>("quotes", quoteId);
  if (!q || q.quoteType !== "consulting") return null;
  const body = fromQuote(q, minStage);
  const id = await nextPrefixedId("consulting_engagements", "CE", 1000);
  const rec: ConsultingEngagement = { ...body, id };
  await upsertDoc<ConsultingEngagement>("consulting_engagements", rec);
  return rec;
}

/** Consulting quotes → engagements (fifth sync in the on-win fan-out, AND
 *  the loadConsultingData safety net — estimator/inbox status paths never
 *  run syncs, mirroring syncProjectsFromQuotes-on-load). Applies the pure
 *  engagementSyncAction rules per quote: sent/won create (proposal_sent /
 *  awarded), won advances a proposal_sent record to awarded, lost closes a
 *  still-proposal_sent record with a "Proposal lost" decision entry.
 *  Idempotent throughout. Returns the number of records touched. */
export async function syncEngagementsFromQuotes(): Promise<number> {
  const engagements = await listDocs<ConsultingEngagement>(
    "consulting_engagements"
  );
  const byQuote = new Map<string, ConsultingEngagement>();
  for (const e of engagements) byQuote.set(e.quoteId, e);
  const quotes = await listDocs<QuoteLike>("quotes");
  let changed = 0;
  for (const q of quotes) {
    if (q.quoteType !== "consulting") continue;
    const existing = byQuote.get(q.id) || null;
    const stage = existing
      ? normalizeEngagementStatus(String(existing.status))
      : null;
    const action = engagementSyncAction(String(q.status || ""), stage);
    if (!action) continue;
    if (action.kind === "create") {
      const body = fromQuote(q, action.stage);
      const id = await nextPrefixedId("consulting_engagements", "CE", 1000);
      const rec: ConsultingEngagement = { ...body, id };
      await upsertDoc<ConsultingEngagement>("consulting_engagements", rec);
      byQuote.set(q.id, rec);
    } else if (action.kind === "advance" || action.kind === "reopen") {
      // "advance" (→ awarded) and "reopen" (→ proposal_sent) are both a
      // plain stage overwrite; only "close" below needs the decision entry.
      await patchEngagement(existing!.id, (d) => {
        d.status = action.stage;
      });
    } else {
      await patchEngagement(existing!.id, (d) => {
        d.status = "closed";
        d.decisions.unshift({
          id: uid("dc-"),
          at: Date.now(),
          by: "System",
          decision: "Proposal lost",
          context: `Consulting quote ${q.id} was marked lost while this engagement was still at Proposal sent.`,
        });
      });
    }
    changed++;
  }
  return changed;
}

/** Attach a document to the engagement (phaseId null) or to one phase's
 *  deliverables list. */
export async function addPhaseDocTo(
  engId: string,
  phaseId: string | null,
  doc: EngagementDoc
): Promise<void> {
  await patchEngagement(engId, (d) => {
    if (phaseId) {
      const ph = d.phases.find((p) => p.id === phaseId);
      if (ph) ph.attachments.push(doc);
    } else {
      d.documents.push(doc);
    }
  });
}

/* ---------- phase reviews (mirror quotes.ts submitForReview/claim/
 * approve/requestChanges, operating on phases[].review) ---------- */

function phaseOf(d: ConsultingEngagement, phaseId: string): EngagementPhase | null {
  return d.phases.find((p) => p.id === phaseId) || null;
}

/** Submit for internal review. `template` is the phase's standards checklist
 *  (resolved by the caller from settings) — stamped only when the phase has
 *  no checklist yet, so a resubmission after changes keeps the progress the
 *  reviewers already made. */
export async function submitPhaseReview(
  engId: string,
  phaseId: string,
  by: string,
  template: string[] = []
): Promise<void> {
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    if (!ph) return;
    ph.review = {
      ...NO_REVIEW,
      state: "in_review",
      submittedBy: by,
      submittedAt: Date.now(),
    };
    if (!ph.checklist?.length && template.length) {
      ph.checklist = makeChecklist(template);
    }
  });
}

export async function claimPhaseReview(
  engId: string,
  phaseId: string,
  reviewer: string
): Promise<void> {
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    if (!ph || ph.review.state !== "in_review") return;
    ph.review.reviewer = reviewer;
  });
}

/** Approve — gated (D91/D92). Every standards item must be checked or
 *  waived and every comment resolved or waived first, so an approval can
 *  never outrun the objections raised against it. On success the approval is
 *  pinned to the exact artifacts reviewed; frozen copies are written by the
 *  caller (server action) into `review_snapshots` and passed as snapshotId. */
export async function approvePhaseReview(
  engId: string,
  phaseId: string,
  by: string,
  snapshotId: string | null = null
): Promise<{ ok: true } | { ok: false; error: string }> {
  let error = "";
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    if (!ph || ph.review.state !== "in_review") {
      error = "This phase is not awaiting review.";
      return;
    }
    const openItems = openChecklistItems(ph).length;
    const openCs = openComments(ph).length;
    if (openItems || openCs) {
      const parts: string[] = [];
      if (openItems) parts.push(`${openItems} standards item${openItems === 1 ? "" : "s"}`);
      if (openCs) parts.push(`${openCs} comment${openCs === 1 ? "" : "s"}`);
      error = `Resolve or waive ${parts.join(" and ")} before approving.`;
      return;
    }
    ph.review.state = "approved";
    ph.review.decidedBy = by;
    ph.review.decidedAt = Date.now();
    ph.approvalPin = {
      at: Date.now(),
      by,
      docs: ph.attachments.map((a) => ({
        docId: a.id,
        name: a.name,
        size: a.size,
        version: a.addedAt,
      })),
      snapshotId,
    };
  });
  return error ? { ok: false, error } : { ok: true };
}

/** Send back with edits (D92). Every open comment becomes a required edit —
 *  the submitter gets a specific list, not a paragraph to interpret. `note`
 *  is kept for the summary line and back-compat with the Reviews queue. */
export async function requestPhaseChanges(
  engId: string,
  phaseId: string,
  by: string,
  note: string
): Promise<void> {
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    if (!ph || ph.review.state !== "in_review") return;
    ph.review.state = "changes";
    ph.review.decidedBy = by;
    ph.review.decidedAt = Date.now();
    ph.review.note = note;
    for (const c of ph.comments || []) {
      if (c.state === "open") c.required = true;
    }
  });
}

/* ---------- checklist + comment mutations (D91/D92) ---------- */

export async function setChecklistItem(
  engId: string,
  phaseId: string,
  itemId: string,
  state: ChecklistItem["state"],
  by: string,
  reason = ""
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (state === "waived" && !reason.trim()) {
    return { ok: false, error: "A waived item needs a reason." };
  }
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    const item = (ph?.checklist || []).find((c) => c.id === itemId);
    if (!item) return;
    item.state = state;
    item.by = state === "open" ? null : by;
    item.at = state === "open" ? null : Date.now();
    item.reason = state === "waived" ? reason.trim() : "";
  });
  return { ok: true };
}

export async function addReviewComment(
  engId: string,
  phaseId: string,
  author: string,
  body: string,
  anchor: CommentAnchor = { kind: "review" },
  parentId: string | null = null
): Promise<void> {
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    if (!ph) return;
    if (!ph.comments) ph.comments = [];
    ph.comments.push({
      id: uid("rc-"),
      author,
      at: Date.now(),
      body: body.trim(),
      anchor,
      parentId,
      state: "open",
      required: false,
      resolvedBy: null,
      resolvedAt: null,
      waiveReason: "",
    });
  });
}

/** Resolve or waive a comment. The body is never rewritten — the trail is
 *  append-only, so history stays readable after the fact. */
export async function setCommentState(
  engId: string,
  phaseId: string,
  commentId: string,
  state: ReviewComment["state"],
  by: string,
  waiveReason = ""
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (state === "waived" && !waiveReason.trim()) {
    return { ok: false, error: "A waived comment needs a reason." };
  }
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    const c = (ph?.comments || []).find((x) => x.id === commentId);
    if (!c) return;
    c.state = state;
    c.resolvedBy = state === "open" ? null : by;
    c.resolvedAt = state === "open" ? null : Date.now();
    c.waiveReason = state === "waived" ? waiveReason.trim() : "";
  });
  return { ok: true };
}

/* ---------- document markup (D95) ---------- */

export async function addAnnotation(
  engId: string,
  phaseId: string,
  a: Omit<Annotation, "id">
): Promise<string> {
  const id = uid("an-");
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    if (!ph) return;
    if (!ph.annotations) ph.annotations = [];
    ph.annotations.push({ ...a, id });
  });
  return id;
}

export async function deleteAnnotation(
  engId: string,
  phaseId: string,
  annotationId: string
): Promise<void> {
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    if (!ph?.annotations) return;
    ph.annotations = ph.annotations.filter((x) => x.id !== annotationId);
  });
}

/** Set (or replace) the scale for one document page. One calibration per
 *  page: a second one would silently change every existing measurement on
 *  that page, so replacing in place keeps the page internally consistent. */
export async function setCalibration(
  engId: string,
  phaseId: string,
  cal: Calibration
): Promise<void> {
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    if (!ph) return;
    if (!ph.calibrations) ph.calibrations = [];
    ph.calibrations = ph.calibrations.filter(
      (c) => !(c.docId === cal.docId && c.page === cal.page)
    );
    ph.calibrations.push(cal);
  });
}

export async function clearCalibration(
  engId: string,
  phaseId: string,
  docId: string,
  page: number
): Promise<void> {
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    if (!ph?.calibrations) return;
    ph.calibrations = ph.calibrations.filter(
      (c) => !(c.docId === docId && c.page === page)
    );
  });
}

/** Raise a review comment FROM a piece of markup — the link that puts the
 *  drawing markup into the same accountability trail as everything else, so
 *  the approval gate counts it. */
export async function commentOnAnnotation(
  engId: string,
  phaseId: string,
  annotationId: string,
  author: string,
  body: string
): Promise<void> {
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    if (!ph) return;
    const ann = (ph.annotations || []).find((x) => x.id === annotationId);
    if (!ann) return;
    if (!ph.comments) ph.comments = [];
    const commentId = uid("rc-");
    ph.comments.push({
      id: commentId,
      author,
      at: Date.now(),
      body: body.trim(),
      anchor: { kind: "annotation", annotationId },
      parentId: null,
      state: "open",
      required: false,
      resolvedBy: null,
      resolvedAt: null,
      waiveReason: "",
    });
    ann.commentId = commentId;
  });
}

/* ---------- meetings (D91) ---------- */

export async function addMeeting(
  engId: string,
  m: Omit<EngagementMeeting, "id">
): Promise<void> {
  await patchEngagement(engId, (d) => {
    d.meetings.push({ ...m, id: uid("mt-") });
  });
}

export async function updateMeeting(
  engId: string,
  meetingId: string,
  patch: Partial<Omit<EngagementMeeting, "id">>
): Promise<void> {
  await patchEngagement(engId, (d) => {
    const m = d.meetings.find((x) => x.id === meetingId);
    if (m) Object.assign(m, patch);
  });
}

export async function deleteMeeting(engId: string, meetingId: string): Promise<void> {
  await patchEngagement(engId, (d) => {
    d.meetings = d.meetings.filter((m) => m.id !== meetingId);
  });
}

/** THE gate (spec §phases): a phase cannot complete without an approved
 *  internal review — enforced here in the store, not just in the UI. */
export async function setPhaseStatus(
  engId: string,
  phaseId: string,
  status: EngagementPhase["status"]
): Promise<{ ok: true } | { ok: false; error: string }> {
  let error = "";
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    if (!ph) return;
    if (status === "complete") {
      if (ph.review.state !== "approved") {
        error = "This phase needs an approved internal review before it can complete.";
        return;
      }
      if (approvalIsStale(ph)) {
        error =
          "The documents changed after approval — this phase needs re-review before it can complete.";
        return;
      }
    }
    ph.status = status;
  });
  return error ? { ok: false, error } : { ok: true };
}
