/**
 * Customer Rewards — purchase perks (#282 perks+points follow-up, Jeff
 * 2026-10-01): standing benefits on EVERY purchase at a reward level ("Free
 * freight", "Waived travel"). Unlike a perk (perks.ts) a purchase perk is
 * never used up and posts nothing — v1 is informational only: staff see a
 * banner in the Estimator and the service builders, the customer sees them on
 * the portal Rewards card and as one line on their quote documents. Pricing
 * is untouched.
 *
 * Definitions live in the program blob (`RewardsProgram.purchasePerks`,
 * sanitized in program.ts); a customer's purchase perks are every active one
 * at a level ≤ their EARNED level (from lifetime spend — the same level the
 * portal shows, D501). Nothing shows while the program is off.
 *
 * Pure and client-safe.
 */

import {
  REWARD_LEVEL_LABEL,
  THRESHOLD_LEVELS,
  isThresholdLevel,
  levelRank,
  type PurchasePerk,
  type RewardLevel,
  type RewardsProgram,
  type ThresholdLevel,
} from "./program";
import { mintPerkId } from "./perk-ids";

/** What a customer (and the staff banner) sees: the earned level and its standing perks. */
export type CustomerPurchasePerks = {
  level: RewardLevel;
  levelLabel: string;
  perks: { id: string; name: string; description: string; level: ThresholdLevel }[];
};

const tierIndex = (l: string) => (THRESHOLD_LEVELS as readonly string[]).indexOf(l);

/** Live (active, not removed) purchase perks, grouped by tier (Copper first), list order kept within a tier. */
export function livePurchasePerks(list: PurchasePerk[]): PurchasePerk[] {
  return list
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.active && !p.removed)
    .sort((a, b) => tierIndex(a.p.level) - tierIndex(b.p.level) || a.i - b.i)
    .map(({ p }) => p);
}

/** Every active purchase perk at a level at or below `earned` (Base earns none). */
export function purchasePerksAt(list: PurchasePerk[], earned: RewardLevel): PurchasePerk[] {
  const rank = levelRank(earned);
  return livePurchasePerks(list).filter((p) => levelRank(p.level) <= rank);
}

/**
 * A customer's purchase perks — null while the program is off or when they
 * have none (so every surface can simply skip a null).
 */
export function customerPurchasePerks(
  program: Pick<RewardsProgram, "enabled" | "purchasePerks">,
  earned: RewardLevel
): CustomerPurchasePerks | null {
  if (!program.enabled) return null;
  const perks = purchasePerksAt(program.purchasePerks || [], earned);
  if (!perks.length) return null;
  return {
    level: earned,
    levelLabel: REWARD_LEVEL_LABEL[earned],
    perks: perks.map((p) => ({ id: p.id, name: p.name, description: p.description, level: p.level })),
  };
}

/** "Free freight · Waived travel". */
export function purchasePerkNames(v: CustomerPurchasePerks): string {
  return v.perks.map((p) => p.name).join(" · ");
}

/** STAFF banner: "Gold purchase perks: Free freight · Waived travel". */
export function purchasePerksBannerText(v: CustomerPurchasePerks | null): string {
  return v && v.perks.length ? `${v.levelLabel} purchase perks: ${purchasePerkNames(v)}` : "";
}

/** Customer documents (Estimator quote, flame / inspection letters): "Your Gold rewards: Free freight · Waived travel". */
export function purchasePerksDocLine(v: CustomerPurchasePerks | null): string {
  return v && v.perks.length ? `Your ${v.levelLabel} rewards: ${purchasePerkNames(v)}` : "";
}

/** "a", "a and b", "a, b and c". */
function listJoin(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The repair letter's one sentence: "As a Gold rewards customer, your purchase perks include Free freight and Waived travel." */
export function purchasePerksSentence(v: CustomerPurchasePerks | null): string {
  if (!v || !v.perks.length) return "";
  return `As a ${v.levelLabel} rewards customer, your purchase perks include ${listJoin(v.perks.map((p) => p.name))}.`;
}

/* ---------- Settings → Rewards → Perks → Purchase perks (the editor's merge) ---------- */

export type PurchasePerkDraft = {
  /** A stored purchase perk's id; anything else mints a new one. */
  id?: string;
  level: string;
  name: string;
  description: string;
  active: boolean;
};

export const PURCHASE_PERKS_MAX = 100;

/** Problems to show instead of silently dropping a row. */
export function purchasePerkDraftErrors(drafts: unknown): string[] {
  if (!Array.isArray(drafts)) return ["Purchase perks must be a list."];
  const errs: string[] = [];
  if (drafts.length > PURCHASE_PERKS_MAX) errs.push(`At most ${PURCHASE_PERKS_MAX} purchase perks.`);
  drafts.forEach((d, i) => {
    const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
    if (!String(o.name ?? "").trim()) errs.push(`Purchase perk ${i + 1} needs a name.`);
    if (!isThresholdLevel(o.level)) errs.push(`Purchase perk ${i + 1} needs a level (Copper, Silver, Gold or Platinum).`);
  });
  return errs;
}

/**
 * The editor's save — the same tombstone rule as perks (mergePerkEdits): a
 * draft whose id is a stored LIVE purchase perk keeps it; every other draft
 * gets a freshly minted id never seen before (`taken` = stored ids, tombstones
 * included, plus any extra ids passed); a stored live one left out becomes a
 * tombstone (removed, inactive). Output: live rows grouped by tier (list order
 * within a tier), then tombstones. The caller sanitizes the result.
 */
export function mergePurchasePerkEdits(
  stored: PurchasePerk[],
  drafts: PurchasePerkDraft[],
  opts: { takenIds?: Iterable<string>; rand?: () => number } = {}
): PurchasePerk[] {
  const live = new Map(stored.filter((p) => !p.removed).map((p) => [p.id, p]));
  const taken = new Set<string>([...stored.map((p) => p.id), ...(opts.takenIds ?? [])]);
  const kept = new Set<string>();
  const rows: { p: PurchasePerk; i: number }[] = [];
  drafts.forEach((d, i) => {
    const name = String(d?.name ?? "").trim();
    if (!name || !isThresholdLevel(d.level)) return;
    let id = String(d.id ?? "");
    if (!live.has(id) || kept.has(id)) {
      id = mintPerkId(name, taken, opts.rand);
      taken.add(id);
    }
    kept.add(id);
    rows.push({ p: { id, level: d.level, name, description: String(d.description ?? ""), active: d.active !== false }, i });
  });
  rows.sort((a, b) => tierIndex(a.p.level) - tierIndex(b.p.level) || a.i - b.i);
  const out = rows.map((r) => r.p);
  for (const p of stored) {
    if (kept.has(p.id)) continue;
    out.push({ ...p, active: false, removed: true });
  }
  return out;
}
