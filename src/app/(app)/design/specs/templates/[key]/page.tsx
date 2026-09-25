import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import * as Templates from "@/lib/stores/spec-templates";
import * as Curtains from "@/lib/stores/spec-curtain-templates";
import * as Sections from "@/lib/stores/spec-sections";
import * as Articles from "@/lib/stores/spec-articles";
import { GRID_CURTAIN_TYPES, type GridCurtainType } from "@/lib/design/grid-bom";
import { CurtainTemplateEditor, TemplateEditor, type CurtainTemplateArticleOption } from "../editor";

/**
 * Task 10 — the template editor's server shell. A segment starting
 * `curtain-` loads the curtain template for that Grid type; anything else
 * is a formula key (its id is `templateId(key)`, already the slug this
 * segment is). 404s when neither record exists.
 */

export const metadata = { title: "Spec template — Quartzite-6" };

const CURTAIN_PREFIX = "curtain-";

export default async function SpecTemplatePage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const [, { key }] = await Promise.all([requireUser(), params]);

  if (key.startsWith(CURTAIN_PREFIX)) {
    const type = key.slice(CURTAIN_PREFIX.length);
    if (!GRID_CURTAIN_TYPES.includes(type as GridCurtainType)) notFound();
    const template = await Curtains.getCurtainTemplate(type as GridCurtainType);
    if (!template) notFound();

    const [sections, articles] = await Promise.all([Sections.allSections(), Articles.allArticles()]);
    const sectionNumberById = new Map(sections.map((s) => [s.id, s.number]));
    const articleOptions: CurtainTemplateArticleOption[] = articles
      .map((a) => ({ id: a.id, title: a.title, sectionNumber: sectionNumberById.get(a.sectionId) || "" }))
      .sort((a, b) => a.sectionNumber.localeCompare(b.sectionNumber) || a.title.localeCompare(b.title));

    return <CurtainTemplateEditor template={template} articles={articleOptions} />;
  }

  const template = await Templates.getTemplate(key);
  if (!template) notFound();

  return <TemplateEditor template={template} />;
}
