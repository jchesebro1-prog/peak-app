import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getSettings } from "@/lib/settings";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { list as listCatalog } from "@/lib/stores/catalog";
import { resolveCategoryShapes } from "@/lib/design/grid-symbols";
import { resolveWireTypes } from "@/lib/catalog-connect";
import { GROUPS, value as pricingValue, type RateEntry } from "@/lib/stores/pricing";
import { buildPortRuleReport, type PortReportPart } from "@/lib/catalog-port-report";
import { GridSymbolsCard } from "./grid-symbols-card";
import { WireTypesCard } from "./wire-types-card";
import { LaborHoursCard } from "./labor-hours-card";
import { PortRulesCard, type PortRuleRowVM } from "./port-rules-card";

export const metadata = { title: "Grid settings — Quartzite-6" };

/**
 * Grid Settings (/design/grid/settings, D-grid-settings) — the admin
 * configuration screens The Grid needs but Settings never had room for:
 * per-category symbol shapes (moved here after sitting orphaned since
 * settings/page.tsx commit 2855d84), a review UI over the #159 port-rules
 * engine, the wire-type registry Grid wiring validation actually reads now,
 * and the install-hours-per-device knob. Admin-only (manage_users), same
 * gate as every other data-administration screen (Estimating Rules,
 * Task Templates, Catalog admin cards).
 */
export default async function GridSettingsPage() {
  const user = await requireUser();
  const isAdmin = can("manage_users", user.roles);

  if (!isAdmin) {
    return (
      <div className="pk-content" style={{ maxWidth: 960 }}>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", marginBottom: 20 }}>
          Grid settings
        </div>
        <div className="pk-card" style={{ padding: "48px 24px", textAlign: "center" }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: "#f1f2f5",
              color: "#8c919c",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              margin: "0 auto 14px",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Admin access required</div>
          <div style={{ fontSize: 13, color: "#9aa0ab", marginTop: 6, lineHeight: 1.55 }}>
            Grid symbols, wire types, port rules, and pricing knobs are limited to admins.
          </div>
        </div>
      </div>
    );
  }

  const [gridSymbols, settings, catalog] = await Promise.all([
    listGridSymbols(),
    getSettings(),
    listCatalog(),
  ]);

  // Grid symbols card (#131, D154) — live catalog categories, derived the
  // same way design/grid/[id]/page.tsx derives them for the editor's own
  // parts list, so the card can show a category no default matches.
  const gridLiveCategories = Array.from(new Set(gridSymbols.map((s) => s.category || "Other"))).sort();
  const categoryShapes = resolveCategoryShapes(settings.gridCategoryShapes);
  const wireTypes = resolveWireTypes(settings.wireTypes);

  const laborRate = GROUPS.flatMap((g) => g.items).find(
    (it): it is RateEntry => it.kind === "rate" && it.id === "grid.laborHoursPerDevice"
  );
  const laborValue = laborRate ? (await pricingValue(laborRate)) ?? laborRate.def : 0.5;
  const laborDef = laborRate?.def ?? 0.5;

  // Port rules review (#159) — one pass over the full catalog (~37,400 parts
  // in prod) via listCatalog() above, called exactly once for this request;
  // buildPortRuleReport does its own single pass, never one scan per rule.
  const reportParts: PortReportPart[] = catalog.map((p) => ({
    sku: p.sku,
    desc: p.desc,
    category: p.category,
    mfr: p.mfr,
    hasPorts: Array.isArray(p.ports) && p.ports.length > 0,
  }));
  const report = buildPortRuleReport(reportParts);
  const portRuleRows: PortRuleRowVM[] = report.rows.map((row) => ({
    id: row.rule.id,
    mfr: row.rule.mfr || null,
    category: row.rule.category ? row.rule.category.source : null,
    note: row.rule.note,
    shapes: row.shapes.map((s) => ({ key: s.key, count: s.count })),
    matchCount: row.hits.length,
    samples: row.hits.slice(0, 5).map((h) => ({ sku: h.sku, desc: h.desc })),
    matchesNothing: row.hits.length === 0,
    overBroad: row.overBroad,
  }));
  const matchedTotal = report.rows.reduce((sum, r) => sum + r.hits.length, 0);

  const RELATED = [
    { label: "Catalog — Categories & trades", href: "/catalog", desc: "Category → group/trade mapping the Grid editor reads." },
    { label: "Catalog — part ports editor", href: "/catalog", desc: "Per-part port editing, one SKU at a time." },
    { label: "Assembly Builder", href: "/design/assemblies", desc: "Multi-part subassemblies placed as one Grid device." },
    { label: "Lineset Builder", href: "/design/lineset", desc: "Line-set layouts referenced from a Grid design." },
    { label: "Motor Library", href: "/design/motors", desc: "Motorized rigging catalog used by Grid rigging scope." },
  ];

  return (
    <div className="pk-content" style={{ maxWidth: 960 }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap", rowGap: 12, marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>Grid settings</div>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".06em",
                color: "#8a6d1f",
                background: "#fbf3dd",
                border: "1px solid #f0e2bd",
                padding: "3px 9px",
                borderRadius: 6,
              }}
            >
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 4 }}>
            Symbol shapes, port rules, wire types, and install labor — the settings specific to The
            Grid.
          </div>
        </div>
      </div>

      <GridSymbolsCard
        key={JSON.stringify(categoryShapes) + "::" + gridLiveCategories.join("|")}
        shapes={categoryShapes}
        liveCategories={gridLiveCategories}
      />

      <PortRulesCard
        rows={portRuleRows}
        stats={{
          partsConsidered: reportParts.length,
          alreadyPorted: report.alreadyPorted,
          noDesc: report.noDesc,
          accessoryCount: report.accessoryRows.length,
          matchedTotal,
          unmatchedTotal: report.unmatched.length,
        }}
      />

      <WireTypesCard key={JSON.stringify(wireTypes)} wireTypes={wireTypes} />

      <LaborHoursCard value={laborValue} def={laborDef} />

      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Related settings</div>
        <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, marginBottom: 12 }}>
          Configured elsewhere, but the Grid editor reads all of these.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {RELATED.map((s) => (
            <Link
              key={s.label}
              href={s.href}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                border: "1px solid #eef0f3",
                borderRadius: 10,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{s.label}</span>
                <span style={{ display: "block", fontSize: 12, color: "#8c919c", marginTop: 2 }}>{s.desc}</span>
              </span>
              <span aria-hidden style={{ color: "#b7bcc6", fontSize: 16 }}>→</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
