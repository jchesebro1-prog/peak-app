import { money } from "@/lib/format";
import type { Quote } from "@/lib/stores/quotes";
import type { WidgetCtx, WidgetRenderer } from "@/lib/dashboard/context";
import { periodBounds, salesBuckets, salesMetrics, wonAt } from "@/lib/dashboard/metrics";
import {
  ACCENT,
  ChartCard,
  Donut,
  Legend,
  MonoBadge,
  StackedBars,
  StageBars,
  initialsOf,
  moneyK,
  pctDelta,
  ptDelta,
} from "../charts";
import { tile } from "./tile";

/** #43 — Reports › Sales as widgets. Period = ?range (history contract). */

async function period(ctx: WidgetCtx) {
  const quotes = await ctx.data.quotes();
  const { start, end, priorStart } = periodBounds(ctx.range, ctx.now);
  return {
    quotes,
    cur: salesMetrics(quotes, start, end),
    prior: salesMetrics(quotes, priorStart, start),
    start,
  };
}

export const SALES_RENDERERS = {
  "total-quoted": async (ctx) => {
    const { cur, prior } = await period(ctx);
    return tile("Total quoted", money(cur.quotedValue), `${pctDelta(cur.quotedValue, prior.quotedValue)} vs. prior`);
  },
  "won-value": async (ctx) => {
    const { cur, prior } = await period(ctx);
    return tile("Won value", money(cur.wonValue), `${pctDelta(cur.wonValue, prior.wonValue)} vs. prior`, "green");
  },
  "win-rate": async (ctx) => {
    const { cur, prior } = await period(ctx);
    return tile("Win rate", `${Math.round(cur.winRate)}%`, `${ptDelta(cur.winRate, prior.winRate)} vs. prior`);
  },
  "avg-quote": async (ctx) => {
    const { cur, prior } = await period(ctx);
    return tile("Avg. quote", money(cur.avg), `${pctDelta(cur.avg, prior.avg)} vs. prior`);
  },

  "quoted-vs-won": async (ctx) => {
    const quotes = await ctx.data.quotes();
    const buckets = salesBuckets(ctx.range, ctx.now);
    const barData = buckets.map((bk) => ({
      label: bk.label,
      quoted: quotes.filter((q) => (q.createdAt || 0) >= bk.start && (q.createdAt || 0) < bk.end).reduce((s, q) => s + (q.value || 0), 0),
      won: quotes.filter((q) => q.status === "won" && wonAt(q) >= bk.start && wonAt(q) < bk.end).reduce((s, q) => s + (q.value || 0), 0),
    }));
    const maxQuoted = Math.max(1, ...barData.map((b) => b.quoted));
    const bars = barData.map((b) => ({
      label: b.label, top: b.won ? moneyK(b.won) : "",
      basePct: Math.round((b.quoted / maxQuoted) * 100), frontPct: Math.round((b.won / maxQuoted) * 100),
    }));
    return (
      <ChartCard title="Quoted vs. won by month" right={<Legend items={[{ color: "#dfe2e8", label: "Quoted" }, { color: ACCENT, label: "Won" }]} />}>
        <StackedBars bars={bars} frontColor={ACCENT} />
      </ChartCard>
    );
  },

  "pipeline-by-stage": async (ctx) => {
    const quotes = await ctx.data.quotes();
    const inReview = (q: Quote) => q.review?.state === "in_review";
    const sum = (arr: Quote[]) => arr.reduce((s, q) => s + (q.value || 0), 0);
    const draftQ = quotes.filter((q) => q.status === "draft" && !inReview(q));
    const sentQ = quotes.filter((q) => q.status === "sent" && !inReview(q));
    const reviewQ = quotes.filter((q) => inReview(q) && (q.status === "draft" || q.status === "sent"));
    const rows = [
      { label: "Draft", count: draftQ.length, value: sum(draftQ), color: "#c9a23a" },
      { label: "Sent", count: sentQ.length, value: sum(sentQ), color: "#3155a8" },
      { label: "In review", count: reviewQ.length, value: sum(reviewQ), color: ACCENT },
    ].filter((r) => r.count > 0);
    return (
      <div className="pk-card" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 16 }}>Open pipeline by stage</div>
        <StageBars rows={rows} />
      </div>
    );
  },

  "win-donut": async (ctx) => {
    const { cur } = await period(ctx);
    const decided = cur.won + cur.lost;
    const wonDeg = decided ? Math.round((cur.won / decided) * 360) : 0;
    return (
      <div className="pk-card" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>Win rate</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 16 }}>Decided quotes this period</div>
        <Donut
          gradient={`conic-gradient(${ACCENT} 0deg ${wonDeg}deg, #d98a7a ${wonDeg}deg 360deg)`}
          center={`${Math.round(cur.winRate)}%`}
          centerSub="win rate"
          legend={[{ color: ACCENT, label: "Won", value: String(cur.won) }, { color: "#d98a7a", label: "Lost", value: String(cur.lost) }]}
        />
      </div>
    );
  },

  "top-customers": async (ctx) => {
    const { quotes, start } = await period(ctx);
    const byCust = new Map<string, { value: number; n: number }>();
    quotes.filter((q) => q.status === "won" && wonAt(q) >= start).forEach((q) => {
      const key = q.customer || "—";
      const e = byCust.get(key) || { value: 0, n: 0 };
      e.value += q.value || 0;
      e.n += 1;
      byCust.set(key, e);
    });
    const top = [...byCust.entries()].map(([name, e]) => ({ name, ...e })).sort((a, b) => b.value - a.value).slice(0, 4);
    return (
      <div className="pk-card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "15px 18px 12px", borderBottom: "1px solid #f0f1f4", fontSize: 14.5, fontWeight: 600 }}>Top customers by won value</div>
        {top.map((c) => (
          <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 11, padding: "12px 18px", borderBottom: "1px solid #f5f6f8" }}>
            <MonoBadge>{initialsOf(c.name)}</MonoBadge>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
              <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 1 }}>{c.n} {c.n === 1 ? "project" : "projects"}</div>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>{money(c.value)}</span>
          </div>
        ))}
        {top.length === 0 && <div style={{ padding: "22px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>No won quotes in this period.</div>}
      </div>
    );
  },

  "pipeline-by-estimator": async (ctx) => {
    const quotes = await ctx.data.quotes();
    const byOwner = new Map<
      string,
      { open: number; openN: number; won: number; wonN: number; lostN: number }
    >();
    quotes.forEach((q) => {
      const e = byOwner.get(q.owner) || { open: 0, openN: 0, won: 0, wonN: 0, lostN: 0 };
      if (q.status === "draft" || q.status === "sent") {
        e.open += q.value || 0;
        e.openN += 1;
      } else if (q.status === "won") {
        e.won += q.value || 0;
        e.wonN += 1;
      } else if (q.status === "lost") {
        e.lostN += 1;
      }
      byOwner.set(q.owner, e);
    });
    const owners = [...byOwner.entries()]
      .map(([owner, e]) => ({
        owner,
        ...e,
        winRate: e.wonN + e.lostN ? Math.round((e.wonN / (e.wonN + e.lostN)) * 100) : 0,
      }))
      .sort((a, b) => b.open - a.open);

    return (
      <div className="pk-card" style={{ overflow: "hidden", marginTop: 18 }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            padding: "16px 20px 13px",
            borderBottom: "1px solid #f0f1f4",
            flexWrap: "wrap",
            rowGap: 6,
          }}
        >
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Pipeline by estimator</div>
            <div style={{ fontSize: 12, color: "#8c919c", marginTop: 3 }}>
              Open pipeline, won value and win rate per team member — all-time
            </div>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0,1fr) 110px 60px 110px 70px",
            gap: 8,
            padding: "9px 20px",
            fontSize: 9.5,
            fontWeight: 600,
            color: "#aab0bb",
            textTransform: "uppercase",
            letterSpacing: ".04em",
            borderBottom: "1px solid #f3f4f7",
          }}
        >
          <span>Estimator</span>
          <span style={{ textAlign: "right" }}>Open pipeline</span>
          <span style={{ textAlign: "right" }}>Open</span>
          <span style={{ textAlign: "right" }}>Won value</span>
          <span style={{ textAlign: "right" }}>Win rate</span>
        </div>
        {owners.map((o) => (
          <div
            key={o.owner}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 110px 60px 110px 70px",
              gap: 8,
              padding: "11px 20px",
              fontSize: 12.5,
              alignItems: "center",
              borderBottom: "1px solid #f5f6f8",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <MonoBadge>{initialsOf(o.owner)}</MonoBadge>
              <span
                style={{
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {o.owner}
              </span>
            </span>
            <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}>
              {money(o.open)}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#8c919c" }}>
              {o.openN}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#1f7a52" }}>
              {money(o.won)}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#5b616e" }}>
              {o.winRate}%
            </span>
          </div>
        ))}
        {owners.length === 0 && (
          <div style={{ padding: "22px 20px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No quotes yet.
          </div>
        )}
      </div>
    );
  },
} satisfies Record<string, WidgetRenderer>;
