/**
 * Portal cart shapes (#245). Pure types — the `portal_carts` store (Task 8)
 * persists these and the server pricer (src/lib/portal-pricing.ts) reads
 * them. A cart never carries a price: every figure is computed on the server
 * from the catalog index each time the cart is priced.
 */

import type { CurtainBottomFinish, CurtainMountTypeId, CurtainTopFinish } from "@/lib/curtain-cut-sheets/vocab";

/** A customer's curtain request — free-text dimensions, always price on request. */
export type CurtainRequest = {
  name: string;
  fabricSku: string;
  fabricName: string;
  /** INFORMATIONAL ONLY — a copy of the cart line's qty, stamped on write.
   *  `CartLine.qty` is authoritative (priceCurtain prices the line qty, and a
   *  cart qty edit updates the line only); never read this for pricing. */
  qty: string;
  width: string;
  height: string;
  fullness: "0" | "50" | "75" | "100";
  /** #292 — staff Estimator only; the portal never sets these and cleanCurtainRequest never copies them into a cart. */
  topFinish?: CurtainTopFinish;
  bottomFinish?: CurtainBottomFinish;
  /** Used only when no track is linked. */
  mountType?: CurtainMountTypeId;
};

export type CartLine = {
  lineId: string;
  kind: "part" | "fixture" | "curtain";
  sku?: string;
  fixtureId?: string;
  /** Optional add-on quantities keyed `slot:sku` (qty 0 lines of the fixture). */
  fixtureOptions?: Record<string, number>;
  curtainInputs?: CurtainRequest;
  qty: number;
};

export type PortalCart = {
  id: string;
  customerId: string;
  locationId: string | null;
  lines: CartLine[];
  updatedAt: number;
};
