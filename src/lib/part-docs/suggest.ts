import { mfrKey } from "@/lib/catalog-books";
import { normalizeSku } from "@/lib/davinci/sku";

/**
 * "Also covers…" (#207, spec §3): after a file lands on one part, the other
 * parts it probably describes. Pure. Two sources, in this order:
 *  1. the part's accessories from the graph (the fixture datasheet covers
 *     them anyway — attaching makes it explicit), then
 *  2. the same manufacturer's model family: a normalized model number
 *     (MFR M/N, else the SKU) sharing a prefix of at least 5 characters and
 *     half of the shorter one — `S4LEDS3LUSTR` and `S4LEDS3DAYLT`, not
 *     `S4LED` and `S4PAR`.
 */

export type SuggestPart = { sku: string; desc: string; mfr?: string; manufacturerModelNumber?: string };
export type Suggestion = { sku: string; desc: string; reason: "accessory" | "family" };

export function familyKey(p: { sku: string; manufacturerModelNumber?: string }): string {
  return normalizeSku(p.manufacturerModelNumber || p.sku);
}

export function commonPrefixLength(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}

export function isSameFamily(a: string, b: string): boolean {
  if (!a || !b) return false;
  const n = commonPrefixLength(a, b);
  return n >= 5 && n >= Math.ceil(0.5 * Math.min(a.length, b.length));
}

export function alsoCoversSuggestions(
  target: SuggestPart,
  parts: readonly SuggestPart[],
  accessorySkus: readonly string[],
  exclude: ReadonlySet<string>,
  limit = 25
): Suggestion[] {
  const out: Suggestion[] = [];
  const taken = new Set<string>([target.sku, ...exclude]);
  const bySku = new Map(parts.map((p) => [p.sku, p]));
  for (const sku of accessorySkus) {
    if (taken.has(sku)) continue;
    const p = bySku.get(sku);
    if (!p) continue;
    taken.add(sku);
    out.push({ sku, desc: p.desc, reason: "accessory" });
  }
  const tMfr = mfrKey(target.mfr);
  const tKey = familyKey(target);
  if (tMfr && tKey) {
    const family: Array<{ p: SuggestPart; n: number }> = [];
    for (const p of parts) {
      if (taken.has(p.sku) || mfrKey(p.mfr) !== tMfr) continue;
      const k = familyKey(p);
      if (isSameFamily(tKey, k)) family.push({ p, n: commonPrefixLength(tKey, k) });
    }
    family.sort((a, b) => b.n - a.n || a.p.sku.localeCompare(b.p.sku));
    for (const { p } of family) out.push({ sku: p.sku, desc: p.desc, reason: "family" });
  }
  return out.slice(0, limit);
}
