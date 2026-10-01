import Link from "next/link";
import { requirePerm } from "@/lib/session";
import { getRewardsProgram } from "@/lib/stores/rewards";
import { RewardsProgramForm } from "./rewards-form";
import { PerksEditor } from "./perks-editor";
import { PurchasePerksEditor } from "./purchase-perks-editor";
import { startingCreditBoard } from "@/lib/stores/reward-ledger";
import { ShortList } from "@/components/short-list";
import { creditMoney } from "@/components/rewards/credit-ui";
import { dollarsAndPoints } from "@/lib/rewards/points";
import { rewardsMoney } from "@/components/rewards/rewards-ui";
import { PostAllStartingCreditButton, PostStartingCreditButton } from "@/components/rewards/credit-actions";
import { yearAwareDate } from "@/lib/format";

export const metadata = { title: "Rewards settings — Quartzite-6" };

/**
 * Settings → Rewards (#282 Phase 1, spec §1): the program switch, the
 * lifetime-spend thresholds, earn % by level and the starting-credit rate
 * and cap. Admin-only; the one Rewards screen that shows while the program
 * is off. #282 phase 2 adds "Starting credit": every company with counted
 * history before launch (all history until the program is first turned on),
 * its proposed one-time credit — min(cap, history × rate) — and Post one /
 * Post all, each writing `start:<companyId>` exactly once. #282 phase 4 adds
 * "Perks": add / edit / remove / reorder perk definitions.
 */
export default async function RewardsSettingsPage() {
  await requirePerm("manage_users");
  const program = await getRewardsProgram();
  const starting = await startingCreditBoard(program);
  const unposted = starting.filter((r) => r.posted == null && r.proposed > 0);
  return (
    <div className="pk-content" style={{ maxWidth: 760, margin: "0 auto" }}>
      <Link
        href="/settings?section=admin"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none", marginBottom: 16 }}
      >
        ‹ Settings
      </Link>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Rewards</span>
        <Link href="/rewards" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
          Open Rewards
        </Link>
      </div>
      <div style={{ fontSize: 12.5, color: "#8c919c", marginBottom: 18, lineHeight: 1.5 }}>
        Customers earn a level from their lifetime purchases — won quotes plus imported Daylite history. When a customer
        earns a level above their pricing tier, Rewards suggests the move and someone with approve permission confirms it.
      </div>
      <RewardsProgramForm program={program} />
      {/* #282 phase 4: perk definitions (their own Save). */}
      <PerksEditor perks={program.perks} />
      {/* #282 perks+points: standing purchase perks by tier (their own Save). */}
      <PurchasePerksEditor purchasePerks={program.purchasePerks} />

      <div className="pk-card" style={{ padding: 0, overflow: "hidden", marginTop: 22 }} id="starting-credit">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
            padding: "14px 18px 12px",
            borderBottom: "1px solid #f0f1f4",
          }}
        >
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Starting credit</div>
            <div style={{ fontSize: 12, color: "#8c919c", marginTop: 3, lineHeight: 1.5 }}>
              One-time credit from history{" "}
              {program.launchedAt ? `before the program launched (${yearAwareDate(program.launchedAt)})` : "(all history — the program hasn't launched yet)"}:{" "}
              {program.retro.ratePct}% of it, rounded up to whole dollars, capped at {creditMoney(program.retro.capPerCustomer)} per customer.
              Each company is posted once. Customers see credit as points (1 point = $1).
            </div>
          </div>
          <PostAllStartingCreditButton count={unposted.length} />
        </div>
        {starting.length === 0 ? (
          <div style={{ padding: "20px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>No history to credit.</div>
        ) : (
          <ShortList
            initial={25}
            searchPlaceholder="Search companies…"
            items={starting.map((r) => (
              <div
                key={r.companyId}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 18px", borderBottom: "1px solid #f5f6f8" }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <Link
                    href={`/companies/${encodeURIComponent(r.companyId)}#rewards`}
                    style={{ fontSize: 13, fontWeight: 600, color: "inherit", textDecoration: "none" }}
                  >
                    {r.name}
                  </Link>
                  <span style={{ display: "block", fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
                    {rewardsMoney(r.historySpend)} history · proposed {dollarsAndPoints(r.proposed)}
                  </span>
                </span>
                {r.posted != null ? (
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#1f8a5b", whiteSpace: "nowrap" }}>
                    Posted {dollarsAndPoints(r.posted)}
                  </span>
                ) : r.proposed > 0 ? (
                  <PostStartingCreditButton companyId={r.companyId} />
                ) : (
                  <span style={{ fontSize: 12, color: "#aab0bb" }}>Nothing to post</span>
                )}
              </div>
            ))}
            searchText={starting.map((r) => r.name)}
          />
        )}
      </div>
    </div>
  );
}
