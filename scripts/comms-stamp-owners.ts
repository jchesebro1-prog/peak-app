/**
 * #349 — one-time, idempotent stamp of `mailboxOwnerId` on every older
 * personal-mailbox email thread (src/lib/comms-owner-stamp.ts).
 *
 *   DATABASE_URL=... npm run comms:stamp-owners                  → dry run, writes nothing
 *   DATABASE_URL=... npm run comms:stamp-owners -- --apply --yes → write (hosted needs --yes)
 *   PGLITE_PATH=<scratch dir> npm run comms:stamp-owners          → a local copy
 *
 * The target must be named explicitly — DATABASE_URL or PGLITE_PATH in the
 * environment of this command. It never falls back to .env.local or the dev
 * database (.data/pglite is single-process; never run this while `next dev`
 * holds it), and with only PGLITE_PATH set a DATABASE_URL from .env.local is
 * ignored. Back up first: `DATABASE_URL=... npm run db:export`.
 *
 * A thread is stamped only when exactly one user already owns it by the app's
 * own rule (its Gmail account key, else a name exactly one user — any status —
 * holds). A thread whose name two or more users hold is TOMBSTONED with
 * --apply (#349 review: `mailboxOwnerId = "unresolved"` — owned by nobody for
 * good, so renaming the duplicates afterwards never hands it to anyone). An
 * unknown or blank name is only listed (a new hire's name is retired when they
 * are added). Run this BEFORE renaming duplicate teammates. The app is safe
 * before it runs: ownership already resolves the same way lazily.
 */
import { requireHostedConfirmation, resolveExplicitDbTarget } from "./db-target";
import { applyOwnerStamps, loadOwnerStampPlan, tombstoneStamps } from "../src/lib/comms-owner-stamp";
import { allUsers } from "../src/lib/users";

const args = process.argv.slice(2);

async function main(): Promise<void> {
  const unknown = args.filter((a) => a !== "--apply" && a !== "--yes");
  if (unknown.length) {
    console.error(`\n  Unknown argument(s): ${unknown.join(" ")}. Use --apply (and --yes for a hosted database).\n`);
    process.exit(1);
  }
  const apply = args.includes("--apply");
  // Explicit target only: checked BEFORE .env.local is read, so a forgotten
  // .env.local value can never pick the database for a write.
  const target = resolveExplicitDbTarget(apply ? "comms:stamp-owners --apply" : "comms:stamp-owners (dry run)");
  if (!target) {
    console.error(
      "\nRefusing to run without an explicit database target.\n" +
        "Set DATABASE_URL (hosted) or PGLITE_PATH (a local PGlite directory) for this command.\n"
    );
    process.exit(1);
  }
  if (apply) requireHostedConfirmation(target.hosted, args);

  const roster = (await allUsers()).map((u) => ({ id: u.id, name: u.name }));
  const plan = await loadOwnerStampPlan(roster);
  const byKey = plan.stamps.filter((s) => s.how === "key").length;
  const byName = plan.stamps.length - byKey;

  for (const u of plan.unresolved) {
    const why =
      u.reason === "no-name" ? "no owner name" : u.reason === "shared-name" ? "name held by more than one user" : "no user has exactly this name";
    console.log(`  unresolved  ${u.id}  "${u.mailboxUser}"  — ${why}`);
  }

  const tombs = tombstoneStamps(plan);
  let line =
    `${plan.candidates} unstamped personal thread(s): ${plan.stamps.length} resolvable (${byKey} by Gmail key, ${byName} by unique name), ` +
    `${plan.unresolved.length} unresolved (${tombs.length} on a shared name ${apply ? "→ tombstoned" : "→ would be tombstoned (owned by nobody)"})` +
    (plan.tombstoned ? `; ${plan.tombstoned} already tombstoned` : "");
  if (apply) {
    const r = await applyOwnerStamps(plan.stamps);
    const t = await applyOwnerStamps(tombs);
    line += `; stamped ${r.stamped}, tombstoned ${t.stamped}` + (r.raced + t.raced ? `, ${r.raced + t.raced} changed meanwhile (left alone)` : "");
  }
  console.log(`\n${apply ? "Applied" : "Dry run"}: ${line}.`);
  if (!apply && (plan.stamps.length || tombs.length))
    console.log("Nothing was written. Review the unresolved list above (shared names include archived users), then re-run with --apply (and --yes for a hosted database) BEFORE renaming any duplicate teammates.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
