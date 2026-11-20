/**
 * #367 — the one-time margin → markup conversion of the rate blobs (src/lib/stores/pricing.ts
 * ensureMarkupSettings). Its memo runs once per PROCESS, so this needs its own process and a fresh
 * datadir: `npm run test:markup-settings`. The blobs are written raw, exactly as a margin-era
 * production database holds them, before the first rate read of the process.
 */
import { eq, inArray } from "drizzle-orm";
import { getDb, seeded, withTransaction } from "@/db";
import { blobs } from "@/db/schema";
import { getCatalogRates, value } from "@/lib/stores/pricing";
import { resolveTier } from "@/lib/pricing-tiers";

type Ok = (cond: boolean, msg: string) => void;

const RAW: Record<string, Record<string, unknown>> = {
  flametest_rates: { margin: 0.3, laborRate: 80 },
  repair_rates: { margin: 0.3, partsMargin: 0.27 },
  pricing_rules: { "tiers.base": 30, "tiers.gold": 20, "system.freightPct": 5 },
};

async function rawBlob(id: string): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  const rows = await db.select().from(blobs).where(eq(blobs.id, id)).limit(1);
  return (rows[0]?.data as Record<string, unknown> | undefined) ?? null;
}

export async function markupSettingsChecks(ok: Ok): Promise<void> {
  await seeded();
  const db = await getDb();
  const ids = ["flametest_rates", "repair_rates", "inspection_rates", "catalog_rates", "pricing_rules"];
  await db.delete(blobs).where(inArray(blobs.id, ids));
  for (const [id, data] of Object.entries(RAW)) await db.insert(blobs).values({ id, data, updatedAt: Date.now() });

  // 1. A conversion inside a transaction that rolls back is NOT memoized.
  //    (Stage 3 removal: the flame / repair / inspection rate blobs are no longer read, converted or reset —
  //    the check runs on the rules blob, and the service blobs must come through untouched.)
  let inside: number | null = null;
  await withTransaction(async () => {
    inside = await value("tiers.base");
    throw new Error("roll back");
  }).catch(() => {});
  ok(inside === 43, "markup settings: inside a transaction the rules blob reads converted (30 % margin → 43 %)");
  const afterRollback = await rawBlob("pricing_rules");
  ok(afterRollback?.["tiers.base"] === 30 && !("_pricingBasis" in (afterRollback ?? {})), "markup settings: the rolled-back conversion left the margin-era blob as it was");

  // 2. The first read outside a transaction converts every live blob once, stamped, with a backup.
  ok((await value("tiers.base")) === 43 && (await value("tiers.gold")) === 25 && (await value("system.freightPct")) === 5,
    "markup settings: stored whole-percent tiers convert and round (30 → 43, 20 → 25); freight is untouched");
  ok((await resolveTier(null)).markup === 0.43, "markup settings: the Base tier resolves to 43 % markup");
  const rawRules = await rawBlob("pricing_rules");
  ok(JSON.stringify(rawRules?._marginBackup) === JSON.stringify({ "tiers.base": 30, "tiers.gold": 20 }), "markup settings: the rules blob backs up only the margin keys it held");
  ok(rawRules?._pricingBasis === "markup" && rawRules?.["tiers.base"] === 43, "markup settings: the stored rules blob is stamped and converted (after a rolled-back try — no stale memo)");
  const rawFlame = await rawBlob("flametest_rates"), rawRepair = await rawBlob("repair_rates");
  ok(rawFlame?.margin === 0.3 && !("_pricingBasis" in (rawFlame ?? {})) && rawRepair?.margin === 0.3 && rawRepair?.partsMargin === 0.27 && !("_pricingBasis" in (rawRepair ?? {})),
    "markup settings: the removed service engines' rate blobs are left exactly as stored (not converted, not stamped)");
  const rawCatalog = await rawBlob("catalog_rates");
  ok(!!rawCatalog && rawCatalog._pricingBasis === "markup" && Object.keys(rawCatalog).join() === "_pricingBasis" && (await getCatalogRates()).defaultMargin === 0.43,
    "markup settings: a blob that never existed is created with only the stamp (defaults are markup)");
}

if (process.argv[1] && /test-markup-settings\.ts$/.test(process.argv[1])) {
  let fail = 0;
  const ok: Ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  if (process.env.DATABASE_URL) {
    console.error("Refusing to run: DATABASE_URL is set; unset it (this suite writes to the DB).");
    process.exit(1);
  }
  if (!process.env.PGLITE_PATH) {
    console.error("Refusing to run: PGLITE_PATH is not set — use `npm run test:markup-settings` (a scratch datadir), never the dev DB.");
    process.exit(1);
  }
  markupSettingsChecks(ok)
    .then(() => {
      console.log(fail ? `\n${fail} FAILED` : "\nall markup-settings checks passed");
      process.exit(fail ? 1 : 0);
    })
    .catch((err) => {
      console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
      process.exit(1);
    });
}
