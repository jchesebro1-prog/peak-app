import { deleteBlob, getBlobHead } from "@/lib/blob";
import { getCompany } from "@/lib/identity/companies";
import { docLocId, sitesForCompany } from "@/lib/identity/sites";
import { getProject } from "@/lib/stores/projects";
import { createDocument, documentCategories, documentsUnderUploadKey, removeDocument } from "@/lib/stores/documents";
import { uploadCategory, type DocumentCategory } from "@/lib/document-categories";
import {
  blobPathInScope,
  blockedExtension,
  checkDocumentBytes,
  displayFileName,
  DOCUMENT_SNIFF_BYTES,
  isUploadKey,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_LABEL,
} from "@/lib/document-files";
import {
  cleanMime,
  cleanNotes,
  cleanTitle,
  isVisibility,
  resolveDocumentScope,
  type DocumentRecord,
  type DocumentScopeFacts,
} from "@/lib/document-rules";

/**
 * Documents (#218) — the ONE place an uploaded blob becomes a document, for
 * the team and the portal alike. Server-only.
 *
 * The browser uploaded straight to private Blob under
 * `documents/<customer>/<uploadKey>/…` (a token route checked that path
 * first). Here, in order:
 *   1. the company comes from the actor for a portal user (never the input),
 *   2. the client-supplied path must sit under that company's upload key,
 *   3. a path already recorded on a document — or any document already
 *      recorded under the same upload key — is refused, and never deleted,
 *   4. venue/project must belong to the company (resolveDocumentScope),
 *   5. the name must not be a program/script,
 *   6. the head Blob holds is read back: size ≤ 100 MB, no program bytes,
 *   7. only then is the record written — category, mime and every free-text
 *      field cleaned here (the store writes category/mime as given),
 *   8. and a racing finalize of the same upload key is resolved: the lowest
 *      id wins, a later duplicate record is withdrawn (never its blob).
 * A refusal after step 3 deletes the blob (re-checked first — a racing
 * finalize may have recorded it meanwhile): it is provably the caller's own,
 * unrecorded upload. `deps` exists for the spec harness.
 */

export type FinalizeDocumentInput = {
  customerId?: string;
  uploadKey: string;
  blobPath: string;
  fileName: string;
  mime?: string;
  title?: string;
  category?: string;
  visibility?: string;
  siteId?: string | null;
  projectId?: string | null;
  notes?: string;
};

export type DocumentActor = { kind: "team"; name: string } | { kind: "customer"; name: string; customerId: string };

export type FinalizeResult = { ok: true; document: DocumentRecord } | { ok: false; error: string };

export type FinalizeDeps = {
  head: (pathname: string, max: number) => Promise<{ bytes: Uint8Array; size: number } | null>;
  remove: (pathname: string) => Promise<void>;
  facts: (customerId: string, projectId: string | null) => Promise<DocumentScopeFacts>;
  categories: () => Promise<DocumentCategory[]>;
};

/** Does the company exist, which venues are its, and whose is the project? */
export async function documentScopeFacts(customerId: string, projectId: string | null): Promise<DocumentScopeFacts> {
  const [co, sites, project] = await Promise.all([
    getCompany(customerId),
    sitesForCompany(customerId),
    projectId ? getProject(projectId) : Promise.resolve(null),
  ]);
  return {
    customerExists: !!co,
    siteIds: sites.map(docLocId),
    project: project ? { id: project.id, customerId: project.customerId, locationId: project.locationId } : null,
  };
}

const liveDeps: FinalizeDeps = {
  head: getBlobHead,
  remove: deleteBlob,
  facts: documentScopeFacts,
  categories: documentCategories,
};

const ALREADY_SAVED = "That file is already saved.";

