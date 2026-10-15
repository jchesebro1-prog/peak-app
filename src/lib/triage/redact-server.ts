/**
 * #341 — an admin viewing a teammate's Start here: email rows the viewer
 * can't see under canSeeThread come back as "Private email" (thread-access.ts
 * redactEmailRows). Runs on the server, before the rows reach the client
 * component, so the subject / customer never leave the server. A thread
 * that's gone (or tombstoned) is redacted too.
 */
import { getDocRows } from "@/db/doc-store";
import { mailboxViewer } from "@/lib/mailbox-viewer";
import type { CommThread } from "@/lib/stores/comms";
import { emailRowThreadId, redactEmailRows } from "./thread-access";
import type { SnapshotRow } from "./types";

export async function redactRowsForViewer(rows: readonly SnapshotRow[], viewer: { id: string; name: string }): Promise<SnapshotRow[]> {
  const ids = rows.map(emailRowThreadId).filter((x): x is string => !!x);
  const found = ids.length ? await getDocRows<CommThread>("comms", ids) : [];
  const threads = new Map(found.filter((x) => !x.deleted).map((x) => [x.id, x.doc]));
  return redactEmailRows(rows, threads, await mailboxViewer(viewer));
}
