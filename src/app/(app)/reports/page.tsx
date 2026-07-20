import Link from "next/link";
import { requireUser } from "@/lib/session";
import { money } from "@/lib/format";
import { KpiTile } from "@/components/ui";
import { getAll as getQuotes, type Quote } from "@/lib/stores/quotes";
import { allEngagements, type ConsultingEngagement } from "@/lib/stores/engagements";
import {
  getAllProjects,
  type ProjectRecord,
  type ProjectStage,
} from "@/lib/stores/projects";
import { all as getCustomers } from "@/lib/stores/customers";
import { ReportsMap } from "./controls";
import type { MapPin } from "@/components/map/LeafletMap";

export const metadata = { title: "Reports — Peak Backend" };

/**
 * Reports — port of app/Reports.dc.html. Two dashboards driven by URL state
 * (?view=sales|installs, ?range=…, ?ir=…): a Sales pipeline dashboard computed
 * from the quotes store, and an Installs backlog / billing-forecast dashboard
 * computed from the projects store. Read-only; nothing here mutates a store.
 *
 * Deviation from the prototype (which was 100% demo data): the prototype's
 * "Most-quoted products · projected 4-quarter need" table has no backing data —
 * quotes carry no product line items in the store — so it is replaced with a
 * real "Pipeline by estimator" breakdown. See report / MASTER-QUESTIONS.
 */

const ACCENT = "var(--accent)";
const DAY = 86400000;

/* ---------------- shared helpers ---------------- */

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function moneyK(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1000) return "$" + Math.round(v / 1000) + "k";
  return "$" + v;
}

function initialsOf(name: string): string {
  const w = (name || "").trim().split(/\s+/);
  return ((w[0]?.[0] || "") + (w[1]?.[0] || "")).toUpperCase() || "—";
}

function pctDelta(cur: number, prior: number): string {
  if (!prior) return "—";
  const d = Math.round(((cur - prior) / prior) * 100);
  return (d >= 0 ? "+" : "") + d + "%";
}

function ptDelta(cur: number, prior: number): string {
  const d = Math.round(cur - prior);
  return (d >= 0 ? "+" : "") + d + "pt";
}

function monthLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short" });
}
function monYear(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

/* ---------------- bucketing ---------------- */

type Bucket = { start: number; end: number; label: string };

function lastMonths(k: number): Bucket[] {
  const now = new Date();
  const arr: Bucket[] = [];
  for (let i = k - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    arr.push({
      start: start.getTime(),
      end: end.getTime(),
      label: start.toLocaleDateString("en-US", { month: "short" }),
    });
  }
  return arr;
}

function salesBuckets(range: string): Bucket[] {
  if (range === "qtr") return lastMonths(3);
  if (range === "12m") {
    const m = lastMonths(12);
    const q: Bucket[] = [];
    for (let i = 0; i < 4; i++) {
      const chunk = m.slice(i * 3, i * 3 + 3);
      q.push({ start: chunk[0].start, end: chunk[2].end, label: `Q${i + 1}` });
    }
    return q;
  }
  return lastMonths(6);
}

/* ======================================================================= */

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUser();
  const sp = await searchParams;

  const view = one(sp.view) === "installs" ? "installs" : "sales";
  const range = ["qtr", "6m", "12m"].includes(one(sp.range) || "")
    ? (one(sp.range) as string)
    : "6m";
  const ir = ["6m", "12m", "18m"].includes(one(sp.ir) || "")
    ? (one(sp.ir) as string)
    : "12m";

  const [quotes, projects, customers, engagements] = await Promise.all([
    getQuotes(),
    getAllProjects(),
    getCustomers(),
    allEngagements(),
  ]);

  const modeHref = (v: string) =>
    v === "installs" ? `/reports?view=installs&ir=${ir}` : `/reports?view=sales&range=${range}`;

  return (
    <div className="pk-content" style={{ maxWidth: 1180 }}>
      {/* header: title + mode toggle + range */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 22,
          flexWrap: "wrap",
          rowGap: 12,
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap" }}>
            <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Reports</div>
            <div style={{ display: "flex", gap: 4, background: "#eceef1", borderRadius: 9, padding: 4 }}>
              {(["sales", "installs"] as const).map((m) => {
                const on = view === m;
                return (
                  <Link
                    key={m}
                    href={modeHref(m)}
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      padding: "6px 16px",
                      borderRadius: 7,
                      textDecoration: "none",
                      background: on ? ACCENT : "transparent",
                      color: on ? "#fff" : "#6b7180",
                    }}
                  >
                    {m === "sales" ? "Sales" : "Installs"}
                  </Link>
                );
              })}
            </div>
          </div>
          <div style={{ fontSize: 13, color: "#8c919c", marginTop: 6 }}>
            {view === "installs"
              ? `Project backlog, delivery landing & billing forecast — next ${ir.replace("m", " months")}`
              : `Pipeline health and quoting performance — ${
                  range === "qtr" ? "this quarter" : range === "12m" ? "last 12 months" : "last 6 months"
                }`}
          </div>
        </div>
        <RangeChips view={view} range={range} ir={ir} />
      </div>

      {view === "sales" ? (
        <SalesView quotes={quotes} range={range} />
      ) : (
        <InstallsView projects={projects} customers={customers} engagements={engagements} ir={ir} />
      )}
    </div>
  );
}

