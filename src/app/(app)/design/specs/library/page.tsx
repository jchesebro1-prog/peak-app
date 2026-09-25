import Link from "next/link";
import { requireUser } from "@/lib/session";
import * as Sections from "@/lib/stores/spec-sections";
import * as Articles from "@/lib/stores/spec-articles";
import * as Templates from "@/lib/stores/spec-templates";
import * as Catalog from "@/lib/stores/catalog";
import { articleIdForPart, type SpecCategoryArticle } from "@/lib/specs/articles";
import { AddSectionForm, AdoptLegacyPointersButton, ImportExportLibraryControls, SeedStarterSectionsButton } from "./controls";

/**
 * Task 8 — the Specs library index: the Sections table (with the inline
 * "+ Add section" form and, when empty, the starter-sections seed button),
 * the Part 2 articles table grouped by section, mount points for Task 11's
 * import/export controls and Task 12's coverage table, and the Displays
 * "legacy pointers" adoption card (D-SPEC-5).
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

export default async function SpecLibraryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  // No filters on this screen yet — awaited to match the Vendors idiom.
  await searchParams;
  // Owner decision: the starter formulas auto-seed when empty on ANY
  // environment, from whichever read path lists templates first.
  await Templates.ensureStarterTemplates();

  const [sections, articles, parts, templates] = await Promise.all([
    Sections.allSections(),
    Articles.allArticles(),
    Catalog.list(),
    Templates.allTemplates(),
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

  const partCountByArticle = new Map<string, number>();
  for (const p of parts) {
    const aid = articleIdForPart(p, articles, sections);
    if (aid) partCountByArticle.set(aid, (partCountByArticle.get(aid) || 0) + 1);
  }

  // D-SPEC-5: parts still carrying Displays research text with no matching
  // canonical pointer — the card below offers to fill what it can.
  const legacyUnlinkedParts = parts.filter((p) => {
    const md = p.productMetadata;
    if (!md) return false;
    if (md.specSection && !p.specSectionId) return true;
    if (md.specArticle && !p.specArticleId) return true;
    return false;
  });

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

      {/* Task 12 mounts the coverage table here. */}

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
