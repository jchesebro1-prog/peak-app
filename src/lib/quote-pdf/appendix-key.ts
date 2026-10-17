import { cleanPackageFiles, shownPackageFiles } from "@/lib/estimate-output/package-files";
import { normalizePackageSelection } from "@/lib/estimate-output/package-selection";

/**
 * Spec 2026-10-16 §4 — what of the package (which is NOT content: no updatedAt bump, no approval change) the
 * customer PDF prints: the drawings shown (id + file) and the datasheet choices. The writers compare it before
 * and after and re-render the PDF when it moved. The Drawings switch counts only through the shown list, so
 * turning it on or off with no drawings to show changes nothing and re-renders nothing. Pure; client-safe.
 */
export function pdfAppendixKey(q: { packageFiles?: unknown; packageSelection?: unknown } | null | undefined): string {
  if (!q) return "";
  const sel = normalizePackageSelection(q.packageSelection);
  return JSON.stringify([shownPackageFiles(cleanPackageFiles(q.packageFiles), q.packageSelection).map((f) => [f.id, f.blobPath]), sel.excludedDatasheets]);
}
