import { money } from "@/lib/format";
import type { ProjectRecord } from "@/lib/stores/projects";
import { DEFAULT_PIPELINES, PROJECT_TAG_META, PROJECT_TAG_RANK, projectStageMeta, type ProjectTag } from "@/lib/pipelines";
import type { MapPin } from "@/components/map/LeafletMap";
import type { WidgetCtx, WidgetRenderer } from "@/lib/dashboard/context";
import { installsForecast } from "@/lib/dashboard/metrics";
import { ReportsMap } from "../../reports/controls";
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
  monthLabel,
  monYear,
} from "../charts";
import { tile } from "./tile";

/** #43 — Reports › Installs as widgets. Forward-looking: always the next
 *  12 months, exempt from ?range (spec). */

const HORIZON = 12;

/** Stage colour + order by TAG (the one tag map) — a stage renamed or added
 *  in Settings → Pipelines colours and sorts by its tag, never by id/label. */
function tagColor(tag: ProjectTag | null | undefined): string {
  return (PROJECT_TAG_META[tag as ProjectTag] ?? PROJECT_TAG_META.backlog).dot;
}
/** The record's stage tag + Settings label — stamped by the store on read. */
function stg(p: ProjectRecord): { label: string; color: string } {
  const m = p.stageMeta || projectStageMeta(DEFAULT_PIPELINES, p);
  return { label: m.label, color: tagColor(m.tag) };
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

async function forecast(ctx: WidgetCtx) {
  const [projects, engagements] = await Promise.all([ctx.data.projects(), ctx.data.engagements()]);
  return installsForecast(projects, engagements, ctx.now, HORIZON);
}

// byStage is grouped by stage label and carries the tag (Task 4a); rows sort
// by tag rank (a stable sort — same-tag stages keep their first-seen order).
const stageRows = (f: Awaited<ReturnType<typeof forecast>>) =>
  f.byStage
    .map((s) => ({ label: s.stage, count: s.count, value: s.value, color: tagColor(s.tag), order: PROJECT_TAG_RANK[s.tag] ?? 9 }))
    .sort((a, b) => a.order - b.order);

export const INSTALLS_RENDERERS = {
  "backlog-value": async (ctx) => {
    const f = await forecast(ctx);
    return tile("Backlog value", money(f.totalValue), `${f.book.length} open`);
  },
  "to-be-billed": async (ctx) => {
    const f = await forecast(ctx);
    return tile("To be billed", money(f.toBill), `next ${HORIZON} mo`);
  },
  "expected-collected": async (ctx) => {
    const f = await forecast(ctx);
    return tile("Expected collected", money(f.collected), "net-30 basis", "green");
  },
  "book-margin": async (ctx) => {
    const f = await forecast(ctx);
    return tile("Avg. margin", `${Math.round(f.blended * 100)}%`, "at completion");
  },

  "billing-forecast": async (ctx) => {
    const f = await forecast(ctx);
    const billMax = Math.max(1, ...f.buckets.map((b) => Math.max(b.billed, b.collected)));
    const bars = f.buckets.map((b) => ({
      label: monthLabel(b.start),
      top: b.billed ? moneyK(b.billed) : "",
      basePct: Math.round((b.billed / billMax) * 100),
      frontPct: Math.round((b.collected / billMax) * 100),
    }));
    return (
      <ChartCard title="Billing forecast — installs + consulting milestones" right={<Legend items={[{ color: "#dfe2e8", label: "To be billed" }, { color: ACCENT, label: "Expected collected" }]} />}>
        <StackedBars bars={bars} frontColor={ACCENT} />
      </ChartCard>
    );
  },

  "backlog-by-stage": async (ctx) => {
    const f = await forecast(ctx);
    return (
      <div className="pk-card" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 16 }}>Backlog value by stage</div>
        <StageBars rows={stageRows(f)} />
      </div>
    );
  },

  "margin-donut": async (ctx) => {
    const f = await forecast(ctx);
    const mDeg = Math.round(f.blended * 360);
    return (
      <div className="pk-card" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>Margin at completion</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 16 }}>Blended across the open book</div>
        <Donut
          gradient={`conic-gradient(${ACCENT} 0deg ${mDeg}deg, #e9ebef ${mDeg}deg 360deg)`}
          center={`${Math.round(f.blended * 100)}%`}
          centerSub="margin"
          legend={[{ color: ACCENT, label: "Projected margin", value: money(f.totalValue - f.cost) }, { color: "#c9ccd3", label: "Est. cost", value: money(f.cost) }]}
        />
      </div>
    );
  },

  "upcoming-completions": async (ctx) => {
    const f = await forecast(ctx);
    return (
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
        {f.upcoming.map((p) => (
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
                    background: stg(p).color,
                    flexShrink: 0,
                  }}
                />
                {p.targetDate ? `Lands ${monYear(p.targetDate)}` : "No target"} · {stg(p).label}
              </div>
            </div>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>
              {money(p.value)}
            </span>
          </div>
        ))}
        {f.upcoming.length === 0 && (
          <div style={{ padding: "22px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No open projects in this horizon.
          </div>
        )}
      </div>
    );
  },

  "completion-timeline": async (ctx) => {
    const f = await forecast(ctx);
    const bC = 6;
    const axis = Array.from({ length: bC + 1 }, (_, i) => ({ label: monthLabel(ctx.now + i * f.bucketMs), leftPct: (i / bC) * 100 }));
    return (
      <div className="pk-card" style={{ padding: "18px 20px 16px" }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Completion timeline</div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 3 }}>
            Where each project lands — bar runs to projected sign-off
          </div>
        </div>
        {f.timeline.map((p) => {
          const startRaw = p.installStart || p.startedAt || ctx.now;
          const start = Math.max(ctx.now, startRaw);
          const land = Math.max(start, p.targetDate || start);
          const leftPct = Math.min(95, Math.max(0, ((start - ctx.now) / f.windowMs) * 100));
          const widthPct = Math.max(5, Math.min(100 - leftPct, ((land - start) / f.windowMs) * 100));
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
                    background: stg(p).color,
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
        {f.timeline.length === 0 && (
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
    );
  },

  "project-locations": async (ctx) => {
    const [f, customers] = await Promise.all([forecast(ctx), ctx.data.customers()]);
    const custIndex = new Map(customers.map((c) => [c.id, c.locations || []]));
    const mapMax = Math.max(1, ...f.book.map((p) => p.value || 0));
    const pins: MapPin[] = f.book
      .map((p): MapPin | null => {
        const c = coordsOf(p, custIndex);
        if (!c) return null;
        return {
          id: p.id,
          lat: c.lat,
          lng: c.lng,
          color: stg(p).color,
          label: p.name,
          sub: `${p.customer} · ${money(p.value)} · ${stg(p).label}`,
          size: 13 + Math.round(((p.value || 0) / mapMax) * 10),
        };
      })
      .filter((x): x is MapPin => x !== null);
    return (
      <div className="pk-card" style={{ padding: "18px 20px" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 3 }}>Project locations</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 16 }}>
          {pins.length} located {pins.length === 1 ? "project" : "projects"} · pin size reflects contract value
        </div>
        <ReportsMap pins={pins} />
      </div>
    );
  },
} satisfies Record<string, WidgetRenderer>;
