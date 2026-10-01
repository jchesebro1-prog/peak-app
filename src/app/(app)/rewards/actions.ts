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
import {
  fulfilPerkRedemption,
  markPerkUsed,
  purchasePerksForCompany,
  redeemPerk,
  undoPerkUse,
} from "@/lib/stores/reward-perks";
import { formatPoints } from "@/lib/rewards/points";
import { purchasePerksBannerText } from "@/lib/rewards/purchase-perks";

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
  /** #282 perks+points: the staff banner text ("Gold purchase perks: …"), "" when none. */
  purchasePerks?: string;
  /** #282 perks+points: the customer this answer is for (a stale answer shows nothing). */
  customerId?: string;
};

/**
 * The Estimator's Apply credit panel: the customer's balance and what this
 * quote may still take. Read-only; the save clamps again on the server.
 */
export async function rewardCreditInfoAction(customerId: string | null, quoteId: string | null): Promise<RewardCreditInfo> {
  await requireUser();
  const program = await getRewardsProgram();
  const id = String(customerId || "").trim();
  if (!program.enabled || !id) return { enabled: program.enabled, balance: 0, available: 0, purchasePerks: "" };
  const [c, pp] = await Promise.all([companyCredit(id, quoteId || null), purchasePerksForCompany(id)]);
  return { enabled: true, balance: c.balance, available: c.available, purchasePerks: purchasePerksBannerText(pp), customerId: id };
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

/* ---------- #282 phase 4: perks ---------- */

/**
 * Company card → Mark used (`create`). The store recomputes availability
 * (program on, level, once/yearly window, active) and checks the quote link
 * belongs to the company — nothing is trusted from the client.
 */
export async function markPerkUsedAction(
  companyId: string,
  perkId: string,
  quoteId: string,
  note: string
): Promise<CreditActionResult> {
  const me = await requireUser();
  if (!can("create", me.roles)) return { ok: false, error: "You need create permission to mark a perk used." };
  const id = String(companyId || "").trim();
  if (!id) return { ok: false, error: "Company not found." };
  const res = await markPerkUsed({ companyId: id, perkId: String(perkId || ""), quoteId, note, by: me.name });
  if (!res.ok) return res;
  refresh(id);
  return { ok: true, message: "Marked used." };
}

/** Company card → Undo a perk use (manage_users): posts an `unperk` entry; the use stays on the ledger. */
export async function undoPerkUseAction(companyId: string, useId: string): Promise<CreditActionResult> {
  const me = await requireUser();
  if (!can("manage_users", me.roles)) return { ok: false, error: "Only an admin (manage users) can undo a perk use." };
  const id = String(companyId || "").trim();
  if (!id) return { ok: false, error: "Company not found." };
  const res = await undoPerkUse(id, String(useId || ""), me.name);
  if (!res.ok) return res;
  refresh(id);
  // #282 perks+points: an undone redemption leaves the bell's "Perks to fulfil".
  revalidatePath("/", "layout");
  return { ok: true, message: res.entry.amount > 0 ? `Undone — ${formatPoints(res.entry.amount)} refunded.` : "Undone." };
}

/* ---------- #282 perks+points: redeem, fulfil, purchase perks ---------- */

/**
 * Company card → Redeem (`create`): free at the perk's unlock level, else
 * bought with the company's points. `expectMode` / `expectPoints` are what
 * the card showed — the store refuses when the server's answer differs, and
 * recomputes everything (level, window, points) under the company's lock.
 */
export async function redeemPerkAction(
  companyId: string,
  perkId: string,
  expectMode: "free" | "points",
  expectPoints: number | null,
  note: string
): Promise<CreditActionResult> {
  const me = await requireUser();
  if (!can("create", me.roles)) return { ok: false, error: "You need create permission to redeem a perk." };
  const id = String(companyId || "").trim();
  if (!id) return { ok: false, error: "Company not found." };
  const res = await redeemPerk({
    companyId: id,
    perkId: String(perkId || ""),
    via: "staff",
    by: me.name,
    note,
    expect: { mode: expectMode === "points" ? "points" : "free", pointCost: expectPoints == null ? null : Number(expectPoints) },
  });
  if (!res.ok) return res;
  refresh(id);
  revalidatePath("/", "layout");
  return { ok: true, message: res.entry.redeemed === "points" ? `Redeemed for ${formatPoints(-res.entry.amount)}.` : "Redeemed." };
}

/** Company card → Mark fulfilled (`create`): records that a redemption was delivered (once). */
export async function fulfilPerkAction(companyId: string, useId: string): Promise<CreditActionResult> {
  const me = await requireUser();
  if (!can("create", me.roles)) return { ok: false, error: "You need create permission to mark a perk fulfilled." };
  const id = String(companyId || "").trim();
  if (!id) return { ok: false, error: "Company not found." };
  const res = await fulfilPerkRedemption(id, String(useId || ""), me.name);
  if (!res.ok) return res;
  refresh(id);
  revalidatePath("/", "layout");
  return { ok: true, message: "Marked fulfilled." };
}

/**
 * The staff purchase-perks banner (flame / inspection / repair builders):
 * "Gold purchase perks: Free freight · Waived travel" for the customer picked
 * now, or "" (program off, no customer, none earned). The Estimator gets the
 * same text through rewardCreditInfoAction. Informational — v1 never changes
 * a price.
 */
export async function purchasePerksBannerAction(customerId: string | null): Promise<string> {
  await requireUser();
  return purchasePerksBannerText(await purchasePerksForCompany(customerId));
}
