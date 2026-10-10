import type { WireType } from "@/lib/catalog-connect";

/**
 * "Fill symbols from Bray's legend" (#328 A3). A pure rule over wire types:
 * by what a wire type carries, fill its EMPTY riser Symbol / Signal with the
 * codes Bray's conduit-riser legend uses. A value someone already typed is
 * never overwritten; the input is never mutated. The card applies the result
 * to its form and the admin Saves.
 *
 * What a wire type carries is read from its connection types first, then its
 * id and label (so a custom wire type named "Panic" or "Cat5e" works too).
 * Anything marked wireless is skipped — it is not a run of conduit cable.
 * Rules are tried in order; the first that matches wins.
 */
export const BRAY_WIRE_SYMBOLS: ReadonlyArray<{ symbol: string; signal: string; match: RegExp }> = [
  { symbol: "P", signal: "Panic", match: /\bpanic\b/i },
  { symbol: "CC", signal: "Contact closure", match: /\bcontact[\s-]*closure\b/i },
  { symbol: "UE", signal: "EchoConnect", match: /\bechoconnect\b/i },
  { symbol: "D", signal: "DMX", match: /\bdmx(512)?\b/i },
  { symbol: "N", signal: "Network", match: /\b(network|ethernet|cat[\s-]?5e|cat[\s-]?6a?|sacn|art-?net)\b/i },
];

/** The Bray symbol/signal for one wire type, or null when none of its text matches. */
export function brayCodeFor(wt: Pick<WireType, "id" | "label" | "connectionTypes">): { symbol: string; signal: string } | null {
  const texts = [...wt.connectionTypes, wt.id, wt.label].filter((t) => t && !/wireless/i.test(t));
  for (const rule of BRAY_WIRE_SYMBOLS) {
    if (texts.some((t) => rule.match.test(t))) return { symbol: rule.symbol, signal: rule.signal };
  }
  return null;
}

/** A new array: empty Symbol / Signal filled by the legend, everything else untouched. */
export function brayWireSymbols(wireTypes: WireType[]): WireType[] {
  return wireTypes.map((wt) => {
    const code = brayCodeFor(wt);
    if (!code) return { ...wt };
    const out: WireType = { ...wt };
    if (!out.symbol?.trim()) out.symbol = code.symbol;
    if (!out.signal?.trim()) out.signal = code.signal;
    return out;
  });
}
