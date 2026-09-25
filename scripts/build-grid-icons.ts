/**
 * Build the Grid's stock icon set (spec 2026-09-25 §3):
 *   npm run icons:grid           — write src/lib/design/grid-icons.generated.ts + LICENSES/tabler-icons.txt
 *   npm run icons:grid -- --check — exit 1 if either committed file is stale
 * Touches no database. Deterministic: same package + same picks = same bytes.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { generateFromPackage, GENERATED_MODULE_PATH, LICENSE_PATH } from "./grid-icons-gen";

const root = process.cwd();
const out = generateFromPackage(root);
const targets: Array<[string, string]> = [
  [GENERATED_MODULE_PATH, out.module],
  [LICENSE_PATH, out.license],
];

if (process.argv.includes("--check")) {
  const stale = targets.filter(([rel, text]) => {
    const file = path.join(root, rel);
    return !existsSync(file) || readFileSync(file, "utf8") !== text;
  });
  if (stale.length) {
    console.error(`stale: ${stale.map(([rel]) => rel).join(", ")} — run npm run icons:grid`);
    process.exit(1);
  }
  console.log(`grid icons up to date (${out.count} icons, @tabler/icons ${out.version})`);
} else {
  for (const [rel, text] of targets) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  console.log(`wrote ${out.count} icons from @tabler/icons ${out.version}`);
}
