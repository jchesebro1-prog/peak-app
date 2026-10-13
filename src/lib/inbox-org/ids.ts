/**
 * Inbox organization §7 — deterministic promise-task ids, so a re-sync never
 * duplicates a task: `T-prm-` + a short stable hash of thread id, message id
 * and the promise text (whitespace collapsed, lower-cased). Same hash as the
 * meeting tasks' `T-mtg-` ids. Pure.
 */
import { shortHash } from "@/lib/krisp/derive";

export function promiseTaskId(threadId: string, messageId: string, text: string): string {
  const norm = String(text ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return `T-prm-${shortHash(JSON.stringify([String(threadId ?? ""), String(messageId ?? ""), norm]))}`;
}
