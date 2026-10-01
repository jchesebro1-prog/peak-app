// #282 perks+points — the staff bell's "Perks to fulfil" group, derived from
// the reward ledger (no writer, no to-do row): one item per redemption that
// is neither fulfilled nor undone. Pure: the loader (stores/reward-perks.ts
// perksToFulfil) and the company names come in as parameters.
import type { BellItem } from "@/components/nav/nav-data";
import { formatPoints } from "./points";

export type PerkBellRow = {
  companyId: string;
  useId: string;
  perkName: string;
  at: number;
  via: "portal" | "staff" | null;
  /** Points it cost (0 = free). */
  points: number;
};

/**
 * Bell items for unfulfilled redemptions — `names[i]` is row i's company name
 * ("" = the company no longer resolves: dropped, it has no page to clear it
 * from). Company-wide, like "New documents from customers".
 */
export function perkBellItems(rows: PerkBellRow[], names: string[]): BellItem[] {
  return rows.flatMap((r, i) =>
    names[i]
      ? [
          {
            id: "perk-" + r.useId,
            title: `${r.perkName} — ${names[i]}`,
            sub: `${r.via === "portal" ? "Redeemed in the portal" : "Redeemed"}${r.points > 0 ? ` · ${formatPoints(r.points)}` : " · free"} — mark it fulfilled`,
            href: `/companies/${encodeURIComponent(r.companyId)}#rewards`,
            letter: "★",
            color: "#b07a12",
          },
        ]
      : []
  );
}
