/**
 * Read the committed DaVinci extract (#162, D8).
 *
 * Separate from `match.ts` purely so that `match.ts` stays free of `node:fs`
 * and is therefore safe to import from a client component. This module is
 * server/script only.
 */
import { readFileSync } from "node:fs";
import type { DavinciExtract } from "./types";

let cached: DavinciExtract | null = null;

/** Memoized — callers walk 37k catalog rows against the same extract. */
export function loadExtract(file = "data/davinci-extract.json"): DavinciExtract {
  if (!cached) cached = JSON.parse(readFileSync(file, "utf8")) as DavinciExtract;
  return cached;
}
