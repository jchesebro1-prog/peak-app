import Link from "next/link";
import { requireUser } from "@/lib/session";
import * as Sections from "@/lib/stores/spec-sections";
import * as Articles from "@/lib/stores/spec-articles";
import * as Templates from "@/lib/stores/spec-templates";
import * as Catalog from "@/lib/stores/catalog";
import * as Quotes from "@/lib/stores/quotes";
import * as GridProjects from "@/lib/stores/grid-projects";
import * as GeneratedSpecs from "@/lib/stores/generated-specs";
import type { SpecCategoryArticle } from "@/lib/specs/articles";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { datasheetSatisfiedSkus } from "@/lib/part-docs/coverage";
import { ON_BOM_WINDOW_MS, articleIdMapForParts, coverageRows, filterCoverage, skusOnBomSince, type CoverageState } from "../coverage";
import {
  AddSectionForm,
  AdoptLegacyPointersButton,
  CoverageControls,
  ImportExportLibraryControls,
  SeedStarterSectionsButton,
} from "./controls";

/**
 * Task 8 — the Specs library index: the Sections table (with the inline
 * "+ Add section" form and, when empty, the starter-sections seed button),
 * the Part 2 articles table grouped by section, mount points for Task 11's
 * import/export controls and Task 12's coverage table, and the Displays
 * "legacy pointers" adoption card (D258).
 */

export const metadata = { title: "Spec library — Quartzite-6" };

const TH: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#aab0bb",
  textTransform: "uppercase",
  letterSpacing: ".04em",
};
const CELL: React.CSSProperties = { fontSize: 12.5, color: "#3a3f4a" };

const PART2_STYLE_LABEL: Record<string, string> = { paragraphs: "Paragraphs", table: "Table" };
const QUANTITIES_LABEL: Record<string, string> = { drawings: "From drawings", inline: "Inline" };

/** Coverage table cap (punch #92/D142 idiom) — the catalog is ~10.7k rows in
 *  dev and ~37.4k in production; never render the whole filtered set. */
const COVERAGE_PAGE = 300;

