/** Estimator Phase 2b — writes the pre-change QuoteDocument render of quotes
 *  without alternates, which the harness compares against. Run ONCE, before
 *  quote-document.tsx is edited:
 *    npx tsx scripts/qdp2b-baseline.ts
 *  Pure render; opens no database. */
import { mkdirSync, writeFileSync } from "node:fs";
import { qdP2bNoAltCases, renderQuoteDocument293 } from "./qd293-cases";

const out = Object.fromEntries(Object.entries(qdP2bNoAltCases()).map(([k, p]) => [k, renderQuoteDocument293(p)]));
mkdirSync("docs/superpowers/fixtures", { recursive: true });
writeFileSync("docs/superpowers/fixtures/p2b-quote-document-no-alternates.json", JSON.stringify(out, null, 1) + "\n");
console.log("wrote", Object.keys(out).length, "cases");
