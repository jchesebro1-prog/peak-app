"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveCustomerAction } from "./actions";
import type { SaveCustomerInput } from "./types";

export default function VenueQuickAdd({ initial, closeHref }: { initial: SaveCustomerInput; closeHref: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [locationName, setLocationName] = useState("");
  const [venueName, setVenueName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [error, setError] = useState("");
  const save = () => startTransition(async () => {
    if (!venueName.trim() && !locationName.trim()) { setError("Add a location or venue name."); return; }
    const result = await saveCustomerAction({ ...initial, locations: [...initial.locations, { id: `l${Date.now()}`, label: venueName.trim() || locationName.trim(), primary: initial.locations.length === 0, address, city, state, lat: null, lng: null, venueKind: "proscenium", travelMiles: null, travelMin: null }] });
    if (!result.ok) setError("Could not save this venue.");
    else { router.push(closeHref); router.refresh(); }
  });
  const input = { width: "100%", boxSizing: "border-box" as const, border: "1px solid #e4e7ec", borderRadius: 8, padding: "10px 11px", fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", background: "#fff" };
  return <div onClick={() => router.push(closeHref)} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(16,22,30,.46)", display: "grid", placeItems: "center", padding: 24 }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 500, maxWidth: "100%", background: "#fff", borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.32)", padding: 22 }}>
      <div style={{ fontSize: 17, fontWeight: 700 }}>Add location &amp; venue</div>
      <div style={{ marginTop: 5, color: "#737985", fontSize: 12.5, lineHeight: 1.45 }}>Keep the company, location/campus, and venue as separate fields so site surveys, estimates, and compliance can attach to the venue.</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 18 }}>
        <label><span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#737985", textTransform: "uppercase", marginBottom: 6 }}>Location / campus</span><input value={locationName} onChange={e => setLocationName(e.target.value)} placeholder="High School" style={input} /></label>
        <label><span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#737985", textTransform: "uppercase", marginBottom: 6 }}>Venue / space</span><input autoFocus value={venueName} onChange={e => setVenueName(e.target.value)} placeholder="Main space" style={input} /></label>
      </div>
      <label style={{ display: "block", marginTop: 13 }}><span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#737985", textTransform: "uppercase", marginBottom: 6 }}>Address</span><input value={address} onChange={e => setAddress(e.target.value)} placeholder="Street address" style={input} /></label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 12, marginTop: 12 }}><input value={city} onChange={e => setCity(e.target.value)} placeholder="City" style={input} /><input value={state} onChange={e => setState(e.target.value)} placeholder="State" style={input} /></div>
      {error && <div style={{ marginTop: 10, color: "#b4543a", fontSize: 12 }}>{error}</div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 19 }}><button type="button" onClick={() => router.push(closeHref)} style={{ border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, padding: "9px 12px", cursor: "pointer" }}>Cancel</button><button type="button" onClick={save} disabled={busy} style={{ border: "none", background: "var(--accent)", color: "#fff", borderRadius: 8, padding: "9px 13px", fontWeight: 700, cursor: "pointer" }}>{busy ? "Saving…" : "Add venue"}</button></div>
    </div>
  </div>;
}
