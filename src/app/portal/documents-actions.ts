"use server";

import { revalidatePath } from "next/cache";
import { portalSession } from "@/lib/portal";
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
  const session = await portalSession();
  if (!session) return { ok: false, error: "Your access link has expired — open the link we sent you again." };
  const r = await finalizeDocumentUpload(
    { ...input, customerId: session.customerId, projectId: null, visibility: "shared" },
    { kind: "customer", name: session.name, customerId: session.customerId }
  );
  if (!r.ok) return r;
  revalidatePath("/portal");
  return { ok: true };
}
