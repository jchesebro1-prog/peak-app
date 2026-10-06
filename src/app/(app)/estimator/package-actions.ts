"use server";

import { finalizePackageFileUpload, removePackageFileAndBlob } from "@/lib/estimate-output/package-files-server";
import { PACKAGE_FILES_COPY } from "@/lib/estimate-output/package-files";
import { ONLINE_COPY } from "@/lib/quote-share/view";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";

/**
 * #301 slice C — the staff package panel's server actions (Slice C
 * adaptation 15: share-actions.ts stays #293's). Reading needs a session;
 * every write needs Send (the drawings and the zip are what the client
 * link shows), answered with a message, never requirePerm's redirect.
 */

export async function addPackageFileAction(quoteId: string, input: { uploadKey: string; blobPath: string; fileName: string; kind: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  try {
    const r = await finalizePackageFileUpload(String(quoteId || ""), input, user.name);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  } catch (e) {
    console.error("[package] add drawing failed", e);
    return { ok: false, error: PACKAGE_FILES_COPY.failed };
  }
}

export async function removePackageFileAction(quoteId: string, fileId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  try {
    const r = await removePackageFileAndBlob(String(quoteId || ""), String(fileId || ""));
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  } catch (e) {
    console.error("[package] remove drawing failed", e);
    return { ok: false, error: PACKAGE_FILES_COPY.failed };
  }
}
