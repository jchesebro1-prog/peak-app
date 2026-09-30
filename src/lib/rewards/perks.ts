/**
 * Customer Rewards — perks (#282 phase 4, spec
 * docs/superpowers/specs/2026-09-30-customer-rewards-design.md §6, §7).
 *
 * Pure and client-safe. Perk definitions live in the program blob
 * (program.ts `Perk`); a perk USE is a `perk` ledger entry (amount 0) and
 * undoing one is an `unperk` entry — the ledger stays add-only:
 *
 *   perk:<companyId>:<perkId>:<n>     the n-th use of a perk by a company
 *   unperk:<companyId>:<perkId>:<n>   that use undone ("un" + the use's id)
 *
 * A perk is AVAILABLE to a company when it is active (and not removed), the
 * company's earned level is at or above the perk's level, and
 *   - once:   it has no live (not undone) use, ever;
 *   - yearly: it has no live use in the last 365 days.
 */

import {
  REWARD_LEVEL_LABEL,
  isRewardLevel,
  levelProgress,
  levelRank,
  nextLevel,
  levelFor,
  type Perk,
  type RewardLevel,
  type RewardsProgram,
} from "./program";
import { entryN, type LedgerEntry } from "./ledger";

export const PERK_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const PERK_FREQUENCY_LABEL = { once: "Once", yearly: "Once a year" } as const;

export const perkUseId = (companyId: string, perkId: string, n: number) => `perk:${companyId}:${perkId}:${n}`;
/** The undo entry's id for a use: "un" + the use's own id. */
export const perkUndoId = (useId: string) => `un${useId}`;

export type PerkUse = {
  entry: LedgerEntry;
  /** The `unperk` entry that undid this use, if any. */
  undone: LedgerEntry | null;
};

/** Every `perk` entry (for one perk, or all), paired with its undo, newest first. */
export function perkUses(entries: LedgerEntry[], perkId?: string): PerkUse[] {
  const undos = new Map<string, LedgerEntry>();
  for (const e of entries) if (e.kind === "unperk") undos.set(e.id, e);
  return entries
    .filter((e) => e.kind === "perk" && (perkId == null || e.perkId === perkId))
    .map((entry) => ({ entry, undone: undos.get(perkUndoId(entry.id)) ?? null }))
    .sort((a, b) => b.entry.at - a.entry.at || b.entry.id.localeCompare(a.entry.id));
}

/** The next use number for a company's perk (max n over its uses, + 1). */
export function nextPerkUseN(entries: LedgerEntry[], perkId: string): number {
  let n = 0;
  for (const e of entries) if (e.kind === "perk" && e.perkId === perkId) n = Math.max(n, entryN(e.id));
  return n + 1;
}

export type PerkBlock = "inactive" | "removed" | "level" | "used" | "cooldown";

export type PerkStatus = {
  perk: Perk;
  available: boolean;
  /** Why it is not available (null when it is). */
  block: PerkBlock | null;
  /** The last live use's time (null = never used, or every use undone). */
  lastUsedAt: number | null;
  /** Yearly perks: when it is next available (null when available now / not yearly). */
  nextAt: number | null;
};

/** One perk's availability for a company at `now` (spec §6). */
export function perkStatus(
  perk: Perk,
  ctx: { earned: RewardLevel; entries: LedgerEntry[]; now: number }
): PerkStatus {
  const live = perkUses(ctx.entries, perk.id).filter((u) => !u.undone);
  const lastUsedAt = live.length ? live[0].entry.at : null;
  const base = { perk, lastUsedAt, nextAt: null as number | null };
  if (perk.removed) return { ...base, available: false, block: "removed" };
  if (!perk.active) return { ...base, available: false, block: "inactive" };
  if (levelRank(ctx.earned) < levelRank(perk.level)) return { ...base, available: false, block: "level" };
  if (perk.frequency === "once") {
    return lastUsedAt != null ? { ...base, available: false, block: "used" } : { ...base, available: true, block: null };
  }
  if (lastUsedAt != null) {
    const nextAt = lastUsedAt + PERK_YEAR_MS;
    if (ctx.now < nextAt) return { ...base, available: false, block: "cooldown", nextAt };
  }
  return { ...base, available: true, block: null };
}

/** Every listable perk's status, in program order (removed perks left out). */
export function perkStatuses(
  perks: Perk[],
  ctx: { earned: RewardLevel; entries: LedgerEntry[]; now: number }
): PerkStatus[] {
  return perks.filter((p) => !p.removed).map((p) => perkStatus(p, ctx));
}

export function availablePerkCount(
  perks: Perk[],
  ctx: { earned: RewardLevel; entries: LedgerEntry[]; now: number }
): number {
  return perkStatuses(perks, ctx).filter((s) => s.available).length;
}

