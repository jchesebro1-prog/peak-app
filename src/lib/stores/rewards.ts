import { getBlob, listDocs, listDocsByField, setBlob } from "@/db/doc-store";
import { loadPipelines } from "@/lib/pipelines-server";
import { normalizeProject, type ProjectRecord } from "@/lib/stores/projects";
import type { Quote } from "@/lib/stores/quotes";
import type { RepairJobRecord } from "@/lib/stores/repair-jobs";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { quoteRewardCredit } from "@/lib/rewards/credit-line";
import { allCompanies, getCompany, saveCompany } from "@/lib/identity/companies";
import { contactsForCompany, saveContact } from "@/lib/identity/contacts";
import {
  REWARDS_PROGRAM_BLOB,
  contactsToRaise,
  ladderTierOf,
  levelFor,
  levelProgress,
  nextLevel,
  sanitizeRewardsProgram,
  suggestionFor,
  type NextLevel,
  type RewardLevel,
  type RewardsProgram,
} from "@/lib/rewards/program";
import {
  lifetimeSpend,
  purchasesByCompany,
  purchasesFrom,
  type Purchase,
  type SpendProject,
  type SpendQuote,
  type SpendRepair,
} from "@/lib/rewards/spend";

/**
 * Customer Rewards — server loader (#282 Phase 1). The program blob, the
 * suggestion dismissals, lifetime spend over quotes/projects/repairs, and the
 * Approve write. Pure rules live in src/lib/rewards/{program,spend}.ts.
 *
 * Dismissals: blob `rewards_dismissals`, one top-level key per company id →
 * `{ level, at, by }` (setBlob's atomic `||` merge means two dismissals of
 * different companies can never drop each other). A dismissal hides the
 * suggestion until the company earns a level above `level`.
 */

export const REWARDS_DISMISSALS_BLOB = "rewards_dismissals";

export type RewardDismissal = { level: RewardLevel; at: number; by: string };

export async function getRewardsProgram(): Promise<RewardsProgram> {
  return sanitizeRewardsProgram(await getBlob<Record<string, unknown>>(REWARDS_PROGRAM_BLOB, {}));
}

/**
 * Save the program (already validated by the caller). Perks are whatever the
 * caller passes (Settings → Rewards passes the stored ones through until the
 * phase-4 editor lands); `launchedAt` is stamped the first time `enabled`
 * turns on and never moves after that.
 */
export async function saveRewardsProgram(input: Omit<RewardsProgram, "launchedAt">): Promise<RewardsProgram> {
  const prev = await getRewardsProgram();
  const launchedAt = prev.launchedAt ?? (input.enabled ? Date.now() : undefined);
  const next = sanitizeRewardsProgram({ ...input, ...(launchedAt ? { launchedAt } : {}) });
  await setBlob(REWARDS_PROGRAM_BLOB, next as unknown as Record<string, unknown>);
  return next;
}

export async function getDismissals(): Promise<Record<string, RewardDismissal>> {
  return (await getBlob<Record<string, RewardDismissal>>(REWARDS_DISMISSALS_BLOB, {})) || {};
}

/* ---------- purchase sources ---------- */

