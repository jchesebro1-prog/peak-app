"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LocateResult, UnlocatedVenue } from "@/lib/venue-locate";
import { locateVenueAction, searchVenueAddressAction, townCentreAction, type VenueAddressHit } from "./actions";

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
  const office = r.precision === "city" ? `${r.officeName} · town centre` : r.officeName;
  return `✓ Located · ${Math.round(r.miles).toLocaleString()} mi · ${t} from ${office} (${how})`;
}

/**
 * The fix-it sidebar (#175, D228): three ways to locate ONE venue — edit the
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
  onGone,
}: {
  venue: UnlocatedVenue;
  reason?: string;
  hasNext: boolean;
  onNext: () => void;
  onClose: () => void;
  onLocated: (siteId: string) => void;
  onGone: (siteId: string) => void;
}) {
  const [f, setF] = useState({ address: venue.address, city: venue.city, state: venue.state, zip: venue.zip });
  const [busy, setBusy] = useState<"" | "retry" | "pick" | "pin">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(
    reason ? { ok: false, text: reason } : null
  );
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<VenueAddressHit[]>([]);
  // The query `hits` belongs to — lets stale type-ahead results be told apart
  // from the query currently in the box (#175 review).
  const [hitsFor, setHitsFor] = useState("");
  const [searching, setSearching] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [centre, setCentre] = useState<{ c: [number, number]; z: number }>({ c: WI, z: 6 });
  const [done, setDone] = useState(false);
  const noPins = useMemo(() => [], []);
  // Set (not during render) the moment a pin is dropped, so the town-centre
  // lookup below knows not to yank the map away from a placed pin.
  const pinPlacedRef = useRef(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Escape closes.
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // Dialog focus: move focus into the sidebar on open, restore it on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Centre the pin map on the stated town when it resolves — but never once
  // the user has already dropped a pin (#175 review: this used to yank the
  // map out from under a placed pin if it resolved late). Uses the gated
  // town-centre lookup (item 3), not a free-text search, which put
  // "DePere, WI" on Menasha; on a miss the Wisconsin default stands.
  useEffect(() => {
    if (!venue.city) return;
    let live = true;
    townCentreAction(venue.city, venue.state)
      .then((p) => {
        if (live && !pinPlacedRef.current && p) setCentre({ c: [p.lat, p.lng], z: 13 });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [venue.city, venue.state]);

  function handlePick(p: { lat: number; lng: number }) {
    pinPlacedRef.current = true;
    setPin(p);
  }

  // Debounced type-ahead. `hitsFor` (not just `hits`) tracks which query the
  // results belong to, so a fast typist never sees the previous query's
  // clickable hits, and "No matches" never flashes before a new search has
  // even started (#175 review). No synchronous setState in the effect body
  // (react-hooks/set-state-in-effect) — the state writes below happen inside
  // the debounce timer's callback.
  const trimmedQuery = query.trim();
  const shown = hitsFor === trimmedQuery ? hits : [];
  const showSearching = trimmedQuery.length >= 3 && hitsFor !== trimmedQuery;
  const showNoMatches = trimmedQuery.length >= 3 && hitsFor === trimmedQuery && !searching && hits.length === 0;
  useEffect(() => {
    if (query.trim().length < 3) return;
    let live = true;
    const t = setTimeout(async () => {
      setSearching(true);
      const q = query.trim();
      const h = await searchVenueAddressAction(query).catch(() => []);
      if (live) {
        setHits(h);
        setHitsFor(q);
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
        // Deleted meanwhile (spec §4): the sidebar says so, and the list
        // drops the row — same as a fix, just no ✓ state here.
        if (r.reason === "gone") {
          onGone(venue.siteId);
          setDone(true);
        }
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
        aria-modal="true"
        aria-label="Locate venue"
        className="pk-locate-drawer"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
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
            ref={closeBtnRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              marginLeft: "auto",
              fontSize: 18,
              lineHeight: 1,
              background: "none",
              border: 0,
              cursor: "pointer",
            }}
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
              <button type="button" className="pk-btn-accent" onClick={onNext}>
                Next venue →
              </button>
            )}
            <button type="button" className="pk-btn-outline" onClick={onClose}>
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
              className="pk-btn-accent"
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
            {showSearching && <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 4 }}>Searching…</div>}
            {showNoMatches && (
              <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 4 }}>
                No matches — try a shorter query, or drop a pin.
              </div>
            )}
            {shown.map((h, i) => {
              // A hit with no house number is a town/area match, not a
              // building — still clickable (the server now protects the
              // stored address either way, item 2), but flagged so a human
              // doesn't mistake it for a precise pick.
              const townOnly = !/\d/.test(h.street || "");
              return (
                <button
                  key={`${h.lat},${h.lng},${i}`}
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
                  {townOnly && (
                    <div style={{ fontSize: 11, color: "#b7bcc4", marginTop: 2 }}>
                      (town / area — no street)
                    </div>
                  )}
                </button>
              );
            })}

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
              onPick={handlePick}
            />
            <button
              type="button"
              className="pk-btn-accent"
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
