import { getBlobStream } from "@/lib/blob";
import {
  getRecording,
  markImporting,
  markKrispFailed,
  markProcessing,
} from "@/lib/stores/recordings";
import {
  createKrispClient,
  KrispApiError,
  KrispBusyError,
  putToPresignedUrl,
  type KrispTransport,
} from "./client";
import {
  getKrispConnection,
  markKrispUsed,
  recordKrispError,
  withKrispImportLock,
} from "./connections";

/**
 * Krisp relay (Recordings spec §2.4) — the server-side half of "one cellular
 * upload": the device staged the audio in Vercel Blob, and this module hands
 * it to Krisp under the RECORDER's own key. `POST /import` reserves a
 * pre-signed slot, the Blob bytes are streamed to it with `PUT`, and the PUT
 * alone starts transcription. Krisp allows one import start per account in
 * flight, so the whole relay runs inside `withKrispImportLock`.
 *
 * Outcomes map onto the recording's krisp lifecycle:
 *   pending ──startImport──▶ importing ──PUT 2xx──▶ processing
 *   busy (lock held / Krisp 400 "still in process") → stays `pending`, the
 *   caller requeues; everything else → `failed` with Krisp's message and the
 *   error stamped on the rep's connection row for the Account page.
 */

export type KrispImportDeps = {
  /** Fake Krisp/S3 transport for the spec tests — production uses fetch. */
  transport?: KrispTransport;
  /** Fake Blob reader for the spec tests — production streams the private Blob. */
  blobStream?: (pathname: string) => Promise<ReadableStream | Buffer | Uint8Array | null>;
};

export type StartImportResult =
  | { ok: true; started: boolean }
  | { ok: false; reason: "no-connection" | "no-blob" | "busy" | "failed"; message?: string };

export const NO_CONNECTION_MESSAGE = "Connect Krisp in Account to transcribe.";

export async function startKrispImport(
  recId: string,
  deps: KrispImportDeps = {}
): Promise<StartImportResult> {
  const rec = await getRecording(recId);
  if (!rec) return { ok: false, reason: "failed", message: "Recording not found." };
  // Only a pending recording starts an import; anything further along is a no-op
  // (the Blob webhook and the client fallback may both call this — spec §2.3).
  if (rec.krisp.status !== "pending") return { ok: true, started: false };
  const pathname = rec.audio.blobPathname;
  if (rec.audio.state !== "uploaded" || !pathname) {
    return {
      ok: false,
      reason: "no-blob",
      message:
        rec.audio.state === "archived"
          ? "The audio has already been archived to Drive — nothing left in Blob to send."
          : "The audio has not finished uploading yet.",
    };
  }

  const userId = rec.recordedByUserId;
  const conn = await getKrispConnection(userId);
  if (!conn) return { ok: false, reason: "no-connection", message: NO_CONNECTION_MESSAGE };

  const client = createKrispClient(conn.apiKey, deps.transport);
  const readBlob = deps.blobStream ?? getBlobStream;

  try {
    await withKrispImportLock(userId, async () => {
      const slot = await client.startImport({
        title: rec.title,
        language: "auto",
        ...(rec.sizeBytes > 0 ? { size: rec.sizeBytes } : {}),
      });
      await markImporting(rec.id, { importId: slot.importId, krispUserId: conn.krispUserId });
      const body = await readBlob(pathname);
      if (!body) throw new KrispApiError(0, "The audio is missing from Blob storage.");
      await putToPresignedUrl(slot.url, body, rec.mime, deps.transport);
      await markProcessing(rec.id);
    });
    await markKrispUsed(userId);
    return { ok: true, started: true };
  } catch (err) {
    if (err instanceof KrispBusyError) {
      // Requeue, never `failed`: the lock holder / Krisp's in-flight import finishes first.
      return { ok: false, reason: "busy", message: err.message };
    }
    const message = (err as Error)?.message || "Krisp import failed.";
    await markKrispFailed(rec.id, message);
    await recordKrispError(userId, message).catch(() => {});
    return { ok: false, reason: "failed", message };
  }
}
