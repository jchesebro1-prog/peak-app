/** #373 — a tier-seeded lot line whose parts ride in `components`: a track, pipe or lineset line. */
export function isConfiguredLine(it: { track?: unknown; rigging?: unknown } | null | undefined): boolean {
  return it?.track != null || it?.rigging != null;
}
