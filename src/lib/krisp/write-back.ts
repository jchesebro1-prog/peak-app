import { createAssignment, type AssignmentLink } from "@/lib/stores/assignments";
import * as inspections from "@/lib/stores/inspections";
import { addNoteRecord } from "@/lib/stores/notes";
import {
  addPrefillInserted,
  getRecording,
  recordingParentLabel,
  setActionItemDisposition,
  setFeedNoteId,
  type RecordingRecord,
  type RecordingSummarySection,
} from "@/lib/stores/recordings";
import { getVisit } from "@/lib/stores/site-visits";
import * as surveys from "@/lib/stores/surveys";
import { activeUsers, getUser } from "@/lib/users";
import {
  matchAssignee,
  normalizeActionTitle,
  prefillInsertText,
  routePrefill,
  summarySectionKey,
  type InspectionPrefillTarget,
  type SurveyPrefillTarget,
} from "./derive";

/**
 * Write-back (Recordings spec §4) — what the app does with a ready Krisp
 * meeting. Everything here is rules-based (D89) and gated by an idempotency
 * key on the recording (`feedNoteId`, `actionItems[].assignmentId`,
 * `prefill.insertedKeys` — spec §7), so `onRecordingReady` and every action
 * below can be rerun without a duplicate note, assignment or insert.
 *
 * Only the customer feed note is automatic. Action items wait for a tap on
 * Accept (§4.2 — nothing reaches the Home Queue without confirmation) and
 * summary sections wait for Insert (§4.4 — no silent writes into a Survey or
 * Inspection).
 */

/* ---------- §4.3 customer feed note ---------- */

