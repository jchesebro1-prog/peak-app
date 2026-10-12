/** Estimator bonuses — the store-owned record written at Won (pure). */
import type { SpecSection } from "@/app/(app)/estimator/types";
import { round2, systemSellTotal } from "@/app/(app)/estimator/pricing";
import type { ClientResponse } from "@/lib/estimate-output/responses";
import { isBonusItem, isEstimatorBonusItem, isPackageBonusItem } from "./flags";

export type BonusSplit = { leadPct: number };
export type BonusCredit = { name: string; userId: string | null; role: "lead" | "prepared"; pct: number; amount: number };
export type BonusRecord = {
  wonAt: number;
  sellTotal: number;
  estimatorBonus: number;
  packageBonusCost: number;
  alternatesTaken: string[];
  credits: BonusCredit[];
};

export function normalizeSplit(v: unknown): BonusSplit {
  const n = v && typeof v === "object" ? Number((v as { leadPct?: unknown }).leadPct) : NaN;
  return { leadPct: Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 50 };
}

export function quoteHasBonusLines(sections: SpecSection[]): boolean {
  return sections.some((s) => s.items.some(isBonusItem));
}

export function resolveUserId(name: string, users: { id: string; name: string }[]): string | null {
  const k = name.trim().toLowerCase();
  if (!k) return null;
  const hits = users.filter((u) => (u.name || "").trim().toLowerCase() === k);
  return hits.length === 1 ? hits[0].id : null;
}

export function defaultAlternatesTaken(sections: SpecSection[], responses: ClientResponse[] | null | undefined): string[] {
  const alts = new Set(sections.filter((s) => s.alternate === true).map((s) => s.id));
  const accepts = (responses || []).filter((r) => r.kind === "accept").sort((a, b) => b.at - a.at);
  return accepts.length ? accepts[0].sectionIds.filter((id) => alts.has(id)) : [];
}

export function buildBonusRecord(input: {
  sections: SpecSection[];
  owner: string;
  preparedBy?: string | null;
  split?: BonusSplit | null;
  alternatesTaken: string[];
  users: { id: string; name: string }[];
  wonAt: number;
}): BonusRecord {
  const taken = new Set(input.alternatesTaken);
  const counted = input.sections.filter((s) => s.alternate !== true || taken.has(s.id));
  let sell = 0, est = 0, pkg = 0;
  for (const s of counted) {
    sell += systemSellTotal(s);
    for (const it of s.items) {
      if (it.option) continue;
      if (isEstimatorBonusItem(it)) est += it.qty * it.price;
      if (isPackageBonusItem(it)) pkg += it.qty * it.cost;
    }
  }
  const estimatorBonus = round2(est);
  const lead = (input.owner || "").trim();
  const prep = (input.preparedBy || "").trim();
  const shares: { name: string; role: "lead" | "prepared"; pct: number }[] = [];
  if (lead && prep && lead.toLowerCase() !== prep.toLowerCase()) {
    const lp = normalizeSplit(input.split).leadPct;
    shares.push({ name: lead, role: "lead", pct: lp }, { name: prep, role: "prepared", pct: 100 - lp });
  } else if (lead || prep) {
    shares.push({ name: lead || prep, role: lead ? "lead" : "prepared", pct: 100 });
  }
  const live = shares.filter((s) => s.pct > 0);
  let given = 0;
  const credits: BonusCredit[] = live.map((s, i) => {
    const amount = i === live.length - 1 ? round2(estimatorBonus - given) : round2((estimatorBonus * s.pct) / 100);
    given = round2(given + amount);
    return { name: s.name, userId: resolveUserId(s.name, input.users), role: s.role, pct: s.pct, amount };
  });
  return {
    wonAt: input.wonAt,
    sellTotal: round2(sell),
    estimatorBonus,
    packageBonusCost: round2(pkg),
    alternatesTaken: counted.filter((s) => s.alternate === true).map((s) => s.id),
    credits,
  };
}
