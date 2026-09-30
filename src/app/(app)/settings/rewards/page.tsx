import Link from "next/link";
import { requirePerm } from "@/lib/session";
import { getRewardsProgram } from "@/lib/stores/rewards";
import { RewardsProgramForm } from "./rewards-form";

export const metadata = { title: "Rewards settings — Quartzite-6" };

/**
 * Settings → Rewards (#282 Phase 1, spec §1): the program switch, the
 * lifetime-spend thresholds, earn % by level and the starting-credit rate
 * and cap. Admin-only; the one Rewards screen that shows while the program
 * is off.
 */
export default async function RewardsSettingsPage() {
  await requirePerm("manage_users");
  const program = await getRewardsProgram();
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
    </div>
  );
}
