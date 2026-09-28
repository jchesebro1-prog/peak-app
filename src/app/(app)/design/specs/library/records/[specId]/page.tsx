import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { allSpecRecords, getSpecRecord, specRecordRevisions } from "@/lib/stores/spec-records";
import { allSections } from "@/lib/stores/spec-sections";
import { allArticles } from "@/lib/stores/spec-articles";
import { specRecordHistory } from "@/lib/specs/records";
import RecordEditor, { type EditorArticle, type EditorHistoryEntry, type EditorOther, type EditorSection } from "./record-editor";

/**
 * Spec records Task 10 — one spec record's editor (design §7): every field,
 * kind-aware, a why-note on save, and the revision history with Restore.
 * This server shell only reads; saving and restoring go through
 * `record-actions.ts` (create-gated).
 */

export const metadata = { title: "Spec record — Quartzite-6" };

function fmtWhen(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}

export default async function SpecRecordPage({ params }: { params: Promise<{ specId: string }> }) {
  const [, { specId: rawId }] = await Promise.all([requireUser(), params]);
  let specId = rawId;
  try {
    specId = decodeURIComponent(rawId);
  } catch {
    // Already decoded (or malformed) — use as given.
  }

  const record = await getSpecRecord(specId);
  if (!record) notFound();

  const [sections, articles, records, revisions] = await Promise.all([
    allSections(),
    allArticles(),
    allSpecRecords(),
    specRecordRevisions(record.specId),
  ]);

  const history: EditorHistoryEntry[] = specRecordHistory(record, revisions).map((h) => ({
    revision: h.revision,
    atLabel: fmtWhen(h.at),
    by: h.by,
    why: h.why,
    current: h.current,
    record: h.record,
  }));

  return (
    <RecordEditor
      mode="edit"
      record={record}
      history={history}
      sections={sections.map((s): EditorSection => ({ id: s.id, number: s.number, title: s.title }))}
      articles={articles.map((a): EditorArticle => ({ id: a.id, sectionId: a.sectionId, title: a.title, sort: a.sort }))}
      others={records
        .filter((r) => r.specId !== record.specId)
        .map((r): EditorOther => ({ specId: r.specId, title: r.title, kind: r.kind, status: r.status, mfrNumbers: r.mfrNumbers, matchKey: r.matchKey }))}
      nextIds={{}}
    />
  );
}
