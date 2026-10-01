/**
 * Customer Rewards — the credit ledger's pure math (#282 phase 2, spec
 * docs/superpowers/specs/2026-09-30-customer-rewards-design.md §4).
 *
 * Append-only entries, one company each. Balance = Σ amount (earn +,
 * reverse −, start +, redeem −, unredeem +, adjust ±; a `perk` entry carries
 * 0 and only records a perk use, an `unperk` entry carries 0 and undoes one —
 * #282 phase 4, src/lib/rewards/perks.ts). Deterministic ids make every post
 * idempotent — two writers computing the same entry insert it once:
 *
 *   earn:<quoteId>:<n>      the n-th win of a quote       (+)
 *   reverse:<quoteId>:<n>   that win undone               (− the earn)
 *   redeem:<quoteId>:<n>    credit spent on the n-th win  (−)
 *   unredeem:<quoteId>:<n>  that spend undone             (+ the redeem)
 *   start:<companyId>       the one-time starting credit  (+)
 *   adjust:<companyId>:<t>  a staff adjustment            (±, note required)
 *   perk:<companyId>:<perkId>:<n>   the n-th use of a perk (0, or −pointCost when bought with points)
 *   unperk:<companyId>:<perkId>:<n> that use undone        (−the use: refunds the points exactly)
 *   fulfil:perk:<companyId>:<perkId>:<n>  a redemption fulfilled by staff (0)
 *
 * #282 perks+points: a perk use with `redeemed` set is a REDEMPTION (portal or
 * staff Redeem) that staff still have to deliver — `perk-fulfil` records the
 * delivery; a use without it is a staff "Mark used" (delivered on the spot).
 *
 * Amounts are dollars. Earns and starting credit post WHOLE dollars (rounded
 * up) and an applied credit is whole dollars (rounded down), so the points a
 * customer sees (points.ts, 1 point = $1) match; reversals and unredeems
 * mirror their entry exactly. Only a staff adjustment may carry cents.
 *
 * Pure and client-safe.
 */

import { roundDownDollars, roundUpDollars } from "./points";

export const LEDGER_KINDS = ["earn", "reverse", "start", "redeem", "unredeem", "adjust", "perk", "unperk", "perk-fulfil"] as const;
export type LedgerKind = (typeof LEDGER_KINDS)[number];

export type LedgerEntry = {
  id: string;
  companyId: string;
  kind: LedgerKind;
  /** Signed dollars, to the cent. */
  amount: number;
  quoteId?: string;
  perkId?: string;
  note?: string;
  /**
   * #282 perks+points — on a `perk` entry: set for a REDEMPTION ("free" =
   * claimed at its unlock level, "points" = bought, `amount` = −pointCost),
   * which staff must still fulfil; absent for a staff Mark used.
   */
  redeemed?: "free" | "points";
  /** #282 perks+points — who redeemed: the customer in the portal, or staff on the company card. */
  via?: "portal" | "staff";
  /** #282 perks+points — on a `perk-fulfil` entry: the redemption (perk use id) it fulfils. */
  useId?: string;
  at: number;
  by: string;
};

export const LEDGER_KIND_LABEL: Record<LedgerKind, string> = {
  earn: "Earned",
  reverse: "Earn reversed",
  start: "Starting credit",
  redeem: "Applied on a quote",
  unredeem: "Credit returned",
  adjust: "Adjustment",
  perk: "Perk used",
  unperk: "Perk use undone",
  "perk-fulfil": "Perk fulfilled",
};

/**
 * The credit ledger's row label (#282 perks+points): a perk bought with points
 * and its refund move the balance, so they list with the credit entries.
 */
export function ledgerEntryLabel(e: Pick<LedgerEntry, "kind" | "amount">): string {
  if (e.kind === "perk" && e.amount < 0) return "Perk redeemed for points";
  if (e.kind === "unperk" && e.amount > 0) return "Perk points refunded";
  return LEDGER_KIND_LABEL[e.kind] ?? e.kind;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const earnId = (quoteId: string, n: number) => `earn:${quoteId}:${n}`;
export const reverseId = (quoteId: string, n: number) => `reverse:${quoteId}:${n}`;
export const redeemId = (quoteId: string, n: number) => `redeem:${quoteId}:${n}`;
export const unredeemId = (quoteId: string, n: number) => `unredeem:${quoteId}:${n}`;
export const startId = (companyId: string) => `start:${companyId}`;

/** The `n` of a numbered id (`earn:Q-1:3` → 3); 0 when it has none. */
export function entryN(id: string): number {
  const m = /:(\d+)$/.exec(id);
  return m ? Number(m[1]) : 0;
}

/** Σ amount, to the cent. */
export function ledgerBalance(entries: Pick<LedgerEntry, "amount">[]): number {
  let s = 0;
  for (const e of entries) if (typeof e.amount === "number" && Number.isFinite(e.amount)) s += e.amount;
  return round2(s);
}

/** Balance − the credit parked on the company's OTHER open quotes. */
export function availableCredit(balance: number, openQuoteCredits: number[]): number {
  return round2(balance - openQuoteCredits.reduce((s, c) => s + (Number.isFinite(c) ? c : 0), 0));
}

/**
 * value × pct / 100 in WHOLE dollars, rounded UP (#282 points follow-up: the
 * customer sees points — 1 point = $1, rounded up — so the ledger posts whole
 * dollars and the two never drift). Never negative.
 */
export function earnAmount(value: number, pct: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(pct) || value <= 0 || pct <= 0) return 0;
  return roundUpDollars((value * pct) / 100);
}

