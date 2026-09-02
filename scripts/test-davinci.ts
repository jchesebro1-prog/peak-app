/** Small anonymized Phase 1 extractor smoke test. */
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { extract } from "./davinci";

const root = mkdtempSync(join(tmpdir(), "davinci-test-"));
const snapshot = join(root, "snapshot"); mkdirSync(snapshot);
const library = readFileSync(resolve("scripts/fixtures/davinci-library.json"));
writeFileSync(join(snapshot, "library.json"), library);
writeFileSync(join(snapshot, "manifest.json"), JSON.stringify({ snapshotId: "fixture", files: [{ relativePath: "library.json", byteSize: library.length, sha256: createHash("sha256").update(library).digest("hex"), mimeType: "application/json", sourceModifiedAt: new Date().toISOString() }] }));
extract(snapshot);
const summary = JSON.parse(readFileSync(join(snapshot, "review", "summary.json"), "utf8"));
if (summary.output.catalog !== 1 || !existsSync(join(snapshot, "review", "exceptions.json"))) throw new Error("DaVinci fixture extraction failed");
rmSync(root, { recursive: true, force: true });
console.log("DaVinci extractor fixture: ok");
