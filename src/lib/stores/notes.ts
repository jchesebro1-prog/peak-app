import { listDocs, nextPrefixedId, softDeleteDoc, upsertDoc } from "@/db/doc-store";

/**
 * Notes (#21) — the first REAL note record in the app (the three prior
 * "notes" are per-record fields: ProjectNote[] embedded in projects,
 * SurveyDraft.notes and SiteVisit.notes freeform strings). A NoteRecord is
 * attachable by design: `parentKind`/`parentId` name the record it hangs on,
 * and `customerId` is denormalized so the customer Activity feed reads notes
 * with one filter, no joins. The v1 composer (customer page) only writes
 * parentKind "customer" — the shape carries lead/project/quote now so later
 * surfaces need no migration.
 *
 * NOT syncable (server-action writes only — the engagements/site_visits
 * precedent; see the SYNCABLE_COLLECTIONS comment in doc-tables.ts).
 * nextPrefixedId is a racy max-scan; the single-user-ish composer makes
 * upsertDoc fine here (no insertDocIfAbsent — D121).
 */

export type NoteParentKind = "customer" | "lead" | "project" | "quote";

export type NoteRecord = {
  id: string; // 'N-####' (base 7000)
  parentKind: NoteParentKind;
  parentId: string;
  /** Denormalized customer link: customer-parent → parentId; other parents →
   *  their customerId when known, else null. The feed's one filter key. */
  customerId: string | null;
  by: string; // team-member NAME (app convention)
  at: number; // epoch-ms — the feed timestamp
  text: string;
  createdAt: number;
  updatedAt: number;
};

/** Normalize-on-read (#21). Exported for the spec harness — pure. */
export function normalizeNote(n: NoteRecord): NoteRecord {
  n.customerId = n.customerId ?? null;
  n.text = n.text ?? "";
  n.by = n.by ?? "";
  n.at = n.at ?? n.createdAt ?? 0;
  return n;
}

/** All notes, newest first. */
export async function allNotes(): Promise<NoteRecord[]> {
  const list = await listDocs<NoteRecord>("notes");
  return list.map(normalizeNote).sort((a, b) => (b.at || 0) - (a.at || 0));
}

/** The customer feed read — denormalized customerId, one filter. */
export async function notesForCustomer(customerId: string): Promise<NoteRecord[]> {
  return (await allNotes()).filter((n) => n.customerId === customerId);
}

export async function addNoteRecord(
  input: { parentKind: NoteParentKind; parentId: string; customerId: string | null; text: string },
  me: string
): Promise<NoteRecord> {
  const id = await nextPrefixedId("notes", "N", 7000);
  const t = Date.now();
  const n: NoteRecord = {
    id,
    parentKind: input.parentKind,
    parentId: input.parentId,
    customerId: input.customerId ?? null,
    by: me,
    at: t,
    text: input.text.trim(),
    createdAt: t,
    updatedAt: t,
  };
  await upsertDoc<NoteRecord>("notes", n);
  return n;
}

/** Soft delete (doc-store tombstone). */
export async function removeNote(id: string): Promise<void> {
  await softDeleteDoc("notes", id);
}
