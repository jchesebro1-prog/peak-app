import { sql } from "drizzle-orm";
import { getDb, inTransaction } from "@/db";
import { getDoc, getDocRows, listDocsByField, type Doc } from "@/db/doc-store";
import {
  displayLeadNumber,
  displayQuoteNumber,
  parseEstimateNumber,
  quoteNumberMatches,
  type LeadNumberFields,
  type QuoteNumberFields,
} from "@/lib/estimate-number";

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

/**
 * Number a just-inserted quote/lead and return it as stored (with estNo).
 *
 * Runs only OUTSIDE a transaction, i.e. after the insert has committed, as
 * its own short statement: assign_estimate_numbers() takes a global advisory
 * lock held until its transaction ends, so running it inside a caller's
 * transaction would serialize every other create behind that whole
 * transaction. A create inside one is left unnumbered — it shows its internal
 * id until the next create numbers it (the function numbers every straggler).
 *
 * Never throws: the record is already written, and a create that reported
 * failure after writing invites a duplicate re-save (D205). A failed pass is
 * logged and healed the same way.
 */
export async function numberNewDoc<T extends Doc>(coll: "quotes" | "leads", doc: T): Promise<T> {
  if (inTransaction()) return doc;
  try {
    await assignEstimateNumbers();
    return (await getDoc<T>(coll, doc.id)) ?? doc;
  } catch (e) {
    console.error(`numberNewDoc: numbering ${coll}/${doc.id} failed — the next create will number it`, e);
    return doc;
  }
}

function cleanIds(ids: ReadonlyArray<string | null | undefined>): string[] {
  return ids.filter((x): x is string => typeof x === "string" && x !== "");
}

/** id → display number for screens that hold only a quote id (a job's
 *  quoteId, a Grid option's quoteId, a thread link). Soft-deleted quotes are
 *  included (their number still identifies them); unknown ids are absent. */
export async function quoteNumbersFor(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
  const rows = await getDocRows<Doc & QuoteNumberFields>("quotes", cleanIds(ids));
  return new Map(rows.map((r) => [r.id, displayQuoteNumber(r.doc)]));
}

/** id → display number for leads (see quoteNumbersFor). */
export async function leadNumbersFor(ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
  const rows = await getDocRows<Doc & LeadNumberFields>("leads", cleanIds(ids));
  return new Map(rows.map((r) => [r.id, displayLeadNumber(r.doc)]));
}

/**
 * What a person typed into a "quote" field → one live quote id: an internal
 * id that exists (`Q-2041` keeps working), or an estimate number that names
 * exactly one live quote (`CON-1010`, `1010` when unambiguous). Null when
 * nothing — or more than one quote — matches.
 */
export async function findQuoteIdByNumberOrId(input: string): Promise<string | null> {
  const s = String(input || "").trim();
  if (!s) return null;
  if (await getDoc("quotes", s)) return s;
  const parsed = parseEstimateNumber(s);
  if (!parsed) return null;
  const hits = (await listDocsByField<Doc & QuoteNumberFields>("quotes", "estNo", [String(parsed.estNo)])).filter((q) =>
    quoteNumberMatches(q, parsed)
  );
  return hits.length === 1 ? hits[0].id : null;
}
