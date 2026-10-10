"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FixTarget, FixTargetDetails, GeoStatus } from "@/lib/address-verify/types";
import {
  fixAddressAction,
  loadFixTargetAction,
  searchAddressAction,
  townCentreForFixAction,
  type AddressHit,
} from "@/app/(app)/address-actions";

// The app's one shared map (Leaflet + CARTO tiles), in pick mode. Leaflet
// touches window at import, so it loads client-only.
const LeafletMap = dynamic(() => import("@/components/map/LeafletMap"), {
  ssr: false,
  loading: () => <div style={{ height: 260, background: "#f1f2f5", borderRadius: 10 }} />,
});

/** Human wording for a lookup failure — shared with the Settings worklist. */
export function reasonLabel(reason: string, got?: string): string {
  if (reason === "no-hit") return "No match";
  if (reason === "state-mismatch") return `Resolved to ${got || "another state"} — wrong state`;
  if (reason === "city-mismatch") return `Resolved to ${got || "another town"} — wrong city`;
  if (reason === "gone") return "This venue was deleted";
  if (reason === "invalid") return "That didn’t look like a usable address or point";
  if (reason === "unavailable") return "The address lookup is unavailable right now";
  if (reason === "kept-pin") return "Kept your pin — the search found only a town-level match";
  return reason;
}

/** Wisconsin default when the stated town can't be resolved. */
const WI: [number, number] = [44.5, -89.5];
type Busy = "" | "retry" | "pick" | "pin";

/**
 * The Fix dialog (spec "Fixing an address"): retype and re-run the geocoder,
 * pick a suggestion, or drop/drag a pin. A venue fix writes the venue; any
 * other address writes the place book, so the same text never flags again.
 * Rendered through a portal so it can open from inside calendar blocks and
 * other clipped/clickable containers. Generalized from the #175 venue-only
 * locate drawer (same three sections, same map and type-ahead behaviour).
 */
