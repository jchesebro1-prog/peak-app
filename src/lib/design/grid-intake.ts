/**
 * Manual-intake helpers (Spec 1, Task 6) and the one Auto/Blank intake's
 * scope inputs (#211). Pure.
 */
import { SYS_ORDER, defaultAState, venueOf, type AState, type QuickScopeInputs, type SysKey } from "@/app/(app)/design/quick/engine";
import { TRACKABLE_SYS_KEYS } from "@/lib/design/grid-scopes";

/** Scope inputs seeded from the intake: venue/size/dims as entered, systems
 *  = the venue preset's defaults restricted to the five trackable keys. */
export function manualScopeInputs(a: AState): QuickScopeInputs {
  const preset = venueOf(a);
  const sys = Object.fromEntries(
    SYS_ORDER.map((k) => [k, TRACKABLE_SYS_KEYS.includes(k) && !!preset.sys[k]])
  ) as Record<SysKey, boolean>;
  return {
    venue: a.venue,
    size: a.size,
    width: a.width,
    depth: a.depth,
    grid: a.grid,
    wing: a.wing,
    ph: a.ph,
    sys,
    rigType: a.rigType,
    drape: { ...(a.drape || {}) },
    fixtures: { ...(a.fixtures || {}) },
    fixtureAssemblies: { ...(a.fixtureAssemblies || {}) },
    ctrl: { ...(a.ctrl || {}) },
    shell: { ...(a.shell || {}) },
    pitType: a.pitType,
  };
}

/**
 * The one intake's scope inputs (#211): venue/size/dims as entered, systems =
 * the designer's own scope picks (a.sys) limited to the five Grid scopes. The
 * intake starts a.sys from the venue preset, so an untouched intake equals
 * manualScopeInputs(a).
 */
export function intakeScopeInputs(a: AState): QuickScopeInputs {
  const sys = Object.fromEntries(
    SYS_ORDER.map((k) => [k, TRACKABLE_SYS_KEYS.includes(k) && !!a.sys?.[k]])
  ) as Record<SysKey, boolean>;
  return { ...manualScopeInputs(a), sys };
}

/**
 * A NEW Grid intake's opening state (#244, Jeff): an Auditorium, 50' wide ×
 * 30' deep × 20' high (proscenium opening) with 10' wings and a 45' grid,
 * with the Auditorium preset's systems. Quick Design's own defaultAState is
 * untouched; `size` is only the label — the dimensions are explicit.
 */
export function gridIntakeDefaults(): AState {
  const base = defaultAState(0);
  const venue = venueOf({ venue: "school" });
  return { ...base, venue: venue.key, size: "large", width: 50, depth: 30, ph: 20, wing: 10, grid: 45, sys: { ...venue.sys } };
}

export const UNTITLED_GRID_DESIGN = "Untitled system design";
const UNTITLED = UNTITLED_GRID_DESIGN;

/** "Venue — Location" from the cover page, or whichever one is filled. */
export function coverAutoName(venueName: string, locationName: string): string {
  const v = venueName.trim();
  const l = locationName.trim();
  return v && l ? `${v} — ${l}` : v || l;
}

/**
 * The design's name after an intake save (#244): a typed title always wins;
 * otherwise an untitled design takes the cover page's "Venue — Location";
 * otherwise nothing changes (undefined).
 */
export function intakeDesignName(input: { title?: string; projectName: string; venueName: string; locationName: string }): string | undefined {
  const typed = (input.title || "").trim();
  if (typed) return typed;
  const derived = coverAutoName(input.venueName, input.locationName);
  const untitled = !input.projectName.trim() || input.projectName.trim() === UNTITLED;
  return untitled && derived ? derived : undefined;
}

/** The site a customer-doc location id names (#244) — `docLocId` in reverse:
 *  a migrated venue's legacyLocId, else the site's own id. */
export function siteForLocId<T extends { id: string; legacyLocId: string | null }>(sites: readonly T[], locId: string): T | null {
  const id = locId.trim();
  if (!id) return null;
  return sites.find((s) => (s.legacyLocId ?? s.id) === id) || null;
}

/**
 * Cover-page fields from a customer venue (#244). A derived venue name
 * reads "Location — Type" (#216), so Venue/space is the part after the
 * location ("Auditorium") and Location/campus the location itself (blank on
 * a venue named after its company → the customer's name). Address is the
 * street plus city/state.
 */
export function coverFromVenue(
  venue: { label?: string | null; locationName?: string | null; address?: string | null; city?: string | null; state?: string | null },
  customerName: string
): { locationName: string; venueName: string; address: string } {
  const label = (venue.label || "").trim();
  const location = (venue.locationName || "").trim() || customerName.trim();
  const prefix = location ? `${location} — ` : "";
  const space = prefix && label.startsWith(prefix) ? label.slice(prefix.length).trim() : label;
  const cityState = [venue.city, venue.state].map((x) => (x || "").trim()).filter(Boolean).join(", ");
  const address = [(venue.address || "").trim(), cityState].filter(Boolean).join(", ");
  return { locationName: location, venueName: space && space !== location ? space : "", address };
}

/** What the linked DesignRecord learns from a first intake save so the
 *  Designs dashboard card stops showing `? × ? × ?` for manual designs —
 *  and, from #244, the design's title and the customer it is for. */
export function designPatchFromIntake(input: {
  projectName: string;
  venueName: string;
  locationName: string;
  a: AState;
  /** #244 — the intake's typed title ("" = auto-name as before). */
  title?: string;
  /** #244 — the linked customer; locationId is the customer-doc venue id. */
  customer?: { customer: string; customerId: string | null; locationId: string | null };
}): {
  name?: string;
  venue: string;
  size: string;
  width: number;
  depth: number;
  grid: number;
  customer?: string;
  customerId?: string | null;
  locationId?: string | null;
} {
  const name = intakeDesignName(input);
  return {
    ...(name ? { name } : {}),
    venue: input.a.venue,
    size: input.a.size,
    width: input.a.width,
    depth: input.a.depth,
    grid: input.a.grid,
    ...(input.customer
      ? { customer: input.customer.customer, customerId: input.customer.customerId, locationId: input.customer.locationId }
      : {}),
  };
}
