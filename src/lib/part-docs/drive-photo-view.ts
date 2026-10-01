/**
 * #283 — pure view model for the Catalog → Datasheets "Drive photos" panel,
 * and the daily cron rider's budget rule. No stores, no network.
 */
import { hasDriveReadScope } from "@/lib/gmail/config";
import type { DrivePhotoSyncState } from "./drive-photo-sync";

export type DrivePhotosPanelView = {
  configured: boolean;
  account: string | null;
  problem: string | null;
  folder: { name: string; webViewLink: string } | null;
  lastRun: { at: number; imported: number; updated: number; relinked: number; failed: number; complete: boolean; error: string | null } | null;
  unmatched: { fileId: string; name: string; webViewLink: string; reason: string }[];
  synced: number;
  /** Set when the status reads failed — the panel shows this instead of the controls. */
  loadError?: string;
};

export function drivePhotosPanelView(input: {
  mailboxKey: string | null;
  connection: { address: string; scope: string | null } | null;
  state: Pick<DrivePhotoSyncState, "folder" | "files" | "lastRun">;
}): DrivePhotosPanelView {
  const { mailboxKey, connection, state } = input;
  const problem = !mailboxKey
    ? null
    : !connection
      ? "The photos account isn't connected any more — reconnect it in Settings → Mailboxes."
      : !hasDriveReadScope(connection.scope)
        ? `${connection.address} needs read-only Drive access — use "Enable Drive photos" in Settings → Mailboxes.`
        : null;
  const lr = state.lastRun;
  return {
    configured: !!mailboxKey,
    account: connection?.address ?? mailboxKey,
    problem,
    folder: state.folder ? { name: state.folder.name, webViewLink: state.folder.webViewLink } : null,
    lastRun: lr ? { at: lr.at, imported: lr.imported, updated: lr.updated, relinked: lr.relinked, failed: lr.failed, complete: lr.complete, error: lr.error ?? null } : null,
    unmatched: (lr?.unmatched ?? []).map((u) => ({ fileId: u.fileId, name: u.name, webViewLink: u.webViewLink, reason: u.reason })),
    synced: Object.values(state.files).filter((f) => !!f.documentId).length,
  };
}

/** The degraded panel when reading its status failed — the page still renders. */
export function drivePhotosLoadErrorView(message: string): DrivePhotosPanelView {
  return { configured: false, account: null, problem: null, folder: null, lastRun: null, unmatched: [], synced: 0, loadError: message };
}

/** Daily cron rider budget: what's left before the caller's cutoff (45 s in the cron route), capped at 20 s;
 *  skipped entirely under 10 s (one photo needs a few seconds). */
export function cronPhotoBudgetMs(msLeft: number): number {
  if (msLeft < 10_000) return 0;
  return Math.min(20_000, msLeft);
}
