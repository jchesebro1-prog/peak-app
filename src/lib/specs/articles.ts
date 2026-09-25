import type { SpecSection } from "@/lib/specs/sections";

/**
 * Part 2 category articles (D-SPEC) — "2.1 Stage Drapes", "2.3 Packaged Hoists".
 * Each opens with an "A. General" clause carrying the acceptable-manufacturers
 * list, then the products that landed in the BOM print as B., C., D…
 *
 * Pure: the resolution rules run in the part editor's live preview (a client
 * component) and in Phase B's server-side assembly, and they must agree.
 */

export type SpecCategoryArticle = {
  id: string;
  sectionId: string;
  sort: number;
  /** e.g. "Theatrical Stage Drapes". */
  title: string;
  /** Acceptable manufacturers, in order. Feeds {{manufacturers}}. */
  manufacturers: string[];
  /** The "A. General" outline. May use {{manufacturers}}. */
  general: string;
  /** Catalog categories that default into this article. */
  categoryKeys: string[];
  updatedAt: number;
  updatedBy: string;
};

/** The subset of a catalog part the spec rules actually read. */
export type SpecPartLike = {
  sku: string;
  category?: string;
  specArticleId?: string;
  /** D94's pointer, still on older parts. */
  specSectionId?: string;
  specBody?: string;
  specSameAs?: string;
  specState?: "authored" | "draft";
  productMetadata?: LegacySpecMetadata;
};

export type PartSpecState = "authored" | "same-as" | "draft" | "missing";
export type SameAsResult = { target: SpecPartLike | null; error: string | null };

export function normalizeCategoryKey(key: string): string {
  return String(key || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeArticle(raw: unknown): SpecCategoryArticle {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x || "").trim()).filter(Boolean) : [];

  const seenMfr = new Set<string>();
  const manufacturers: string[] = [];
  for (const m of strings(o.manufacturers)) {
    const k = m.toLowerCase();
    if (seenMfr.has(k)) continue;
    seenMfr.add(k);
    manufacturers.push(m);
  }

  // One spelling per normalized key — "Curtains" and "curtains" are one
  // mapping, and keeping both would make the category default ambiguous.
  const seenKey = new Set<string>();
  const categoryKeys: string[] = [];
  for (const c of strings(o.categoryKeys)) {
    const k = normalizeCategoryKey(c);
    if (!k || seenKey.has(k)) continue;
    seenKey.add(k);
    categoryKeys.push(c);
  }

  return {
    id: String(o.id || ""),
    sectionId: String(o.sectionId || ""),
    sort: Number(o.sort) || 0,
    title: String(o.title || "").trim(),
    manufacturers,
    general: typeof o.general === "string" ? o.general : "",
    categoryKeys,
    updatedAt: Number(o.updatedAt) || 0,
    updatedBy: String(o.updatedBy || ""),
  };
}

/* --- Legacy Displays metadata (D-SPEC-5) --- */

/** What commit 2e284665 stored under productMetadata: free text, not ids. */
export type LegacySpecMetadata = { specSection?: string; specArticle?: string };

