import type { VenueClass } from "@/lib/stores/venue-classes";

export type VenueDoctrineEntry = {
  curtains: string;
  lighting: string;
  confirmed: boolean;
};

export type VenueDoctrine = Record<VenueClass, VenueDoctrineEntry>;
export type VenueDoctrinePatch = Partial<
  Record<VenueClass, Partial<VenueDoctrineEntry>>
>;

/** Defaults transcribed from the five venue-class field sheets (D132). */
export const DEFAULT_VENUE_DOCTRINE: VenueDoctrine = {
  gym: {
    curtains: "Encore 22 oz main + valance, Encore rest",
    lighting: "",
    confirmed: true,
  },
  auditorium: {
    curtains: "Charisma main + valance, Encore rest",
    lighting: "Element console",
    confirmed: true,
  },
  theatre: {
    curtains: "Charisma main + valance, Encore rest",
    lighting: "Element console",
    confirmed: false,
  },
  church: {
    curtains: "Charisma main + valance, Encore rest",
    lighting: "Element console",
    confirmed: false,
  },
  convention: { curtains: "", lighting: "", confirmed: true },
  other: { curtains: "", lighting: "", confirmed: true },
};

/** Resolve a sparse settings patch without sharing mutable default objects. */
export function resolveVenueDoctrine(
  stored?: VenueDoctrinePatch | null
): VenueDoctrine {
  return Object.fromEntries(
    (Object.keys(DEFAULT_VENUE_DOCTRINE) as VenueClass[]).map((venueClass) => [
      venueClass,
      {
        ...DEFAULT_VENUE_DOCTRINE[venueClass],
        ...(stored?.[venueClass] || {}),
      },
    ])
  ) as VenueDoctrine;
}
