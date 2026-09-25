"use client";

import { useEffect, useMemo, useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import {
  addWindowAction,
  importCsvAction,
  refreshIcsAction,
  removeWindowAction,
  setIcsUrlAction,
} from "../../venue-calendar-actions";
import {
  AVAILABILITY_CSV_TEMPLATE,
  DAY_MS,
  parseAvailabilityCsv,
  type AvailWindow,
  type VenueCalendar,
} from "@/lib/venue-availability";

/**
 * The PM-facing editor for a venue's availability calendar (Jeff's ask: "a
 * format for the PM to add a client's calendar to their venue"). Three
 * ways in — a live .ics feed URL, a CSV import, or typing windows by hand —
 * feeding the one `VenueCalendar` the scheduling popovers
 * (VenueAvailabilityCheck) read. Lives on the venue detail page at
 * `id="calendar"` so `/venues/<id>#calendar` (linked from the company
 * record's venue rows and from "No venue calendar on file · Add one")
 * lands right on it.
 */

const card: CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  marginBottom: 24,
  overflow: "hidden",
};
const cardHead: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  padding: "14px 18px 12px",
  borderBottom: "1px solid #f0f1f4",
};
const section: CSSProperties = {
  padding: "16px 18px",
  borderBottom: "1px solid #f5f6f8",
};
const label: CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  marginBottom: 5,
};
const input: CSSProperties = {
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

function fmtWhen(w: AvailWindow): string {
  const opts: Intl.DateTimeFormatOptions = w.allDay
    ? { month: "short", day: "numeric", year: "numeric" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  const start = new Date(w.start).toLocaleString("en-US", opts);
  const endMs = w.allDay ? w.end - DAY_MS : w.end; // show the last inclusive day for an all-day range
  const end = new Date(endMs).toLocaleString("en-US", opts);
  return start === end ? start : `${start} – ${end}`;
}

function parseLocalDate(dateStr: string, timeStr?: string): number | null {
  if (!dateStr) return null;
  const t = timeStr && timeStr.trim() ? timeStr : "00:00";
  const d = new Date(`${dateStr}T${t}:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

const SOURCE_LABEL: Record<AvailWindow["source"], string> = { manual: "Manual", csv: "CSV", ics: "Feed" };
const SOURCE_TAG: Record<AvailWindow["source"], { ink: string; soft: string }> = {
  manual: { ink: "#5b616e", soft: "#f1f2f5" },
  csv: { ink: "#3155a8", soft: "#e9eefb" },
  ics: { ink: "#7a4fb0", soft: "#f2ecfa" },
};

function MiniStrip({ windows }: { windows: AvailWindow[] }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = today.getTime();
  const days = Array.from({ length: 14 }, (_, i) => start + i * DAY_MS);
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {days.map((d) => {
        const dEnd = d + DAY_MS;
        const hits = windows.filter((w) => w.start < dEnd && w.end > d);
        const blocked = hits.some((w) => w.kind === "blocked");
        const open = hits.some((w) => w.kind === "open");
        const bg = blocked ? "#e2795b" : open ? "#3fa373" : "#eef0f3";
        return (
          <div key={d} title={new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} style={{ flex: 1 }}>
            <div style={{ height: 20, borderRadius: 4, background: bg }} />
            <div style={{ fontSize: 8.5, color: "#aab0bb", textAlign: "center", marginTop: 3 }}>{new Date(d).getDate()}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function VenueCalendarCard({ locationId, initialCalendar }: { locationId: string; initialCalendar: VenueCalendar }) {
  const router = useRouter();
  const [cal, setCal] = useState(initialCalendar);
  // `now` starts undefined so the first client render matches the server's
  // (reading Date.now() directly during render would both violate the
  // render-purity lint and risk a hydration mismatch) and is set one tick
  // after mount — same pattern as the engagement Schedule tab's Gantt
  // "today" line (src/app/(app)/design/engagements/schedule-tab.tsx).
  const [now, setNow] = useState<number | undefined>(undefined);
  useEffect(() => {
    const id = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(id);
  }, []);
  const [pending, start] = useTransition();

  /* ---- feed url ---- */
  const [icsInput, setIcsInput] = useState(cal.icsUrl || "");
  const [icsMsg, setIcsMsg] = useState<string | null>(null);

  function saveIcs() {
    setIcsMsg(null);
    start(async () => {
      const res = await setIcsUrlAction(locationId, icsInput.trim() || null);
      if (res.ok) {
        setCal(res.cal);
        setIcsMsg(res.cal.icsError ? null : "Synced.");
      } else {
        setIcsMsg(res.error);
      }
      router.refresh();
    });
  }
  function removeIcs() {
    return new Promise<void>((resolve) => {
      start(async () => {
        const res = await setIcsUrlAction(locationId, null);
        if (res.ok) {
          setCal(res.cal);
          setIcsInput("");
        }
        router.refresh();
        resolve();
      });
    });
  }
  function refreshNow() {
    setIcsMsg(null);
    start(async () => {
      const res = await refreshIcsAction(locationId);
      if (res.ok) {
        setCal(res.cal);
        setIcsMsg(res.cal.icsError ? null : "Synced.");
      } else {
        setIcsMsg(res.error);
      }
      router.refresh();
    });
  }

  /* ---- csv ---- */
  const [csvText, setCsvText] = useState("");
  const [csvMode, setCsvMode] = useState<"append" | "replace-csv">("append");
  const [csvMsg, setCsvMsg] = useState<string | null>(null);
  const preview = useMemo(() => (csvText.trim() ? parseAvailabilityCsv(csvText) : null), [csvText]);

  function importCsv() {
    if (!csvText.trim()) return;
    setCsvMsg(null);
    start(async () => {
      const res = await importCsvAction(locationId, csvText, csvMode);
      if (res.ok) {
        setCal(res.cal);
        setCsvText("");
        const skipped = res.errors.length ? `; ${res.errors.length} row${res.errors.length === 1 ? "" : "s"} skipped` : "";
        setCsvMsg(`${res.imported} window${res.imported === 1 ? "" : "s"} on file from CSV${skipped}.`);
      } else {
        setCsvMsg(res.error);
      }
      router.refresh();
    });
  }

  /* ---- manual ---- */
  const [mKind, setMKind] = useState<"open" | "blocked">("blocked");
  const [mStartDate, setMStartDate] = useState("");
  const [mStartTime, setMStartTime] = useState("");
  const [mEndDate, setMEndDate] = useState("");
  const [mEndTime, setMEndTime] = useState("");
  const [mLabel, setMLabel] = useState("");
  const [mMsg, setMMsg] = useState<string | null>(null);

  function addManual() {
    setMMsg(null);
    const sd = mStartDate;
    if (!sd) {
      setMMsg("Pick a start date.");
      return;
    }
    const ed = mEndDate || sd;
    const hasTime = !!mStartTime;
    let win: { start: number; end: number; allDay: boolean } | null = null;
    if (!hasTime) {
      const s = parseLocalDate(sd);
      const eBase = parseLocalDate(ed);
      if (s != null && eBase != null) win = { start: s, end: eBase + DAY_MS, allDay: true };
    } else {
      const s = parseLocalDate(sd, mStartTime);
      const e = parseLocalDate(ed, mEndTime || mStartTime);
      if (s != null && e != null && e > s) win = { start: s, end: e, allDay: false };
    }
    if (!win) {
      setMMsg("Check the dates/times — end has to be after start.");
      return;
    }
    start(async () => {
      const res = await addWindowAction(locationId, { kind: mKind, ...win!, label: mLabel.trim() });
      if (res.ok) {
        setCal(res.cal);
        setMStartDate("");
        setMStartTime("");
        setMEndDate("");
        setMEndTime("");
        setMLabel("");
      } else {
        setMMsg(res.error);
      }
      router.refresh();
    });
  }

  function removeManual(id: string) {
    return new Promise<void>((resolve) => {
      start(async () => {
        const res = await removeWindowAction(locationId, id);
        if (res.ok) setCal(res.cal);
        router.refresh();
        resolve();
      });
    });
  }

  const upcoming =
    now == null
      ? []
      : [...cal.windows, ...cal.icsWindows]
          .filter((w) => w.end > now && w.start < now + 60 * DAY_MS)
          .sort((a, b) => a.start - b.start);
  const stripWindows = [...cal.windows, ...cal.icsWindows];

  return (
    <div id="calendar" style={card}>
      <div style={cardHead}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>Venue calendar</span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>
          {cal.windows.length + cal.icsWindows.length} window{cal.windows.length + cal.icsWindows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div style={{ padding: "14px 18px 4px" }}>
        <MiniStrip windows={stripWindows} />
        <div style={{ display: "flex", gap: 10, marginTop: 8, fontSize: 10.5, color: "#9aa0ab" }}>
          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#e2795b", marginRight: 4 }} />Blocked</span>
          <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#3fa373", marginRight: 4 }} />Open</span>
          <span>Next 14 days</span>
        </div>
      </div>

      {/* feed url */}
      <div style={section}>
        <span style={label}>Calendar feed URL</span>
        <div style={{ fontSize: 11.5, color: "#9aa0ab", marginBottom: 8, lineHeight: 1.5 }}>
          Google and Outlook both call this a &ldquo;secret address in iCal format&rdquo; — paste it here to keep this
          venue&apos;s calendar in sync automatically.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={input}
            placeholder={"https://….ics or webcal://…"}
            value={icsInput}
            onChange={(e) => setIcsInput(e.target.value)}
          />
          <button type="button" className="pk-btn-accent" disabled={pending || !icsInput.trim()} onClick={saveIcs}>
            Save &amp; sync
          </button>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 9, fontSize: 11.5 }}>
          {cal.icsUrl && (
            <>
              <span style={{ color: cal.icsError ? "#b4543a" : "#8c919c" }}>
                {cal.icsError
                  ? `Sync failed: ${cal.icsError}`
                  : cal.icsFetchedAt
                    ? `Last synced ${new Date(cal.icsFetchedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
                    : "Not synced yet."}
              </span>
              <button type="button" className="pk-btn-outline" disabled={pending} onClick={refreshNow}>
                Refresh now
              </button>
              <ConfirmButton
                label="Remove feed"
                confirmLabel="Remove feed?"
                onConfirm={removeIcs}
                className="pk-btn-outline"
                style={{ color: "#b4543a" }}
              />
            </>
          )}
          {icsMsg && <span style={{ color: "#8c919c" }}>{icsMsg}</span>}
        </div>
      </div>

      {/* csv */}
      <div style={section}>
        <span style={label}>Import from CSV</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", borderRadius: 7, padding: "8px 13px", background: "var(--accent)", color: "var(--accent-contrast, #16181b)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
            Select CSV file
            <input
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (!file) return;
                file.text().then((text) => {
                  setCsvText(text);
                  setCsvMsg(null);
                });
              }}
            />
          </label>
          <select style={{ ...input, width: "auto" }} value={csvMode} onChange={(e) => setCsvMode(e.target.value as "append" | "replace-csv")}>
            <option value="append">Add to existing</option>
            <option value="replace-csv">Replace previous CSV import</option>
          </select>
          <a
            download="venue-calendar-example.csv"
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(AVAILABILITY_CSV_TEMPLATE)}`}
            style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
          >
            Download example CSV
          </a>
        </div>

        {csvText && (
          <div style={{ marginTop: 12 }}>
            <textarea
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
              style={{ ...input, minHeight: 70, fontFamily: "var(--font-mono)", fontSize: 11.5, resize: "vertical" }}
            />
            {preview && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: "#5b616e" }}>
                {preview.windows.length} window{preview.windows.length === 1 ? "" : "s"} parsed
                {preview.errors.length > 0 && (
                  <>
                    {" · "}
                    <span style={{ color: "#b4543a" }}>
                      {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} with errors
                    </span>
                    <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                      {preview.errors.slice(0, 6).map((e, i) => (
                        <li key={i}>
                          Line {e.line}: {e.message}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 9 }}>
              <button type="button" className="pk-btn-accent" disabled={pending || !preview?.windows.length} onClick={importCsv}>
                Import
              </button>
              <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => setCsvText("")}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {csvMsg && <div style={{ marginTop: 8, fontSize: 11.5, color: "#5b616e" }}>{csvMsg}</div>}
      </div>

      {/* manual */}
      <div style={section}>
        <span style={label}>Add open or blocked time</span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div>
            <span style={label}>Kind</span>
            <select style={{ ...input, width: 110 }} value={mKind} onChange={(e) => setMKind(e.target.value as "open" | "blocked")}>
              <option value="blocked">Blocked</option>
              <option value="open">Open</option>
            </select>
          </div>
          <div>
            <span style={label}>Start date</span>
            <input type="date" style={{ ...input, width: 140, fontFamily: "var(--font-mono)" }} value={mStartDate} onChange={(e) => setMStartDate(e.target.value)} />
          </div>
          <div>
            <span style={label}>Start time</span>
            <input type="time" style={{ ...input, width: 100, fontFamily: "var(--font-mono)" }} value={mStartTime} onChange={(e) => setMStartTime(e.target.value)} />
          </div>
          <div>
            <span style={label}>End date</span>
            <input type="date" style={{ ...input, width: 140, fontFamily: "var(--font-mono)" }} value={mEndDate} onChange={(e) => setMEndDate(e.target.value)} placeholder={mStartDate} />
          </div>
          <div>
            <span style={label}>End time</span>
            <input type="time" style={{ ...input, width: 100, fontFamily: "var(--font-mono)" }} value={mEndTime} onChange={(e) => setMEndTime(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <span style={label}>Label</span>
            <input style={input} value={mLabel} onChange={(e) => setMLabel(e.target.value)} placeholder="Optional" />
          </div>
          <button type="button" className="pk-btn-accent" disabled={pending || !mStartDate} onClick={addManual}>
            Add
          </button>
        </div>
        {mMsg && <div style={{ marginTop: 8, fontSize: 11.5, color: "#b4543a" }}>{mMsg}</div>}
      </div>

      {/* upcoming list */}
      <div>
        <div style={{ padding: "12px 18px 4px", fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase" }}>
          Upcoming (next 60 days)
        </div>
        {upcoming.map((w) => {
          const tag = SOURCE_TAG[w.source];
          return (
            <div
              key={w.id}
              style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderTop: "1px solid #f5f6f8" }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: w.kind === "blocked" ? "#b4543a" : "#1f7a52",
                  background: w.kind === "blocked" ? "#f8ece7" : "#e7f4ee",
                  borderRadius: 5,
                  padding: "2px 7px",
                  textTransform: "uppercase",
                  letterSpacing: ".03em",
                  flexShrink: 0,
                }}
              >
                {w.kind}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                {w.label || (w.kind === "blocked" ? "Busy" : "Open")}
                <span style={{ color: "#9aa0ab", marginLeft: 8 }}>{fmtWhen(w)}</span>
              </span>
              <span style={{ fontSize: 9.5, fontWeight: 600, color: tag.ink, background: tag.soft, borderRadius: 5, padding: "2px 7px", flexShrink: 0 }}>
                {SOURCE_LABEL[w.source]}
              </span>
              {w.source !== "ics" && (
                <ConfirmButton
                  label="Remove"
                  confirmLabel="Remove?"
                  onConfirm={() => removeManual(w.id)}
                  className="pk-btn-outline"
                  style={{ fontSize: 11, padding: "5px 9px", flexShrink: 0 }}
                />
              )}
            </div>
          );
        })}
        {upcoming.length === 0 && (
          <div style={{ padding: "20px 18px 26px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            Nothing on the calendar in the next 60 days.
          </div>
        )}
      </div>
    </div>
  );
}
