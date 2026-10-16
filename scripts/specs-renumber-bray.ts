/**
 * Oct 15 #47 — renumber the Spec Library to Bray Associates' table of contents.
 *
 *   PGLITE_PATH=<scratch dir> npm run specs:renumber-bray                 → dry run on a local copy, writes nothing
 *   DATABASE_URL=... npm run specs:renumber-bray                          → dry run against production
 *   DATABASE_URL=... npm run specs:renumber-bray -- --apply --yes         → write (hosted needs --yes; back up first)
 *   ... -- --map docs/specs-seed/<other>.json                             → a map other than the default
 *
 * The map (default docs/specs-seed/bray-toc-map.json) is Jeff's to supply:
 *
 *   { "source": "Fall Creek HS, Bray 3748, Project Manual 00 01 10, 2026-10-14",
 *     "confirmed": true,
 *     "sections": [ { "from": "11 61 23", "to": "11 06 10", "title": "Stage Rigging and Curtains" }, … ] }
 *
 * A map without "confirmed": true is refused, so a draft can sit in the repo
 * without ever being applied. The plan (src/lib/specs/bray-renumber.ts)
 * renumbers each mapped section (updateSection, title too when given) and every
 * Spec Library record in it (saveSpecRecord — each appends a revision, history
 * is never rewritten). Record ids, section ids, article links and saved project
 * specs are left alone. Idempotent: a second run plans nothing.
 *
 * The target must be named explicitly — DATABASE_URL or PGLITE_PATH in this
 * command's own environment (never .env.local, never the dev database while
 * `next dev` holds it).
 */
import { readFileSync } from "node:fs";
import { requireHostedConfirmation, resolveExplicitDbTarget } from "./db-target";
import { parseBrayMap, planRenumber, renumberWhy } from "../src/lib/specs/bray-renumber";

const args = process.argv.slice(2);
const BY = "specs:renumber-bray";
const DEFAULT_MAP = "docs/specs-seed/bray-toc-map.json";

async function main(): Promise<void> {
  const apply = args.includes("--apply");
  const mi = args.indexOf("--map");
  const mapPath = mi >= 0 ? args[mi + 1] : DEFAULT_MAP;
  if (!mapPath) {
    console.error("\n  --map needs a file path.\n");
    process.exit(1);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(mapPath, "utf8"));
  } catch (e) {
    console.error(`\n  Couldn't read the map ${mapPath}: ${(e as Error).message}\n  Jeff supplies it from Bray's project-manual TOC — see this script's header.\n`);
    process.exit(1);
  }
  const parsed = parseBrayMap(raw);
  if (!parsed.ok) {
    console.error(`\n  The map ${mapPath} can't be used:\n${parsed.errors.map((e) => "    - " + e).join("\n")}\n`);
    process.exit(1);
  }
  const target = resolveExplicitDbTarget(apply ? "specs:renumber-bray --apply" : "specs:renumber-bray (dry run)");
  if (!target) {
    console.error("\nRefusing to run without an explicit database target.\nSet DATABASE_URL (hosted) or PGLITE_PATH (a local PGlite directory) for this command.\n");
    process.exit(1);
  }
  if (apply) requireHostedConfirmation(target.hosted, args);

  // Imported after the target is resolved: the stores open the database lazily.
  const { allSections, updateSection } = await import("../src/lib/stores/spec-sections");
  const { allSpecRecords, getSpecRecord, saveSpecRecord } = await import("../src/lib/stores/spec-records");
  const [sections, records] = await Promise.all([allSections(), allSpecRecords()]);
  const planned = planRenumber(parsed.map, sections, records);
  if (!planned.ok) {
    console.error(`\n  Nothing written — the map collides with the library:\n${planned.errors.map((e) => "    - " + e).join("\n")}\n`);
    process.exit(1);
  }
  const { plan } = planned;
  console.log(`\n  Map: ${mapPath} — ${parsed.map.source}`);
  for (const s of plan.sections) console.log(`  section  ${s.from} ${s.titleFrom}  →  ${s.to} ${s.titleTo}`);
  for (const r of plan.records) console.log(`  record   ${r.specId}  ${r.from} → ${r.to}`);
  for (const a of plan.already) console.log(`  already  ${a}`);
  for (const n of plan.notFound) console.log(`  absent   ${n} (no section or record has it)`);

  let sectionsDone = 0, recordsDone = 0;
  if (apply) {
    for (const s of plan.sections) {
      await updateSection(s.id, { number: s.to, title: s.titleTo }, BY);
      sectionsDone++;
    }
    for (const r of plan.records) {
      const cur = await getSpecRecord(r.specId);
      if (!cur) continue;
      const res = await saveSpecRecord({ ...cur, section: r.to }, BY, renumberWhy(r.from, parsed.map.source));
      if (res.outcome !== "unchanged") recordsDone++;
    }
  }
  console.log(
    `\n${apply ? "Applied" : "Dry run"}: ${plan.sections.length} section(s), ${plan.records.length} record(s) ${apply ? "renumbered" : "would be renumbered"}` +
      (apply ? ` (${sectionsDone} sections, ${recordsDone} records written; each record keeps its old version as a revision)` : "") +
      (plan.already.length ? `; ${plan.already.length} already done` : "") +
      (plan.notFound.length ? `; ${plan.notFound.length} not in the library` : "") +
      ".\n"
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
