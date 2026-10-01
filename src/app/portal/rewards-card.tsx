import type { CSSProperties } from "react";
import type { PortalRewardsView } from "@/lib/rewards/perks";
import { formatPoints } from "@/lib/rewards/points";

/**
 * Customer portal → Rewards card (#282 phase 4, spec §7). Renders ONLY the
 * whitelisted PortalRewardsView (src/lib/rewards/perks.ts): the reward level
 * name, progress to the next level (dollars of purchases), the rewards
 * balance as POINTS (#282 points follow-up — never a dollar balance) and the
 * available perks' name + description. No margins, no percentages, no actions. The
 * page renders it only while the program is on, for the grant's company.
 * Pure presentational — no data access here.
 */

const CARD: CSSProperties = {
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 14,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  overflow: "hidden",
  marginBottom: 18,
};
const HEAD: CSSProperties = {
  padding: "15px 20px 12px",
  borderBottom: "1px solid #f0f1f4",
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 12,
};
const LABEL: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#9aa0ab",
};

function dollars(n: number): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

export function PortalRewardsCard({ view, companyName }: { view: PortalRewardsView; companyName: string }) {
  const width = Math.round(Math.max(0, Math.min(1, view.progress)) * 1000) / 10;
  return (
    <div style={CARD} data-testid="portal-rewards">
      <div style={HEAD}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Your rewards</div>
        <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>from {companyName}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 18, padding: "16px 20px" }}>
        <div>
          <div style={LABEL}>Reward level</div>
          <div style={{ fontSize: 20, fontWeight: 600, marginTop: 6, letterSpacing: "-.01em" }}>{view.levelLabel}</div>
        </div>
        <div>
          <div style={LABEL}>{view.next ? `Progress to ${view.next.levelLabel}` : "Progress"}</div>
          <div
            role="progressbar"
            aria-label={view.next ? `Progress to ${view.next.levelLabel}` : "Top level reached"}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(width)}
            style={{ height: 8, borderRadius: 6, background: "#f1f2f5", overflow: "hidden", marginTop: 10 }}
          >
            <div style={{ width: `${width}%`, height: "100%", background: "var(--accent)", borderRadius: 6 }} />
          </div>
          <div style={{ fontSize: 12, color: "#5b616e", marginTop: 6 }}>
            {view.next ? `${dollars(view.next.need)} more in purchases to reach ${view.next.levelLabel}` : "You've reached our top level"}
          </div>
        </div>
        <div>
          <div style={LABEL}>Rewards points</div>
          <div
            data-testid="portal-rewards-points"
            style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 600, marginTop: 6, color: view.points > 0 ? "#1f7a52" : "#16181d" }}
          >
            {formatPoints(view.points)}
          </div>
        </div>
      </div>
      <div style={{ padding: "0 20px 12px", fontSize: 12, color: "#8c919c" }}>
        Points are applied by your Peak estimator on your next quote.
      </div>
      {view.perks.length > 0 && (
        <div>
          <div
            style={{
              padding: "9px 20px 5px",
              ...LABEL,
              background: "#fafbfc",
              borderTop: "1px solid #f0f1f4",
              borderBottom: "1px solid #f0f1f4",
            }}
          >
            Perks available to you
          </div>
          {view.perks.map((p) => (
            <div key={p.id} style={{ padding: "12px 20px", borderBottom: "1px solid #f5f6f8" }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</div>
              {p.description && <div style={{ fontSize: 12, color: "#5b616e", marginTop: 3, lineHeight: 1.5 }}>{p.description}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
