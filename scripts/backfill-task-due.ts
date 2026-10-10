/**
 * One-time due-date backfill — spec 2026-10-09 auto task calendar, Part 1.
 *
 *   DATABASE_URL=... npm run tasks:backfill-due                  → dry run: counts per person (+ open In-progress counts)
 *   DATABASE_URL=... npm run tasks:backfill-due -- --apply --yes → write (hosted needs --yes)
 *   PGLITE_PATH=<scratch dir> npm run tasks:backfill-due          → a local copy
 *
 * Idempotent: a second run finds nothing. The target must be named explicitly
 * (never .data/pglite while `next dev` holds it — single-process). Hosted:
 * back up first (npm run db:export).
 */
import { requireHostedConfirmation, resolveExplicitDbTarget } from "./db-target";
import { runDueBackfill } from "../src/lib/task-plan/backfill";

const args = process.argv.slice(2);

async function main(): Promise<void> {
  const apply = args.includes("--apply");
  const target = resolveExplicitDbTarget(apply ? "tasks:backfill-due --apply" : "tasks:backfill-due (dry run)");
  if (!target) {
    console.error("\nRefusing to run without an explicit database target.\nSet DATABASE_URL (hosted) or PGLITE_PATH (a local PGlite directory) for this command.\n");
    process.exit(1);
  }
  if (apply) requireHostedConfirmation(target.hosted, args);
  const r = await runDueBackfill({ apply });
  for (const p of r.plan.perPerson) console.log(`  ${p.name}: ${p.count} item(s), due ${p.firstDay} → ${p.lastDay}`);
  if (r.inProgress.length) {
    console.log(`\nOpen In-progress tasks (each locks its first block on its owner's first /calendar or Home view):`);
    for (const p of r.inProgress) console.log(`  ${p.name}: ${p.count}`);
  }
  if (r.skipped.length) {
    console.log(`\nSkipped ${r.skipped.length} item(s) (assignee not on the active roster):`);
    for (const k of r.skipped) console.log(`  ${k.kind} ${k.id} - ${k.assignee || "(no name)"} - ${k.reason}`);
  }
  console.log(
    apply
      ? `\nApplied: ${r.updated} of ${r.planned} due date(s) written.`
      : `\nDry run: ${r.planned} item(s) would get a due date. Re-run with --apply to write.`
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
