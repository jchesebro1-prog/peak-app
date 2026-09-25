import { upsertDoc } from "@/db/doc-store";
import * as Sections from "@/lib/stores/spec-sections";
import * as Articles from "@/lib/stores/spec-articles";
import * as Templates from "@/lib/stores/spec-templates";
import * as Curtains from "@/lib/stores/spec-curtain-templates";
import { ensureStarterTemplates } from "@/lib/stores/spec-templates";
import { normalizeSection, type RawSpecSection, type SpecSection } from "@/lib/specs/sections";
import { normalizeArticle, type SpecCategoryArticle } from "@/lib/specs/articles";
import type { SpecTemplate } from "@/lib/stores/spec-templates";
import type { SpecCurtainTemplate } from "@/lib/stores/spec-curtain-templates";
import { GRID_CURTAIN_TYPES, type GridCurtainType } from "@/lib/design/grid-bom";

/**
 * Whole-library export/import (Task 11). One JSON file carries all four
 * library collections — sections, Part 2 articles, authoring formulas and
 * curtain templates — so the `spec-writer` skill and a Jeff-to-Jeff library
 * transfer both go through one artifact rather than the columnar Import hub
 * (a four-collection document is not a table; see "Decisions this plan
 * takes" #1).
 */

export const SPEC_LIBRARY_KIND = "peak-spec-library" as const;
export const SPEC_LIBRARY_VERSION = 1 as const;

export type SpecLibraryFile = {
  kind: typeof SPEC_LIBRARY_KIND;
  version: typeof SPEC_LIBRARY_VERSION;
  exportedAt: number;
  sections: SpecSection[];
  articles: SpecCategoryArticle[];
  templates: SpecTemplate[];
  curtainTemplates: SpecCurtainTemplate[];
};

export type SpecLibraryImportCounts = {
  sections: number;
  articles: number;
  templates: number;
  curtainTemplates: number;
  /** Curtain templates whose id is not a GRID_CURTAIN_TYPES entry — refused, never coerced. */
  skipped: number;
};

/**
 * Owner decision 4: the file handed to the `spec-writer` skill must carry
 * the formulas even on a hosted database that was never dev-seeded, so the
 * export always seeds the starter templates/curtain templates first.
 */
export async function exportLibrary(): Promise<SpecLibraryFile> {
  await ensureStarterTemplates();
  const [sections, articles, templates, curtainTemplates] = await Promise.all([
    Sections.allSections(),
    Articles.allArticles(),
    Templates.allTemplates(),
    Curtains.allCurtainTemplates(),
  ]);
  return {
    kind: SPEC_LIBRARY_KIND,
    version: SPEC_LIBRARY_VERSION,
    exportedAt: Date.now(),
    sections,
    articles,
    templates,
    curtainTemplates,
  };
}

/** Never throws — junk text or a foreign file is reported as `error`, not thrown. */
export function parseLibraryFile(text: string): { file: SpecLibraryFile | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { file: null, error: "That file is not valid JSON." };
  }
  if (!parsed || typeof parsed !== "object") {
    return { file: null, error: "That file is not a Peak spec library." };
  }
  const o = parsed as Record<string, unknown>;
  if (o.kind !== SPEC_LIBRARY_KIND) {
    return { file: null, error: "That file is not a Peak spec library." };
  }
  if (o.version !== SPEC_LIBRARY_VERSION) {
    return { file: null, error: `Unknown spec library version — this app reads version ${SPEC_LIBRARY_VERSION}.` };
  }
  // A skill-produced file may carry only some of the four collections —
  // missing arrays default to [] rather than failing the parse.
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const file: SpecLibraryFile = {
    kind: SPEC_LIBRARY_KIND,
    version: SPEC_LIBRARY_VERSION,
    exportedAt: Number(o.exportedAt) || 0,
    sections: arr(o.sections) as SpecSection[],
    articles: arr(o.articles) as SpecCategoryArticle[],
    templates: arr(o.templates) as SpecTemplate[],
    curtainTemplates: arr(o.curtainTemplates) as SpecCurtainTemplate[],
  };
  return { file, error: null };
}

/**
 * Upserts each record under the id the FILE gives it. Never deletes — an
 * import adds and updates, so a partial file from the skill cannot destroy
 * the library. `upsertDoc` revives a soft-deleted id (its onConflictDoUpdate
 * sets deleted: false — src/db/doc-store.ts:83), so re-importing a file
 * restores a record someone deleted, which is the point of importing a
 * whole library.
 */
export async function importLibrary(file: SpecLibraryFile, by: string): Promise<SpecLibraryImportCounts> {
  const now = Date.now();
  let sections = 0;
  let articles = 0;
  let templates = 0;
  let curtainTemplates = 0;
  let skipped = 0;

  for (const rec of file.sections) {
    const id = String((rec as { id?: unknown }).id || "").trim();
    if (!id) {
      skipped++;
      continue;
    }
    const existing = await Sections.getSection(id);
    if (existing) {
      const { number, title, sort, part1, part3, part2Style, quantities } = rec;
      await Sections.updateSection(id, { number, title, sort, part1, part3, part2Style, quantities }, by);
    } else {
      const normalized = normalizeSection({ ...(rec as RawSpecSection), id, updatedAt: now, updatedBy: by });
      await upsertDoc<SpecSection>("spec_sections", normalized);
    }
    sections++;
  }

  for (const rec of file.articles) {
    // Never through Articles.createArticle, which mints a new id — a new id
    // would break every catalog part's specArticleId link to this article
    // and duplicate the article on every re-import.
    const normalized = normalizeArticle({ ...rec, updatedAt: now, updatedBy: by });
    if (!normalized.id || !normalized.sectionId) {
      skipped++;
      continue;
    }
    const existing = await Articles.getArticle(normalized.id);
    if (existing) {
      await Articles.updateArticle(normalized.id, normalized, by);
    } else {
      await upsertDoc<SpecCategoryArticle>("spec_articles", normalized);
    }
    articles++;
  }

  for (const rec of file.templates) {
    // Templates.saveTemplate is already keyed by slug, so it is idempotent.
    await Templates.saveTemplate(
      { key: rec.key, title: rec.title, headings: rec.headings, rules: rec.rules, example: rec.example },
      by
    );
    templates++;
  }

  for (const rec of file.curtainTemplates) {
    // Skip an id that isn't a GRID_CURTAIN_TYPES entry — the store's own
    // normalize() would otherwise coerce it to "Border" and silently
    // overwrite the Border template.
    if (!GRID_CURTAIN_TYPES.includes(rec.id as GridCurtainType)) {
      skipped++;
      continue;
    }
    await Curtains.saveCurtainTemplate(
      {
        id: rec.id,
        articleId: rec.articleId,
        sort: rec.sort,
        title: rec.title,
        body: rec.body,
        fullnessClauses: rec.fullnessClauses,
        hang: rec.hang,
        defaultColor: rec.defaultColor,
      },
      by
    );
    curtainTemplates++;
  }

  return { sections, articles, templates, curtainTemplates, skipped };
}
