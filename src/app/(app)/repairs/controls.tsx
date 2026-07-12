"use client";

import dynamic from "next/dynamic";
import type { MapPin } from "@/components/map/LeafletMap";

/**
 * Client wrapper for the repairs dashboard map. LeafletMap needs the browser
 * (leaflet is imported inside a client effect), so it's pulled in with
 * next/dynamic { ssr: false } — a client-only option, hence this "use client"
 * boundary between the server page and the map. Pins are computed server-side
 * and passed down as plain serializable data.
 */

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 340,
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

export function RepairsMap({ pins }: { pins: MapPin[] }) {
  return <LeafletMap pins={pins} height={340} />;
}
