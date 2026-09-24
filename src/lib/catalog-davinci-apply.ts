/**
 * Write DaVinci ports and document links onto catalog rows Peak already owns
 * (#162). The ONLY module in this feature that writes.
 *
 * Plan and apply are separate so the CLI's report describes exactly the rows a
 * commit would touch — "the report does not describe the run" is the defect
 * `scripts/db-target.ts` was written to prevent, and #159's D202 is what
 * happens when a writer discovers its own scope: `applyRules` walked every row
 * of `catalog_parts`, so a test with four fixtures wrote 452 real parts.
 * `applyEnrichment` writes only the plans handed to it and never queries.
 *
 * Never creates a row, never deletes one, and never writes list/cost/pricedAt.
 */
import type { Port } from "@/lib/catalog-connect";
import { mfrKey } from "@/lib/catalog-books";
import { list as allParts, get as getPart, mergeUpsert, type CatalogPart } from "@/lib/stores/catalog";
import { buildIndexWithStats, matchSku } from "@/lib/davinci/match";
import { loadExtract } from "@/lib/davinci/load";
import type { DavinciDoc, DavinciRecord } from "@/lib/davinci/types";

/**
 * Which Peak manufacturer each DaVinci manufacturer is allowed to enrich.
 *
 * An ALLOWLIST, not string equality, for two independent reasons:
 *
 *  1. The names do not line up. `library.json` carries three manufacturers —
 *     ETC, Echoflex and High End Systems — but Peak files all three under
 *     `mfr: "ETC"` (production has 143 rows in a "High End Systems" category,
 *     every one of them `mfr='ETC'`). Plain equality would silently refuse to
 *     enrich them.
 *  2. Fail closed on anything new. A future ETC library revision that adds a
 *     fourth manufacturer resolves to `undefined` here and every one of its
 *     records is rejected and counted, rather than defaulting to ETC and
 *     stamping ETC datasheets on a brand nobody has looked at yet.
 *
 * The gate matters because the SKU index is not manufacturer-aware: `Draper:450`
 * and `Symetrix:4.50%` both normalize to `450`, which is ETC's Source Four 50
 * Degree, and production holds 19,326 Draper / Crestron / Legrand AV rows whose
 * part numbers look exactly like that.
 */
export const DAVINCI_TO_PEAK_MFR: Readonly<Record<string, string>> = {
  ETC: "ETC",
  Echoflex: "ETC",
  "High End Systems": "ETC",
};

/** The Peak `mfr` a record may be written onto, or null when nothing allows it. */
export function peakMfrFor(record: Pick<DavinciRecord, "manufacturer">): string | null {
  return DAVINCI_TO_PEAK_MFR[record.manufacturer] ?? null;
}

export type EnrichPlan = {
  sku: string;
  displayName: string;
  typeId: string;
  ports: readonly Port[];
  docs: readonly DavinciDoc[];
  skip?: "has-ports" | "nothing-to-write";
};

export type EnrichStats = {
  /** The library export every written row will be attributed to. */
  libraryTimestamp: string;
  libraryRecords: number;
  scanned: number;
  matched: number;
  writable: number;
  skippedHasPorts: number;
  skippedNothingToWrite: number;
  /** Matches thrown away because the DaVinci record belongs to another brand. */
  rejectedWrongMfr: number;
  /** Rows made writable ONLY because --force overrode a human's ports (D6). */
  forcedOverHumanEdits: number;
  unmatched: string[];
};

/** Same shape `serializePorts` stores, so a re-run compares like with like. */
function samePorts(a: readonly Port[] | undefined, b: readonly Port[]): boolean {
  const norm = (ps: readonly Port[]) =>
    JSON.stringify(ps.map((p) => [p.name, p.direction, p.connectionType, p.count ?? 1]));
  return norm(a ?? []) === norm(b);
}

function sameDocs(a: CatalogPart["docs"], b: readonly DavinciDoc[]): boolean {
  const norm = (ds: readonly DavinciDoc[]) => JSON.stringify(ds.map((d) => [d.kind, d.label, d.url]));
  return norm(a ?? []) === norm(b);
}

/**
 * Would `applyEnrichment` change this row at all? Mirrors exactly what apply
 * writes — ports only when the record has some, docs only when the record has
 * some, plus the provenance stamp — so a second run against the same library
 * is genuinely a no-op instead of restamping `enrichedAt` on every row (the
 * spec claims idempotence; ~236 docs-only rows were rewritten on every run).
 */
function writeChangesNothing(part: CatalogPart, rec: DavinciRecord, libraryTimestamp: string): boolean {
  if (rec.ports.length && !samePorts(part.ports, rec.ports)) return false;
  if (rec.docs.length && !sameDocs(part.docs, rec.docs)) return false;
  return part.davinci?.typeId === rec.typeId && part.davinci?.libraryTimestamp === libraryTimestamp;
}

