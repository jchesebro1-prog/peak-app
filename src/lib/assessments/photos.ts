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
  /** `null` only travels client → server, meaning "clear it" (the stored ref never holds null) */
  findingKey?: string | null;
  caption?: string;
  by: string;
}

export const PHOTO_PREFIX = "assessments/";

export const PHOTO_CAPS = { perAssessment: 200, originalBytes: 25 * 1024 * 1024, longEdge: 1600, quality: 0.8 };

/** A photo id: `p_` + 8–32 lowercase letters/digits. No `-`, so no id can ever be another id plus Blob's `-<suffix>`. */
export const PHOTO_ID_RE = /^p_[a-z0-9]{8,32}$/;

/** A fresh photo id (`p_` + 12 random lowercase hex), safe in the browser and on the server. */
export function newPhotoId(): string {
  const b = new Uint8Array(6);
  globalThis.crypto.getRandomValues(b);
  return "p_" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function photoBlobPath(assessmentId: string, photoId: string): string {
  if (typeof photoId !== "string" || !PHOTO_ID_RE.test(photoId)) throw new Error("That photo id isn't valid");
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

/** The one Blob path an upload for `photoId` may land at: its own folder, its own file name — exactly `<photoId>.jpg`,
 *  or with Blob's random suffix `<photoId>-<suffix>.jpg` (suffix `[A-Za-z0-9]+`). Photo ids never contain `-`
 *  (PHOTO_ID_RE), so a different id can't be a hyphenated prefix of this file and one photo can't alias another's blob. */
export function photoPathMatches(path: string, assessmentId: string, photoId: string): boolean {
  if (typeof photoId !== "string" || !PHOTO_ID_RE.test(photoId) || !photoPathInScope(path, assessmentId)) return false;
  const file = path.slice(`${PHOTO_PREFIX}${assessmentId}/`.length);
  return file === `${photoId}.jpg` || (file.startsWith(`${photoId}-`) && /^[A-Za-z0-9]+\.jpg$/.test(file.slice(photoId.length + 1)));
}

/** A queued photo older than this is given up on (kept on the device, marked failed) however the server answers. */
export const PHOTO_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export function photoTooOld(createdAt: number, now: number): boolean {
  return Number.isFinite(createdAt) && now - createdAt > PHOTO_MAX_AGE_MS;
}

export const INLINE_PHOTO_PREFIX = "data:image/jpeg;base64,";
/** All inline data URLs on one assessment together (characters); past this a photo waits for its Blob upload. */
export const INLINE_TOTAL_MAX = 300 * 1024;
/** Local dev without Blob: the byte target the device shrinks a photo to before inlining. Base64 grows it by 4/3, so
 *  this plus the data-URL prefix stays under INLINE_TOTAL_MAX (one inline photo always fits an empty assessment). */
export const INLINE_BLOB_MAX = 200 * 1024;
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