/** `DOC-1234` → 1234 (ids are minted max+1, so a later insert sorts higher). */
function docSeq(id: string): number {
  const n = Number(/^DOC-(\d+)$/.exec(id)?.[1]);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

export async function finalizeDocumentUpload(
  input: FinalizeDocumentInput,
  actor: DocumentActor,
  deps: FinalizeDeps = liveDeps
): Promise<FinalizeResult> {
  // A server action's argument is whatever the browser sent — never trust its shape.
  const inp = (input && typeof input === "object" ? input : {}) as Partial<FinalizeDocumentInput>;
  const customerId = actor.kind === "customer" ? actor.customerId : String(inp.customerId ?? "").trim();
  if (!customerId) return { ok: false, error: "Pick a company first." };
  const uploadKey = inp.uploadKey;
  if (!isUploadKey(uploadKey) || !blobPathInScope(inp.blobPath, customerId, uploadKey)) {
    return { ok: false, error: "That upload does not belong to this company." };
  }
  const blobPath = inp.blobPath;
  // Never touch a blob a document already records — it may be someone
  // else's real file (the whole point of replaying its path), or a retry.
  if ((await documentsUnderUploadKey(customerId, uploadKey, blobPath)).length) return { ok: false, error: ALREADY_SAVED };

  const refuse = async (error: string): Promise<FinalizeResult> => {
    try {
      // Re-checked right before the delete: a racing finalize of the same
      // upload may have recorded this blob since the check above, and a
      // recorded blob is never deleted. This narrows the race window — it
      // does not close it: a rival can still record the blob in the gap
      // between this read and deps.remove() below. Best effort only.
      if (!(await documentsUnderUploadKey(customerId, uploadKey, blobPath)).length) await deps.remove(blobPath);
    } catch {
      /* best effort — the refusal stands either way */
    }
    return { ok: false, error };
  };

  const projectId = actor.kind === "customer" ? null : String(inp.projectId ?? "").trim() || null;
  const scope = resolveDocumentScope({ siteId: inp.siteId, projectId }, customerId, await deps.facts(customerId, projectId));
  if (!scope.ok) return refuse(scope.error);

  const fileName = displayFileName(inp.fileName);
  if (blockedExtension(fileName)) return refuse(`${fileName} is a program or script — those can't be uploaded.`);

  let head: { bytes: Uint8Array; size: number } | null;
  try {
    head = await deps.head(blobPath, DOCUMENT_SNIFF_BYTES);
  } catch {
    // A Blob read failure is not "never arrived" — and the vendor's own
    // error text never reaches the browser.
    return { ok: false, error: "Couldn't read the uploaded file — try again." };
  }
  if (!head) return { ok: false, error: "The upload didn't arrive — try again." };
  if (!(head.size > 0)) return refuse(`${fileName} is empty.`);
  if (head.size > MAX_DOCUMENT_BYTES) return refuse(`${fileName} is over ${MAX_DOCUMENT_LABEL}.`);
  const magic = checkDocumentBytes(head.bytes);
  if (magic) return refuse(magic);

  const categories = await deps.categories();
  const document = await createDocument({
    title: cleanTitle(inp.title, fileName),
    fileName,
    mime: cleanMime(inp.mime),
    size: head.size,
    blobPath,
    category: uploadCategory(categories, inp.category),
    visibility: actor.kind === "customer" ? "shared" : isVisibility(inp.visibility) ? inp.visibility : "internal",
    source: actor.kind === "customer" ? "customer" : "team",
    customerId,
    siteId: scope.siteId,
    projectId: scope.projectId,
    notes: cleanNotes(inp.notes),
    uploadedBy: actor.name || (actor.kind === "customer" ? "Customer" : "Team"),
  });

  // Two finalizes of one upload (a double-click, a retried request) can both
  // pass the check above before either writes. Every finalize re-reads after
  // its own insert; ids are minted max+1, so the later insert always sees the
  // earlier one and withdraws its own record. The blob belongs to the winner.
  const mine = docSeq(document.id);
  const rivals = (await documentsUnderUploadKey(customerId, uploadKey, blobPath)).filter((d) => d.id !== document.id);
  if (rivals.some((d) => docSeq(d.id) < mine)) {
    await removeDocument(document.id);
    return { ok: false, error: ALREADY_SAVED };
  }
  return { ok: true, document };
}
