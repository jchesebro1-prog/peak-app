import { articleIdForPart, hasPrintableSpec, resolveSameAs, type SpecCategoryArticle, type SpecPartLike } from "@/lib/specs/articles";
import { outlineLabel, renderBody, type OutlineLine, type PlaceholderContext } from "@/lib/specs/outline";
import type { SpecSection } from "@/lib/specs/sections";
import { applyFillIns, fillInSlots, staleFillInKeys, type FillInSlot } from "@/lib/specs/fill-ins";
import type { SpecDocHeader, SpecDocProduct, SpecDocument } from "@/lib/specs/spec-document";

/**
 * The spec builder's one assembly (#205 Phase B, design §3). Pure: the
 * builder's preview (client) and the Word writer (server) render the same
 * AssembledSection, so they cannot disagree.
 */

export type SpecBuilderPart = SpecPartLike & {
  desc?: string;
  mfr?: string;
  manufacturerPartNumber?: string;
  manufacturerModelNumber?: string;
  specTitle?: string;
};

export type LeftOutReason = "not-in-catalog" | "needs-header" | "other-section" | "no-spec";

export type Placement =
  | { ok: true; articleId: string }
  | { ok: false; reason: "not-in-catalog" | "needs-header" | "other-section"; articleId?: string };

export type AssembledArticle = { num: string; title: string; lines: OutlineLine[] };
export type AssembledProduct = { sku: string; label: string; heading: string; lines: OutlineLine[] };
export type AssembledPart2Article = { num: string; title: string; general: OutlineLine[]; products: AssembledProduct[] };
export type EquipmentRow = { sku: string; mfr: string; model: string; description: string; qty?: number };

export type SpecChecklist = {
  fillIns: Array<FillInSlot & { answered: boolean }>;
  fillInsLeft: number;
  staleAnswers: string[];
  leftOut: Array<{ sku: string; desc: string; reason: LeftOutReason; articleId?: string }>;
};

export type AssembledSection = {
  number: string;
  title: string;
  header: SpecDocHeader;
  part1: AssembledArticle[];
  part3: AssembledArticle[];
  part2:
    | { style: "paragraphs"; articles: AssembledPart2Article[] }
    | { style: "table"; articles: AssembledPart2Article[]; rows: EquipmentRow[]; showQty: boolean };
  checklist: SpecChecklist;
  warnings: string[];
};

const up = (s: string) => s.toUpperCase();
const prefix = (sku: string) => (sku.indexOf(":") > 0 ? sku.slice(0, sku.indexOf(":")) : "");
const tail = (sku: string) => (sku.indexOf(":") >= 0 ? sku.slice(sku.indexOf(":") + 1) : "");

/** Whether `articleId` names a live article inside `sectionId` — the one
 *  check for a per-spec header override, shared between `placeProduct`
 *  below and the builder actions' addSpecProductAction/
 *  setSpecProductHeaderAction (#205 spec builder T4 fix wave item 1), so a
 *  header override can never point outside the spec's own section. */
export function articleInSection(
  articleId: string | null | undefined,
  sectionId: string,
  articles: SpecCategoryArticle[]
): boolean {
  return !!articleId && articles.some((a) => a.id === articleId && a.sectionId === sectionId);
}

/**
 * Where a BOM part lands: its own resolved article when that belongs to this
 * section, else a per-spec header override (chosen when the product was
 * added, never written to the part), else "other-section" (naming the
 * article it does belong to) or "needs-header".
 */
export function placeProduct(
  p: SpecDocProduct,
  part: SpecBuilderPart | undefined,
  sectionId: string,
  articles: SpecCategoryArticle[],
  sections: SpecSection[]
): Placement {
  if (!part) return { ok: false, reason: "not-in-catalog" };
  const own = articleIdForPart(part, articles, sections);
  if (articleInSection(own, sectionId, articles)) return { ok: true, articleId: own! };
  if (articleInSection(p.articleId, sectionId, articles)) return { ok: true, articleId: p.articleId! };
  if (own) return { ok: false, reason: "other-section", articleId: own };
  return { ok: false, reason: "needs-header" };
}

/** The part whose text prints for `part`: itself, or its one-hop same-as target. null = nothing printable. */
function textPart(part: SpecBuilderPart, bySku: Map<string, SpecBuilderPart>): SpecBuilderPart | null {
  if ((part.specSameAs || "").trim()) {
    const { target, error } = resolveSameAs(part, bySku as unknown as Map<string, SpecPartLike>);
    if (error || !target) return null;
    return hasPrintableSpec(target) ? (target as SpecBuilderPart) : null;
  }
  return hasPrintableSpec(part) ? part : null;
}

