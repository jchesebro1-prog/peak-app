"use server";

import { requireUser } from "@/lib/session";
import { canRecord, getSettings } from "@/lib/settings";
import { blobEnabled } from "@/lib/blob";
import { can } from "@/lib/team";
import {
  RECORDING_PARENT_KINDS,
  createRecording,
  getRecording,
  markUploadError,
  markUploaded,
  recordingParentLabel,
  type RecordingParentKind,
} from "@/lib/stores/recordings";
import { buildRecordingTitle } from "@/lib/recorder/helpers";
import { getVisit } from "@/lib/stores/site-visits";
import * as surveys from "@/lib/stores/surveys";
import * as inspections from "@/lib/stores/inspections";
import * as flameJobs from "@/lib/stores/flame-jobs";
import * as repairJobs from "@/lib/stores/repair-jobs";
import { getProject } from "@/lib/stores/projects";
import { getEngagement } from "@/lib/stores/engagements";

/**
 * Capture-side server actions (Recordings spec §2.2) — the device talks to
 * these from the recorder page and the upload queue. Write-back actions
 * (check / retry / accept action item / post feed note) live in ./actions.ts.
 *
 * Every action re-checks the session; `createRecordingAction` also enforces
 * the beta gate (`canRecord`) so a deep link to /recordings/new cannot
 * bypass the Record button's visibility rule.
 */

export type CaptureActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

type ParentDenorm = {
  customerId: string | null;
  customer: string;
  locationId: string | null;
  venue: string;
};

function isParentKind(v: string): v is RecordingParentKind {
  return (RECORDING_PARENT_KINDS as string[]).includes(v);
}

/** Load the parent record and lift the four denormalised fields off it. */
async function resolveParent(kind: RecordingParentKind, id: string): Promise<ParentDenorm | null> {
  switch (kind) {
    case "site_visit": {
      const v = await getVisit(id);
      return v ? { customerId: v.customerId, customer: v.customer, locationId: v.locationId, venue: v.venue } : null;
    }
    case "survey": {
      const s = await surveys.get(id);
      return s ? { customerId: s.customerId, customer: s.customer, locationId: s.locationId, venue: s.venue } : null;
    }
    case "inspection": {
      const r = await inspections.get(id);
      return r ? { customerId: r.customerId, customer: r.customer, locationId: r.locationId, venue: r.venue } : null;
    }
    case "flame_job": {
      const j = await flameJobs.get(id);
      return j ? { customerId: j.customerId, customer: j.customer, locationId: j.locationId, venue: j.venue } : null;
    }
    case "repair_job": {
      const j = await repairJobs.get(id);
      return j ? { customerId: j.customerId, customer: j.customer, locationId: j.locationId, venue: j.venue } : null;
    }
    case "project": {
      const p = await getProject(id);
      // Projects carry no venue label — the title falls back to the customer.
      return p ? { customerId: p.customerId, customer: p.customer, locationId: p.locationId, venue: "" } : null;
    }
    case "engagement": {
      const e = await getEngagement(id);
      return e
        ? { customerId: e.companyId, customer: e.customer, locationId: e.siteIds[0] ?? null, venue: "" }
        : null;
    }
  }
}

export type CaptureContext = {
  parentKind: RecordingParentKind;
  parentId: string;
  label: string;
  venue: string;
  customer: string;
  customerId: string | null;
  locationId: string | null;
  canRecord: boolean;
  blobEnabled: boolean;
  user: { id: string; name: string };
};

/**
 * Everything the recorder page needs to render (spec §2.2): the parent's
 * label + venue, the beta gate, and whether this server can take the
 * upload. Also what the client uses to build an offline-minted doc.
 */