/* ---------------- range selector ---------------- */

function RangeChips({ view, range, ir }: { view: string; range: string; ir: string }) {
  const opts =
    view === "installs"
      ? [
          { key: "6m", label: "6 months" },
          { key: "12m", label: "12 months" },
          { key: "18m", label: "18 months" },
        ]
      : [
          { key: "qtr", label: "Quarter" },
          { key: "6m", label: "6 months" },
          { key: "12m", label: "12 months" },
        ];
  const active = view === "installs" ? ir : range;
  const hrefFor = (k: string) =>
    view === "installs" ? `/reports?view=installs&ir=${k}` : `/reports?view=sales&range=${k}`;
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        background: "#fff",
        border: "1px solid #e4e7ec",
        borderRadius: 10,
        padding: 4,
      }}
    >
      {opts.map((o) => {
        const on = active === o.key;
        return (
          <Link
            key={o.key}
            href={hrefFor(o.key)}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 13px",
              borderRadius: 7,
              textDecoration: "none",
              background: on ? ACCENT : "transparent",
              color: on ? "#fff" : "#8c919c",
            }}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

/* ---------------- small presentational bits ---------------- */

function ChartCard({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="pk-card" style={{ padding: "18px 20px 14px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

function StackedBars({
  bars,
  frontColor,
}: {
  bars: Array<{ label: string; top: string; basePct: number; frontPct: number }>;
  frontColor: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 14,
        height: 208,
        paddingBottom: 24,
        borderBottom: "1px solid #f0f1f4",
      }}
    >
      {bars.map((b, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            height: "100%",
            justifyContent: "flex-end",
            position: "relative",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "#aab0bb",
              marginBottom: 6,
            }}
          >
            {b.top}
          </div>
          <div
            style={{
              position: "relative",
              width: "100%",
              maxWidth: 46,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              height: 150,
            }}
          >
            <div
              style={{
                width: "100%",
                background: "#eef0f3",
                borderRadius: "5px 5px 0 0",
                height: `${b.basePct}%`,
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: 0,
                width: "100%",
                background: frontColor,
                borderRadius: "5px 5px 0 0",
                height: `${b.frontPct}%`,
              }}
            />
          </div>
          <div
            style={{
              position: "absolute",
              bottom: -22,
              fontSize: 11,
              fontWeight: 500,
              color: "#8c919c",
            }}
          >
            {b.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function StageBars({
  rows,
}: {
  rows: Array<{ label: string; count: number; value: number; color: string }>;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <>
      {rows.map((s) => (
        <div key={s.label} style={{ marginBottom: 15 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 6,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span
                style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }}
              />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.label}</span>
              <span style={{ fontSize: 11.5, color: "#aab0bb" }}>{s.count} open</span>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600 }}>
              {money(s.value)}
            </span>
          </div>
          <div style={{ height: 8, background: "#f1f2f5", borderRadius: 6, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                borderRadius: 6,
                width: `${Math.round((s.value / max) * 100)}%`,
                background: s.color,
              }}
            />
          </div>
        </div>
      ))}
      {rows.length === 0 && (
        <div style={{ fontSize: 12.5, color: "#9aa0ab", padding: "8px 0" }}>Nothing open.</div>
      )}
    </>
  );
}

function Donut({
  gradient,
  center,
  centerSub,
  legend,
}: {
  gradient: string;
  center: string;
  centerSub: string;
  legend: Array<{ color: string; label: string; value: string }>;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
      <div
        style={{
          width: 104,
          height: 104,
          borderRadius: "50%",
          flexShrink: 0,
          background: gradient,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 74,
            height: 74,
            borderRadius: "50%",
            background: "#fff",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 600 }}>
            {center}
          </span>
          <span
            style={{
              fontSize: 9.5,
              color: "#aab0bb",
              letterSpacing: ".04em",
              textTransform: "uppercase",
            }}
          >
            {centerSub}
          </span>
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 11 }}>
        {legend.map((w) => (
          <div key={w.label} style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span
              style={{ width: 10, height: 10, borderRadius: 3, background: w.color, flexShrink: 0 }}
            />
            <span style={{ fontSize: 12.5, flex: 1 }}>{w.label}</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>
              {w.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MonoBadge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: "#f1f2f5",
        color: "#5b616e",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: 11,
        fontFamily: "var(--font-mono)",
        flexShrink: 0,
      }}
    >
      {children}
    </span>
  );
}

const GRID_MAIN: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 340px",
  gap: 18,
  alignItems: "start",
};

/* ======================================================================= */
/* ==============================  SALES  ================================= */
/* ======================================================================= */

function wonAt(q: Quote): number {
  const h = (q.history || []).filter((e) => e.to === "won");
  return h.length ? h[h.length - 1].at : q.updatedAt || 0;
}
function decidedAt(q: Quote): number {
  const h = (q.history || []).filter((e) => e.to === "won" || e.to === "lost");
  return h.length ? h[h.length - 1].at : q.updatedAt || 0;
}

function SalesView({ quotes, range }: { quotes: Quote[]; range: string }) {
  const buckets = salesBuckets(range);
  const periodStart = buckets[0].start;
  const now = Date.now();
  const periodLen = now - periodStart;
  const priorStart = periodStart - periodLen;

  const metrics = (a: number, b: number) => {
    const created = quotes.filter((q) => (q.createdAt || 0) >= a && (q.createdAt || 0) < b);
    const quotedValue = created.reduce((s, q) => s + (q.value || 0), 0);
    const wonList = quotes.filter((q) => q.status === "won" && wonAt(q) >= a && wonAt(q) < b);
    const lostList = quotes.filter((q) => q.status === "lost" && decidedAt(q) >= a && decidedAt(q) < b);
    const wonValue = wonList.reduce((s, q) => s + (q.value || 0), 0);
    const decided = wonList.length + lostList.length;
    return {
      quotedValue,
      avg: created.length ? quotedValue / created.length : 0,
      wonValue,
      won: wonList.length,
      lost: lostList.length,
      winRate: decided ? (wonList.length / decided) * 100 : 0,
    };
  };

  const cur = metrics(periodStart, now + 1);
  const prior = metrics(priorStart, periodStart);

  // bar chart: quoted (created) vs won (won-at) per bucket
  const barData = buckets.map((bk) => {
    const quoted = quotes
      .filter((q) => (q.createdAt || 0) >= bk.start && (q.createdAt || 0) < bk.end)
      .reduce((s, q) => s + (q.value || 0), 0);
    const won = quotes
      .filter((q) => q.status === "won" && wonAt(q) >= bk.start && wonAt(q) < bk.end)
      .reduce((s, q) => s + (q.value || 0), 0);
    return { label: bk.label, quoted, won };
  });
  const maxQuoted = Math.max(1, ...barData.map((b) => b.quoted));
  const bars = barData.map((b) => ({
    label: b.label,
    top: b.won ? moneyK(b.won) : "",
    basePct: Math.round((b.quoted / maxQuoted) * 100),
    frontPct: Math.round((b.won / maxQuoted) * 100),
  }));

  // open pipeline by stage (live snapshot)
  const inReview = (q: Quote) => q.review?.state === "in_review";
  const draftQ = quotes.filter((q) => q.status === "draft" && !inReview(q));
  const sentQ = quotes.filter((q) => q.status === "sent" && !inReview(q));
  const reviewQ = quotes.filter((q) => inReview(q) && (q.status === "draft" || q.status === "sent"));
  const sum = (arr: Quote[]) => arr.reduce((s, q) => s + (q.value || 0), 0);
  const stageRows = [
    { label: "Draft", count: draftQ.length, value: sum(draftQ), color: "#c9a23a" },
    { label: "Sent", count: sentQ.length, value: sum(sentQ), color: "#3155a8" },
    { label: "In review", count: reviewQ.length, value: sum(reviewQ), color: ACCENT },
  ].filter((r) => r.count > 0);

  // win donut (decided in period)
  const decided = cur.won + cur.lost;
  const wonDeg = decided ? Math.round((cur.won / decided) * 360) : 0;
  const winGradient = `conic-gradient(${ACCENT} 0deg ${wonDeg}deg, #d98a7a ${wonDeg}deg 360deg)`;

  // top customers by won value in period
  const wonInPeriod = quotes.filter((q) => q.status === "won" && wonAt(q) >= periodStart);
  const byCust = new Map<string, { value: number; n: number }>();
  wonInPeriod.forEach((q) => {
    const key = q.customer || "—";
    const e = byCust.get(key) || { value: 0, n: 0 };
    e.value += q.value || 0;
    e.n += 1;
    byCust.set(key, e);
  });
  const topCustomers = [...byCust.entries()]
    .map(([name, e]) => ({ name, value: e.value, n: e.n }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);

  // pipeline by estimator (real replacement for the demo product-projection table)
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
    <div>
      {/* KPI strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 13,
          marginBottom: 18,
        }}
      >
        <KpiTile
          label="Total quoted"
          value={money(cur.quotedValue)}
          sub={`${pctDelta(cur.quotedValue, prior.quotedValue)} vs. prior`}
        />
        <KpiTile
          label="Won value"
          value={money(cur.wonValue)}
          tone="green"
          sub={`${pctDelta(cur.wonValue, prior.wonValue)} vs. prior`}
        />
        <KpiTile
          label="Win rate"
          value={`${Math.round(cur.winRate)}%`}
          sub={`${ptDelta(cur.winRate, prior.winRate)} vs. prior`}
        />
        <KpiTile
          label="Avg. quote"
          value={money(cur.avg)}
          sub={`${pctDelta(cur.avg, prior.avg)} vs. prior`}
        />
      </div>

      <div style={GRID_MAIN}>
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <ChartCard
            title="Quoted vs. won by month"
            right={
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#8c919c" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: "#dfe2e8" }} />
                  Quoted
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#8c919c" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: ACCENT }} />
                  Won
                </span>
              </div>
            }
          >
            <StackedBars bars={bars} frontColor={ACCENT} />
          </ChartCard>

          <div className="pk-card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 16 }}>
              Open pipeline by stage
            </div>
            <StageBars rows={stageRows} />
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="pk-card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>Win rate</div>
            <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 16 }}>
              Decided quotes this period
            </div>
            <Donut
              gradient={winGradient}
              center={`${Math.round(cur.winRate)}%`}
              centerSub="win rate"
              legend={[
                { color: ACCENT, label: "Won", value: String(cur.won) },
                { color: "#d98a7a", label: "Lost", value: String(cur.lost) },
              ]}
            />
          </div>

          <div className="pk-card" style={{ overflow: "hidden" }}>
            <div
              style={{
                padding: "15px 18px 12px",
                borderBottom: "1px solid #f0f1f4",
                fontSize: 14.5,
                fontWeight: 600,
              }}
            >
              Top customers by won value
            </div>
            {topCustomers.map((c) => (
              <div
                key={c.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "12px 18px",
                  borderBottom: "1px solid #f5f6f8",
                }}
              >
                <MonoBadge>{initialsOf(c.name)}</MonoBadge>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      lineHeight: 1.3,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {c.name}
                  </div>
                  <div style={{ fontSize: 10.5, color: "#aab0bb", marginTop: 1 }}>
                    {c.n} {c.n === 1 ? "project" : "projects"}
                  </div>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>
                  {money(c.value)}
                </span>
              </div>
            ))}
            {topCustomers.length === 0 && (
              <div style={{ padding: "22px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
                No won quotes in this period.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* pipeline by estimator (real substitute for the demo product projection) */}
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
    </div>
  );
}

/* ======================================================================= */
/* =============================  INSTALLS  ============================== */
/* ======================================================================= */

type StageMeta = { label: string; color: string; order: number };
const STG: Record<string, StageMeta> = {
  procurement: { label: "Procurement", color: "#c9a23a", order: 0 },
  delivery: { label: "Delivery", color: "#3f7bb8", order: 1 },
  scheduled: { label: "Scheduled", color: "#2f8f6b", order: 2 },
  install: { label: "Install", color: ACCENT, order: 3 },
  training: { label: "Training", color: "#8a6d1f", order: 4 },
  signoff: { label: "Sign-off", color: "#8a7d6b", order: 5 },
};
function stg(k: ProjectStage | string): StageMeta {
  return STG[k] || { label: k, color: "#8c919c", order: 9 };
}

function coordsOf(
  p: ProjectRecord,
  custIndex: Map<string, Array<{ id?: string; lat?: number | string | null; lng?: number | string | null; primary: boolean }>>
): { lat: number; lng: number } | null {
  const locs = p.customerId ? custIndex.get(p.customerId) : null;
  if (!locs || !locs.length) return null;
  const loc = (p.locationId && locs.find((l) => l.id === p.locationId)) || locs.find((l) => l.primary) || locs[0];
  const lat = Number(loc?.lat);
  const lng = Number(loc?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function InstallsView({
  projects,
  customers,
  engagements,
  ir,
}: {
  projects: ProjectRecord[];
  customers: Awaited<ReturnType<typeof getCustomers>>;
  engagements: ConsultingEngagement[];
  ir: string;
}) {
  const now = Date.now();
  const H = ir === "6m" ? 6 : ir === "18m" ? 18 : 12; // horizon in months
  const horizonEnd = now + H * 30 * DAY;

  const custIndex = new Map(customers.map((c) => [c.id, c.locations || []]));

  const book = projects.filter(
    (p) => p.stage !== "complete" && (p.targetDate == null || p.targetDate <= horizonEnd)
  );

  const totalValue = book.reduce((a, p) => a + (p.value || 0), 0);
  const blended = totalValue ? book.reduce((a, p) => a + (p.value || 0) * (p.margin || 0), 0) / totalValue : 0;
  const cost = Math.round(totalValue * (1 - blended));

  // billing forecast — full value billed at landing (targetDate), collected net-30 after.
  // Consulting milestone fees (D90) land the same way: billed at the
  // milestone's targetDate, collected net-30 — forecast-only, no invoicing.
  const msPoints = engagements
    .flatMap((e) => e.milestones)
    .filter((m) => !m.completedAt && (m.amount || 0) > 0 && m.targetDate > 0 && m.targetDate <= horizonEnd);
  const bC = 6;
  const bucketMs = (H * 30 * DAY) / bC;
  const buckets: Array<{ start: number; billed: number; collected: number }> = [];
  for (let i = 0; i < bC; i++) {
    const lo = now + i * bucketMs;
    const hi = now + (i + 1) * bucketMs;
    let billed = 0;
    let collected = 0;
    book.forEach((p) => {
      const land = p.targetDate || 0;
      if (land >= lo && land < hi) billed += p.value || 0;
      const coll = land + 30 * DAY;
      if (coll >= lo && coll < hi) collected += p.value || 0;
    });
    msPoints.forEach((m) => {
      if (m.targetDate >= lo && m.targetDate < hi) billed += m.amount || 0;
      const coll = m.targetDate + 30 * DAY;
      if (coll >= lo && coll < hi) collected += m.amount || 0;
    });
    buckets.push({ start: lo, billed, collected });
  }
  const billMax = Math.max(1, ...buckets.map((b) => Math.max(b.billed, b.collected)));
  const billBars = buckets.map((b) => ({
    label: monthLabel(b.start),
    top: b.billed ? moneyK(b.billed) : "",
    basePct: Math.round((b.billed / billMax) * 100),
    frontPct: Math.round((b.collected / billMax) * 100),
  }));

  const toBill =
    book
      .filter((p) => (p.targetDate || 0) >= now && (p.targetDate || 0) <= horizonEnd)
      .reduce((a, p) => a + (p.value || 0), 0) +
    msPoints
      .filter((m) => m.targetDate >= now)
      .reduce((a, m) => a + (m.amount || 0), 0);
  const collected =
    book
      .filter((p) => (p.targetDate || 0) + 30 * DAY >= now && (p.targetDate || 0) + 30 * DAY <= horizonEnd)
      .reduce((a, p) => a + (p.value || 0), 0) +
    msPoints
      .filter((m) => m.targetDate + 30 * DAY >= now && m.targetDate + 30 * DAY <= horizonEnd)
      .reduce((a, m) => a + (m.amount || 0), 0);

  // backlog by stage
  const byStage = new Map<string, { value: number; count: number }>();
  book.forEach((p) => {
    const e = byStage.get(p.stage) || { value: 0, count: 0 };
    e.value += p.value || 0;
    e.count += 1;
    byStage.set(p.stage, e);
  });
  const stageRows = [...byStage.entries()]
    .map(([k, e]) => ({ label: stg(k).label, count: e.count, value: e.value, color: stg(k).color, order: stg(k).order }))
    .sort((a, b) => a.order - b.order);

  // margin donut
  const mDeg = Math.round(blended * 360);
  const marginGradient = `conic-gradient(${ACCENT} 0deg ${mDeg}deg, #e9ebef ${mDeg}deg 360deg)`;

  // upcoming completions
  const upcoming = [...book].sort((a, b) => (a.targetDate || 0) - (b.targetDate || 0)).slice(0, 6);

  // completion timeline
  const timeline = [...book].sort((a, b) => (a.targetDate || 0) - (b.targetDate || 0));
  const windowMs = H * 30 * DAY;
  const axis: Array<{ label: string; leftPct: number }> = [];
  for (let i = 0; i <= bC; i++) axis.push({ label: monthLabel(now + i * bucketMs), leftPct: (i / bC) * 100 });

  // map pins
  const mapMax = Math.max(1, ...book.map((p) => p.value || 0));
  const pins: MapPin[] = book
    .map((p): MapPin | null => {
      const c = coordsOf(p, custIndex);
      if (!c) return null;
      return {
        id: p.id,
        lat: c.lat,
        lng: c.lng,
        color: stg(p.stage).color,
        label: p.name,
        sub: `${p.customer} · ${money(p.value)} · ${stg(p.stage).label}`,
        size: 13 + Math.round(((p.value || 0) / mapMax) * 10),
      };
    })
    .filter((x): x is MapPin => x !== null);

  return (
    <div>
      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 13, marginBottom: 18 }}>
        <KpiTile label="Backlog value" value={money(totalValue)} sub={`${book.length} open`} />
        <KpiTile label="To be billed" value={money(toBill)} sub={`next ${H} mo`} />
        <KpiTile label="Expected collected" value={money(collected)} tone="green" sub="net-30 basis" />
        <KpiTile label="Avg. margin" value={`${Math.round(blended * 100)}%`} sub="at completion" />
      </div>

      <div style={GRID_MAIN}>
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <ChartCard
            title="Billing forecast — installs + consulting milestones"
            right={
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#8c919c" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: "#dfe2e8" }} />
                  To be billed
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#8c919c" }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: ACCENT }} />
                  Expected collected
                </span>
              </div>
            }
          >
            <StackedBars bars={billBars} frontColor={ACCENT} />
          </ChartCard>

          <div className="pk-card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 16 }}>Backlog value by stage</div>
            <StageBars rows={stageRows} />
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="pk-card" style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>Margin at completion</div>
            <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 16 }}>Blended across the open book</div>
            <Donut
              gradient={marginGradient}
              center={`${Math.round(blended * 100)}%`}
              centerSub="margin"
              legend={[
                { color: ACCENT, label: "Projected margin", value: money(totalValue - cost) },
                { color: "#c9ccd3", label: "Est. cost", value: money(cost) },
              ]}
            />
          </div>

          <div className="pk-card" style={{ overflow: "hidden" }}>
            <div
              style={{
                padding: "15px 18px 12px",
                borderBottom: "1px solid #f0f1f4",
                fontSize: 14.5,
                fontWeight: 600,
              }}
            >
              Upcoming completions
            </div>
            {upcoming.map((p) => (
              <div
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "12px 18px",
                  borderBottom: "1px solid #f5f6f8",
                }}
              >
                <MonoBadge>{initialsOf(p.customer)}</MonoBadge>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      lineHeight: 1.3,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {p.name}
                  </div>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: "#aab0bb",
                      marginTop: 2,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: stg(p.stage).color,
                        flexShrink: 0,
                      }}
                    />
                    {p.targetDate ? `Lands ${monYear(p.targetDate)}` : "No target"} · {stg(p.stage).label}
                  </div>
                </div>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>
                  {money(p.value)}
                </span>
              </div>
            ))}
            {upcoming.length === 0 && (
              <div style={{ padding: "22px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
                No open projects in this horizon.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* completion timeline */}
      <div className="pk-card" style={{ padding: "18px 20px 16px", marginTop: 18 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Completion timeline</div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 3 }}>
            Where each project lands — bar runs to projected sign-off
          </div>
        </div>
        {timeline.map((p) => {
          const startRaw = p.installStart || p.startedAt || now;
          const start = Math.max(now, startRaw);
          const land = Math.max(start, p.targetDate || start);
          const leftPct = Math.min(95, Math.max(0, ((start - now) / windowMs) * 100));
          const widthPct = Math.max(5, Math.min(100 - leftPct, ((land - start) / windowMs) * 100));
          return (
            <div
              key={p.id}
              style={{
                display: "grid",
                gridTemplateColumns: "184px minmax(0,1fr)",
                gap: 14,
                alignItems: "center",
                padding: "7px 0",
                borderBottom: "1px solid #f5f6f8",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {p.name}
                </div>
                <div
                  style={{
                    fontSize: 10.5,
                    color: "#aab0bb",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {p.customer}
                </div>
              </div>
              <div style={{ position: "relative", height: 26, background: "#f6f7f9", borderRadius: 6 }}>
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    background: stg(p.stage).color,
                    borderRadius: 6,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                    paddingRight: 8,
                    boxSizing: "border-box",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, color: "#fff" }}>
                    {moneyK(p.value || 0)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {timeline.length === 0 && (
          <div style={{ padding: "22px 0", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No open projects to plot.
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "184px minmax(0,1fr)", gap: 14, marginTop: 9 }}>
          <div />
          <div style={{ position: "relative", height: 14 }}>
            {axis.map((a, i) => (
              <span
                key={i}
                style={{
                  position: "absolute",
                  top: 0,
                  left: `${a.leftPct}%`,
                  transform: "translateX(-50%)",
                  fontSize: 10,
                  color: "#aab0bb",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {a.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* project locations map + book by stage */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 300px",
          gap: 18,
          marginTop: 18,
          alignItems: "stretch",
        }}
      >
        <div className="pk-card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 3 }}>Project locations</div>
          <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 16 }}>
            {pins.length} located {pins.length === 1 ? "project" : "projects"} · pin size reflects contract value
          </div>
          <ReportsMap pins={pins} />
        </div>
        <div className="pk-card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 14 }}>Book by stage</div>
          {stageRows.map((s) => (
            <div
              key={s.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 0",
                borderBottom: "1px solid #f5f6f8",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{s.label}</span>
              <span style={{ fontSize: 11, color: "#aab0bb", whiteSpace: "nowrap", flexShrink: 0 }}>
                {s.count} open
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                {money(s.value)}
              </span>
            </div>
          ))}
          {stageRows.length === 0 && (
            <div style={{ fontSize: 12.5, color: "#9aa0ab", padding: "8px 0" }}>Nothing open.</div>
          )}
        </div>
      </div>
    </div>
  );
}
