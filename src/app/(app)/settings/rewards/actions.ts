"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { getRewardsProgram, saveRewardsProgram } from "@/lib/stores/rewards";
import { rewardsProgramErrors, sanitizeRewardsProgram, type RewardsProgram } from "@/lib/rewards/program";

/**
 * Settings → Rewards save (#282 Phase 1). Admin-only. Typed mistakes come
 * back as errors (rewardsProgramErrors) instead of being silently fixed;
 * what is written is the sanitized program. Perks are not edited here yet
 * (phase 4) — the stored ones pass through untouched.
 */
export type RewardsProgramInput = Pick<RewardsProgram, "enabled" | "thresholds" | "earnPct" | "retro">;

export async function saveRewardsProgramAction(
  input: RewardsProgramInput
): Promise<{ ok: true; program: RewardsProgram } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const errs = rewardsProgramErrors(input);
  if (errs.length) return { ok: false, error: errs.join(" ") };
  const prev = await getRewardsProgram();
  const clean = sanitizeRewardsProgram({ ...input, perks: prev.perks });
  const program = await saveRewardsProgram({
    enabled: clean.enabled,
    thresholds: clean.thresholds,
    earnPct: clean.earnPct,
    retro: clean.retro,
    perks: prev.perks,
  });
  revalidatePath("/", "layout");
  return { ok: true, program };
}
