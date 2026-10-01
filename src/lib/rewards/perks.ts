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
 *
 * #282 perks+points (Jeff 2026-10-01): a perk may also carry a `pointCost`.
 * It is FREE when the earned level reaches its unlock level (the rule above);
 * otherwise it is BUYABLE when it has a point price and the company's
 * spendable points (pointsFor(available credit)) cover it. The once / yearly
 * limit counts every live use — free, bought or Mark used. Free wins when
 * both apply. A REDEMPTION is a `perk` use with `redeemed` set (amount 0 when
 * free, −pointCost when bought) that staff then fulfil (`perk-fulfil`);
 * undoing it refunds exactly what it debited.
 */

import {
  PERK_POINTS_ONLY,
  REWARD_LEVEL_LABEL,
  isRewardLevel,
  levelProgress,
  levelRank,
  nextLevel,
  levelFor,
  sanitizePointCost,
  type Perk,
  type RewardLevel,
  type RewardsProgram,
} from "./program";
import { entryN, type LedgerEntry } from "./ledger";
import { formatPoints, pointsFor } from "./points";
import { customerPurchasePerks } from "./purchase-perks";
import { mintPerkId } from "./perk-ids";

export const PERK_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export const PERK_FREQUENCY_LABEL = { once: "Once", yearly: "Once a year" } as const;

export const perkUseId = (companyId: string, perkId: string, n: number) => `perk:${companyId}:${perkId}:${n}`;
/** The undo entry's id for a use: "un" + the use's own id. */
export const perkUndoId = (useId: string) => `un${useId}`;

/** #282 perks+points: the fulfilment entry's id for a redemption: "fulfil:" + the use's own id. */
export const perkFulfilId = (useId: string) => `fulfil:${useId}`;

export type PerkUse = {
  entry: LedgerEntry;
  /** The `unperk` entry that undid this use, if any. */
  undone: LedgerEntry | null;
  /** #282 perks+points: the `perk-fulfil` entry for a redemption, if staff have delivered it. */
  fulfilled: LedgerEntry | null;
};

/** Every `perk` entry (for one perk, or all), paired with its undo and fulfilment, newest first. */
export function perkUses(entries: LedgerEntry[], perkId?: string): PerkUse[] {
  const undos = new Map<string, LedgerEntry>();
  const fulfils = new Map<string, LedgerEntry>();
  for (const e of entries) {
    if (e.kind === "unperk") undos.set(e.id, e);
    else if (e.kind === "perk-fulfil") fulfils.set(e.id, e);
  }
  return entries
    .filter((e) => e.kind === "perk" && (perkId == null || e.perkId === perkId))
    .map((entry) => ({
      entry,
      undone: undos.get(perkUndoId(entry.id)) ?? null,
      fulfilled: fulfils.get(perkFulfilId(entry.id)) ?? null,
    }))
    .sort((a, b) => b.entry.at - a.entry.at || b.entry.id.localeCompare(a.entry.id));
}

/** A redemption (portal or staff Redeem) — as opposed to a staff Mark used. */
export function isRedemption(u: PerkUse): boolean {
  return u.entry.redeemed === "free" || u.entry.redeemed === "points";
}

/** Redemptions staff still owe the customer: not undone, not fulfilled (newest first). */
export function unfulfilledRedemptions(entries: LedgerEntry[]): PerkUse[] {
  return perkUses(entries).filter((u) => isRedemption(u) && !u.undone && !u.fulfilled);
}

/** The next use number for a company's perk (max n over its uses, + 1). */
export function nextPerkUseN(entries: LedgerEntry[], perkId: string): number {
  let n = 0;
  for (const e of entries) if (e.kind === "perk" && e.perkId === perkId) n = Math.max(n, entryN(e.id));
  return n + 1;
}

export type PerkBlock = "inactive" | "removed" | "level" | "points" | "used" | "cooldown";
/** #282 perks+points: how an available perk is had — free at its level, or bought with points. */
export type PerkMode = "free" | "points";

