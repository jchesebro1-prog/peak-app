import { createHash } from "node:crypto";
import type { Letterhead } from "@/lib/letterhead";
import { loadDocumentLetterhead } from "@/lib/letterhead-server";
import { bookCoverFingerprint } from "@/lib/part-docs/datasheet-book-cover-server";
import { loadAssembledSpec } from "@/lib/specs/load-spec";
import { buildSectionDocx } from "@/lib/specs/spec-docx";
import { specFileName } from "@/lib/specs/spec-file-name";
import { specDocumentsWithQuoteSource, type SpecDocument } from "@/lib/stores/spec-documents";
import type { ZipFile } from "@/lib/zip";

/**
 * Jeff 2026-10-15 #17 — the estimate package zip carries the Specs-builder
 * Word files (#205 Phase B `spec_documents`, SP-####) written for this
 * estimate, one .docx per CSI section, in place of the D94 Specifications.docx.
 * A spec belongs to the estimate when the builder opened it from that quote
 * (`source.quoteId`, from the Quotes hub, the Grid or the engagement). Each
 * file is exactly the builder's own Word download (same assembler, the spec's
 * own Peak-header choice, same file name).
 *
 * #352 review I2 — a SENT revision's zip is frozen to what existed when it
 * was sent: only specs downloaded at or before the revision's send
 * (`downloadedAt <= rev.at`) — a downloaded spec is the finished one; a draft
 * never downloaded, or one first downloaded later, is left out. Residual risk
 * (D1126): an included spec's text still reads the library live, as its own
 * Word download does. SERVER ONLY.
 */

/** The live (not deleted) specs written for this estimate, oldest first. Pure over the list. */
export function specDocumentsForQuote(all: readonly SpecDocument[], quoteId: string): SpecDocument[] {
  if (!quoteId) return [];
  return all
    .filter((d) => !!d.id && (d.source?.quoteId === quoteId || (d.source?.kind === "quote" && d.source?.id === quoteId)))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** #352 review I2 — the specs a sent revision's zip carries: downloaded at or before its send. Pure. */
export function specDocumentsForRevision<T extends Pick<SpecDocument, "downloadedAt">>(docs: readonly T[], revAt: number): T[] {
  return docs.filter((d) => typeof d.downloadedAt === "number" && Number.isFinite(d.downloadedAt) && d.downloadedAt <= revAt);
}

/** Eight hex characters naming the specs a zip would carry — each one's id, last download, last edit and the
 *  letterhead it prints (`letterheadKey`, the Branding logo / Peak-header stamp); "" when there are none. Pure. */
export function specDocumentsKey(docs: readonly (Pick<SpecDocument, "id" | "updatedAt"> & { downloadedAt?: number; letterheadKey?: string })[]): string {
  if (!docs.length) return "";
  return createHash("sha256")
    .update(docs.map((d) => `${d.id}:${d.downloadedAt ?? ""}:${d.updatedAt}:${d.letterheadKey ?? ""}`).join("|"))
    .digest("hex")
    .slice(0, 8);
}

/** The zip cache's cover key with the specs folded in (8 hex); unchanged when there are none, so other zips keep their key. Pure. */
export function zipKeyWithSpecs(frontKey: string, specKey: string): string {
  return specKey ? createHash("sha256").update(`${frontKey}|${specKey}`).digest("hex").slice(0, 8) : frontKey;
}

/** A name not already in `used` ("x.docx" → "x (2).docx"). Pure; records the name it returns. */
export function uniqueDocxName(name: string, used: Set<string>): string {
  let out = name;
  for (let n = 2; used.has(out.toLowerCase()); n++) out = name.replace(/\.docx$/i, "") + ` (${n}).docx`;
  used.add(out.toLowerCase());
  return out;
}

/** The estimate's specs (only those whose source quote id matches — one filtered read). */
export async function quoteSpecDocuments(quoteId: string): Promise<SpecDocument[]> {
  return specDocumentsForQuote(await specDocumentsWithQuoteSource(quoteId), quoteId);
}

/** The specs a sent revision's zip carries, each with the letterhead its Word file prints. */
async function revisionSpecs(quoteId: string, revAt: number): Promise<Array<{ doc: SpecDocument; letterhead: Letterhead | null }>> {
  const docs = specDocumentsForRevision(await quoteSpecDocuments(quoteId), revAt);
  return Promise.all(docs.map(async (doc) => ({ doc, letterhead: await loadDocumentLetterhead(doc.peakHeader) })));
}

/** The spec part of the zip cache key for a sent revision ("" = no SP specs). */
export async function revisionSpecKey(quoteId: string, revAt: number): Promise<string> {
  const specs = await revisionSpecs(quoteId, revAt);
  return specDocumentsKey(specs.map(({ doc, letterhead }) => ({ ...doc, letterheadKey: bookCoverFingerprint(null, letterhead) })));
}

/** A sent revision's SP-#### Word files. A spec whose section left the library (the builder's own 409) is skipped and
 *  named in `skipped`. Never throws for one bad spec — it is skipped and logged. */
export async function quoteSpecDocxFiles(quoteId: string, revAt: number): Promise<{ files: ZipFile[]; skipped: string[] }> {
  const files: ZipFile[] = [];
  const skipped: string[] = [];
  const used = new Set<string>();
  for (const { doc: d, letterhead } of await revisionSpecs(quoteId, revAt)) {
    try {
      const { doc, section, assembled } = await loadAssembledSpec(d.id);
      if (!doc.id || !section || !assembled) {
        skipped.push(d.id);
        continue;
      }
      const data = await buildSectionDocx(assembled, { letterhead });
      files.push({ name: uniqueDocxName(specFileName(doc.header, section), used), data });
    } catch (e) {
      console.warn(`[package] spec ${d.id} for ${quoteId} not built`, e instanceof Error ? e.message : e);
      skipped.push(d.id);
    }
  }
  return { files, skipped };
}