const STATE_CHIP: Record<CoverageState, { label: string; fg: string; bg: string }> = {
  authored: { label: "Authored", fg: "#1f7a52", bg: "#e8f5ee" },
  "same-as": { label: "Same as", fg: "#3a5fb4", bg: "#eaf0fb" },
  draft: { label: "Draft", fg: "#9a6b12", bg: "#fdf3df" },
  missing: { label: "Missing", fg: "#b4543a", bg: "#fbeae5" },
};

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function SpecLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  // Owner decision: the starter formulas auto-seed when empty on ANY
  // environment, from whichever read path lists templates first.
  await Templates.ensureStarterTemplates();

  const [sections, articles, parts, templates, quotes, gridProjects, generated] = await Promise.all([
    Sections.allSections(),
    Articles.allArticles(),
    Catalog.list(),
    Templates.allTemplates(),
    Quotes.getAll(),
    GridProjects.listProjects(),
    GeneratedSpecs.allGeneratedSpecs(),
  ]);

  const articlesBySection = new Map<string, SpecCategoryArticle[]>();
  for (const a of articles) {
    const list = articlesBySection.get(a.sectionId);
    if (list) list.push(a);
    else articlesBySection.set(a.sectionId, [a]);
  }
  for (const list of articlesBySection.values()) {
    list.sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
  }

  // Final fix wave item 10: one Map, computed once, shared by the article
  // count table below and the coverage rows further down — rather than each
  // resolving articleIdForPart per part independently.
  const articleIdBySku = articleIdMapForParts(parts, articles, sections);

  const partCountByArticle = new Map<string, number>();
  for (const p of parts) {
    const aid = articleIdBySku.get(p.sku);
    if (aid) partCountByArticle.set(aid, (partCountByArticle.get(aid) || 0) + 1);
  }

  // D258: parts still carrying Displays research text with no matching
  // canonical pointer — the card below offers to fill what it can.
  const legacyUnlinkedParts = parts.filter((p) => {
    const md = p.productMetadata;
    if (!md) return false;
    if (md.specSection && !p.specSectionId) return true;
    if (md.specArticle && !p.specArticleId) return true;
    return false;
  });

  /* ---- Task 12: the coverage table ---- */
  const articleParam = one(sp.article);
  const stateParam = one(sp.state) as CoverageState | "all" | "";
  const bomOnly = one(sp.bom) === "1";
  const datasheetOnly = one(sp.datasheet) === "1";
  const coverageQ = one(sp.q);

  const onBom = skusOnBomSince({ quotes, gridProjects, generated }, Date.now() - ON_BOM_WINDOW_MS);
  // #207: the datasheet column is the part-documents coverage rule.
  const { index: docIndex } = await loadPartDocsState(parts);
  const datasheetOk = datasheetSatisfiedSkus(docIndex, parts.map((p) => p.sku));
  const coverageAll = coverageRows(parts, articleIdBySku, onBom, datasheetOk);
  const coverageFiltered = filterCoverage(coverageAll, {
    articleId: articleParam || undefined,
    state: stateParam || undefined,
    onBomOnly: bomOnly,
    datasheetOnly,
    q: coverageQ,
  });
  const coverageTotal = coverageFiltered.length;
  const coverageTruncated = coverageTotal > COVERAGE_PAGE;
  const coverageVisible = coverageFiltered.slice(0, COVERAGE_PAGE);

  const coverageArticleOptions = [...articles]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((a) => {
      const sec = sections.find((s) => s.id === a.sectionId);
      return { id: a.id, label: sec ? `${sec.number} · ${a.title}` : a.title };
    });
  const articleTitleById = new Map(articles.map((a) => [a.id, a.title]));

  return (
    <div className="pk-content" style={{ maxWidth: 1080, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div>
          <div className="pk-page-title">Spec library</div>
          <div className="pk-page-sub">
            Sections, the Part 2 articles inside them, and which catalog parts have approved language.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Link href="/design/specs/templates" className="pk-btn-outline" style={{ textDecoration: "none" }}>
            Templates
            <span style={{ marginLeft: 6, fontFamily: "var(--font-mono)", color: "#9aa0ab" }}>{templates.length}</span>
          </Link>
          <a href="#import-export" className="pk-btn-outline" style={{ textDecoration: "none" }}>
            Import / Export
          </a>
        </div>
      </div>

      <AddSectionForm />
      {sections.length === 0 && <SeedStarterSectionsButton />}

      <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 22 }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #f0f1f4", fontSize: 14.5, fontWeight: 600 }}>
          Sections
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1.6fr) 80px 80px 110px 110px 130px", gap: 10, padding: "9px 18px", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
          <span style={TH}>Number</span>
          <span style={TH}>Title</span>
          <span style={{ ...TH, textAlign: "right" }}>Part 1</span>
          <span style={{ ...TH, textAlign: "right" }}>Part 3</span>
          <span style={TH}>Part 2 style</span>
          <span style={TH}>Quantities</span>
          <span style={{ ...TH, textAlign: "right" }}>Articles</span>
        </div>
        {sections.map((s) => {
          const articleCount = (articlesBySection.get(s.id) || []).length;
          return (
            <Link
              key={s.id}
              href={`/design/specs/library/${encodeURIComponent(s.id)}`}
              style={{ display: "grid", gridTemplateColumns: "120px minmax(0,1.6fr) 80px 80px 110px 110px 130px", gap: 10, padding: "11px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}
            >
              <span style={{ ...CELL, fontFamily: "var(--font-mono)" }}>{s.number}</span>
              <span style={{ ...CELL, fontWeight: 600 }}>{s.title}</span>
              <span style={{ ...CELL, textAlign: "right", fontFamily: "var(--font-mono)" }}>{s.part1.length}</span>
              <span style={{ ...CELL, textAlign: "right", fontFamily: "var(--font-mono)" }}>{s.part3.length}</span>
              <span style={CELL}>{PART2_STYLE_LABEL[s.part2Style] || s.part2Style}</span>
              <span style={CELL}>{QUANTITIES_LABEL[s.quantities] || s.quantities}</span>
              <span style={{ ...CELL, textAlign: "right", fontFamily: "var(--font-mono)" }}>{articleCount}</span>
            </Link>
          );
        })}
        {sections.length === 0 && (
          <div style={{ padding: "36px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
            No sections yet — add one above or add the starter sections.
          </div>
        )}
      </div>

      <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 22 }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #f0f1f4", fontSize: 14.5, fontWeight: 600 }}>
          Part 2 articles
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "70px minmax(0,1.3fr) minmax(0,1.1fr) minmax(0,1.3fr) 70px", gap: 10, padding: "9px 18px", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
          <span style={TH}>No.</span>
          <span style={TH}>Article</span>
          <span style={TH}>Manufacturers</span>
          <span style={TH}>Category keys</span>
          <span style={{ ...TH, textAlign: "right" }}>Parts</span>
        </div>
        {sections.map((s) => {
          const rows = articlesBySection.get(s.id) || [];
          if (rows.length === 0) return null;
          return (
            <div key={s.id}>
              <div style={{ padding: "8px 18px", background: "#fbfbfd", borderBottom: "1px solid #f5f6f8", fontSize: 11.5, fontWeight: 600, color: "#5b616e" }}>
                <span style={{ fontFamily: "var(--font-mono)" }}>{s.number}</span> · {s.title}
              </div>
              {rows.map((a, i) => (
                <Link
                  key={a.id}
                  href={`/design/specs/library/${encodeURIComponent(s.id)}`}
                  style={{ display: "grid", gridTemplateColumns: "70px minmax(0,1.3fr) minmax(0,1.1fr) minmax(0,1.3fr) 70px", gap: 10, padding: "10px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}
                >
                  <span style={{ ...CELL, fontFamily: "var(--font-mono)" }}>2.{i + 1}</span>
                  <span style={{ ...CELL, fontWeight: 600 }}>{a.title}</span>
                  <span style={CELL}>{a.manufacturers.join(" · ") || "—"}</span>
                  <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {a.categoryKeys.map((k) => (
                      <span key={k} style={{ fontSize: 10.5, fontWeight: 600, color: "#5b616e", background: "#f1f2f5", border: "1px solid #e4e7ec", padding: "2px 8px", borderRadius: 20 }}>
                        {k}
                      </span>
                    ))}
                    {a.categoryKeys.length === 0 && <span style={{ fontSize: 11.5, color: "#aab0bb" }}>none</span>}
                  </span>
                  <span style={{ ...CELL, textAlign: "right", fontFamily: "var(--font-mono)" }}>{partCountByArticle.get(a.id) || 0}</span>
                </Link>
              ))}
            </div>
          );
        })}
        {articles.length === 0 && (
          <div style={{ padding: "36px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
            No Part 2 articles yet — add one from a section.
          </div>
        )}
      </div>

      <div id="coverage" className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 22 }}>
        <div
          style={{
            padding: "12px 18px",
            borderBottom: "1px solid #f0f1f4",
            fontSize: 14.5,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>Coverage</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#9aa0ab", fontWeight: 500 }}>
            {coverageTruncated ? `Showing ${COVERAGE_PAGE} of ${coverageTotal}` : `${coverageTotal} of ${coverageAll.length}`}
            {" "}part{coverageTotal === 1 ? "" : "s"}
          </span>
        </div>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #f0f1f4" }}>
          <CoverageControls
            q={coverageQ}
            articleId={articleParam}
            state={stateParam || "all"}
            bom={bomOnly}
            datasheet={datasheetOnly}
            articleOptions={coverageArticleOptions}
          />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "130px minmax(0,1.5fr) minmax(0,1.2fr) 100px 80px 80px",
            gap: 10,
            padding: "9px 18px",
            background: "#fafbfc",
            borderBottom: "1px solid #f0f1f4",
          }}
        >
          <span style={TH}>SKU</span>
          <span style={TH}>Description</span>
          <span style={TH}>Article</span>
          <span style={TH}>State</span>
          <span style={{ ...TH, textAlign: "center" }}>On a BOM</span>
          <span style={{ ...TH, textAlign: "center" }}>Datasheet</span>
        </div>
        {coverageVisible.map((r) => {
          const chip = STATE_CHIP[r.state];
          const articleTitle = r.articleId ? articleTitleById.get(r.articleId) : null;
          return (
            <div
              key={r.sku}
              style={{
                display: "grid",
                gridTemplateColumns: "130px minmax(0,1.5fr) minmax(0,1.2fr) 100px 80px 80px",
                gap: 10,
                padding: "10px 18px",
                borderBottom: "1px solid #f5f6f8",
                alignItems: "center",
              }}
            >
              <Link
                href={`/catalog?edit=${encodeURIComponent(r.sku)}`}
                style={{ ...CELL, fontFamily: "var(--font-mono)", fontWeight: 600, textDecoration: "none", color: "inherit" }}
              >
                {r.sku}
              </Link>
              <span style={CELL}>{r.desc || "—"}</span>
              <span style={CELL}>{articleTitle || "—"}</span>
              <span>
                <span style={{ fontSize: 10.5, fontWeight: 600, color: chip.fg, background: chip.bg, padding: "2px 8px", borderRadius: 20 }}>
                  {chip.label}
                </span>
              </span>
              <span style={{ textAlign: "center", color: r.onBom ? "#1f7a52" : "#d5d8de" }}>{r.onBom ? "✓" : "—"}</span>
              <span style={{ textAlign: "center", color: r.hasDatasheet ? "#1f7a52" : "#d5d8de" }}>{r.hasDatasheet ? "✓" : "—"}</span>
            </div>
          );
        })}
        {coverageVisible.length === 0 && (
          <div style={{ padding: "36px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
            No parts match these filters.
          </div>
        )}
        {coverageTruncated && (
          <div style={{ padding: "10px 18px", fontSize: 11.5, color: "#9aa0ab", borderTop: "1px solid #f5f6f8" }}>
            Showing {COVERAGE_PAGE} of {coverageTotal} — narrow the filters.
          </div>
        )}
      </div>

      <div id="import-export">
        <ImportExportLibraryControls />
      </div>

      {legacyUnlinkedParts.length > 0 && (
        <div className="pk-card" style={{ padding: "16px 18px", marginTop: 22 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 6 }}>Displays metadata</div>
          <div style={{ fontSize: 12.5, color: "#8c919c", lineHeight: 1.5, marginBottom: 12 }}>
            {legacyUnlinkedParts.length} part{legacyUnlinkedParts.length === 1 ? "" : "s"} carry research pointers
            from the Displays API that have not been linked to the library yet — the panel and coverage already
            read them as text.
          </div>
          <AdoptLegacyPointersButton />
        </div>
      )}
    </div>
  );
}
