import Link from "next/link";
import { PRICING_TIER_LABEL, type PricingTier } from "@/lib/identity/config";
import { REWARD_LEVEL_LABEL, type NextLevel, type RewardLevel } from "@/lib/rewards/program";
import type { Purchase } from "@/lib/rewards/spend";
import { quoteBuilderHref } from "@/lib/quote-links";
import { yearAwareDate } from "@/lib/format";

/**
 * Customer Rewards display pieces (#282 Phase 1) shared by the company
 * record's Rewards card and /rewards. Server components — no state.
 */

export const LEVEL_TONE: Record<RewardLevel, { ink: string; soft: string; bar: string }> = {
  base: { ink: "#5b616e", soft: "#f1f2f5", bar: "#aab0bb" },
  copper: { ink: "#9a5530", soft: "#f8ece3", bar: "#c07a4f" },
  silver: { ink: "#5d6570", soft: "#eef0f3", bar: "#9aa2ad" },
  gold: { ink: "#8a6d1f", soft: "#fbf3dd", bar: "#c9a43a" },
  platinum: { ink: "#3e5a78", soft: "#e8eef5", bar: "#6f8fb2" },
};

export function rewardsMoney(n: number): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

export function LevelBadge({ level, suffix }: { level: RewardLevel; suffix?: string }) {
  const t = LEVEL_TONE[level];
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: t.ink,
        background: t.soft,
        padding: "3px 10px",
        borderRadius: 20,
        whiteSpace: "nowrap",
      }}
    >
      {REWARD_LEVEL_LABEL[level]}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

/** The company's stored tier as a label (none → "Base (default)"). */
export function tierLabel(tier: string | null): string {
  const t = (tier || "").trim();
  if (!t) return "Base (default)";
  return PRICING_TIER_LABEL[t as PricingTier] ?? t;
}

export function ProgressToNext({
  earned,
  next,
  progress,
}: {
  earned: RewardLevel;
  next: NextLevel | null;
  progress: number;
}) {
  const tone = LEVEL_TONE[next ? next.level : earned];
  return (
    <div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        style={{ height: 8, borderRadius: 6, background: "#f1f2f5", overflow: "hidden" }}
      >
        <div style={{ width: `${Math.round(progress * 100)}%`, height: "100%", background: tone.bar, borderRadius: 6 }} />
      </div>
      <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 6 }}>
        {next
          ? `${rewardsMoney(next.need)} to ${REWARD_LEVEL_LABEL[next.level]} (${rewardsMoney(next.threshold)})`
          : "Top level reached"}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<Purchase["kind"], string> = { quote: "Won quote", project: "Project", repair: "Repair" };

export function purchaseHref(p: Purchase): string {
  if (p.kind === "quote") return quoteBuilderHref({ id: p.id, quoteType: p.quoteType });
  if (p.kind === "project") return `/projects/${encodeURIComponent(p.id)}`;
  return `/repairs/results?job=${encodeURIComponent(p.id)}`;
}

export function PurchaseRow({ p }: { p: Purchase }) {
  return (
    <Link
      href={purchaseHref(p)}
      className="cu-d-row"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 18px",
        borderBottom: "1px solid #f5f6f8",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {p.name}
        </span>
        <span style={{ display: "block", fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
          {KIND_LABEL[p.kind]} · {p.ref}
          {p.imported ? " · Daylite history" : ""}
          {p.at ? ` · ${yearAwareDate(p.at)}` : ""}
        </span>
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, color: "#16181d", flexShrink: 0 }}>
        {rewardsMoney(p.amount)}
      </span>
    </Link>
  );
}
