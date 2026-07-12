"use client";

import { useState, useTransition } from "react";
import type { CSSProperties } from "react";
import { scheduleInspection, unscheduleInspection } from "../actions";

/**
 * Scheduling popover — inspection twin of the flame-test scheduler's modal.
 * Opens over a "Schedule" (new) or "Edit" (reschedule) trigger, collects a
 * visit date + inspector, and posts to the server actions.
 */
export function ScheduleButton({
  recId,
  mode,
  customer,
  venue,
  defaultDate,
  defaultTech,
  techOptions,
  triggerLabel,
  triggerStyle,
}: {
  recId: string;
  mode: "new" | "edit";
  customer: string;
  venue: string;
  defaultDate: string;
  defaultTech: string;
  techOptions: string[];
  triggerLabel: string;
  triggerStyle: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [tech, setTech] = useState(defaultTech);
  const [pending, start] = useTransition();

  const valid = !!date;

  function save() {
    if (!valid) return;
    const fd = new FormData();
    fd.set("id", recId);
    fd.set("scheduledDate", date);
    fd.set("assignedTo", tech);
    start(async () => {
      await scheduleInspection(fd);
      setOpen(false);
    });
  }
  function unschedule() {
    const fd = new FormData();
    fd.set("id", recId);
    start(async () => {
      await unscheduleInspection(fd);
      setOpen(false);
    });
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={triggerStyle}>
        {triggerLabel}
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(16,18,22,.4)",
            zIndex: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 390,
              maxWidth: "100%",
              background: "#fff",
              borderRadius: 16,
              boxShadow: "0 24px 60px rgba(0,0,0,.28)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 18px 14px", borderBottom: "1px solid #f0f1f4" }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {mode === "edit" ? "Reschedule visit" : "Schedule inspection"}
              </div>
              <div style={{ fontSize: 12, color: "#8c919c", marginTop: 2 }}>
                {customer} · {venue}
              </div>
            </div>
            <div
              style={{
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <label style={{ display: "block" }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#9aa0ab",
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                    marginBottom: 6,
                  }}
                >
                  Visit date
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  style={{
                    width: "100%",
                    fontFamily: "var(--font-mono)",
                    fontSize: 13.5,
                    border: "1px solid #e4e7ec",
                    borderRadius: 10,
                    padding: "11px 12px",
                    outline: "none",
                    background: "#fff",
                  }}
                />
              </label>
              <label style={{ display: "block" }}>
                <span
                  style={{
                    display: "block",
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#9aa0ab",
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                    marginBottom: 6,
                  }}
                >
                  Inspector
                </span>
                <select
                  value={tech}
                  onChange={(e) => setTech(e.target.value)}
                  style={{
                    width: "100%",
                    fontFamily: "var(--font-ui)",
                    fontSize: 13.5,
                    border: "1px solid #e4e7ec",
                    borderRadius: 10,
                    padding: "11px 12px",
                    outline: "none",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <option value="">Unassigned</option>
                  {techOptions.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "14px 18px",
                borderTop: "1px solid #f0f1f4",
                background: "#fafbfc",
              }}
            >
              {mode === "edit" && (
                <button
                  type="button"
                  onClick={unschedule}
                  disabled={pending}
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#b4543a",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "9px 4px",
                  }}
                >
                  Unschedule
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#5b616e",
                  background: "#fff",
                  border: "1px solid #e4e7ec",
                  borderRadius: 9,
                  padding: "10px 16px",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!valid || pending}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  border: "none",
                  borderRadius: 9,
                  padding: "10px 18px",
                  cursor: valid && !pending ? "pointer" : "default",
                  background: valid ? "var(--accent)" : "#c4c9d2",
                }}
              >
                {mode === "edit" ? "Save" : "Schedule visit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
