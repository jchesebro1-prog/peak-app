import Link from "next/link";
import type { CSSProperties } from "react";
import { requirePerm } from "@/lib/session";
import { can } from "@/lib/team";
import { getRewardsProgram, rewardsBoard } from "@/lib/stores/rewards";
import { REWARD_LEVELS, REWARD_LEVEL_LABEL, isRewardLevel, type RewardLevel } from "@/lib/rewards/program";
import { ShortList } from "@/components/short-list";
import { SuggestionActions } from "@/components/rewards/suggestion-actions";
import { LevelBadge, rewardsMoney, tierLabel } from "@/components/rewards/rewards-ui";
import { creditByCompany } from "@/lib/stores/reward-ledger";
import { creditMoney } from "@/components/rewards/credit-ui";
import { availablePerksByCompany } from "@/lib/stores/reward-perks";

export const metadata = { title: "Rewards — Quartzite-6" };

/**
 * Customer Rewards (#282 Phase 1, spec §7): customers ready to move up a
 * tier (Approve/Dismiss) and every customer with counted purchases by
 * lifetime spend, (phase 2) credit balance and (phase 4) available perks, filterable by earned level. While the program is off an
 * admin sees a labeled preview (buttons inert); everyone else sees a notice.
 */

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

const CSS = `
  .rw-row:hover { background: #fafbff; }
  .rw-grid { display: grid; grid-template-columns: minmax(0,1.6fr) 104px 128px 112px 64px 118px minmax(0,1.2fr) 64px; gap: 10px; align-items: center; }
  @media (max-width: 860px) {
    .rw-grid { grid-template-columns: minmax(0,1.6fr) 96px 104px; }
    .rw-wide { display: none !important; }
  }
`;

