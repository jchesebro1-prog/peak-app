/** Run a page-load reconciliation without allowing one bad record or a
 * transient database failure to take down the whole screen. */
export type SweepResult =
  | { ok: true; created: number }
  | { ok: false; label: string; message: string };
export type SweepOutcome<T> = { value: T; error: string | null };

export function safeSweep(
  label: string,
  work: () => Promise<number>,
): Promise<SweepResult>;
export function safeSweep<T>(
  label: string,
  work: () => Promise<T>,
  fallback: T,
): Promise<SweepOutcome<T>>;

export async function safeSweep<T>(
  label: string,
  work: () => Promise<T>,
  fallback?: T,
): Promise<SweepResult | SweepOutcome<T>> {
  try {
    const value = await work();
    if (typeof value === "number") return { ok: true, created: value };
    return { value, error: null };
  } catch (error) {
    console.error(`[safe-sweep] ${label} failed`, error);
    if (fallback === undefined) {
      return {
        ok: false,
        label,
        message: error instanceof Error ? error.message : `Could not reconcile ${label}.`,
      };
    }
    return {
      value: fallback as T,
      error: error instanceof Error ? error.message : `Could not reconcile ${label}.`,
    };
  }
}
