/**
 * Port rules — report what each rule would do (#159).
 *
 *   npm run ports:rules                      → the report, writes nothing
 *   npm run ports:rules -- --mfr=EAW         → one manufacturer
 *
 * The report IS the review artifact (D193): Jeff reads the rules, not the
 * parts, and replies with the ids to apply. Task 5 adds the apply path.
 */
import { resolveDbTarget } from "./db-target";
import { PORT_RULES, matchRule, proposeForPart, type RulePart } from "../src/lib/catalog-port-rules";

const args = process.argv.slice(2);
const only = (args.find((a) => a.startsWith("--mfr=")) || "").slice(6);
/** Brands whose descriptions are bare part numbers — reported, never guessed (D192). */
const NO_DESC_BRANDS = ["Biamp", "JBL"];
/** A description that is really a model/part number, not prose. */
function isModelish(desc: string, sku: string): boolean {
  const d = (desc || "").trim();
  if (!d) return true;
  if (!/\s/.test(d)) return true;
  if (/^[\d.\-]+$/.test(d)) return true;
  const bare = sku.includes(":") ? sku.slice(sku.indexOf(":") + 1) : sku;
  return d.replace(/[^a-z0-9]/gi, "").toUpperCase() === bare.replace(/[^a-z0-9]/gi, "").toUpperCase();
}
const n = (x: number) => x.toLocaleString("en-US");

async function main() {
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
  console.log(`\n  To apply: npm run ports:rules -- --apply --rules <id,id> --yes`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
