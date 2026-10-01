import type { CSSProperties } from "react";
import { REWARD_LEVEL_LABEL, type Perk } from "@/lib/rewards/program";
import { PERK_FREQUENCY_LABEL, isRedemption, type PerkStatus, type PerkUse } from "@/lib/rewards/perks";
import { dollarsAndPoints, formatPoints } from "@/lib/rewards/points";
import { yearAwareDate } from "@/lib/format";
import { LevelBadge } from "@/components/rewards/rewards-ui";
import {
  FulfilPerk,
  MarkPerkUsed,
  RedeemPerk,
  UndoPerkUse,
  type PerkQuoteOption,
} from "@/components/rewards/perk-actions";

/**
 * Company record → Rewards card → Perks (#282 phase 4, spec §6; perks+points
 * follow-up): every active perk with its availability for this company —
 * free at its level (Redeem / Mark used) or for sale with points (Redeem ·
 * N pts, staff see "$300 · 300 pts"); "Unlocks at Gold", "N pts short",
 * "Used …" or "Next available …" when neither. Then the perk-use history:
 * redemptions show Fulfilled / Mark fulfilled (`create`), any use can be
 * undone by an admin (a bought one refunds its points). Server component.
 */

const head: CSSProperties = {
  padding: "9px 18px 7px",
  fontSize: 10,
  fontWeight: 600,
  color: "#aab0bb",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  background: "#fafbfc",
  borderTop: "1px solid #f0f1f4",
  borderBottom: "1px solid #f0f1f4",
};
const row: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", borderBottom: "1px solid #f5f6f8" };
const chip: CSSProperties = { fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" };

function blockText(s: PerkStatus): string {
  if (s.block === "level") return s.perk.level ? `Unlocks at ${REWARD_LEVEL_LABEL[s.perk.level]}` : "Not available";
  if (s.block === "points") return `${formatPoints(s.short)} short`;
  if (s.block === "used") return s.lastUsedAt ? `Used ${yearAwareDate(s.lastUsedAt)}` : "Used";
  if (s.block === "cooldown") return s.nextAt ? `Next available ${yearAwareDate(s.nextAt)}` : "Used this year";
  return "Off";
}

export function PerksSection({
  companyId,
  statuses,
  uses,
  allPerks,
  quotes,
  quoteRefs,
  canMark,
  canUndo,
  points,
}: {
  companyId: string;
  statuses: PerkStatus[];
  uses: PerkUse[];
  /** Every stored perk, tombstones included — names for past uses. */
  allPerks: Perk[];
  quotes: PerkQuoteOption[];
  quoteRefs?: Record<string, string>;
  /** `create` — Mark used, Redeem, Mark fulfilled. */
  canMark: boolean;
  canUndo: boolean;
  /** #282 perks+points: the company's spendable points (pointsFor(available credit)). */
  points?: number;
}) {
  const shown = statuses.filter((s) => s.perk.active);
  const available = shown.filter((s) => s.available).length;
  const nameOf = (id?: string) => allPerks.find((p) => p.id === id)?.name ?? id ?? "Perk";
  const toFulfil = uses.filter((u) => isRedemption(u) && !u.undone && !u.fulfilled).length;
  return (
    <div data-testid="rewards-perks">
      <div style={head}>
        Perks · {available} available{shown.length > available ? ` of ${shown.length}` : ""}
        {points != null && points > 0 ? ` · ${formatPoints(points)} to spend` : ""}
      </div>
      {shown.length === 0 ? (
        <div style={{ padding: "16px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
          No perks set up — an admin adds them in Settings → Rewards.
        </div>
      ) : (
        shown.map((s) => (
          <div
            key={s.perk.id}
            data-testid="perk-status"
            data-available={s.available ? "1" : "0"}
            data-mode={s.mode ?? ""}
            style={row}
          >
            <span style={{ flex: 1, minWidth: 0, opacity: s.available ? 1 : 0.72 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{s.perk.name}</span>
                {s.perk.level ? (
                  <LevelBadge level={s.perk.level} suffix={s.pointCost != null ? "· free" : undefined} />
                ) : (
                  <span style={{ ...chip, color: "#5b616e", background: "#f1f2f5" }}>Points only</span>
                )}
                {s.pointCost != null && (
                  <span style={{ fontSize: 11, color: "#1f7a52", fontFamily: "var(--font-mono)" }}>{dollarsAndPoints(s.pointCost)}</span>
                )}
                <span style={{ fontSize: 11, color: "#9aa0ab" }}>{PERK_FREQUENCY_LABEL[s.perk.frequency]}</span>
              </span>
              {s.perk.description && (
                <span style={{ display: "block", fontSize: 11.5, color: "#8c919c", marginTop: 3, lineHeight: 1.45 }}>{s.perk.description}</span>
              )}
            </span>
            {s.available && s.mode ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <RedeemPerk
                  companyId={companyId}
                  perkId={s.perk.id}
                  perkName={s.perk.name}
                  mode={s.mode}
                  pointCost={s.pointCost}
                  disabled={!canMark}
                  disabledReason="Needs create permission"
                />
                {s.mode === "free" && (
                  <MarkPerkUsed
                    companyId={companyId}
                    perkId={s.perk.id}
                    perkName={s.perk.name}
                    quotes={quotes}
                    disabled={!canMark}
                    disabledReason="Needs create permission"
                  />
                )}
              </span>
            ) : (
              <span style={{ fontSize: 12, color: "#8c919c", whiteSpace: "nowrap" }}>{blockText(s)}</span>
            )}
          </div>
        ))
      )}
      {uses.length > 0 && (
        <>
          <div style={head}>
            Perk history · {uses.length}
            {toFulfil > 0 ? ` · ${toFulfil} to fulfil` : ""}
          </div>
          {uses.map((u) => {
            const redemption = isRedemption(u);
            const bought = u.entry.amount < 0 ? -u.entry.amount : 0;
            return (
              <div key={u.entry.id} data-testid="perk-use" data-redemption={redemption ? "1" : "0"} style={row}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                      fontSize: 13,
                      fontWeight: 600,
                      textDecoration: u.undone ? "line-through" : "none",
                      color: u.undone ? "#9aa0ab" : "inherit",
                    }}
                  >
                    {nameOf(u.entry.perkId)}
                    {u.entry.quoteId ? ` · ${quoteRefs?.[u.entry.quoteId] || u.entry.quoteId}` : ""}
                    {redemption && (
                      <span style={{ ...chip, color: bought ? "#1f7a52" : "#5b616e", background: bought ? "#e9f6ef" : "#f1f2f5", textDecoration: "none" }}>
                        {bought ? `Redeemed · ${dollarsAndPoints(bought)}` : "Redeemed · free"}
                        {u.entry.via === "portal" ? " · portal" : ""}
                      </span>
                    )}
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                    {yearAwareDate(u.entry.at)}
                    {u.entry.by ? ` · ${u.entry.by}` : ""}
                    {u.entry.note ? ` · ${u.entry.note}` : ""}
                    {u.fulfilled ? ` · fulfilled ${yearAwareDate(u.fulfilled.at)}${u.fulfilled.by ? ` by ${u.fulfilled.by}` : ""}` : ""}
                    {u.undone ? ` · undone ${yearAwareDate(u.undone.at)}${u.undone.by ? ` by ${u.undone.by}` : ""}` : ""}
                  </span>
                </span>
                {redemption && !u.undone && !u.fulfilled && <FulfilPerk companyId={companyId} useId={u.entry.id} disabled={!canMark} />}
                {redemption && !u.undone && u.fulfilled && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#1f7a52", whiteSpace: "nowrap" }}>Fulfilled</span>
                )}
                {!u.undone && canUndo && (
                  <UndoPerkUse companyId={companyId} useId={u.entry.id} perkName={nameOf(u.entry.perkId)} refundPoints={bought} />
                )}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
