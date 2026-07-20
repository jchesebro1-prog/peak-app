/**
 * Home dashboard stat tiles — open pipeline, win rate, out for signature,
 * average quote. Port of Home.dc.html's stat row.
 */

export default function HomeStats({
  stats,
}: {
  stats: Array<{ label: string; value: string; sub: string }>;
}) {
  return (
    <div className="pkh-stats">
      {stats.map((s) => (
        <div
          key={s.label}
          style={{
            background: "#fff",
            border: "1px solid #ececf0",
            borderRadius: 12,
            padding: "16px 17px",
            boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#9aa0ab",
              letterSpacing: ".05em",
              textTransform: "uppercase",
            }}
          >
            {s.label}
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "-.01em",
              marginTop: 10,
            }}
          >
            {s.value}
          </div>
          <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 7 }}>{s.sub}</div>
        </div>
      ))}
    </div>
  );
}
