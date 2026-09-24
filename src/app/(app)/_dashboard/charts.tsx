import { money } from "@/lib/format";

export const ACCENT = "var(--accent)";

export function moneyK(n: number): string {
  const v = Math.round(n);
  if (Math.abs(v) >= 1000) return "$" + Math.round(v / 1000) + "k";
  return "$" + v;
}

export function initialsOf(name: string): string {
  const w = (name || "").trim().split(/\s+/);
  return ((w[0]?.[0] || "") + (w[1]?.[0] || "")).toUpperCase() || "—";
}

export function pctDelta(cur: number, prior: number): string {
  if (!prior) return "—";
  const d = Math.round(((cur - prior) / prior) * 100);
  return (d >= 0 ? "+" : "") + d + "%";
}

export function ptDelta(cur: number, prior: number): string {
  const d = Math.round(cur - prior);
  return (d >= 0 ? "+" : "") + d + "pt";
}

export function monthLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short" });
}
export function monYear(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function ChartCard({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
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

export function StackedBars({
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

export function StageBars({
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

export function Donut({
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

export function MonoBadge({ children }: { children: React.ReactNode }) {
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

export function Legend({ items }: { items: Array<{ color: string; label: string }> }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
      {items.map((item) => (
        <span key={item.label} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#8c919c" }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
