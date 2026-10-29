import { getDoc, upsertDoc } from "@/db/doc-store";
import { blobEnabled, dataUrlToBytes, putBlob } from "@/lib/blob";
import { contactByEmail } from "@/lib/identity/lookup";
import { can } from "@/lib/team";
import { create as createLead, getAll as allLeads, logActivity, update as updateLead } from "@/lib/stores/leads";
import { listShows } from "@/lib/stores/booth";
import { alreadyRecorded, dedupeDecision, leadMessage, sanitizeCapture, type BoothCapture } from "./capture";

/**
 * The one server path every booth capture takes: the public card page's
 * share-back, a Booth-mode save online, and a Booth-mode capture pushed from
 * the offline outbox. Idempotent by capture id — the lead stores every
 * capture id it holds (`boothCaptureIds`), so a retry after a crash at any
 * point finds the lead instead of minting a second one.
 */

type Actor = { id: string; name: string };
export type RecordResult =
  | { ok: true; leadId: string; outcome: "created" | "merged"; capture: BoothCapture }
  | { ok: false; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;

/** A usable capture time: finite, positive and not more than a day ahead — else now. */
function clampCapturedAt(at: unknown, now: number): number {
  return typeof at === "number" && Number.isFinite(at) && at > 0 && at <= now + DAY_MS ? at : now;
}

/** The decoded data URL really is a JPEG (FF D8 FF) — a client claim of image/jpeg proves nothing. */
function isJpegDataUrl(dataUrl: string): boolean {
  try {
    const { bytes } = dataUrlToBytes(dataUrl);
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  } catch {
    return false;
  }
}

async function storeCardImage(c: BoothCapture): Promise<BoothCapture> {
  if (!c.cardImage) return c;
  if (!isJpegDataUrl(c.cardImage)) {
    const rest = { ...c };
    delete rest.cardImage;
    delete rest.cardImagePath;
    return rest;
  }
  if (!blobEnabled()) {
    // Local dev without Blob keeps the (already small) data URL on the doc.
    return { ...c, cardImagePath: "inline" };
  }
  const { bytes } = dataUrlToBytes(c.cardImage);
  const { pathname } = await putBlob(`booth/${c.id}.jpg`, bytes, "image/jpeg");
  const rest = { ...c, cardImagePath: pathname };
  delete rest.cardImage;
  return rest;
}

export async function recordBoothCapture(raw: unknown, actor: Actor, opts: { ownerName?: string } = {}): Promise<RecordResult> {
  const s = sanitizeCapture(raw);
  if (!s.ok) return s;
  let capture = s.capture;

  const prior = await getDoc<BoothCapture & { id: string }>("booth_captures", capture.id);
  // Never let a later push swap an image already stored, and keep who first captured it.
  if (prior?.cardImagePath) {
    capture = { ...capture, cardImagePath: prior.cardImagePath };
    delete capture.cardImage;
  } else {
    capture = await storeCardImage(capture);
  }
  if (prior) capture = { ...capture, capturedById: prior.capturedById || capture.capturedById, capturedByName: prior.capturedByName || capture.capturedByName };
  if (!capture.capturedById) capture = { ...capture, capturedById: actor.id, capturedByName: actor.name };
  capture = { ...capture, capturedAt: clampCapturedAt(capture.capturedAt, Date.now()) };

  const shows = await listShows();
  const showName = shows.find((x) => x.id === capture.showId)?.name ?? null;
  const leads = await allLeads();
  const lite = leads.map((l) => ({ id: l.id, email: l.email, stage: l.stage, boothCaptureIds: l.boothCaptureIds }));

  let leadId = alreadyRecorded(capture.id, lite);
  let outcome: "created" | "merged" = prior?.outcome ?? "created";

  if (!leadId) {
    const d = dedupeDecision(capture, lite);
    if (d.kind === "merge") {
      outcome = "merged";
      leadId = d.leadId;
      const target = leads.find((l) => l.id === d.leadId)!;
      await updateLead(d.leadId, {
        boothCaptureIds: [...(target.boothCaptureIds || []), capture.id],
        interests: Array.from(new Set([...(target.interests || []), ...capture.interests])),
        ...(capture.temperature ? { temperature: capture.temperature } : {}),
        ...(!target.eventId && capture.showId ? { eventId: capture.showId } : {}),
      });
      const note = `Met again at ${showName || "a trade show"}` + (capture.notes ? `\n${capture.notes}` : "");
      await logActivity(d.leadId, { type: "note", by: actor.name, note }, actor.name);
    } else {
      outcome = "created";
      const hit = capture.email ? await contactByEmail(capture.email) : null;
      const customerId = hit && "customerId" in hit ? hit.customerId : null;
      const lead = await createLead(
        {
          org: capture.company,
          contact: [capture.firstName, capture.lastName].filter(Boolean).join(" "),
          contactRole: capture.title,
          email: capture.email,
          phone: capture.phone,
          source: "event",
          owner: opts.ownerName ?? capture.capturedByName ?? actor.name,
          interest: capture.interests.join(", "),
          message: leadMessage(capture, showName),
          customerId,
        },
        actor.name
      );
      await updateLead(lead.id, {
        eventId: capture.showId ?? undefined,
        interests: capture.interests,
        temperature: capture.temperature,
        boothCaptureIds: [capture.id],
      });
      leadId = lead.id;
    }
  }

  // An inline image (dev without Blob) rides on the stored doc; a prior inline image survives a later push.
  const stored: BoothCapture & { id: string } = { ...capture, leadId, outcome, rev: (prior?.rev ?? 0) + 1 };
  if (stored.cardImagePath === "inline" && !stored.cardImage && prior?.cardImage) stored.cardImage = prior.cardImage;
  await upsertDoc("booth_captures", stored);
  return { ok: true, leadId, outcome, capture: stored };
}

/** /api/sync/push branch for booth_captures. A throw replies `retry` (the device tries again). */
export async function pushBoothCapture(
  rec: { id: string; rev?: number; doc: Record<string, unknown> },
  user: { id: string; name: string; roles: string[] | null | undefined }
): Promise<{ id: string; status: "ok" | "error" | "retry"; rev?: number; error?: string }> {
  if (!can("create", user.roles)) return { id: rec.id, status: "error", error: "You don't have permission to save booth captures" };
  try {
    const r = await recordBoothCapture({ ...rec.doc, id: rec.id }, { id: user.id, name: user.name });
    return r.ok ? { id: rec.id, status: "ok", rev: r.capture.rev } : { id: rec.id, status: "error", error: r.error };
  } catch (e) {
    console.error("[booth] push failed; the device will retry", rec.id, e);
    return { id: rec.id, status: "retry", error: "The server couldn't save it just now; it will try again" };
  }
}
