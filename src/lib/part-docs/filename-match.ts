import { normalizeSku } from "@/lib/davinci/sku";
import type { PartDocKind } from "./types";

/**
 * Bulk-drop filename matching (#DOC, spec §3 "Bulk drop"). Pure.
 *
 * Every part contributes up to three keys — its SKU, MFR P/N and MFR M/N —
 * each through `normalizeSku` (drop a leading `MFR:` segment, uppercase,
 * keep only A-Z0-9), the one identifier normalizer the DaVinci matcher also
 * uses. A filename is normalized the same way and every substring is looked
 * up, longest first: the longest length with any hit wins, so
 * `S4LED-S3-Lustr_Datasheet.pdf` matches `S4LEDS3LUSTR` over `S4LED`.
 * Keys shorter than MIN_MATCH_KEY never match (D-DOC-4) — a 3-character
 * model number appears by accident inside too many filenames.
 */

export const MIN_MATCH_KEY = 4;

export type FilenameIndex = { keys: Map<string, Set<string>>; maxLen: number };

export type MatchablePart = { sku: string; manufacturerPartNumber?: string; manufacturerModelNumber?: string };

export type FilenameMatch = {
  /** The winning normalized key(s), longest length. */
  keys: string[];
  skus: string[];
  confidence: "high" | "ambiguous" | "none";
};

export function buildFilenameIndex(parts: readonly MatchablePart[]): FilenameIndex {
  const keys = new Map<string, Set<string>>();
  let maxLen = 0;
  for (const p of parts) {
    for (const raw of [p.sku, p.manufacturerPartNumber, p.manufacturerModelNumber]) {
      const k = normalizeSku(raw || "");
      if (k.length < MIN_MATCH_KEY) continue;
      let set = keys.get(k);
      if (!set) keys.set(k, (set = new Set()));
      set.add(p.sku);
      if (k.length > maxLen) maxLen = k.length;
    }
  }
  return { keys, maxLen };
}

/** The filename without its extension, uppercased, letters and digits only. */
export function normalizeFileName(fileName: string): string {
  const base = String(fileName ?? "").split(/[\\/]/).pop() || "";
  return base.replace(/\.[A-Za-z0-9]{1,5}$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function matchFileName(fileName: string, index: FilenameIndex): FilenameMatch {
  const n = normalizeFileName(fileName);
  for (let len = Math.min(index.maxLen, n.length); len >= MIN_MATCH_KEY; len--) {
    const hitKeys = new Set<string>();
    const skus = new Set<string>();
    for (let i = 0; i + len <= n.length; i++) {
      const k = n.slice(i, i + len);
      const set = index.keys.get(k);
      if (!set) continue;
      hitKeys.add(k);
      for (const s of set) skus.add(s);
    }
    if (skus.size) {
      const list = [...skus].sort();
      return { keys: [...hitKeys].sort(), skus: list, confidence: list.length === 1 ? "high" : "ambiguous" };
    }
  }
  return { keys: [], skus: [], confidence: "none" };
}

/** Spec sheet when the name says spec/guide/specification or the file is
 *  Word; otherwise Datasheet (spec §3). */
export function guessKind(fileName: string): PartDocKind {
  const name = String(fileName ?? "").toLowerCase();
  if (/\.docx?$/.test(name)) return "specsheet";
  const base = name.replace(/\.[a-z0-9]{1,5}$/, "");
  return /spec|guide/.test(base) ? "specsheet" : "datasheet";
}
