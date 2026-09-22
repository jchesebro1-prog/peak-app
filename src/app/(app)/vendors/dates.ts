/** <input type="date"> ⇄ epoch-ms bridge (local Date parts, TZ-safe) — the
 *  companies/edit-modal.tsx #23 helpers, exported so the price-list form and
 *  the server page share one implementation. Generic date VALUES store local
 *  midnight. Dependency-free, so the server route, the actions module and the
 *  client tabs all import the same code. */
export function toDateInput(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (x: number) => String(x).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

export function fromDateInput(s: string): number | null {
  if (!s) return null;
  const p = s.split("-");
  if (p.length !== 3) return null;
  const ms = new Date(+p[0], +p[1] - 1, +p[2]).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export type LedgerDates =
  | { ok: true; receivedAt: number; effectiveAt: number }
  | { ok: false; error: string };

/**
 * Validate the price-list ledger dates at the ACTION boundary (#122 §3).
 * The store's normalizeEntry() silently DROPS an entry whose `effectiveAt`
 * isn't a finite number, so an action that forwarded whatever the client
 * posted would answer `{ ok: true }` over a write that never happened — and
 * the status chip would never move. Anything that isn't a positive finite
 * epoch-ms is refused here instead.
 */
export function parseLedgerDates(input: { receivedAt: unknown; effectiveAt: unknown }): LedgerDates {
  const receivedAt = Number(input.receivedAt);
  const effectiveAt = Number(input.effectiveAt);
  const bad = (n: number) => !Number.isFinite(n) || n <= 0;
  if (typeof input.receivedAt !== "number" || typeof input.effectiveAt !== "number" || bad(receivedAt) || bad(effectiveAt)) {
    return { ok: false, error: "Both dates are required." };
  }
  return { ok: true, receivedAt, effectiveAt };
}
