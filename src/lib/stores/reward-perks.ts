import { listDocsByField } from "@/db/doc-store";
import { getCompany } from "@/lib/identity/companies";
import { get as getQuote } from "@/lib/stores/quotes";
import { levelFor, type Perk, type RewardLevel, type RewardsProgram } from "@/lib/rewards/program";
import { lifetimeSpend } from "@/lib/rewards/spend";
import type { LedgerEntry } from "@/lib/rewards/ledger";
import {
  availablePerkCount,
  mergePerkEdits,
  nextPerkUseN,
  perkDraftErrors,
  perkStatus,
  perkStatuses,
  perkUndoId,
  perkUseId,
  perkUses,
  portalRewardsView,
  type PerkDraft,
  type PerkStatus,
  type PerkUse,
  type PortalRewardsView,
} from "@/lib/rewards/perks";
import { companyRewards, getRewardsProgram, purchasesFor, saveRewardsProgram } from "@/lib/stores/rewards";
import { companyCredit, ledgerForCompany, postLedgerEntries } from "@/lib/stores/reward-ledger";

/**
 * Customer Rewards — perks (#282 phase 4, spec §6, §7). The editor's save,
 * Mark used / Undo (both add-only ledger posts: `perk` and `unperk`, amount
 * 0), the /rewards available-perk counts and the portal's Rewards card
 * loader. Pure rules live in src/lib/rewards/perks.ts. Callers check
 * permissions (`manage_users` to edit perks and Undo, `create` to Mark used).
 */

async function perkEntries(): Promise<LedgerEntry[]> {
  return listDocsByField<LedgerEntry>("reward_ledger", "kind", ["perk", "unperk"]);
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
  const program = await saveRewardsProgram({
    enabled: prev.enabled,
    thresholds: prev.thresholds,
    earnPct: prev.earnPct,
    retro: prev.retro,
    perks,
  });
  return { ok: true, program };
}

/* ---------- Mark used / Undo ---------- */

export type PerkActionResult = { ok: true; entry: LedgerEntry } | { ok: false; error: string };

/**
 * Record a use of a perk (spec §6). Refused while the program is off, for an
 * unknown company or perk, and when the perk isn't available to the company
 * right now — its level, once/yearly window and active flag are recomputed
 * here from the ledger, never taken from the client. An optional quote link
 * must be one of the company's own quotes.
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
  const [purchases, entries] = await Promise.all([purchasesFor([companyId]), ledgerForCompany(companyId)]);
  const earned = levelFor(lifetimeSpend(purchases.filter((p) => p.companyId === companyId)), program);
  const now = input.now ?? Date.now();
  const st = perkStatus(perk, { earned, entries, now });
  if (!st.available) {
    const why =
      st.block === "level"
        ? "This company hasn't earned that perk's level."
        : st.block === "used"
          ? "That perk has already been used."
          : st.block === "cooldown"
            ? "That perk was used in the last year."
            : "That perk is turned off.";
    return { ok: false, error: why };
  }
  const note = String(input.note || "").trim().slice(0, 500);
  const entry: LedgerEntry = {
    id: perkUseId(companyId, perk.id, nextPerkUseN(entries, perk.id)),
    companyId,
    kind: "perk",
    amount: 0,
    perkId: perk.id,
    ...(quoteId ? { quoteId } : {}),
    ...(note ? { note } : {}),
    at: now,
    by: input.by,
  };
  const wrote = await postLedgerEntries([entry]);
  if (!wrote.length) return { ok: false, error: "That perk was just marked used." };
  return { ok: true, entry };
}

/**
 * Undo a mistaken Mark used: posts `unperk` for that use (add-only — the use
 * itself stays on the ledger). Allowed while the program is off: it's a
 * correction, like a reversal.
 */
export async function undoPerkUse(companyId: string, useId: string, by: string, note?: string): Promise<PerkActionResult> {
  const id = String(companyId || "").trim();
  if (!id) return { ok: false, error: "Company not found." };
  const entries = await ledgerForCompany(id);
  const use = perkUses(entries).find((u) => u.entry.id === useId);
  if (!use) return { ok: false, error: "That perk use wasn't found." };
  if (use.undone) return { ok: false, error: "That perk use was already undone." };
  const n = String(note || "").trim().slice(0, 500);
  const entry: LedgerEntry = {
    id: perkUndoId(use.entry.id),
    companyId: id,
    kind: "unperk",
    amount: 0,
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
 * listable perk's availability now, and the perk-use history (undos paired).
 * Mark used re-checks on the server; this is display only.
 */
export function companyPerkPanel(
  perks: Perk[],
  earned: RewardLevel,
  entries: LedgerEntry[],
  now: number = Date.now()
): { statuses: PerkStatus[]; uses: PerkUse[] } {
  return { statuses: perkStatuses(perks, { earned, entries, now }), uses: perkUses(entries) };
}

/* ---------- /rewards ---------- */

/** Available-perk count per company for the given earned levels (the /rewards column). */
export async function availablePerksByCompany(
  rows: { companyId: string; earned: RewardLevel }[],
  program: RewardsProgram,
  now: number = Date.now()
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
    out.set(r.companyId, availablePerkCount(program.perks, { earned: r.earned, entries: byCo.get(r.companyId) || [], now }));
  }
  return out;
}

/* ---------- portal (spec §7) ---------- */

/**
 * The portal Rewards card for ONE company — the caller passes the grant's
 * customer id (portalSession / resolvePortalViewer), never a query param.
 * Null while the program is off or for an unknown company. Returns the
 * whitelisted view only (no margins, no earn %, no ledger, no purchases).
 */
export async function portalRewards(customerId: string, now: number = Date.now()): Promise<PortalRewardsView | null> {
  const id = String(customerId || "").trim();
  if (!id) return null;
  const program = await getRewardsProgram();
  if (!program.enabled) return null;
  const view = await companyRewards(id, program);
  if (!view) return null;
  const credit = await companyCredit(id);
  return portalRewardsView({ program, spend: view.spend, balance: credit.balance, entries: credit.entries, now });
}
