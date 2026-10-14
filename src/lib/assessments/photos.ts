/* Assessments engine (#337) — photo references and the Blob path rules. Pure. */

export interface PhotoRef {
  id: string;
  /** Blob pathname once uploaded */
  blobPath?: string;
  /** a small data URL held until the upload succeeds (offline) */
  inline?: string;
  /** true while the upload is still queued */
  pending?: true;
  takenAt: number;
  questionKey?: string;
  moduleId?: string;
  reqId?: string;
  findingKey?: string;
  caption?: string;
  by: string;
}

export const PHOTO_PREFIX = "assessments/";

export const PHOTO_CAPS = { perAssessment: 200, originalBytes: 25 * 1024 * 1024, longEdge: 1600, quality: 0.8 };

export function photoBlobPath(assessmentId: string, photoId: string): string {
  return `${PHOTO_PREFIX}${assessmentId}/${photoId}.jpg`;
}

/** A client-supplied path is trusted only inside its own assessment folder: one safe .jpg segment, no "..". Blob's random suffix is allowed. */
export function photoPathInScope(path: string, assessmentId: string): boolean {
  if (typeof path !== "string" || typeof assessmentId !== "string" || !/^AS-\d+$/.test(assessmentId)) return false;
  const prefix = `${PHOTO_PREFIX}${assessmentId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  // One safe segment: never dots only, no "..", must end in ".jpg" (Blob's random suffix sits before it).
  return !/^\.+$/.test(rest) && !rest.includes("..") && /^[A-Za-z0-9_-][A-Za-z0-9._-]*\.jpg$/.test(rest);
}

export const INLINE_PHOTO_PREFIX = "data:image/jpeg;base64,";
/** One inline (dev / no-Blob) photo: a data URL up to 400 KB. */
export const INLINE_PHOTO_MAX = 400 * 1024;

/** Why a data URL isn't an acceptable inline photo, or null: a JPEG data-URL prefix, a base64 body that really starts
 *  with the JPEG signature (FF D8 FF), and at most 400 KB. The label alone is never trusted. */
export function inlinePhotoProblem(dataUrl: unknown): string | null {
  const msg = "An inline image must be a JPEG data URL up to 400 KB";
  if (typeof dataUrl !== "string" || !dataUrl.startsWith(INLINE_PHOTO_PREFIX) || dataUrl.length > INLINE_PHOTO_MAX) return msg;
  const body = dataUrl.slice(INLINE_PHOTO_PREFIX.length);
  if (body.length < 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(body)) return msg;
  const head = atob(body.slice(0, 4));
  if (head.charCodeAt(0) !== 0xff || head.charCodeAt(1) !== 0xd8 || head.charCodeAt(2) !== 0xff) return msg;
  return null;
}

export const PHOTO_BACKOFF_BASE_MS = 5_000;
export const PHOTO_BACKOFF_MAX_MS = 5 * 60_000;

/** How long the device photo queue waits after a photo's Nth failed try: 5 s × 2^(N−1), never more than 5 minutes. */
export function photoBackoffMs(tries: number): number {
  if (!(tries > 0)) return 0;
  return Math.min(PHOTO_BACKOFF_BASE_MS * Math.pow(2, Math.min(tries, 20) - 1), PHOTO_BACKOFF_MAX_MS);
}
