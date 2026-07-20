import { getDoc, listDocs, nextPrefixedId, patchDoc, upsertDoc } from "@/db/doc-store";
import type { QuoteReview } from "@/lib/stores/quotes";

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

export type EngagementStatus =
  | "active"
  | "delivered"
  | "bid_supported"
  | "oversight_complete";

export const ENGAGEMENT_STATUS_LABEL: Record<EngagementStatus, string> = {
  active: "Active",
  delivered: "Delivered",
  bid_supported: "Bid supported",
  oversight_complete: "Oversight complete",
};

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
  /** Optional Design Studio saved-design links (spec-gen source). */
  designIds: string[];
  /** If Peak bids the resulting install: an ordinary system quote id.
   *  A reference, never a conversion (spec §Lifecycle). */
  installQuoteId: string | null;
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
  };
}

export async function allEngagements(): Promise<ConsultingEngagement[]> {
  const list = await listDocs<ConsultingEngagement>("consulting_engagements");
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export async function getEngagement(
  id: string
): Promise<ConsultingEngagement | null> {
  return getDoc<ConsultingEngagement>("consulting_engagements", id);
}

export async function patchEngagement(
  id: string,
  mut: (d: ConsultingEngagement) => void
): Promise<void> {
  await patchDoc<ConsultingEngagement>("consulting_engagements", id, (d) => {
    mut(d);
    d.updatedAt = Date.now();
  });
}

/** The consulting payload a consulting-quote builder writes onto the quote
 *  (quotes.ts `consulting?: unknown` — this module owns the shape). */
export type ConsultingQuotePayload = {
  scope: string;
  feeMode: "fixed" | "milestones";
  /** feeMode 'fixed' → one row; 'milestones' → the fee schedule. */
  fees: Array<{ name: string; amount: number }>;
  terms: string;
  /** Phase names chosen at quote time — seeds the engagement's phases. */
  phases: string[];
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

function fromQuote(q: QuoteLike): Omit<ConsultingEngagement, "id"> {
  const now = Date.now();
  const pay = q.consulting;
  const phases = (pay?.phases?.length
    ? pay.phases
    : DEFAULT_CONSULTING_PHASES
  ).map(makePhase);
  const milestones: EngagementMilestone[] =
    pay?.feeMode === "milestones"
      ? (pay.fees || []).map((f) => ({
          id: uid("ms-"),
          name: f.name || "Milestone",
          targetDate: 0,
          completedAt: null,
          amount: f.amount || 0,
        }))
      : [];
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
    status: "active",
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
  return all.find((e) => e.quoteId === quoteId) || null;
}

/** Convert a specific won consulting quote into an engagement — idempotent
 *  (same contract as createProjectFromQuote / repair createFromQuote). */
export async function createFromQuote(
  quoteId: string
): Promise<ConsultingEngagement | null> {
  const existing = await getEngagementByQuote(quoteId);
  if (existing) return existing;
  const q = await getDoc<QuoteLike>("quotes", quoteId);
  if (!q || q.quoteType !== "consulting") return null;
  const body = fromQuote(q);
  const id = await nextPrefixedId("consulting_engagements", "CE", 1000);
  const rec: ConsultingEngagement = { ...body, id };
  await upsertDoc<ConsultingEngagement>("consulting_engagements", rec);
  return rec;
}

/** Won consulting quotes → engagements (fifth sync in the on-win fan-out). */
export async function syncEngagementsFromQuotes(): Promise<number> {
  const engagements = await listDocs<ConsultingEngagement>(
    "consulting_engagements"
  );
  const haveQ = new Set<string>();
  for (const e of engagements) haveQ.add(e.quoteId);
  const quotes = await listDocs<QuoteLike>("quotes");
  let made = 0;
  for (const q of quotes) {
    if (q.quoteType !== "consulting" || q.status !== "won") continue;
    if (haveQ.has(q.id)) continue;
    const body = fromQuote(q);
    const id = await nextPrefixedId("consulting_engagements", "CE", 1000);
    await upsertDoc<ConsultingEngagement>("consulting_engagements", {
      ...body,
      id,
    });
    haveQ.add(q.id);
    made++;
  }
  return made;
}

/* ---------- phase reviews (mirror quotes.ts submitForReview/claim/
 * approve/requestChanges, operating on phases[].review) ---------- */

function phaseOf(d: ConsultingEngagement, phaseId: string): EngagementPhase | null {
  return d.phases.find((p) => p.id === phaseId) || null;
}

export async function submitPhaseReview(
  engId: string,
  phaseId: string,
  by: string
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

export async function approvePhaseReview(
  engId: string,
  phaseId: string,
  by: string
): Promise<void> {
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    if (!ph || ph.review.state !== "in_review") return;
    ph.review.state = "approved";
    ph.review.decidedBy = by;
    ph.review.decidedAt = Date.now();
  });
}

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
  });
}

/** THE gate (spec §phases): a phase cannot complete without an approved
 *  internal review — enforced here in the store, not just in the UI. */
export async function setPhaseStatus(
  engId: string,
  phaseId: string,
  status: EngagementPhase["status"]
): Promise<{ ok: true } | { ok: false; error: string }> {
  let blocked = false;
  await patchEngagement(engId, (d) => {
    const ph = phaseOf(d, phaseId);
    if (!ph) return;
    if (status === "complete" && ph.review.state !== "approved") {
      blocked = true;
      return;
    }
    ph.status = status;
  });
  return blocked
    ? { ok: false, error: "This phase needs an approved internal review before it can complete." }
    : { ok: true };
}
