import { upsertDoc } from "@/db/doc-store";
import * as Sections from "@/lib/stores/spec-sections";
import * as Articles from "@/lib/stores/spec-articles";
import * as Templates from "@/lib/stores/spec-templates";
import * as Curtains from "@/lib/stores/spec-curtain-templates";
import { ensureStarterTemplates, templateId } from "@/lib/stores/spec-templates";
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
 * Only the keys REC actually carries (own property, value not `undefined`)
 * — so a hand-trimmed or skill-produced file that omits a field leaves the
 * stored value alone instead of blanking it. A record's TS type (e.g.
 * `SpecSection[]`) declares every field required, but that's only checked at
 * compile time; the JSON a file on disk actually contains is whatever a
 * human or another tool wrote, and can omit any key.
 */
function presentFields<T extends object>(rec: unknown, keys: ReadonlyArray<keyof T>): Partial<T> {
  const o = (rec && typeof rec === "object" ? rec : {}) as Record<string, unknown>;
  const out: Partial<T> = {};
  for (const k of keys) {
    const key = k as string;
    if (Object.hasOwn(o, key) && o[key] !== undefined) {
      (out as Record<string, unknown>)[key] = o[key];
    }
  }
  return out;
}

/**
 * Upserts each record under the id the FILE gives it. Never deletes — an
 * import adds and updates, so a partial file from the skill cannot destroy
 * the library. `upsertDoc` revives a soft-deleted id (its onConflictDoUpdate
 * sets deleted: false — src/db/doc-store.ts:83), so re-importing a file
 * restores a record someone deleted, which is the point of importing a
 * whole library.
 *
 * "Partial" holds at the collection level (an import can carry only some of
 * the four collections, or only some records) AND at the field level within
 * a record that's UPDATING an existing one: every branch below only ever
 * writes a key the file actually carries (`presentFields`), so a record
 * missing e.g. `part1` on re-import keeps its stored `part1` rather than
 * having it defaulted to empty by the normalize-then-replace each store's
 * own save function would otherwise perform. A brand-new record still gets
 * every field, normalized with the store's own defaults for whatever it
 * omits — there's no stored value to preserve yet.
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
      const patch = presentFields<SpecSection>(rec, ["number", "title", "sort", "part1", "part3", "part2Style", "quantities"]);
      await Sections.updateSection(id, patch, by);
    } else {
      const normalized = normalizeSection({ ...(rec as RawSpecSection), id, updatedAt: now, updatedBy: by });
      await upsertDoc<SpecSection>("spec_sections", normalized);
    }
    sections++;
  }

  for (const rec of file.articles) {
    // id/sectionId read off the raw record (not normalizeArticle's output)
    // so an existing-record lookup never forces the full-normalize defaults
    // this loop used to apply on every re-import.
    const id = String((rec as { id?: unknown }).id || "").trim();
    const existing = id ? await Articles.getArticle(id) : null;
    if (existing) {
      const patch = presentFields<SpecCategoryArticle>(rec, [
        "sectionId",
        "sort",
        "title",
        "manufacturers",
        "general",
        "categoryKeys",
      ]);
      await Articles.updateArticle(id, patch, by);
      articles++;
      continue;
    }
    // Never through Articles.createArticle, which mints a new id — a new id
    // would break every catalog part's specArticleId link to this article
    // and duplicate the article on every re-import.
    const normalized = normalizeArticle({ ...rec, updatedAt: now, updatedBy: by });
    if (!normalized.id || !normalized.sectionId) {
      skipped++;
      continue;
    }
    await upsertDoc<SpecCategoryArticle>("spec_articles", normalized);
    articles++;
  }

  for (const rec of file.templates) {
    const key = String((rec as { key?: unknown }).key || "").trim();
    const id = key ? templateId(key) : "";
    const existing = id ? await Templates.getTemplate(id) : null;
    const patch = presentFields<SpecTemplate>(rec, ["key", "title", "headings", "rules", "example"]);
    // saveTemplate always writes the full record (it's keyed by slug, so
    // it's idempotent, but not field-partial) — merge onto the existing
    // record first so an omitted key rides through unchanged rather than
    // being defaulted to "" by the store's own normalize().
    const merged: Omit<SpecTemplate, "id" | "updatedAt" | "updatedBy"> = existing
      ? { key: existing.key, title: existing.title, headings: existing.headings, rules: existing.rules, example: existing.example, ...patch }
      : { key: "", title: "", headings: [], rules: "", example: "", ...patch };
    await Templates.saveTemplate(merged, by);
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
    const existing = await Curtains.getCurtainTemplate(rec.id as GridCurtainType);
    const patch = presentFields<SpecCurtainTemplate>(rec, [
      "articleId",
      "sort",
      "title",
      "body",
      "fullnessClauses",
      "hang",
      "defaultColor",
    ]);
    // Same full-replace-underneath concern as templates above.
    const merged: Omit<SpecCurtainTemplate, "id" | "updatedAt" | "updatedBy"> = existing
      ? {
          articleId: existing.articleId,
          sort: existing.sort,
          title: existing.title,
          body: existing.body,
          fullnessClauses: existing.fullnessClauses,
          hang: existing.hang,
          defaultColor: existing.defaultColor,
          ...patch,
        }
      : { articleId: "", sort: 0, title: "", body: "", fullnessClauses: { "0": "", "50": "", "75": "", "100": "" }, hang: "", defaultColor: "", ...patch };
    await Curtains.saveCurtainTemplate({ id: rec.id as GridCurtainType, ...merged }, by);
    curtainTemplates++;
  }

  return { sections, articles, templates, curtainTemplates, skipped };
}
