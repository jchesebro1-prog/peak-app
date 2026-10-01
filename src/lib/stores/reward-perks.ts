import { listDocsByField } from "@/db/doc-store";
import { REWARDS_LOCK_NAMESPACE, withAdvisoryLock } from "@/db";
import { getCompany } from "@/lib/identity/companies";
import { get as getQuote } from "@/lib/stores/quotes";
import { levelFor, type Perk, type RewardLevel, type RewardsProgram } from "@/lib/rewards/program";
import { lifetimeSpend } from "@/lib/rewards/spend";
import type { LedgerEntry } from "@/lib/rewards/ledger";
import { pointsFor } from "@/lib/rewards/points";
import {
  availablePerkCount,
  mergePerkEdits,
  perkBlockMessage,
  perkDraftErrors,
  perkFulfilId,
  perkRedemptionEntry,
  perkStatuses,
  perkUndoId,
  perkUses,
  portalRewardsView,
  unfulfilledRedemptions,
  type PerkDraft,
  type PerkMode,
  type PerkStatus,
  type PerkUse,
  type PortalRewardsView,
} from "@/lib/rewards/perks";
import {
  customerPurchasePerks,
  mergePurchasePerkEdits,
  purchasePerkDraftErrors,
  type CustomerPurchasePerks,
  type PurchasePerkDraft,
} from "@/lib/rewards/purchase-perks";
import { companyRewards, getRewardsProgram, purchasesFor, saveRewardsProgram } from "@/lib/stores/rewards";
import { companyCredit, ledgerForCompany, postLedgerEntries } from "@/lib/stores/reward-ledger";

/**
 * Customer Rewards — perks (#282 phase 4, spec §6, §7; perks+points
 * follow-up 2026-10-01). The editors' saves (perks + purchase perks), Mark
 * used / Redeem / Mark fulfilled / Undo (all add-only ledger posts), the
 * /rewards available-perk counts, the staff bell's "Perks to fulfil" and the
 * portal's Rewards card loader. Pure rules live in src/lib/rewards/perks.ts
 * and purchase-perks.ts. Callers check permissions (`manage_users` to edit
 * perks and Undo, `create` to Mark used / Redeem / Mark fulfilled).
 *
 * Every write that reads a company's perk uses or balance first (Mark used,
 * Redeem) runs under that company's Rewards advisory lock in one transaction
 * (`withAdvisoryLock`), so two simultaneous redemptions — of the same perk or
 * different ones — can never both spend the same points; ids stay
 * deterministic too, so a double click lands once.
 */

const PERK_KINDS = ["perk", "unperk", "perk-fulfil"];

async function perkEntries(): Promise<LedgerEntry[]> {
  return listDocsByField<LedgerEntry>("reward_ledger", "kind", PERK_KINDS);
}

/** Run one company's read-check-post under its Rewards lock. */
function withCompanyRewardsLock<T>(companyId: string, fn: () => Promise<T>): Promise<T> {
  return withAdvisoryLock(REWARDS_LOCK_NAMESPACE, companyId, fn);
}

function programWith(prev: RewardsProgram, patch: Partial<Pick<RewardsProgram, "perks" | "purchasePerks">>) {
  return {
    enabled: prev.enabled,
    thresholds: prev.thresholds,
    earnPct: prev.earnPct,
    retro: prev.retro,
    perks: patch.perks ?? prev.perks,
    purchasePerks: patch.purchasePerks ?? prev.purchasePerks,
  };
}

/* ---------- Settings → Rewards → Perks ---------- */

export type SavePerksResult = { ok: true; program: RewardsProgram } | { ok: false; error: string };

/**
 * Save the perk list (display order). Stored live perks keep their ids;
 * everything else is minted server-side, never reusing any id the blob or
 * the ledger has seen; a perk left out becomes a tombstone. The rest of the
 * program is untouched.
 */
export async function saveRewardsPerks(drafts: unknown): Promise<SavePerksResult> {
  const errs = perkDraftErrors(drafts);
  if (errs.length) return { ok: false, error: errs.join(" ") };
  const [prev, used] = await Promise.all([getRewardsProgram(), perkEntries()]);
  const perks = mergePerkEdits(prev.perks, drafts as PerkDraft[], {
    ledgerPerkIds: used.map((e) => e.perkId || "").filter(Boolean),
  });
  const program = await saveRewardsProgram(programWith(prev, { perks }));
  return { ok: true, program };
}

/**
 * #282 perks+points — save the purchase perks (every tier, display order).
 * Same id rule as perks: stored live ones keep their ids, new ones are
 * minted server-side (never a removed one's, never a perk's), a purchase perk
 * left out becomes a tombstone. The rest of the program is untouched.
 */