export async function recordingCaptureContext(
  parentKind: string,
  parentId: string
): Promise<CaptureActionResult<{ ctx: CaptureContext }>> {
  const user = await requireUser();
  if (!isParentKind(parentKind)) return { ok: false, error: "Unknown record type." };
  if (!parentId) return { ok: false, error: "Missing record id." };
  const parent = await resolveParent(parentKind, parentId);
  if (!parent) return { ok: false, error: `${parentId} was not found.` };
  const settings = await getSettings();
  return {
    ok: true,
    ctx: {
      parentKind,
      parentId,
      label: recordingParentLabel(parentKind),
      venue: parent.venue,
      customer: parent.customer,
      customerId: parent.customerId,
      locationId: parent.locationId,
      canRecord: canRecord(user.id, settings),
      blobEnabled: blobEnabled(),
      user: { id: user.id, name: user.name },
    },
  };
}

export type CreateRecordingMeta = {
  startedAt: number;
  endedAt: number;
  durationS: number;
  mime: string;
  sizeBytes: number;
  remember?: string;
};

/** Spec §2.2 step 1 — resolve parent, denormalise, mint `REC-####`. */
export async function createRecordingAction(
  parentKind: string,
  parentId: string,
  meta: CreateRecordingMeta
): Promise<CaptureActionResult<{ id: string; title: string }>> {
  const user = await requireUser();
  if (!isParentKind(parentKind)) return { ok: false, error: "Unknown record type." };
  const settings = await getSettings();
  if (!canRecord(user.id, settings)) return { ok: false, error: "Recording is not enabled for your account." };
  const parent = await resolveParent(parentKind, parentId);
  if (!parent) return { ok: false, error: `${parentId} was not found.` };

  const startedAt = Number(meta.startedAt) || Date.now();
  const endedAt = Math.max(startedAt, Number(meta.endedAt) || startedAt);
  const title = buildRecordingTitle({
    parentId,
    venue: parent.venue,
    customer: parent.customer,
    parentLabel: recordingParentLabel(parentKind),
    remember: meta.remember ?? null,
    at: startedAt,
  });
  const rec = await createRecording({
    parentKind,
    parentId,
    customerId: parent.customerId,
    customer: parent.customer,
    locationId: parent.locationId,
    venue: parent.venue,
    title,
    recordedByUserId: user.id,
    recordedByName: user.name,
    startedAt,
    endedAt,
    durationS: Math.max(0, Math.round(Number(meta.durationS) || 0)),
    mime: String(meta.mime || "audio/mp4").slice(0, 80),
    sizeBytes: Math.max(0, Math.round(Number(meta.sizeBytes) || 0)),
  });
  return { ok: true, id: rec.id, title: rec.title };
}

/** The recorder (or an admin) may touch a recording's upload state. */
async function ownedRecording(id: string) {
  const user = await requireUser();
  const rec = await getRecording(id);
  if (!rec) return { rec: null, error: "Recording not found." };
  if (rec.recordedByUserId !== user.id && !can("manage_users", user.roles)) {
    return { rec: null, error: "Not your recording." };
  }
  return { rec, error: null };
}

/**
 * Spec §2.3 step 3, the client half: after `upload()` resolves the device
 * stamps `uploaded` itself because Vercel's `onUploadCompleted` webhook cannot
 * reach a dev machine. Idempotent with the webhook (markUploaded no-ops once
 * archived; a second `uploaded` write is harmless).
 */
export async function markUploadedAction(
  id: string,
  pathname: string,
  sizeBytes: number
): Promise<CaptureActionResult> {
  const { rec, error } = await ownedRecording(id);
  if (!rec) return { ok: false, error: error ?? "Recording not found." };
  if (!pathname.startsWith(`recordings/${id}/`)) return { ok: false, error: "Pathname does not belong to this recording." };
  if (rec.audio.state !== "on_device") return { ok: true }; // already uploaded/archived — no-op
  await markUploaded(id, pathname, Math.max(0, Math.round(Number(sizeBytes) || 0)));
  return { ok: true };
}

/** Surface why the file is still on the device (the record shows "On device" + reason). */
export async function markUploadErrorAction(id: string, message: string): Promise<CaptureActionResult> {
  const { rec, error } = await ownedRecording(id);
  if (!rec) return { ok: false, error: error ?? "Recording not found." };
  if (rec.audio.state !== "on_device") return { ok: true };
  await markUploadError(id, String(message || "Upload failed").slice(0, 300));
  return { ok: true };
}
