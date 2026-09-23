/**
 * Port rules — report what each rule would do, and apply named rules (#159).
 *
 *   npm run ports:rules                                        → the report, writes nothing
 *   npm run ports:rules -- --mfr=EAW                            → one manufacturer
 *   npm run ports:rules -- --apply --rules <id,id>                     → dry run, writes nothing
 *   npm run ports:rules -- --apply --rules <id,id> --commit             → write (hosted target also needs --yes)
 *
 * The report IS the review artifact (D193): Jeff reads the rules, not the
 * parts, and replies with the ids to apply. DRY RUN IS THE DEFAULT for
 * --apply: `--commit` triggers the write, and a hosted target additionally
 * demands `--yes` (scripts/db-target.ts) — the same two-flag convention
 * every other writing script in this repo uses (see
 * scripts/enrich-addresses.ts). Preview and production share one Neon
 * database, so the two are kept deliberately separate: one flag says "I want
 * to write", the other says "I know this is the live database."
 */
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { PORT_RULES, matchRule, proposeForPart, type RulePart } from "../src/lib/catalog-port-rules";
import { applyRules, isModelish } from "../src/lib/catalog-port-apply";

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith("--mfr=")) || "").slice(6);
/** Brands whose descriptions are bare part numbers — reported, never guessed (D192). */
const NO_DESC_BRANDS = ["Biamp", "JBL"];
const n = (x: number) => x.toLocaleString("en-US");

