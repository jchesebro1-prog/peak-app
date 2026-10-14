"use server";

import { revalidatePath } from "next/cache";
import { getOptionalUser, requirePerm } from "@/lib/session";
import { can } from "@/lib/team";
import { clearSyncRejects, completeAssessment, getAssessment, reopenAssessment, saveAssessment, type Assessment } from "@/lib/stores/assessments";
import { getFinding, listFindings, mergeFindings, saveFinding, splitFinding, transitionFinding, voidFinding } from "@/lib/stores/findings";
import { getCompany, setCompanyShortCode } from "@/lib/identity/companies";
import { getSite, setSiteShortCode } from "@/lib/identity/sites";
import { codeInUse, type Finding, type FindingStatus } from "@/lib/assessments/findings-model";
import { toFindingVM, type FindingVM, type SavePatch, type SyncRejectVM } from "@/lib/assessments/editor-model";

/**
 * The editor's server actions (#337, Task 7). Saves never throw on a refusal and never redirect: the editor saves
 * through `saveThroughOutbox`, which counts a resolved promise as synced unless it is `{ ok: false, error }` (the
 * `ServerSaveResult` shape), and a redirect mid-visit would drop the answers still on screen. A missing session or
 * permission therefore comes back as `{ ok: false }` too. Every success carries the stored `rev` for the editor to
 * adopt (the rev contract).
 */

export type SaveReply = { ok: true; rev: number; dropped?: string[] } | { ok: false; error: string };
export type RejectsReply = { ok: true; rev: number; syncRejects: SyncRejectVM[] } | { ok: false; error: string };
export type CompleteReply = { ok: true } | { ok: false; gaps: string[]; uploading: number; error?: string };

async function editor(): Promise<{ id: string } | { error: string }> {
  const user = await getOptionalUser();
  if (!user) return { error: "Sign in again to save. Your answers are still on this screen." };
  if (!can("create", user.roles)) return { error: "You don't have permission to edit assessments." };
  return { id: user.id };
}

export async function saveAssessmentAction(id: string, patch: SavePatch): Promise<SaveReply> {
  const u = await editor();
  if ("error" in u) return { ok: false, error: u.error };
  if (!patch || typeof patch !== "object") return { ok: false, error: "Nothing to save" };
  const incoming: Partial<Assessment> = {};
  if (typeof patch.rev === "number") incoming.rev = patch.rev;
  if (patch.answers !== undefined) incoming.answers = patch.answers;
  if (patch.scopes !== undefined) incoming.scopes = patch.scopes;
  if (patch.spaceLabel !== undefined) incoming.spaceLabel = patch.spaceLabel;
  if (patch.accompanying !== undefined) incoming.accompanying = patch.accompanying;
  if (patch.visitDate !== undefined) incoming.visitDate = patch.visitDate;
  if (patch.photoSetOffered !== undefined) incoming.photoSetOffered = patch.photoSetOffered;
  if (patch.photos !== undefined) incoming.photos = patch.photos;
  if (patch.dismissedPrompts !== undefined) incoming.dismissedPrompts = patch.dismissedPrompts;
  let r: Awaited<ReturnType<typeof saveAssessment>>;
  try {
    r = await saveAssessment(id, incoming, u, { mode: "action" });
  } catch {
    return { ok: false, error: "The assessment couldn't be saved. Try again." };
  }
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`/assessments/${id}`);
  return r.dropped?.length ? { ok: true, rev: r.doc.rev, dropped: r.dropped } : { ok: true, rev: r.doc.rev };
}

/** The editor has shown or re-entered these sync rejects: remove them. */
export async function clearSyncRejectsAction(id: string, keys: string[]): Promise<RejectsReply> {
  const u = await editor();
  if ("error" in u) return { ok: false, error: u.error };
  const r = await clearSyncRejects(id, Array.isArray(keys) ? keys.filter((k) => typeof k === "string").slice(0, 100) : [], u);
  if (!r.ok) return { ok: false, error: r.error };
  revalidatePath(`/assessments/${id}`);
  return { ok: true, rev: r.doc.rev, syncRejects: r.doc.syncRejects ?? [] };
}

