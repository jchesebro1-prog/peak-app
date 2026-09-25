"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import * as Sections from "@/lib/stores/spec-sections";
import * as Articles from "@/lib/stores/spec-articles";
import * as Templates from "@/lib/stores/spec-templates";
import * as Curtains from "@/lib/stores/spec-curtain-templates";
import { list as listCatalog } from "@/lib/stores/catalog";
import { adoptAllLegacySpecPointers } from "@/lib/specs/legacy-pointers";
import { importLibrary, parseLibraryFile } from "@/lib/specs/library-io";
import type { SpecArticle, SpecPart2Style, SpecQuantities } from "@/lib/specs/sections";
import type { SpecCurtainTemplate } from "@/lib/stores/spec-curtain-templates";
import { GRID_CURTAIN_TYPES, type GridCurtainType } from "@/lib/design/grid-bom";

/**
 * Server actions for the Specs module shell (Task 8). Names are prefixed
 * `Library`/module-specific to avoid colliding with D94's
 * design/engagements/spec/actions.ts, which already exports
 * createSectionAction/updateSectionAction/seedSectionsAction.
 */

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

function revalidate(sectionId?: string) {
  revalidatePath("/design/specs/library");
  if (sectionId) revalidatePath(`/design/specs/library/${sectionId}`);
}

export async function createLibrarySectionAction(input: {
  number: string;
  title: string;
  sort?: number;
}): Promise<Result<{ id: string }>> {
  const user = await requirePerm("create");
  const number = String(input.number || "").trim();
  const title = String(input.title || "").trim();
  if (!number) return { ok: false, error: "A section needs a CSI number." };
  if (!title) return { ok: false, error: "A section needs a title." };
  try {
    const rec = await Sections.createSection({ number, title, sort: input.sort, by: user.name });
    revalidate();
    return { ok: true, id: rec.id };
  } catch (e) {
    console.error("createLibrarySectionAction", e);
    return { ok: false, error: "Could not create the section. Try again." };
  }
}

export async function saveLibrarySectionAction(
  id: string,
  patch: {
    number?: string;
    title?: string;
    sort?: number;
    part1?: SpecArticle[];
    part3?: SpecArticle[];
    part2Style?: SpecPart2Style;
    quantities?: SpecQuantities;
  }
): Promise<Result> {
  const user = await requirePerm("create");
  if (!id) return { ok: false, error: "A section is required." };
  try {
    await Sections.updateSection(id, patch, user.name);
    revalidate(id);
    return { ok: true };
  } catch (e) {
    console.error("saveLibrarySectionAction", e);
    return { ok: false, error: "Could not save the section. Try again." };
  }
}

export async function seedLibrarySectionsAction(): Promise<Result<{ made: number }>> {
  const user = await requirePerm("create");
  try {
    const made = await Sections.seedStarterSections(user.name);
    revalidate();
    return { ok: true, made };
  } catch (e) {
    console.error("seedLibrarySectionsAction", e);
    return { ok: false, error: "Could not add the starter sections. Try again." };
  }
}

export async function removeLibrarySectionAction(id: string): Promise<Result> {
  await requirePerm("create");
  if (!id) return { ok: false, error: "A section is required." };
  try {
    const [parts, articles] = await Promise.all([listCatalog(), Articles.articlesForSection(id)]);
    const usedParts = parts.filter((p) => p.specSectionId === id);
    if (usedParts.length) {
      return {
        ok: false,
        error: `${usedParts.length} part${usedParts.length === 1 ? "" : "s"} still print in this section — move them first.`,
      };
    }
    if (articles.length) {
      return {
        ok: false,
        error: `This section still holds ${articles.length} Part 2 article${articles.length === 1 ? "" : "s"} — delete or move them first.`,
      };
    }
    await Sections.removeSection(id);
    revalidate();
    return { ok: true };
  } catch (e) {
    console.error("removeLibrarySectionAction", e);
    return { ok: false, error: "Could not delete the section. Try again." };
  }
}

export async function adoptLegacyPointersAction(): Promise<Result<{ adopted: number; unresolved: number }>> {
  await requirePerm("create");
  try {
    const { adopted, unresolved } = await adoptAllLegacySpecPointers();
    revalidate();
    revalidatePath("/catalog");
    return { ok: true, adopted, unresolved };
  } catch (e) {
    console.error("adoptLegacyPointersAction", e);
    return { ok: false, error: "Could not adopt the legacy pointers. Try again." };
  }
}

export async function createArticleAction(input: {
  sectionId: string;
  title: string;
  sort?: number;
}): Promise<Result<{ id: string }>> {
  const user = await requirePerm("create");
  const sectionId = String(input.sectionId || "").trim();
  const title = String(input.title || "").trim();
  if (!sectionId) return { ok: false, error: "An article needs a section." };
  if (!title) return { ok: false, error: "An article needs a title." };
  try {
    const rec = await Articles.createArticle({ sectionId, title, sort: input.sort }, user.name);
    revalidate(sectionId);
    return { ok: true, id: rec.id };
  } catch (e) {
    console.error("createArticleAction", e);
    return { ok: false, error: "Could not create the article. Try again." };
  }
}

