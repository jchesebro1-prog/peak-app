"use client";

import dynamic from "next/dynamic";
import type { MapPin } from "@/components/map/LeafletMap";

/**
 * Client wrapper for the Installs "Project locations" map. LeafletMap loads
 * leaflet inside a browser-only effect, so it's pulled in with next/dynamic
 * { ssr: false } behind this client boundary. Pins are computed server-side
 * (from customer venue coords) and passed down as plain serializable data.
 */

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: 330,
        background: "#e9eef1",
        borderRadius: 10,
        border: "1px solid #ececf0",
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

export function ReportsMap({ pins }: { pins: MapPin[] }) {
  return <LeafletMap pins={pins} height={330} />;
}
