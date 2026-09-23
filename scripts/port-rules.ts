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

/** One line describing a proposed port set — shared by the report's single-
 *  shape and multi-shape renderings so the two can never drift apart. */
const renderPorts = (ports: readonly { name: string; direction: string; connectionType: string; count?: number }[]) =>
  ports.map((p) => `${p.name} [${p.direction}${p.count ? ` ×${p.count}` : ""}: ${p.connectionType}]`).join("; ") || "(none)";

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
    // --mfr= narrows the apply exactly as it narrows the report (gate review
    // FIX 4). It used to be parsed and then ignored here, so
    // `--mfr=EAW --apply --commit` reported one brand and wrote every brand —
    // the same report-vs-apply divergence D200 was opened to close.
    const out = await applyRules(ids, { commit, mfr: only || undefined });
    console.log(`\n${commit ? "APPLIED" : "DRY RUN"} — rules: ${ids.join(", ")}${only ? `  ·  --mfr=${only}` : ""}`);
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
  const accessoryRows: Row[] = [];
  let alreadyPorted = 0, noDesc = 0;

  for (const part of parts) {
    if (part.hasPorts) { alreadyPorted++; continue; }
    if (isModelish(part.desc, part.sku)) { noDesc++; continue; }
    const rule = matchRule(part);
    if (!rule) { unmatched.push(part); continue; }
    if (rule.accessory) { accessoryRows.push(part); continue; }
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

    // A rule's shape() reads the part it is applied to — channel counts,
    // HDMI vs SDI, in/out counts — so ONE rule routinely proposes several
    // different shapes across its matches (amplifier: 9, av-matrix: 8,
    // camera-ptz: 2). Printing only hits[0]'s shape showed `camera-ptz` as
    // SDI/BNC when half its rows get HDMI, so approving the rule would have
    // written a connector the reviewer was never shown — the exact promise
    // this report exists to keep. Every distinct shape is listed, with its
    // count, largest first.
    const shapes = new Map<string, { count: number; sample: Row }>();
    for (const h of hits) {
      const key = renderPorts(proposeForPart(h)?.ports || []);
      const seen = shapes.get(key);
      if (seen) seen.count++;
      else shapes.set(key, { count: 1, sample: h });
    }
    const byCount = [...shapes].sort((a, b) => b[1].count - a[1].count);

    console.log(`\n${rule.id}${rule.mfr ? `  ·  ${rule.mfr}` : ""}`);
    if (byCount.length === 1) {
      console.log(`  proposes: ${byCount[0][0]}`);
    } else {
      console.log(`  proposes ${byCount.length} DIFFERENT shapes across its ${n(hits.length)} matches — approve all of them, not the first:`);
      for (const [shape, { count, sample }] of byCount) {
        console.log(`    ${String(count).padStart(5)} ×  ${shape}`);
        console.log(`            e.g. ${sample.sku} — ${sample.desc.slice(0, 54)}`);
      }
    }
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
  console.log(`  accessories (no ports, ok)   ${n(accessoryRows.length)}`);
  console.log(`  matched by a rule            ${n([...matchedBy.values()].reduce((a, l) => a + l.length, 0))}`);
  console.log(`  matched by NOTHING           ${n(unmatched.length)}`);

  // Known gaps (review, D200): rules or buckets that are wrong or risky but
  // are being left for a human decision — surfaced here so a human reading
  // THIS report sees them, not the next person who discovers one in a live
  // quote. Factual, not exhaustive.
  //
  // Gate review FIX 5: these used to be hardcoded prose, and had already
  // drifted — the dsp figures read "57 rows ... 46 of its rows are
  // amplifiers" against a measured 38 and 26. Every number below is now
  // counted from THIS run, so the report cannot lie about itself again; only
  // the judgement (which rows are wrong, and why) is static text.
  const dspHits = matchedBy.get("dsp") || [];
  const DSP_AMP_BRANDS = ["Powersoft", "1Sound"];
  const dspAmpModules = dspHits.filter((h) => DSP_AMP_BRANDS.includes(h.mfr || "")).length;
  const RACKKIT_SKUS = ["Lab Gruppen:LAB-LUCIA-RACKKIT", "RCF:13360426"];
  const rackKits = (matchedBy.get("amplifier") || []).filter((h) => RACKKIT_SKUS.includes(h.sku));
  const FIBRE_KIT_SKUS = ["AVPro Edge:AC-EXO-444-KIT", "AVPro Edge:AC-EXO-X-KIT"];
  const fibreKits = unmatched.filter((h) => FIBRE_KIT_SKUS.includes(h.sku));
  const fmPlus = accessoryRows.filter((h) => /\bFM\s*Plus\b/i.test(h.desc)).length;
  const eawCw = accessoryRows.filter((h) => /\bc\/w\b/i.test(h.desc)).length;
  const scoped = only ? `  (counted within --mfr=${only})` : "";

  console.log("\n" + "=".repeat(72));
  console.log(`  Known gaps — read before approving any rule above${scoped}`);
  console.log(`  - dsp matched ${n(dspHits.length)} rows, of which ${n(dspAmpModules)} are ${DSP_AMP_BRANDS.join("/")} AMPLIFIER`);
  console.log("    MODULES that merely carry onboard DSP (e.g. Powersoft:X4 \"X4 DSP+D\",");
  console.log("    1Sound:1SPS-U4L12K4 \"4 channel (3000w per channel @2Ω) with DSP\") — they");
  console.log("    are amplifiers, not DSPs, and would get a DSP's analog-I/O shape. Do not");
  console.log("    approve dsp without checking those rows.");
  if (rackKits.length) {
    console.log(`  - ${n(rackKits.length)} rack/mount kit(s) still reach the amplifier rule instead of the`);
    console.log(`    accessory layer: ${rackKits.map((h) => h.sku).join(", ")}`);
    console.log("    (\"Rackmount Kit for ... Amplifiers\") — they would get Line In + speakON");
    console.log("    NL4 out. The accessory noun list has \"rack ?ear\" and \"\\bmount\\b\", neither");
    console.log("    of which matches the single word \"Rackmount\".");
  }
  console.log(`  - Real devices still land in the accessory bucket (${n(accessoryRows.length)} rows total, most`);
  console.log(`    of them correctly). Two known causes, counted: rows whose description`);
  console.log(`    says \"c/w\" — ${n(eawCw)} (e.g. EAW:2072205-90, \"...Installation Amplifier c/w`);
  console.log(`    Rack Mount Kit\"; \"c/w\" is not a recognized bundling word) — and Williams`);
  console.log(`    AV \"FM Plus\" systems — ${n(fmPlus)} (the brand name itself contains \"plus\",`);
  console.log("    which IS a bundling word).");
  if (fibreKits.length) {
    console.log(`  - ${n(fibreKits.length)} fibre extender kit(s) unmatched — no fibre port shape exists:`);
    console.log(`    ${fibreKits.map((h) => h.sku).join(", ")}`);
  }

  console.log(`\n  To apply: npm run ports:rules -- --apply --rules <id,id> --commit`);
  console.log(`  (a hosted DATABASE_URL target also needs --yes)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
