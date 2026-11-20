/* The curtain configurator's inputs as stored on an Estimator curtain line (`SpecItem.curtainInputs`).
   Moved from the removed portal cart types (#245); the shape is unchanged. Pure types. */

import type { CurtainBottomFinish, CurtainMountTypeId, CurtainTopFinish } from "@/lib/curtain-cut-sheets/vocab";

export type CurtainRequest = {
  name: string;
  fabricSku: string;
  fabricName: string;
  /** Informational copy of the line's quantity; the line's own qty is authoritative. */
  qty: string;
  width: string;
  height: string;
  fullness: "0" | "50" | "75" | "100";
  /** #292 — top / bottom finish and mount for the cut sheet. */
  topFinish?: CurtainTopFinish;
  bottomFinish?: CurtainBottomFinish;
  /** Used only when no track is linked. */
  mountType?: CurtainMountTypeId;
  /** #292 — the line's Rose Brand vendor cost (each), kept so Update curtain re-prices at it. */
  vendorCost?: string;
};
