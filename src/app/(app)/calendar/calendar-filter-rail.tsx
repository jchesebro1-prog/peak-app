"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  disconnectCalendarAccountAction,
  refreshCalendarConnectionAction,
  setExternalCalendarColorAction,
  setExternalCalendarVisibilityAction,
  type CalendarConnectionView,
} from "../calendar-actions";

/**
 * D148 — right-hand slide-out rail for the Calendar tab: connect additional
 * Google accounts, and toggle/color each of their individual calendars.
 * Punch #108 asked for exactly this shape ("a filter sidebar on the right
 * of the screen that slides out to expose the different calendars"); this
 * rail is scoped to that part of #108 only — it does NOT include a shared
 * team calendar anyone can add events to, which is a separate, bigger ask
 * (see #108's updated entry in PUNCHLIST.md).
 *
 * A handful of preset swatches, not a full color picker — these are chips
 * on a month grid, so a small distinguishable palette reads better than an
 * arbitrary color per user. "Match Google" clears colorOverride so the
 * calendar falls back to whatever backgroundColor Google itself reports.
 */

const SWATCHES = ["#3155a8", "#1f7a52", "#b8562f", "#8b3fa8", "#a83f5c", "#3f8ba8", "#6b7280"];

export default function CalendarFilterRail({
  open,
  onClose,
  connections,
  canConnect,
  connectHref,
}: {
  open: boolean;
  onClose: () => void;
  connections: CalendarConnectionView[];
  canConnect: boolean;
  connectHref: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyKey(key);
    setError("");
    startTransition(async () => {
      const r = await fn();
      setBusyKey(null);
      if (!r.ok) setError(r.error || "That didn't save — try again.");
      else router.refresh();
    });
  }

  if (!open) return null;

  return (
    <>
      {/* backdrop — click to close, doesn't intercept the calendar grid's own clicks */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(15,17,21,0.15)", zIndex: 40 }}
      />
      <div
        className="pk-card"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 320,
          maxWidth: "88vw",
          zIndex: 41,
          borderRadius: 0,
          borderLeft: "1px solid #e4e7ec",
          padding: "18px 16px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Calendars</div>
          <button
            onClick={onClose}
            className="pk-btn-outline"
            style={{ fontSize: 12, padding: "3px 9px" }}
          >
            Close
          </button>
        </div>

        {error && (
          <div style={{ fontSize: 12, color: "#a13f3f", background: "#fbecec", border: "1px solid #f2d3d3", borderRadius: 6, padding: "6px 9px" }}>
            {error}
          </div>
        )}

        {connections.length === 0 && (
          <div style={{ fontSize: 12.5, color: "#8c919c", lineHeight: 1.5 }}>
            No additional Google accounts connected yet. Connect one to
            subscribe to its calendars here — a personal Gmail, a family
            calendar account, a shared team calendar&apos;s owning account,
            whatever you want to see alongside your own.
          </div>
        )}

        {connections.map((conn) => (
          <div key={conn.id} style={{ borderTop: "1px solid #eef0f3", paddingTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={conn.googleEmail}>
                {conn.googleEmail}
              </div>
              <button
                className="pk-btn-outline"
                disabled={pending}
                onClick={() => run("refresh-" + conn.id, () => refreshCalendarConnectionAction(conn.id))}
                style={{ fontSize: 10.5, padding: "2px 7px" }}
                title="Re-check this account for new or removed calendars"
              >
                {busyKey === "refresh-" + conn.id ? "…" : "Refresh"}
              </button>
              <button
                className="pk-btn-outline"
                disabled={pending}
                onClick={() => {
                  if (!confirm("Disconnect " + conn.googleEmail + "? Its calendars will stop showing here."))
                    return;
                  run("disc-" + conn.id, () => disconnectCalendarAccountAction(conn.id));
                }}
                style={{ fontSize: 10.5, padding: "2px 7px", color: "#a13f3f" }}
              >
                Disconnect
              </button>
            </div>

            {conn.calendars.length === 0 && (
              <div style={{ fontSize: 11.5, color: "#c4c9d2" }}>No calendars found on this account.</div>
            )}

            {conn.calendars.map((cal) => {
              const color = cal.colorOverride || cal.backgroundColor || "#6b7280";
              return (
                <div key={cal.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                  <input
                    type="checkbox"
                    checked={cal.visible}
                    disabled={pending}
                    onChange={(e) =>
                      run("vis-" + conn.id + cal.id, () =>
                        setExternalCalendarVisibilityAction(conn.id, cal.id, e.target.checked)
                      )
                    }
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12.5,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={cal.summary}
                  >
                    {cal.summary}
                  </span>
                  <div style={{ display: "flex", gap: 3 }}>
                    {SWATCHES.map((sw) => (
                      <button
                        key={sw}
                        disabled={pending}
                        onClick={() =>
                          run("color-" + conn.id + cal.id, () =>
                            setExternalCalendarColorAction(conn.id, cal.id, sw)
                          )
                        }
                        title={sw}
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: "50%",
                          background: sw,
                          border: color === sw ? "2px solid #16181d" : "1px solid rgba(0,0,0,0.15)",
                          cursor: "pointer",
                          padding: 0,
                        }}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <div style={{ borderTop: "1px solid #eef0f3", paddingTop: 12 }}>
          {canConnect ? (
            <a href={connectHref} className="pk-btn-accent" style={{ textDecoration: "none", fontSize: 12.5, display: "inline-block" }}>
              + Connect an account
            </a>
          ) : (
            <div style={{ fontSize: 11.5, color: "#c4c9d2", lineHeight: 1.5 }}>
              Connecting additional Google accounts isn&apos;t configured on
              this deployment yet.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
