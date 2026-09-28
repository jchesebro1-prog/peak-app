import { requirePerm } from "@/lib/session";
import { allSpecIdsEverUsed, allSpecRecords } from "@/lib/stores/spec-records";
import { allSections } from "@/lib/stores/spec-sections";
import { allArticles } from "@/lib/stores/spec-articles";
import { csiKey } from "@/lib/specs/articles";
import { nextSpecIdFor, type SpecRecord } from "@/lib/specs/records";
import RecordEditor, { type EditorArticle, type EditorOther, type EditorSection } from "../[specId]/record-editor";

/**
 * Spec records Task 10 — a new spec record (design §7). Defaults: kind
 * Product – catalog, status Ready. The Spec ID is read-only: it previews as
 * the section's next free number once a section is chosen (`nextIds`), and
 * the server allocates the real one at save time. An
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
  // Creating is a write — without `create` there's nothing to do here (the
  // records view hides New spec; requirePerm redirects a typed URL home).
  const [, sp] = await Promise.all([requirePerm("create"), searchParams]);
  const [sections, articles, records, usedIds] = await Promise.all([
    allSections(),
    allArticles(),
    allSpecRecords(),
    allSpecIdsEverUsed(),
  ]);

  // One list of every id ever used, then the pure allocator per section —
  // a preview only; the server allocates again at save time.
  const nextIds: Record<string, string> = Object.fromEntries(sections.map((s) => [s.number, nextSpecIdFor(s.number, usedIds)]));

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
      canCreate
    />
  );
}