export type PerkStatus = {
  perk: Perk;
  /** Free OR buyable right now. */
  available: boolean;
  /** How it is available (null when it isn't). Free wins when both apply. */
  mode: PerkMode | null;
  /** Why it is not available (null when it is). "points" = for sale but the company is short. */
  block: PerkBlock | null;
  /** The perk's point price (null = not for sale). */
  pointCost: number | null;
  /** Points still missing when `block === "points"` (else 0). */
  short: number;
  /** The last live use's time (null = never used, or every use undone). */
  lastUsedAt: number | null;
  /** Yearly perks: when it is next available (null when available now / not yearly). */
  nextAt: number | null;
};

export type PerkCtx = {
  earned: RewardLevel;
  entries: LedgerEntry[];
  now: number;
  /** #282 perks+points: the company's SPENDABLE points (pointsFor(available credit)); absent = 0. */
  points?: number;
};

/** True when the earned level reaches the perk's unlock level (a points-only perk never is free). */
export function perkFreeAt(perk: Pick<Perk, "level">, earned: RewardLevel): boolean {
  return perk.level != null && levelRank(earned) >= levelRank(perk.level);
}

/** One perk's availability for a company at `now` (spec §6 + #282 perks+points). */
export function perkStatus(perk: Perk, ctx: PerkCtx): PerkStatus {
  const live = perkUses(ctx.entries, perk.id).filter((u) => !u.undone);
  const lastUsedAt = live.length ? live[0].entry.at : null;
  const pointCost = sanitizePointCost(perk.pointCost) ?? null;
  const base = { perk, lastUsedAt, nextAt: null as number | null, pointCost, short: 0, mode: null as PerkMode | null };
  if (perk.removed) return { ...base, available: false, block: "removed" };
  if (!perk.active) return { ...base, available: false, block: "inactive" };
  const free = perkFreeAt(perk, ctx.earned);
  if (!free && pointCost == null) return { ...base, available: false, block: "level" };
  // once / yearly — counts every live use, free, bought or marked used.
  if (perk.frequency === "once") {
    if (lastUsedAt != null) return { ...base, available: false, block: "used" };
  } else if (lastUsedAt != null) {
    const nextAt = lastUsedAt + PERK_YEAR_MS;
    if (ctx.now < nextAt) return { ...base, available: false, block: "cooldown", nextAt };
  }
  if (free) return { ...base, available: true, block: null, mode: "free" };
  const points = Math.max(0, Math.floor(Number.isFinite(ctx.points) ? (ctx.points as number) : 0));
  if (points >= (pointCost as number)) return { ...base, available: true, block: null, mode: "points" };
  return { ...base, available: false, block: "points", short: (pointCost as number) - points };
}

/** Every listable perk's status, in program order (removed perks left out). */
export function perkStatuses(perks: Perk[], ctx: PerkCtx): PerkStatus[] {
  return perks.filter((p) => !p.removed).map((p) => perkStatus(p, ctx));
}

/** Free + buyable perks right now (the /rewards Perks column). */
export function availablePerkCount(perks: Perk[], ctx: PerkCtx): number {
  return perkStatuses(perks, ctx).filter((s) => s.available).length;
}

/** The refusal a staff member or customer sees for a perk that isn't available. */
export function perkBlockMessage(s: Pick<PerkStatus, "block" | "short">): string {
  switch (s.block) {
    case "level":
      return "This company hasn't earned that perk's level.";
    case "points":
      return `Not enough points — ${formatPoints(s.short)} short.`;
    case "used":
      return "That perk has already been used.";
    case "cooldown":
      return "That perk was used in the last year.";
    case "removed":
      return "That perk no longer exists.";
    default:
      return "That perk is turned off.";
  }
}

