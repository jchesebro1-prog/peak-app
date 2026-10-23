/**
 * #368 — sent estimates keep their prices (ETC price sync spec §9). The staff
 * actions that re-price lines on an EXISTING estimate — Copy / Move system
 * into it, Load system, re-opening a track / curtain / labor configurator —
 * are locked on a sent / won / lost estimate until it is revised (Revise
 * re-prices it to today's catalog, §9.1). Copy / Move into a NEW estimate is
 * never locked. Pure and client-safe: the server refusals and the greyed
 * controls share this text and this rule.
 */
export const REVISE_FIRST = "Revise the estimate first";

/** True for an estimate whose lines must not be re-priced until it is revised:
 *  any stored status but draft. A missing status (an unsaved estimate) is open. */
export function repriceLocked(status: unknown): boolean {
  return typeof status === "string" && status !== "" && status !== "draft";
}
