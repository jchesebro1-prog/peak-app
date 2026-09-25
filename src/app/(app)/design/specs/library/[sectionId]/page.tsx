import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import * as Sections from "@/lib/stores/spec-sections";
import * as Articles from "@/lib/stores/spec-articles";
import * as Catalog from "@/lib/stores/catalog";
import { articleIdForPart } from "@/lib/specs/articles";
import SectionEditor from "./editor";

/**
 * Task 9 — the section editor's server shell: loads the section (404 when
 * it doesn't exist or was deleted), its Part 2 category articles, and a
 * per-article catalog part count (so the editor can warn before a Remove
 * that deleteArticleAction would refuse anyway). All editing lives in the
 * client component; this route only reads.
 */

export const metadata = { title: "Spec section — Quartzite-6" };

export default async function SpecSectionPage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  const [, { sectionId }] = await Promise.all([requireUser(), params]);

  const section = await Sections.getSection(sectionId);
  if (!section) notFound();

  const [articles, parts] = await Promise.all([
    Articles.articlesForSection(section.id),
    Catalog.list(),
  ]);

  const partCounts: Record<string, number> = {};
  for (const p of parts) {
    const articleId = articleIdForPart(p, articles, [section]);
    if (articleId) partCounts[articleId] = (partCounts[articleId] || 0) + 1;
  }

  return <SectionEditor section={section} articles={articles} partCounts={partCounts} />;
}
