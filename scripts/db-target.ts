/**
 * Shared database-target resolution for standalone scripts.
 *
 * Standalone scripts do not get Next's .env.local loading, so they do it by
 * hand. Before 2026-07-27 only inventory.ts did, which meant db:export and the
 * catalog importers silently used LOCAL PGlite while inventory reported on the
 * hosted DB. Two ways that bites: a "prod backup" that is really a dev dump,
 * and a "prod import" that really writes 14,674 rows into .data. Every script
 * that reads or writes the database now resolves its target the same way and
 * says out loud which one it got.
 *
 * Never overrides a value already in the environment, so an inline
 * DATABASE_URL=... still wins over .env.local. No secrets are printed: the
 * connection string itself is never echoed, only whether one was found.
 */
import { readFileSync } from "node:fs";

/** Load .env.local into process.env without clobbering ambient values. */
export function loadEnvLocal(file = ".env.local"): void {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = /^([A-Z_][A-Z0-9_]*)="?([^"\n]*)"?$/.exec(line.trim());
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* no .env.local: rely on the ambient environment */
  }
}

export function dbTargetLabel(): string {
  return process.env.DATABASE_URL ? "HOSTED (DATABASE_URL)" : "LOCAL PGlite (.data/pglite)";
}

/**
 * Load .env.local, then announce the resolved target. Call this first in any
 * script's main(), before getDb(): getDb reads DATABASE_URL lazily inside
 * createDb(), so loading here is early enough.
 */
export function resolveDbTarget(action: string): { hosted: boolean; label: string } {
  loadEnvLocal();
  const hosted = !!process.env.DATABASE_URL;
  const label = dbTargetLabel();
  console.log(`[db] ${action}: ${label}`);
  return { hosted, label };
}

/**
 * Gate for scripts that WRITE. A hosted write is visible to beta users the
 * moment it lands and there is no undo, so it has to be asked for explicitly.
 */
export function requireHostedConfirmation(hosted: boolean, argv: string[]): void {
  if (!hosted) return;
  if (argv.includes("--yes")) {
    console.log("[db] hosted write confirmed with --yes");
    return;
  }
  console.error(
    "\nRefusing to write to the HOSTED database without --yes.\n" +
      "Take a backup first (DATABASE_URL=... npm run db:export), then re-run with --yes.\n"
  );
  process.exit(1);
}
