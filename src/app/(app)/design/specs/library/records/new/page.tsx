import { requireUser } from "@/lib/session";
import { allSpecRecords, nextSpecId } from "@/lib/stores/spec-records";
import { allSections } from "@/lib/stores/spec-sections";
import { allArticles } from "@/lib/stores/spec-articles";
import { csiKey } from "@/lib/specs/articles";
import type { SpecRecord } from "@/lib/specs/records";
import RecordEditor, { type EditorArticle, type EditorOther, type EditorSection } from "../[specId]/record-editor";

/**
 * Spec records Task 10 — a new spec record (design §7). Defaults: kind
 * Product – catalog, status Ready. The Spec ID previews as the section's
 * next free number once a section is chosen (`nextIds`); the server takes
 * the next free number at save time, so the preview never collides. An
 * optional `?section=<CSI number>` preselects the section.
 */

export const metadata = { title: "New spec record — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function NewSpecRecordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  const [sections, articles, records] = await Promise.all([allSections(), allArticles(), allSpecRecords()]);

  const nextIds: Record<string, string> = Object.fromEntries(
    await Promise.all(sections.map(async (s) => [s.number, await nextSpecId(s.number)] as const))
  );

  const wanted = csiKey(one(sp.section));
  const preselect = wanted ? sections.find((s) => csiKey(s.number) === wanted)?.number ?? "" : "";

  const blank: SpecRecord = {
    specId: "",
    kind: "product_catalog",
    status: "ready",
    section: preselect,
    article: "",
    title: "",
    basisOfDesign: null,
    manufacturer: null,
    mfrNumbers: [],
    matchKey: null,
    includeWith: [],
    specText: "",
    notes: null,
    sourceArticleId: null,
    revision: 1,
    updatedAt: 0,
    updatedBy: "",
  };

  return (
    <RecordEditor
      mode="new"
      record={blank}
      history={[]}
      sections={sections.map((s): EditorSection => ({ id: s.id, number: s.number, title: s.title }))}
      articles={articles.map((a): EditorArticle => ({ id: a.id, sectionId: a.sectionId, title: a.title, sort: a.sort }))}
      others={records.map((r): EditorOther => ({ specId: r.specId, title: r.title, kind: r.kind, status: r.status, mfrNumbers: r.mfrNumbers, matchKey: r.matchKey }))}
      nextIds={nextIds}
    />
  );
}
