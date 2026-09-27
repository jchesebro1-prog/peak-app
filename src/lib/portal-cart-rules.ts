import type { CurtainRequest } from "@/lib/portal-cart-types";

/**
 * Portal "Add to quote" guards (#242 Task 11) — pure, client-safe. The
 * server actions run these before touching the cart store; the sidebar
 * uses the same limits for its inputs.
 */

/** Mirrors `MAX_LINE_QTY` in src/lib/stores/portal-carts.ts (not imported —
 *  that module reads the database). */
export const PORTAL_MAX_QTY = 10000;
export const QTY_COPY = "Enter a quantity from 1 to 10,000.";
export const NOT_QUOTABLE_COPY = "This part isn't available to quote.";

/** Why an add can't happen, or null when it can. `indexHas` = the SKU is in
 *  the portal catalog index (quotable for customers). */
export function cartAddProblem(indexHas: boolean, qty: number): string | null {
  if (!indexHas) return NOT_QUOTABLE_COPY;
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > PORTAL_MAX_QTY) return QTY_COPY;
  return null;
}

export const CURTAIN_FULLNESS: ReadonlyArray<readonly [label: string, value: CurtainRequest["fullness"]]> = [
  ["Flat", "0"],
  ["50%", "50"],
  ["75%", "75"],
  ["100%", "100"],
];
const MAX_CURTAIN_FT = 200;
const MAX_NAME = 80;

function feet(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n > 0 && n <= MAX_CURTAIN_FT ? Math.round(n * 100) / 100 : null;
}

/**
 * An untrusted curtain request → a clean one, or the first problem. The
 * fabric must be one of `fabrics` (the server's list) or "" (Peak to
 * recommend); its NAME is always taken from that list, never from the
 * client. Width/height are feet (> 0, ≤ 200); qty a whole number 1..10,000.
 */
export function cleanCurtainRequest(
  raw: unknown,
  fabrics: ReadonlyArray<{ sku: string; name: string }>
): { ok: true; curtain: CurtainRequest; qty: number } | { ok: false; error: string } {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const name = typeof r.name === "string" ? r.name.trim().slice(0, MAX_NAME) : "";
  if (!name) return { ok: false, error: "Name the curtain (e.g. Main Grand Drape)." };
  const fabricSku = typeof r.fabricSku === "string" ? r.fabricSku : "";
  const fabric = fabricSku ? fabrics.find((f) => f.sku === fabricSku) : null;
  if (fabricSku && !fabric) return { ok: false, error: "Pick a fabric from the list." };
  const qtyRaw = typeof r.qty === "number" ? r.qty : typeof r.qty === "string" && /^\s*\d+\s*$/.test(r.qty) ? Number(r.qty) : NaN;
  if (!Number.isInteger(qtyRaw) || qtyRaw < 1 || qtyRaw > PORTAL_MAX_QTY) return { ok: false, error: QTY_COPY };
  const width = feet(r.width);
  if (width == null) return { ok: false, error: "Enter the width in feet." };
  const height = feet(r.height);
  if (height == null) return { ok: false, error: "Enter the height in feet." };
  const fullness = CURTAIN_FULLNESS.find(([, v]) => v === r.fullness)?.[1];
  if (!fullness) return { ok: false, error: "Pick a fullness." };
  return {
    ok: true,
    qty: qtyRaw,
    curtain: {
      name,
      fabricSku: fabric ? fabric.sku : "",
      fabricName: fabric ? fabric.name : "",
      qty: String(qtyRaw),
      width: String(width),
      height: String(height),
      fullness,
    },
  };
}
