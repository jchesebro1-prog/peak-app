"use server";

import { revalidatePath } from "next/cache";
import { portalSession } from "@/lib/portal";
import { PORTAL_EXPIRED_COPY } from "@/lib/portal-catalog-browse";
import { finalizeDocumentUpload, type FinalizeDocumentInput } from "@/lib/documents-upload";

/**
 * Portal document upload finalize (#218). SECURITY: runs for anonymous
 * visitors — authenticates via portalSession() and takes the company from
 * the session only. finalizeDocumentUpload forces a customer upload to
 * Shared / From customer / unseen / no project, and checks the path sits
 * under this company's upload key before it reads or deletes anything.
 */
export async function finalizePortalDocumentAction(
  input: FinalizeDocumentInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await finalizePortalDocumentIdAction(input);
  return r.ok ? { ok: true } : r;
}

/**
 * The Accept dialog's PO file (#245 Task 13, spec §4.4, controller decision
 * 6): same finalize as "Send us files" above, but returns the new `DOC-` id
 * so acceptPortalQuote can stamp it onto `portalAcceptance.poDocumentId`.
 */
export async function finalizePortalDocumentIdAction(
  input: FinalizeDocumentInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await portalSession();
  if (!session) return { ok: false, error: PORTAL_EXPIRED_COPY };
  const r = await finalizeDocumentUpload(
    { ...input, customerId: session.customerId, projectId: null, visibility: "shared" },
    { kind: "customer", name: session.name, customerId: session.customerId }
  );
  if (!r.ok) return r;
  revalidatePath("/portal");
  return { ok: true, id: r.document.id };
}
