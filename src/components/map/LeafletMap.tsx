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
  /** The record this pin belongs to, when the id itself isn't that record's
   *  id (e.g. the companies map's pin id is companyId+locId) — lets a
   *  caller recover it without parsing `id` (companies map, D-none). */
  companyId?: string;
  /** Bigger radius + accent ring — the companies map's "this pin is the
   *  selected company" state. */
  selected?: boolean;
};

/** Fly the map to one or more points (list click / venue click) without
 *  touching the fitMode bounds-fit. Bump `nonce` to refire on a reselect of
 *  the same point(s). */
export type MapFocusRequest = {
  points: Array<{ lat: number; lng: number }>;
  zoom?: number;
  nonce: number;
};

export default function LeafletMap({
  pins,
  height = 320,
  center,
  zoom,
  picked,
  onPick,
  onPinClick,
  fitMode = "auto",
  focus,
  preferCanvas,
}: {
  pins: MapPin[];
  /** Number = px (existing callers); string ("100%") lets the companies
   *  map fill a flex parent instead of a fixed pixel height. */
  height?: number | string;
  center?: [number, number];
  zoom?: number;
  /** Pick mode (#175): one draggable pin at `picked`; a map click or a pin
   *  drag reports the point through `onPick`. Absent => display-only, as
   *  every other map in the app uses it. */
  picked?: { lat: number; lng: number } | null;
  onPick?: (p: { lat: number; lng: number }) => void;
  /** Called instead of navigating to `href` when a pin is clicked (the
   *  companies map's pop-out panel). Absent => every pin with an `href`
   *  navigates on click, exactly as before. */
  onPinClick?: (pin: MapPin) => void;
  /** "auto" (default, unchanged): fitBounds on every `pins` change — every
   *  existing caller keeps this. "once": fit only the first time `pins`
   *  arrives non-empty, never again — the companies map filters ~1,300
   *  points in memory on every keystroke and must never yank the user's
   *  pan/zoom back to a full-book fit. */
  fitMode?: "auto" | "once";
  focus?: MapFocusRequest | null;
  /** Leaflet's canvas renderer instead of SVG — cheaper with hundreds of
   *  markers. Only read at map creation. */
  preferCanvas?: boolean;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMapType | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const pickMarkerRef = useRef<import("leaflet").Marker | null>(null);
  const onPickRef = useRef(onPick);
  const pickedRef = useRef(picked);
  const onPinClickRef = useRef(onPinClick);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const firstFitDoneRef = useRef(false);
  const focusNonceRef = useRef<number | null>(null);
  useEffect(() => {
    onPickRef.current = onPick;
    pickedRef.current = picked;
    onPinClickRef.current = onPinClick;
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
          preferCanvas: !!preferCanvas,
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
        const selBoost = p.selected ? 6 : 0;
        const marker = L.circleMarker([p.lat, p.lng], {
          radius: size / 2 + (p.ring ? 2 : 0) + selBoost,
          color: p.selected ? "var(--accent)" : p.ring ? p.color || "var(--accent)" : "#ffffff",
          weight: p.selected ? 4 : p.ring ? 3 : 2,
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
        if (p.href || onPinClickRef.current) {
          marker.on("click", () => {
            if (onPinClickRef.current) onPinClickRef.current(p);
            else if (p.href) window.location.href = p.href!;
          });
        }
        marker.addTo(layer);
      });
      if (center) {
        mapRef.current!.setView(center, zoom ?? 8);
      } else if (fitMode === "once") {
        if (!firstFitDoneRef.current) {
          if (valid.length) {
            const bounds = L.latLngBounds(valid.map((p) => [p.lat, p.lng]));
            mapRef.current!.fitBounds(bounds.pad(0.18), { maxZoom: 10 });
            firstFitDoneRef.current = true;
          } else {
            mapRef.current!.setView([44.5, -89.5], 6); // Wisconsin
          }
        }
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
  }, [pins, center, zoom, syncPick, fitMode, preferCanvas]);

  /* Fly to a caller-requested focus (list click / venue click) — independent
   * of the fit-on-draw logic above, so filtering never fights a fly-to. */
  useEffect(() => {
    if (!focus || focus.nonce === focusNonceRef.current) return;
    focusNonceRef.current = focus.nonce;
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const valid = focus.points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
    if (!valid.length) return;
    if (valid.length === 1) {
      map.flyTo([valid[0].lat, valid[0].lng], focus.zoom ?? 15, { duration: 0.6 });
    } else {
      const bounds = L.latLngBounds(valid.map((p) => [p.lat, p.lng]));
      map.flyToBounds(bounds.pad(0.25), { maxZoom: focus.zoom ?? 13, duration: 0.6 });
    }
  }, [focus]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      pickMarkerRef.current = null;
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