export function assembleSection(input: {
  section: SpecSection;
  articles: SpecCategoryArticle[];
  sections: SpecSection[];
  /** Keyed by UPPERCASE sku; must include same-as targets. */
  parts: Map<string, SpecBuilderPart>;
  doc: SpecDocument;
}): AssembledSection {
  const { section, articles, sections, parts, doc } = input;
  const warnings: string[] = [];

  const slots = fillInSlots(section);
  const staleAnswers = staleFillInKeys(section, doc.fillIns);

  type Collected = { p: SpecDocProduct; part: SpecBuilderPart; tp: SpecBuilderPart; articleId: string };
  const collected: Collected[] = [];
  const leftOut: SpecChecklist["leftOut"] = [];

  for (const p of doc.products) {
    const part = parts.get(up(p.sku));
    const placement = placeProduct(p, part, section.id, articles, sections);
    if (!placement.ok) {
      leftOut.push({
        sku: p.sku,
        desc: part?.desc || p.sku,
        reason: placement.reason,
        ...(placement.articleId ? { articleId: placement.articleId } : {}),
      });
      continue;
    }
    const tp = textPart(part!, parts);
    if (!tp) {
      leftOut.push({ sku: p.sku, desc: part!.desc || p.sku, reason: "no-spec", articleId: placement.articleId });
      continue;
    }
    collected.push({ p, part: part!, tp, articleId: placement.articleId });
  }

  // Used Part 2 articles: this section's articles that received a printable
  // product, sort-then-title — the same order they are numbered 2.1, 2.2…
  const used = articles
    .filter((a) => a.sectionId === section.id && collected.some((c) => c.articleId === a.id))
    .sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
  const usedTitles = used.map((a) => a.title);

  const project = {
    number: doc.header.projectNumber,
    name: doc.header.projectName,
    phase: doc.header.phase,
    issueDate: doc.header.issueDate,
  };
  const sectionCtx = { number: section.number, title: section.title };
  const baseCtx: PlaceholderContext = { articles: usedTitles, project, section: sectionCtx };

  // Empty-doc {{articles}} warnings are expected (nothing has been added yet)
  // and would otherwise drown out every other warning, so they are dropped
  // here rather than surfaced and immediately dismissed by every viewer.
  const render = (body: string, context: "article" | "entry", placeholders: PlaceholderContext): OutlineLine[] => {
    const r = renderBody(body, { context, placeholders });
    for (const w of r.warnings) {
      if (usedTitles.length === 0 && w.includes("{{articles}}")) continue;
      warnings.push(w);
    }
    return r.lines;
  };

  const part1 = section.part1.map((a, i) => ({
    num: `1.${i + 1}`,
    title: a.title,
    lines: render(applyFillIns(a.body, a.id, doc.fillIns), "article", baseCtx),
  }));
  const part3 = section.part3.map((a, i) => ({
    num: `3.${i + 1}`,
    title: a.title,
    lines: render(applyFillIns(a.body, a.id, doc.fillIns), "article", baseCtx),
  }));

  const showQty = doc.printQuantities && doc.source.kind !== "scratch";

  const generalFor = (articleGeneral: string, manufacturers: string[]): OutlineLine[] =>
    render(articleGeneral, "article", { manufacturers, section: sectionCtx, project });

  let part2: AssembledSection["part2"];
  if (section.part2Style === "table") {
    const articlesOut: AssembledPart2Article[] = used.map((a, i) => ({
      num: `2.${i + 1}`,
      title: a.title,
      general: generalFor(a.general, a.manufacturers),
      products: [],
    }));
    const rows: EquipmentRow[] = collected.map((c) => ({
      sku: c.part.sku,
      mfr: c.part.mfr || prefix(c.part.sku) || "",
      model: c.part.manufacturerModelNumber || c.part.manufacturerPartNumber || tail(c.part.sku) || c.part.sku,
      description: c.tp.specTitle || c.part.desc || "",
      ...(showQty && (c.p.qty || 0) > 0 ? { qty: c.p.qty } : {}),
    }));
    part2 = { style: "table", articles: articlesOut, rows, showQty };
  } else {
    const articlesOut: AssembledPart2Article[] = used.map((a, i) => {
      const general = generalFor(a.general, a.manufacturers);
      const generalTop = general.filter((l) => l.depth === 0).length;
      const products: AssembledProduct[] = collected
        .filter((c) => c.articleId === a.id)
        .map((c, j) => {
          const heading0 = c.tp.specTitle || c.part.desc || c.part.sku;
          const heading = showQty && (c.p.qty || 0) > 0 ? `${heading0} (Quantity: ${c.p.qty})` : heading0;
          const lines = render(c.tp.specBody || "", "entry", { manufacturers: a.manufacturers, section: sectionCtx, project });
          return { sku: c.part.sku, label: outlineLabel(0, generalTop + j + 1), heading, lines };
        });
      return { num: `2.${i + 1}`, title: a.title, general, products };
    });
    part2 = { style: "paragraphs", articles: articlesOut };
  }

  const checklist: SpecChecklist = {
    fillIns: slots.map((s) => ({ ...s, answered: (doc.fillIns[s.key] || "").trim() !== "" })),
    fillInsLeft: slots.filter((s) => (doc.fillIns[s.key] || "").trim() === "").length,
    staleAnswers,
    leftOut,
  };

  return {
    number: section.number,
    title: section.title,
    header: doc.header,
    part1,
    part3,
    part2,
    checklist,
    warnings: [...new Set(warnings)],
  };
}
