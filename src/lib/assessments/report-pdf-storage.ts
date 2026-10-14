/* Assessments engine (#340) final review I2 — the emailed report PDF in private Blob. Server-only: every path is
   checked with isAssessmentPdfPath before any I/O, and nothing here runs without Blob (local dev attaches a small
   PDF inline instead — report-model emailAttachmentMode). */
import { blobEnabled, getBlobStream, putBlob } from "@/lib/blob";
import { assessmentPdfPath, isAssessmentPdfPath } from "./report-pdf-path";

/** Stores a rendered report and returns its stored path (Blob adds a random suffix). Throws when Blob is off. */
export async function storeAssessmentPdf(assessmentId: string, bytes: Buffer, now: number): Promise<string> {
  if (!blobEnabled()) throw new Error("File storage isn't configured");
  const { pathname } = await putBlob(assessmentPdfPath(assessmentId, now), bytes, "application/pdf");
  if (!isAssessmentPdfPath(pathname)) throw new Error("The stored report landed outside its folder");
  return pathname;
}

/** A stored report's bytes as a stream, or null (not an assessment PDF path, Blob off, or not found). */
export async function streamAssessmentPdf(path: string): Promise<ReadableStream | null> {
  if (!isAssessmentPdfPath(path) || !blobEnabled()) return null;
  try {
    return await getBlobStream(path);
  } catch {
    return null;
  }
}

/** A stored report's bytes (the Gmail bridge builds the MIME part from them), streamed from Blob; null when unreadable. */
export async function readAssessmentPdf(path: string): Promise<Buffer | null> {
  const s = await streamAssessmentPdf(path);
  if (!s) return null;
  try {
    const reader = (s as ReadableStream<Uint8Array>).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}
