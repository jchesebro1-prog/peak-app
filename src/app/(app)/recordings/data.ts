import { cache } from "react";
import { activeUsers } from "@/lib/users";
import { allVisits, getVisit } from "@/lib/stores/site-visits";
import { get as getSurvey } from "@/lib/stores/surveys";
import { get as getInspection } from "@/lib/stores/inspections";
import {
  allRecordings,
  getRecording,
  recordingParentLabel,
  recordingStatusChip,
  type RecordingParentKind,
  type RecordingRecord,
  type RecordingStatusChip,
} from "@/lib/stores/recordings";
import { routePrefill } from "@/lib/krisp/derive";
import { summarySectionsWithKeys } from "@/lib/krisp/write-back";
import { loadRecordGate, recordControlVisibility } from "@/components/recordings/record-control";
import type { RecordingStripItem } from "@/components/recordings/recordings-strip";
import type { FromRecordingPanelData, PrefillRouteView } from "@/components/recordings/from-recording-panel";

/**
 * Server loaders for the Recordings UI (spec §6) — the detail page at
 * /recordings/[id] and the list-surface helpers the parent screens use so
 * each page does ONE allRecordings() pass rather than one per row.
 */

/** Where a recording's parent lives in the app (nav-data.ts routes). */
export function parentHref(
  kind: RecordingParentKind,
  parentId: string,
  ctx: { customerId?: string | null; surveyId?: string | null } = {}
): string {
  const id = encodeURIComponent(parentId);
  switch (kind) {
    case "survey":
      return `/venue-assessments/${id}`;
    case "inspection":
      return `/inspections/${id}`;
    case "flame_job":
      return `/flame-tests/results?job=${id}`;
    case "repair_job":
      return `/repairs/results?job=${id}`;
    case "project":
      return `/projects/${id}`;
    case "engagement":
      return `/design/engagements/${id}`;
    case "site_visit":
      // Visits have no page of their own: the linked survey editor when one
      // exists, else the customer record (its Site visits card), else the
      // Venue Assessments queue.
      if (ctx.surveyId) return `/venue-assessments/${encodeURIComponent(ctx.surveyId)}`;
      if (ctx.customerId) return `/companies/${encodeURIComponent(ctx.customerId)}`;
      return "/venue-assessments";
  }
}

/** The Survey / Inspection a recording's summary can prefill into (spec §4.4). */
export type PrefillTarget = { kind: "survey" | "inspection"; id: string; href: string };

export type RecordingDetail = {
  rec: RecordingRecord;
  chip: RecordingStatusChip;
  parentHref: string;
  parentLabel: string;
  users: { id: string; name: string }[];
  krispConnected: boolean;
  canRecord: boolean;
  viewerId: string | null;
  prefillTarget: PrefillTarget | null;
  /** server clock at load — the client never reads Date.now() during render. */
  now: number;
};

async function resolvePrefillTarget(rec: RecordingRecord): Promise<PrefillTarget | null> {
  if (rec.parentKind === "inspection") {
    const ins = await getInspection(rec.parentId);
    return ins ? { kind: "inspection", id: ins.id, href: parentHref("inspection", ins.id) } : null;
  }
  let surveyId: string | null = null;
  if (rec.parentKind === "survey") surveyId = rec.parentId;
  else if (rec.parentKind === "site_visit") surveyId = (await getVisit(rec.parentId))?.surveyId ?? null;
  if (!surveyId) return null;
  const s = await getSurvey(surveyId);
  return s ? { kind: "survey", id: s.id, href: parentHref("survey", s.id) } : null;
}

export async function loadRecordingDetail(id: string): Promise<RecordingDetail | null> {
  const rec = await getRecording(id);
  if (!rec) return null;
  const [users, gate, prefillTarget, visit] = await Promise.all([
    activeUsers(),
    loadRecordGate(),
    resolvePrefillTarget(rec),
    rec.parentKind === "site_visit" ? getVisit(rec.parentId) : Promise.resolve(null),
  ]);
  const now = Date.now();
  return {
    rec,
    chip: recordingStatusChip(rec, now),
    parentHref: parentHref(rec.parentKind, rec.parentId, {
      customerId: rec.customerId ?? visit?.customerId ?? null,
      surveyId: visit?.surveyId ?? null,
    }),
    parentLabel: recordingParentLabel(rec.parentKind),
    users: users.map((u) => ({ id: u.id, name: u.name })),
    krispConnected: gate.krispConnected,
    canRecord: gate.canRecord,
    viewerId: gate.userId,
    prefillTarget,
    now,
  };
}

/** One pass over the collection per request (several list surfaces call it). */
const allRecordingsCached = cache(allRecordings);

/**
 * Recording count per parent id for a list surface — ONE allRecordings()
 * pass, whatever the row count. Ids absent from the map have zero.
 */
export async function recordingCountByParent(
  kind: RecordingParentKind,
  ids: readonly string[]
): Promise<Map<string, number>> {
  const want = new Set(ids);
  const out = new Map<string, number>();
  if (!want.size) return out;
  for (const r of await allRecordingsCached()) {
    if (r.parentKind !== kind || !want.has(r.parentId)) continue;
    out.set(r.parentId, (out.get(r.parentId) ?? 0) + 1);
  }
  return out;
}

/**
 * Which of `ids` should show a <RecordControl> for the current viewer
 * (spec §6 rule, batched): the beta gate + Krisp connection are read once;
 * without a connection only parents that already have recordings qualify.
 * Meant for client-rendered lists (Home agenda visit rows) that can't host
 * the server component per row — the page passes the resulting ids down.
 */
