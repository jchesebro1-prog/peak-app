"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import {
  addCalendarEventAction,
  deleteCalendarEventAction,
  getCalendarEventAction,
  searchPeopleAction,
  updateCalendarEventAction,
} from "../calendar-actions";
import { RECURRENCE_PRESETS } from "@/lib/google/recurrence";

/**
 * Unified create/edit event modal (S13 full-build). One component for both
 * because they need the same fields; "create" seeds from a clicked
 * day/slot, "edit" fetches full detail (recurrence/attendees/description
 * aren't in the lean merged-agenda feed) on open. Only Google events are
 * editable here — Peak site-visit items with no mirrored Google event have
 * no event id to act on and never reach this component (see calendar-client
 * click handling).
 */

export type EventModalTarget =
  | { mode: "create"; startMs: number; endMs: number; allDay: boolean }
  | { mode: "edit"; eventId: string };

type Attendee = { email: string; name: string };

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(16,18,22,0.32)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  padding: "8vh 16px",
  zIndex: 60,
};

const card: CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  width: 460,
  maxWidth: "100%",
  maxHeight: "82vh",
  overflowY: "auto",
  boxShadow: "0 20px 60px rgba(16,18,22,0.24)",
  padding: "18px 20px 20px",
};

const label: CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  margin: "12px 0 4px",
};

const field: CSSProperties = {
  width: "100%",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 12.5,
  fontFamily: "var(--font-ui)",
  background: "#fff",
  color: "#16181d",
  outline: "none",
  boxSizing: "border-box",
};

