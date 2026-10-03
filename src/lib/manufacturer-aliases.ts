/**
 * Manufacturer spelling merges (Manufacturer section Part 2). Pure. A record
 * merged away carries `mergedInto`; its canonical record lists it in
 * `aliasKeys`. Unknown keys are their own canonical key. Catalog `mfr` text
 * never changes — merging only changes how keys group.
 */
export type AliasRecord = { key: string; aliasKeys?: string[]; mergedInto?: string | null };

export function canonicalKeyMap(records: readonly AliasRecord[]): (key: string) => string {
  const to = new Map<string, string>();
  for (const r of records) {
    if (r.mergedInto) to.set(r.key, r.mergedInto);
    for (const a of r.aliasKeys ?? []) if (a !== r.key) to.set(a, r.key);
  }
  return (key) => {
    let k = key;
    for (let i = 0; i < 8 && to.has(k) && to.get(k) !== k; i++) k = to.get(k)!;
    return k;
  };
}

export function groupKeys(records: readonly AliasRecord[], canonical: string): string[] {
  const canon = canonicalKeyMap(records);
  const keys = new Set<string>([canonical]);
  for (const r of records) {
    if (canon(r.key) === canonical) keys.add(r.key);
    for (const a of r.aliasKeys ?? []) if (canon(a) === canonical) keys.add(a);
  }
  return [canonical, ...[...keys].filter((k) => k !== canonical).sort()];
}

export function planMerge(
  records: readonly AliasRecord[],
  sourceKey: string,
  targetKey: string
): { ok: true; target: string; moved: string[] } | { ok: false; error: string } {
  const canon = canonicalKeyMap(records);
  const s = canon(sourceKey);
  const t = canon(targetKey);
  if (!s || !t) return { ok: false, error: "Pick a manufacturer." };
  if (s === t) return { ok: false, error: "Those are already the same manufacturer." };
  return { ok: true, target: t, moved: groupKeys(records, s) };
}
