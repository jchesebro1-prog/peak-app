"use client";

import {
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
  type CSSProperties,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AgendaItem } from "@/lib/agenda";
import { addCalendarEventAction } from "../calendar-actions";

/**
 * Month-grid calendar (S13 / D81). Day placement and labels are computed in
 * the BROWSER'S timezone (rendered after hydration, same pattern as the
 * dashboard card); all-day items place by their UTC calendar date. Clicking
 * a day arms quick-add for that date (when the Google grant exists).
 */

const label: CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  margin: "10px 0 4px",
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
};

const emptySubscribe = () => () => {};

function dayKeyOf(it: AgendaItem): string {
  const d = new Date(it.startMs);
  const y = it.allDay ? d.getUTCFullYear() : d.getFullYear();
  const m = it.allDay ? d.getUTCMonth() : d.getMonth();
  const day = it.allDay ? d.getUTCDate() : d.getDate();
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function timeLabel(it: AgendaItem): string {
  if (it.allDay) return "";
  return new Date(it.startMs)
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(" ", "")
    .toLowerCase();
}

function monthParam(y: number, m0: number): string {
  const d = new Date(y, m0, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

export default function CalendarClient({
  year,
  month,
  items,
  calendarOn,
  gmailOn,
}: {
  year: number;
  month: number; // 0-based
  items: AgendaItem[];
  calendarOn: boolean;
  gmailOn: boolean;
}) {
  const router = useRouter();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [addDate, setAddDate] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [time, setTime] = useState("09:00");
  const [durationMin, setDurationMin] = useState(60);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const it of items) {
      const k = dayKeyOf(it);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    for (const list of map.values())
      list.sort((a, b) =>
        a.allDay !== b.allDay ? (a.allDay ? -1 : 1) : a.startMs - b.startMs
      );
    return map;
  }, [items]);

  /* grid: weeks (Sun-start) covering the month */
  const weeks = useMemo(() => {
    const first = new Date(year, month, 1);
    const start = new Date(year, month, 1 - first.getDay());
    const out: Date[][] = [];
    const cur = new Date(start);
    do {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
      }
      out.push(week);
    } while (cur.getMonth() === month);
    return out;
  }, [year, month]);

  const todayKey = (() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  })();

  const monthTitle = new Date(year, month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const submit = () => {
    if (!addDate) return;
    setErr(null);
    const startAt = new Date(`${addDate}T${time}:00`).getTime();
    if (!Number.isFinite(startAt)) {
      setErr("Pick a time.");
      return;
    }
    startTransition(async () => {
      const r = await addCalendarEventAction({
        title,
        startAt,
        endAt: startAt + durationMin * 60_000,
      });
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setAddDate(null);
      setTitle("");
      router.refresh();
    });
  };

  return (
    <div>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em" }}>Calendar</div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 4 }}>
            {calendarOn
              ? "Your Google Calendar + your Peak site visits."
              : gmailOn
                ? "Showing your Peak site visits — Enable calendar on your mailbox (Account settings) to see Google Calendar here."
                : "Showing your Peak site visits. Google Calendar arrives once Gmail is connected."}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link href={"/calendar?month=" + monthParam(year, month - 1)} className="pk-btn-outline" style={{ textDecoration: "none", fontSize: 13 }}>
            ‹
          </Link>
          <span style={{ fontSize: 15, fontWeight: 700, minWidth: 150, textAlign: "center" }}>{monthTitle}</span>
          <Link href={"/calendar?month=" + monthParam(year, month + 1)} className="pk-btn-outline" style={{ textDecoration: "none", fontSize: 13 }}>
            ›
          </Link>
          <Link href="/calendar" className="pk-btn-outline" style={{ textDecoration: "none", fontSize: 12.5 }}>
            Today
          </Link>
        </div>
      </div>

      {/* quick-add (armed by clicking a day) */}
      {addDate && calendarOn && (
        <div className="pk-card" style={{ padding: "13px 16px", marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto auto", gap: 10, alignItems: "end" }}>
            <div>
              <label style={label}>
                New event ·{" "}
                {new Date(addDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
              </label>
              <input style={field} autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's happening?" />
            </div>
            <div>
              <label style={label}>Start</label>
              <input type="time" style={field} value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
            <div>
              <label style={label}>Length</label>
              <select style={field} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}>
                {[30, 60, 90, 120, 180, 240, 480].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? "s" : ""}`}
                  </option>
                ))}
              </select>
            </div>
            <button className="pk-btn-accent" onClick={submit} disabled={pending || !title.trim()} style={{ opacity: pending || !title.trim() ? 0.6 : 1 }}>
              {pending ? "Adding…" : "Add"}
            </button>
            <button className="pk-btn-outline" onClick={() => setAddDate(null)}>Cancel</button>
          </div>
          {err && <div style={{ marginTop: 8, fontSize: 12, color: "#a03b2e" }}>{err}</div>}
        </div>
      )}

      {/* month grid */}
      <div className="pk-card" style={{ overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid #eef0f3" }}>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} style={{ padding: "8px 10px", fontSize: 10.5, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", textAlign: "center" }}>
              {d}
            </div>
          ))}
        </div>
        {!mounted ? (
          <div style={{ padding: "40px 20px", textAlign: "center", color: "#c4c9d2", fontSize: 12.5 }}>Loading…</div>
        ) : (
          weeks.map((week, wi) => (
            <div key={wi} style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: wi < weeks.length - 1 ? "1px solid #f4f5f7" : "none" }}>
              {week.map((day) => {
                const k = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
                const inMonth = day.getMonth() === month;
                const isToday = k === todayKey;
                const list = byDay.get(k) || [];
                return (
                  <div
                    key={k}
                    onClick={() => {
                      if (calendarOn) {
                        setAddDate(k);
                        setErr(null);
                      }
                    }}
                    style={{
                      minHeight: 96,
                      padding: "6px 7px",
                      borderRight: "1px solid #f4f5f7",
                      background: inMonth ? "#fff" : "#fafbfc",
                      cursor: calendarOn ? "pointer" : "default",
                      overflow: "hidden",
                    }}
                    title={calendarOn ? "Click to add an event on this day" : undefined}
                  >
                    <div
                      style={{
                        fontSize: 11.5,
                        fontWeight: isToday ? 700 : 500,
                        color: isToday ? "#fff" : inMonth ? "#5b616e" : "#c4c9d2",
                        background: isToday ? "var(--accent)" : "transparent",
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        minWidth: 20,
                        height: 20,
                        borderRadius: 10,
                        padding: "0 4px",
                        marginBottom: 3,
                      }}
                    >
                      {day.getDate()}
                    </div>
                    {list.slice(0, 3).map((it) => {
                      const chip = (
                        <div
                          style={{
                            fontSize: 10.5,
                            lineHeight: 1.35,
                            fontWeight: 600,
                            color: it.source === "visit" ? "#1f7a52" : "#3155a8",
                            background: it.source === "visit" ? "#e8f3ee" : "#e9eefb",
                            border: `1px solid ${it.source === "visit" ? "#cfe6db" : "#d4ddf3"}`,
                            borderRadius: 5,
                            padding: "2px 6px",
                            marginBottom: 3,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                          title={(it.allDay ? "All day" : timeLabel(it)) + " · " + it.title + (it.location ? " · " + it.location : "")}
                        >
                          {it.allDay ? "" : timeLabel(it) + " "}
                          {it.title}
                        </div>
                      );
                      return it.href ? (
                        <a
                          key={it.key}
                          href={it.href}
                          target={it.source === "google" ? "_blank" : undefined}
                          rel={it.source === "google" ? "noreferrer" : undefined}
                          onClick={(e) => e.stopPropagation()}
                          style={{ display: "block", textDecoration: "none" }}
                        >
                          {chip}
                        </a>
                      ) : (
                        <div key={it.key}>{chip}</div>
                      );
                    })}
                    {list.length > 3 && (
                      <div style={{ fontSize: 10, color: "#9aa0ab", fontWeight: 600 }}>
                        +{list.length - 3} more
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
