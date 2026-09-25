/**
 * Section shape for the Specs module (#205), split out of the store so it
 * stays pure: `src/lib/bid-spec.ts` runs inside a client component
 * (`design/engagements/spec/generator.tsx` calls `matchBom`), so it cannot
 * import anything at runtime that reaches the database.
 *
 * D94 wrote `part1` / `part3` as one flat text block each. The specimen (and
 * every real project manual) writes titled articles — 1.1 SECTION INCLUDES,
 * 1.2 SUBMITTALS — so a section now carries an article array. A saved record
 * whose part is still a string reads as one untitled article; the section
 * editor rewrites it on first save. There is no data migration: JSONB fields
 * are read through `normalizeSection`.
 */

export type SpecArticle = {
  id: string;
  /** e.g. "SUBMITTALS". May be empty — a legacy body has no title. */
  title: string;
  /** Outline text, per the convention in src/lib/specs/outline.ts. */
  body: string;
};

export type SpecPart2Style = "paragraphs" | "table";
export type SpecQuantities = "drawings" | "inline";

export const SPEC_PART2_STYLES: readonly SpecPart2Style[] = ["paragraphs", "table"];
export const SPEC_QUANTITIES: readonly SpecQuantities[] = ["drawings", "inline"];

export type SpecSection = {
  id: string;
  /** CSI number, e.g. "11 61 23". Free text — Peak decides its own numbering. */
  number: string;
  title: string;
  /** Ordering within the assembled package. */
  sort: number;
  part1: SpecArticle[];
  part3: SpecArticle[];
  part2Style: SpecPart2Style;
  quantities: SpecQuantities;
  updatedAt: number;
  updatedBy: string;
};

/** What may actually be sitting in the database, D94 records included. */
export type RawSpecSection = Omit<SpecSection, "part1" | "part3" | "part2Style" | "quantities"> & {
  part1?: unknown;
  part3?: unknown;
  part2Style?: unknown;
  quantities?: unknown;
};

export function newArticleId(): string {
  return "sa-" + Math.random().toString(36).slice(2, 10);
}

function articleFrom(v: unknown, i: number): SpecArticle | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title : "";
  const body = typeof o.body === "string" ? o.body : "";
  if (!title.trim() && !body.trim()) return null;
  return { id: typeof o.id === "string" && o.id ? o.id : `sa-legacy-${i + 1}`, title, body };
}

export function toArticles(v: unknown): SpecArticle[] {
  if (Array.isArray(v)) return v.map(articleFrom).filter((a): a is SpecArticle => a !== null);
  if (typeof v === "string") {
    const body = v.trim();
    return body ? [{ id: "sa-legacy-1", title: "", body }] : [];
  }
  return [];
}

export function normalizeSection(raw: RawSpecSection): SpecSection {
  const style = SPEC_PART2_STYLES.includes(raw.part2Style as SpecPart2Style)
    ? (raw.part2Style as SpecPart2Style)
    : "paragraphs";
  const qty = SPEC_QUANTITIES.includes(raw.quantities as SpecQuantities)
    ? (raw.quantities as SpecQuantities)
    : "drawings";
  return {
    id: String(raw.id || ""),
    number: String(raw.number || "").trim(),
    title: String(raw.title || "").trim(),
    sort: Number(raw.sort) || 0,
    part1: toArticles(raw.part1),
    part3: toArticles(raw.part3),
    part2Style: style,
    quantities: qty,
    updatedAt: Number(raw.updatedAt) || 0,
    updatedBy: String(raw.updatedBy || ""),
  };
}

/**
 * Flatten a part's articles back to the single text block D94's renderer and
 * docx builder still expect. Phase B replaces those readers with article-aware
 * ones; until then this keeps the existing bid-spec generator working against
 * the new shape without a second code path.
 */
export function partText(articles: SpecArticle[]): string {
  // Defensively re-normalize: a caller holding an un-normalized SpecSection
  // (e.g. one built by hand rather than read through normalizeSection) can
  // still have a legacy string here at runtime, even though the type says
  // SpecArticle[]. toArticles is idempotent on an already-normalized array.
  return toArticles(articles)
    .map((a) => [a.title.trim(), a.body.trim()].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}
