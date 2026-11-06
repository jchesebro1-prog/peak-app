/**
 * Quick Design's shared vocabulary (system keys, tiers, BOM rows). Moved out
 * of the route file design/quick/engine.ts so pure src/lib modules (and
 * estimating-core's closure) never import a route folder; engine.ts
 * re-exports every name. Estimator handoff, spec 2026-10-20 §3.
 */

export type SysKey =
  | "rigging"
  | "curtains"
  | "lighting"
  | "controls"
  | "audio"
  | "video"
  | "acoustical"
  | "pit";

export type VenueKind = "proscenium" | "church" | "flat" | "blackbox" | "gym" | "arena";
export type TierKey = "good" | "better" | "best";
export type SizeKey = "small" | "medium" | "large";
export type DimField = "width" | "depth" | "grid" | "wing" | "ph";
export type ViewKey = "estimate" | "bom" | "plan" | "schedule" | "riser";

export type VenueDef = {
  key: string;
  label: string;
  sub: string;
  kind: VenueKind;
  w: number;
  d: number;
  g: number;
  wing: number;
  ph: number;
  sys: Record<SysKey, boolean>;
};

/** A drape's finished geometry (goods.ts drapeRule) — per panel width, panels on the line. */
export type DrapeGeom = { w: number; h: number; fullness: number; qty: number };

export type BomItem = {
  /** Equipment map row key, `system:itemKey` (#211, equipment-vocab.ts). */
  key: string;
  /** The equation's own item name (= the row label). */
  desc: string;
  qty: number;
  unit: string;
  /** Unit cost / unit sell — 0 until equipment-pricing.ts prices the item. */
  cost: number;
  price: number;
  /** Set by the Equipment map pricing step (#211): how this line priced. */
  status?: "part" | "assembly" | "allowance" | "none" | "needs-part";
  /** What priced it: SKU, fixture id or row key — and its description. */
  ref?: string;
  refDesc?: string;
  /** Curtain drapes only: the geometry the per-drape cost is computed from. */
  drape?: DrapeGeom;
  /** #231: the line's caveat (e.g. a venue dimension counted as 0), shown next to the item. */
  note?: string;
};

export type SystemBlock = {
  key: SysKey;
  name: string;
  on: boolean;
  m: number;
  dot: string;
  items: BomItem[];
  rev: number;
  cost: number;
  tierFixed?: boolean;
};
