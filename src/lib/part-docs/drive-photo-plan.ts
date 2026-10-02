/**
 * #283 — what one Drive photo sync should do, decided purely from the
 * folder listing, the remembered per-file state and a name → parts matcher
 * (the Upload-many filename rule). The executor (drive-photo-sync.ts) only
 * carries the plan out. Per file, first rule wins:
 *  0. Claimed by a photo-sheet import (sheetDriveClaims) → unchanged.
 *  1. HEIC / over the cap / ambiguous / no match → unmatched (listed with a
 *     reason). A KNOWN file that is now unmatched keeps its document and
 *     links untouched — it is only listed.
 *  2. Same md5 as last time and a recorded error → retry later (a broken
 *     file isn't re-downloaded every run; changing it in Drive retries).
 *  3. Never seen, or seen but never imported → import.
 *  4. md5 changed and it has a document → update (replace the file) +
 *     re-point its parts to the current match.
 *  5. md5 same, matched parts changed (renamed) → relink.
 *  6. Otherwise unchanged.
 * A file listed twice (two parent folders) is planned once.
 */
import type { DriveListedPhoto } from "@/lib/google/drive-photos";

export type DrivePhotoFileState = { md5: string; documentId: string | null; skus: string[]; error?: string; at: number };
export type PhotoMatch = { confidence: "high" | "ambiguous" | "none"; skus: string[] };
export type UnmatchedPhoto = { fileId: string; name: string; webViewLink: string; reason: string };
export type PlannedImport = DriveListedPhoto & { skus: string[] };
export type PlannedUpdate = DriveListedPhoto & { skus: string[]; documentId: string; add: string[]; remove: string[] };
export type PlannedRelink = { fileId: string; md5: string; documentId: string; skus: string[]; add: string[]; remove: string[] };
export type DrivePhotoPlan = {
  imports: PlannedImport[];
  updates: PlannedUpdate[];
  relinks: PlannedRelink[];
  unmatched: UnmatchedPhoto[];
  retryLater: number;
  unchanged: number;
};

export const HEIC_REASON = "HEIC — save it as JPEG (iPhone: Settings → Camera → Formats → Most Compatible)";
export const OVER_CAP_REASON = "over 25 MB — export a smaller copy";
export const NO_MATCH_REASON = "no part number found in the name";
const HEIC = new Set(["image/heic", "image/heif"]);

function diff(next: readonly string[], prev: readonly string[]): { add: string[]; remove: string[] } {
  const p = new Set(prev);
  const n = new Set(next);
  return { add: next.filter((s) => !p.has(s)), remove: prev.filter((s) => !n.has(s)) };
}

export function planDrivePhotoSync(
  listing: readonly DriveListedPhoto[],
  files: Readonly<Record<string, DrivePhotoFileState>>,
  matchOf: (name: string) => PhotoMatch,
  maxBytes: number,
  /** Drive file ids a photo-sheet import owns (`sheetDriveClaims`) — left alone. */
  claimed: ReadonlySet<string> = new Set()
): DrivePhotoPlan {
  const plan: DrivePhotoPlan = { imports: [], updates: [], relinks: [], unmatched: [], retryLater: 0, unchanged: 0 };
  const seen = new Set<string>();
  const sorted = [...listing].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  for (const photo of sorted) {
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);
    if (claimed.has(photo.id)) { plan.unchanged++; continue; }
    const unmatched = (reason: string) => plan.unmatched.push({ fileId: photo.id, name: photo.name, webViewLink: photo.webViewLink, reason });
    if (HEIC.has(photo.mimeType)) { unmatched(HEIC_REASON); continue; }
    if (photo.size > maxBytes) { unmatched(OVER_CAP_REASON); continue; }
    const m = matchOf(photo.name);
    if (m.confidence === "ambiguous") { unmatched(`matches several parts: ${m.skus.slice(0, 5).join(", ")}${m.skus.length > 5 ? ", …" : ""}`); continue; }
    if (m.confidence !== "high" || !m.skus.length) { unmatched(NO_MATCH_REASON); continue; }

    const prev = files[photo.id];
    if (prev && prev.md5 === photo.md5 && prev.error) { plan.retryLater++; continue; }
    if (!prev || !prev.documentId) { plan.imports.push({ ...photo, skus: [...m.skus] }); continue; }
    const d = diff(m.skus, prev.skus);
    if (prev.md5 !== photo.md5) { plan.updates.push({ ...photo, skus: [...m.skus], documentId: prev.documentId, ...d }); continue; }
    if (d.add.length || d.remove.length) {
      plan.relinks.push({ fileId: photo.id, md5: photo.md5, documentId: prev.documentId, skus: [...m.skus], ...d });
      continue;
    }
    plan.unchanged++;
  }
  return plan;
}
