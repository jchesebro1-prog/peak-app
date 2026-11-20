/* Name clean-up helpers (moved from the removed portal quote-name rules, #288). Pure and client-safe. */

/** Invisible characters a name never needs: bidi embeddings / overrides
 *  (U+202A–202E) and isolates (U+2066–2069), the zero-width space (U+200B)
 *  and the BOM (U+FEFF), plus control characters. ZWNJ / ZWJ (U+200C/200D)
 *  stay — scripts and emoji sequences need them. */
export const INVISIBLE_STRIP = /[\p{Cc}​‪-‮⁦-⁩﻿]/gu;

const GRAPHEMES: { segment(s: string): Iterable<{ segment: string }> } | null =
  typeof Intl !== "undefined" && typeof (Intl as { Segmenter?: unknown }).Segmenter === "function"
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

/** The longest prefix of `s` of at most `max` code points that never splits a
 *  grapheme cluster (an emoji family, a flag, a base + combining mark) — a
 *  cluster that doesn't fit whole is dropped. Falls back to code points where
 *  Intl.Segmenter is unavailable. */
export function capGraphemes(s: string, max: number): string {
  if (!GRAPHEMES) return Array.from(s).slice(0, max).join("");
  let out = "";
  let used = 0;
  for (const { segment } of GRAPHEMES.segment(s)) {
    const n = Array.from(segment).length;
    if (used + n > max) break;
    out += segment;
    used += n;
  }
  return out;
}
