/**
 * Manual-intake helpers (Spec 1, Task 6) and the one Auto/Blank intake's
 * scope inputs (#GEM). Pure.
 */
import { SYS_ORDER, venueOf, type AState, type QuickScopeInputs, type SysKey } from "@/app/(app)/design/quick/engine";
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
 * The one intake's scope inputs (#GEM): venue/size/dims as entered, systems =
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

const UNTITLED = "Untitled system design";

/** What the linked DesignRecord learns from a first intake save so the
 *  Designs dashboard card stops showing `? × ? × ?` for manual designs. */
export function designPatchFromIntake(input: {
  projectName: string;
  venueName: string;
  locationName: string;
  a: AState;
}): { name?: string; venue: string; size: string; width: number; depth: number; grid: number } {
  const v = input.venueName.trim();
  const l = input.locationName.trim();
  const derived = v && l ? `${v} — ${l}` : v || l;
  const untitled = !input.projectName.trim() || input.projectName.trim() === UNTITLED;
  return {
    ...(untitled && derived ? { name: derived } : {}),
    venue: input.a.venue,
    size: input.a.size,
    width: input.a.width,
    depth: input.a.depth,
    grid: input.a.grid,
  };
}
