import { readFile, writeFile } from "node:fs/promises";
import { extractLibrary } from "@/lib/davinci/extract";

const source = process.argv[2] || "data/davinci/source/library.json";
const output = process.argv[3] || "data/davinci-extract.json";

async function main() {
  const raw = JSON.parse(await readFile(source, "utf8"));
  const records = extractLibrary(raw);
  await writeFile(output, JSON.stringify(records) + "\n");
  console.log(`DaVinci extract: ${records.length} records → ${output}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
