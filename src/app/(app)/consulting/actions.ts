"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  addAnnotation,
  addPhaseDocTo,
  addReviewComment,
  clearCalibration,
  commentOnAnnotation,
  deleteAnnotation,
  setCalibration,
  checklistTemplateFor,
  type CommentAnchor,
  deleteMeeting,
  type EngagementDoc,
  type EngagementMilestone,
  type EngagementPerson,
  type EngagementStatus,
  type EngagementSubmittal,
  getEngagement,
  makeChecklist,
  makePhase,
  patchEngagement,
  setChecklistItem,
  setCommentState,
  setPhaseStatus,
  submitPhaseReview,
  updateMeeting,
} from "@/lib/stores/engagements";
import { getSettings } from "@/lib/settings";
import type { Annotation, MeasureUnit } from "@/lib/annotations";
import { linkVisitToEngagement } from "@/lib/stores/site-visits";

/**
 * Consulting module server actions (D90) — thin, session-gated wrappers over
 * the engagements store, one revalidate per mutation (app convention).
 * Phase review CLAIM/APPROVE/CHANGES are NOT here — they run through the
 * approver-gated Reviews queue actions (reviews/actions.ts), same as quotes.
 */

function uid(p?: string): string {
  return (p || "x") + Math.random().toString(36).slice(2, 8);
}

