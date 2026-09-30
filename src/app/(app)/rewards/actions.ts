"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import {
  approveRewardSuggestion,
  dismissRewardSuggestion,
  getRewardsProgram,
  type RewardsActionResult,
} from "@/lib/stores/rewards";
import {
  companyCredit,
  postAdjustment,
  postAllStartingCredit,
  postStartingCredit,
} from "@/lib/stores/reward-ledger";
import { parseAdjustAmount } from "@/lib/rewards/ledger";

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

/* ---------- #282 phase 2: account credit ---------- */

export type RewardCreditInfo = {
  enabled: boolean;
  balance: number;
  /** balance − credit on the company's OTHER open quotes (not `quoteId`). */
  available: number;
};

/**
 * The Estimator's Apply credit panel: the customer's balance and what this
 * quote may still take. Read-only; the save clamps again on the server.
 */
export async function rewardCreditInfoAction(customerId: string | null, quoteId: string | null): Promise<RewardCreditInfo> {
  await requireUser();
  const program = await getRewardsProgram();
  const id = String(customerId || "").trim();
  if (!program.enabled || !id) return { enabled: program.enabled, balance: 0, available: 0 };
  const c = await companyCredit(id, quoteId || null);
  return { enabled: true, balance: c.balance, available: c.available };
}

export type CreditActionResult = { ok: true; message: string } | { ok: false; error: string };

const ADMIN_ONLY = "Only an admin (manage users) can post credit.";

/** Settings → Rewards → Starting credit: post one company's (manage_users). */
export async function postStartingCreditAction(companyId: string): Promise<CreditActionResult> {
  const me = await requireUser();
  if (!can("manage_users", me.roles)) return { ok: false, error: ADMIN_ONLY };
  const id = String(companyId || "").trim();
  if (!id) return { ok: false, error: "Company not found." };
  const res = await postStartingCredit(id, me.name);
  if (!res.ok) return res;
  revalidatePath("/settings/rewards");
  refresh(id);
  return { ok: true, message: res.already ? "Already posted." : `Posted $${res.posted.toFixed(2)}.` };
}

/** Settings → Rewards → Starting credit: post every unposted proposal (manage_users). */
export async function postAllStartingCreditAction(): Promise<CreditActionResult> {
  const me = await requireUser();
  if (!can("manage_users", me.roles)) return { ok: false, error: ADMIN_ONLY };
  const res = await postAllStartingCredit(me.name);
  revalidatePath("/settings/rewards");
  revalidatePath("/rewards");
  revalidatePath("/companies", "layout");
  return {
    ok: true,
    message: res.posted
      ? `Posted starting credit for ${res.posted} ${res.posted === 1 ? "company" : "companies"} ($${res.total.toFixed(2)}).`
      : "Nothing left to post.",
  };
}

/** Company card → Adjust: a signed amount with a required note (manage_users). */
export async function postAdjustmentAction(companyId: string, amount: string, note: string): Promise<CreditActionResult> {
  const me = await requireUser();
  if (!can("manage_users", me.roles)) return { ok: false, error: ADMIN_ONLY };
  const id = String(companyId || "").trim();
  if (!id) return { ok: false, error: "Company not found." };
  const n = parseAdjustAmount(amount);
  if (n == null) return { ok: false, error: "Enter an amount like 50 or -25 (not $0)." };
  const res = await postAdjustment(id, n, note, me.name);
  if (!res.ok) return res;
  refresh(id);
  return { ok: true, message: `Adjusted ${n > 0 ? "+" : "−"}$${Math.abs(n).toFixed(2)}.` };
}
