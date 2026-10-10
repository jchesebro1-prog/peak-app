"use client";

import { useEffect, useId, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { updateVisitAction } from "@/app/(app)/visit-booking-actions";
import { inviteSummary } from "@/lib/visit-invite-plan";
import BookingPanel from "./booking-panel";

export type VisitEditVM = {
  id: string;
  customerId: string | null;
  locationId: string | null;
  address: string;
  title: string;
  startAt: number;
  endAt: number;
  assignedTo: string;
  attendees: string[];
};

const inStyle: CSSProperties = { width: "100%", border: "1px solid #e4e7ec", borderRadius: 8, padding: "8px 11px", fontSize: 12.5, fontFamily: "var(--font-ui)", background: "#fff", color: "#16181d", outline: "none" };
const lbl: CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase", margin: "12px 0 5px" };
const p2 = (n: number) => String(n).padStart(2, "0");
const localDate = (ms: number) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const localTime = (ms: number) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const LENGTHS = [30, 60, 90, 120, 180, 240];

/** Spec 2026-10-09 site-visit scheduling — edit a scheduled visit: time,
 *  lead and attendees, with nearby days and live conflicts. Saving updates
 *  every invite (add / update / cancel). Nothing blocks Save. */
export default function VisitEditDialog({ visit, team, onClose }: { visit: VisitEditVM; team: string[]; onClose: () => void }) {
  const router = useRouter();
  const uid = useId();
  const [pending, startTransition] = useTransition();
  const initialLen = Math.max(15, Math.round((visit.endAt - visit.startAt) / 60_000));
  const [date, setDate] = useState(localDate(visit.startAt));
  const [time, setTime] = useState(localTime(visit.startAt));
  const [durationMin, setDurationMin] = useState(initialLen);
  const [lead, setLead] = useState(visit.assignedTo);
  const [attendees, setAttendees] = useState<string[]>(visit.attendees);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const startMs = new Date(`${date}T${time}:00`).getTime();
  const okStart = Number.isFinite(startMs) ? startMs : null;
  const lengths = LENGTHS.includes(initialLen) ? LENGTHS : [...LENGTHS, initialLen].sort((a, b) => a - b);
  const leads = team.includes(visit.assignedTo) ? team : [visit.assignedTo, ...team];

  // Escape closes, but never mid-save (the invites are being sent).
  useEffect(() => {
    if (pending) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  const save = () => {
    if (okStart == null) {
      setError("Pick a date and time.");
      return;
    }
    setError("");
    startTransition(async () => {
      const res = await updateVisitAction(visit.id, { startAt: okStart, endAt: okStart + durationMin * 60_000, assignedTo: lead, attendees });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(inviteSummary(res.invites) || "Saved.");
      router.refresh();
    });
  };

  return (
    <div onClick={() => { if (!pending) onClose(); }} style={{ position: "fixed", inset: 0, background: "rgba(22,24,29,.4)", zIndex: 90, display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit site visit"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 460, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,.22)", padding: "20px 22px" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, flex: 1 }}>Edit site visit</div>
          <button onClick={onClose} title="Close" style={{ border: "none", background: "transparent", color: "#c4c9d2", fontSize: 17, cursor: "pointer" }}>
            ✕
          </button>
        </div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 3 }}>{visit.title}</div>
        {done ? (
          <>
            <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 10, background: "#e8f3ee", border: "1px solid #cfe6db", color: "#1f7a52", fontSize: 12.5, lineHeight: 1.5 }}>{done}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button className="pk-btn-accent" onClick={onClose} style={{ fontSize: 12.5 }}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <label htmlFor={`${uid}-date`} style={lbl}>Date</label>
                <input id={`${uid}-date`} type="date" style={inStyle} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label htmlFor={`${uid}-start`} style={lbl}>Start</label>
                <input id={`${uid}-start`} type="time" style={inStyle} value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div>
                <label htmlFor={`${uid}-length`} style={lbl}>Length</label>
                <select id={`${uid}-length`} style={inStyle} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
                  {lengths.map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} hr${m > 60 ? "s" : ""}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label htmlFor={`${uid}-lead`} style={lbl}>Lead</label>
            <select
              id={`${uid}-lead`}
              style={inStyle}
              value={lead}
              onChange={(e) => {
                const next = e.target.value;
                setLead(next);
                setAttendees((a) => a.filter((n) => n !== next));
              }}
            >
              {leads.map((n) => (
                <option key={n} value={n} disabled={!n}>
                  {n || "Pick a lead"}
                </option>
              ))}
            </select>
            <BookingPanel
              visitId={visit.id}
              customerId={visit.customerId}
              locationId={visit.locationId}
              address={visit.address}
              startAt={okStart}
              endAt={okStart != null ? okStart + durationMin * 60_000 : null}
              lead={lead}
              team={team}
              attendees={attendees}
              onAttendeesChange={setAttendees}
              onPickDay={setDate}
            />
            {error && <div style={{ marginTop: 10, fontSize: 12, color: "#a03b2e" }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="pk-btn-outline" onClick={onClose} style={{ fontSize: 12.5 }}>
                Cancel
              </button>
              <button className="pk-btn-accent" onClick={save} disabled={pending} style={{ fontSize: 12.5, opacity: pending ? 0.7 : 1 }}>
                {pending ? "Saving…" : "Save & update invites"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
