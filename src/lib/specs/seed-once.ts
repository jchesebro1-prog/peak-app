import { readFile } from "node:fs/promises";
import path from "node:path";
import { getBlob, setBlob } from "@/db/doc-store";
import { importLibrary, parseLibraryFile } from "@/lib/specs/library-io";
import { planProductSpecImport, readProductSpecRows } from "@/lib/specs/product-spec-import";
import { applyProductSpecPlan, readSpecSheets } from "@/lib/specs/product-spec-io";
import { list as listCatalog } from "@/lib/stores/catalog";
import { allArticles } from "@/lib/stores/spec-articles";

/**
 * One-time spec seed (#205, D358): the North HS spec library and Jeff's
 * filled product-spec file land in a database once — during the production
 * build, after migrations (scripts/seed-specs-once.ts) — and never again.
 *
 * - Library: create-only (`importLibrary(..., { onlyNew: true })`). A
 *   section/article/template someone already has — edited, or deleted — is
 *   left alone.
 * - Product specs: exactly the Import product specs pipeline, with
 *   "Replace existing" off. Never creates a part; text that came from
 *   anywhere else is protected by the pipeline's own rules.
 * - Once-only: a flag per key in the `spec_seed_applied` blob, written only
 *   after BOTH phases finish. A throw leaves it unset, so the next deploy
 *   retries (both phases are safe to repeat).
 *
 * SERVER-ONLY (fs, exceljs, the database driver) — scripts and server code
 * only, never a "use client" module.
 */

export const NORTHHS_SEED_KEY = "seed:northhs-2026-07-30";
export const SPEC_SEED_BLOB = "spec_seed_applied";

export type SpecSeedFlag = { at: number; by: string };

export type SeedOnceResult =
  | { status: "skipped"; reason: string }
  | {
      status: "applied";
      library: { created: number; kept: number };
      products: {
        written: number;
        sameAs: number;
        unchanged: number;
        skippedExisting: number;
        notFound: string[];
        ambiguous: string[];
        claimed: string[];
        errors: string[];
      };
    };

/** The flag for `key`, or null. A key set to null counts as not applied. */
export async function specSeedFlag(key: string): Promise<SpecSeedFlag | null> {
  const blob = await getBlob<Record<string, unknown>>(SPEC_SEED_BLOB, {});
  const v = blob[key] as Partial<SpecSeedFlag> | null | undefined;
  return v && typeof v === "object" && Number(v.at) ? { at: Number(v.at), by: String(v.by || "") } : null;
}

export async function applySpecSeedOnce(opts: {
  libraryPath: string;
  productsPath: string;
  by: string;
  key?: string;
  force?: boolean;
}): Promise<SeedOnceResult> {
  const key = opts.key || NORTHHS_SEED_KEY;
  const flag = await specSeedFlag(key);
  if (flag && !opts.force) {
    return {
      status: "skipped",
      reason: `already applied ${new Date(flag.at).toISOString().slice(0, 10)}${flag.by ? ` by ${flag.by}` : ""}`,
    };
  }

  // Library first — the product rows point at its articles.
  const { file, error } = parseLibraryFile(await readFile(opts.libraryPath, "utf8"));
  if (!file) throw new Error(`${path.basename(opts.libraryPath)}: ${error}`);
  const lib = await importLibrary(file, opts.by, { onlyNew: true });
  const created = lib.sections + lib.articles + lib.templates + lib.curtainTemplates;

  // Product specs — the Import product specs pipeline, "Replace existing" off.
  const buf = await readFile(opts.productsPath);
  const read = await readSpecSheets(buf, path.basename(opts.productsPath));
  if (!read.ok) throw new Error(`${path.basename(opts.productsPath)}: ${read.error}`);
  const { rows, error: rowsError } = readProductSpecRows(read.sheets);
  if (rowsError) throw new Error(`${path.basename(opts.productsPath)}: ${rowsError}`);
  const plan = planProductSpecImport({
    rows,
    parts: await listCatalog(),
    articles: await allArticles(),
    replaceExisting: false,
  });
  const applied = await applyProductSpecPlan(plan, opts.by);

  const notFound: string[] = [];
  const ambiguous: string[] = [];
  const claimed: string[] = [];
  const errors: string[] = [];
  for (const r of plan.rows) {
    const id = r.specId || `${r.sheet} row ${r.line}`;
    if (r.status === "error") errors.push(`${id}: ${r.error}`);
    for (const t of r.tokens) {
      if (t.status === "not-found") notFound.push(`${id}: ${t.token}`);
      else if (t.status === "ambiguous") {
        const more = t.total > t.candidates.length ? ` (+${t.total - t.candidates.length} more)` : "";
        ambiguous.push(`${id}: ${t.token} → ${t.candidates.join(", ")}${more}`);
      } else if (t.status === "claimed") claimed.push(`${id}: ${t.token} → ${t.sku} (already taken by ${t.bySpecId})`);
    }
  }
  for (const e of applied.errors) errors.push(`${e.sku}: ${e.error}`);

  await setBlob(SPEC_SEED_BLOB, { [key]: { at: Date.now(), by: opts.by } satisfies SpecSeedFlag });

  return {
    status: "applied",
    library: { created, kept: lib.kept },
    products: {
      written: applied.written,
      sameAs: applied.sameAs,
      unchanged: plan.counts.unchanged,
      skippedExisting: plan.counts.skippedExisting,
      notFound,
      ambiguous,
      claimed,
      errors,
    },
  };
}
