/** #364 — writes the pre-change BOM-view render (qd364BomCases with no Show on
 *  BOM switches set), which the harness compares against. Run ONCE, before
 *  quote-document.tsx / quote-document-view.ts were edited (run against
 *  origin/main 0c9586d5):
 *    npx tsx scripts/qd364-baseline.ts
 *  Pure render; opens no database. */
import { mkdirSync, writeFileSync } from "node:fs";
import { renderQuoteDocument293 } from "./qd293-cases";
import { qd364BomCases } from "./qd364-cases";

const out = Object.fromEntries(Object.entries(qd364BomCases()).map(([k, p]) => [k, renderQuoteDocument293(p)]));
mkdirSync("docs/superpowers/fixtures", { recursive: true });
writeFileSync("docs/superpowers/fixtures/364-bom-view-baseline.json", JSON.stringify(out, null, 1) + "\n");
console.log("wrote", Object.keys(out).length, "cases");
