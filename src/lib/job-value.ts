/**
 * Task 9 — "UKN" unknown job values (Daylite import). A Daylite-imported
 * project or repair job whose dollar value wasn't known at the source is
 * flagged `valueUnknown: true` (ProjectRecord/RepairJobRecord). Every sum
 * and render of `.value` across the app goes through here so an unknown
 * value renders "UKN" and never contributes a phantom $0 (or worse, a
 * stale placeholder number) to a total. Pure — no store/db imports.
 */

export type Valued = { value?: number | null; valueUnknown?: boolean | null };

export const isValueUnknown = (r: Valued): boolean => !!r.valueUnknown;

/** The record's value for summing purposes — 0 when the value is unknown,
 *  even if `value` itself carries a stray/legacy number. */
export function knownValue(r: Valued): number {
  return r.valueUnknown ? 0 : Number(r.value) || 0;
}

/** The record's value for display — "UKN" when unknown, else `fmt(value)`. */
export function formatJobValue(r: Valued, fmt: (n: number) => string): string {
  return r.valueUnknown ? "UKN" : fmt(Number(r.value) || 0);
}

/** How many records in the list have an unknown value — for "· N with
 *  unknown value" suffixes on totals that exclude them. */
export function unknownCount(rs: Valued[]): number {
  return rs.filter(isValueUnknown).length;
}
