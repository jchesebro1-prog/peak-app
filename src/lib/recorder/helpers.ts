/**
 * Pure helpers shared by the capture actions, the upload queue and the spec
 * tests (scripts/test-review-and-spec.ts). No imports, no platform code —
 * safe under tsx, in a server action and in the client bundle alike.
 */

export const RECORDING_TITLE_MAX = 200;

/** `YYYY-MM-DD` in the machine's local zone (what Krisp shows as the meeting title date). */
export function recordingDateStamp(atMs: number): string {
  const d = new Date(atMs);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The Krisp-facing title (spec §1.1 / §2.2):
 * `SV-5012 · Hortonville HS · Site visit · 2026-09-21`, with the rep's
 * optional "what to remember" line slotted before the date. Venue falls back
 * to the customer name, and the whole thing is capped at 200 chars (Krisp's
 * title field) by trimming the remember text first, never the ids/date.
 */
export function buildRecordingTitle(input: {
  parentId: string;
  venue: string;
  customer: string;
  parentLabel: string;
  remember?: string | null;
  at: number;
}): string {
  const place = (input.venue || input.customer || "").trim();
  const date = recordingDateStamp(input.at);
  const fixed = [input.parentId, place, input.parentLabel].filter(Boolean);
  const remember = (input.remember ?? "").replace(/\s+/g, " ").trim();
  const tail = ` · ${date}`;
  const head = fixed.join(" · ");
  if (!remember) return (head + tail).slice(0, RECORDING_TITLE_MAX);
  const room = RECORDING_TITLE_MAX - head.length - tail.length - 3; // " · "
  if (room <= 0) return (head + tail).slice(0, RECORDING_TITLE_MAX);
  return `${head} · ${remember.slice(0, room).trim()}${tail}`;
}

/** Exponential backoff for the device upload queue: 5s, 15s, 45s, … capped at 15 min. */
export const UPLOAD_BACKOFF_BASE_MS = 5_000;
export const UPLOAD_BACKOFF_MAX_MS = 15 * 60_000;

export function uploadBackoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  const ms = UPLOAD_BACKOFF_BASE_MS * Math.pow(3, Math.min(attempts, 12) - 1);
  return Math.min(ms, UPLOAD_BACKOFF_MAX_MS);
}

/** Blob pathname the upload route requires: `recordings/<REC-id>/<safe file name>`. */
export function recordingBlobPathname(recordingId: string, mime: string): string {
  return `recordings/${recordingId}/${recordingId}.${extensionForMime(mime)}`;
}

/** File extension for the mime types the queue produces / the route allows. */
export function extensionForMime(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  switch (base) {
    case "audio/mp4":
    case "audio/m4a":
    case "audio/x-m4a":
      return "m4a";
    case "audio/aac":
      return "aac";
    case "audio/mpeg":
      return "mp3";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/webm":
      return "webm";
    case "audio/ogg":
      return "ogg";
    case "video/mp4":
      return "mp4";
    default:
      return "bin";
  }
}

/** `mm:ss` (or `h:mm:ss` past an hour) for the recorder's elapsed timer. */
export function formatElapsed(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}
