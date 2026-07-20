import type { CatalogPart } from "@/lib/stores/catalog";
import type { SpecSection } from "@/lib/stores/spec-sections";

/* ------------------------------------------------------------------ *
 * Bid-spec matching + assembly (D94).
 * Design: docs/superpowers/specs/2026-07-19-bid-spec-generator-design.md
 *
 * The BOM is the completeness guarantee. A dropdown picker is quicker to
 * click but leaves the user asking "did I select everything?"; starting from
 * the equipment list and REPORTING what could not be specified moves that
 * burden onto the machine. Nothing is silently dropped — every BOM row ends
 * up in exactly one bucket, and the document cannot be finalized while any
 * row is unresolved.
 * ------------------------------------------------------------------ */

/** Spec fields carried on a catalog part (D94). Stored on the catalog doc
 *  itself rather than a parallel collection so a part and its spec language
 *  can never drift apart or orphan each other. */
export type PartSpecFields = {
  /** SpecSection id this part's Part 2 text belongs under. */
  specSectionId?: string;
  /** PART 2 — PRODUCTS paragraph(s) for this part. */
  specBody?: string;
  /** Ordering hint within the section; ties break on SKU. */
  specSort?: number;
};

export type SpecCatalogPart = CatalogPart & PartSpecFields;

/** One line of the incoming equipment list, from a quote or an upload. */
export type BomRow = {
  sku: string;
  desc: string;
  qty: number;
};

export type MatchBucket = "ready" | "no-spec" | "no-match";

export type MatchedRow = {
  row: BomRow;
  bucket: MatchBucket;
  part: SpecCatalogPart | null;
  /** Candidate parts when the SKU missed but descriptions look close. */
  candidates: SpecCatalogPart[];
  /** Set by the user: this row legitimately needs no spec paragraph. */
  waived?: boolean;
  waiveReason?: string;
};

export type MatchReport = {
  rows: MatchedRow[];
  counts: Record<MatchBucket, number>;
  /** True when every row is either ready or explicitly waived. */
  finalizable: boolean;
};

function norm(s: string): string {
  return String(s || "").trim().toLowerCase();
}

/** Words that carry no discriminating power in fixture descriptions. */
const STOP = new Set(["the", "and", "with", "for", "a", "of", "in", "kit", "assembly"]);

function tokens(s: string): Set<string> {
  return new Set(
    norm(s)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP.has(t))
  );
}

/** Jaccard overlap — good enough to surface candidates a human then confirms.
 *  Deliberately NOT used to auto-assign: a wrong silent match would put the
 *  wrong product in a public bid document. */
function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit++;
  return hit / (ta.size + tb.size - hit);
}

const CANDIDATE_FLOOR = 0.34;

export function matchBom(rows: BomRow[], catalog: SpecCatalogPart[]): MatchReport {
  const bySku = new Map<string, SpecCatalogPart>();
  for (const p of catalog) {
    if (p.sku) bySku.set(norm(p.sku), p);
  }

  const matched: MatchedRow[] = rows.map((row) => {
    const direct = bySku.get(norm(row.sku));
    if (direct) {
      return {
        row,
        part: direct,
        candidates: [],
        bucket: direct.specBody?.trim() ? "ready" : "no-spec",
      };
    }
    const candidates = catalog
      .map((p) => ({ p, score: similarity(row.desc, p.desc) }))
      .filter((c) => c.score >= CANDIDATE_FLOOR)
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((c) => c.p);
    return { row, part: null, candidates, bucket: "no-match" as const };
  });

  return report(matched);
}

/** Recompute buckets + counts after the user maps or waives a row. */
export function report(rows: MatchedRow[]): MatchReport {
  const counts: Record<MatchBucket, number> = { ready: 0, "no-spec": 0, "no-match": 0 };
  for (const r of rows) counts[r.bucket]++;
  const finalizable = rows.every((r) => r.bucket === "ready" || r.waived);
  return { rows, counts, finalizable };
}

/* ----------------------------- assembly ----------------------------- */

export type AssembledPart = {
  sku: string;
  desc: string;
  qty: number;
  body: string;
};

export type AssembledSection = {
  number: string;
  title: string;
  part1: string;
  part3: string;
  parts: AssembledPart[];
};

export type AssembledSpec = {
  projectName: string;
  customer: string;
  engagementId: string;
  preparedBy: string;
  date: number;
  sections: AssembledSection[];
  /** Rows the user waived, carried through so the document's own record
   *  shows what was consciously left unspecified. */
  waived: Array<{ sku: string; desc: string; reason: string }>;
};

/**
 * Group matched rows into their sections and order them. Only `ready` rows
 * contribute Part 2 text; waived rows are recorded, never rendered as specs.
 * Sections with no parts are dropped — a bid document should not carry an
 * empty Stage Curtains section just because the library defines one.
 */
