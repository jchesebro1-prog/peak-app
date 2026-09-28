import { articleIdForPart, hasPrintableSpec, resolveSameAs, type SpecCategoryArticle, type SpecPartLike } from "@/lib/specs/articles";
import { outlineLabel, renderBody, type OutlineLine, type PlaceholderContext } from "@/lib/specs/outline";
import type { SpecSection } from "@/lib/specs/sections";
import { applyFillIns, fillInSlots, staleFillInKeys, type FillInSlot } from "@/lib/specs/fill-ins";
import type { SpecDocHeader, SpecDocProduct, SpecDocument } from "@/lib/specs/spec-document";
import { sectionIdForRecord, type SpecRecord } from "@/lib/specs/records";
import { isPlaceholderSku, normPartNumber, partNumberCandidates, specRowKey, wildcardMatches } from "@/lib/specs/record-keys";
import { companionsFor, matchRow, type RowMatch } from "@/lib/specs/record-match";
import { applyJobValues, jobValueSlots, staleJobValueKeys, type JobValueSlot } from "@/lib/specs/record-fill-ins";

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

export type LeftOutReason =
  | "not-in-catalog"
  | "needs-header"
  | "other-section"
  | "no-spec"
  | "no-match"
  | "ambiguous"
  | "draft";

export type Placement =
  | { ok: true; articleId: string }
  | { ok: false; reason: "not-in-catalog" | "needs-header" | "other-section"; articleId?: string };

export type AssembledArticle = { num: string; title: string; lines: OutlineLine[] };
export type AssembledProduct = {
  sku: string;
  label: string;
  heading: string;
  lines: OutlineLine[];
  /** Spec records (design §3.3): the record this entry prints, its revision,
   *  whether a project-only override replaced its text, and whether the
   *  library has moved past that override's base revision. */
  specId?: string;
  revision?: number;
  overridden?: boolean;
  overrideStale?: boolean;
  /** Every BOM row (specRowKey) that landed on this entry; [] for a companion. */
  rowKeys: string[];
};
export type AssembledPart2Article = { num: string; title: string; general: OutlineLine[]; products: AssembledProduct[] };
export type EquipmentRow = { sku: string; mfr: string; model: string; description: string; qty?: number };

export type SpecChecklist = {
  fillIns: Array<FillInSlot & { answered: boolean }>;
  fillInsLeft: number;
  staleAnswers: string[];
  leftOut: Array<{
    sku: string;
    desc: string;
    reason: LeftOutReason;
    articleId?: string;
    rowKey: string;
    match?: RowMatch;
    /** For a record from another section: that section's CSI number. */
    sectionNumber?: string;
  }>;
  /** `[bracket]` job values in the printed record entries (design §4) —
   *  listed with their defaults, never counted in `fillInsLeft`. */
  jobValues: Array<JobValueSlot & { answered: boolean; title: string }>;
  staleJobValues: string[];
  /** Rows waived on purpose — printed under ITEMS NOT SPECIFIED. */
  waived: Array<{ rowKey: string; desc: string; reason: string }>;
};