export async function planEnrichment(opts: {
  /**
   * REQUIRED. The Peak manufacturer to scope to — there is no "every row" mode.
   * matchSku keys on the normalized SKU alone, so an unscoped scan would hand
   * ETC's Source Four 50 Degree to Draper's part `450`. See DAVINCI_TO_PEAK_MFR.
   */
  mfr: string;
  onlySkus?: string[];
  force?: boolean;
}): Promise<{ plans: EnrichPlan[]; stats: EnrichStats }> {
  const mfr = String(opts.mfr ?? "").trim();
  if (!mfr) {
    throw new Error(
      "#162 planEnrichment requires a manufacturer. DaVinci matching is by normalized SKU only, " +
        "so an unscoped run would write ETC ports and ETC datasheet links onto Draper, Crestron and " +
        'Legrand AV parts whose numbers collide (Draper "450" → ETC "Source Four 50 Degree"). ' +
        'Pass { mfr: "ETC" } (the CLI defaults --mfr to ETC).'
    );
  }
  const extract = loadExtract();
  const { index } = buildIndexWithStats(extract.records);
  // `undefined` means "no scope" (every row is eligible); an explicitly-passed
  // `[]` means "scope to nothing" and must match zero rows. Collapsing the two
  // (via `?.length ? ... : null`) is the same bug class as D202: a writer that
  // quietly widens its own scope instead of doing nothing when told to touch
  // nothing.
  const only = opts.onlySkus === undefined ? null : new Set(opts.onlySkus);

  const wanted = mfrKey(mfr);
  const parts = (await allParts()).filter((p) => mfrKey(p.mfr) === wanted && (!only || only.has(p.sku)));

  const plans: EnrichPlan[] = [];
  const stats: EnrichStats = {
    libraryTimestamp: extract.libraryTimestamp,
    libraryRecords: extract.records.length,
    scanned: parts.length,
    matched: 0,
    writable: 0,
    skippedHasPorts: 0,
    skippedNothingToWrite: 0,
    rejectedWrongMfr: 0,
    forcedOverHumanEdits: 0,
    unmatched: [],
  };

  for (const p of parts) {
    const rec = matchSku(p.sku, index);
    if (!rec) {
      stats.unmatched.push(p.sku);
      continue;
    }
    // The second half of the manufacturer gate. Scoping the scan is not enough
    // on its own: `--mfr=Draper` would scan Draper rows and still find ETC
    // records behind their part numbers. Compared with mfrKey() because that is
    // how the rest of the codebase compares manufacturer names (catalog-books,
    // the import guard) — a raw `===` here would be the only place in src/ that
    // treats "Legrand AV" and "legrand av" as different brands.
    const allowed = peakMfrFor(rec);
    if (!allowed || mfrKey(allowed) !== mfrKey(p.mfr)) {
      stats.rejectedWrongMfr++;
      continue;
    }
    stats.matched++;
    const plan: EnrichPlan = {
      sku: p.sku,
      displayName: rec.displayName,
      typeId: rec.typeId,
      ports: rec.ports,
      docs: rec.docs,
    };
    // A human's edit in the #158 ports editor outranks the library (D6) — but
    // only a HUMAN's. `p.davinci` means this enricher wrote those ports itself,
    // and after the first production run every enriched row has ports, so
    // testing `p.ports?.length` alone would make a later library revision
    // reachable only with --force, which also destroys the genuine hand edits.
    const humanEdited = !!p.ports?.length && !p.davinci;
    if (humanEdited && !opts.force) {
      plan.skip = "has-ports";
      stats.skippedHasPorts++;
    } else if (
      (!rec.ports.length && !rec.docs.length) ||
      writeChangesNothing(p, rec, extract.libraryTimestamp)
    ) {
      plan.skip = "nothing-to-write";
      stats.skippedNothingToWrite++;
    } else {
      stats.writable++;
      // Counted here, not in the branch above, so the number an operator reads
      // before authorizing a write is the count of hand-edited rows that will
      // ACTUALLY be destroyed — the has-ports branch never runs under --force,
      // which is what used to let them be folded silently into `writable`.
      if (humanEdited) stats.forcedOverHumanEdits++;
    }
    plans.push(plan);
  }
  return { plans, stats };
}

export async function applyEnrichment(
  plans: readonly EnrichPlan[],
  opts: { commit: boolean }
): Promise<{ written: number; missing: number }> {
  if (!opts.commit) return { written: 0, missing: 0 };
  const extract = loadExtract();
  let written = 0;
  let missing = 0;
  for (const plan of plans) {
    if (plan.skip) continue;
    // The feature's hard constraint: never create a catalog row. mergeUpsert
    // creates the document when the SKU doesn't exist, so a stale plan —
    // one whose row was deleted between planning and applying — would
    // otherwise silently create a malformed row with no desc/category/unit/
    // list/cost. This is a per-plan existence check, not a scan: it never
    // calls list(), only get(sku) for the exact SKU already in hand.
    if (!(await getPart(plan.sku))) {
      missing++;
      continue;
    }
    // mergeUpsert is `{ ...existing, ...patch }` — a key absent from the patch
    // leaves the stored value, so naming only these four keys is what keeps
    // list, cost and pricedAt untouched.
    const patch: Partial<Omit<CatalogPart, "id" | "sku">> = {
      davinci: {
        typeId: plan.typeId,
        libraryTimestamp: extract.libraryTimestamp,
        enrichedAt: Date.now(),
      },
    };
    if (plan.ports.length) patch.ports = [...plan.ports];
    if (plan.docs.length) patch.docs = [...plan.docs];
    // mergeUpsert(sku, patch) — the SKU is positional, NOT a key in the patch
    // (its type is Omit<CatalogPart, "id" | "sku">). Naming only these three
    // keys is what keeps list, cost and pricedAt untouched: writePart stamps
    // pricedAt via nextPricedAt only when list or cost actually change, and
    // the merged part carries the stored values for both. `updatedAt` DOES
    // move — every write stamps it, and that is correct.
    await mergeUpsert(plan.sku, patch);
    written++;
  }
  return { written, missing };
}