/** Mark complete. Gaps refuse unless `override`; photos still uploading always refuse. */
export async function completeAssessmentAction(id: string, override: boolean): Promise<CompleteReply> {
  const u = await editor();
  if ("error" in u) return { ok: false, gaps: [], uploading: 0, error: u.error };
  const r = await completeAssessment(id, u, override === true);
  if (r.ok) {
    revalidatePath(`/assessments/${id}`);
    revalidatePath("/assessments");
  }
  return r;
}

/* ---------- Task 8: findings and short codes ---------- */

/** A finding action's reply: the stored finding (as the editor holds it) and its rev to adopt. */
export type FindingReply = { ok: true; doc: FindingVM; rev: number } | { ok: false; error: string };
export type MergeReply = { ok: true; kept: FindingVM; voided: FindingVM[] } | { ok: false; error: string };
export type SplitReply = { ok: true; kept: FindingVM; created: FindingVM } | { ok: false; error: string };
export type CodesReply = { ok: true; companyCode: string | null; siteCode: string | null } | { ok: false; error: string };

const CONFLICT = "This finding was changed on another device. Reload to see the latest copy, then make your change again.";
const revalidateFindings = (assessmentId: string | undefined) => {
  if (assessmentId) revalidatePath(`/assessments/${assessmentId}`);
};

/** Create or edit a finding (spec §3). `create`. The finding sheet saves through saveThroughOutbox, so a refusal is
 *  `{ ok: false, error }` (never a throw or a redirect). A new finding can't be added to a completed assessment. */
export async function saveFindingAction(doc: Record<string, unknown>): Promise<FindingReply> {
  const u = await editor();
  if ("error" in u) return { ok: false, error: u.error };
  if (!doc || typeof doc !== "object" || typeof doc.key !== "string") return { ok: false, error: "Nothing to save" };
  try {
    if (!(await getFinding(doc.key))) {
      const as = typeof doc.assessmentId === "string" ? await getAssessment(doc.assessmentId) : null;
      if (!as) return { ok: false, error: "Assessment not found" };
      if (as.status === "completed") return { ok: false, error: "This assessment is completed. Reopen it to add findings." };
    }
    const r = await saveFinding(doc as Partial<Finding> & { key: string }, u);
    if (!r.ok) return { ok: false, error: r.error === "conflict" ? CONFLICT : r.error };
    revalidateFindings(r.doc.assessmentId);
    return { ok: true, doc: toFindingVM(r.doc), rev: r.doc.rev ?? 1 };
  } catch {
    return { ok: false, error: "The finding couldn't be saved. Try again." };
  }
}

/** Move a finding along its status lifecycle (spec §3 Status). `create`; backward moves need a note. */
export async function transitionFindingAction(key: string, to: FindingStatus, note?: string, patch?: Partial<Finding>): Promise<FindingReply> {
  const u = await editor();
  if ("error" in u) return { ok: false, error: u.error };
  try {
    const r = await transitionFinding(key, to, u, { note, patch });
    if (!r.ok) return r;
    revalidateFindings(r.doc.assessmentId);
    return { ok: true, doc: toFindingVM(r.doc), rev: r.doc.rev ?? 1 };
  } catch {
    return { ok: false, error: "The status couldn't be changed. Try again." };
  }
}

/** Void a finding (its number is kept, never reused). Needs `approve`. */
export async function voidFindingAction(key: string, reason: string): Promise<FindingReply> {
  const user = await getOptionalUser();
  if (!user) return { ok: false, error: "Sign in again to void the finding." };
  if (!can("approve", user.roles)) return { ok: false, error: "Voiding a finding needs approval rights." };
  try {
    await voidFinding(key, reason, user);
  } catch (e) {
    return { ok: false, error: (e as Error)?.message || "The finding couldn't be voided." };
  }
  const f = await getFinding(key);
  if (!f) return { ok: false, error: "Finding not found" };
  revalidateFindings(f.assessmentId);
  return { ok: true, doc: toFindingVM(f), rev: f.rev ?? 1 };
}

