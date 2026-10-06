"use server";

import { finalizePackageFileUpload, removePackageFileAndBlob } from "@/lib/estimate-output/package-files-server";
import { PACKAGE_FILES_COPY } from "@/lib/estimate-output/package-files";
import { clearPackageZipCache } from "@/lib/estimate-output/package-zip-server";
import { loadPackagePanel, type PackagePanel } from "@/lib/estimate-output/package-panel-server";
import { ONLINE_COPY } from "@/lib/quote-share/view";
import { requireUser } from "@/lib/session";
import { get as getQuote } from "@/lib/stores/quotes";
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

/** The panel's read: any signed-in user; Send decides which buttons work. */
export async function packagePanelAction(quoteId: string): Promise<{ ok: true; panel: PackagePanel } | { ok: false; error: string }> {
  const user = await requireUser();
  try {
    const q = await getQuote(String(quoteId || ""));
    if (!q) return { ok: false, error: ONLINE_COPY.gone };
    return { ok: true, panel: await loadPackagePanel(q, can("send", user.roles)) };
  } catch (e) {
    console.error("[package] panel read failed", e);
    return { ok: false, error: PACKAGE_FILES_COPY.failed };
  }
}

/** R10 — "Rebuild package": the next download builds a fresh zip. */
export async function rebuildPackageZipAction(quoteId: string): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  try {
    const q = await getQuote(String(quoteId || ""));
    if (!q) return { ok: false, error: ONLINE_COPY.gone };
    return { ok: true, removed: await clearPackageZipCache(q.id) };
  } catch (e) {
    console.error("[package] rebuild failed", e);
    return { ok: false, error: PACKAGE_FILES_COPY.failed };
  }
}
