import { getDoc } from "@/db/doc-store";
import type { BomRow } from "@/lib/bid-spec";
import { gridSpecBomRows, parseVirtualPartId } from "@/lib/design/grid-virtual-parts";
import { listFixtures } from "@/lib/stores/fixtures";

/**
 * Shared quote → BOM extraction (#205 spec builder T4), split out of the
 * D94 bid-spec generator's `bomFromQuoteAction` so the spec builder's
 * "Spec from this quote"/"Spec from this Grid design" doors and D94's own
 * action call one implementation. Server-only (reads doc-store).
 */

/** Pull an equipment list out of a quote's spec subdoc — the estimator's
 *  nested sections, or the flat `lines` shape The Grid mints (D111). */
type QuoteSpecDoc = {
  id: string;
  name?: string;
  spec?: {
    sections?: Array<{ items?: Array<{ sku?: string; desc?: string; qty?: number; option?: boolean; labor?: boolean }> }>;
    lines?: Array<{ sku?: string; desc?: string; qty?: number; allowance?: boolean }>;
  };
};

export async function bomFromQuote(
  quoteId: string
): Promise<{ ok: true; rows: BomRow[]; label: string } | { ok: false; error: string }> {
  const q = await getDoc<QuoteSpecDoc>("quotes", quoteId);
  if (!q) return { ok: false, error: `Quote ${quoteId} not found.` };
  const rows: BomRow[] = [];
  const push = (sku: unknown, desc: unknown, qty: unknown) => {
    const s = String(sku || "").trim();
    const d = String(desc || "").trim();
    if (!s && !d) return;
    rows.push({ sku: s, desc: d, qty: Number(qty) || 0 });
  };
  for (const sec of q.spec?.sections || []) {
    for (const it of sec.items || []) {
      // Optional-scope lines are not part of the base bid; labor lines
      // (mobilizations, shop & engineering, allowance, performance bonus)
      // aren't equipment and don't belong in the bid-spec BOM either.
      if (it.option || it.labor) continue;
      push(it.sku, it.desc, it.qty);
    }
  }
  // The Grid's flat lines (#211, D316): allowances are left out like the
  // estimator's allowance/labor lines; an Auto assembly (asm:) expands into
  // its members. Fixtures load once, and only when an assembly line exists.
  const gridLines = q.spec?.lines || [];
  const fixtures = gridLines.some((l) => parseVirtualPartId(String(l.sku || "").trim())?.kind === "assembly")
    ? new Map((await listFixtures()).map((f) => [f.id, f]))
    : new Map();
  for (const it of gridSpecBomRows(gridLines, (id) => fixtures.get(id))) push(it.sku, it.desc, it.qty);
  if (!rows.length) {
    return { ok: false, error: `Quote ${quoteId} has no equipment lines to specify.` };
  }
  return { ok: true, rows, label: q.name || quoteId };
}
