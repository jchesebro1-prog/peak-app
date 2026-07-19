"use client";

import {
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { addCalendarEventAction } from "./calendar-actions";

/**
 * Dashboard calendar card (D77) — the user's next two weeks, merged from
 * their Google Calendar (when their mailbox has the Calendar grant) and any
 * Peak site visits assigned to them that haven't been pushed to Google.
 * Quick-add writes straight to their primary Google Calendar. Day grouping
 * and time formatting happen HERE, in the browser's timezone — the server
 * may run in UTC.
 */

export type AgendaItem = {
  key: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  location: string;
  /** external Google link or internal path ("" = not clickable) */
  href: string;
  source: "google" | "visit";
};

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

/** The calendar date an item displays on. All-day events were parsed at UTC
 *  midnight, so their date comes from UTC getters — the calendar day survives
 *  any server/browser timezone combination (review F3). */
function displayDay(it: AgendaItem): { y: number; m: number; d: number } {
  const d = new Date(it.startMs);
  return it.allDay
    ? { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() }
    : { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
}

function dayLabel(it: AgendaItem): string {
  const { y, m, d } = displayDay(it);
  const today = new Date();
  const diffDays = Math.round(
    (Date.UTC(y, m, d) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      86_400_000
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return new Date(y, m, d).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function timeLabel(it: AgendaItem): string {
  if (it.allDay) return "All day";
  return new Date(it.startMs).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

const emptySubscribe = () => () => {};

export default function HomeCalendar({
  items,
  calendarOn,
  gmailOn,
}: {
  items: AgendaItem[];
  calendarOn: boolean;
  gmailOn: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  // Defaults from LOCAL time, one hour ahead (rolls the date past midnight).
  const [date, setDate] = useState(() => {
    const n = new Date(Date.now() + 3600_000);
    return (
      n.getFullYear() +
      "-" +
      String(n.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(n.getDate()).padStart(2, "0")
    );
  });
  const [time, setTime] = useState(() => {
    const n = new Date(Date.now() + 3600_000);
    return String(n.getHours()).padStart(2, "0") + ":00";
  });
  const [durationMin, setDurationMin] = useState(60);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Times and day groups depend on the BROWSER timezone — rendering them
  // during SSR (server tz, often UTC) would hydrate mismatched (review F4).
  // useSyncExternalStore's server snapshot is the lint-clean mounted check.
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const groups = useMemo(() => {
    // order by display day first (an all-day item's raw epoch is UTC
    // midnight, which can sort before the previous local evening), then time
    const sorted = [...items].sort((a, b) => {
      const pa = displayDay(a);
      const pb = displayDay(b);
      const da = new Date(pa.y, pa.m, pa.d).getTime();
      const db = new Date(pb.y, pb.m, pb.d).getTime();
      if (da !== db) return da - db;
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.startMs - b.startMs;
    });
    const by = new Map<string, AgendaItem[]>();
    for (const it of sorted) {
      const k = dayLabel(it);
      if (!by.has(k)) by.set(k, []);
      by.get(k)!.push(it);
    }
    return [...by.entries()];
  }, [items]);

  const submit = () => {
    setErr(null);
    const startAt = new Date(`${date}T${time}:00`).getTime();
    if (!Number.isFinite(startAt)) {
      setErr("Pick a date and time.");
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
      setAdding(false);
      setTitle("");
      router.refresh();
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "15px 17px 12px",
          borderBottom: "1px solid #f0f1f4",
        }}
      >
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Calendar</div>
          <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2 }}>
            Next 14 days
            {calendarOn ? " · Google Calendar" : ""}
          </div>
        </div>
        {calendarOn && (
          <button
            className="pk-btn-outline"
            onClick={() => setAdding((v) => !v)}
            style={{ fontSize: 12, flexShrink: 0 }}
          >
            {adding ? "Close" : "+ Add event"}
          </button>
        )}
      </div>

      {adding && calendarOn && (
        <div style={{ padding: "4px 17px 14px", borderBottom: "1px solid #f0f1f4" }}>
          <label style={label}>Title</label>
          <input
            style={field}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What's happening?"
          />
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 8 }}>
            <div>
              <label style={label}>Date</label>
              <input type="date" style={field} value={date} onChange={(e) => setDate(e.target.value)} />
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
          </div>
          {err && <div style={{ marginTop: 8, fontSize: 12, color: "#a03b2e" }}>{err}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
            <button
              className="pk-btn-accent"
              onClick={submit}
              disabled={pending || !title.trim()}
              style={{ fontSize: 12, opacity: pending || !title.trim() ? 0.6 : 1 }}
            >
              {pending ? "Adding…" : "Add to Google Calendar"}
            </button>
          </div>
        </div>
      )}

      <div style={{ maxHeight: 340, overflowY: "auto" }}>
        {!mounted && items.length > 0 && (
          <div style={{ padding: "20px 17px", color: "#c4c9d2", fontSize: 12.5 }}>
            Loading…
          </div>
        )}
        {mounted && groups.map(([day, list]) => (
          <div key={day}>
            <div
              style={{
                padding: "9px 17px 4px",
                fontSize: 10.5,
                fontWeight: 600,
                color: "#9aa0ab",
                letterSpacing: ".05em",
                textTransform: "uppercase",
              }}
            >
              {day}
            </div>
            {list.map((it) => {
              const row = (
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 10,
                    padding: "6px 17px",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: it.source === "visit" ? "#1f7a52" : "#5b616e",
                      flexShrink: 0,
                      width: 62,
                    }}
                  >
                    {timeLabel(it)}
                  </span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#16181d",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {it.title}
                      {it.source === "visit" && (
                        <span
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            color: "#1f7a52",
                            background: "#e8f3ee",
                            padding: "1px 6px",
                            borderRadius: 4,
                            marginLeft: 6,
                            letterSpacing: ".03em",
                            verticalAlign: "1px",
                          }}
                        >
                          SITE VISIT
                        </span>
                      )}
                    </span>
                    {it.location && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 11,
                          color: "#9aa0ab",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {it.location}
                      </span>
                    )}
                  </span>
                </div>
              );
              return it.href ? (
                <a
                  key={it.key}
                  href={it.href}
                  target={it.source === "google" ? "_blank" : undefined}
                  rel={it.source === "google" ? "noreferrer" : undefined}
                  title={it.source === "google" ? "Open in Google Calendar" : "Open the customer record"}
                  style={{ display: "block", textDecoration: "none" }}
                >
                  {row}
                </a>
              ) : (
                <div key={it.key}>{row}</div>
              );
            })}
          </div>
        ))}
        {mounted && items.length === 0 && (
          <div style={{ padding: "20px 17px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
            Nothing scheduled in the next two weeks.
          </div>
        )}
      </div>

      {!calendarOn && (
        <div
          style={{
            padding: "10px 17px 13px",
            borderTop: "1px solid #f0f1f4",
            fontSize: 11.5,
            color: "#9aa0ab",
            lineHeight: 1.5,
          }}
        >
          {gmailOn ? (
            <>
              Showing Peak site visits only. To see your Google Calendar here
              (and add events to it), use <b>Enable calendar</b> on your
              mailbox in Settings → Mailboxes.
            </>
          ) : (
            <>Showing Peak site visits. Google Calendar arrives once Gmail is
              connected on this deployment.</>
          )}
        </div>
      )}
    </div>
  );
}
