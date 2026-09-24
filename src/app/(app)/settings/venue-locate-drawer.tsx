"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { LocateResult, UnlocatedVenue } from "@/lib/venue-locate";
import { locateVenueAction, searchVenueAddressAction, type VenueAddressHit } from "./actions";

const LeafletMap = dynamic(() => import("@/components/map/LeafletMap"), {
  ssr: false,
  loading: () => <div style={{ height: 260, background: "#f1f2f5", borderRadius: 10 }} />,
});

/** Human wording for a geocode failure — shared by the worklist and this sidebar. */
export function reasonLabel(reason: string, got?: string): string {
  if (reason === "no-hit") return "No match";
  if (reason === "state-mismatch") return `Resolved to ${got || "another state"} — wrong state`;
  if (reason === "city-mismatch") return `Resolved to ${got || "another town"} — wrong city`;
  if (reason === "gone") return "This venue was deleted";
  if (reason === "invalid") return "Coordinates out of range";
  return reason;
}

/** Wisconsin default when the stated town can't be resolved. */
const WI: [number, number] = [44.5, -89.5];

function fmtTravel(r: Extract<LocateResult, { ok: true }>): string {
  if (!r.officeName || r.source === "none" || r.miles == null)
    return "✓ Located. No quote origin set, so travel can't be computed.";
  const m = r.minutes ?? 0;
  const h = Math.floor(m / 60);
  const t = h ? `${h}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
  const how = r.source === "routed" ? "routed" : r.source === "manual" ? "manual" : "estimated";
  return `✓ Located · ${Math.round(r.miles).toLocaleString()} mi · ${t} from ${r.officeName} (${how})`;
}

/**
 * The fix-it sidebar (#169, D225): three ways to locate ONE venue — edit the
 * address and retry it through the batch's own gates, pick a search
 * suggestion, or drop a pin — each saved + routed immediately.
 */
export default function VenueLocateDrawer({
  venue,
  reason,
  hasNext,
  onNext,
  onClose,
  onLocated,
}: {
  venue: UnlocatedVenue;
  reason?: string;
  hasNext: boolean;
  onNext: () => void;
  onClose: () => void;
  onLocated: (siteId: string) => void;
}) {
  const [f, setF] = useState({ address: venue.address, city: venue.city, state: venue.state, zip: venue.zip });
  const [busy, setBusy] = useState<"" | "retry" | "pick" | "pin">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    reason ? { ok: false, text: reason } : null
  );
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VenueAddressHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [centre, setCentre] = useState<{ c: [number, number]; z: number }>({ c: WI, z: 6 });
  const [done, setDone] = useState(false);
  const noPins = useMemo(() => [], []);

  // Escape closes.
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // Centre the pin map on the stated town when it resolves.
  useEffect(() => {
    if (!venue.city) return;
    let live = true;
    void searchVenueAddressAction([venue.city, venue.state].filter(Boolean).join(", ")).then((h) => {
      if (live && h[0]) setCentre({ c: [h[0].lat, h[0].lng], z: 13 });
    });
    return () => {
      live = false;
    };
  }, [venue.city, venue.state]);

  // Debounced type-ahead. Short queries show nothing via `shown` below —
  // no synchronous setState in the effect (react-hooks/set-state-in-effect).
  const shown = query.trim().length >= 3 ? hits : [];
  useEffect(() => {
    if (query.trim().length < 3) return;
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      const h = await searchVenueAddressAction(query).catch(() => []);
      if (live) {
        setHits(h);
        setSearching(false);
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  const mapCenter = useMemo<[number, number]>(() => centre.c, [centre]);

  async function run(mode: "retry" | "pick" | "pin", input: Parameters<typeof locateVenueAction>[0]) {
    setBusy(mode);
    setMsg(null);
    try {
      const r = await locateVenueAction(input);
      if (r.ok) {
        setMsg({ ok: true, text: fmtTravel(r) });
        setDone(true);
        onLocated(venue.siteId);
      } else {
        const hint = r.reason === "no-hit" ? " Try again, or drop a pin." : "";
        setMsg({ ok: false, text: reasonLabel(r.reason, r.got) + "." + hint });
      }
    } catch {
      setMsg({ ok: false, text: "Lookup failed. Try again, or drop a pin." });
    } finally {
      setBusy("");
    }
  }

  const field = (k: keyof typeof f, label: string, w: string) => (
    <label style={{ display: "block", flex: w, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "#9aa0ab", marginBottom: 2 }}>{label}</div>
      <input
        className="pk-input"
        style={{ width: "100%", fontSize: 13 }}
        value={f[k]}
        disabled={done}
        onChange={(e) => setF({ ...f, [k]: e.target.value })}
      />
    </label>
  );
  const h3 = { fontSize: 12, fontWeight: 600, letterSpacing: 0.3, color: "#5d636e", margin: "18px 0 6px" } as const;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(22,24,29,.28)" }} />
      <aside
        role="dialog"
        aria-label="Locate venue"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(420px, 100vw)",
          background: "#fff",
          boxShadow: "-8px 0 24px rgba(0,0,0,.12)",
          overflowY: "auto",
          padding: "16px 18px 28px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <a
              href={`/companies/${encodeURIComponent(venue.companyId)}`}
              target="_blank"
              rel="noopener"
              style={{ fontSize: 15, fontWeight: 600, color: "inherit" }}
            >
              {venue.companyName}
            </a>
            <div style={{ fontSize: 12.5, color: "#9aa0ab" }}>{venue.venueName || "Untitled venue"}</div>
            <div style={{ fontSize: 12, color: "#5d636e", marginTop: 4 }}>
              {[venue.address, venue.city, [venue.state, venue.zip].filter(Boolean).join(" ")]
                .filter(Boolean)
                .join(", ") || "No address"}
            </div>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="pk-btn-quiet"
            style={{ marginLeft: "auto", fontSize: 18, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        {msg && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              borderRadius: 8,
              fontSize: 12.5,
              background: msg.ok ? "#eef7f0" : "#fbf0ee",
              color: msg.ok ? "#1f6b3a" : "#8a3a2a",
            }}
          >
            {msg.text}
          </div>
        )}
        {done && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {hasNext && (
              <button type="button" className="pk-btn" onClick={onNext}>
                Next venue →
              </button>
            )}
            <button type="button" className="pk-btn-quiet" onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {!done && (
          <>
            <div style={h3}>EDIT + RETRY</div>
            {field("address", "Street", "1 1 100%")}
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              {field("city", "City", "2 1 0")}
              {field("state", "State", "0 0 64px")}
              {field("zip", "Zip", "0 0 84px")}
            </div>
            <button
              type="button"
              className="pk-btn"
              style={{ marginTop: 8 }}
              disabled={!!busy || !(f.address.trim() || f.city.trim())}
              onClick={() => void run("retry", { siteId: venue.siteId, mode: "retry", ...f })}
            >
              {busy === "retry" ? "Looking up…" : "Retry"}
            </button>

            <div style={h3}>SEARCH</div>
            <input
              className="pk-input"
              style={{ width: "100%", fontSize: 13 }}
              placeholder="Type an address or place name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {searching && <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 4 }}>Searching…</div>}
            {!searching && query.trim().length >= 3 && shown.length === 0 && (
              <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 4 }}>
                No matches — try a shorter query, or drop a pin.
              </div>
            )}
            {shown.map((h, i) => (
              <button
                key={i}
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void run("pick", {
                    siteId: venue.siteId,
                    mode: "pick",
                    address: h.street,
                    city: h.city,
                    state: h.state,
                    zip: h.zip,
                    lat: h.lat,
                    lng: h.lng,
                  })
                }
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  marginTop: 4,
                  padding: "6px 8px",
                  border: "1px solid #ececf0",
                  borderRadius: 6,
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{h.title}</div>
                <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>{h.sub}</div>
              </button>
            ))}

            <div style={h3}>DROP A PIN</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginBottom: 6 }}>
              Click the building on the map; drag the pin to adjust.
            </div>
            <LeafletMap
              pins={noPins}
              height={260}
              center={mapCenter}
              zoom={centre.z}
              picked={pin}
              onPick={setPin}
            />
            <button
              type="button"
              className="pk-btn"
              style={{ marginTop: 8 }}
              disabled={!pin || !!busy}
              onClick={() => pin && void run("pin", { siteId: venue.siteId, mode: "pin", ...pin })}
            >
              {busy === "pin" ? "Saving…" : "Save location"}
            </button>
          </>
        )}
      </aside>
    </div>
  );
}
