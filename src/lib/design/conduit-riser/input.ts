/**
 * Conduit riser (#321) — the plain input the engine runs on. The server
 * loader builds it from the Grid project, catalog, device types, wire types
 * and calibrations; the engine never reads a store, so every rule here is
 * harness-testable with a hand-built fixture.
 */

import type { EffectiveTag } from "./tags";

/** One placed device, as the riser sees it. */
export type CRDevice = {
  id: string; // placement id
  /** Display designator (#320's formatDesignator), e.g. "CRO-04" or "LX-01–24". */
  label: string;
  /** Catalog description and model (model may be ""). */
  desc: string;
  model: string;
  /** Device-type key (device-types.ts), null when unmapped. */
  typeKey: string | null;
  /** In this riser's system (lighting: placementSystem === "lighting"). */
  inSystem: boolean;
  spaceId: string | null;
  spaceName: string;
  levelId: string | null;
  tag: EffectiveTag;
  /** Present on a rack assembly: its contents grouped by part. */
  rack?: { items: { desc: string; qty: number }[] };
};

export type CRSignal = { wireTypeId: string; symbol: string; signal: string };

/** One plan wire (GridRoute) or typed-length RiserLink. */
export type CRWire = {
  id: string;
  kind: "route" | "link";
  /** Device ends — absent on a wire not snapped to a device at that end. */
  from?: string;
  to?: string;
  partId: string;
  /** Cable name as printed in the wire legend (model, else description). */
  cable: string;
  /** The cable's wire type with a symbol, else null (prints "?"). */
  signal: CRSignal | null;
  /** Measured (route) or typed (link) feet; null = unmeasured. */
  lengthFt: number | null;
  /** In this riser's system (routeSystem for routes; either end for links). */
  inSystem: boolean;
  /** The cable part's outside diameter, inches (catalog `cableOdIn`); null = not recorded (#328 B2 fill). */
  odIn: number | null;
};

export type CRLevel = { id: string; label: string; elevation?: string; order: number };
export type CRWireType = { id: string; label: string; symbol: string; signal: string };
export type CRBoxType = { code: string; description: string };