export async function recordableParentIds(
  kind: RecordingParentKind,
  ids: readonly string[]
): Promise<string[]> {
  const gate = await loadRecordGate();
  if (!gate.canRecord) return [];
  if (gate.krispConnected) return [...ids];
  const counts = await recordingCountByParent(kind, ids);
  return ids.filter((id) =>
    recordControlVisibility({ ...gate, hasRecordings: (counts.get(id) ?? 0) > 0 })
  );
}

/* ---------- capture-editor header strip + "From recording" panels (spec §4.4, §6) ---------- */

/** Serializable projection of a recording for <RecordingsStrip> (client). */
export function toStripItems(rows: readonly RecordingRecord[], now: number = Date.now()): RecordingStripItem[] {
  return rows.map((r) => ({
    id: r.id,
    chip: recordingStatusChip(r, now),
    durationS: r.durationS,
    recordedByName: r.recordedByName,
    startedAt: r.startedAt,
    title: r.title,
  }));
}

/**
 * A survey's recordings: those recorded from the survey editor itself PLUS
 * those recorded on a site visit linked to it (`visit.surveyId`) — the
 * visit has no page of its own, so the survey editor is where they surface
 * (spec §4.4 "parentKind = site_visit with surveyId"). Newest first.
 */
export async function recordingsForSurveyIncludingVisits(surveyId: string): Promise<RecordingRecord[]> {
  const [recs, visits] = await Promise.all([allRecordingsCached(), allVisits()]);
  const visitIds = new Set(visits.filter((v) => v.surveyId === surveyId).map((v) => v.id));
  return recs.filter(
    (r) =>
      (r.parentKind === "survey" && r.parentId === surveyId) ||
      (r.parentKind === "site_visit" && visitIds.has(r.parentId))
  );
}

export type RecordingsStripData = { recordings: RecordingStripItem[]; canRecord: boolean };

/**
 * Props for one editor's <RecordingsStrip>: the recordings on the parent
 * (for a survey, visit-linked ones too) and the spec §6 Record-control
 * visibility for the viewer. The strip is client-rendered in most editor
 * headers, so this is the server half — same seam as Home's `recordVisitIds`.
 */
export async function loadRecordingsStrip(kind: RecordingParentKind, parentId: string): Promise<RecordingsStripData> {
  const [rows, gate] = await Promise.all([
    kind === "survey" ? recordingsForSurveyIncludingVisits(parentId) : recordingsForParent(kind, parentId),
    loadRecordGate(),
  ]);
  return {
    recordings: toStripItems(rows),
    canRecord: recordControlVisibility({ ...gate, hasRecordings: rows.length > 0 }),
  };
}

async function recordingsForParent(kind: RecordingParentKind, parentId: string): Promise<RecordingRecord[]> {
  return (await allRecordingsCached()).filter((r) => r.parentKind === kind && r.parentId === parentId);
}

/**
 * Strip props for MANY parents at once (Field Work's day list): ONE
 * allRecordings() pass + one gate read, whatever the row count. Every id
 * gets an entry (possibly empty + not recordable).
 */
export async function loadRecordingsStrips(
  kind: RecordingParentKind,
  ids: readonly string[]
): Promise<Map<string, RecordingsStripData>> {
  const out = new Map<string, RecordingsStripData>();
  if (!ids.length) return out;
  const [recs, gate] = await Promise.all([allRecordingsCached(), loadRecordGate()]);
  const want = new Set(ids);
  const byParent = new Map<string, RecordingRecord[]>();
  for (const r of recs) {
    if (r.parentKind !== kind || !want.has(r.parentId)) continue;
    const list = byParent.get(r.parentId);
    if (list) list.push(r);
    else byParent.set(r.parentId, [r]);
  }
  const now = Date.now();
  for (const id of ids) {
    const rows = byParent.get(id) ?? [];
    out.set(id, {
      recordings: toStripItems(rows, now),
      canRecord: recordControlVisibility({ ...gate, hasRecordings: rows.length > 0 }),
    });
  }
  return out;
}

/** The client-safe view of a routed target (derive.ts SurveyPrefillTarget / InspectionPrefillTarget). */
function routeView(
  t: { kind: "map"; field: string; key: string } | { kind: "text"; field: string } | { kind: "skip" }
): PrefillRouteView {
  if (t.kind === "skip") return { kind: "skip", field: "" };
  if (t.kind === "map") return { kind: "map", field: t.field, mapKey: t.key };
  return { kind: "text", field: t.field };
}

/** One recording → its "From recording" panel data; null when nothing is insertable. */
export function prefillPanelData(rec: RecordingRecord, target: "survey" | "inspection"): FromRecordingPanelData | null {
  if (rec.krisp.status !== "ready") return null;
  const inserted = new Set(rec.prefill.insertedKeys);
  const sections = summarySectionsWithKeys(rec)
    .map(({ key, section }) => ({
      key,
      title: section.title,
      description: section.description,
      route: routeView(routePrefill(section.title)[target]),
      inserted: inserted.has(key),
    }))
    .filter((s) => s.route.kind !== "skip");
  if (!sections.length) return null;
  return { recordingId: rec.id, title: rec.title, sections };
}

/**
 * "From recording" panels for a Survey or Inspection editor (spec §4.4):
 * one per READY recording on the record — for a survey, visit-linked
 * recordings included — with every non-skipped summary section routed to
 * its field and flagged when already inserted. Newest recording first.
 */
export async function loadPrefillPanels(target: "survey" | "inspection", id: string): Promise<FromRecordingPanelData[]> {
  const rows = target === "survey" ? await recordingsForSurveyIncludingVisits(id) : await recordingsForParent("inspection", id);
  return rows.map((r) => prefillPanelData(r, target)).filter((p): p is FromRecordingPanelData => p !== null);
}