export async function updateArticleAction(
  id: string,
  patch: {
    title?: string;
    sort?: number;
    manufacturers?: string[];
    general?: string;
    categoryKeys?: string[];
    sectionId?: string;
  }
): Promise<Result> {
  const user = await requirePerm("create");
  if (!id) return { ok: false, error: "An article is required." };
  try {
    await Articles.updateArticle(id, patch, user.name);
    revalidate(patch.sectionId);
    return { ok: true };
  } catch (e) {
    console.error("updateArticleAction", e);
    return { ok: false, error: "Could not save the article. Try again." };
  }
}

export async function deleteArticleAction(id: string): Promise<Result> {
  await requirePerm("create");
  if (!id) return { ok: false, error: "An article is required." };
  try {
    const parts = await listCatalog();
    const used = parts.filter((p) => p.specArticleId === id);
    if (used.length) {
      return { ok: false, error: `${used.length} part${used.length === 1 ? "" : "s"} still print under this article — move them first.` };
    }
    const article = await Articles.getArticle(id);
    await Articles.deleteArticle(id);
    revalidate(article?.sectionId);
    return { ok: true };
  } catch (e) {
    console.error("deleteArticleAction", e);
    return { ok: false, error: "Could not delete the article. Try again." };
  }
}

export async function saveTemplateAction(input: {
  key: string;
  title: string;
  headings: Array<{ label: string; guidance: string }>;
  rules: string;
  example: string;
}): Promise<Result<{ id: string }>> {
  const user = await requirePerm("create");
  const key = String(input.key || "").trim();
  const title = String(input.title || "").trim();
  if (!key) return { ok: false, error: "A template needs a key." };
  if (!title) return { ok: false, error: "A template needs a title." };
  try {
    const rec = await Templates.saveTemplate(
      { key, title, headings: input.headings || [], rules: input.rules || "", example: input.example || "" },
      user.name
    );
    revalidate();
    return { ok: true, id: rec.id };
  } catch (e) {
    console.error("saveTemplateAction", e);
    return { ok: false, error: "Could not save the template. Try again." };
  }
}

export async function deleteTemplateAction(id: string): Promise<Result> {
  await requirePerm("create");
  if (!id) return { ok: false, error: "A template is required." };
  try {
    await Templates.deleteTemplate(id);
    revalidate();
    return { ok: true };
  } catch (e) {
    console.error("deleteTemplateAction", e);
    return { ok: false, error: "Could not delete the template. Try again." };
  }
}

export async function seedTemplatesAction(): Promise<Result<{ made: number }>> {
  const user = await requirePerm("create");
  try {
    const made =
      (await Templates.seedStarterTemplates(user.name)) + (await Curtains.seedStarterCurtainTemplates(user.name));
    revalidate();
    return { ok: true, made };
  } catch (e) {
    console.error("seedTemplatesAction", e);
    return { ok: false, error: "Could not add the starter templates. Try again." };
  }
}

export async function saveCurtainTemplateAction(input: {
  id: string;
  articleId: string;
  sort: number;
  title: string;
  body: string;
  fullnessClauses: Record<string, string>;
  hang: string;
  defaultColor: string;
}): Promise<Result> {
  const user = await requirePerm("create");
  const title = String(input.title || "").trim();
  if (!title) return { ok: false, error: "A curtain template needs a title." };
  if (!GRID_CURTAIN_TYPES.includes(input.id as GridCurtainType)) {
    return { ok: false, error: "Unknown curtain type." };
  }
  try {
    await Curtains.saveCurtainTemplate(
      {
        id: input.id as GridCurtainType,
        articleId: input.articleId,
        sort: input.sort,
        title,
        body: input.body,
        fullnessClauses: input.fullnessClauses as SpecCurtainTemplate["fullnessClauses"],
        hang: input.hang,
        defaultColor: input.defaultColor,
      },
      user.name
    );
    revalidate();
    return { ok: true };
  } catch (e) {
    console.error("saveCurtainTemplateAction", e);
    return { ok: false, error: "Could not save the curtain template. Try again." };
  }
}

export async function importLibraryAction(text: string): Promise<
  Result<{ sections: number; articles: number; templates: number; curtainTemplates: number; skipped: number }>
> {
  const user = await requirePerm("create");
  const { file, error } = parseLibraryFile(text);
  if (!file) return { ok: false, error: error || "That file is not a Peak spec library." };
  try {
    const counts = await importLibrary(file, user.name);
    revalidate();
    return { ok: true, ...counts };
  } catch (e) {
    console.error("importLibraryAction", e);
    return { ok: false, error: "Could not import the library. Nothing was changed after the last record it reported." };
  }
}
