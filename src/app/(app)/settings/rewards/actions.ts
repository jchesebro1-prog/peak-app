"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { getRewardsProgram, saveRewardsProgram } from "@/lib/stores/rewards";
import { rewardsProgramErrors, sanitizeRewardsProgram, type RewardsProgram } from "@/lib/rewards/program";
import { saveRewardsPerks, saveRewardsPurchasePerks } from "@/lib/stores/reward-perks";
import type { PerkDraft } from "@/lib/rewards/perks";
import type { PurchasePerkDraft } from "@/lib/rewards/purchase-perks";

/**
 * Settings → Rewards save (#282 Phase 1). Admin-only. Typed mistakes come
 * back as errors (rewardsProgramErrors) instead of being silently fixed;
 * what is written is the sanitized program. Perks are saved separately
 * (savePerksAction, #282 phase 4) — the stored ones pass through untouched.
 */
export type RewardsProgramInput = Pick<RewardsProgram, "enabled" | "thresholds" | "earnPct" | "retro">;

export async function saveRewardsProgramAction(
  input: RewardsProgramInput
): Promise<{ ok: true; program: RewardsProgram } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const errs = rewardsProgramErrors(input);
  if (errs.length) return { ok: false, error: errs.join(" ") };
  const prev = await getRewardsProgram();
  const clean = sanitizeRewardsProgram({ ...input, perks: prev.perks, purchasePerks: prev.purchasePerks });
  const program = await saveRewardsProgram({
    enabled: clean.enabled,
    thresholds: clean.thresholds,
    earnPct: clean.earnPct,
    retro: clean.retro,
    perks: prev.perks,
    purchasePerks: prev.purchasePerks,
  });
  revalidatePath("/", "layout");
  return { ok: true, program };
}

/**
 * Settings → Rewards → Perks save (#282 phase 4). Admin-only. The list is the
 * display order; stored perks keep their ids, new ones get server-minted ids
 * (never a removed perk's), a perk left out is kept as a tombstone so its past
 * uses keep their name. The rest of the program is untouched.
 */
export async function savePerksAction(
  drafts: PerkDraft[]
): Promise<{ ok: true; program: RewardsProgram } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const res = await saveRewardsPerks(drafts);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}

/**
 * Settings → Rewards → Perks → Purchase perks save (#282 perks+points).
 * Admin-only. Every tier's list in one save; ids are server-minted, removed
 * ones kept as tombstones. The rest of the program is untouched.
 */
export async function savePurchasePerksAction(
  drafts: PurchasePerkDraft[]
): Promise<{ ok: true; program: RewardsProgram } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const res = await saveRewardsPurchasePerks(drafts);
  if (res.ok) revalidatePath("/", "layout");
  return res;
}
