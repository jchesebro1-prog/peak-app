/**
 * Customer Rewards — program settings, levels and tier suggestions (#282,
 * spec docs/superpowers/specs/2026-09-30-customer-rewards-design.md §1, §3).
 *
 * Pure and client-safe: no store, no DB, no "use client" import. The program
 * lives in blob `rewards_program` (read/written by src/lib/stores/rewards.ts);
 * every read goes through `sanitizeRewardsProgram`, so a hand-edited or
 * partial blob can never produce descending thresholds or a 90 % earn rate.
 *
 * The ladder reuses the pricing-tier keys (src/lib/identity/config.ts
 * PRICING_TIERS): a customer's earned level IS the tier rewards would suggest.
 * Reseller and Employee are off-ladder — never earned, never suggested.
 */

export const REWARD_LEVELS = ["base", "copper", "silver", "gold", "platinum"] as const;
export type RewardLevel = (typeof REWARD_LEVELS)[number];
/** The levels a threshold unlocks (Base needs no spend). */
export const THRESHOLD_LEVELS = ["copper", "silver", "gold", "platinum"] as const;
export type ThresholdLevel = (typeof THRESHOLD_LEVELS)[number];

export const REWARD_LEVEL_LABEL: Record<RewardLevel, string> = {
  base: "Base",
  copper: "Copper",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
};

export const REWARDS_PROGRAM_BLOB = "rewards_program";

export type PerkFrequency = "once" | "yearly";
export type Perk = {
  id: string;
  name: string;
  description: string;
  level: RewardLevel;
  frequency: PerkFrequency;
  active: boolean;
  /**
   * #282 phase 4: a perk removed in Settings → Rewards stays in the blob as a
   * tombstone (always inactive, hidden from the editor) so past uses on the
   * ledger keep their name and its id is never minted again.
   */
  removed?: boolean;
};

export type RewardsProgram = {
  /** Default false — nothing posts or shows while off (Settings → Rewards excepted). */
  enabled: boolean;
  /** Lifetime $ to reach each level. Strictly ascending Copper → Platinum. */
  thresholds: Record<ThresholdLevel, number>;
  /** Credit earned per won quote, % of its value (phase 2 posts it). 0–20. */
  earnPct: Record<RewardLevel, number>;
  /** One-time starting credit from history (phase 2 posts it). */
  retro: { ratePct: number; capPerCustomer: number };
  /** Perk definitions, in display order (Settings → Rewards → Perks, #282 phase 4). */
  perks: Perk[];
  /** Stamped the first time `enabled` turns on; never cleared. */
  launchedAt?: number;
};

/** Spec §1 defaults — assumptions flagged for Jeff. Disabled. */
export const DEFAULT_REWARDS_PROGRAM: RewardsProgram = {
  enabled: false,
  thresholds: { copper: 25000, silver: 75000, gold: 150000, platinum: 300000 },
  earnPct: { base: 0, copper: 1, silver: 1.5, gold: 2, platinum: 3 },
  retro: { ratePct: 1, capPerCustomer: 1000 },
  perks: [],
};

export const EARN_PCT_MAX = 20;
export const RETRO_PCT_MAX = 20;

const round2 = (n: number) => Math.round(n * 100) / 100;

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(/[$,\s]/g, "")) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function isRewardLevel(v: unknown): v is RewardLevel {
  return typeof v === "string" && (REWARD_LEVELS as readonly string[]).includes(v);
}

/** Ladder rank (base 0 … platinum 4); -1 for anything off-ladder. */
export function levelRank(v: string | null | undefined): number {
  return REWARD_LEVELS.indexOf(v as RewardLevel);
}

/**
 * Problems an admin should see instead of a silent fix (Settings → Rewards
 * save). Empty = the input sanitizes to what was typed.
 */
export function rewardsProgramErrors(raw: unknown): string[] {
  const errs: string[] = [];
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const th = (r.thresholds && typeof r.thresholds === "object" ? r.thresholds : {}) as Record<string, unknown>;
  let prev = 0;
  let prevLabel = "";
  for (const lv of THRESHOLD_LEVELS) {
    const n = num(th[lv]);
    const label = REWARD_LEVEL_LABEL[lv];
    if (n == null) {
      errs.push(`${label} needs a dollar amount.`);
      continue;
    }
    if (n <= 0) errs.push(`${label} must be more than $0.`);
    else if (n <= prev) errs.push(`${label} must be more than ${prevLabel}.`);
    prev = n;
    prevLabel = label;
  }
  const ep = (r.earnPct && typeof r.earnPct === "object" ? r.earnPct : {}) as Record<string, unknown>;
  for (const lv of REWARD_LEVELS) {
    const n = num(ep[lv]);
    if (n != null && (n < 0 || n > EARN_PCT_MAX)) errs.push(`${REWARD_LEVEL_LABEL[lv]} earn % must be 0–${EARN_PCT_MAX}.`);
  }
  const retro = (r.retro && typeof r.retro === "object" ? r.retro : {}) as Record<string, unknown>;
  const rate = num(retro.ratePct);
  if (rate != null && (rate < 0 || rate > RETRO_PCT_MAX)) errs.push(`Starting credit rate must be 0–${RETRO_PCT_MAX} %.`);
  const cap = num(retro.capPerCustomer);
  if (cap != null && cap < 0) errs.push("Starting credit cap can't be negative.");
  return errs;
}