function ymdLocal(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The note body (spec §4.3): header line `Recorded <parent label> · REC-#### ·
 * <venue> · <date>`, one `Title: description` per summary section, then the
 * deep link `→ /recordings/REC-####`. Pure — spec-tested.
 */
export function feedNoteText(
  rec: Pick<RecordingRecord, "id" | "parentKind" | "venue" | "startedAt" | "summary">
): string {
  const header = ["Recorded " + recordingParentLabel(rec.parentKind), rec.id, rec.venue.trim(), ymdLocal(rec.startedAt)]
    .filter(Boolean)
    .join(" · ");
  const sections = rec.summary
    .filter((s) => s.title.trim() || s.description.trim())
    .map((s) => {
      const title = s.title.trim();
      const desc = s.description.trim();
      return desc ? `${title}: ${desc}` : title;
    });
  const parts = [header];
  if (sections.length) parts.push("", ...sections);
  parts.push("", `→ /recordings/${rec.id}`);
  return parts.join("\n");
}

export type PostFeedNoteResult = { noteId: string | null; created: boolean };

/**
 * Post the summary to the customer's activity feed once. No customer (a
 * lead-borne visit) → skipped; already posted → the existing id. Exported on
 * its own because the detail page's "Post to customer feed" button re-runs
 * it after the visit gains a customer (#34 flow).
 */
export async function postFeedNote(rec: RecordingRecord): Promise<PostFeedNoteResult> {
  if (rec.feedNoteId) return { noteId: rec.feedNoteId, created: false };
  if (!rec.customerId) return { noteId: null, created: false };
  const note = await addNoteRecord(
    {
      parentKind: "customer",
      parentId: rec.customerId,
      customerId: rec.customerId,
      text: feedNoteText(rec),
    },
    rec.recordedByName || "Krisp"
  );
  await setFeedNoteId(rec.id, note.id);
  return { noteId: note.id, created: true };
}

/**
 * Idempotent write-back after Krisp reports `ready` (spec §4). v1 posts the
 * feed note and nothing else — action items and prefill are tap-gated.
 */
export async function onRecordingReady(rec: RecordingRecord): Promise<{ feedNoteId: string | null }> {
  const fresh = (await getRecording(rec.id)) ?? rec;
  const note = await postFeedNote(fresh);
  return { feedNoteId: note.noteId };
}

/* ---------- §4.2 action items → Home Queue (confirm first) ---------- */

export type AcceptActionItemResult = { assignmentId: string; created: boolean };

function parseDue(iso: string | null): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Accept one Krisp action item into the Home Queue. Assignee: the picked
 * user, else `matchAssignee` over Krisp's name, else the recorder. Link: the
 * customer as `company` when known (AssignmentLink kinds are NOT extended in
 * v1). Rerunning on an accepted item returns the existing assignment.
 */
export async function acceptActionItem(
  rec: RecordingRecord,
  key: string,
  assigneeUserId: string | null,
  dueAt: number | null,
  byName: string
): Promise<AcceptActionItemResult> {
  const item = rec.actionItems.find((a) => a.key === key);
  if (!item) throw new Error("That action item is no longer on the recording.");
  if (item.disposition === "accepted" && item.assignmentId) {
    return { assignmentId: item.assignmentId, created: false };
  }

  let assignee: string | null = null;
  if (assigneeUserId) {
    const u = await getUser(assigneeUserId);
    if (!u) throw new Error("That team member was not found.");
    assignee = u.name;
  } else {
    const users = await activeUsers();
    assignee = matchAssignee(item.assigneeName, users)?.name ?? null;
  }
  assignee = assignee || rec.recordedByName || byName;

  const link: AssignmentLink = rec.customerId
    ? { kind: "company", id: rec.customerId, label: rec.customer || rec.customerId }
    : null;

  const created = await createAssignment({
    title: item.title,
    assignee,
    createdBy: byName,
    dueDate: dueAt ?? parseDue(item.dueDate),
    link,
    source: `Krisp ${rec.id} · ${rec.title}`,
  });
  await setActionItemDisposition(rec.id, key, "accepted", created.id);
  return { assignmentId: created.id, created: true };
}

/** Dismiss a pending item. Already dismissed → no-op; accepted → refused (the assignment exists). */
export async function dismissActionItem(rec: RecordingRecord, key: string): Promise<void> {
  const item = rec.actionItems.find((a) => a.key === key);
  if (!item) throw new Error("That action item is no longer on the recording.");
  if (item.disposition === "dismissed") return;
  if (item.disposition === "accepted") {
    throw new Error("This item is already in the Home Queue — complete or remove it there.");
  }
  await setActionItemDisposition(rec.id, key, "dismissed", null);
}

/* ---------- §4.4 prefill into Survey / Inspection (insert on tap) ---------- */

export type PrefillTarget = SurveyPrefillTarget | InspectionPrefillTarget;

/**
 * Summary sections with their stable keys — the same "ordinal among
 * same-normalized-titles" rule as action items, so the key of a section
 * survives a re-derive that reorders nothing.
 */
export function summarySectionsWithKeys(
  rec: Pick<RecordingRecord, "summary">
): { key: string; section: RecordingSummarySection }[] {
  const seen = new Map<string, number>();
  return rec.summary.map((section) => {
    const norm = normalizeActionTitle(section.title);
    const ordinal = seen.get(norm) ?? 0;
    seen.set(norm, ordinal + 1);
    return { key: summarySectionKey(section.title, ordinal), section };
  });
}

/**
 * The field patch one Insert produces (spec §4.4) — pure, spec-tested.
 * `map` targets append to `record.<field>[key]` (created if absent, "\n"
 * joined when it already has text); `text` targets append
 * `prefillInsertText` to `record.<field>` (no leading blank lines when the
 * field was empty). `skip` → null. Never mutates `record`.
 */
export function applyPrefillToRecord(
  record: Record<string, unknown>,
  target: PrefillTarget,
  title: string,
  description: string,
  recId: string
): Record<string, unknown> | null {
  if (target.kind === "skip") return null;
  const desc = description.trim();
  if (target.kind === "map") {
    const existingRaw = record[target.field];
    const existing =
      existingRaw && typeof existingRaw === "object" && !Array.isArray(existingRaw)
        ? (existingRaw as Record<string, string>)
        : {};
    const cur = typeof existing[target.key] === "string" ? existing[target.key].trim() : "";
    return { [target.field]: { ...existing, [target.key]: cur ? `${cur}\n${desc}` : desc } };
  }
  const curRaw = record[target.field];
  const cur = typeof curRaw === "string" ? curRaw : "";
  const ins = prefillInsertText(recId, title.trim(), desc);
  return { [target.field]: cur ? cur + ins : ins.replace(/^\n+/, "") };
}

export type PrefillTargetRecord = { kind: "survey" | "inspection"; id: string };

/** Which record an Insert writes to (spec §4.4): survey / inspection directly, site visit via its linked survey. */
export async function resolvePrefillTarget(
  rec: Pick<RecordingRecord, "parentKind" | "parentId">
): Promise<PrefillTargetRecord> {
  if (rec.parentKind === "survey") return { kind: "survey", id: rec.parentId };
  if (rec.parentKind === "inspection") return { kind: "inspection", id: rec.parentId };
  if (rec.parentKind === "site_visit") {
    const visit = await getVisit(rec.parentId);
    if (!visit?.surveyId) throw new Error("No linked survey on this site visit yet.");
    return { kind: "survey", id: visit.surveyId };
  }
  throw new Error("Prefill applies to surveys and inspections only.");
}

export type InsertPrefillResult = {
  ok: true;
  target: PrefillTargetRecord;
  field: string | null;
  skipped?: "already-inserted";
};

/**
 * Insert one summary section into its routed field (spec §4.4). Idempotent:
 * a key already in `prefill.insertedKeys` is a no-op; a section the routing
 * table skips (next steps / actions) is refused with a reason.
 */
export async function insertPrefill(rec: RecordingRecord, sectionKey: string): Promise<InsertPrefillResult> {
  const target = await resolvePrefillTarget(rec);
  if (rec.prefill.insertedKeys.includes(sectionKey)) {
    return { ok: true, target, field: null, skipped: "already-inserted" };
  }
  const entry = summarySectionsWithKeys(rec).find((s) => s.key === sectionKey);
  if (!entry) throw new Error("That summary section is no longer on the recording.");
  const { title, description } = entry.section;
  const route = routePrefill(title);

  if (target.kind === "survey") {
    const t = route.survey;
    if (t.kind === "skip") throw new Error("Next steps and action items go to the Home Queue, not the survey.");
    const s = await surveys.get(target.id);
    if (!s) throw new Error(`Survey ${target.id} was not found.`);
    const patch = applyPrefillToRecord(s, t, title, description, rec.id);
    if (patch) await surveys.update(target.id, patch);
    await addPrefillInserted(rec.id, sectionKey);
    return { ok: true, target, field: t.field };
  }

  const t = route.inspection;
  if (t.kind === "skip") throw new Error("Next steps and action items go to the Home Queue, not the inspection.");
  const ins = await inspections.get(target.id);
  if (!ins) throw new Error(`Inspection ${target.id} was not found.`);
  const patch = applyPrefillToRecord(ins as unknown as Record<string, unknown>, t, title, description, rec.id);
  if (patch) await inspections.update(target.id, patch as Partial<inspections.InspectionRecord>);
  await addPrefillInserted(rec.id, sectionKey);
  return { ok: true, target, field: t.field };
}
