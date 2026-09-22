import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { auth } from "@/auth";
import { blobEnabled } from "@/lib/blob";
import { can } from "@/lib/team";
import { getRecording, markUploaded } from "@/lib/stores/recordings";

// Token minting is quick; the completed-callback may patch a doc — both well under this.
export const maxDuration = 60;

/**
 * Vercel Blob client-upload broker for recordings (spec §2.3).
 *
 * `upload()` from @vercel/blob/client POSTs here twice per file:
 *  1. `blob.generate-client-token` — from the DEVICE, carrying the session
 *     cookie. We authenticate manually (`auth()`), check the recording is the
 *     caller's (or the caller is an admin) and still `on_device`, then hand
 *     back a token scoped to `recordings/<REC-id>/…`, audio types only, 1 GB.
 *  2. `blob.upload-completed` — from VERCEL's infra after the bytes land. No
 *     session exists on that call, which is why this path is exempted from
 *     the auth middleware (src/middleware.ts) and authenticates per-event
 *     here instead; handleUpload verifies the callback's signature against
 *     BLOB_READ_WRITE_TOKEN. Vercel cannot reach localhost, so on a dev
 *     machine step 2 never arrives — the client's `markUploadedAction`
 *     (capture-actions.ts) covers it; both writes are idempotent.
 *
 * No BLOB_READ_WRITE_TOKEN → 503 {reason:"blob-disabled"} and the client
 * keeps the file on the device (there is deliberately no data-URL fallback —
 * a 40 MB row must never land in Postgres).
 */

// Route files may only export handlers/config — these stay module-private.
const ALLOWED_RECORDING_TYPES = [
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/aac",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "video/mp4",
];
const MAX_RECORDING_BYTES = 1024 ** 3; // 1 GB (spec §7)

class UploadRefused extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

function parseRecordingId(payload: string | null): string {
  try {
    const parsed = payload ? (JSON.parse(payload) as { recordingId?: unknown }) : {};
    const id = typeof parsed.recordingId === "string" ? parsed.recordingId.trim() : "";
    if (!id || id.includes("/") || id.length > 64) throw new Error("bad id");
    return id;
  } catch {
    throw new UploadRefused(400, "clientPayload must be {recordingId}");
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!blobEnabled()) {
    return NextResponse.json({ reason: "blob-disabled" }, { status: 503 });
  }
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        const session = await auth();
        const u = session?.user;
        if (!u?.id || !u.active) throw new UploadRefused(401, "unauthorized");

        const recordingId = parseRecordingId(clientPayload);
        const rec = await getRecording(recordingId);
        if (!rec) throw new UploadRefused(404, "recording not found");
        if (rec.recordedByUserId !== u.id && !can("manage_users", u.roles || [])) {
          throw new UploadRefused(403, "not your recording");
        }
        if (rec.audio.state !== "on_device") {
          throw new UploadRefused(409, `recording is already ${rec.audio.state}`);
        }
        const prefix = `recordings/${recordingId}/`;
        if (!pathname.startsWith(prefix) || pathname.length <= prefix.length || pathname.includes("..")) {
          throw new UploadRefused(400, `pathname must start with ${prefix}`);
        }
        return {
          allowedContentTypes: ALLOWED_RECORDING_TYPES,
          maximumSizeInBytes: MAX_RECORDING_BYTES,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ recordingId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const recordingId = parseRecordingId(tokenPayload ?? null);
        if (!blob.pathname.startsWith(`recordings/${recordingId}/`)) return; // never trust a stray callback
        const size = (blob as { size?: number }).size ?? 0;
        await markUploaded(recordingId, blob.pathname, size);
      },
    });
    return NextResponse.json(json);
  } catch (e) {
    if (e instanceof UploadRefused) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    // handleUpload throws on a bad/unsigned callback or an unknown event type.
    return NextResponse.json({ error: (e as Error)?.message ?? "upload refused" }, { status: 400 });
  }
}
