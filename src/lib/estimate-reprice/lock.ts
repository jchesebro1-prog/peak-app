/**
 * #368 — sent estimates keep their prices (ETC price sync spec §9). The staff
 * actions that re-price lines on an EXISTING estimate are locked on a sent /
 * won / lost estimate until it is revised (Revise re-prices it to today's
 * catalog, §9.1). Copy / Move into a NEW estimate is never locked. Pure and
 * client-safe: the server refusals and the greyed controls share this text and
 * this rule.
 *
 * What the lock reaches — be exact, it is not uniform:
 * - SERVER-ENFORCED (the stored status is read on the server): Copy / Move
 *   system into an existing estimate, Copy within this estimate, Load system,
 *   and the tier stamp a save writes (a non-draft save keeps the stored one).
 * - UI LOCK ONLY: re-opening a track / curtain / labor configurator, and the
 *   tier re-price a customer / contact pick offers. Those re-price lines in the
 *   browser, and saveQuoteAction accepts any posted line on a sent estimate
 *   (it never diffs lines) — the client prop is named `uiRepriceLock` so
 *   nobody mistakes it for a server guarantee.
 */
export const REVISE_FIRST = "Revise the estimate first";

/** The banner a customer / contact pick shows on a non-draft estimate instead of re-pricing to `label`'s tier. */
export function tierLockedMessage(label: string): string {
  return `${REVISE_FIRST} — prices stay as sent; the ${label || "Base"} tier applies when you revise and pick the customer again.`;
}

/** True for an estimate whose lines must not be re-priced until it is revised:
 *  any stored status but draft. A missing status (an unsaved estimate) is open. */
export function repriceLocked(status: unknown): boolean {
  return typeof status === "string" && status !== "" && status !== "draft";
}
