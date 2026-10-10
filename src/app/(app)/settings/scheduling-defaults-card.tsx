"use client";

import { useState, useTransition } from "react";
import WorkHoursEditor from "@/components/visit-booking/work-hours-editor";
import type { SchedulingSettings } from "@/lib/visit-plan/settings";
import { saveSchedulingSettingsAction } from "./actions";

const row = { display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" } as const;
const lbl = { fontSize: 12.5, fontWeight: 600, minWidth: 150 } as const;
const unit = { fontSize: 12, color: "#9aa0ab" } as const;

/** Spec 2026-10-09 site-visit scheduling — company scheduling settings. */
export function SchedulingDefaultsCard({ initial }: { initial: SchedulingSettings }) {
  const [hours, setHours] = useState(initial.workHours);
  const [sameArea, setSameArea] = useState(String(initial.sameAreaMin));
  const [limitH, setLimitH] = useState(String(initial.dailyDriveLimitMin / 60));
  const [look, setLook] = useState(String(initial.nearbyLookaheadDays));
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const save = () =>
    startTransition(async () => {
      setMsg("");
      setError("");
      // The exact minutes — never rounded here; the server refuses a bad value.
      const limitMin = limitH.trim() === "" ? "" : Math.round(Number(limitH) * 60 * 1e6) / 1e6;
      if (limitMin !== "" && !Number.isInteger(limitMin)) {
        setError("Daily drive limit must be a whole number of minutes (e.g. 4.5 hours).");
        return;
      }
      const r = await saveSchedulingSettingsAction({
        workHours: hours,
        sameAreaMin: sameArea.trim() === "" ? "" : Number(sameArea),
        dailyDriveLimitMin: limitMin,
        nearbyLookaheadDays: look.trim() === "" ? "" : Number(look),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setHours(r.settings.workHours);
      setSameArea(String(r.settings.sameAreaMin));
      setLimitH(String(r.settings.dailyDriveLimitMin / 60));
      setLook(String(r.settings.nearbyLookaheadDays));
      setMsg("Saved");
    });
  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>Site-visit scheduling</div>
      <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
        Used to flag conflicts and suggest nearby days while booking. Nothing is ever moved or blocked.
      </div>
      <div style={row}>
        <span style={lbl}>Work hours (default)</span>
        <WorkHoursEditor value={hours} onChange={setHours} disabled={pending} />
      </div>
      <div style={row}>
        <span style={lbl}>Same area</span>
        <input type="number" min={5} max={180} className="pk-input" style={{ width: 80, fontSize: 12.5 }} disabled={pending} value={sameArea} onChange={(e) => setSameArea(e.target.value)} />
        <span style={unit}>drive minutes</span>
      </div>
      <div style={row}>
        <span style={lbl}>Daily drive limit</span>
        <input type="number" min={0.5} max={16} step={0.5} className="pk-input" style={{ width: 80, fontSize: 12.5 }} disabled={pending} value={limitH} onChange={(e) => setLimitH(e.target.value)} />
        <span style={unit}>hours, buffer included</span>
      </div>
      <div style={row}>
        <span style={lbl}>Nearby days look ahead</span>
        <input type="number" min={1} max={60} className="pk-input" style={{ width: 80, fontSize: 12.5 }} disabled={pending} value={look} onChange={(e) => setLook(e.target.value)} />
        <span style={unit}>days</span>
      </div>
      <div style={{ ...row, marginTop: 14 }}>
        <button className="pk-btn-accent" style={{ fontSize: 12.5 }} disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </button>
        {msg && <span style={{ fontSize: 11, color: "#1f7a52" }}>{msg}</span>}
        {error && <span style={{ fontSize: 11, color: "#b42318" }}>{error}</span>}
      </div>
    </div>
  );
}