async function main() {
  if (args.includes("--apply")) {
    const idsArg = (args.find((a) => a.startsWith("--rules=")) || "").slice(8)
      || args[args.indexOf("--rules") + 1] || "";
    const ids = idsArg.split(",").map((s) => s.trim()).filter(Boolean);
    if (!ids.length) {
      console.error("--apply needs --rules <id,id>. Nothing applies by default. Add --commit to write (a hosted target also needs --yes).");
      process.exit(1);
    }
    const unknown = ids.filter((id) => !PORT_RULES.some((r) => r.id === id));
    if (unknown.length) {
      console.error(`Unknown rule id(s): ${unknown.join(", ")}`);
      process.exit(1);
    }
    const commit = args.includes("--commit");
    const { hosted } = resolveDbTarget("port rules apply");
    if (commit) requireHostedConfirmation(hosted, args);
    const out = await applyRules(ids, { commit });
    console.log(`\n${commit ? "APPLIED" : "DRY RUN"} — rules: ${ids.join(", ")}`);
    for (const [id, count] of Object.entries(out.byRule)) console.log(`  ${String(count).padStart(6)}  ${id}`);
    console.log(`  ${String(out.applied).padStart(6)}  total ${commit ? "written" : "would be written"}`);
    console.log(`  ${String(out.skippedHasPorts).padStart(6)}  skipped — already have ports (hand edits win)`);
    if (!commit) console.log("\n  DRY RUN — nothing written. Add --commit to apply (a hosted target also needs --yes).");
    process.exit(0);
  }

  resolveDbTarget("port rules report");
  const { getDb } = await import("../src/db");
  const { catalogParts } = await import("../src/db/doc-tables");
  const db = await getDb();
  const rows = await db.select().from(catalogParts);

  type Row = RulePart & { hasPorts: boolean };
  const parts: Row[] = [];
  for (const r of rows) {
    if ((r as { deleted?: boolean }).deleted) continue;
    const d = r.doc as Record<string, unknown>;
    const mfr = String(d.mfr || "");
    if (only && mfr !== only) continue;
    const ports = d.ports as unknown[] | undefined;
    parts.push({
      sku: String(d.sku || ""), desc: String(d.desc || ""),
      category: String(d.category || ""), mfr,
      hasPorts: Array.isArray(ports) && ports.length > 0,
    });
  }

  const matchedBy = new Map<string, Row[]>();
  const unmatched: Row[] = [];
  let accessories = 0, alreadyPorted = 0, noDesc = 0;

  for (const part of parts) {
    if (part.hasPorts) { alreadyPorted++; continue; }
    if (isModelish(part.desc, part.sku)) { noDesc++; continue; }
    const rule = matchRule(part);
    if (!rule) { unmatched.push(part); continue; }
    if (rule.accessory) { accessories++; continue; }
    const list = matchedBy.get(rule.id) || [];
    list.push(part);
    matchedBy.set(rule.id, list);
  }

  // Denominator for the over-broad guard: inferable parts per manufacturer —
  // excluding accessories and description-less rows, so the ratio measures
  // what it sounds like.
  const inferablePerMfr = new Map<string, number>();
  for (const part of parts) {
    if (part.hasPorts || isModelish(part.desc, part.sku)) continue;
    const rule = matchRule(part);
    if (rule?.accessory) continue;
    inferablePerMfr.set(part.mfr || "", (inferablePerMfr.get(part.mfr || "") || 0) + 1);
  }

  console.log("\nPort rules — proposal report (nothing is written)");
  console.log("=".repeat(72));

  for (const rule of PORT_RULES) {
    if (rule.accessory) continue;
    const hits = matchedBy.get(rule.id) || [];
    if (!hits.length) { console.log(`\n${rule.id}\n  matches nothing`); continue; }
    const sample = hits[0];
    const ports = proposeForPart(sample)?.ports || [];
    console.log(`\n${rule.id}${rule.mfr ? `  ·  ${rule.mfr}` : ""}`);
    console.log(`  proposes: ${ports.map((p) => `${p.name} [${p.direction}${p.count ? ` ×${p.count}` : ""}: ${p.connectionType}]`).join("; ") || "(none)"}`);
    console.log(`  note: ${rule.note}`);
    console.log(`  matches ${n(hits.length)} parts, e.g.`);
    for (const h of hits.slice(0, 4)) console.log(`    ${h.sku.padEnd(26)} ${h.desc.slice(0, 60)}`);

    // Over-broad guard: one greedy regex quietly mislabelling hundreds of
    // parts is this engine's worst failure mode, and a match count is the
    // cheapest detector. A warning, not a refusal.
    for (const [mfr, total] of inferablePerMfr) {
      const share = hits.filter((h) => h.mfr === mfr).length / total;
      if (total >= 20 && share > 0.4)
        console.log(`  ⚠ OVER-BROAD: matches ${Math.round(share * 100)}% of ${mfr}'s inferable parts — check the pattern`);
    }
  }

  console.log("\n" + "=".repeat(72));
  console.log(`  parts considered            ${n(parts.length)}`);
  console.log(`  already have ports (skipped) ${n(alreadyPorted)}`);
  console.log(`  no usable description        ${n(noDesc)}   <- ${NO_DESC_BRANDS.join(" / ")} and similar (D192)`);
  console.log(`  accessories (no ports, ok)   ${n(accessories)}`);
  console.log(`  matched by a rule            ${n([...matchedBy.values()].reduce((a, l) => a + l.length, 0))}`);
  console.log(`  matched by NOTHING           ${n(unmatched.length)}`);

  // Known gaps (review, D200): rules or buckets that are wrong or risky but
  // are being left for a human decision — surfaced here so a human reading
  // THIS report sees them, not the next person who discovers one in a live
  // quote. Factual, not exhaustive.
  console.log("\n" + "=".repeat(72));
  console.log("  Known gaps — read before approving any rule above");
  console.log("  - dsp proposes ports for Powersoft/1Sound AMPLIFIER MODULES that carry");
  console.log("    onboard DSP (e.g. Powersoft:X4 \"X4 DSP+D\", 1Sound:1SPS-U4L12K4 \"4");
  console.log("    channel (3000w per channel @2Ω) with DSP\") — 46 of its rows are");
  console.log("    amplifiers, not DSPs. Do not approve dsp without checking those rows.");
  console.log("  - A few rack/mount kits still reach device rules: Lab Gruppen:LAB-LUCIA-");
  console.log("    RACKKIT and RCF:13360426 (\"Rackmount Kit for ... Amplifiers\") match");
  console.log("    amplifier and would get Line In + 4x speakON NL4 out. The accessory");
  console.log("    noun list has \"rack ?ear\" and \"\\bmount\\b\", neither matches the single");
  console.log("    word \"Rackmount\".");
  console.log("  - ~20 real devices still land in the accessory bucket, including");
  console.log("    EAW:2072205-90 (\"...Installation Amplifier c/w Rack Mount Kit\" — \"c/w\"");
  console.log("    is not a bundling word) and 13 Williams AV \"FM Plus\" systems (the");
  console.log("    brand name contains \"plus\", which IS a bundling word).");
  console.log("  - 3 fibre extender kits (AVPro Edge AC-EXO-444-KIT, AC-EXO-X-KIT,");
  console.log("    AC-MXNET-POE-PSU24) are unmatched — no fibre port shape exists.");

  console.log(`\n  To apply: npm run ports:rules -- --apply --rules <id,id> --commit`);
  console.log(`  (a hosted DATABASE_URL target also needs --yes)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
