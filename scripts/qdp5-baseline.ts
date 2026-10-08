/** Estimator Phase 5 — writes the pre-change QuoteDocument render of quotes
 *  without a package document, which the harness compares against. Run ONCE,
 *  before quote-document.tsx is edited (it was run against afa0495e+680eba80):
 *    npx tsx scripts/qdp5-baseline.ts
 *  Pure render; opens no database. */
import { mkdirSync, writeFileSync } from "node:fs";
import { qdP5NoDocCases, renderQuoteDocument293 } from "./qd293-cases";

const out = Object.fromEntries(Object.entries(qdP5NoDocCases()).map(([k, p]) => [k, renderQuoteDocument293(p)]));
mkdirSync("docs/superpowers/fixtures", { recursive: true });
writeFileSync("docs/superpowers/fixtures/p5-quote-document-no-document.json", JSON.stringify(out, null, 1) + "\n");
console.log("wrote", Object.keys(out).length, "cases");
