import { getDoc, listDocs, listDocsByField, upsertDoc, type Doc } from "@/db/doc-store";
import { nextSpecIdFor, normalizeSpecRecord, sameSpecContent, type SpecRecord } from "@/lib/specs/records";

/**
 * Spec Library records store (spec 2026-09-28-spec-records-design.md §1.2) —
 * server side of `spec_records` + `spec_record_revisions`. A record is
 * written once per product/system/companion spec and edited from the
 * builder or the Spec Library screen; every edit keeps the prior version so
 * history never shrinks (`restoreSpecRecordRevision` is itself a new
 * revision, not a rewind).
 *
 * Records are stored with `id = specId` in `spec_records`. Each past
 * revision is a row in `spec_record_revisions` with
 * `id = "${specId}@${revision}"`, so a specId's history sorts by revision
 * and no two saves can collide on the same past version.
 */

export type SpecRecordRevision = {
  id: string;
  specId: string;
  revision: number;
  record: SpecRecord;
  savedAt: number;
  savedBy: string;
  why: string;
};

export type SaveOutcome = "created" | "updated" | "unchanged";

function toRecord(doc: Doc): SpecRecord {
  // Stored docs are already normalized SpecRecords (saveSpecRecord only ever
  // writes normalizeSpecRecord's output) — normalize again defensively so a
  // record written by an older shape still reads back cleanly.
  return normalizeSpecRecord(doc)!;
}

export async function getSpecRecord(specId: string): Promise<SpecRecord | null> {
  const doc = await getDoc<Doc>("spec_records", specId);
  return doc ? toRecord(doc) : null;
}

export async function allSpecRecords(): Promise<SpecRecord[]> {
  const docs = await listDocs<Doc>("spec_records");
  return docs.map(toRecord).sort((a, b) => (a.specId < b.specId ? -1 : a.specId > b.specId ? 1 : 0));
}

export async function saveSpecRecord(
  next: SpecRecord,
  by: string,
  why: string
): Promise<{ outcome: SaveOutcome; record: SpecRecord }> {
  const normalized = normalizeSpecRecord(next);
  if (!normalized) throw new Error("saveSpecRecord: invalid spec record");

  const current = await getSpecRecord(normalized.specId);
  const now = Date.now();

  if (!current) {
    const created: SpecRecord = { ...normalized, revision: 1, updatedAt: now, updatedBy: by };
    await upsertDoc<SpecRecord & Doc>("spec_records", { ...created, id: created.specId });
    return { outcome: "created", record: created };
  }

  if (sameSpecContent(current, normalized)) {
    return { outcome: "unchanged", record: current };
  }

  const revisionId = `${current.specId}@${current.revision}`;
  const revisionDoc: SpecRecordRevision & Doc = {
    id: revisionId,
    specId: current.specId,
    revision: current.revision,
    record: current,
    savedAt: now,
    savedBy: by,
    why,
  };
  await upsertDoc<SpecRecordRevision & Doc>("spec_record_revisions", revisionDoc);

  const updated: SpecRecord = { ...normalized, revision: current.revision + 1, updatedAt: now, updatedBy: by };
  await upsertDoc<SpecRecord & Doc>("spec_records", { ...updated, id: updated.specId });
  return { outcome: "updated", record: updated };
}

export async function specRecordRevisions(specId: string): Promise<SpecRecordRevision[]> {
  const rows = await listDocsByField<SpecRecordRevision & Doc>("spec_record_revisions", "specId", [specId]);
  return rows
    .map((r) => ({ ...r, record: normalizeSpecRecord(r.record) ?? r.record }))
    .sort((a, b) => b.revision - a.revision);
}

export async function restoreSpecRecordRevision(
  specId: string,
  revision: number,
  by: string
): Promise<{ ok: true; record: SpecRecord } | { ok: false; error: string }> {
  const revisionDoc = await getDoc<SpecRecordRevision & Doc>("spec_record_revisions", `${specId}@${revision}`);
  if (!revisionDoc) return { ok: false, error: `No revision ${revision} found for ${specId}.` };
  const current = await getSpecRecord(specId);
  if (!current) return { ok: false, error: `Spec record ${specId} no longer exists.` };

  const restored = normalizeSpecRecord(revisionDoc.record);
  if (!restored) return { ok: false, error: `Revision ${revision} of ${specId} is not a valid spec record.` };

  const result = await saveSpecRecord(
    { ...restored, specId },
    by,
    `Restored revision ${revision}`
  );
  return { ok: true, record: result.record };
}

export async function nextSpecId(sectionNumber: string): Promise<string> {
  const all = await listDocs<Doc>("spec_records", { includeDeleted: true });
  return nextSpecIdFor(sectionNumber, all.map((d) => d.id));
}