export default function AddressFixDrawer({
  target,
  reason,
  hasNext,
  onNext,
  onClose,
  onFixed,
  onGone,
  zIndex = 60,
}: {
  target: FixTarget;
  reason?: string;
  hasNext?: boolean;
  onNext?: () => void;
  onClose: () => void;
  onFixed?: (status: GeoStatus) => void;
  onGone?: () => void;
  /** Stacking level — a caller inside a higher overlay (e.g. a modal) passes a larger one. */
  zIndex?: number;
}) {
  const [details, setDetails] = useState<FixTargetDetails | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [f, setF] = useState({ address: "", city: "", state: "", zip: "" });
  const [text, setText] = useState(target.kind === "place" ? target.label : "");
  const [busy, setBusy] = useState<Busy>("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(reason ? { ok: false, text: reason } : null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AddressHit[]>([]);
  // The query `hits` belongs to — a fast typist never sees the previous
  // query's clickable hits, and "No matches" never flashes early (#175).
  const [hitsFor, setHitsFor] = useState("");
  const [searching, setSearching] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [centre, setCentre] = useState<{ c: [number, number]; z: number }>({ c: WI, z: 6 });
  const [done, setDone] = useState(false);
  const noPins = useMemo(() => [], []);
  // Set the moment a pin is dropped, so a late town-centre lookup never
  // yanks the map out from under a placed pin.
  const pinPlacedRef = useRef(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Escape closes.
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  // Dialog focus: into the drawer on open, back where it was on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Load what we're fixing; centre the pin map on the venue's stated town.
  useEffect(() => {
    let live = true;
    loadFixTargetAction(target)
      .then((d) => {
        if (!live) return;
        if (!d) {
          setLoadFailed(true);
          return;
        }
        setDetails(d);
        if (d.venue) {
          setF(d.venue);
          if (d.venue.city)
            townCentreForFixAction(d.venue.city, d.venue.state)
              .then((p) => {
                if (live && !pinPlacedRef.current && p) setCentre({ c: [p.lat, p.lng], z: 13 });
              })
              .catch(() => {});
        } else if (d.placeText) {
          // A place address has no stated town: look the text up once and open
          // over it. Nothing found → the default view stays.
          searchAddressAction(d.placeText, 1)
            .then((hits) => {
              const h = hits[0];
              if (live && !pinPlacedRef.current && h) setCentre({ c: [h.lat, h.lng], z: 13 });
            })
            .catch(() => {});
        }
      })
      .catch(() => {
        if (live) setLoadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [target]);

  // Debounced type-ahead; state writes happen in the timer, not the effect body.
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
      const h = await searchAddressAction(q).catch(() => []);
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

  async function run(mode: Exclude<Busy, "">, input: Record<string, unknown>) {
    setBusy(mode);
    setMsg(null);
    try {
      const r = await fixAddressAction({ target, mode, ...input });
      if (r.ok && r.status === "verified") {
        setMsg({ ok: true, text: "✓ Verified — drive time will use this address." });
        setDone(true);
        onFixed?.(r.status);
      } else if (r.ok) {
        setMsg({ ok: false, text: "Found the town or street only — drop a pin on the building to verify." });
        onFixed?.(r.status);
      } else {
        setMsg({ ok: false, text: reasonLabel(r.reason, r.got) + "." + (r.reason === "no-hit" ? " Try again, or drop a pin." : "") });
        if (r.reason === "gone") {
          setDone(true);
          onGone?.();
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
      <input className="pk-input" style={{ width: "100%", fontSize: 13 }} value={f[k]} disabled={done} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );
  const h3 = { fontSize: 12, fontWeight: 600, letterSpacing: 0.3, color: "#5d636e", margin: "18px 0 6px" } as const;
  const addressLine = details?.venue
    ? [details.venue.address, details.venue.city, [details.venue.state, details.venue.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : details?.placeText || "";

  if (typeof document === "undefined") return null;
  const ui = (
    // Clicks inside never reach the block / row the dialog was opened from.
    <div onClick={(e) => e.stopPropagation()} style={{ position: "fixed", inset: 0, zIndex, fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(22,24,29,.28)" }} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Fix address"
        className="pk-locate-drawer"
        style={{ position: "absolute", top: 0, right: 0, bottom: 0, background: "#fff", boxShadow: "-8px 0 24px rgba(0,0,0,.12)", overflowY: "auto", padding: "16px 18px 28px" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            {details?.href ? (
              <a href={details.href} target="_blank" rel="noopener" style={{ fontSize: 15, fontWeight: 600, color: "inherit" }}>
                {details.title}
              </a>
            ) : (
              <div style={{ fontSize: 15, fontWeight: 600 }}>{details?.title || (loadFailed ? "This address is no longer here" : "Loading…")}</div>
            )}
            <div style={{ fontSize: 12.5, color: "#9aa0ab" }}>{details?.sub}</div>
            <div style={{ fontSize: 12, color: "#5d636e", marginTop: 4 }}>{addressLine || (details ? "No address" : "")}</div>
          </div>
          <button ref={closeBtnRef} type="button" aria-label="Close" onClick={onClose} style={{ marginLeft: "auto", fontSize: 18, lineHeight: 1, background: "none", border: 0, cursor: "pointer" }}>
            ×
          </button>
        </div>

        {msg && (
          <div
            role="status"
            style={{ marginTop: 12, padding: "8px 10px", borderRadius: 8, fontSize: 12.5, background: msg.ok ? "#eef7f0" : "#fbf0ee", color: msg.ok ? "#1f6b3a" : "#8a3a2a" }}
          >
            {msg.text}
          </div>
        )}
        {done && (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {hasNext && onNext && (
              <button type="button" className="pk-btn-accent" onClick={onNext}>
                Next address →
              </button>
            )}
            <button type="button" className="pk-btn-outline" onClick={onClose}>
              Close
            </button>
          </div>
        )}

        {!done && details && (
          <>
            <div style={h3}>RETYPE + RETRY</div>
            {details.venue ? (
              <>
                {field("address", "Street", "1 1 100%")}
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  {field("city", "City", "2 1 0")}
                  {field("state", "State", "0 0 64px")}
                  {field("zip", "Zip", "0 0 84px")}
                </div>
              </>
            ) : (
              <input
                className="pk-input"
                aria-label="Address"
                style={{ width: "100%", fontSize: 13 }}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Street, city, state"
              />
            )}
            <button
              type="button"
              className="pk-btn-accent"
              style={{ marginTop: 8 }}
              disabled={!!busy || (details.venue ? !(f.address.trim() || f.city.trim()) : text.trim().length < 3)}
              onClick={() => void run("retry", details.venue ? { ...f } : { text })}
            >
              {busy === "retry" ? "Looking up…" : "Retry"}
            </button>

            <div style={h3}>SEARCH</div>
            <input
              className="pk-input"
              aria-label="Search for an address"
              style={{ width: "100%", fontSize: 13 }}
              placeholder="Type an address or place name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {showSearching && <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 4 }}>Searching…</div>}
            {showNoMatches && <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 4 }}>No matches — try a shorter query, or drop a pin.</div>}
            {shown.map((h, i) => (
              <button
                key={`${h.lat},${h.lng},${i}`}
                type="button"
                disabled={!!busy}
                onClick={() =>
                  void run(
                    "pick",
                    details.venue
                      ? { address: h.street, city: h.city, state: h.state, zip: h.zip, lat: h.lat, lng: h.lng }
                      : { street: h.street, lat: h.lat, lng: h.lng }
                  )
                }
                style={{ display: "block", width: "100%", textAlign: "left", marginTop: 4, padding: "6px 8px", border: "1px solid #ececf0", borderRadius: 6, background: "#fff", cursor: "pointer" }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{h.title}</div>
                <div style={{ fontSize: 11.5, color: "#9aa0ab" }}>{h.sub}</div>
                {/* A hit with no house number is a town/area match — still pickable, but it won't verify. */}
                {!/\d/.test(h.street || "") && <div style={{ fontSize: 11, color: "#b7bcc4", marginTop: 2 }}>(town / area — no street number)</div>}
              </button>
            ))}

            <div style={h3}>DROP A PIN</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginBottom: 6 }}>Click the building on the map; drag the pin to adjust.</div>
            <LeafletMap
              pins={noPins}
              height={260}
              center={mapCenter}
              zoom={centre.z}
              picked={pin}
              onPick={(p) => {
                pinPlacedRef.current = true;
                setPin(p);
              }}
            />
            <button type="button" className="pk-btn-accent" style={{ marginTop: 8 }} disabled={!pin || !!busy} onClick={() => pin && void run("pin", { ...pin })}>
              {busy === "pin" ? "Saving…" : "Save location"}
            </button>
          </>
        )}
      </aside>
    </div>
  );
  return createPortal(ui, document.body);
}
