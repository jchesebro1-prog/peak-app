"use client";

import dynamic from "next/dynamic";
import type { MapPin } from "@/components/map/LeafletMap";

/**
 * Client wrapper for the Schedule job-location map. LeafletMap is browser-only
 * (leaflet imports inside a client effect), so it's pulled in with next/dynamic
 * { ssr: false } — the same pattern as the Repairs map. Pins are computed
 * server-side from project venue coords and passed down as plain data.
 */

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 288,
        background: "#e9eef1",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 12,
        color: "#8c919c",
      }}
    >
      Loading map…
    </div>
  ),
});

export function ScheduleMap({ pins }: { pins: MapPin[] }) {
  return <LeafletMap pins={pins} height={288} />;
}
