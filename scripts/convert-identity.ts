/**
 * Convert the customer directory onto the identity core (D85) and print the
 * reconciliation report. Safe to run repeatedly — no-ops once companies
 * exist unless --force (which wipes and rebuilds identity rows first).
 *
 *   npm run db:convert-identity
 *   npm run db:convert-identity -- --force
 */
import {
  convertCustomersToIdentity,
  formatReport,
  wipeIdentity,
} from "../src/lib/identity/convert";

async function main() {
  const force = process.argv.includes("--force");
  if (force) await wipeIdentity();
  const report = await convertCustomersToIdentity({ force });
  console.log(formatReport(report));
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
