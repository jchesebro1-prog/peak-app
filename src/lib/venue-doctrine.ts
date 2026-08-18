import type { VenueClass } from "@/lib/stores/venue-classes";

export type VenueDoctrine = Record<VenueClass, { curtains: string; lighting: string; confirmed: boolean }>;

/** Defaults from the site-visit sheets. Theatre and church await confirmation. */
export const DEFAULT_VENUE_DOCTRINE: VenueDoctrine = {
  theatre: { curtains: "Charisma 25 oz main and masking", lighting: "Theatrical LED fixture package", confirmed: false },
  auditorium: { curtains: "Encore 22 oz main + valance, Encore rest", lighting: "ETC control with documented dimming and FOH", confirmed: true },
  church: { curtains: "Encore soft goods sized for worship use", lighting: "Flexible worship lighting package", confirmed: false },
  gym: { curtains: "Divider curtain to suit court span", lighting: "Protected, serviceable LED lighting", confirmed: true },
  convention: { curtains: "Track and soft goods only where programmed", lighting: "Flexible event lighting and distributed control", confirmed: true },
  other: { curtains: "Confirm site-specific soft-goods scope", lighting: "Confirm site-specific lighting scope", confirmed: true },
};

export function resolveVenueDoctrine(stored?: Partial<VenueDoctrine> | null): VenueDoctrine {
  return { ...DEFAULT_VENUE_DOCTRINE, ...(stored || {}) };
}
