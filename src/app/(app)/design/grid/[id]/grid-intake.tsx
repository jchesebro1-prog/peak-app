"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveGridIntakeAction } from "./actions";

export default function GridIntake({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [venueName, setVenueName] = useState("");
  const [locationName, setLocationName] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [measurementBased, setMeasurementBased] = useState(true);
  const [error, setError] = useState("");
  const save = () => startTransition(async () => {
    const result = await saveGridIntakeAction({ projectId, venueName, locationName, address, notes, measurementBased });
    if (!result.ok) setError(result.error);
    else router.refresh();
  });
  const input = { width: "100%", boxSizing: "border-box" as const, border: "1px solid #e4e7ec", borderRadius: 8, padding: "10px 11px", fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", background: "#fff" };
  return <div style={{ minHeight: "100%", background: "#f7f8fa", padding: "54px 22px" }}>
    <div style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--accent)" }}>The Grid · design intake</div>
      <h1 style={{ margin: "10px 0 8px", fontSize: 30, letterSpacing: "-.025em" }}>{projectName}</h1>
      <p style={{ margin: 0, color: "#737985", fontSize: 14, lineHeight: 1.55 }}>Start with the venue cover page. Existing customer and venue information can be carried into the design; new venues can be captured here before you lay out the system.</p>
      <div style={{ marginTop: 26, background: "#fff", border: "1px solid #ececf0", borderRadius: 14, padding: 22, boxShadow: "0 1px 2px rgba(0,0,0,.04)" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14 }}>
          <label><span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#737985", textTransform: "uppercase", marginBottom: 6 }}>Location / campus</span><input value={locationName} onChange={e => setLocationName(e.target.value)} placeholder="High School" style={input} /></label>
          <label><span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#737985", textTransform: "uppercase", marginBottom: 6 }}>Venue / space</span><input value={venueName} onChange={e => setVenueName(e.target.value)} placeholder="Main space" style={input} /></label>
        </div>
        <label style={{ display: "block", marginTop: 16 }}><span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#737985", textTransform: "uppercase", marginBottom: 6 }}>Address</span><input value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, city, state" style={input} /></label>
        <label style={{ display: "block", marginTop: 16 }}><span style={{ display: "block", fontSize: 10, fontWeight: 700, color: "#737985", textTransform: "uppercase", marginBottom: 6 }}>Design notes</span><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Audience, stage, access, existing system notes…" style={{ ...input, minHeight: 100, resize: "vertical" }} /></label>
        <label style={{ display: "flex", alignItems: "center", gap: 9, marginTop: 18, fontSize: 13, color: "#3a3f4a", cursor: "pointer" }}><input type="checkbox" checked={measurementBased} onChange={e => setMeasurementBased(e.target.checked)} /> Generate the design from measurements as I work</label>
        {error && <div style={{ marginTop: 12, color: "#b4543a", fontSize: 12 }}>{error}</div>}
        <button type="button" onClick={save} disabled={busy} style={{ marginTop: 22, width: "100%", border: "none", borderRadius: 9, padding: "12px 16px", background: "var(--accent)", color: "#fff", fontSize: 13.5, fontWeight: 700, cursor: busy ? "wait" : "pointer" }}>{busy ? "Saving…" : "Continue to design →"}</button>
      </div>
    </div>
  </div>;
}
