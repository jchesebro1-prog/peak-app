/**
 * Travel origins (#176, D229). baseOffice is the drive chain's base (spec
 * 2026-10-09). resolveTravelOrigin / originOptions served the retired D144
 * auto travel block and its "Traveling from" picker. resolveTravelOrigin's
 * order: a typed address (geocoded) → a chosen saved location → the person's
 * base ("Based out of", else the quote origin). A typed address that can't
 * be found falls back to the base WITH a note, so the block still appears
 * and says honestly what it measured from. `search` is injected so this is
 * testable without the network.
 */
export type TravelFrom = { officeId?: string; address?: string };
export type OriginPoint = { name: string; lat: number; lng: number };
export type OriginOffice = {
  id: string;
  name: string;
  lat: number | null;
  lng: number | null;
  quoteDefault?: boolean;
};

const located = (o: OriginOffice | null | undefined): o is OriginOffice & { lat: number; lng: number } =>
  !!o && o.lat != null && o.lng != null && Number.isFinite(Number(o.lat)) && Number.isFinite(Number(o.lng));

const point = (o: OriginOffice & { lat: number; lng: number }): OriginPoint => ({
  name: o.name || "your base office",
  lat: Number(o.lat),
  lng: Number(o.lng),
});

/** The person's base: their "Based out of" office, else the quote origin (flagged, else first). */
export function baseOffice(offices: OriginOffice[], baseOfficeId?: string | null): OriginOffice | null {
  const mine = baseOfficeId ? offices.find((o) => o.id === baseOfficeId) : undefined;
  return mine || offices.find((o) => o.quoteDefault) || offices[0] || null;
}

/**
 * #176 fix 3 — the base (unchanged, even if it has no coordinates —
 * resolveTravelOrigin already treats an uncoordinated base as "no fallback")
 * plus only the offices that can actually be routed from. Its one caller, the
 * New event form's "Traveling from" picker, was retired with the D144 travel
 * block (spec 2026-10-09 — drive legs now start from the rep's base via
 * baseOffice); kept pure and pinned by test:drive-distance.
 */
export function originOptions(
  offices: OriginOffice[],
  baseOfficeId?: string | null
): { base: OriginOffice | null; offices: OriginOffice[] } {
  return {
    base: baseOffice(offices, baseOfficeId),
    offices: offices.filter(located),
  };
}

export async function resolveTravelOrigin(
  from: TravelFrom | null | undefined,
  ctx: {
    offices: OriginOffice[];
    baseOfficeId?: string | null;
    search: (q: string) => Promise<Array<{ lat: number; lng: number }>>;
  }
): Promise<{ origin: OriginPoint | null; note?: string }> {
  const base = baseOffice(ctx.offices, ctx.baseOfficeId);
  const fallback = located(base) ? point(base) : null;

  const typed = (from?.address || "").trim().slice(0, 200);
  if (typed) {
    const [hit] = await ctx.search(typed).catch(() => []);
    if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng))
      return { origin: { name: typed, lat: hit.lat, lng: hit.lng } };
    return fallback
      ? { origin: fallback, note: `Couldn’t find “${typed}”, so this is measured from ${fallback.name}.` }
      : { origin: null };
  }
  if (from?.officeId) {
    const chosen = ctx.offices.find((o) => o.id === from.officeId);
    if (located(chosen)) return { origin: point(chosen) };
  }
  return { origin: fallback };
}
