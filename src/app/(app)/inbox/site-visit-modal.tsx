"use client";

import { useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import {
  createSiteVisitAction,
  type InviteStatus,
} from "./site-visit-actions";

/**
 * Schedule-site-visit modal (D76 / PUNCHLIST #2 phase 1). Opened from the
 * thread reader; the customer comes from the thread's resolved link (an
 * unlinked thread is adopted on save, D76-G). Creates the visit and emails
 * the assignee an .ics invite — the customer is never emailed (D76-B).
 */

const inStyle: CSSProperties = {
  width: "100%",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "8px 11px",
  fontSize: 12.5,
  fontFamily: "var(--font-ui)",
  background: "#fff",
  color: "#16181d",
  outline: "none",
};

const lbl: CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  margin: "12px 0 5px",
};

function tomorrowISO(): string {
  const d = new Date(Date.now() + 24 * 3600_000);
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function inviteMessage(status: InviteStatus, assignee: string): string {
  switch (status) {
    case "calendar":
      return `Added straight to ${assignee}'s Google Calendar.`;
    case "sent":
      return `Calendar invite emailed to ${assignee}.`;
    case "invites-off":
      return `${assignee} has calendar-invite emails turned off (Account settings).`;
    case "gmail-off":
      return "Email invites need Gmail connected (Settings → Mailboxes).";
    case "no-mailbox":
      return "No connected mailbox to send from — connect one in Settings → Mailboxes.";
    case "no-email":
      return `${assignee} has no email on the team roster.`;
    case "failed":
      return "The invite email failed to send — the visit is saved; try again later.";
  }
}

export default function SiteVisitModal({
  threadId,
  customerId,
  customerName,
  needsAdopt,
  contactEmail,
  visit,
  onClose,
}: {
  threadId: string;
  customerId: string;
  customerName: string;
  needsAdopt: boolean;
  /** the thread's contact email — preselects the matching customer contact */
  contactEmail: string;
  visit: NonNullable<ReaderVM["visit"]>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const defaultVenue =
    visit.venues.find((v) => v.primary) || visit.venues[0] || null;
  const defaultContactIdx = useMemo(() => {
    const em = (contactEmail || "").toLowerCase();
    const hit = visit.contacts.findIndex(
      (c) => em && c.email.toLowerCase() === em
    );
    if (hit >= 0) return hit;
    const prim = visit.contacts.findIndex((c) => c.primary);
    return prim >= 0 ? prim : 0;
  }, [visit.contacts, contactEmail]);

  const [venueId, setVenueId] = useState(defaultVenue?.id || "");
  const [contactIdx, setContactIdx] = useState(defaultContactIdx);
  const [reason, setReason] = useState(visit.reasons[0] || "");
  const [date, setDate] = useState(tomorrowISO());
  const [time, setTime] = useState("09:00");
  const [durationMin, setDurationMin] = useState(60);
  const [assignee, setAssignee] = useState(visit.me);
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    const venue = visit.venues.find((v) => v.id === venueId) || defaultVenue;
    const contact = visit.contacts[contactIdx] || null;
    const startAt = new Date(`${date}T${time}:00`).getTime();
    if (!Number.isFinite(startAt)) {
      setError("Pick a date and time.");
      return;
    }
    startTransition(async () => {
      const res = await createSiteVisitAction({
        adoptThreadId: needsAdopt ? threadId : null,
        customerId,
        customer: customerName,
        locationId: venue?.id || null,
        venue: venue?.label || "",
        address: venue?.address || "",
        contactName: contact?.name || "",
        contactEmail: contact?.email || "",
        contactPhone: contact?.phone || "",
        reason,
        startAt,
        endAt: startAt + durationMin * 60_000,
        notes,
        assignedTo: assignee,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone(
        `${res.id} saved. ` + inviteMessage(res.inviteStatus, assignee)
      );
      router.refresh();
    });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,24,29,.4)",
        zIndex: 90,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440,
          maxWidth: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 18px 50px rgba(0,0,0,.22)",
          padding: "20px 22px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, flex: 1 }}>
            Schedule site visit
          </div>
          <button
            onClick={onClose}
            title="Close"
            style={{ border: "none", background: "transparent", color: "#c4c9d2", fontSize: 17, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 3 }}>
          {customerName}
          {needsAdopt ? " · will be linked to this thread" : ""}
        </div>

        {done ? (
          <>
            <div
              style={{
                marginTop: 16,
                padding: "12px 14px",
                borderRadius: 10,
                background: "#e8f3ee",
                border: "1px solid #cfe6db",
                color: "#1f7a52",
                fontSize: 12.5,
                lineHeight: 1.5,
              }}
            >
              {done}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button className="pk-btn" onClick={onClose} style={{ fontSize: 12.5 }}>
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <label style={lbl}>Venue</label>
            <select style={inStyle} value={venueId} onChange={(e) => setVenueId(e.target.value)}>
              {visit.venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                  {v.address ? ` — ${v.address}` : ""}
                </option>
              ))}
              {visit.venues.length === 0 && <option value="">No venues on record</option>}
            </select>

            <label style={lbl}>Contact (goes in the event details — not emailed)</label>
            <select
              style={inStyle}
              value={contactIdx}
              onChange={(e) => setContactIdx(Number(e.target.value))}
            >
              {visit.contacts.map((c, i) => (
                <option key={i} value={i}>
                  {c.name}
                  {c.phone ? ` · ${c.phone}` : ""}
                  {c.email ? ` · ${c.email}` : ""}
                </option>
              ))}
              {visit.contacts.length === 0 && <option value={-1}>No contacts on record</option>}
            </select>

            <label style={lbl}>Reason</label>
            <select style={inStyle} value={reason} onChange={(e) => setReason(e.target.value)}>
              {visit.reasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <label style={lbl}>Date</label>
                <input type="date" style={inStyle} value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Start</label>
                <input type="time" style={inStyle} value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Length</label>
                <select
                  style={inStyle}
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                >
                  {[30, 60, 90, 120, 180, 240].map((m) => (
                    <option key={m} value={m}>
                      {m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? "s" : ""}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label style={lbl}>Assigned to (gets the calendar invite)</label>
            <select style={inStyle} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              {visit.team.map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === visit.me ? " (me)" : ""}
                </option>
              ))}
            </select>

            <label style={lbl}>Notes (optional)</label>
            <textarea
              style={{ ...inStyle, minHeight: 56, resize: "vertical" }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything the visit should cover"
            />

            {error && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#a03b2e" }}>{error}</div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button className="pk-btn-outline" onClick={onClose} style={{ fontSize: 12.5 }}>
                Cancel
              </button>
              <button
                className="pk-btn"
                onClick={submit}
                disabled={pending || !reason}
                style={{ fontSize: 12.5, opacity: pending ? 0.7 : 1 }}
              >
                {pending ? "Saving…" : "Save & send invite"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
