import Link from "next/link";
import { money } from "@/lib/format";
import { fmtDate, type ProjectRecord } from "@/lib/stores/projects";
import type { WidgetCtx, WidgetRenderer } from "@/lib/dashboard/context";
import { dashHref } from "@/lib/dashboard/registry";
import { backlogProjects, equipmentSold, openProjects, periodBounds, projectedProfit, salesMetrics } from "@/lib/dashboard/metrics";
import { ChartCard, MonoBadge, initialsOf } from "../charts";
import { tile } from "./tile";

/** #43 spec task 4 — the first backward widgets. */

const base = (ctx: WidgetCtx) => (ctx.surface === "home" ? "/" : "/reports");
const keep = (ctx: WidgetCtx) => ({ range: ctx.sp.range, customize: ctx.sp.customize });

function ProjectList({ title, sub, rows, empty }: { title: string; sub: string; rows: ProjectRecord[]; empty: string }) {
  return (
    <div className="pk-card" style={{ overflow: "hidden" }}>
      <div style={{ padding: "15px 18px 12px", borderBottom: "1px solid #f0f1f4" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 2 }}>{sub}</div>
      </div>
      {rows.slice(0, 8).map((p) => (
        <Link key={p.id} href={`/projects?id=${encodeURIComponent(p.id)}`} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}>
          <MonoBadge>{initialsOf(p.customer)}</MonoBadge>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
            <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 2 }}>{p.customer} · {p.targetDate ? `target ${fmtDate(p.targetDate)}` : "no target"}</div>
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>{money(p.value)}</span>
        </Link>
      ))}
      {rows.length === 0 && <div style={{ padding: "22px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>{empty}</div>}
    </div>
  );
}

export const BACKWARD_RENDERERS = {
  "avg-margin": async (ctx) => {
    const quotes = await ctx.data.quotes();
    const { start, end, priorStart } = periodBounds(ctx.range, ctx.now);
    const cur = salesMetrics(quotes, start, end);
    const prior = salesMetrics(quotes, priorStart, start);
    const pt = Math.round((cur.avgMargin - prior.avgMargin) * 100);
    return tile("Avg. margin", `${Math.round(cur.avgMargin * 100)}%`, `${pt >= 0 ? "+" : ""}${pt}pt vs. prior · quotes created`);
  },

  "projected-profit": async (ctx) => {
    const pp = projectedProfit(await ctx.data.projects());
    return tile("Projected profit", money(pp.profit), `${Math.round(pp.margin * 100)}% of ${money(pp.value)} open book`, "green");
  },

  "open-projects": async (ctx) => (
    <ProjectList title="Open projects" sub="Crews scheduled or on site" rows={openProjects(await ctx.data.projects())} empty="Nothing on site right now." />
  ),

  backlog: async (ctx) => (
    <ProjectList title="Backlog" sub="Sold — in procurement or delivery" rows={backlogProjects(await ctx.data.projects())} empty="No sold work waiting on materials." />
  ),

  "equipment-sold": async (ctx) => {
    const [quotes, parts] = await Promise.all([ctx.data.quotes(), ctx.data.catalogParts()]);
    const cat = new Map(parts.map((p) => [p.sku, p.category]));
    const { start, end } = periodBounds(ctx.range, ctx.now);
    const rows = equipmentSold(quotes, (sku) => cat.get(sku), start, end);
    const drill = ctx.sp.drill ? rows.find((r) => r.category === ctx.sp.drill) : null;
    const max = Math.max(1, ...(drill ? drill.items.map((i) => i.value) : rows.map((r) => r.value)));
    const bar = (v: number) => (
      <div style={{ height: 6, background: "#f1f2f5", borderRadius: 6, overflow: "hidden", marginTop: 5 }}>
        <div style={{ height: "100%", width: `${Math.round((v / max) * 100)}%`, background: "var(--accent)", borderRadius: 6 }} />
      </div>
    );
    const line = (key: string, label: string, sub: string, value: number, href?: string) => {
      const inner = (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5 }}>
            <span style={{ fontWeight: 600, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, flexShrink: 0 }}>{money(value)}</span>
          </div>
          <div style={{ fontSize: 10.5, color: "#aab0bb" }}>{sub}</div>
          {bar(value)}
        </>
      );
      const style: React.CSSProperties = { display: "block", padding: "9px 0", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" };
      return href ? <Link key={key} href={href} style={style}>{inner}</Link> : <div key={key} style={style}>{inner}</div>;
    };
    return (
      <ChartCard
        title={drill ? `Equipment sold — ${drill.category}` : "Equipment sold"}
        right={drill
          ? <Link href={dashHref(base(ctx), keep(ctx))} style={{ fontSize: 12, color: "var(--accent-ink)", textDecoration: "none" }}>All categories</Link>
          : <span style={{ fontSize: 11.5, color: "#8c919c" }}>won quotes, by catalog category</span>}
      >
        {drill
          ? drill.items.slice(0, 12).map((i) => line(i.sku || i.desc, i.desc, `${i.sku || "custom"} · ${i.qty} sold`, i.value))
          : rows.slice(0, 8).map((r) => line(r.category, r.category, `${r.items.length} items · ${r.qty} units`, r.value, dashHref(base(ctx), { ...keep(ctx), drill: r.category })))}
        {rows.length === 0 && <div style={{ fontSize: 12.5, color: "#9aa0ab", padding: "8px 0" }}>No won line items in this period.</div>}
      </ChartCard>
    );
  },
} satisfies Record<string, WidgetRenderer>;