/** Merge findings into the first one (the others are voided "Merged into <printedId>"). `create`; online only. */
export async function mergeFindingsAction(keys: string[]): Promise<MergeReply> {
  const u = await editor();
  if ("error" in u) return { ok: false, error: u.error };
  try {
    const r = await mergeFindings(Array.isArray(keys) ? keys.slice(0, 50) : [], u);
    if (!r.ok) return r;
    revalidateFindings(r.kept.assessmentId);
    return { ok: true, kept: toFindingVM(r.kept), voided: r.voided.map(toFindingVM) };
  } catch {
    return { ok: false, error: "The findings couldn't be merged. Try again." };
  }
}

/** Split the chosen photos and questions off into a new finding. `create`; online only. */
export async function splitFindingAction(key: string, move: { photoIds: string[]; questionKeys: string[] }, newKey: string): Promise<SplitReply> {
  const u = await editor();
  if ("error" in u) return { ok: false, error: u.error };
  try {
    const r = await splitFinding(key, move, newKey, u);
    if (!r.ok) return r;
    revalidateFindings(r.kept.assessmentId);
    return { ok: true, kept: toFindingVM(r.kept), created: toFindingVM(r.created) };
  } catch {
    return { ok: false, error: "The finding couldn't be split. Try again." };
  }
}

/**
 * Set the company and/or venue short code (printed finding ids). `create` while no live finding carries the code
 * being replaced; once one does (codeInUse over listFindings({ customerId })), changing it needs `approve`. Issued
 * printed ids keep their text either way.
 */
export async function setShortCodesAction(p: { companyId?: string; companyCode?: string; siteId?: string; siteCode?: string }): Promise<CodesReply> {
  const user = await getOptionalUser();
  if (!user) return { ok: false, error: "Sign in again to change codes." };
  if (!can("create", user.roles)) return { ok: false, error: "You don't have permission to change codes." };
  if (!p || typeof p !== "object") return { ok: false, error: "Nothing to change" };
  const approve = can("approve", user.roles);
  const company = typeof p.companyId === "string" ? await getCompany(p.companyId) : null;
  const site = typeof p.siteId === "string" ? await getSite(p.siteId) : null;
  if (p.companyId !== undefined && !company) return { ok: false, error: "Company not found" };
  if (p.siteId !== undefined && !site) return { ok: false, error: "Venue not found" };
  const customerId = company?.id ?? site?.companyId;
  const live = customerId ? await listFindings({ customerId }) : [];
  if (company && typeof p.companyCode === "string") {
    const next = p.companyCode.trim().toUpperCase();
    if (next !== (company.shortCode ?? "")) {
      if (codeInUse(live, company.shortCode, "company") && !approve) return { ok: false, error: `${company.shortCode} is already printed on findings. Changing it needs approval rights.` };
      const r = await setCompanyShortCode(company.id, next);
      if (!r.ok) return r;
    }
  }
  if (site && typeof p.siteCode === "string") {
    const next = p.siteCode.trim().toUpperCase();
    if (next !== (site.shortCode ?? "")) {
      if (codeInUse(live.filter((f) => f.siteId === site.id), site.shortCode, "site") && !approve) return { ok: false, error: `${site.shortCode} is already printed on findings. Changing it needs approval rights.` };
      const r = await setSiteShortCode(site.id, next);
      if (!r.ok) return r;
    }
  }
  revalidatePath("/assessments", "layout");
  return { ok: true, companyCode: company ? ((await getCompany(company.id))?.shortCode ?? null) : null, siteCode: site ? ((await getSite(site.id))?.shortCode ?? null) : null };
}

/** Completed → on site again. Needs `approve`. */
export async function reopenAssessmentAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePerm("approve");
  try {
    await reopenAssessment(id, user);
  } catch {
    return { ok: false, error: "Assessment not found" };
  }
  revalidatePath(`/assessments/${id}`);
  revalidatePath("/assessments");
  return { ok: true };
}
