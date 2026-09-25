/**
 * Which parts Peak actually quotes (#DOC, spec §2.1) — the to-do list's
 * scope. Every SKU on any quote (any status), any Grid design placement, any
 * saved bid spec; no time window. Pure and single-pass: one walk per source,
 * one Map keyed by SKU.
 */

export type QuotedPartStat = {
  sku: string;
  /** Distinct quotes carrying the SKU — the ranking key (§2.1). */
  quotes: number;
  /** Newest `updatedAt` (else `createdAt`) among those quotes. */
  lastQuotedAt: number | null;
  /** Distinct Grid projects placing it. */
  grid: number;
  /** Distinct generated bid specs listing it. */
  bidSpecs: number;
};

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag | null => (v && typeof v === "object" ? (v as Bag) : null);
const skuOf = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * The distinct equipment SKUs on one saved quote spec: the estimator's nested
 * `sections[].items[]` or the Grid's flat `lines[]`. Labor is not a part that
 * takes a datasheet — a `kind: "labor"` section and a `labor: true` line are
 * skipped, the same rule the quote client package's BOM applies.
 */
export function quoteLineSkus(spec: unknown): string[] {
  const out = new Set<string>();
  const s = bag(spec);
  if (!s) return [];
  if (Array.isArray(s.sections)) {
    for (const rawSection of s.sections) {
      const sec = bag(rawSection);
      if (!sec || sec.kind === "labor" || !Array.isArray(sec.items)) continue;
      for (const rawItem of sec.items) {
        const item = bag(rawItem);
        if (!item || item.labor === true) continue;
        const sku = skuOf(item.sku);
        if (sku) out.add(sku);
      }
    }
  }
  if (Array.isArray(s.lines)) {
    for (const rawLine of s.lines) {
      const line = bag(rawLine);
      const sku = line ? skuOf(line.sku) : "";
      if (sku) out.add(sku);
    }
  }
  return [...out];
}

export function quotedPartStats(
  sources: { quotes: unknown[]; gridProjects: unknown[]; generated: unknown[] },
  isPart: (sku: string) => boolean
): Map<string, QuotedPartStat> {
  const stats = new Map<string, QuotedPartStat>();
  const statFor = (sku: string): QuotedPartStat | null => {
    if (!isPart(sku)) return null;
    let s = stats.get(sku);
    if (!s) stats.set(sku, (s = { sku, quotes: 0, lastQuotedAt: null, grid: 0, bidSpecs: 0 }));
    return s;
  };

  for (const raw of sources.quotes || []) {
    const q = bag(raw);
    if (!q) continue;
    const at = Number(q.updatedAt ?? q.createdAt ?? 0);
    for (const sku of quoteLineSkus(q.spec)) {
      const s = statFor(sku);
      if (!s) continue;
      s.quotes++;
      if (Number.isFinite(at) && at > 0 && (s.lastQuotedAt == null || at > s.lastQuotedAt)) s.lastQuotedAt = at;
    }
  }

  for (const raw of sources.gridProjects || []) {
    const p = bag(raw);
    if (!p || !Array.isArray(p.placements)) continue;
    const seen = new Set<string>();
    for (const rawPl of p.placements) {
      const pl = bag(rawPl);
      if (!pl || pl.curtain) continue; // a made-to-size curtain is not a catalog product
      const sku = skuOf(pl.partId);
      if (sku) seen.add(sku);
    }
    for (const sku of seen) {
      const s = statFor(sku);
      if (s) s.grid++;
    }
  }

  for (const raw of sources.generated || []) {
    const g = bag(raw);
    if (!g) continue;
    const seen = new Set<string>();
    if (Array.isArray(g.bom)) for (const row of g.bom) { const sku = skuOf(bag(row)?.sku); if (sku) seen.add(sku); }
    if (Array.isArray(g.rows)) for (const row of g.rows) { const sku = skuOf(bag(bag(row)?.row)?.sku); if (sku) seen.add(sku); }
    for (const sku of seen) {
      const s = statFor(sku);
      if (s) s.bidSpecs++;
    }
  }

  return stats;
}

/** Most-quoted first; then Grid + bid-spec use; then newest; then SKU. */
export function rankQuotedParts(stats: Iterable<QuotedPartStat>): QuotedPartStat[] {
  return [...stats].sort(
    (a, b) =>
      b.quotes - a.quotes ||
      b.grid + b.bidSpecs - (a.grid + a.bidSpecs) ||
      (b.lastQuotedAt ?? 0) - (a.lastQuotedAt ?? 0) ||
      a.sku.localeCompare(b.sku)
  );
}
