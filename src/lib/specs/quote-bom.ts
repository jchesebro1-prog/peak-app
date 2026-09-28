import { getDoc } from "@/db/doc-store";
import type { BomRow } from "@/lib/bid-spec";
import { gridSpecBomRows, parseVirtualPartId } from "@/lib/design/grid-virtual-parts";
import { listFixtures } from "@/lib/stores/fixtures";
import { curtainSpecKey } from "@/lib/specs/record-keys";

/**
 * Shared quote → BOM extraction (#205 spec builder T4), split out of the
 * D94 bid-spec generator's `bomFromQuoteAction` so the spec builder's
 * "Spec from this quote"/"Spec from this Grid design" doors and D94's own
 * action call one implementation. Server-only (reads doc-store).
 */

/** Pull an equipment list out of a quote's spec subdoc — the estimator's
 *  nested sections, or the flat `lines` shape The Grid mints (D111).
 *  `manufacturer`/`manufacturerPartNumber`/`specKey`/`curtain`/
 *  `vendorQuoteId`/`allowance`/`custom` feed spec-records BOM seam
 *  (design §3.1) — D94's own catalog-sku matching ignores them. */
type QuoteSpecDoc = {
  id: string;
  name?: string;
  spec?: {
    sections?: Array<{
      items?: Array<{
        sku?: string;
        desc?: string;
        qty?: number;
        option?: boolean;
        labor?: boolean;
        manufacturer?: string;
        manufacturerPartNumber?: string;
        specKey?: string;
        curtain?: boolean;
        vendorQuoteId?: string;
        allowance?: boolean;
        custom?: boolean;
      }>;
    }>;
    lines?: Array<{ sku?: string; desc?: string; qty?: number; allowance?: boolean; specKey?: string }>;
  };
  /** Vendor-quote roll-ups (#143): a line with `vendorQuoteId` stands in for
   *  one of these — its actual material lines carry the part numbers
   *  (Sensor IQ / PowerSafe / Paradigm etc.) the roll-up line never shows. */
  vendorQuotes?: Array<{ id: string; lines?: Array<{ description?: string; manufacturerPartNumber?: string; qty?: number }> }>;
};

export async function bomFromQuote(
  quoteId: string
): Promise<{ ok: true; rows: BomRow[]; label: string } | { ok: false; error: string }> {
  const q = await getDoc<QuoteSpecDoc>("quotes", quoteId);
  if (!q) return { ok: false, error: `Quote ${quoteId} not found.` };
  const rows: BomRow[] = [];
  const push = (row: { sku?: unknown; desc?: unknown; qty?: unknown; mfrNumber?: unknown; manufacturer?: unknown; specKey?: unknown }) => {
    const s = String(row.sku || "").trim();
    const d = String(row.desc || "").trim();
    const mfrNumber = String(row.mfrNumber || "").trim();
    if (!s && !d && !mfrNumber) return;
    rows.push({
      sku: s,
      desc: d,
      qty: Number(row.qty) || 0,
      ...(mfrNumber ? { mfrNumber } : {}),
      ...(row.manufacturer ? { manufacturer: String(row.manufacturer).trim() } : {}),
      ...(row.specKey ? { specKey: String(row.specKey).trim() } : {}),
    });
  };
  const vendorQuotes = new Map((q.vendorQuotes || []).map((vq) => [vq.id, vq]));
  for (const sec of q.spec?.sections || []) {
    for (const it of sec.items || []) {
      // Optional-scope lines are not part of the base bid; labor lines
      // (mobilizations, shop & engineering, allowance, performance bonus)
      // aren't equipment and don't belong in the bid-spec BOM either.
      if (it.option || it.labor) continue;
      // A vendor-quote roll-up line is replaced by that vendor quote's own
      // material lines — that's where the actual part numbers live.
      if (it.vendorQuoteId) {
        const vq = vendorQuotes.get(it.vendorQuoteId);
        if (vq?.lines?.length) {
          for (const l of vq.lines) push({ sku: "", desc: l.description, qty: l.qty, mfrNumber: l.manufacturerPartNumber });
          continue;
        }
      }
      push({
        sku: it.sku,
        desc: it.desc,
        qty: it.qty,
        mfrNumber: it.manufacturerPartNumber,
        manufacturer: it.manufacturer,
        specKey: it.specKey || (it.curtain ? curtainSpecKey(undefined, it.desc) : undefined),
      });
    }
  }
  // The Grid's flat lines (#211, D316): allowances are left out like the
  // estimator's allowance/labor lines; an Auto assembly (asm:) expands into
  // its members. Fixtures load once, and only when an assembly line exists.
  const gridLines = q.spec?.lines || [];
  const fixtures = gridLines.some((l) => parseVirtualPartId(String(l.sku || "").trim())?.kind === "assembly")
    ? new Map((await listFixtures()).map((f) => [f.id, f]))
    : new Map();
  for (const it of gridSpecBomRows(gridLines, (id) => fixtures.get(id))) push(it);
  if (!rows.length) {
    return { ok: false, error: `Quote ${quoteId} has no equipment lines to specify.` };
  }
  return { ok: true, rows, label: q.name || quoteId };
}
