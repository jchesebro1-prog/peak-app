"use client";

import "leaflet/dist/leaflet.css";
import LeafletMap, { type MapPin } from "@/components/map/LeafletMap";

/**
 * Client map wrapper for the inspections dashboard (same thin shim as the
 * flame-tests / repairs dashboards — LeafletMap is already client-only; this
 * exists to pull in leaflet's stylesheet so tiles + zoom controls position
 * correctly).
 */
export function InspectionMap({
  pins,
  height = 340,
}: {
  pins: MapPin[];
  height?: number;
}) {
  return <LeafletMap pins={pins} height={height} />;
}
