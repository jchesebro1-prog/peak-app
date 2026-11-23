"use client";

import { VenueTypesCard } from "../venue-types-card";
import type { VenueType } from "@/lib/venue-types";

/**
 * Settings → Field & Venues: Venue types. (The site-intake type catalog, the
 * site-visit reason picklist and the Final thoughts tags left with Venue
 * Assessments; their stored settings values are untouched.)
 */
export function FieldGroup({ venueTypes }: { venueTypes: VenueType[] }) {
  return (
    <VenueTypesCard
      key={venueTypes.map((t) => t.key).join("|")}
      types={venueTypes}
    />
  );
}
