import { casDocKey, getDoc, insertDocIfAbsent, upsertDoc } from "@/db/doc-store";
import { blobEnabled, dataUrlToBytes, putBlob } from "@/lib/blob";
import { contactByEmail } from "@/lib/identity/lookup";
import { can } from "@/lib/team";
import { addBoothCapture, create as createLead, get as getLead, getAll as allLeads } from "@/lib/stores/leads";
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
  | { ok: false; error: string; busy?: true };

/** A claim on a capture id lives this long; a crashed writer's claim can be taken over after it. */
const CLAIM_MS = 60_000;
const BUSY: RecordResult = { ok: false, busy: true, error: "Still saving this visitor — try again in a moment." };

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
  const now = Date.now();
  // Who captured it is the signed-in actor, never a payload claim; a replay or takeover keeps the first stamp.
  const incoming: BoothCapture = { ...s.capture, capturedById: actor.id, capturedByName: actor.name, capturedAt: clampCapturedAt(s.capture.capturedAt, now) };
  delete incoming.cardImage;
  delete incoming.cardImagePath;

  // Claim first: the capture doc is the per-id lock. The loser of the insert either replays
  // (the lead is already stamped), backs off (a live claim), or takes a stale claim over.
  const claimUntil = now + CLAIM_MS;
  let prior: (BoothCapture & { id: string; claimUntil?: number }) | null = null;
  const won = await insertDocIfAbsent("booth_captures", { ...incoming, claimUntil });
  if (!won) {
    prior = await getDoc<BoothCapture & { id: string; claimUntil?: number }>("booth_captures", incoming.id);
    if (!prior) return BUSY;
    if (prior.leadId) {
      const lead = await getLead(prior.leadId);
      const outcome: "created" | "merged" = lead ? ((lead.boothCaptureIds || [])[0] === prior.id ? "created" : "merged") : prior.outcome ?? "created";
      const replay = { ...prior, outcome };
      delete replay.claimUntil;
      return { ok: true, leadId: prior.leadId, outcome, capture: replay };
    }
    if (typeof prior.claimUntil === "number" && prior.claimUntil > now) return BUSY;
    if (!(await casDocKey("booth_captures", prior.id, "claimUntil", prior.claimUntil, claimUntil))) return BUSY;
  }

  // We hold the claim. Keep the first capturer's stamp and any image already stored.
  let capture: BoothCapture = incoming;
  if (prior) capture = { ...capture, capturedById: prior.capturedById || capture.capturedById, capturedByName: prior.capturedByName || capture.capturedByName, capturedAt: prior.capturedAt || capture.capturedAt };
  const withImage = s.capture.cardImage ? { ...capture, cardImage: s.capture.cardImage } : capture;
  capture = prior?.cardImagePath ? { ...capture, cardImagePath: prior.cardImagePath } : await storeCardImage(withImage);

  const shows = await listShows();
  const showName = shows.find((x) => x.id === capture.showId)?.name ?? null;
  const leads = await allLeads();
  const lite = leads.map((l) => ({ id: l.id, email: l.email, stage: l.stage, boothCaptureIds: l.boothCaptureIds }));

  // A crash after the lead write but before the final capture write lands here on the retry.
  let leadId = alreadyRecorded(capture.id, lite);
  let outcome: "created" | "merged" = "created";
  if (leadId) {
    const l = leads.find((x) => x.id === leadId);
    outcome = l && (l.boothCaptureIds || [])[0] === capture.id ? "created" : "merged";
  } else {
    const d = dedupeDecision(capture, lite);
    if (d.kind === "merge") {
      // A public card submission is unverified: never attributed to the card owner, and it can't re-rate the lead.
      const fromCard = capture.via === "card";
      const met = `Met again at ${showName || "a trade show"}` + (capture.notes ? `\n${capture.notes}` : "");
      const note = fromCard ? `Sent from the contact card (not verified): ${met}` : met;
      const r = await addBoothCapture(
        d.leadId,
        { id: capture.id, interests: capture.interests, temperature: fromCard ? null : capture.temperature, showId: capture.showId },
        { by: fromCard ? "Contact card" : actor.name, text: note }
      );
      if (r.lead) {
        leadId = d.leadId;
        outcome = "merged";
      }
    }
    if (!leadId) {
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
          owner: opts.ownerName || actor.name,
          interest: capture.interests.join(", "),
          message: leadMessage(capture, showName),
          customerId,
          eventId: capture.showId ?? undefined,
          interests: capture.interests,
          temperature: capture.temperature,
          boothCaptureIds: [capture.id],
        },
        actor.name
      );
      leadId = lead.id;
      outcome = "created";
    }
  }

  // The final doc replaces the claim (claimUntil gone). An inline image (dev without Blob) rides on the doc.
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
    if (r.ok) return { id: rec.id, status: "ok", rev: r.capture.rev };
    // A live claim means another request is saving this same capture: the device tries again.
    return { id: rec.id, status: r.busy ? "retry" : "error", error: r.error };
  } catch (e) {
    console.error("[booth] push failed; the device will retry", rec.id, e);
    return { id: rec.id, status: "retry", error: "The server couldn't save it just now; it will try again" };
  }
}