export type AssembledSection = {
  number: string;
  title: string;
  header: SpecDocHeader;
  part1: AssembledArticle[];
  part3: AssembledArticle[];
  part2:
    | { style: "paragraphs"; articles: AssembledPart2Article[] }
    | {
        style: "table";
        articles: AssembledPart2Article[];
        rows: EquipmentRow[];
        showQty: boolean;
        /** ITEMS NOT SPECIFIED (design §4) — printed AFTER the equipment
         *  table, so the schedule never files under it. Paragraph style has
         *  no table and keeps it as its last article instead. */
        trailing?: AssembledPart2Article;
      };
  checklist: SpecChecklist;
  warnings: string[];
  /** `{ specId: revision }` of every record entry printed (companions too). */
  usedRecords: Record<string, number>;
  /** Every product row's match outcome, keyed by specRowKey. */
  rowMatches: Record<string, RowMatch>;
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
  /** The Spec Library (design §3). Absent/empty = the #205 legacy path only. */
  records?: SpecRecord[];
}): AssembledSection {
  const { section, articles, sections, parts, doc } = input;
  const records = input.records ?? [];
  const recordById = new Map(records.map((r) => [r.specId, r]));
  const warnings: string[] = [];

  const slots = fillInSlots(section);
  const labels = doc.fillInLabels || {};
  // A job-value answer (`${specId}#n`, design §4) shares the fillIns map with
  // Part 1/3 answers but is never a stale Part 1/3 answer — its own
  // staleness is `staleJobValues` below.
  const isJobValueKey = (k: string) => k.lastIndexOf("#") > 0 && recordById.has(k.slice(0, k.lastIndexOf("#")));
  const staleAnswers = staleFillInKeys(section, doc.fillIns, labels).filter((k) => !isJobValueKey(k));
  const stale = new Set(staleAnswers);

  // One printed entry, in BOM order (`idx` = first row index). A legacy entry
  // is today's catalog-part path, untouched; a record entry groups every row
  // that matched the same record.
  type LegacyEntry = { kind: "legacy"; idx: number; p: SpecDocProduct; part: SpecBuilderPart; tp: SpecBuilderPart; articleId: string; rowKey: string };
  type RecordEntry = {
    kind: "record";
    idx: number;
    record: SpecRecord;
    articleId: string;
    rows: Array<{ p: SpecDocProduct; part?: SpecBuilderPart; rowKey: string }>;
    companion: boolean;
  };
  type Entry = LegacyEntry | RecordEntry;
  const entries: Entry[] = [];
  const recordEntries = new Map<string, RecordEntry>();
  const leftOut: SpecChecklist["leftOut"] = [];
  const waived: SpecChecklist["waived"] = [];
  const rowMatches: Record<string, RowMatch> = {};

  /** Where a record prints in THIS section, or why it can't (design §3.3). */
  const recordPlacement = (r: SpecRecord): { ok: true; articleId: string } | { ok: false; reason: "other-section" | "needs-header" } => {
    if (sectionIdForRecord(r, sections) !== section.id) return { ok: false, reason: "other-section" };
    if (!articleInSection(r.sourceArticleId, section.id, articles)) return { ok: false, reason: "needs-header" };
    return { ok: true, articleId: r.sourceArticleId! };
  };

  doc.products.forEach((p, idx) => {
    const rowKey = specRowKey(p);
    const realSku = !!p.sku && !isPlaceholderSku(p.sku);
    // A row with no real sku never looks up a catalog part.
    const part = realSku ? parts.get(up(p.sku)) : undefined;
    const tp = part ? textPart(part, parts) : null;
    const match = matchRow(p, records, part ?? null, tp !== null);
    rowMatches[rowKey] = match;
    const rowDesc = part?.desc || p.desc || p.sku || p.mfrNumber || p.specKey || "";

    if (match.status === "waived") {
      waived.push({ rowKey, desc: rowDesc, reason: match.reason });
      return;
    }

    if (match.status === "matched") {
      const r = recordById.get(match.specId)!;
      const placed = recordPlacement(r);
      if (!placed.ok) {
        leftOut.push({
          sku: p.sku,
          desc: rowDesc,
          reason: placed.reason,
          rowKey,
          match,
          ...(r.sourceArticleId ? { articleId: r.sourceArticleId } : {}),
          ...(placed.reason === "other-section" ? { sectionNumber: r.section } : {}),
        });
        return;
      }
      const hit = recordEntries.get(r.specId);
      if (hit) {
        hit.rows.push({ p, part, rowKey });
        return;
      }
      const e: RecordEntry = { kind: "record", idx, record: r, articleId: placed.articleId, rows: [{ p, part, rowKey }], companion: false };
      recordEntries.set(r.specId, e);
      entries.push(e);
      return;
    }

    if (match.status === "ambiguous" || match.status === "draft") {
      leftOut.push({ sku: p.sku, desc: rowDesc, reason: match.status, rowKey, match });
      return;
    }

    // `legacy`, or `no-match` on a real catalog part: today's #205 path,
    // exactly (placement, then printable text).
    if (part) {
      const placement = placeProduct(p, part, section.id, articles, sections);
      const extra = match.status === "no-match" ? { match } : {};
      if (!placement.ok) {
        leftOut.push({
          sku: p.sku,
          desc: part.desc || p.sku,
          reason: placement.reason,
          rowKey,
          ...extra,
          ...(placement.articleId ? { articleId: placement.articleId } : {}),
        });
        return;
      }
      if (!tp) {
        leftOut.push({ sku: p.sku, desc: part.desc || p.sku, reason: "no-spec", articleId: placement.articleId, rowKey, ...extra });
        return;
      }
      entries.push({ kind: "legacy", idx, p, part, tp, articleId: placement.articleId, rowKey });
      return;
    }

    // No catalog part and no record. A real sku keeps today's
    // "not-in-catalog" (why it doesn't print) and carries the no-match
    // result (the suggestions for Link / Write new / Waive) — the same
    // pattern as a catalog part with no text above. A row with no real sku
    // never had a catalog part to lose: it is "no-match".
    leftOut.push({
      sku: p.sku,
      desc: rowDesc,
      reason: realSku ? "not-in-catalog" : "no-match",
      rowKey,
      match,
    });
  });

  // Companions (design §3.3): once per document, under their own article,
  // after that article's other entries. One in another section belongs to
  // that section's file; one whose article is gone is warned about.
  const matchedHere = [...recordEntries.keys()];
  for (const id of companionsFor(matchedHere, records)) {
    const r = recordById.get(id)!;
    const placed = recordPlacement(r);
    if (!placed.ok) {
      if (placed.reason === "needs-header") warnings.push(`Companion spec ${r.specId} names an article that isn't in this section.`);
      continue;
    }
    const e: RecordEntry = { kind: "record", idx: Number.MAX_SAFE_INTEGER, record: r, articleId: placed.articleId, rows: [], companion: true };
    recordEntries.set(id, e);
    entries.push(e);
  }

  // Legacy and record entries together in BOM row order, companions last
  // (companionsFor is already specId-sorted, and sort is stable).
  entries.sort((a, b) => a.idx - b.idx);

  // Used Part 2 articles: this section's articles that received a printable
  // entry, sort-then-title — the same order they are numbered 2.1, 2.2…
  const used = articles
    .filter((a) => a.sectionId === section.id && entries.some((c) => c.articleId === a.id))
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
    lines: render(applyFillIns(a.body, a.id, doc.fillIns, labels), "article", baseCtx),
  }));
  const part3 = section.part3.map((a, i) => ({
    num: `3.${i + 1}`,
    title: a.title,
    lines: render(applyFillIns(a.body, a.id, doc.fillIns, labels), "article", baseCtx),
  }));

  const showQty = doc.printQuantities && doc.source.kind !== "scratch";

  const generalFor = (articleGeneral: string, manufacturers: string[]): OutlineLine[] =>
    render(articleGeneral, "article", { manufacturers, section: sectionCtx, project });

  const usedRecords: Record<string, number> = {};
  const slotsBySpec = new Map<string, JobValueSlot[]>();
  const jobValueTitles = new Map<string, string>();

  /** A record entry's printed title/text: a project-only override replaces
   *  the record's before brackets are scanned (design §4, §5.2). */
  const recordText = (e: RecordEntry) => {
    const r = e.record;
    const ov = doc.overrides?.[r.specId];
    const qty = e.rows.reduce((n, x) => n + (Number(x.p.qty) || 0), 0);
    return {
      title: (ov && ov.title) || r.title,
      specText: ov ? ov.specText : r.specText,
      overridden: !!ov,
      overrideStale: !!ov && r.revision > ov.baseRevision,
      qty,
    };
  };

  /** The row's own part number that hit the record, else its first stored one. */
  const matchedModel = (e: RecordEntry): string => {
    const r = e.record;
    const first = e.rows[0];
    if (first) {
      const stored = r.mfrNumbers.map(normPartNumber);
      for (const c of partNumberCandidates(first.p, first.part)) {
        if (stored.includes(c) || r.mfrNumbers.some((n) => wildcardMatches(n, c))) return c;
      }
    }
    return r.mfrNumbers[0] || "";
  };

  /** Part 2 closing article for waived rows (design §4). */
  const itemsNotSpecified = (n: number): AssembledPart2Article => ({
    num: `2.${n + 1}`,
    title: "ITEMS NOT SPECIFIED",
    general: waived.map((w, i) => ({ depth: 0, label: outlineLabel(0, i + 1), text: `${w.desc} — ${w.reason}` })),
    products: [],
  });

  let part2: AssembledSection["part2"];
  if (section.part2Style === "table") {
    const articlesOut: AssembledPart2Article[] = used.map((a, i) => ({
      num: `2.${i + 1}`,
      title: a.title,
      general: generalFor(a.general, a.manufacturers),
      products: [],
    }));
    const rows: EquipmentRow[] = entries.map((c) => {
      if (c.kind === "legacy") {
        return {
          sku: c.part.sku,
          mfr: c.part.mfr || prefix(c.part.sku) || "",
          model: c.part.manufacturerModelNumber || c.part.manufacturerPartNumber || tail(c.part.sku) || c.part.sku,
          description: c.tp.specTitle || c.part.desc || "",
          ...(showQty && (c.p.qty || 0) > 0 ? { qty: c.p.qty } : {}),
        };
      }
      const t = recordText(c);
      usedRecords[c.record.specId] = c.record.revision;
      const sku = c.rows[0]?.p.sku || "";
      return {
        sku: sku || c.record.specId,
        mfr: c.record.manufacturer || prefix(sku) || "",
        model: matchedModel(c),
        description: t.title,
        ...(showQty && t.qty > 0 ? { qty: t.qty } : {}),
      };
    });
    part2 = {
      style: "table",
      articles: articlesOut,
      rows,
      showQty,
      ...(waived.length ? { trailing: itemsNotSpecified(articlesOut.length) } : {}),
    };
  } else {
    const articlesOut: AssembledPart2Article[] = used.map((a, i) => {
      const general = generalFor(a.general, a.manufacturers);
      const generalTop = general.filter((l) => l.depth === 0).length;
      const products: AssembledProduct[] = entries
        .filter((c) => c.articleId === a.id)
        .map((c, j) => {
          const label = outlineLabel(0, generalTop + j + 1);
          const placeholders = { manufacturers: a.manufacturers, section: sectionCtx, project };
          if (c.kind === "legacy") {
            const heading0 = c.tp.specTitle || c.part.desc || c.part.sku;
            const heading = showQty && (c.p.qty || 0) > 0 ? `${heading0} (Quantity: ${c.p.qty})` : heading0;
            const lines = render(c.tp.specBody || "", "entry", placeholders);
            return { sku: c.part.sku, label, heading, lines, rowKeys: [c.rowKey] };
          }
          const r = c.record;
          const t = recordText(c);
          const jv = jobValueSlots(r.specId, t.specText);
          slotsBySpec.set(r.specId, jv);
          jobValueTitles.set(r.specId, t.title);
          usedRecords[r.specId] = r.revision;
          const heading = showQty && t.qty > 0 ? `${t.title} (Quantity: ${t.qty})` : t.title;
          const finalText = applyJobValues(t.specText, r.specId, doc.fillIns, labels);
          // [FILL IN: …] in record text is deferred (Task 7 fix round): it
          // prints as written — still a visible blank — but can't be
          // answered in the builder yet.
          if (finalText.includes("[FILL IN:")) {
            warnings.push(`${r.specId} has a [FILL IN] blank that can't be answered in the builder yet — edit the spec text.`);
          }
          const lines = render(finalText, "entry", placeholders);
          return {
            sku: c.rows[0]?.p.sku || r.specId,
            label,
            heading,
            lines,
            specId: r.specId,
            revision: r.revision,
            overridden: t.overridden,
            overrideStale: t.overrideStale,
            rowKeys: c.rows.map((x) => x.rowKey),
          };
        });
      return { num: `2.${i + 1}`, title: a.title, general, products };
    });
    if (waived.length) articlesOut.push(itemsNotSpecified(articlesOut.length));
    part2 = { style: "paragraphs", articles: articlesOut };
  }

  // A stale answer (written for a different blank) doesn't answer the blank now at its key.
  const answered = (key: string) => !stale.has(key) && (doc.fillIns[key] || "").trim() !== "";
  const staleJobValues = staleJobValueKeys(slotsBySpec, doc.fillIns, labels);
  const staleJv = new Set(staleJobValues);
  const jobValues: SpecChecklist["jobValues"] = [...slotsBySpec.values()].flat().map((s) => ({
    ...s,
    // staleJobValueKeys already flags an answer whose label no longer
    // matches this bracket, so "non-empty and not stale" = it prints.
    answered: !staleJv.has(s.key) && (doc.fillIns[s.key] || "").trim() !== "",
    title: jobValueTitles.get(s.specId) || s.specId,
  }));
  const checklist: SpecChecklist = {
    fillIns: slots.map((s) => ({ ...s, answered: answered(s.key) })),
    fillInsLeft: slots.filter((s) => !answered(s.key)).length,
    staleAnswers,
    leftOut,
    jobValues,
    staleJobValues,
    waived,
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
    usedRecords,
    rowMatches,
  };
}
