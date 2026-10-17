/* Venue assessment field sheet PDF (#344 C7) — server-only. */
import { get } from "@/lib/stores/surveys";
import { getSettings } from "@/lib/settings";
import { buildAssessmentSheet, planSheetImages, resolveSheetImages } from "@/lib/venue-assessment-sheet";
import { surveyFileBytes } from "@/lib/field-files/file-bytes";
import { printRecordFor } from "@/lib/survey-migrate";
import { mergeSurveyFileRefs, sanitizeIncomingFileSlots } from "@/lib/field-files/files";
import { blobEnabled } from "@/lib/blob";
import { renderLetterPdf } from "@/lib/pdf";
import { letterheadJpeg } from "@/lib/renewal-outreach";

export type SurveySheetPdf =
  | { ok: true; pdf: Buffer; fileName: string }
  | { ok: false; status: number; error: string };

/**
 * #344 C7 — render a venue assessment's field sheet (the saved record with the editor's unsaved `patch` on top) to a PDF
 * Buffer. Server-only; the route handler at /api/surveys/[id]/sheet-pdf streams it (a buffered function response is capped
 * around 4.5 MB on Vercel, which a sheet with ~10 photos exceeds).
 */
export async function renderSurveySheetPdf(id: string, patch: object): Promise<SurveySheetPdf> {
  const existing = id ? await get(id) : null;
  if (!existing) return { ok: false, status: 404, error: "Assessment not found." };
  const settings = await getSettings();
  const header = await letterheadJpeg(settings);
  /* migrate the merged draft so a print of unsaved edits shows the Older notes those edits produce */
  /* the patch is untrusted: sanitized and merged exactly like a save (a foreign id or a minted blobPath never survives), and
     the id is the stored survey's, whatever the body says */
  const clean = mergeSurveyFileRefs(
    existing as unknown as Record<string, unknown>,
    sanitizeIncomingFileSlots({ ...(patch as Record<string, unknown>), id: existing.id }, existing.id, { blobEnabled: blobEnabled(), stored: existing as unknown as Record<string, unknown> }),
  );
  const record = printRecordFor(existing, { ...clean, id: existing.id });
  /* #344 C7: photos (markup first) and sketches, loaded here — the stored slot first (the server may have finished a
     file the editor still shows pending), else the draft's; a missing or failed file is listed, never thrown */
  const loadFile = async (fileId: string): Promise<Buffer | null> => {
    try {
      return (await surveyFileBytes(existing, fileId))?.bytes ?? (await surveyFileBytes(record, fileId))?.bytes ?? null;
    } catch (e) {
      console.error("renderSurveySheetPdf: image load failed", fileId, e);
      return null;
    }
  };
  const images = await resolveSheetImages(planSheetImages(record), loadFile);
  const doc = buildAssessmentSheet(record, images);
  doc.companyName = settings.companyName;
  doc.accent = settings.accent;
  doc.headerJpeg = header.jpeg;
  doc.headerFull = header.full;
  return { ok: true, pdf: renderLetterPdf(doc), fileName: `${id}-venue-assessment.pdf` };
}