function sanitizePerks(raw: unknown): Perk[] {
  if (!Array.isArray(raw)) return [];
  const out: Perk[] = [];
  const seen = new Set<string>();
  for (const p of raw) {
    if (!p || typeof p !== "object") continue;
    const o = p as Record<string, unknown>;
    const name = String(o.name ?? "").trim().slice(0, 120);
    if (!name) continue;
    let id = String(o.id ?? "").trim().slice(0, 60);
    if (!id || seen.has(id)) {
      // Deterministic fill for a missing/duplicate id: the first free perk-<n>.
      let n = out.length + 1;
      while (seen.has(`perk-${n}`)) n++;
      id = `perk-${n}`;
    }
    seen.add(id);
    const removed = o.removed === true;
    out.push({
      id,
      name,
      description: String(o.description ?? "").trim().slice(0, 1000),
      level: isRewardLevel(o.level) ? o.level : "base",
      frequency: o.frequency === "yearly" ? "yearly" : "once",
      active: !removed && o.active !== false,
      ...(removed ? { removed: true } : {}),
    });
  }
  return out;
}

/**
 * The one shape every reader sees. Coerces numbers, clamps earn/retro rates
 * to 0–20 %, caps to ≥ 0, whole-dollar thresholds forced strictly ascending
 * (a threshold at or below the one before it is raised to that one + $1),
 * perks with unique ids. `launchedAt` is kept only when it is a positive
 * number — the save action stamps it; a client never supplies it.
 */
export function sanitizeRewardsProgram(raw: unknown): RewardsProgram {
  const d = DEFAULT_REWARDS_PROGRAM;
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const th = (r.thresholds && typeof r.thresholds === "object" ? r.thresholds : {}) as Record<string, unknown>;
  const thresholds = { ...d.thresholds };
  let prev = 0;
  for (const lv of THRESHOLD_LEVELS) {
    const n = num(th[lv]);
    let v = Math.round(n != null && n > 0 ? n : d.thresholds[lv]);
    if (v <= prev) v = prev + 1;
    thresholds[lv] = v;
    prev = v;
  }
  const ep = (r.earnPct && typeof r.earnPct === "object" ? r.earnPct : {}) as Record<string, unknown>;
  const earnPct = { ...d.earnPct };
  for (const lv of REWARD_LEVELS) {
    const n = num(ep[lv]);
    earnPct[lv] = round2(clamp(n ?? d.earnPct[lv], 0, EARN_PCT_MAX));
  }
  const retroRaw = (r.retro && typeof r.retro === "object" ? r.retro : {}) as Record<string, unknown>;
  const rate = num(retroRaw.ratePct);
  const cap = num(retroRaw.capPerCustomer);
  const out: RewardsProgram = {
    enabled: r.enabled === true,
    thresholds,
    earnPct,
    retro: {
      ratePct: round2(clamp(rate ?? d.retro.ratePct, 0, RETRO_PCT_MAX)),
      capPerCustomer: round2(Math.max(0, cap ?? d.retro.capPerCustomer)),
    },
    perks: sanitizePerks(r.perks),
  };
  const launched = num(r.launchedAt);
  if (launched != null && launched > 0) out.launchedAt = launched;
  return out;
}

/** The highest level whose threshold `spend` meets (≥). */
export function levelFor(spend: number, program: Pick<RewardsProgram, "thresholds">): RewardLevel {
  let level: RewardLevel = "base";
  for (const lv of THRESHOLD_LEVELS) if (spend >= program.thresholds[lv]) level = lv;
  return level;
}

export type NextLevel = { level: ThresholdLevel; threshold: number; need: number };

/** The next level up and what it still takes; null at the top of the ladder. */
export function nextLevel(spend: number, program: Pick<RewardsProgram, "thresholds">): NextLevel | null {
  for (const lv of THRESHOLD_LEVELS) {
    const t = program.thresholds[lv];
    if (spend < t) return { level: lv, threshold: t, need: round2(t - spend) };
  }
  return null;
}

/** 0–1 progress from the current level's threshold to the next (1 at the top). */
export function levelProgress(spend: number, program: Pick<RewardsProgram, "thresholds">): number {
  const next = nextLevel(spend, program);
  if (!next) return 1;
  const cur = levelFor(spend, program);
  const floor = cur === "base" ? 0 : program.thresholds[cur as ThresholdLevel];
  const span = next.threshold - floor;
  return span > 0 ? clamp((spend - floor) / span, 0, 1) : 0;
}

/**
 * The company's current tier as rewards reads it: a ladder level, "off"
 * for Reseller/Employee (never suggested), Base when unset or unknown.
 */
export function ladderTierOf(tier: string | null | undefined): RewardLevel | "off" {
  const t = (tier || "").trim();
  if (t === "reseller" || t === "employee") return "off";
  return isRewardLevel(t) ? t : "base";
}

/**
 * Spec §3 suggestion: the earned level when it is above the company's
 * current ladder tier. Never for Reseller/Employee, never down, and hidden
 * while a Dismiss at this level (or higher) stands — a dismissal lasts until
 * the customer earns the NEXT level.
 */
export function suggestionFor(input: {
  companyTier: string | null | undefined;
  earned: RewardLevel;
  dismissedLevel?: string | null;
}): RewardLevel | null {
  const cur = ladderTierOf(input.companyTier);
  if (cur === "off") return null;
  if (levelRank(input.earned) <= levelRank(cur)) return null;
  if (input.dismissedLevel && levelRank(input.dismissedLevel) >= levelRank(input.earned)) return null;
  return input.earned;
}

/**
 * Which of a company's contacts an Approve raises: every contact whose OWN
 * tier is a ladder level below the new level. A contact without a tier
 * already follows the company; Reseller/Employee contacts are never touched;
 * a contact at or above the new level is never lowered.
 */
export function contactsToRaise<C extends { pricingTier?: string | null }>(contacts: C[], level: RewardLevel): C[] {
  return contacts.filter((c) => {
    const t = (c.pricingTier || "").trim();
    if (!t || !isRewardLevel(t)) return false;
    return levelRank(t) < levelRank(level);
  });
}
