import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { getDoc, type Doc } from "@/db/doc-store";

/**
 * Estimate-number allocation (#223) — the server seam over the database's
 * `assign_estimate_numbers()` (drizzle/0030_estimate_numbers.sql), which is the
 * only allocator: it numbers every quote and lead still without an `estNo`,
 * oldest first, carrying a lead's number to its quotes (+ suffix).
 *
 * Every path that INSERTS a quote or lead calls this right after the insert
 * (store create()s via numberNewDoc, leads.convert, the Daylite commit, the
 * demo seed). Because it numbers every unnumbered row, it also heals
 * stragglers: records the previous deployment created while production was
 * migrating, or a preview deploy created against the shared, not-yet-migrated
 * production DB.
 *
 * Server-only (imports the db). Formatting lives in @/lib/estimate-number.
 */

function rowsOf<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) return (result as { rows: T[] }).rows;
  return Array.isArray(result) ? (result as T[]) : [];
}

// Set once the probe has found the function: a migration is never undone, so
// every later call skips the round-trip. Never set while it is absent, so a
// preview keeps probing until production migrates.
let functionPresent = false;

/**
 * Number everything still unnumbered; returns how many records were numbered.
 * Returns 0 — without raising — when the function does not exist yet: a
 * preview deploy reads the shared production DB before production migrates
 * (scripts/migrate.mjs skips previews), and a raised "function does not
 * exist" would poison any transaction the caller is in. `to_regprocedure`
 * answers NULL instead of raising.
 */
export async function assignEstimateNumbers(): Promise<number> {
  const db = await getDb();
  if (!functionPresent) {
    const probe = rowsOf<{ ok: boolean }>(
      await db.execute(sql`select to_regprocedure('assign_estimate_numbers()') is not null as ok`)
    );
    if (!probe[0]?.ok) return 0;
    functionPresent = true;
  }
  const res = rowsOf<{ n: number | string | bigint | null }>(
    await db.execute(sql`select assign_estimate_numbers() as n`)
  );
  return Number(res[0]?.n ?? 0);
}

/** Test seam: forget the cached probe (the spec harness drops the function
 *  inside a rolled-back transaction to stand in for an un-migrated DB). */
export function resetEstimateNumberProbe(): void {
  functionPresent = false;
}

/** Number a just-inserted quote/lead and return it as stored (with estNo). */
export async function numberNewDoc<T extends Doc>(coll: "quotes" | "leads", doc: T): Promise<T> {
  await assignEstimateNumbers();
  return (await getDoc<T>(coll, doc.id)) ?? doc;
}
