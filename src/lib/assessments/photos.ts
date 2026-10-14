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

/** A client-supplied path is trusted only inside its own assessment folder: one safe segment, no "..". Blob's random suffix is allowed. */
export function photoPathInScope(path: string, assessmentId: string): boolean {
  if (typeof path !== "string" || !/^[A-Za-z0-9._-]+$/.test(assessmentId)) return false;
  const prefix = `${PHOTO_PREFIX}${assessmentId}/`;
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  return /^[A-Za-z0-9._-]+$/.test(rest) && !rest.includes("..");
}