/**
 * #282 perks+points — the ledger entry one redemption posts, or why not
 * (pure; the store runs it under the company's rewards lock). `available` is
 * the company's available credit in dollars (balance − credit parked on open
 * quotes); spendable points = pointsFor(available) — rounded UP, so a balance
 * of $299.50 buys a 300-point perk and lands at −$0.50, never lower than
 * −$1. A free redemption debits nothing; a bought one debits exactly
 * `pointCost` dollars. `mode` pins what the caller showed ("Free" / "N
 * points") — when it no longer matches (the level changed, the price was
 * edited) the redemption is refused instead of silently charging points.
 */
export function perkRedemptionEntry(input: {
  perk: Perk | null | undefined;
  companyId: string;
  earned: RewardLevel;
  entries: LedgerEntry[];
  available: number;
  now: number;
  via: "portal" | "staff";
  by: string;
  note?: string | null;
  expect?: { mode: PerkMode; pointCost: number | null } | null;
}): { ok: true; entry: LedgerEntry; status: PerkStatus } | { ok: false; error: string } {
  const perk = input.perk;
  if (!perk || perk.removed) return { ok: false, error: "That perk no longer exists." };
  const st = perkStatus(perk, { earned: input.earned, entries: input.entries, now: input.now, points: pointsFor(input.available) });
  if (!st.available || !st.mode) return { ok: false, error: perkBlockMessage(st) };
  if (input.expect && (input.expect.mode !== st.mode || (st.mode === "points" && input.expect.pointCost !== st.pointCost))) {
    return {
      ok: false,
      error:
        st.mode === "free"
          ? "That perk is now free for this company — refresh and redeem it again."
          : `That perk now costs ${formatPoints(st.pointCost || 0)} — refresh and try again.`,
    };
  }
  const note = String(input.note || "").trim().slice(0, 500);
  const entry: LedgerEntry = {
    id: perkUseId(input.companyId, perk.id, nextPerkUseN(input.entries, perk.id)),
    companyId: input.companyId,
    kind: "perk",
    amount: st.mode === "points" ? -(st.pointCost as number) : 0,
    perkId: perk.id,
    redeemed: st.mode,
    via: input.via,
    ...(note ? { note } : {}),
    at: input.now,
    by: input.by,
  };
  return { ok: true, entry, status: st };
}


/* ---------- Settings → Rewards → Perks (the editor's merge) ---------- */

export { mintPerkId, perkSlug } from "./perk-ids";

export type PerkDraft = {
  /** A stored perk's id; anything else (blank, "new:…", a removed id) mints a new one. */
  id?: string;
  name: string;
  description: string;
  /** A reward level, or "none" (PERK_POINTS_ONLY) for a points-only perk. */
  level: string;
  frequency: string;
  active: boolean;
  /** #282 perks+points: the point price — blank/absent = not for sale. */
  pointCost?: number | string | null;
};

/** Problems to show instead of silently dropping a row. */
export function perkDraftErrors(drafts: unknown): string[] {
  if (!Array.isArray(drafts)) return ["Perks must be a list."];
  const errs: string[] = [];
  if (drafts.length > 100) errs.push("At most 100 perks.");
  drafts.forEach((d, i) => {
    const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
    if (!String(o.name ?? "").trim()) errs.push(`Perk ${i + 1} needs a name.`);
    const pointsOnly = o.level === PERK_POINTS_ONLY || o.level === null;
    if (o.level != null && !pointsOnly && !isRewardLevel(o.level)) errs.push(`Perk ${i + 1} has an unknown level.`);
    const rawCost = o.pointCost;
    const hasCost = rawCost != null && String(rawCost).trim() !== "";
    if (hasCost) {
      const n = Number(String(rawCost).replace(/[,\s]/g, ""));
      if (!Number.isInteger(n) || n < 1 || n > 1_000_000) errs.push(`Perk ${i + 1}'s point price must be a whole number of points, 1 or more.`);
    }
    if (pointsOnly && !hasCost) errs.push(`Perk ${i + 1} is points-only — give it a point price, or pick the level it unlocks at.`);
  });
  return errs;
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
    const pointCost = sanitizePointCost(typeof d.pointCost === "string" ? d.pointCost.replace(/[,\s]/g, "") : d.pointCost);
    const level = isRewardLevel(d.level) ? d.level : pointCost != null && (d.level === PERK_POINTS_ONLY || d.level == null) ? null : "base";
    out.push({
      id,
      name,
      description: String(d.description ?? ""),
      level,
      frequency: d.frequency === "yearly" ? "yearly" : "once",
      active: d.active !== false,
      ...(pointCost != null ? { pointCost } : {}),
    });
  }
  for (const p of stored) {
    if (kept.has(p.id)) continue;
    out.push({ ...p, active: false, removed: true });
  }
  return out;
}

