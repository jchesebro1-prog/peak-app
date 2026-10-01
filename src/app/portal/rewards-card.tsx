import type { CSSProperties } from "react";
import type { PortalRewardsView } from "@/lib/rewards/perks";
import { formatPoints } from "@/lib/rewards/points";
import { RedeemPortalPerk } from "./redeem-perk-button";

/**
 * Customer portal → Rewards card (#282 phase 4, spec §7). Renders ONLY the
 * whitelisted PortalRewardsView (src/lib/rewards/perks.ts): the reward level
 * name, progress to the next level (dollars of purchases), the rewards
 * balance as POINTS (#282 points follow-up — never a dollar balance) and the
 * available perks' name + description. No margins, no percentages. The
 * page renders it only while the program is on, for the grant's company.
 * Pure presentational — no data access here.
 *
 * #282 perks+points: each available perk shows "Free" or "N points" and a
 * Redeem button (confirm first; disabled in a team preview; the portal action
 * is scoped to the grant's company and re-checks everything); "Your <Level>
 * purchase perks" lists the standing ones; redemptions not yet fulfilled
 * show under "Redeemed — we'll be in touch". Still never a dollar amount for
 * points.
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

const SECTION: CSSProperties = {
  padding: "9px 20px 5px",
  ...LABEL,
  background: "#fafbfc",
  borderTop: "1px solid #f0f1f4",
  borderBottom: "1px solid #f0f1f4",
};

function dollars(n: number): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

/** "Oct 1, 2026" — a redemption's day. */
function shortDay(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function PortalRewardsCard({
  view,
  companyName,
  companyId,
  preview,
}: {
  view: PortalRewardsView;
  companyName: string;
  /** #282 perks+points: the grant's company — Redeem shows only when given. */
  companyId?: string;
  /** A team preview: Redeem shows, disabled. */
  preview?: boolean;
}) {
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
      {view.purchasePerks && view.purchasePerks.perks.length > 0 && (
        <div data-testid="portal-purchase-perks">
          <div style={SECTION}>Your {view.purchasePerks.levelLabel} purchase perks</div>
          {view.purchasePerks.perks.map((p) => (
            <div key={p.id} style={{ padding: "10px 20px", borderBottom: "1px solid #f5f6f8" }}>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</div>
              {p.description && <div style={{ fontSize: 12, color: "#5b616e", marginTop: 3, lineHeight: 1.5 }}>{p.description}</div>}
            </div>
          ))}
          <div style={{ padding: "8px 20px 10px", fontSize: 11.5, color: "#8c919c" }}>On every purchase at your level.</div>
        </div>
      )}
      {view.perks.length > 0 && (
        <div>
          <div style={SECTION}>Perks available to you</div>
          {view.perks.map((p) => (
            <div
              key={p.id}
              data-testid="portal-perk"
              style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderBottom: "1px solid #f5f6f8" }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</span>
                  <span
                    data-testid="portal-perk-price"
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      padding: "2px 8px",
                      borderRadius: 20,
                      color: p.mode === "free" ? "#1f7a52" : "#3a3f4a",
                      background: p.mode === "free" ? "#e9f6ef" : "#f1f2f5",
                      fontFamily: p.mode === "points" ? "var(--font-mono)" : undefined,
                    }}
                  >
                    {p.mode === "points" && p.pointCost != null ? formatPoints(p.pointCost) : "Free"}
                  </span>
                </div>
                {p.description && <div style={{ fontSize: 12, color: "#5b616e", marginTop: 3, lineHeight: 1.5 }}>{p.description}</div>}
              </div>
              {companyId && (
                <RedeemPortalPerk
                  perkId={p.id}
                  perkName={p.name}
                  companyId={companyId}
                  mode={p.mode}
                  pointCost={p.pointCost}
                  preview={!!preview}
                  previewCid={preview ? companyId : undefined}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {view.pending.length > 0 && (
        <div data-testid="portal-perks-pending">
          <div style={SECTION}>Redeemed — we&apos;ll be in touch</div>
          {view.pending.map((p) => (
            <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 20px", borderBottom: "1px solid #f5f6f8", fontSize: 13 }}>
              <span style={{ fontWeight: 600 }}>{p.name}</span>
              <span style={{ fontSize: 12, color: "#8c919c" }}>{shortDay(p.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
