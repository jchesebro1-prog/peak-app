import type { VenueKind } from "@/app/(app)/design/quick/engine";
import type { BuiltInVenueKind, VenueType } from "@/lib/venue-types";

/**
 * Venue template registry (#255) — pure metadata, safe in client bundles
 * (Settings → Venue types, the Quick Design panel, the Grid intake). The
 * drawings themselves load through ./templates. Ids are versioned: a redraw
 * ships as @2 and never changes a Grid sheet stamped with @1. Adding a
 * template = its JSON + keys (./templates) + one entry here.
 */
export type TemplateFamily = "proscenium" | "church";

export type VenueTemplateEntry = {
  id: string;
  label: string;
  /** Which plan geometry draws it (plan-svg: prosGeom / churchGeom). */
  family: TemplateFamily;
  /** The venue-type behaviours it may be the Background for. */
  worksLike: readonly BuiltInVenueKind[];
  /** The default Background of these built-in kinds… */
  defaultForKinds: readonly BuiltInVenueKind[];
  /** …and of these venue-type keys (e.g. "gymstage"), which win over the kind default. */
  defaultForTypes: readonly string[];
};

export const VENUE_TEMPLATES: readonly VenueTemplateEntry[] = [
  { id: "proscenium@1", label: "Auditorium / PAC", family: "proscenium", worksLike: ["proscenium"], defaultForKinds: ["proscenium"], defaultForTypes: [] },
  { id: "gym-stage@1", label: "Gym Stage", family: "proscenium", worksLike: ["proscenium"], defaultForKinds: [], defaultForTypes: ["gymstage"] },
  { id: "church-traditional@1", label: "Church — Traditional", family: "church", worksLike: ["church"], defaultForKinds: ["church"], defaultForTypes: [] },
  { id: "church-contemporary@1", label: "Church — Contemporary", family: "church", worksLike: ["church"], defaultForKinds: [], defaultForTypes: [] },
];

export const BUILT_IN_SCHEMATIC_LABEL = "Built-in schematic";

/** The venue-type behaviour each Quick Design plan kind draws as; null = no templates, its built-in schematic. */
export const PLAN_KIND_WORKS_LIKE: Record<VenueKind, BuiltInVenueKind | null> = {
  proscenium: "proscenium",
  church: "church",
  flat: "flat",
  blackbox: "blackbox",
  // #255: Quick Design's Gym Stage venue draws the gym drawing through the gymstage type (PLAN_KIND_TYPE_KEY) — its own fields and pricing kind are unchanged.
  gym: "proscenium",
  arena: "arena",
};

/** The venue type whose Background a design with no venue follows. */
export const PLAN_KIND_TYPE_KEY: Record<VenueKind, string> = {
  proscenium: "proscenium",
  church: "church",
  flat: "flat",
  blackbox: "blackbox",
  gym: "gymstage",
  arena: "arena",
};

export const templateEntry = (id: string | null | undefined): VenueTemplateEntry | undefined =>
  id ? VENUE_TEMPLATES.find((t) => t.id === id) : undefined;

export function templatesFor(kind: BuiltInVenueKind | null | undefined): VenueTemplateEntry[] {
  return kind ? VENUE_TEMPLATES.filter((t) => t.worksLike.includes(kind)) : [];
}

/** A type's default Background: a template made the default for its key, else for its kind, else the kind's first; null = none. */
export function defaultBackground(kind: BuiltInVenueKind, typeKey?: string | null): string | null {
  const list = templatesFor(kind);
  return (
    (typeKey ? list.find((t) => t.defaultForTypes.includes(typeKey))?.id : undefined) ??
    list.find((t) => t.defaultForKinds.includes(kind))?.id ??
    list[0]?.id ??
    null
  );
}

/** A stored Background, kept only when it is a template for the type's kind; otherwise the type's default. */
export function sanitizeBackground(kind: BuiltInVenueKind, typeKey: string, raw: unknown): string | null {
  const list = templatesFor(kind);
  return typeof raw === "string" && list.some((t) => t.id === raw) ? raw : defaultBackground(kind, typeKey);
}

/**
 * The Background a plan of `planKind` draws for a venue of type `typeKey`:
 * that type's (or that type's default, when its stored one is not valid),
 * when it works like this plan's kind; else the built-in type for the kind;
 * else the registry default. null = the built-in schematic.
 */
export function resolveBackground(types: readonly VenueType[], typeKey: string | null | undefined, planKind: VenueKind): string | null {
  const wl = PLAN_KIND_WORKS_LIKE[planKind];
  if (!wl) return null;
  const list = templatesFor(wl);
  if (!list.length) return null;
  const valid = (id: unknown): id is string => typeof id === "string" && list.some((t) => t.id === id);
  const own = typeKey ? types.find((t) => t.key === typeKey) : undefined;
  // The design's own type decides when it works like this plan: its Background, else its own default.
  if (own && own.worksLike === wl) return valid(own.background) ? own.background : defaultBackground(wl, own.key);
  const baseKey = PLAN_KIND_TYPE_KEY[planKind];
  const base = types.find((t) => t.key === baseKey);
  if (base && base.worksLike === wl && valid(base.background)) return base.background;
  return defaultBackground(wl, baseKey);
}

/** A design's per-design Background override, kept only when it is a template its plan kind can draw; else null. */
export function sanitizeTemplateId(planKind: VenueKind, raw: unknown): string | null {
  const wl = PLAN_KIND_WORKS_LIKE[planKind];
  return typeof raw === "string" && templatesFor(wl).some((t) => t.id === raw) ? raw : null;
}

/** A design's effective template: its own override ?? its venue type's Background ?? the kind default. */
export function effectiveTemplateFor(
  planKind: VenueKind,
  a: { venueType?: string | null; templateId?: string | null },
  types: readonly VenueType[]
): string | null {
  if (!PLAN_KIND_WORKS_LIKE[planKind]) return null;
  return sanitizeTemplateId(planKind, a.templateId) ?? resolveBackground(types, a.venueType, planKind);
}
