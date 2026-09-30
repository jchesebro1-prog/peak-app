"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import {
  approveRewardSuggestion,
  dismissRewardSuggestion,
  type RewardsActionResult,
} from "@/lib/stores/rewards";

/**
 * Customer Rewards suggestion actions (#282 Phase 1, spec §3). Both need the
 * `approve` permission and a running program; the level is recomputed on the
 * server, never taken from the client.
 */

function refresh(companyId: string) {
  revalidatePath("/rewards");
  revalidatePath(`/companies/${encodeURIComponent(companyId)}`);
}

export async function approveRewardAction(companyId: string): Promise<RewardsActionResult> {
  const me = await requireUser();
  if (!can("approve", me.roles)) return { ok: false, error: "You need approve permission to move a tier." };
  const id = String(companyId || "").trim();
  if (!id) return { ok: false, error: "Company not found." };
  const res = await approveRewardSuggestion(id);
  if (res.ok) {
    // The company tier seeds pricing everywhere a customer is picked.
    revalidatePath("/", "layout");
    refresh(id);
  }
  return res;
}

export async function dismissRewardAction(companyId: string): Promise<RewardsActionResult> {
  const me = await requireUser();
  if (!can("approve", me.roles)) return { ok: false, error: "You need approve permission to dismiss a suggestion." };
  const id = String(companyId || "").trim();
  if (!id) return { ok: false, error: "Company not found." };
  const res = await dismissRewardSuggestion(id, me.name);
  if (res.ok) refresh(id);
  return res;
}
