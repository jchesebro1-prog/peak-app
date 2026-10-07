/** #296 — equipment racks. Imperial: inches, pounds, watts. */
export const RU_IN = 1.75;
export const BTU_PER_WATT = 3.412;
export const RACK_RU_MIN = 1;
export const RACK_RU_MAX = 60;
export const RACK_RU_DEFAULT = 42;
export const RACK_MAX_PLACEMENTS = 300;
export const HEAT_WINDOW_RU = 10;
export const HEAT_WATTS_PER_WINDOW = 1500;
export const CIRCUIT_VOLTS = 120;

export const RACK_MOUNTS = ["rack", "shelf", "none"] as const;
export type RackMount = (typeof RACK_MOUNTS)[number];
export const RACK_WIDTHS = ["full", "half", "third", "23in"] as const;
export type RackWidthClass = (typeof RACK_WIDTHS)[number];
export const MOUNT_FACES = ["front", "rear", "both"] as const;
export type MountFace = (typeof MOUNT_FACES)[number];
export const AIRFLOWS = ["front-to-rear", "rear-to-front", "side", "passive"] as const;
export type Airflow = (typeof AIRFLOWS)[number];

/** Optional catalog-part rack data. Absent = unknown; 0 = measured none. */
export type RackPartFacts = {
  rackMount?: RackMount;
  ruHeight?: number;          // > 0, multiple of 0.5
  rackWidth?: RackWidthClass;
  depthIn?: number;           // ≥ 0
  weightLb?: number;          // ≥ 0
  powerWatts?: number;        // ≥ 0 typical draw
  maxPowerWatts?: number;     // ≥ 0 rated draw
  powerCapacityWatts?: number;// ≥ 0, PDU/UPS outlet capacity (D576)
  mountFace?: MountFace;
  airflow?: Airflow;
  rackNotes?: string;         // ≤ 200 chars
};
export const RACK_FACT_KEYS = ["rackMount", "ruHeight", "rackWidth", "depthIn", "weightLb", "powerWatts", "maxPowerWatts", "powerCapacityWatts", "mountFace", "airflow", "rackNotes"] as const;
export type RackFactKey = (typeof RACK_FACT_KEYS)[number];

/**
 * A part as the rack engine sees it. `found: false` = SKU not in the catalog.
 * `internal` = an internal catalog row (a labor/travel rate, see
 * `isInternalCategory`): it prices like any part but has no weight, power or
 * datasheet, so totals, the submittal and coverage leave it out.
 */
/** `model` (#304): the part's Model #, else its MFR P/N — present only when the catalog row has one; read it through `rackModelOf`. */
export type RackPartInfo = RackPartFacts & { sku: string; desc: string; mfr?: string; model?: string; found: boolean; internal?: boolean };
export type RackPartLookup = (sku: string) => RackPartInfo | undefined;

export type RackFace = "front" | "rear";
export type PlacementKind = "device" | "shelf" | "blank" | "vent" | "reserved";
export type RackConfig = { ruCount: number; widthIn: 19 | 23; depthIn?: number; numbering: "bottom-up" | "top-down" };
export type PlacementOverride = { ruHeight?: number; depthIn?: number; weightLb?: number; powerWatts?: number; rackWidth?: RackWidthClass };
export type RackPlacement = {
  id: string;                 // RP-<base36>
  kind: PlacementKind;
  sku?: string;               // required except for reserved
  label?: string;
  ruStart: number;            // lowest occupied RU (storage is always bottom-up, RU 1 = bottom). Shelf children: = shelf.ruStart (ignored)
  ruHeight: number;           // whole RU, ≥ 1 (resolved at placement: override > catalog ceil > 1)
  face: RackFace;
  lane?: 0 | 1 | 2;           // absent = 0
  laneCount?: 1 | 2 | 3;      // absent = 1 (full width)
  shelfId?: string;           // sits on this shelf; takes no RU of its own
  optional?: boolean;
  override?: PlacementOverride;
  costOverride?: number;
  notes?: string;             // ≤ 200 chars
};
export type RackLayout = { config: RackConfig; placements: RackPlacement[] };

export type RackIssue = { level: "error" | "warning"; code: string; placementIds: string[]; message: string };
export type RackDataField = "ruHeight" | "depthIn" | "weightLb" | "powerWatts";
export type RackMissing = { sku: string; label: string; fields: RackDataField[] };
export type RackTotals = {
  ruCount: number; ruUsed: number; ruReserved: number; ruFree: number;
  weightLb: number; watts: number; maxWatts: number; btuHr: number; amps: number;
  withOptions: { weightLb: number; watts: number; maxWatts: number; btuHr: number };
  capacityWatts: number | null;
  byFace: { front: number; rear: number };   // RU positions occupied per face
  missingData: RackMissing[];                 // one row per distinct SKU
  unknownWatts: number;                       // distinct SKUs counted with unknown watts (non-passive) — totals read "at least"
  unknownWeight: number;                      // distinct SKUs lacking weight
};
export type RackEdit = { ok: true; layout: RackLayout } | { ok: false; reason: string };
