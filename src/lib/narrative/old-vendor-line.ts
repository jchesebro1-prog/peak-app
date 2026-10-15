/**
 * Jeff 2026-10-15 #21 — a vendor-quoted line Load system brought in at its
 * last price carries this internal note (and `custom: true`, #352 review M3)
 * until someone re-quotes it. Pure and client-safe: the Estimator's Send &
 * track readiness line counts these (a warning, never a block).
 */
export const OLD_VENDOR_PRICE_NOTE = "Old vendor price — re-quote";

/** Does this line still carry the "Old vendor price — re-quote" flag? (Removing the note clears it.) */
export function needsRequote(it: { internalNote?: unknown; option?: unknown } | null | undefined): boolean {
  return !!it && typeof it.internalNote === "string" && it.internalNote.trim().startsWith(OLD_VENDOR_PRICE_NOTE);
}