/* ---------- Settings → Rewards → Perks (the editor's merge) ---------- */

export type PerkDraft = {
  /** A stored perk's id; anything else (blank, "new:…", a removed id) mints a new one. */
  id?: string;
  name: string;
  description: string;
  level: string;
  frequency: string;
  active: boolean;
};

/** Problems to show instead of silently dropping a row. */
export function perkDraftErrors(drafts: unknown): string[] {
  if (!Array.isArray(drafts)) return ["Perks must be a list."];
  const errs: string[] = [];
  if (drafts.length > 100) errs.push("At most 100 perks.");
  drafts.forEach((d, i) => {
    const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
    if (!String(o.name ?? "").trim()) errs.push(`Perk ${i + 1} needs a name.`);
    if (o.level != null && !isRewardLevel(o.level)) errs.push(`Perk ${i + 1} has an unknown level.`);
  });
  return errs;
}

/** "Free lift inspection!" → "free-lift-inspection" (≤ 32 chars, never empty). */
export function perkSlug(name: string): string {
  const s = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return s || "perk";
}

/**
 * A new perk id: `<slug>-<4 base36>`, never one in `taken` (every id ever
 * stored — live perks, tombstones and ids the ledger references).
 */
export function mintPerkId(name: string, taken: Set<string>, rand: () => number = Math.random): string {
  const slug = perkSlug(name);
  for (let i = 0; i < 50; i++) {
    const suffix = Math.floor(rand() * 36 ** 4)
      .toString(36)
      .padStart(4, "0")
      .slice(-4);
    const id = `${slug}-${suffix}`;
    if (!taken.has(id)) return id;
  }
  let n = 1;
  while (taken.has(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

/**
 * The editor's save: `drafts` (in display order) against the stored perks.
 * A draft whose id is a stored LIVE perk keeps that id; every other draft
 * gets a freshly minted id (so a removed perk's id is never reused). A
 * stored live perk missing from `drafts` becomes a tombstone (removed,
 * inactive); stored tombstones are kept. Output: drafts in order, then
 * tombstones. The caller sanitizes the result.
 */
export function mergePerkEdits(
  stored: Perk[],
  drafts: PerkDraft[],
  opts: { ledgerPerkIds?: Iterable<string>; rand?: () => number } = {}
): Perk[] {
  const live = new Map(stored.filter((p) => !p.removed).map((p) => [p.id, p]));
  const taken = new Set<string>([...stored.map((p) => p.id), ...(opts.ledgerPerkIds ?? [])]);
  const kept = new Set<string>();
  const out: Perk[] = [];
  for (const d of drafts) {
    const name = String(d?.name ?? "").trim();
    if (!name) continue;
    let id = String(d.id ?? "");
    if (!live.has(id) || kept.has(id)) {
      id = mintPerkId(name, taken, opts.rand);
      taken.add(id);
    }
    kept.add(id);
    out.push({
      id,
      name,
      description: String(d.description ?? ""),
      level: isRewardLevel(d.level) ? d.level : "base",
      frequency: d.frequency === "yearly" ? "yearly" : "once",
      active: d.active !== false,
    });
  }
  for (const p of stored) {
    if (kept.has(p.id)) continue;
    out.push({ ...p, active: false, removed: true });
  }
  return out;
}

/* ---------- the portal's Rewards card (spec §7) ---------- */

/**
 * Exactly what a customer may see — a whitelist: the reward level NAME,
 * progress to the next level, the credit balance and the available perks'
 * name + description. Never a margin, an earn %, a tier's pricing or
 * another company's anything.
 */
export type PortalRewardsView = {
  level: RewardLevel;
  levelLabel: string;
  /** Null at the top level. */
  next: { levelLabel: string; need: number } | null;
  /** 0–1. */
  progress: number;
  /** Never below $0 on the customer's side. */
  balance: number;
  perks: { id: string; name: string; description: string }[];
};

export function portalRewardsView(input: {
  program: Pick<RewardsProgram, "thresholds" | "perks">;
  spend: number;
  balance: number;
  entries: LedgerEntry[];
  now: number;
}): PortalRewardsView {
  const level = levelFor(input.spend, input.program);
  const next = nextLevel(input.spend, input.program);
  const perks = perkStatuses(input.program.perks, { earned: level, entries: input.entries, now: input.now })
    .filter((s) => s.available)
    .map((s) => ({ id: s.perk.id, name: s.perk.name, description: s.perk.description }));
  return {
    level,
    levelLabel: REWARD_LEVEL_LABEL[level],
    next: next ? { levelLabel: REWARD_LEVEL_LABEL[next.level], need: next.need } : null,
    progress: levelProgress(input.spend, input.program),
    balance: Math.max(0, Math.round((input.balance || 0) * 100) / 100),
    perks,
  };
}
