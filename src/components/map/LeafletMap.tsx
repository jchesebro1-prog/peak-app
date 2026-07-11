"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMapType, LayerGroup } from "leaflet";

/**
 * Shared map panel — Leaflet + CARTO light tiles, per the prototype
 * (README "Maps: Leaflet + CARTO/OSM tiles; pins from customer venue
 * coords"). Client-only; import with next/dynamic { ssr: false }.
 */

export type MapPin = {
  id: string;
  lat: number;
  lng: number;
  color?: string; // status color
  label?: string; // tooltip line 1
  sub?: string; // tooltip line 2
  href?: string;
  ring?: boolean; // e.g. warranty ring on repairs map
  size?: number;
};

export default function LeafletMap({
  pins,
  height = 320,
  center,
  zoom,
}: {
  pins: MapPin[];
  height?: number;
  center?: [number, number];
  zoom?: number;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMapType | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !elRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(elRef.current, {
          scrollWheelZoom: false,
          attributionControl: false,
        });
        L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
          { maxZoom: 19 }
        ).addTo(mapRef.current);
        L.control
          .attribution({ prefix: false })
          .addAttribution("© OpenStreetMap · CARTO")
          .addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
      }
      const layer = layerRef.current!;
      layer.clearLayers();
      const valid = pins.filter(
        (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)
      );
      valid.forEach((p) => {
        const size = p.size ?? 12;
        const marker = L.circleMarker([p.lat, p.lng], {
          radius: size / 2 + (p.ring ? 2 : 0),
          color: p.ring ? p.color || "var(--accent)" : "#ffffff",
          weight: p.ring ? 3 : 2,
          fillColor: p.color || "#7b3f8a",
          fillOpacity: 0.92,
        });
        if (p.label) {
          marker.bindTooltip(
            `<div style="font-family:'Public Sans',sans-serif;font-size:12px;font-weight:600">${p.label}</div>` +
              (p.sub
                ? `<div style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:#6b7079">${p.sub}</div>`
                : ""),
            { direction: "top", offset: [0, -6] }
          );
        }
        if (p.href) marker.on("click", () => (window.location.href = p.href!));
        marker.addTo(layer);
      });
      if (center) {
        mapRef.current!.setView(center, zoom ?? 8);
      } else if (valid.length) {
        const bounds = L.latLngBounds(valid.map((p) => [p.lat, p.lng]));
        mapRef.current!.fitBounds(bounds.pad(0.18), { maxZoom: 10 });
      } else {
        mapRef.current!.setView([44.5, -89.5], 6); // Wisconsin
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pins, center, zoom]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div
      ref={elRef}
      style={{
        height,
        borderRadius: 10,
        overflow: "hidden",
        border: "1px solid #ececf0",
        background: "#f1f2f5",
      }}
    />
  );
}