/* ---------- the portal's Rewards card (spec §7) ---------- */

/** One perk on the portal card: "Free" or "N points" — never a dollar amount. */
export type PortalPerk = {
  id: string;
  name: string;
  description: string;
  /** How the customer can have it right now. */
  mode: PerkMode;
  /** The points it costs when `mode === "points"`; null when free. */
  pointCost: number | null;
};

/**
 * Exactly what a customer may see — a whitelist: the reward level NAME,
 * progress to the next level (in dollars of purchases), the credit balance
 * as POINTS, the available perks' name + description + "Free" / point price,
 * their purchase perks, and their redemptions still being fulfilled. Never a
 * margin, an earn %, a tier's pricing, the dollar balance (#282 points
 * follow-up — the customer side is points only) or another company's anything.
 */
export type PortalRewardsView = {
  level: RewardLevel;
  levelLabel: string;
  /** Null at the top level. */
  next: { levelLabel: string; need: number } | null;
  /** 0–1. */
  progress: number;
  /** The credit balance in points (1 point = $1, rounded up; never below 0). */
  points: number;
  /** Free or buyable perks (#282 perks+points). */
  perks: PortalPerk[];
  /** #282 perks+points: "Your <Level> purchase perks" (null when none). */
  purchasePerks: { levelLabel: string; perks: { id: string; name: string; description: string }[] } | null;
  /** #282 perks+points: redemptions Peak hasn't fulfilled yet (newest first). */
  pending: { id: string; name: string; at: number }[];
};

export function portalRewardsView(input: {
  program: Pick<RewardsProgram, "thresholds" | "perks"> & Partial<Pick<RewardsProgram, "enabled" | "purchasePerks">>;
  spend: number;
  balance: number;
  /** Available credit in dollars (balance − credit parked on open quotes) — what points can buy. Defaults to `balance`. */
  available?: number;
  entries: LedgerEntry[];
  now: number;
}): PortalRewardsView {
  const level = levelFor(input.spend, input.program);
  const next = nextLevel(input.spend, input.program);
  const spendable = pointsFor(input.available ?? input.balance ?? 0);
  const perks = perkStatuses(input.program.perks, { earned: level, entries: input.entries, now: input.now, points: spendable })
    .filter((s) => s.available && s.mode)
    .map((s) => ({
      id: s.perk.id,
      name: s.perk.name,
      description: s.perk.description,
      mode: s.mode as PerkMode,
      pointCost: s.mode === "points" ? s.pointCost : null,
    }));
  const pp = customerPurchasePerks(
    { enabled: input.program.enabled !== false, purchasePerks: input.program.purchasePerks || [] },
    level
  );
  const names = new Map(input.program.perks.map((p) => [p.id, p.name]));
  return {
    level,
    levelLabel: REWARD_LEVEL_LABEL[level],
    next: next ? { levelLabel: REWARD_LEVEL_LABEL[next.level], need: next.need } : null,
    progress: levelProgress(input.spend, input.program),
    points: pointsFor(input.balance || 0),
    perks,
    purchasePerks: pp ? { levelLabel: pp.levelLabel, perks: pp.perks.map((p) => ({ id: p.id, name: p.name, description: p.description })) } : null,
    pending: unfulfilledRedemptions(input.entries).map((u) => ({
      id: u.entry.id,
      name: names.get(u.entry.perkId || "") || "Perk",
      at: u.entry.at,
    })),
  };
}
