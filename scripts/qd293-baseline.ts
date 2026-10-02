/** #293 — writes the pre-change QuoteDocument render the harness compares
 *  against. Run ONCE, before quote-document.tsx is edited:
 *    npx tsx scripts/qd293-baseline.ts
 *  Pure render; opens no database. */
import { mkdirSync, writeFileSync } from "node:fs";
import { qd293Cases, renderQuoteDocument293 } from "./qd293-cases";

const out = Object.fromEntries(Object.entries(qd293Cases()).map(([k, p]) => [k, renderQuoteDocument293(p)]));
mkdirSync("docs/superpowers/fixtures", { recursive: true });
writeFileSync("docs/superpowers/fixtures/293-quote-document-baseline.json", JSON.stringify(out, null, 1) + "\n");
console.log("wrote", Object.keys(out).length, "cases");
