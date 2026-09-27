"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { deleteBlob } from "@/lib/blob";
import { normalizeCategory } from "@/lib/document-categories";
import { isVisibility, resolveDocumentScope } from "@/lib/document-rules";
import { documentScopeFacts, finalizeDocumentUpload, type FinalizeDocumentInput } from "@/lib/documents-upload";
import {
  documentCategories,
  getDocument,
  markCustomerSeen,
  removeDocument,
  updateDocument,
} from "@/lib/stores/documents";

/**
 * Team document actions (#218) — used by the Documents card on the company,
 * venue and project pages (src/components/documents/documents-card-client.tsx).
 * Every action requires a signed-in user. The company is never taken from
 * the browser for an edit or delete — it is the stored document's; an
 * upload's company must exist and own the path (finalizeDocumentUpload).
 * This route folder has no page on purpose — actions only.
 */

type Result = { ok: true } | { ok: false; error: string };

function revalidate(): void {
  // The card lives on three pages and the bell on every page.
  revalidatePath("/", "layout");
}

export async function finalizeTeamDocumentAction(input: FinalizeDocumentInput): Promise<Result> {
  const user = await requireUser();
  const r = await finalizeDocumentUpload(input, { kind: "team", name: user.name });
  if (!r.ok) return r;
  revalidate();
  return { ok: true };
}

export async function updateDocumentAction(
  id: string,
  patch: {
    title?: string;
    category?: string;
    visibility?: string;
    siteId?: string | null;
    projectId?: string | null;
    notes?: string;
  }
): Promise<Result> {
  await requireUser();
  const doc = await getDocument(String(id || ""));
  if (!doc) return { ok: false, error: "That document was deleted." };
  const p = (patch && typeof patch === "object" ? patch : {}) as NonNullable<typeof patch>;
  const norm = (v: unknown): string | null => String(v ?? "").trim() || null;
  const siteId = p.siteId !== undefined ? p.siteId : doc.siteId;
  const projectId = p.projectId !== undefined ? p.projectId : doc.projectId;
  // Venue/project are re-validated only when this edit changes them — a
  // title/category/notes edit on a file whose venue or project has since
  // gone away must still save (it keeps its stored scope untouched).
  const scopeChanged = norm(siteId) !== norm(doc.siteId) || norm(projectId) !== norm(doc.projectId);
  let scope: { siteId?: string | null; projectId?: string | null } = {};
  if (scopeChanged) {
    const facts = await documentScopeFacts(doc.customerId, norm(projectId));
    const r = resolveDocumentScope({ siteId, projectId }, doc.customerId, facts);
    if (!r.ok) return r;
    scope = { siteId: r.siteId, projectId: r.projectId };
  }
  const categories = await documentCategories();
  const next = await updateDocument(doc.id, {
    title: typeof p.title === "string" ? p.title : undefined,
    // The store writes category as given — only a listed key (or Other) lands.
    category: p.category !== undefined ? normalizeCategory(categories, p.category) : undefined,
    visibility: isVisibility(p.visibility) ? p.visibility : undefined,
    siteId: scope.siteId,
    projectId: scope.projectId,
    notes: typeof p.notes === "string" ? p.notes : undefined,
  });
  if (!next) return { ok: false, error: "That document was deleted." };
  revalidate();
  return { ok: true };
}

export async function deleteDocumentAction(id: string): Promise<Result> {
  await requireUser();
  const removed = await removeDocument(String(id || ""));
  if (!removed) return { ok: false, error: "That document was already deleted." };
  try {
    await deleteBlob(removed.blobPath);
  } catch {
    /* the record is gone either way; an orphaned private blob is harmless */
  }
  revalidate();
  return { ok: true };
}

export async function markCustomerDocumentsSeenAction(customerId: string): Promise<Result> {
  await requireUser();
  await markCustomerSeen(String(customerId || ""));
  revalidate();
  return { ok: true };
}
