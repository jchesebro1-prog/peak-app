"use client";

import "leaflet/dist/leaflet.css";
import LeafletMap, { type MapPin } from "@/components/map/LeafletMap";

/**
 * Client map wrapper for the flame-tests dashboard / scheduler. LeafletMap is
 * already client-only (it dynamically imports leaflet inside an effect); this
 * thin wrapper exists only to pull in leaflet's stylesheet so tiles + zoom
 * controls position correctly, matching the prototype's `<link leaflet.css>`.
 */
export function FlameMap({
  pins,
  height = 360,
}: {
  pins: MapPin[];
  height?: number;
}) {
  return <LeafletMap pins={pins} height={height} />;
}
