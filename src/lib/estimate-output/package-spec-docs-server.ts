import { createHash } from "node:crypto";
import { loadDocumentLetterhead } from "@/lib/letterhead-server";
import { loadAssembledSpec } from "@/lib/specs/load-spec";
import { buildSectionDocx } from "@/lib/specs/spec-docx";
import { specFileName } from "@/lib/specs/spec-file-name";
import { allSpecDocuments, type SpecDocument } from "@/lib/stores/spec-documents";
import type { ZipFile } from "@/lib/zip";

/**
 * Jeff 2026-10-15 #17 — the estimate package zip carries the Specs-builder
 * Word files (#205 Phase B `spec_documents`, SP-####) written for this
 * estimate, one .docx per CSI section, in place of the D94 Specifications.docx.
 * A spec belongs to the estimate when the builder opened it from that quote
 * (`source.quoteId`, from the Quotes hub, the Grid or the engagement). Each
 * file is exactly the builder's own Word download (same assembler, the spec's
 * own Peak-header choice, same file name). SERVER ONLY.
 */

/** The live (not deleted) specs written for this estimate, oldest first. Pure over the list. */
export function specDocumentsForQuote(all: readonly SpecDocument[], quoteId: string): SpecDocument[] {
  if (!quoteId) return [];
  return all
    .filter((d) => !!d.id && (d.source?.quoteId === quoteId || (d.source?.kind === "quote" && d.source?.id === quoteId)))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

/** Eight hex characters naming the specs a zip would carry (their ids and last edits); "" when there are none. Pure. */
export function specDocumentsKey(docs: readonly Pick<SpecDocument, "id" | "updatedAt">[]): string {
  if (!docs.length) return "";
  return createHash("sha256")
    .update(docs.map((d) => `${d.id}:${d.updatedAt}`).join("|"))
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

export async function quoteSpecDocuments(quoteId: string): Promise<SpecDocument[]> {
  return specDocumentsForQuote(await allSpecDocuments(), quoteId);
}

/** The estimate's SP-#### Word files. A spec whose section left the library (the builder's own 409) is skipped and
 *  named in `skipped`. Never throws for one bad spec — it is skipped and logged. */
export async function quoteSpecDocxFiles(quoteId: string): Promise<{ files: ZipFile[]; skipped: string[] }> {
  const files: ZipFile[] = [];
  const skipped: string[] = [];
  const used = new Set<string>();
  for (const d of await quoteSpecDocuments(quoteId)) {
    try {
      const { doc, section, assembled } = await loadAssembledSpec(d.id);
      if (!doc.id || !section || !assembled) {
        skipped.push(d.id);
        continue;
      }
      const data = await buildSectionDocx(assembled, { letterhead: await loadDocumentLetterhead(doc.peakHeader) });
      files.push({ name: uniqueDocxName(specFileName(doc.header, section), used), data });
    } catch (e) {
      console.warn(`[package] spec ${d.id} for ${quoteId} not built`, e instanceof Error ? e.message : e);
      skipped.push(d.id);
    }
  }
  return { files, skipped };
}