export async function saveRewardsPurchasePerks(drafts: unknown): Promise<SavePerksResult> {
  const errs = purchasePerkDraftErrors(drafts);
  if (errs.length) return { ok: false, error: errs.join(" ") };
  const prev = await getRewardsProgram();
  const purchasePerks = mergePurchasePerkEdits(prev.purchasePerks, drafts as PurchasePerkDraft[], {
    takenIds: prev.perks.map((p) => p.id),
  });
  const program = await saveRewardsProgram(programWith(prev, { purchasePerks }));
  return { ok: true, program };
}

/* ---------- Mark used / Redeem / Fulfil / Undo ---------- */

export type PerkActionResult = { ok: true; entry: LedgerEntry } | { ok: false; error: string };

/** The company's earned level, available credit and ledger — read inside the lock. */
async function perkContext(companyId: string, program: RewardsProgram) {
  const [purchases, credit] = await Promise.all([purchasesFor([companyId]), companyCredit(companyId)]);
  const earned = levelFor(lifetimeSpend(purchases.filter((p) => p.companyId === companyId)), program);
  return { earned, entries: credit.entries, available: credit.available };
}

/**
 * Record a use of a perk that staff delivered on the spot (spec §6) — FREE
 * perks only (a perk the company would have to buy with points goes through
 * Redeem). Refused while the program is off, for an unknown company or
 * perk, and when the perk isn't free to the company right now — its level,
 * once/yearly window and active flag are recomputed here, under the
 * company's lock, never taken from the client. An optional quote link must
 * be one of the company's own quotes.
 */
export async function markPerkUsed(input: {
  companyId: string;
  perkId: string;
  quoteId?: string | null;
  note?: string | null;
  by: string;
  now?: number;
}): Promise<PerkActionResult> {
  const program = await getRewardsProgram();
  if (!program.enabled) return { ok: false, error: "The Rewards program is off." };
  const companyId = String(input.companyId || "").trim();
  if (!companyId || !(await getCompany(companyId))) return { ok: false, error: "Company not found." };
  const perk = program.perks.find((p) => p.id === input.perkId && !p.removed);
  if (!perk) return { ok: false, error: "That perk no longer exists." };
  const quoteId = String(input.quoteId || "").trim();
  if (quoteId) {
    const q = await getQuote(quoteId);
    if (!q || q.customerId !== companyId) return { ok: false, error: "That quote isn't one of this company's." };
  }
  const now = input.now ?? Date.now();
  return withCompanyRewardsLock(companyId, async () => {
    const ctx = await perkContext(companyId, program);
    // Free availability only: no points in the context, so a points-only or
    // not-yet-unlocked perk reads as blocked.
    const st = perkStatuses([perk], { earned: ctx.earned, entries: ctx.entries, now })[0];
    if (!st.available || st.mode !== "free") {
      const msg = perkBlockMessage(st);
      return {
        ok: false as const,
        error: st.block === "level" && st.pointCost != null ? `${msg} Use Redeem to spend points on it.` : msg,
      };
    }
    const planned = perkRedemptionEntry({
      perk,
      companyId,
      earned: ctx.earned,
      entries: ctx.entries,
      available: 0,
      now,
      via: "staff",
      by: input.by,
      note: input.note,
    });
    if (!planned.ok) return planned;
    // A Mark used is delivered on the spot: no `redeemed`, nothing to fulfil.
    const { redeemed: _r, via: _v, ...rest } = planned.entry;
    void _r;
    void _v;
    const entry: LedgerEntry = { ...rest, amount: 0, ...(quoteId ? { quoteId } : {}) };
    const wrote = await postLedgerEntries([entry]);
    if (!wrote.length) return { ok: false as const, error: "That perk was just marked used." };
    return { ok: true as const, entry };
  });
}

/**
 * #282 perks+points — Redeem a perk for a company: FREE when its earned level
 * reaches the perk's unlock level, otherwise BOUGHT with points when the perk
 * has a point price and the company's spendable points (pointsFor(available
 * credit)) cover it. Everything is recomputed here inside one transaction
 * holding the company's Rewards lock, so concurrent redemptions serialize and
 * the second sees the first's debit. Posts one `perk` entry (amount 0, or
 * −pointCost dollars) flagged `redeemed`, which then waits for Mark fulfilled.
 * `expect` pins what the caller displayed ("Free" / "N points") — if the
 * server's answer differs the redemption is refused rather than surprising
 * anyone with a charge. Refused while the program is off.
 */
