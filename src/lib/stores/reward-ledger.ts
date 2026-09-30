import { insertDocIfAbsent, listDocs, listDocsByField } from "@/db/doc-store";
import { allCompanies, getCompany } from "@/lib/identity/companies";
import { levelFor, type RewardsProgram } from "@/lib/rewards/program";
import { lifetimeSpend, purchasesByCompany } from "@/lib/rewards/spend";
import { grossQuoteValue, quoteRewardCredit } from "@/lib/rewards/credit-line";
import {
  normalizeServiceCredit,
  serviceCreditSubdocKey,
  settleCredit,
  settleServiceCredit,
  type ServiceCreditSettle,
} from "@/lib/rewards/service-credit";
import {
  availableCredit,
  earnAmount,
  ledgerBalance,
  quoteLedgerPlan,
  startId,
  startingCreditFor,
  type LedgerEntry,
} from "@/lib/rewards/ledger";
import { getRewardsProgram, purchasesFor } from "@/lib/stores/rewards";
import type { Quote, QuoteRevision } from "@/lib/stores/quotes";

/**
 * Customer Rewards — the credit ledger store (#282 phase 2, spec §4).
 *
 * Collection `reward_ledger`: append-only `LedgerEntry` documents, written
 * ONLY with `insertDocIfAbsent` — an entry is never edited or deleted, and a
 * deterministic id posted twice lands once. Not in SYNCABLE_COLLECTIONS (no
 * sync push can write credit) and not a CONFIG collection (the go-live reset
 * wipes it with the rest of the customer data). Pure math lives in
 * src/lib/rewards/ledger.ts.
 */

export type { LedgerEntry };

const OPEN_STATUSES = new Set(["draft", "sent"]);

function newestFirst(a: LedgerEntry, b: LedgerEntry): number {
  return b.at - a.at || b.id.localeCompare(a.id);
}

export async function ledgerForCompany(companyId: string): Promise<LedgerEntry[]> {
  if (!companyId) return [];
  return (await listDocsByField<LedgerEntry>("reward_ledger", "companyId", [companyId])).sort(newestFirst);
}

export async function ledgerForQuote(quoteId: string): Promise<LedgerEntry[]> {
  if (!quoteId) return [];
  return listDocsByField<LedgerEntry>("reward_ledger", "quoteId", [quoteId]);
}

export async function allLedgerEntries(): Promise<LedgerEntry[]> {
  return listDocs<LedgerEntry>("reward_ledger");
}

/** Insert each entry once (deterministic ids). Returns the ones actually written. */
export async function postLedgerEntries(entries: LedgerEntry[]): Promise<LedgerEntry[]> {
  const out: LedgerEntry[] = [];
  for (const e of entries) if (await insertDocIfAbsent<LedgerEntry>("reward_ledger", e)) out.push(e);
  return out;
}

/** The credit sitting on a company's open (draft/sent) quotes, per quote. */
export async function openQuoteCredits(companyId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!companyId) return out;
  for (const q of await listDocsByField<Quote>("quotes", "customerId", [companyId])) {
    if (!OPEN_STATUSES.has(q.status)) continue;
    const c = quoteRewardCredit(q);
    if (c > 0) out.set(q.id, c);
  }
  return out;
}

export type CompanyCredit = {
  balance: number;
  /** balance − credit on open quotes (other than `excludeQuoteId`). */
  available: number;
  /** Credit parked on open quotes (other than `excludeQuoteId`). */
  onOpenQuotes: number;
  entries: LedgerEntry[];
};

/** A company's balance and what is still free to apply (spec §5). */
export async function companyCredit(companyId: string, excludeQuoteId?: string | null): Promise<CompanyCredit> {
  const [entries, open] = await Promise.all([ledgerForCompany(companyId), openQuoteCredits(companyId)]);
  const others = [...open.entries()].filter(([id]) => id !== excludeQuoteId).map(([, c]) => c);
  const balance = ledgerBalance(entries);
  return {
    balance,
    available: availableCredit(balance, others),
    onOpenQuotes: Math.round(others.reduce((s, c) => s + c, 0) * 100) / 100,
    entries,
  };
}

/** Every company's balance and available credit (the /rewards board). */
export async function creditByCompany(): Promise<Map<string, { balance: number; available: number }>> {
  const [entries, quotes] = await Promise.all([allLedgerEntries(), listDocs<Quote>("quotes")]);
  const bal = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const list = bal.get(e.companyId);
    if (list) list.push(e);
    else bal.set(e.companyId, [e]);
  }
  const parked = new Map<string, number[]>();
  for (const q of quotes) {
    if (!q.customerId || !OPEN_STATUSES.has(q.status)) continue;
    const c = quoteRewardCredit(q);
    if (c > 0) parked.set(q.customerId, [...(parked.get(q.customerId) || []), c]);
  }
  const out = new Map<string, { balance: number; available: number }>();
  for (const [companyId, list] of bal) {
    const balance = ledgerBalance(list);
    out.set(companyId, { balance, available: availableCredit(balance, parked.get(companyId) || []) });
  }
  return out;
}

