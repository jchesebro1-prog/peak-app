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

export function specStateOf(part: SpecPartLike, bySku: Map<string, SpecPartLike>): PartSpecState {
  if ((part.specSameAs || "").trim()) {
    const { target, error } = resolveSameAs(part, bySku);
    if (error || !target) return "missing";
    return specStateOf(target, bySku) === "authored" ? "same-as" : "missing";
  }
  if (!(part.specBody || "").trim()) return "missing";
  return part.specState === "draft" ? "draft" : "authored";
}