export async function redeemPerk(input: {
  companyId: string;
  perkId: string;
  via: "portal" | "staff";
  by: string;
  note?: string | null;
  expect?: { mode: PerkMode; pointCost: number | null } | null;
  now?: number;
}): Promise<PerkActionResult> {
  const program = await getRewardsProgram();
  if (!program.enabled) return { ok: false, error: "The Rewards program is off." };
  const companyId = String(input.companyId || "").trim();
  if (!companyId || !(await getCompany(companyId))) return { ok: false, error: "Company not found." };
  const perk = program.perks.find((p) => p.id === input.perkId && !p.removed) ?? null;
  if (!perk) return { ok: false, error: "That perk no longer exists." };
  const now = input.now ?? Date.now();
  return withCompanyRewardsLock(companyId, async () => {
    const ctx = await perkContext(companyId, program);
    const planned = perkRedemptionEntry({
      perk,
      companyId,
      earned: ctx.earned,
      entries: ctx.entries,
      available: ctx.available,
      now,
      via: input.via,
      by: input.by,
      note: input.note,
      expect: input.expect ?? null,
    });
    if (!planned.ok) return planned;
    const wrote = await postLedgerEntries([planned.entry]);
    if (!wrote.length) return { ok: false as const, error: "That perk was just redeemed." };
    return { ok: true as const, entry: planned.entry };
  });
}

/**
 * #282 perks+points — Mark fulfilled: staff delivered a redemption. Posts
 * `perk-fulfil` (amount 0) under the deterministic id `fulfil:<useId>`, so it
 * lands once however many times it is clicked. Refused for a Mark used entry
 * (already delivered), an undone redemption, or one already fulfilled.
 */
export async function fulfilPerkRedemption(companyId: string, useId: string, by: string, now: number = Date.now()): Promise<PerkActionResult> {
  const id = String(companyId || "").trim();
  if (!id) return { ok: false, error: "Company not found." };
  const use = perkUses(await ledgerForCompany(id)).find((u) => u.entry.id === useId);
  if (!use) return { ok: false, error: "That redemption wasn't found." };
  if (!use.entry.redeemed) return { ok: false, error: "That perk use was delivered when it was marked used." };
  if (use.undone) return { ok: false, error: "That redemption was undone." };
  if (use.fulfilled) return { ok: false, error: "That redemption is already fulfilled." };
  const entry: LedgerEntry = {
    id: perkFulfilId(use.entry.id),
    companyId: id,
    kind: "perk-fulfil",
    amount: 0,
    perkId: use.entry.perkId,
    useId: use.entry.id,
    at: now,
    by,
  };
  const wrote = await postLedgerEntries([entry]);
  if (!wrote.length) return { ok: false, error: "That redemption is already fulfilled." };
  return { ok: true, entry };
}

/**
 * Undo a perk use or redemption: posts `unperk` for it (add-only — the use
 * itself stays on the ledger) carrying the exact opposite amount, so a perk
 * bought with points refunds exactly what it cost, once (the undo's id is
 * deterministic). Allowed while the program is off: it's a correction, like
 * a reversal.
 */
export async function undoPerkUse(companyId: string, useId: string, by: string, note?: string): Promise<PerkActionResult> {
  const id = String(companyId || "").trim();
  if (!id) return { ok: false, error: "Company not found." };
  const entries = await ledgerForCompany(id);
  const use = perkUses(entries).find((u) => u.entry.id === useId);
  if (!use) return { ok: false, error: "That perk use wasn't found." };
  if (use.undone) return { ok: false, error: "That perk use was already undone." };
  const n = String(note || "").trim().slice(0, 500);
  const refund = typeof use.entry.amount === "number" && use.entry.amount < 0 ? -use.entry.amount : 0;
  const entry: LedgerEntry = {
    id: perkUndoId(use.entry.id),
    companyId: id,
    kind: "unperk",
    amount: refund,
    perkId: use.entry.perkId,
    ...(n ? { note: n } : {}),
    at: Date.now(),
    by,
  };
  const wrote = await postLedgerEntries([entry]);
  if (!wrote.length) return { ok: false, error: "That perk use was already undone." };
  return { ok: true, entry };
}

/* ---------- company card ---------- */

/**
 * The company card's perk panel from what the page already loaded: each
 * listable perk's availability now (free, or buyable with the company's
 * spendable points), and the perk-use history (undos and fulfilments
 * paired). Every action re-checks on the server; this is display only.
 */
export function companyPerkPanel(
  perks: Perk[],
  earned: RewardLevel,
  entries: LedgerEntry[],
  now: number = Date.now(),
  availableDollars: number = 0
): { statuses: PerkStatus[]; uses: PerkUse[]; points: number } {
  const points = pointsFor(availableDollars);
  return { statuses: perkStatuses(perks, { earned, entries, now, points }), uses: perkUses(entries), points };
}

/* ---------- /rewards ---------- */

