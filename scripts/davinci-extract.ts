/**
 * Regenerate `data/davinci-extract.json` from the full DaVinci library (#162, D8).
 *
 *   npm run davinci:extract
 *
 * Reads `data/davinci/source/<newest timestamp>/library.json` (42 MB of the
 * 116 MB export — the rest is 73 MB of images this script never touches),
 * gitignored, this machine only, and writes the ~1.39 MB extract that IS
 * committed. Touches no database. Re-run when ETC ships a new export; if it has
 * added a port protocol or port direction, the extract will throw with the new
 * UUID or label rather than mis-typing or silently dropping its ports.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractLibrary } from "../src/lib/davinci/extract";
import { buildIndexWithStats } from "../src/lib/davinci/match";

const SRC = "data/davinci/source";
const OUT = "data/davinci-extract.json";

function main() {
  if (!existsSync(SRC)) {
    console.error(
      `No ${SRC}. The 116 MB DaVinci export (42 MB library.json + 73 MB images) is gitignored ` +
        `and lives on Jeff's machine only.\n` +
        `The committed ${OUT} is what the enricher reads — you only need this script to refresh it.`
    );
    process.exit(1);
  }
  const dir = readdirSync(SRC).sort().reverse()[0];
  const file = join(SRC, dir, "library.json");
  console.log(`[davinci] reading ${file}`);
  const extract = extractLibrary(JSON.parse(readFileSync(file, "utf8")));
  writeFileSync(OUT, JSON.stringify(extract));
  const bytes = Buffer.byteLength(JSON.stringify(extract));
  // Collisions are printed because they are not rare (440 of 13,633 distinct
  // identifiers) and because buildIndex silently resolves them — active type
  // first, then the one with more ports. A jump in this number after a library
  // revision means the resolution rule is doing more work than anyone reviewed.
  const { collisions } = buildIndexWithStats(extract.records);
  console.log(
    `[davinci] ${extract.records.length} records · ` +
      `${extract.records.reduce((a, r) => a + r.modelNumbers.length, 0)} identifiers · ` +
      `${extract.records.reduce((a, r) => a + r.ports.length, 0)} ports · ` +
      `${extract.records.reduce((a, r) => a + r.docs.length, 0)} docs · ` +
      `${collisions} contested identifiers · ` +
      `${(bytes / 1048576).toFixed(2)} MB → ${OUT}`
  );
}
main();
