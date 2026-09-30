import type { CSSProperties } from "react";
import { ShortList } from "@/components/short-list";
import { SuggestionActions } from "@/components/rewards/suggestion-actions";
import {
  LevelBadge,
  ProgressToNext,
  PurchaseRow,
  rewardsMoney,
  tierLabel,
} from "@/components/rewards/rewards-ui";
import { REWARD_LEVEL_LABEL } from "@/lib/rewards/program";
import type { CompanyRewardsView } from "@/lib/stores/rewards";
import type { CompanyCredit } from "@/lib/stores/reward-ledger";
import { creditMoney, LedgerRow } from "@/components/rewards/credit-ui";
import { AdjustCreditForm } from "@/components/rewards/credit-actions";

/**
 * Company record → Rewards card (#282 Phase 1, spec §7): earned level vs the
 * company's current tier (and a suggestion with Approve/Dismiss), lifetime
 * spend, progress to the next level, the purchases that count, and (#282
 * phase 2) the account credit — balance, available (balance − credit parked
 * on open quotes), the ledger, and Adjust for admins. Perks join in phase 4.
 * The page renders it only while the program is on.
 */

const card: CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  marginBottom: 24,
  overflow: "hidden",
};
const label: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
};

export function RewardsCard({
  view,
  canApprove,
  credit,
  canAdjust,
  quoteRefs,
}: {
  view: CompanyRewardsView;
  canApprove: boolean;
  credit?: CompanyCredit | null;
  canAdjust?: boolean;
  quoteRefs?: Record<string, string>;
}) {
  const n = view.purchases.length;
  const entries = credit?.entries || [];
  return (
    <div style={card} id="rewards">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "14px 18px 12px",
          borderBottom: "1px solid #f0f1f4",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Rewards</span>
          <LevelBadge level={view.earned} />
        </div>
        <span style={{ fontSize: 12, color: "#8c919c" }}>
          Current tier · <b style={{ fontWeight: 600, color: "#3a3f4a" }}>{tierLabel(view.companyTier)}</b>
        </span>
      </div>

      {view.suggestion && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            padding: "12px 18px",
            background: "#fbf8ee",
            borderBottom: "1px solid #f0e8cf",
          }}
        >
          <span style={{ fontSize: 12.5, color: "#5b4a14" }}>
            Earned <b>{REWARD_LEVEL_LABEL[view.suggestion]}</b> — suggest moving this company&apos;s tier from{" "}
            {tierLabel(view.companyTier)} to {REWARD_LEVEL_LABEL[view.suggestion]}.
          </span>
          <SuggestionActions
            companyId={view.companyId}
            levelLabel={REWARD_LEVEL_LABEL[view.suggestion]}
            disabled={!canApprove}
            disabledReason="Needs approve permission"
          />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,2fr)", gap: 18, padding: "14px 18px" }}>
        <div>
          <div style={label}>Lifetime spend</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 20, fontWeight: 600, marginTop: 6, color: "#16181d" }}>
            {rewardsMoney(view.spend)}
          </div>
        </div>
        <div>
          <div style={{ ...label, marginBottom: 8 }}>Progress</div>
          <ProgressToNext earned={view.earned} next={view.next} progress={view.progress} />
        </div>
      </div>

      {credit && (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-between",
              gap: 18,
              flexWrap: "wrap",
              padding: "12px 18px 14px",
              borderTop: "1px solid #f0f1f4",
            }}
          >
            <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
              <div>
                <div style={label}>Credit balance</div>
                <div data-testid="reward-credit-balance" style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600, marginTop: 6, color: "#1f8a5b" }}>
                  {creditMoney(credit.balance)}
                </div>
              </div>
              <div>
                <div style={label}>Available</div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600, marginTop: 6, color: "#16181d" }}>
                  {creditMoney(credit.available)}
                </div>
                {credit.onOpenQuotes > 0 && (
                  <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 3 }}>
                    {creditMoney(credit.onOpenQuotes)} applied on open quotes
                  </div>
                )}
              </div>
            </div>
            {canAdjust && <AdjustCreditForm companyId={view.companyId} />}
          </div>
          <div
            style={{
              padding: "9px 18px 7px",
              fontSize: 10,
              fontWeight: 600,
              color: "#aab0bb",
              letterSpacing: ".05em",
              textTransform: "uppercase",
              background: "#fafbfc",
              borderTop: "1px solid #f0f1f4",
              borderBottom: "1px solid #f0f1f4",
            }}
          >
            Credit ledger · {entries.length}
          </div>
          {entries.length > 0 ? (
            <ShortList
              searchPlaceholder="Search credit…"
              items={entries.map((e) => (
                <LedgerRow key={e.id} e={e} quoteRef={e.quoteId ? quoteRefs?.[e.quoteId] : undefined} />
              ))}
              searchText={entries.map((e) => [e.kind, e.quoteId || "", (e.quoteId && quoteRefs?.[e.quoteId]) || "", e.note || "", e.by].join(" "))}
            />
          ) : (
            <div style={{ padding: "16px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
              No credit yet — it posts when a quote is won.
            </div>
          )}
        </>
      )}

      <div
        style={{
          padding: "9px 18px 7px",
          fontSize: 10,
          fontWeight: 600,
          color: "#aab0bb",
          letterSpacing: ".05em",
          textTransform: "uppercase",
          background: "#fafbfc",
          borderTop: "1px solid #f0f1f4",
          borderBottom: "1px solid #f0f1f4",
        }}
      >
        Counted purchases · {n}
      </div>
      {n > 0 ? (
        <ShortList
          searchPlaceholder="Search purchases…"
          items={view.purchases.map((p) => (
            <PurchaseRow key={`${p.kind}:${p.id}`} p={p} />
          ))}
          searchText={view.purchases.map((p) => [p.name, p.ref, p.id].join(" "))}
        />
      ) : (
        <div style={{ padding: "20px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
          No won quotes or completed history yet.
        </div>
      )}
    </div>
  );
}