const th: CSSProperties = { fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em" };
const cell: CSSProperties = { fontSize: 12.5, color: "#3a3f4a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

export default async function RewardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [me, sp] = await Promise.all([requirePerm("create"), searchParams]);
  const program = await getRewardsProgram();
  const isAdmin = can("manage_users", me.roles);
  const canApprove = can("approve", me.roles);

  if (!program.enabled && !isAdmin) {
    return (
      <div className="pk-content" style={{ maxWidth: 720, margin: "0 auto" }}>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", marginBottom: 14 }}>Rewards</div>
        <div className="pk-card" style={{ padding: "22px 20px", fontSize: 13, color: "#5b616e" }}>
          The Rewards program is off. An admin turns it on in Settings → Rewards.
        </div>
      </div>
    );
  }

  const preview = !program.enabled;
  const [board, credit] = await Promise.all([rewardsBoard(program), creditByCompany()]);
  // #282 phase 4: perks available to each customer right now.
  const perkCounts = await availablePerksByCompany(board, program);
  const levelParam = one(sp.level);
  const level: RewardLevel | "all" = isRewardLevel(levelParam) ? levelParam : "all";
  const rows = level === "all" ? board : board.filter((r) => r.earned === level);
  const ready = board.filter((r) => r.suggestion);
  const counts = Object.fromEntries(REWARD_LEVELS.map((l) => [l, board.filter((r) => r.earned === l).length])) as Record<
    RewardLevel,
    number
  >;
  const chip = (key: RewardLevel | "all", label: string, n: number) => {
    const on = level === key;
    return (
      <Link
        key={key}
        href={key === "all" ? "/rewards" : `/rewards?level=${key}`}
        style={{
          fontSize: 12,
          fontWeight: 600,
          padding: "6px 11px",
          borderRadius: 20,
          textDecoration: "none",
          color: on ? "#fff" : "#3a3f4a",
          background: on ? "#3a3f4a" : "#fff",
          border: `1px solid ${on ? "#3a3f4a" : "#e4e7ec"}`,
        }}
      >
        {label} <span style={{ fontFamily: "var(--font-mono)", fontWeight: 500, opacity: 0.75 }}>{n}</span>
      </Link>
    );
  };

  return (
    <div className="pk-content" style={{ maxWidth: 1080, margin: "0 auto" }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9, flexWrap: "wrap" }}>
          <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Rewards</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#9aa0ab" }}>{board.length}</span>
        </div>
        {isAdmin && (
          <Link href="/settings/rewards" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
            Program settings
          </Link>
        )}
      </div>

      {preview && (
        <div
          style={{
            fontSize: 12.5,
            color: "#8a6d1f",
            background: "#fbf3dd",
            border: "1px solid #f0e2b6",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 16,
          }}
        >
          <b>Program is off — preview.</b> Only admins see this page while it is off; nothing can be approved until the
          program is turned on in <Link href="/settings/rewards" style={{ color: "inherit" }}>Settings → Rewards</Link>.
        </div>
      )}

      {/* Ready to move up */}
      <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 18px 12px", borderBottom: "1px solid #f0f1f4" }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Ready to move up</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{ready.length}</span>
        </div>
        {ready.length === 0 ? (
          <div style={{ padding: "20px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            No customers have earned a tier above their current one.
          </div>
        ) : (
          <ShortList
            initial={10}
            searchPlaceholder="Search customers…"
            items={ready.map((r) => (
              <div
                key={r.companyId}
                style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 18px", borderBottom: "1px solid #f5f6f8" }}
              >
                <span style={{ flex: 1, minWidth: 200 }}>
                  <Link
                    href={`/companies/${encodeURIComponent(r.companyId)}#rewards`}
                    style={{ fontSize: 13.5, fontWeight: 600, color: "inherit", textDecoration: "none" }}
                  >
                    {r.name}
                  </Link>
                  <span style={{ display: "block", fontSize: 11.5, color: "#8c919c", marginTop: 3 }}>
                    {rewardsMoney(r.spend)} lifetime · {tierLabel(r.companyTier)} → {REWARD_LEVEL_LABEL[r.suggestion!]}
                  </span>
                </span>
                <SuggestionActions
                  companyId={r.companyId}
                  levelLabel={REWARD_LEVEL_LABEL[r.suggestion!]}
                  disabled={preview || !canApprove}
                  disabledReason={preview ? "The program is off" : "Needs approve permission"}
                />
              </div>
            ))}
            searchText={ready.map((r) => r.name)}
          />
        )}
      </div>

      {/* All customers by lifetime spend */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {chip("all", "All", board.length)}
        {REWARD_LEVELS.map((l) => chip(l, REWARD_LEVEL_LABEL[l], counts[l]))}
      </div>
      <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginBottom: 18 }}>
        <div className="rw-grid" style={{ padding: "9px 18px", background: "#fafbfc", borderBottom: "1px solid #f0f1f4" }}>
          <span style={th}>Customer</span>
          <span style={th}>Level</span>
          <span style={{ ...th, textAlign: "right" }}>Lifetime spend</span>
          <span className="rw-wide" style={{ ...th, textAlign: "right" }}>Credit</span>
          <span className="rw-wide" style={{ ...th, textAlign: "right" }} title="Available perks">Perks</span>
          <span className="rw-wide" style={th}>Current tier</span>
          <span className="rw-wide" style={th}>Next level</span>
          <span className="rw-wide" style={{ ...th, textAlign: "right" }}>Sales</span>
        </div>
        {rows.length === 0 ? (
          <div style={{ padding: "20px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            {board.length === 0 ? "No counted purchases yet." : "No customers at this level."}
          </div>
        ) : (
          <ShortList
            initial={50}
            searchPlaceholder="Search customers…"
            items={rows.map((r) => (
              <Link
                key={r.companyId}
                href={`/companies/${encodeURIComponent(r.companyId)}#rewards`}
                className="rw-grid rw-row"
                style={{ padding: "11px 18px", borderBottom: "1px solid #f5f6f8", textDecoration: "none", color: "inherit" }}
              >
                <span style={{ ...cell, fontWeight: 600, color: "#16181d" }}>{r.name}</span>
                <span>
                  <LevelBadge level={r.earned} />
                </span>
                <span style={{ ...cell, fontFamily: "var(--font-mono)", textAlign: "right" }}>{rewardsMoney(r.spend)}</span>
                {/* #282 phase 2: credit balance (available when some is parked on open quotes). */}
                <span
                  className="rw-wide"
                  title={
                    credit.get(r.companyId)
                      ? `Balance ${creditMoney(credit.get(r.companyId)!.balance)} · available ${creditMoney(credit.get(r.companyId)!.available)}`
                      : "No credit"
                  }
                  style={{ ...cell, fontFamily: "var(--font-mono)", textAlign: "right", color: credit.get(r.companyId)?.balance ? "#1f8a5b" : "#aab0bb" }}
                >
                  {credit.get(r.companyId) ? creditMoney(credit.get(r.companyId)!.balance) : "—"}
                </span>
                <span
                  className="rw-wide"
                  data-testid="rewards-perk-count"
                  title="Available perks"
                  style={{ ...cell, fontFamily: "var(--font-mono)", textAlign: "right", color: perkCounts.get(r.companyId) ? "#16181d" : "#aab0bb" }}
                >
                  {perkCounts.get(r.companyId) || "—"}
                </span>
                <span className="rw-wide" style={cell}>
                  {tierLabel(r.companyTier)}
                  {r.suggestion ? " ↑" : ""}
                </span>
                <span className="rw-wide" style={{ ...cell, color: "#8c919c" }}>
                  {r.next ? `${rewardsMoney(r.next.need)} to ${REWARD_LEVEL_LABEL[r.next.level]}` : "Top level"}
                </span>
                <span className="rw-wide" style={{ ...cell, fontFamily: "var(--font-mono)", textAlign: "right" }}>
                  {r.purchases.length}
                </span>
              </Link>
            ))}
            searchText={rows.map((r) => r.name)}
          />
        )}
      </div>
    </div>
  );
}
