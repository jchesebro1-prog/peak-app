// SERVER ONLY — reads Estimating Rules rates through pricing.ts's DB-backed
// `num()`. No "server-only" package in this repo (checked package.json);
// mirrors src/lib/curtain-pricing.ts's comment-only convention.
import { num } from "@/lib/stores/pricing";
import { DEFAULT_FREIGHT_RULE, FREIGHT_RATE_IDS, type FreightRule } from "@/lib/freight-rule";

export async function loadFreightRule(): Promise<FreightRule> {
  const [basePct, stepMiles, stepPct, capPct] = await Promise.all([
    num(FREIGHT_RATE_IDS.base, DEFAULT_FREIGHT_RULE.basePct),
    num(FREIGHT_RATE_IDS.stepMiles, DEFAULT_FREIGHT_RULE.stepMiles),
    num(FREIGHT_RATE_IDS.stepPct, DEFAULT_FREIGHT_RULE.stepPct),
    num(FREIGHT_RATE_IDS.cap, DEFAULT_FREIGHT_RULE.capPct),
  ]);
  return { basePct, stepMiles, stepPct, capPct };
}