/** The open (not yet undone) `kind` entry for a quote, with its undo kind. */
function openOf(entries: LedgerEntry[], quoteId: string, kind: "earn" | "redeem"): LedgerEntry | null {
  const undo = kind === "earn" ? "reverse" : "unredeem";
  const undone = new Set(entries.filter((e) => e.quoteId === quoteId && e.kind === undo).map((e) => entryN(e.id)));
  const open = entries
    .filter((e) => e.quoteId === quoteId && e.kind === kind && !undone.has(entryN(e.id)))
    .sort((a, b) => entryN(b.id) - entryN(a.id));
  return open[0] ?? null;
}

export const openEarn = (entries: LedgerEntry[], quoteId: string) => openOf(entries, quoteId, "earn");
export const openRedeem = (entries: LedgerEntry[], quoteId: string) => openOf(entries, quoteId, "redeem");

function nextN(entries: LedgerEntry[], quoteId: string, kind: "earn" | "redeem"): number {
  let n = 0;
  for (const e of entries) if (e.quoteId === quoteId && e.kind === kind) n = Math.max(n, entryN(e.id));
  return n + 1;
}

/**
 * What to post so a quote's ledger matches its status (state-based, so a
 * replay posts nothing new). Called on every real status transition:
 *
 * - won, no open earn, `earn` > 0 (the program is on) → earn:<q>:<n+1>;
 *   won, no open redeem, `credit` > 0 → redeem:<q>:<n+1>;
 * - not won, an open earn → reverse:<q>:<n> (the earn's own company and
 *   amount); an open redeem → unredeem:<q>:<n>.
 *
 * Re-winning after a reversal posts a fresh numbered earn. `entries` is the
 * quote's own entries (any company).
 */
export function quoteLedgerPlan(input: {
  quoteId: string;
  companyId: string | null;
  won: boolean;
  entries: LedgerEntry[];
  /** The earn for this win (0 = nothing to earn: program off, Base 0 %, …). */
  earn: number;
  /** The Rewards credit on the quote. */
  credit: number;
  at: number;
  by: string;
}): LedgerEntry[] {
  const { quoteId, entries, at, by } = input;
  const out: LedgerEntry[] = [];
  if (input.won) {
    if (!input.companyId) return out;
    if (!openEarn(entries, quoteId) && input.earn > 0) {
      out.push({ id: earnId(quoteId, nextN(entries, quoteId, "earn")), companyId: input.companyId, kind: "earn", amount: round2(input.earn), quoteId, at, by });
    }
    if (!openRedeem(entries, quoteId) && input.credit > 0) {
      out.push({ id: redeemId(quoteId, nextN(entries, quoteId, "redeem")), companyId: input.companyId, kind: "redeem", amount: -round2(input.credit), quoteId, at, by });
    }
    return out;
  }
  const e = openEarn(entries, quoteId);
  if (e) out.push({ id: reverseId(quoteId, entryN(e.id)), companyId: e.companyId, kind: "reverse", amount: -e.amount, quoteId, at, by });
  const r = openRedeem(entries, quoteId);
  if (r) out.push({ id: unredeemId(quoteId, entryN(r.id)), companyId: r.companyId, kind: "unredeem", amount: -r.amount, quoteId, at, by });
  return out;
}

/**
 * The one-time starting credit (spec §4): history dated before `launchedAt`
 * (all history when the program never launched), spend × rate / 100 rounded
 * UP to whole dollars, then capped (#282 points follow-up — whole dollars so
 * the customer's points match; a fractional cap counts as its whole dollars).
 */
export function startingCreditFor(
  purchases: { amount: number; at: number }[],
  program: { launchedAt?: number; retro: { ratePct: number; capPerCustomer: number } }
): { historySpend: number; proposed: number } {
  const cut = program.launchedAt;
  const historySpend = round2(purchases.filter((p) => cut == null || p.at < cut).reduce((s, p) => s + p.amount, 0));
  const raw = roundUpDollars((historySpend * program.retro.ratePct) / 100);
  return { historySpend, proposed: Math.max(0, Math.min(roundDownDollars(program.retro.capPerCustomer), raw)) };
}

/** A staff adjustment's amount: a finite, non-zero number to the cent within ±$1M; else null. */
export function parseAdjustAmount(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number(raw.replace(/[$,\s]/g, "")) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(n)) return null;
  const c = round2(n);
  return c !== 0 && Math.abs(c) <= 1_000_000 ? c : null;
}