export function assemble(
  rows: MatchedRow[],
  sections: SpecSection[],
  meta: Omit<AssembledSpec, "sections" | "waived">
): AssembledSpec {
  const bySection = new Map<string, AssembledPart[]>();

  for (const r of rows) {
    if (r.bucket !== "ready" || !r.part) continue;
    const sid = r.part.specSectionId || "";
    if (!sid) continue;
    const list = bySection.get(sid) || [];
    list.push({
      sku: r.part.sku,
      desc: r.part.desc,
      qty: r.row.qty,
      body: (r.part.specBody || "").trim(),
    });
    bySection.set(sid, list);
  }

  const out: AssembledSection[] = [];
  for (const s of [...sections].sort((a, b) => a.sort - b.sort)) {
    const parts = bySection.get(s.id);
    if (!parts || !parts.length) continue;
    parts.sort((a, b) => {
      const rowA = rows.find((r) => r.part?.sku === a.sku);
      const rowB = rows.find((r) => r.part?.sku === b.sku);
      const sa = rowA?.part?.specSort ?? 0;
      const sb = rowB?.part?.specSort ?? 0;
      return sa - sb || a.sku.localeCompare(b.sku);
    });
    out.push({ number: s.number, title: s.title, part1: s.part1, part3: s.part3, parts });
  }

  return {
    ...meta,
    sections: out,
    waived: rows
      .filter((r) => r.waived)
      .map((r) => ({
        sku: r.row.sku,
        desc: r.row.desc,
        reason: r.waiveReason || "",
      })),
  };
}

/* ------------------------- document rendering ------------------------- */

function esc(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Paragraph text → numbered sub-points. One blank-line-separated block per
 *  point, matching how spec paragraphs are actually written. */
function points(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function two(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Render the assembled spec as a self-contained HTML document. Word opens
 * this natively as an editable document (the architect's actual need — they
 * paste sections into a project manual), and the same markup is the in-app
 * print/PDF view. See DECISIONS.md D94 for why this rather than a binary
 * .docx on day one.
 */
export function renderSpecHtml(spec: AssembledSpec, opts: { forWord?: boolean } = {}): string {
  const dateStr = new Date(spec.date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const body = spec.sections
    .map((s) => {
      const p1 = points(s.part1)
        .map((t, i) => `<p class="pt"><span class="num">1.${two(i + 1)}</span>${esc(t)}</p>`)
        .join("\n");
      const p3 = points(s.part3)
        .map((t, i) => `<p class="pt"><span class="num">3.${two(i + 1)}</span>${esc(t)}</p>`)
        .join("\n");
      const p2 = s.parts
        .map((part, i) => {
          const subs = points(part.body)
            .map((t, j) => `<p class="sub"><span class="ltr">${LETTERS[j] || "•"}.</span>${esc(t)}</p>`)
            .join("\n");
          return `<p class="pt"><span class="num">2.${two(i + 1)}</span><strong>${esc(part.desc)}</strong>${
            part.sku ? ` <span class="sku">(${esc(part.sku)})</span>` : ""
          }${part.qty ? ` — quantity ${part.qty}` : ""}</p>\n${subs}`;
        })
        .join("\n");

      return `<h2>SECTION ${esc(s.number)} — ${esc(s.title.toUpperCase())}</h2>
<h3>PART 1 — GENERAL</h3>
${p1 || '<p class="pt"><em>No general requirements recorded for this section.</em></p>'}
<h3>PART 2 — PRODUCTS</h3>
${p2}
<h3>PART 3 — EXECUTION</h3>
${p3 || '<p class="pt"><em>No execution requirements recorded for this section.</em></p>'}`;
    })
    .join("\n");

  const waived = spec.waived.length
    ? `<h2>ITEMS NOT SPECIFIED</h2>
<p class="pt">The following equipment appeared on the bill of materials and was intentionally omitted from this specification:</p>
${spec.waived
  .map((w) => `<p class="sub">${esc(w.sku)} ${esc(w.desc)}${w.reason ? ` — ${esc(w.reason)}` : ""}</p>`)
  .join("\n")}`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(spec.projectName)} — Specification</title>
<style>
  body { font-family: "Times New Roman", Times, serif; font-size: 11pt; color: #000; line-height: 1.45; max-width: 7.5in; margin: 0 auto; padding: 0.5in 0; }
  h1 { font-size: 15pt; margin: 0 0 2pt; }
  .meta { font-size: 10pt; color: #333; margin-bottom: 22pt; }
  h2 { font-size: 12pt; margin: 22pt 0 8pt; border-bottom: 1px solid #000; padding-bottom: 3pt; }
  h3 { font-size: 11pt; margin: 14pt 0 6pt; }
  p.pt { margin: 0 0 7pt; padding-left: 42pt; text-indent: -42pt; }
  p.sub { margin: 0 0 5pt; padding-left: 66pt; text-indent: -24pt; }
  .num { display: inline-block; width: 42pt; font-weight: bold; }
  .ltr { display: inline-block; width: 24pt; }
  .sku { font-family: "Courier New", monospace; font-size: 9.5pt; }
  @media print { body { padding: 0; } h2 { page-break-after: avoid; } }
</style></head>
<body>
<h1>${esc(spec.projectName)}</h1>
<div class="meta">
  ${esc(spec.customer)}${spec.customer ? " · " : ""}${esc(spec.engagementId)}<br>
  Specification prepared by ${esc(spec.preparedBy)} · ${esc(dateStr)}
</div>
${body || "<p>No sections could be assembled from this equipment list.</p>"}
${waived}
</body></html>`.trim() + (opts.forWord ? "\n" : "");
}