/**
 * Available-perk count per company — free + buyable (#282 perks+points) —
 * for the given earned levels and available credit (the /rewards column).
 */
export async function availablePerksByCompany(
  rows: { companyId: string; earned: RewardLevel }[],
  program: RewardsProgram,
  now: number = Date.now(),
  availableByCompany?: Map<string, { available: number }>
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!program.perks.some((p) => p.active && !p.removed)) return out;
  const byCo = new Map<string, LedgerEntry[]>();
  for (const e of await perkEntries()) {
    const list = byCo.get(e.companyId);
    if (list) list.push(e);
    else byCo.set(e.companyId, [e]);
  }
  for (const r of rows) {
    const points = pointsFor(availableByCompany?.get(r.companyId)?.available ?? 0);
    out.set(r.companyId, availablePerkCount(program.perks, { earned: r.earned, entries: byCo.get(r.companyId) || [], now, points }));
  }
  return out;
}

/* ---------- staff bell: "Perks to fulfil" ---------- */

export type PerkToFulfil = { companyId: string; useId: string; perkName: string; at: number; via: "portal" | "staff" | null; points: number };

/** Every redemption not yet fulfilled or undone, newest first (any program state — they are owed). */
export async function perksToFulfil(): Promise<PerkToFulfil[]> {
  const entries = await perkEntries();
  if (!entries.length) return [];
  const program = await getRewardsProgram();
  const names = new Map(program.perks.map((p) => [p.id, p.name]));
  return unfulfilledRedemptions(entries).map((u) => ({
    companyId: u.entry.companyId,
    useId: u.entry.id,
    perkName: names.get(u.entry.perkId || "") || u.entry.perkId || "Perk",
    at: u.entry.at,
    via: u.entry.via ?? null,
    points: u.entry.amount < 0 ? pointsFor(-u.entry.amount) : 0,
  }));
}

/* ---------- purchase perks (#282 perks+points) ---------- */

/**
 * A customer's purchase perks for the staff banner and the customer
 * documents: every active purchase perk at or below the company's EARNED
 * level. Null while the program is off, for no/unknown company, or when it
 * has none.
 */
export async function purchasePerksForCompany(customerId: string | null | undefined): Promise<CustomerPurchasePerks | null> {
  const id = String(customerId || "").trim();
  if (!id) return null;
  const program = await getRewardsProgram();
  if (!program.enabled || !program.purchasePerks.some((p) => p.active && !p.removed)) return null;
  const view = await companyRewards(id, program);
  if (!view) return null;
  return customerPurchasePerks(program, view.earned);
}

/* ---------- portal (spec §7) ---------- */

/**
 * The portal Rewards card for ONE company — the caller passes the grant's
 * customer id (portalSession / resolvePortalViewer), never a query param.
 * Null while the program is off or for an unknown company. Returns the
 * whitelisted view only (no margins, no earn %, no ledger, no purchases, no
 * dollar amounts).
 */
export async function portalRewards(customerId: string, now: number = Date.now()): Promise<PortalRewardsView | null> {
  const id = String(customerId || "").trim();
  if (!id) return null;
  const program = await getRewardsProgram();
  if (!program.enabled) return null;
  const view = await companyRewards(id, program);
  if (!view) return null;
  const credit = await companyCredit(id);
  return portalRewardsView({
    program,
    spend: view.spend,
    balance: credit.balance,
    available: credit.available,
    entries: credit.entries,
    now,
  });
}

/**
 * #282 perks+points — the portal's Redeem, given the RESOLVED viewer (the
 * server action resolves it from the grant cookie / team preview; nothing
 * here comes from the client but the perk and what the card showed).
 * Refused in a team preview, without a portal session, and when the card
 * was rendered for a different company than the session's grant (a stale
 * page after switching grants). The company is always the grant's own.
 */
export async function portalRedeemPerk(
  viewer: { session: { grantId: string; customerId: string; name: string } | null; preview: boolean },
  input: { perkId: string; companyId?: string | null; expect?: { mode: PerkMode; pointCost: number | null } | null }
): Promise<PerkActionResult> {
  if (viewer.preview) return { ok: false, error: "Redeeming is disabled in the team preview." };
  const s = viewer.session;
  if (!s || !s.customerId) return { ok: false, error: "Your portal link has expired — open the latest link from your email." };
  const shown = String(input.companyId || "").trim();
  if (shown && shown !== s.customerId) return { ok: false, error: "This page is out of date — refresh and try again." };
  return redeemPerk({
    companyId: s.customerId,
    perkId: String(input.perkId || ""),
    via: "portal",
    by: s.name ? `${s.name} (portal)` : "Customer (portal)",
    expect: input.expect ?? null,
  });
}