function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function toTimeInput(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function fromDateTimeInput(date: string, time: string, allDay: boolean): number {
  return new Date(`${date}T${allDay ? "00:00" : time || "00:00"}:00`).getTime();
}

export default function EventModal({
  target,
  onClose,
}: {
  target: EventModalTarget;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(target.mode === "edit");
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [title, setTitle] = useState("");
  const [allDay, setAllDay] = useState(target.mode === "create" ? target.allDay : false);
  const [startDate, setStartDate] = useState(target.mode === "create" ? toDateInput(target.startMs) : "");
  const [startTime, setStartTime] = useState(target.mode === "create" ? toTimeInput(target.startMs) : "09:00");
  const [endDate, setEndDate] = useState(target.mode === "create" ? toDateInput(target.endMs) : "");
  const [endTime, setEndTime] = useState(target.mode === "create" ? toTimeInput(target.endMs) : "10:00");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [recurrence, setRecurrence] = useState("");
  const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [htmlLink, setHtmlLink] = useState("");
  const [meetingUrl, setMeetingUrl] = useState("");

  const [attendeeQuery, setAttendeeQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Attendee[]>([]);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (target.mode !== "edit") return;
    let cancelled = false;
    (async () => {
      const r = await getCalendarEventAction(target.eventId);
      if (cancelled) return;
      if (!r.ok) {
        setLoadErr(r.error);
        setLoading(false);
        return;
      }
      const e = r.event;
      setTitle(e.title === "(no title)" ? "" : e.title);
      setAllDay(e.allDay);
      setStartDate(toDateInput(e.startMs));
      setStartTime(toTimeInput(e.startMs));
      setEndDate(toDateInput(e.allDay ? e.endMs - 86_400_000 : e.endMs));
      setEndTime(toTimeInput(e.endMs));
      setLocation(e.location);
      setDescription(e.description);
      setHtmlLink(e.htmlLink);
      setMeetingUrl(e.meetingUrl);
      setAttendees(e.attendees.map((a) => ({ email: a.email, name: a.name })));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => {
    const q = attendeeQuery.trim();
    if (!q) return;
    const seq = ++searchSeq.current;
    const t = setTimeout(async () => {
      const matches = await searchPeopleAction(q);
      if (searchSeq.current !== seq) return;
      setSuggestions(matches.filter((m) => !attendees.some((a) => a.email === m.email)));
    }, 180);
    return () => clearTimeout(t);
  }, [attendeeQuery, attendees]);

  // Render-time derivation instead of clearing `suggestions` state from the
  // effect above on every keystroke back to empty (avoids a setState-in-
  // effect cascade for the common "cleared the input" case).
  const visibleSuggestions = attendeeQuery.trim() ? suggestions : [];

  const emailPattern = useMemo(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/, []);

  function addAttendee(email: string, name?: string) {
    const e = email.trim().toLowerCase();
    if (!e || !emailPattern.test(e)) return;
    if (attendees.some((a) => a.email === e)) return;
    setAttendees((prev) => [...prev, { email: e, name: name || e }]);
    setAttendeeQuery("");
    setSuggestions([]);
  }

  function removeAttendee(email: string) {
    setAttendees((prev) => prev.filter((a) => a.email !== email));
  }

  function save() {
    setErr(null);
    const startAt = fromDateTimeInput(startDate, startTime, allDay);
    const endAt = fromDateTimeInput(endDate || startDate, endTime, allDay);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
      setErr("Bad date/time");
      return;
    }
    const input = {
      title,
      startAt,
      endAt,
      allDay,
      location: location.trim(),
      description: description.trim(),
      recurrencePreset: recurrence,
      attendeeEmails: attendees.map((a) => a.email),
    };
    startTransition(async () => {
      const r =
        target.mode === "create"
          ? await addCalendarEventAction(input)
          : await updateCalendarEventAction(target.eventId, input);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  function doDelete() {
    if (target.mode !== "edit") return;
    startTransition(async () => {
      const r = await deleteCalendarEventAction(target.eventId);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={card} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>
            {target.mode === "create" ? "New event" : "Edit event"}
          </div>
          <button
            onClick={onClose}
            className="pk-btn-outline"
            style={{ fontSize: 12, padding: "3px 9px" }}
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ padding: "30px 0", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            Loading…
          </div>
        ) : loadErr ? (
          <div style={{ padding: "16px 0", color: "#c4432f", fontSize: 12.5 }}>{loadErr}</div>
        ) : (
          <>
            <label style={label}>Title</label>
            <input style={field} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title" />

            <label style={{ ...label, display: "flex", alignItems: "center", gap: 6, textTransform: "none", fontSize: 12 }}>
              <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
              All day
            </label>

            <div style={{ display: "grid", gridTemplateColumns: allDay ? "1fr" : "1fr 1fr", gap: 10 }}>
              <div>
                <label style={label}>Start</label>
                <input type="date" style={field} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              {!allDay && (
                <div>
                  <label style={label}>&nbsp;</label>
                  <input type="time" style={field} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                </div>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: allDay ? "1fr" : "1fr 1fr", gap: 10 }}>
              <div>
                <label style={label}>End</label>
                <input type="date" style={field} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              {!allDay && (
                <div>
                  <label style={label}>&nbsp;</label>
                  <input type="time" style={field} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
                </div>
              )}
            </div>

            <label style={label}>Location</label>
            <input style={field} value={location} onChange={(e) => setLocation(e.target.value)} />

            <label style={label}>Description</label>
            <textarea
              style={{ ...field, minHeight: 56, resize: "vertical" }}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />

            {target.mode === "create" && (
              <>
                <label style={label}>Repeats</label>
                <select style={field} value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
                  {RECURRENCE_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </>
            )}

            <label style={label}>Attendees</label>
            {attendees.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                {attendees.map((a) => (
                  <span
                    key={a.email}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      background: "#f2f4f7",
                      borderRadius: 20,
                      padding: "3px 8px 3px 10px",
                      fontSize: 11.5,
                    }}
                  >
                    {a.name}
                    <button
                      onClick={() => removeAttendee(a.email)}
                      style={{ border: "none", background: "none", cursor: "pointer", color: "#9aa0ab", fontSize: 12 }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div style={{ position: "relative" }}>
              <input
                style={field}
                value={attendeeQuery}
                onChange={(e) => setAttendeeQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addAttendee(attendeeQuery);
                  }
                }}
                placeholder="Name or email, then Enter"
              />
              {visibleSuggestions.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    background: "#fff",
                    border: "1px solid #e4e7ec",
                    borderRadius: 8,
                    marginTop: 4,
                    boxShadow: "0 8px 20px rgba(16,18,22,0.12)",
                    zIndex: 5,
                    maxHeight: 160,
                    overflowY: "auto",
                  }}
                >
                  {visibleSuggestions.map((s) => (
                    <div
                      key={s.email}
                      onClick={() => addAttendee(s.email, s.name)}
                      style={{ padding: "7px 10px", fontSize: 12, cursor: "pointer" }}
                    >
                      <div style={{ fontWeight: 600 }}>{s.name}</div>
                      <div style={{ color: "#9aa0ab", fontSize: 11 }}>{s.email}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {htmlLink && (
              <a href={htmlLink} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--accent)", display: "inline-block", marginTop: 10 }}>
                Open in Google Calendar ↗
              </a>
            )}

            {meetingUrl && (
              <a href={meetingUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "var(--accent)", display: "inline-block", marginTop: 8, fontWeight: 700 }}>
                Join virtual meeting ↗
              </a>
            )}

            {err && <div style={{ color: "#c4432f", fontSize: 12, marginTop: 10 }}>{err}</div>}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
              <div>
                {target.mode === "edit" &&
                  (confirmingDelete ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11.5, color: "#c4432f" }}>Delete this event?</span>
                      <button className="pk-btn-outline" style={{ fontSize: 12, color: "#c4432f" }} disabled={pending} onClick={doDelete}>
                        Confirm
                      </button>
                      <button className="pk-btn-outline" style={{ fontSize: 12 }} onClick={() => setConfirmingDelete(false)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button className="pk-btn-outline" style={{ fontSize: 12, color: "#c4432f" }} onClick={() => setConfirmingDelete(true)}>
                      Delete
                    </button>
                  ))}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="pk-btn-outline" style={{ fontSize: 12.5 }} onClick={onClose}>
                  Cancel
                </button>
                <button
                  className="pk-btn-accent"
                  style={{ fontSize: 12.5, opacity: !title.trim() || pending ? 0.6 : 1 }}
                  disabled={!title.trim() || pending}
                  onClick={save}
                >
                  {pending ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
