"use client";

import { useCallback, useEffect, useRef } from "react";
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
  picked,
  onPick,
}: {
  pins: MapPin[];
  height?: number;
  center?: [number, number];
  zoom?: number;
  /** Pick mode (#169): one draggable pin at `picked`; a map click or a pin
   *  drag reports the point through `onPick`. Absent => display-only, as
   *  every other map in the app uses it. */
  picked?: { lat: number; lng: number } | null;
  onPick?: (p: { lat: number; lng: number }) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMapType | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const pickMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const onPickRef = useRef(onPick);
  const pickedRef = useRef(picked);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  useEffect(() => {
    onPickRef.current = onPick;
    pickedRef.current = picked;
  });

  /** Draw / move / remove the single pick-mode pin to match `picked`. */
  const syncPick = useCallback(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const p = pickedRef.current;
    if (!p || !onPickRef.current) {
      pickMarkerRef.current?.remove();
      pickMarkerRef.current = null;
      return;
    }
    if (pickMarkerRef.current) {
      pickMarkerRef.current.setLatLng([p.lat, p.lng]);
      return;
    }
    // A divIcon, not L.marker's default icon — the default needs image
    // assets the bundler does not ship.
    const icon = L.divIcon({
      className: "",
      html: '<div style="width:18px;height:18px;border-radius:50%;background:var(--accent);border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45)"></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    const m = L.marker([p.lat, p.lng], { icon, draggable: true }).addTo(map);
    m.on("dragend", () => {
      const ll = m.getLatLng();
      onPickRef.current?.({ lat: ll.lat, lng: ll.lng });
    });
    pickMarkerRef.current = m;
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      leafletRef.current = L;
      if (cancelled || !elRef.current) return;
      if (!mapRef.current) {
        mapRef.current = L.map(elRef.current, {
          scrollWheelZoom: false,
          attributionControl: false,
        });
        // OpenStreetMap's standard tiles, desaturated to the light basemap
        // the prototype specced. CARTO's light_all used to be keyless; since
        // 2026 every tile comes back watermarked "API KEY REQUIRED", which is
        // what every map in the app was showing. OSM stays key-free (like
        // the rest of geo.ts) — its tile policy asks for the attribution
        // below and a Referer, which next.config's Referrer-Policy sends.
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          className: "pk-map-tiles",
        }).addTo(mapRef.current);
        L.control
          .attribution({ prefix: false })
          .addAttribution(
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
          )
          .addTo(mapRef.current);
        layerRef.current = L.layerGroup().addTo(mapRef.current);
        // Only reacts when a caller passed onPick; display maps ignore clicks.
        mapRef.current.on("click", (e) => {
          const cb = onPickRef.current;
          if (cb) cb({ lat: e.latlng.lat, lng: e.latlng.lng });
        });
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
      syncPick();
    })();
    return () => {
      cancelled = true;
    };
  }, [pins, center, zoom, syncPick]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Deliberately does NOT refit or re-centre, so the view doesn't jump
  // while a pin is dragged.
  useEffect(() => {
    syncPick();
    if (elRef.current) elRef.current.style.cursor = onPick ? "crosshair" : "";
  }, [picked?.lat, picked?.lng, onPick, syncPick]);

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
