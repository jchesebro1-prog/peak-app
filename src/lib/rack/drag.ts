/**
 * #296 — the rack part picker's drag payload, read on drop. Pure; the MIME type
 * itself is exported by the RackElevation component.
 */
import { RACK_WIDTHS, type PlacementKind, type RackWidthClass } from "./types";

export type RackPartDrag = { sku: string; ruHeight: number; width: RackWidthClass; kind: PlacementKind; label?: string };

const KINDS: readonly PlacementKind[] = ["device", "shelf", "blank", "vent", "reserved"];

/** Whole RU, at least 1 — how the layout rounds a catalog height (0.5 → 1, 1.5 → 2). */
export function wholeRu(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.ceil(n)) : 1;
}

/** Read a picker drag payload (JSON `{ sku, ruHeight, width, kind, label }`); null when it isn't one. Heights come back whole-RU. */
export function parseRackPartDrag(raw: string): RackPartDrag | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.sku !== "string" || !o.sku.trim()) return null;
    const ruHeight = wholeRu(typeof o.ruHeight === "number" ? o.ruHeight : 1);
    const width = typeof o.width === "string" && (RACK_WIDTHS as readonly string[]).includes(o.width) ? (o.width as RackWidthClass) : "full";
    const kind = typeof o.kind === "string" && KINDS.includes(o.kind as PlacementKind) ? (o.kind as PlacementKind) : "device";
    return { sku: o.sku, ruHeight, width, kind, ...(typeof o.label === "string" ? { label: o.label } : {}) };
  } catch {
    return null;
  }
}
