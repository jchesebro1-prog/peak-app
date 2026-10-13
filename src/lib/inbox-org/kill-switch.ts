/**
 * Inbox organization (#335, D900) — the emergency off switch for the
 * behaviour everyone sees. `INBOX_ORG_DISABLED=true` turns off:
 *  - the import hook (`organizeAfterImport`: court / filing / noise / status
 *    on new Gmail mail, and the teammate-reply archive);
 *  - the post-reply step (`runPostReply` → `afterOwnReply` /
 *    `archiveAfterReply`: archive-on-reply in the app and Gmail);
 *  - the archive on Mark replied / Close (`setStatusAction`);
 *  - the AI pass (`runAiPass`, and its scheduling on Inbox ticks).
 * Hand actions in the Organize view (Approve, Change…, Noise, Undo) and the
 * person's own status change still work. Pure.
 */
export function inboxOrgDisabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.INBOX_ORG_DISABLED || "").trim().toLowerCase() === "true";
}
