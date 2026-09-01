import type { LinesetMode } from "@/lib/design/steel";

/** Saved defaults for generated lines by schedule category. Kept independent
 * from the per-line record so an operator can update a category without
 * overwriting a deliberate exception on one line. */
export type CategoryModeRules = Partial<Record<string, LinesetMode>>;

/** Resolution order is intentional: a line exception wins, then its category,
 * then the schedule-wide default. */
export function resolvedLinesetMode(
  type: string,
  explicit: LinesetMode | undefined,
  categoryModes: CategoryModeRules,
  fallback: LinesetMode
): LinesetMode {
  return explicit || categoryModes[type] || fallback;
}
