/**
 * Read the committed DaVinci extract (#162, D8).
 *
 * Separate from `match.ts` purely so that `match.ts` stays free of `node:fs`
 * and is therefore safe to import from a client component. This module is
 * server/script only.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { DavinciDoc, DavinciExtract, DavinciRecord } from "./types";

/** Keyed by resolved absolute path so distinct `file` args never collide (#162). */
const cache = new Map<string, DavinciExtract>();

/** Recursively freezes an extract (and everything it references) so the cached
 * singleton can never be corrupted by a caller mutating in place (#162). */
function deepFreezeExtract(extract: DavinciExtract): DavinciExtract {
  const records = extract.records as DavinciRecord[];
  for (const record of records) {
    const modelNumbers = record.modelNumbers as string[];
    Object.freeze(modelNumbers);

    const ports = record.ports as DavinciRecord["ports"][number][];
    for (const port of ports) Object.freeze(port);
    Object.freeze(ports);

    const docs = record.docs as DavinciDoc[];
    for (const doc of docs) Object.freeze(doc);
    Object.freeze(docs);

    Object.freeze(record);
  }
  Object.freeze(records);
  return Object.freeze(extract);
}

/** Memoized — callers walk 37k catalog rows against the same extract. */
export function loadExtract(file = "data/davinci-extract.json"): DavinciExtract {
  const key = path.resolve(file);
  const existing = cache.get(key);
  if (existing) return existing;

  const extract = deepFreezeExtract(JSON.parse(readFileSync(key, "utf8")) as DavinciExtract);
  cache.set(key, extract);
  return extract;
}