function spendQuote(q: Quote): SpendQuote {
  return {
    id: q.id,
    ref: displayQuoteNumber(q),
    name: q.name,
    customerId: q.customerId,
    status: q.status,
    value: q.value,
    // #282 phase 2: credit applied on the quote counts back into spend.
    credit: quoteRewardCredit(q),
    quoteType: q.quoteType,
    source: q.source,
    history: q.history,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

/** A done project's close: the last stage change, when its stage is a done stage. */
function spendProject(p: ProjectRecord): SpendProject {
  const done = p.stageMeta?.tag === "done";
  const hist = Array.isArray(p.stageHistory) ? p.stageHistory : [];
  const closedAt = done && hist.length ? hist[hist.length - 1].at : null;
  return {
    id: p.id,
    name: p.name,
    customerId: p.customerId,
    quoteId: p.quoteId,
    value: p.value,
    valueUnknown: p.valueUnknown,
    closedAt,
    startedAt: p.startedAt,
    createdAt: p.createdAt,
    imported: p.source?.system === "daylite" || String(p.id || "").startsWith("P-dl-"),
  };
}

function spendRepair(r: RepairJobRecord): SpendRepair {
  return {
    id: r.id,
    title: r.title,
    customerId: r.customerId,
    quoteId: r.quoteId,
    value: r.value,
    valueUnknown: r.valueUnknown,
    completedAt: r.completedAt,
    approvedAt: r.approvedAt,
    createdAt: r.createdAt,
    imported: String(r.source?.refId || "").startsWith("daylite:"),
  };
}

/** Counted purchases for these companies (null = every company). */
export async function purchasesFor(companyIds: string[] | null): Promise<Purchase[]> {
  const [quotes, projects, repairs, pipes] = await Promise.all([
    companyIds ? listDocsByField<Quote>("quotes", "customerId", companyIds) : listDocs<Quote>("quotes"),
    companyIds
      ? listDocsByField<ProjectRecord>("projects", "customerId", companyIds)
      : listDocs<ProjectRecord>("projects"),
    companyIds
      ? listDocsByField<RepairJobRecord>("repair_jobs", "customerId", companyIds)
      : listDocs<RepairJobRecord>("repair_jobs"),
    loadPipelines(),
  ]);
  return purchasesFrom({
    quotes: quotes.map(spendQuote),
    projects: projects.map((p) => spendProject(normalizeProject(p, pipes))),
    repairs: repairs.map(spendRepair),
  });
}

/* ---------- views ---------- */

export type CompanyRewardsView = {
  companyId: string;
  name: string;
  spend: number;
  earned: RewardLevel;
  /** The company's own stored tier (null = none → Base). */
  companyTier: string | null;
  ladderTier: RewardLevel | "off";
  next: NextLevel | null;
  progress: number;
  suggestion: RewardLevel | null;
  dismissedLevel: RewardLevel | null;
  purchases: Purchase[];
};

function viewFor(
  co: { id: string; name: string; pricingTier: string | null },
  purchases: Purchase[],
  program: RewardsProgram,
  dismissal: RewardDismissal | undefined
): CompanyRewardsView {
  const spend = lifetimeSpend(purchases);
  const earned = levelFor(spend, program);
  const dismissedLevel = dismissal?.level ?? null;
  return {
    companyId: co.id,
    name: co.name,
    spend,
    earned,
    companyTier: co.pricingTier,
    ladderTier: ladderTierOf(co.pricingTier),
    next: nextLevel(spend, program),
    progress: levelProgress(spend, program),
    suggestion: suggestionFor({ companyTier: co.pricingTier, earned, dismissedLevel }),
    dismissedLevel,
    purchases,
  };
}

/** One company's rewards (the company record's card). Null for an unknown company. */
export async function companyRewards(
  companyId: string,
  program?: RewardsProgram
): Promise<CompanyRewardsView | null> {
  const co = await getCompany(companyId);
  if (!co) return null;
  const [prog, purchases, dismissals] = await Promise.all([
    program ? Promise.resolve(program) : getRewardsProgram(),
    purchasesFor([companyId]),
    getDismissals(),
  ]);
  return viewFor(co, purchases.filter((p) => p.companyId === companyId), prog, dismissals[companyId]);
}

/**
 * Every company with counted purchases, highest lifetime spend first (the
 * /rewards page). Companies with no purchases are left out — they are all
 * Base with nothing to show.
 */
export async function rewardsBoard(program?: RewardsProgram): Promise<CompanyRewardsView[]> {
  const [prog, purchases, dismissals, companies] = await Promise.all([
    program ? Promise.resolve(program) : getRewardsProgram(),
    purchasesFor(null),
    getDismissals(),
    allCompanies(),
  ]);
  const byCo = purchasesByCompany(purchases);
  const out: CompanyRewardsView[] = [];
  for (const co of companies) {
    const list = byCo.get(co.id);
    if (!list?.length) continue;
    out.push(viewFor(co, list, prog, dismissals[co.id]));
  }
  return out.sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));
}

/* ---------- actions ---------- */

export type RewardsActionResult = { ok: true; level: RewardLevel; contactsRaised: number } | { ok: false; error: string };

/**
 * Approve a company's suggestion (spec §3): recomputed here, never trusted
 * from the client. Sets the company's tier to the earned level through the
 * identity store's own save, then raises every contact whose own ladder tier
 * is below it (contactsToRaise). Open drafts are not rewritten (D457).
 */
export async function approveRewardSuggestion(companyId: string): Promise<RewardsActionResult> {
  const program = await getRewardsProgram();
  if (!program.enabled) return { ok: false, error: "The Rewards program is off." };
  const co = await getCompany(companyId);
  if (!co) return { ok: false, error: "Company not found." };
  const purchases = (await purchasesFor([companyId])).filter((p) => p.companyId === companyId);
  const earned = levelFor(lifetimeSpend(purchases), program);
  const level = suggestionFor({ companyTier: co.pricingTier, earned });
  if (!level) return { ok: false, error: "There is no tier move to approve." };
  await saveCompany({ ...co, pricingTier: level });
  const raise = contactsToRaise(await contactsForCompany(companyId), level);
  for (const c of raise) await saveContact({ ...c, pricingTier: level });
  return { ok: true, level, contactsRaised: raise.length };
}

/** Dismiss a company's current suggestion until it earns the next level. */
export async function dismissRewardSuggestion(companyId: string, by: string): Promise<RewardsActionResult> {
  const program = await getRewardsProgram();
  if (!program.enabled) return { ok: false, error: "The Rewards program is off." };
  const view = await companyRewards(companyId, program);
  if (!view) return { ok: false, error: "Company not found." };
  const level = suggestionFor({ companyTier: view.companyTier, earned: view.earned });
  if (!level) return { ok: false, error: "There is no suggestion to dismiss." };
  await setBlob(REWARDS_DISMISSALS_BLOB, { [companyId]: { level, at: Date.now(), by } satisfies RewardDismissal });
  return { ok: true, level, contactsRaised: 0 };
}