/**
 * The earn for a quote winning NOW (spec §4): the company's EARNED level at
 * the moment of the win — its lifetime spend without this quote — × that
 * level's earn %, on the quote's `value` (net of credit). 0 while the
 * program is off.
 */
export async function earnForWin(q: Pick<Quote, "id" | "customerId" | "value">, program: RewardsProgram): Promise<number> {
  if (!program.enabled || !q.customerId) return 0;
  const before = (await purchasesFor([q.customerId])).filter(
    (p) => p.companyId === q.customerId && !(p.kind === "quote" && p.id === q.id)
  );
  const level = levelFor(lifetimeSpend(before), program);
  return earnAmount(q.value, program.earnPct[level]);
}

/**
 * Bring one quote's ledger in line with its status (spec §4, §5 redeem) —
 * called by `setStatus` after every real transition (never for the
 * `historical-import` bypass). Won: post the earn (program on) and the
 * redeem for the credit on the quote. Not won: reverse the open earn and
 * unredeem the open redeem — corrections post even while the program is
 * off, so a balance never keeps credit from a sale that no longer stands.
 * State-based, so a replay posts nothing new. `opts.deleted` (the quote was
 * just soft-deleted, `remove()`) treats it as not won.
 */
export async function reconcileQuoteLedger(q: Quote, by: string, opts: { deleted?: boolean } = {}): Promise<LedgerEntry[]> {
  // #282 phase 3: a soft-deleted quote no longer stands as a sale — its open
  // earn reverses and its redeemed credit comes back, exactly as if it had
  // left Won.
  const won = q.status === "won" && !opts.deleted;
  const [entries, program] = await Promise.all([ledgerForQuote(q.id), getRewardsProgram()]);
  const earn = won ? await earnForWin(q, program) : 0;
  const plan = quoteLedgerPlan({
    quoteId: q.id,
    companyId: q.customerId || null,
    won,
    entries,
    earn,
    credit: won ? quoteRewardCredit(q) : 0,
    at: Date.now(),
    by,
  });
  return plan.length ? postLedgerEntries(plan) : [];
}

/**
 * #282 phase 3 — the Rewards credit a flame-test / inspection / repair save
 * stores (spec §5): the posted amount re-checked against the company's
 * available credit right now (balance − credit on its OTHER open quotes) and
 * the engine total, by settleServiceCredit's rules. Never trusts the client
 * amount beyond clamping it down.
 */
export async function settleServiceCreditFor(i: {
  posted: unknown;
  total: number;
  customerId: string | null;
  source: string;
  mayApply: boolean;
  prior: Quote | null;
}): Promise<ServiceCreditSettle> {
  const prior = i.prior
    ? { status: i.prior.status, customerId: i.prior.customerId || null, credit: quoteRewardCredit(i.prior) }
    : null;
  const needsBalance =
    normalizeServiceCredit(i.posted) > 0 &&
    !!i.customerId &&
    !(prior && (prior.status === "won" || prior.status === "lost")) &&
    i.source !== "portal-service";
  const available = needsBalance ? (await companyCredit(i.customerId as string, i.prior?.id ?? null)).available : 0;
  return settleServiceCredit({
    posted: i.posted,
    total: i.total,
    available,
    customerId: i.customerId,
    source: i.source,
    mayApply: i.mayApply,
    prior,
  });
}

/**
 * #282 phase 3 — the Rewards credit a recalled revision may bring back
 * (restoreQuoteRevision). A revision is an old priced snapshot, so its credit
 * is re-checked exactly like a save: against the company's available credit
 * NOW (balance − credit on its OTHER open quotes — this quote's own current
 * credit never holds against itself), the restored pre-credit total and $0.
 * Dropped for a portal-service quote, a quote with no customer, or a
 * revision cut under a different customer (revisions record `customerId`
 * from #282 phase 3 on; an older one is taken to be the current customer's).
 * Won and lost quotes refuse a recall outright (restoreQuoteRevision), so
 * the locked branch here is defensive. Without `create` the credit can't grow
 * past what the quote has now. Service quotes clamp in whole dollars,
 * Estimator quotes to the cent.
 */
