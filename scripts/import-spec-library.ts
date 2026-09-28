/**
 * Spec Library import CLI (#205 follow-on, spec 2026-09-28-spec-records-
 * design.md §2, §9).
 *
 *   npx tsx scripts/import-spec-library.ts --file <path.json|path.xlsx> [--commit] [--yes]
 *
 * DRY RUN IS THE DEFAULT — prints created/updated/unchanged/archived counts,
 * every problem, and any missing sections, but writes nothing. `--commit`
 * writes through the real planner + store (upsert keyed on `specId`; a
 * record absent from the file is left alone). A hosted target additionally
 * demands `--yes` (scripts/db-target.ts) — every Vercel environment shares
 * one Neon database, so a hosted write is live to beta users immediately.
 * Take a backup first: DATABASE_URL=... npm run db:export
 *
 * Exits 1 when the plan has any blocking problem — committing is refused
 * either way (`commitSpecRecordImport` throws on a blocking plan), but the
 * exit code lets a dry run gate a script or CI step too.
 *
 * PGlite is single-process (AGENTS.md): stop `npm run dev` first when
 * pointed at the local dev datadir.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";

const args = process.argv.slice(2);
const COMMIT = args.includes("--commit");
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const FILE = flag("--file");

const USAGE = `
Usage:
  npx tsx scripts/import-spec-library.ts --file <path.json|path.xlsx> [--commit --yes]
`;

function list(label: string, items: string[]): void {
  console.log(`  ${label} (${items.length}):`);
  for (const item of items) console.log(`    - ${item}`);
}

async function main(): Promise<void> {
  if (!FILE) {
    console.error(USAGE);
    process.exit(1);
  }

  const { hosted } = resolveDbTarget("spec library import");
  if (COMMIT) requireHostedConfirmation(hosted, args);

  const filePath = path.resolve(process.cwd(), FILE!);
  const lower = filePath.toLowerCase();

  const { recordsFromJson, recordsFromSheetRows, planSpecRecordImport } = await import("@/lib/specs/record-import");

  let parsed: ReturnType<typeof recordsFromJson>;
  if (lower.endsWith(".json")) {
    const json = JSON.parse(readFileSync(filePath, "utf8"));
    parsed = recordsFromJson(json);
  } else if (lower.endsWith(".xlsx")) {
    const { readLibraryWorkbook } = await import("@/lib/specs/record-io");
    const buf = readFileSync(filePath);
    const read = await readLibraryWorkbook(buf);
    if (!read.ok) {
      console.error(`Could not read ${FILE}: ${read.error}`);
      process.exit(1);
    }
    parsed = recordsFromSheetRows(read.rows);
  } else {
    console.error(`${FILE}: choose a .json or .xlsx file.`);
    process.exit(1);
  }

  const { allSpecRecords } = await import("@/lib/stores/spec-records");
  const { allSections } = await import("@/lib/stores/spec-sections");
  const { allArticles } = await import("@/lib/stores/spec-articles");

  const [existing, sections, articles] = await Promise.all([allSpecRecords(), allSections(), allArticles()]);

  const plan = planSpecRecordImport(parsed, {
    existing,
    sections: sections.map((s) => ({ id: s.id, number: s.number })),
    articles: articles.map((a) => ({ id: a.id, sectionId: a.sectionId })),
  });

  console.log(`\nSpec Library import — ${FILE} (${COMMIT ? "COMMIT" : "DRY RUN"})`);
  console.log("=".repeat(60));
  console.log(`  created    ${plan.counts.created}`);
  console.log(`  updated    ${plan.counts.updated}`);
  console.log(`  unchanged  ${plan.counts.unchanged}`);
  console.log(`  archived   ${plan.counts.archived}`);

  if (plan.missingSections.length) {
    list("missing sections (created on commit)", plan.missingSections);
  }
  if (plan.problems.length) {
    console.log(`  problems (${plan.problems.length}):`);
    for (const p of plan.problems) {
      console.log(`    ${p.blocking ? "BLOCKING" : "warning "} ${p.specId} [${p.field}]: ${p.message}`);
    }
  }

  if (plan.blocking) {
    console.log("\nBlocking problems — refusing to commit.");
    process.exit(1);
  }

  if (!COMMIT) {
    console.log("\nDry run — nothing written. Re-run with --commit to import.");
    return;
  }

  const { commitSpecRecordImport } = await import("@/lib/specs/record-io");
  const result = await commitSpecRecordImport(plan, "Import CLI", `Import ${FILE}`);
  console.log(
    `\nCommitted: ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged, ` +
      `${result.sectionsCreated.length} section(s) created${result.sectionsCreated.length ? ` (${result.sectionsCreated.join(", ")})` : ""}.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
