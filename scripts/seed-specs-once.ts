/**
 * One-time spec seed (#205, D358) — runs in `npm run build`, right after
 * scripts/migrate.mjs and before `next build`. Loads the North HS spec
 * library (create-only) and Jeff's filled product-spec file into the
 * database once, then records it in the `spec_seed_applied` blob so every
 * later deploy logs "already applied" and does nothing.
 *
 * Same guards as scripts/migrate.mjs:
 *   - VERCEL_ENV=preview → skip. Preview shares the ONE production Neon
 *     database; only a production build may write to it.
 *   - no DATABASE_URL    → skip (a local `npm run build` never touches a DB).
 *
 * Manual runs:
 *   npm run specs:seed                  → the dev PGlite (.data/pglite, or
 *                                         PGLITE_PATH). Stop `npm run dev`
 *                                         first — PGlite is one process at a
 *                                         time (AGENTS.md).
 *   npm run specs:seed -- --force       → run again even though the flag is set.
 *
 * `--local` always means PGlite: it drops any ambient DATABASE_URL for this
 * process. This script never reads .env.local.
 *
 * ALWAYS exits 0. A data problem must never block a deploy: on a throw it
 * logs "failed — will retry on the next deploy" and the flag stays unset.
 */
import path from "node:path";
import { applySpecSeedOnce, NORTHHS_SEED_KEY } from "@/lib/specs/seed-once";

const args = process.argv.slice(2);
const local = args.includes("--local");
const force = args.includes("--force");

const SEED_DIR = path.join(process.cwd(), "docs", "specs-seed", "northhs-2026-07-30");
const BY = "Seed (North HS 2026-07-30)";

function list(label: string, items: string[]): void {
  if (!items.length) return;
  console.log(`[seed-specs]   ${label} (${items.length}):`);
  for (const item of items) console.log(`[seed-specs]     - ${item}`);
}

async function main(): Promise<void> {
  if (local) {
    delete process.env.DATABASE_URL;
  } else {
    if (process.env.VERCEL_ENV === "preview") {
      console.log("[seed-specs] preview deployment — skipping (preview shares the production database).");
      return;
    }
    if (!process.env.DATABASE_URL) {
      console.log("[seed-specs] no DATABASE_URL — skipping (use `npm run specs:seed` for the local PGlite).");
      return;
    }
  }
  const target = local ? `local PGlite (${process.env.PGLITE_PATH || ".data/pglite"})` : "DATABASE_URL";
  console.log(`[seed-specs] ${NORTHHS_SEED_KEY} → ${target}${force ? " (--force)" : ""}`);

  const res = await applySpecSeedOnce({
    libraryPath: path.join(SEED_DIR, "spec-library.json"),
    productsPath: path.join(SEED_DIR, "product-specs-filled.xlsx"),
    by: BY,
    force,
  });
  if (res.status === "skipped") {
    console.log(`[seed-specs] ${res.reason} — nothing to do.`);
    return;
  }
  const p = res.products;
  console.log(`[seed-specs] library: ${res.library.created} created, ${res.library.kept} kept (already there)`);
  console.log(
    `[seed-specs] product specs: ${p.written} written (${p.sameAs} same-as), ${p.unchanged} unchanged, ` +
      `${p.skippedExisting} skipped (text from elsewhere)`
  );
  list("MFR # not found", p.notFound);
  list("MFR # ambiguous", p.ambiguous);
  list("MFR # already claimed by an earlier row", p.claimed);
  list("errors", p.errors);
  console.log("[seed-specs] done — recorded, later deploys skip this.");
}

// A hung connection must not hold a deploy hostage either: give up after
// four minutes the same way as a throw (both phases are safe to repeat).
setTimeout(() => {
  console.log("[seed-specs] failed — will retry on the next deploy: timed out after 4 minutes");
  process.exit(0);
}, 4 * 60_000).unref();

main()
  .catch((e: unknown) => {
    console.log(`[seed-specs] failed — will retry on the next deploy: ${e instanceof Error ? e.message : String(e)}`);
  })
  // Ends the process (and with it the postgres-js pool / PGlite handle) the
  // same way every other tsx script here does; exit 0 either way.
  .finally(() => process.exit(0));