export async function restoredCreditFor(
  q: Quote,
  target: QuoteRevision,
  mayApply: boolean
): Promise<ServiceCreditSettle & { gross: number }> {
  const snap = { ...target, quoteType: target.quoteType ?? q.quoteType };
  const posted = quoteRewardCredit(snap);
  const gross = grossQuoteValue(snap);
  const locked = q.status === "won" || q.status === "lost";
  const customerId = q.customerId || null;
  const needsBalance = posted > 0 && !locked && !!customerId && q.source !== "portal-service";
  const available = needsBalance ? (await companyCredit(customerId as string, q.id)).available : 0;
  const res = settleCredit({
    posted,
    total: gross,
    available,
    customerId,
    source: q.source,
    mayApply,
    prior: {
      status: q.status,
      customerId: target.customerId === undefined ? customerId : target.customerId || null,
      credit: quoteRewardCredit(q),
    },
    unit: serviceCreditSubdocKey(snap.quoteType) ? "dollars" : "cents",
  });
  return { ...res, gross };
}

/* ---------- starting credit (spec §4) ---------- */

export type StartingCreditRow = {
  companyId: string;
  name: string;
  historySpend: number;
  proposed: number;
  /** The posted start entry's amount; null while not posted. */
  posted: number | null;
};

/** Every company with counted history before launch, highest proposal first. */
export async function startingCreditBoard(program?: RewardsProgram): Promise<StartingCreditRow[]> {
  const [prog, purchases, companies, entries] = await Promise.all([
    program ? Promise.resolve(program) : getRewardsProgram(),
    purchasesFor(null),
    allCompanies(),
    listDocsByField<LedgerEntry>("reward_ledger", "kind", ["start"]),
  ]);
  const posted = new Map(entries.map((e) => [e.companyId, e.amount]));
  const byCo = purchasesByCompany(purchases);
  const out: StartingCreditRow[] = [];
  for (const co of companies) {
    const list = byCo.get(co.id);
    if (!list?.length && !posted.has(co.id)) continue;
    const { historySpend, proposed } = startingCreditFor(list || [], prog);
    if (historySpend <= 0 && !posted.has(co.id)) continue;
    out.push({ companyId: co.id, name: co.name, historySpend, proposed, posted: posted.get(co.id) ?? null });
  }
  return out.sort((a, b) => b.proposed - a.proposed || b.historySpend - a.historySpend || a.name.localeCompare(b.name));
}

export type StartingCreditResult =
  | { ok: true; posted: number; already: boolean }
  | { ok: false; error: string };

/** Post one company's starting credit — recomputed here, written once (`start:<companyId>`). */
export async function postStartingCredit(companyId: string, by: string, program?: RewardsProgram): Promise<StartingCreditResult> {
  const prog = program ?? (await getRewardsProgram());
  const co = await getCompany(companyId);
  if (!co) return { ok: false, error: "Company not found." };
  const purchases = (await purchasesFor([companyId])).filter((p) => p.companyId === companyId);
  const { proposed } = startingCreditFor(purchases, prog);
  if (!(proposed > 0)) return { ok: false, error: "No starting credit to post for this company." };
  const entry: LedgerEntry = { id: startId(companyId), companyId, kind: "start", amount: proposed, at: Date.now(), by };
  const wrote = await postLedgerEntries([entry]);
  if (wrote.length) return { ok: true, posted: proposed, already: false };
  const existing = (await ledgerForCompany(companyId)).find((e) => e.id === entry.id);
  return { ok: true, posted: existing?.amount ?? proposed, already: true };
}

/** Post every unposted proposal. Returns how many were written and their total. */
export async function postAllStartingCredit(by: string): Promise<{ posted: number; total: number }> {
  const program = await getRewardsProgram();
  const rows = (await startingCreditBoard(program)).filter((r) => r.posted == null && r.proposed > 0);
  let posted = 0;
  let total = 0;
  for (const r of rows) {
    const res = await postStartingCredit(r.companyId, by, program);
    if (res.ok && !res.already) {
      posted++;
      total += res.posted;
    }
  }
  return { posted, total: Math.round(total * 100) / 100 };
}

/* ---------- adjustments (spec §4) ---------- */

/** A signed staff adjustment with a required note (the caller checks `manage_users`). */
export async function postAdjustment(
  companyId: string,
  amount: number,
  note: string,
  by: string
): Promise<{ ok: true; entry: LedgerEntry } | { ok: false; error: string }> {
  const n = (note || "").trim().slice(0, 500);
  if (!n) return { ok: false, error: "Add a note saying why." };
  if (!Number.isFinite(amount) || amount === 0) return { ok: false, error: "Enter an amount other than $0." };
  if (!(await getCompany(companyId))) return { ok: false, error: "Company not found." };
  const at = Date.now();
  const entry: LedgerEntry = {
    id: `adjust:${companyId}:${at.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    companyId,
    kind: "adjust",
    amount: Math.round(amount * 100) / 100,
    note: n,
    at,
    by,
  };
  await postLedgerEntries([entry]);
  return { ok: true, entry };
}
