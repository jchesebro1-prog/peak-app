/**
 * Estimator fixture-configurator add-on PRICE defaults.
 *
 * **This module must stay dependency-free.** It is imported by
 * `estimator-data.ts`, which is pulled into `estimator-client.tsx` — a
 * `"use client"` component. When these lived in `src/lib/stores/pricing.ts`
 * (which imports the doc store, and through it drizzle + `postgres`), the
 * client bundle tried to resolve `fs`/`net`/`tls` and **the whole Estimator
 * page 500'd**. `tsc --noEmit` cannot see that — it is a bundling boundary,
 * not a type error — and the DB-free spec suite runs in node, where those
 * modules exist. Only loading the page catches it.
 *
 * So: no imports here, ever. `pricing.ts` re-exports these for server code,
 * and owns the blob accessors (`getFixtureRates`) that actually hit the DB.
 */

export type FixtureRates = {
  mountCclamp: number;
  mountHalfCoupler: number;
  mountFloorBase: number;
  mountTruss: number;
  accColorFrame: number;
  accGel: number;
  accGobo: number;
  accBarnDoor: number;
  accTopHat: number;
  accSafety: number;
  pwrEdison: number;
  pwrTwistLock: number;
  pwrSoca: number;
  dataDMX: number;
  pwrDimmer: number;
  lamp575: number;
  lamp750: number;
  lamp1000: number;
  /** When a fixture is entered manually, cost = unit price × this. */
  customCostFactor: number;
};

/** Seed/fallback for blob `fixture_rates`. The single source of truth for
 *  add-on PRICE; estimator-data.ts's fixMounts()/fixAcc()/fixPwr()/fixLamps()
 *  read the live values from here and keep only the cost side, which the
 *  rules table has no column for. */
export const FIXTURE_RATE_DEFAULTS: FixtureRates = {
  mountCclamp: 18,
  mountHalfCoupler: 24,
  mountFloorBase: 45,
  mountTruss: 32,
  accColorFrame: 14,
  accGel: 9,
  accGobo: 34,
  accBarnDoor: 58,
  accTopHat: 26,
  accSafety: 12,
  pwrEdison: 22,
  pwrTwistLock: 34,
  pwrSoca: 78,
  dataDMX: 26,
  pwrDimmer: 55,
  lamp575: 22,
  lamp750: 26,
  lamp1000: 34,
  customCostFactor: 0.66,
};