/** "11 61 13", "116113" and "11-61-13" are one CSI number. */
export function csiKey(s: string): string {
  return String(s || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
}

/** A live section id, or a CSI number matching exactly ONE live section. */
export function resolveSectionRef(ref: string | undefined, sections: SpecSection[]): string | null {
  const r = String(ref || "").trim();
  if (!r) return null;
  if (sections.some((s) => s.id === r)) return r;
  const key = csiKey(r);
  if (!key) return null;
  const hits = sections.filter((s) => csiKey(s.number) === key);
  return hits.length === 1 ? hits[0].id : null;
}

/** A live article id, or a title matching exactly ONE live article — inside
 *  `sectionId` when one is known. Ambiguity never guesses. */
export function resolveArticleRef(
  ref: string | undefined,
  articles: SpecCategoryArticle[],
  sectionId: string | null
): string | null {
  const r = String(ref || "").trim();
  if (!r) return null;
  if (articles.some((a) => a.id === r)) return r;
  const key = normalizeCategoryKey(r);
  const pool = sectionId ? articles.filter((a) => a.sectionId === sectionId) : articles;
  const hits = pool.filter((a) => normalizeCategoryKey(a.title) === key);
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * The canonical pointers the legacy metadata would FILL on this part. Never
 * returns a key the part already holds (so it cannot overwrite an authored
 * value, and applying its result twice is a no-op). `{}` = nothing to adopt.
 */
export function adoptLegacySpecPointers(
  part: SpecPartLike,
  articles: SpecCategoryArticle[],
  sections: SpecSection[]
): { specSectionId?: string; specArticleId?: string } {
  const md = part.productMetadata || {};
  const out: { specSectionId?: string; specArticleId?: string } = {};
  let sectionId =
    part.specSectionId && sections.some((s) => s.id === part.specSectionId) ? part.specSectionId : null;
  if (!part.specSectionId) {
    const s = resolveSectionRef(md.specSection, sections);
    if (s) {
      out.specSectionId = s;
      sectionId = s;
    }
  }
  if (!part.specArticleId) {
    const a = resolveArticleRef(md.specArticle, articles, sectionId);
    if (a) {
      out.specArticleId = a;
      if (!part.specSectionId && !out.specSectionId) {
        out.specSectionId = articles.find((x) => x.id === a)!.sectionId;
      }
    }
  }
  return out;
}

/**
 * Which article a part belongs under. Explicit pointer, then the category
 * default, then D94's section pointer resolved to that section's first
 * article. Returns null when nothing resolves — a pre-placement only; the part
 * is still "no spec" until text exists.
 */
export function articleIdForPart(
  part: SpecPartLike,
  articles: SpecCategoryArticle[],
  sections: SpecSection[]
): string | null {
  // D-SPEC-5: legacy Displays text fills absent canonical pointers at read
  // time, so the panel, coverage and Phase B are right before any write runs.
  part = { ...part, ...adoptLegacySpecPointers(part, articles, sections) };
  if (part.specArticleId) {
    return articles.some((a) => a.id === part.specArticleId) ? part.specArticleId : null;
  }
  const key = normalizeCategoryKey(part.category || "");
  if (key) {
    const hit = [...articles]
      .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))
      .find((a) => a.categoryKeys.some((c) => normalizeCategoryKey(c) === key));
    if (hit) return hit.id;
  }
  if (part.specSectionId && sections.some((s) => s.id === part.specSectionId)) {
    const first = articles
      .filter((a) => a.sectionId === part.specSectionId)
      .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title))[0];
    if (first) return first.id;
  }
  return null;
}

/**
 * `specSameAs` resolves ONE hop. A chain or a cycle is an error, and the
 * pointing part reports "no spec" naming the target — following chains would
 * make a spec's provenance unknowable from the part alone.
 */
export function resolveSameAs(part: SpecPartLike, bySku: Map<string, SpecPartLike>): SameAsResult {
  const want = (part.specSameAs || "").trim();
  if (!want) return { target: null, error: null };
  if (want.toUpperCase() === part.sku.toUpperCase()) {
    return { target: null, error: `${part.sku} points its spec at itself.` };
  }
  const target = bySku.get(want) || bySku.get(want.toUpperCase()) || null;
  if (!target) return { target: null, error: `Same spec as ${want} — no such part.` };
  if ((target.specSameAs || "").trim()) {
    return { target: null, error: `Same spec as ${target.sku}, which is itself a "same spec as" pointer.` };
  }
  return { target, error: null };
}

/** THE print predicate (D-SPEC-6). Only authored text prints; a draft is
 *  missing. A D94 part with a body and no specState predates drafts and
 *  counts as authored. Every consumer that used to test `specBody?.trim()`
 *  calls this instead. */
export function hasPrintableSpec(
  p: { specBody?: string; specState?: "authored" | "draft" } | null | undefined
): boolean {
  return !!p && !!(p.specBody || "").trim() && p.specState !== "draft";
}

export function specStateOf(part: SpecPartLike, bySku: Map<string, SpecPartLike>): PartSpecState {
  if ((part.specSameAs || "").trim()) {
    const { target, error } = resolveSameAs(part, bySku);
    if (error || !target) return "missing";
    return specStateOf(target, bySku) === "authored" ? "same-as" : "missing";
  }
  if (!(part.specBody || "").trim()) return "missing";
  return hasPrintableSpec(part) ? "authored" : "draft";
}
