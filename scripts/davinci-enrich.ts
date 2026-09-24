import { readFile } from "node:fs/promises";
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { planEnrichment, applyEnrichment } from "@/lib/catalog-davinci-apply";

async function main() {
  const args = process.argv.slice(2);
  const { hosted } = resolveDbTarget("DaVinci catalog enrichment");
  const commit = args.includes("--commit");
  if (commit) requireHostedConfirmation(hosted, args);
  const mfr = args.find((a) => a.startsWith("--mfr="))?.slice(6);
  const only = args.find((a) => a.startsWith("--only="))?.slice(7)?.split(",").filter(Boolean);
  const records = JSON.parse(await readFile("data/davinci-extract.json", "utf8"));
  const result = await planEnrichment({ records, mfr, onlySkus: only });
  console.log(JSON.stringify(result.stats, null, 2));
  if (args.includes("--unmatched")) {
    for (const p of result.plans.filter((x) => x.skipped === "no-match")) console.log(`${p.sku},${p.displayName}`);
  }
  const applied = await applyEnrichment(result.plans, { commit, force: args.includes("--force") });
  console.log(`${commit ? "Committed" : "Dry run"}: ${applied.written} written, ${applied.skipped} skipped`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