async function done(): Promise<{ ok: true }> {
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ---------- header / overview ---------- */

export async function setEngagementStatusAction(
  engId: string,
  status: EngagementStatus
) {
  await requireUser();
  await patchEngagement(engId, (d) => {
    d.status = status;
  });
  return done();
}

export async function setPeopleAction(
  engId: string,
  people: Array<{ person: string; role: string }>
) {
  await requireUser();
  const clean: EngagementPerson[] = (Array.isArray(people) ? people : [])
    .map((p) => ({
      id: uid("pr-"),
      person: String(p?.person || "").trim(),
      role: String(p?.role || "").trim() || "Contributor",
    }))
    .filter((p) => p.person)
    .slice(0, 20);
  await patchEngagement(engId, (d) => {
    d.people = clean;
  });
  return done();
}

export async function linkInstallQuoteAction(
  engId: string,
  quoteId: string | null
) {
  await requireUser();
  await patchEngagement(engId, (d) => {
    d.installQuoteId = quoteId ? String(quoteId).trim() : null;
  });
  return done();
}

export async function setDesignIdsAction(engId: string, designIds: string[]) {
  await requireUser();
  const clean = (Array.isArray(designIds) ? designIds : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 20);
  await patchEngagement(engId, (d) => {
    d.designIds = clean;
  });
  return done();
}

/* ---------- phases ---------- */

export async function addPhaseAction(engId: string, name: string) {
  await requireUser();
  const n = String(name || "").trim();
  if (!n) return { ok: false as const, error: "Phase needs a name." };
  await patchEngagement(engId, (d) => {
    d.phases.push(makePhase(n));
  });
  return done();
}

export async function removePhaseAction(engId: string, phaseId: string) {
  await requireUser();
  await patchEngagement(engId, (d) => {
    d.phases = d.phases.filter((p) => p.id !== phaseId);
  });
  return done();
}

export async function renamePhaseAction(
  engId: string,
  phaseId: string,
  name: string
) {
  await requireUser();
  const n = String(name || "").trim();
  if (!n) return { ok: false as const, error: "Phase needs a name." };
  await patchEngagement(engId, (d) => {
    const ph = d.phases.find((p) => p.id === phaseId);
    if (ph) ph.name = n;
  });
  return done();
}

export async function setPhaseStatusAction(
  engId: string,
  phaseId: string,
  status: "pending" | "active" | "complete"
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const r = await setPhaseStatus(engId, phaseId, status);
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function submitPhaseReviewAction(engId: string, phaseId: string) {
  const user = await requireUser();
  // Resolve the phase's standards template here (D91) — the store stays free
  // of settings so it can be reasoned about and tested on its own.
  const eng = await getEngagement(engId);
  const phase = eng?.phases.find((p) => p.id === phaseId);
  const settings = await getSettings();
  const template = phase
    ? checklistTemplateFor(phase.name, settings.reviewChecklistTemplates)
    : [];
  await submitPhaseReview(engId, phaseId, user.name, template);
  return done();
}

/* ---------- standards checklist (D91) ---------- */

export async function setChecklistItemAction(
  engId: string,
  phaseId: string,
  itemId: string,
  state: "open" | "checked" | "waived",
  reason = ""
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await setChecklistItem(engId, phaseId, itemId, state, user.name, reason);
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Add an ad-hoc line to a stamped checklist — reviews turn up standards the
 *  template missed, and losing them until someone edits Settings would mean
 *  losing them entirely. */
export async function addChecklistItemAction(
  engId: string,
  phaseId: string,
  text: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const clean = String(text || "").trim();
  if (!clean) return { ok: false, error: "The item needs text." };
  await patchEngagement(engId, (d) => {
    const ph = d.phases.find((p) => p.id === phaseId);
    if (!ph) return;
    if (!ph.checklist) ph.checklist = [];
    ph.checklist.push(...makeChecklist([clean]));
  });
  return done();
}

/* ---------- review comments (D92) ---------- */

export async function addReviewCommentAction(
  engId: string,
  phaseId: string,
  body: string,
  anchor?: CommentAnchor,
  parentId?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const clean = String(body || "").trim();
  if (!clean) return { ok: false, error: "The comment is empty." };
  await addReviewComment(
    engId,
    phaseId,
    user.name,
    clean,
    anchor || { kind: "review" },
    parentId ?? null
  );
  return done();
}

export async function setCommentStateAction(
  engId: string,
  phaseId: string,
  commentId: string,
  state: "open" | "resolved" | "waived",
  waiveReason = ""
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await setCommentState(
    engId,
    phaseId,
    commentId,
    state,
    user.name,
    waiveReason
  );
  if (!r.ok) return r;
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ---------- document markup (D95) ---------- */

export async function addAnnotationAction(
  engId: string,
  phaseId: string,
  input: {
    docId: string;
    page: number;
    tool: Annotation["tool"];
    color: string;
    points: Array<{ x: number; y: number }>;
    text?: string;
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!input?.points?.length) return { ok: false, error: "Nothing was drawn." };
  const id = await addAnnotation(engId, phaseId, {
    docId: String(input.docId),
    page: Number(input.page) || 1,
    tool: input.tool,
    color: String(input.color || "#d5342a"),
    // Clamp on the way in: a drag that leaves the page must not store
    // out-of-range coordinates that render off-canvas later.
    points: input.points.map((p) => ({
      x: Math.min(1, Math.max(0, Number(p.x) || 0)),
      y: Math.min(1, Math.max(0, Number(p.y) || 0)),
    })),
    text: String(input.text || ""),
    author: user.name,
    at: Date.now(),
    commentId: null,
  });
  revalidatePath("/", "layout");
  return { ok: true, id };
}

export async function deleteAnnotationAction(
  engId: string,
  phaseId: string,
  annotationId: string
) {
  await requireUser();
  await deleteAnnotation(engId, phaseId, annotationId);
  return done();
}

export async function setCalibrationAction(
  engId: string,
  phaseId: string,
  input: {
    docId: string;
    page: number;
    scale: number;
    unit: MeasureUnit;
    refLength: number;
  }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!(Number(input?.scale) > 0)) {
    return { ok: false, error: "That reference length doesn't give a usable scale." };
  }
  await setCalibration(engId, phaseId, {
    docId: String(input.docId),
    page: Number(input.page) || 1,
    scale: Number(input.scale),
    unit: input.unit,
    refLength: Number(input.refLength) || 0,
    by: user.name,
    at: Date.now(),
  });
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function clearCalibrationAction(
  engId: string,
  phaseId: string,
  docId: string,
  page: number
) {
  await requireUser();
  await clearCalibration(engId, phaseId, docId, page);
  return done();
}

export async function commentOnAnnotationAction(
  engId: string,
  phaseId: string,
  annotationId: string,
  body: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const clean = String(body || "").trim();
  if (!clean) return { ok: false, error: "The comment is empty." };
  await commentOnAnnotation(engId, phaseId, annotationId, user.name, clean);
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ---------- meetings (D91) ---------- */

export async function updateMeetingAction(
  engId: string,
  meetingId: string,
  patch: {
    title?: string;
    at?: number;
    attendees?: string;
    minutes?: string;
    recordingUrl?: string;
    phaseId?: string | null;
  }
) {
  await requireUser();
  await updateMeeting(engId, meetingId, patch);
  return done();
}

export async function deleteMeetingAction(engId: string, meetingId: string) {
  await requireUser();
  await deleteMeeting(engId, meetingId);
  return done();
}

/* ---------- milestones ---------- */

export async function addMilestoneAction(
  engId: string,
  input: { name: string; targetDate: number; amount: number | null }
) {
  await requireUser();
  const name = String(input?.name || "").trim();
  if (!name) return { ok: false as const, error: "Milestone needs a name." };
  const ms: EngagementMilestone = {
    id: uid("ms-"),
    name,
    targetDate: Number(input?.targetDate) || 0,
    completedAt: null,
    amount:
      input?.amount == null || !Number.isFinite(Number(input.amount))
        ? null
        : Math.max(0, Math.round(Number(input.amount))),
  };
  await patchEngagement(engId, (d) => {
    d.milestones.push(ms);
  });
  return done();
}

export async function updateMilestoneAction(
  engId: string,
  msId: string,
  input: { name?: string; targetDate?: number; amount?: number | null }
) {
  await requireUser();
  await patchEngagement(engId, (d) => {
    const ms = d.milestones.find((m) => m.id === msId);
    if (!ms) return;
    if (input.name != null && String(input.name).trim())
      ms.name = String(input.name).trim();
    if (input.targetDate != null) ms.targetDate = Number(input.targetDate) || 0;
    if (input.amount !== undefined)
      ms.amount =
        input.amount == null || !Number.isFinite(Number(input.amount))
          ? null
          : Math.max(0, Math.round(Number(input.amount)));
  });
  return done();
}

export async function completeMilestoneAction(
  engId: string,
  msId: string,
  complete: boolean
) {
  await requireUser();
  await patchEngagement(engId, (d) => {
    const ms = d.milestones.find((m) => m.id === msId);
    if (ms) ms.completedAt = complete ? Date.now() : null;
  });
  return done();
}

export async function removeMilestoneAction(engId: string, msId: string) {
  await requireUser();
  await patchEngagement(engId, (d) => {
    d.milestones = d.milestones.filter((m) => m.id !== msId);
  });
  return done();
}

/* ---------- decisions & meetings ---------- */

export async function addDecisionAction(
  engId: string,
  decision: string,
  context: string
) {
  const user = await requireUser();
  const text = String(decision || "").trim();
  if (!text) return { ok: false as const, error: "What was decided?" };
  await patchEngagement(engId, (d) => {
    d.decisions.unshift({
      id: uid("dc-"),
      at: Date.now(),
      by: user.name,
      decision: text,
      context: String(context || "").trim(),
    });
  });
  return done();
}

/** D91 extends this with title, a recording link, and the phase review the
 *  meeting covered. All three are optional so existing callers still work. */
export async function addMeetingAction(
  engId: string,
  input: {
    at: number;
    attendees: string;
    minutes: string;
    decisionIds: string[];
    title?: string;
    recordingUrl?: string;
    phaseId?: string | null;
  }
) {
  await requireUser();
  await patchEngagement(engId, (d) => {
    d.meetings.unshift({
      id: uid("mt-"),
      at: Number(input?.at) || Date.now(),
      attendees: String(input?.attendees || "").trim(),
      minutes: String(input?.minutes || "").trim(),
      decisionIds: (Array.isArray(input?.decisionIds) ? input.decisionIds : [])
        .map(String)
        .slice(0, 40),
      title: String(input?.title || "").trim(),
      recordingUrl: String(input?.recordingUrl || "").trim(),
      phaseId: input?.phaseId || null,
    });
  });
  return done();
}

/* ---------- submittals / RFIs (oversight) ---------- */

export async function addSubmittalAction(
  engId: string,
  input: { kind: "submittal" | "rfi"; ref: string; notes: string }
) {
  await requireUser();
  const sub: EngagementSubmittal = {
    id: uid("sb-"),
    kind: input?.kind === "rfi" ? "rfi" : "submittal",
    ref: String(input?.ref || "").trim(),
    received: Date.now(),
    respondedAt: null,
    status: "open",
    notes: String(input?.notes || "").trim(),
  };
  await patchEngagement(engId, (d) => {
    d.submittals.unshift(sub);
  });
  return done();
}

export async function setSubmittalStatusAction(
  engId: string,
  subId: string,
  status: "open" | "answered" | "closed"
) {
  await requireUser();
  await patchEngagement(engId, (d) => {
    const sub = d.submittals.find((s) => s.id === subId);
    if (!sub) return;
    sub.status = status;
    sub.respondedAt = status === "open" ? null : sub.respondedAt || Date.now();
  });
  return done();
}

/* ---------- documents (engagement-level and per-phase) ---------- */

const MAX_DOC_BYTES = 2 * 1024 * 1024; // data-URL docs live inside the record

export async function addDocumentAction(
  engId: string,
  input: { name: string; mime: string; size: number; dataUrl: string },
  phaseId?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const name = String(input?.name || "").trim();
  const dataUrl = String(input?.dataUrl || "");
  if (!name || !dataUrl.startsWith("data:"))
    return { ok: false, error: "Nothing to attach." };
  if (dataUrl.length > MAX_DOC_BYTES * 1.4)
    return { ok: false, error: "File is too large (2 MB max)." };
  const doc: EngagementDoc = {
    id: uid("ed-"),
    name,
    mime: String(input?.mime || "application/octet-stream"),
    size: Math.max(0, Math.round(Number(input?.size) || 0)),
    dataUrl,
    addedBy: user.name,
    addedAt: Date.now(),
  };
  await addPhaseDocTo(engId, phaseId || null, doc);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeDocumentAction(
  engId: string,
  docId: string,
  phaseId?: string | null
) {
  await requireUser();
  await patchEngagement(engId, (d) => {
    if (phaseId) {
      const ph = d.phases.find((p) => p.id === phaseId);
      if (ph) ph.attachments = ph.attachments.filter((a) => a.id !== docId);
    } else {
      d.documents = d.documents.filter((a) => a.id !== docId);
    }
  });
  return done();
}

/* ---------- site visits (oversight) ---------- */

export async function linkVisitAction(
  visitId: string,
  engId: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  if (engId) {
    const eng = await getEngagement(engId);
    if (!eng) return { ok: false, error: "Engagement not found." };
  }
  await linkVisitToEngagement(visitId, engId);
  revalidatePath("/", "layout");
  return { ok: true };
}
