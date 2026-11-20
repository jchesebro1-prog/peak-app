/**
 * The Send & track step's pure layout rules: which cards show, in which
 * order, per status. No React, store, db or next imports.
 */
import type { QuoteStatus } from "@/lib/stores/quotes";

/** The DOM ids other controls scroll to (Status card control, Client link card). */
export const SEND_STEP_IDS = { status: "est-send-status", statusSelect: "est-send-status-select", clientLink: "est-send-client-link" } as const;

export type SendCard = "bidders" | "vendors" | "status" | "pipeline" | "clientLink";

/** Card order per status. The Pipeline card only when the stage bar applies. */
export function sendStepLayout(status: QuoteStatus, showPipeline: boolean): SendCard[] {
  const order: SendCard[] =
    status === "draft"
      ? ["status", "clientLink", "bidders", "vendors", "pipeline"]
      : ["bidders", "vendors", "clientLink", "pipeline", "status"];
  return showPipeline ? order : order.filter((c) => c !== "pipeline");
}
