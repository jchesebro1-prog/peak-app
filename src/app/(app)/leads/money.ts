/**
 * Prototype money formats (client-safe — no store imports).
 * Leads.dc.html shortMoney() returns "—" for zero (table rows + standfirst);
 * Leads Explorations.dc.html shortMoney() returns "$0" (board stats/cards,
 * worklist rows). Both are ported exactly.
 */

export function shortMoneyDash(n: number | null | undefined): string {
  const v = Math.round(n || 0);
  if (v <= 0) return "—";
  if (v < 1000) return "$" + v;
  if (v < 1000000) return "$" + (v / 1000).toFixed(v >= 100000 ? 0 : 1) + "k";
  return "$" + (v / 1000000).toFixed(2) + "m";
}

export function shortMoneyZero(n: number | null | undefined): string {
  const v = Math.round(n || 0);
  if (v <= 0) return "$0";
  if (v < 1000) return "$" + v;
  if (v < 1000000) return "$" + (v / 1000).toFixed(v >= 100000 ? 0 : 1) + "k";
  return "$" + (v / 1000000).toFixed(2) + "m";
}

/** Lead Detail money() — full dollars with separators, dash for zero. */
export function moneyFull(n: number | null | undefined): string {
  const v = Math.round(n || 0);
  return v > 0 ? "$" + v.toLocaleString("en-US") : "—";
}
