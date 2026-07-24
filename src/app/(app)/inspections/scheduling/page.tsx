import Link from "next/link";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import {
  getAll,
  levelMeta,
  msOf,
  fmtShort,
  type InspectionRecord,
} from "@/lib/stores/inspections";
import { all as allCustomers } from "@/lib/stores/customers";
import { activeUsers } from "@/lib/users";
import { deriveInitials, fallbackColor } from "@/lib/team";
import { coordsOf } from "@/lib/geo";
import { InspectionMap } from "../controls";
import { ScheduleButton } from "./controls";
import type { MapPin } from "@/components/map/LeafletMap";

export const metadata = { title: "Inspection scheduler — Quartzite" };

/**
 * Inspection SCHEDULER — inspection twin of the flame-test scheduler
 * (IDEAS #44): requested inspections waiting on a date + inspector on the
 * left, the booked agenda underneath, and the route map on the right.
 * On-site visits stay on the agenda (chip) until the capture completes.
 */

const DAY = 86400000;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function iso(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/** Port of the prototype's _schedMeta: date tile + relative label. */
function schedMeta(isoStr: string) {
  const ms = msOf(isoStr);
  if (ms == null)
    return { mon: "—", day: "", rel: "", overdue: false, dayColor: "#16181d" };
  const d = new Date(ms);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((ms - today.getTime()) / DAY);
  let rel: string;
  let overdue = false;
  if (diff < 0) {
    rel = Math.abs(diff) + "d overdue";
    overdue = true;
  } else if (diff === 0) rel = "today";
  else if (diff === 1) rel = "tomorrow";
  else if (diff < 14) rel = "in " + diff + "d";
  else rel = fmtShort(isoStr);
  return {
    mon: MON[d.getMonth()],
    day: String(d.getDate()),
    rel,
    overdue,
    dayColor: overdue ? "#b4543a" : "#16181d",
  };
}

function money(n: number | null | undefined): string {
  return "$" + Math.round(n || 0).toLocaleString("en-US");
}

const CSS = `
  .ins-grid { display: grid; grid-template-columns: minmax(0,1fr) 400px; gap: 18px; align-items: start; }
  @media (max-width: 940px) { .ins-grid { grid-template-columns: 1fr !important; } }
`;

export default async function InspectionSchedulingPage() {
  const [, records, roster, customers] = await Promise.all([
    requireUser(),
    getAll(),
    activeUsers(),
    allCustomers(),
  ]);

  const identity = new Map(roster.map((u) => [u.name, { color: u.color, initials: u.initials }]));
  const initialsOf = (n: string) => identity.get(n)?.initials || deriveInitials(n || "");
  const colorOf = (n: string) => identity.get(n)?.color || fallbackColor(n || "");
  const techOptions = roster.map((u) => u.name);
  const defaultTech = techOptions[0] || "";

  const locCoords = new Map<string, { lat: number; lng: number }>();
  customers.forEach((c) => {
    (c.locations || []).forEach((l) => {
      const co = coordsOf(l);
      if (co && l.id) locCoords.set(c.id + "|" + l.id, { lat: co.lat, lng: co.lng });
    });
  });
  const recCoords = (r: InspectionRecord) =>
    r.customerId && r.locationId
      ? locCoords.get(r.customerId + "|" + r.locationId) || null
      : null;

  const requested = records.filter((r) => (r.stage || "requested") === "requested");
  const agenda = records
    .filter((r) => r.stage === "scheduled" || r.stage === "onsite")
    .sort((a, b) => (msOf(a.scheduledDate) || 0) - (msOf(b.scheduledDate) || 0));

  /* ---- map pins: requested (amber) + scheduled (blue) + on-site (purple) ---- */
  const pins: MapPin[] = [];
  records
    .filter((r) => r.stage !== "completed")
    .forEach((r) => {
      const c = recCoords(r);
      if (!c) return;
      const stage = r.stage || "requested";
      const when =
        stage === "scheduled"
          ? " — scheduled " + fmtShort(r.scheduledDate)
          : stage === "onsite"
            ? " — on site now"
            : " — awaiting a date";
      pins.push({
        id: r.id,
        lat: c.lat,
        lng: c.lng,
        color: stage === "scheduled" ? "#3155a8" : stage === "onsite" ? "#7b3f8a" : "#c98a2b",
        label: r.customer || "Venue",
        sub: (r.venue || "") + " · " + levelMeta(r.level).label + when,
      });
    });

  const total = requested.length + agenda.length;
  const standfirst = total
    ? requested.length + " to schedule · " + agenda.length + " booked"
    : "No requested inspections waiting — accepted quotes and direct requests appear here.";

  const scheduleTrigger: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 12.5,
    fontWeight: 600,
    color: "#fff",
    background: "var(--accent)",
    border: "none",
    borderRadius: 9,
    padding: "9px 14px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    fontFamily: "var(--font-ui)",
  };
  const editTrigger: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    height: 34,
    padding: "0 11px",
    fontSize: 12,
    fontWeight: 600,
    color: "#5b616e",
    background: "#fff",
    border: "1px solid #e4e7ec",
    borderRadius: 9,
    cursor: "pointer",
    fontFamily: "var(--font-ui)",
  };

  return (
    <div className="pk-content">
      <style>{CSS}</style>

      <Link
        href="/inspections"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12.5,
          fontWeight: 600,
          color: "#8c919c",
          textDecoration: "none",
          marginBottom: 12,
        }}
      >
        ← Inspections
      </Link>

      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>
            Inspection scheduler
          </div>
          <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5 }}>{standfirst}</div>
        </div>
        <Link
          href="/inspections/quote"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            fontSize: 13,
            fontWeight: 600,
            color: "#fff",
            background: "var(--accent)",
            borderRadius: 10,
            padding: "10px 16px",
            textDecoration: "none",
          }}
        >
          + New inspection quote
        </Link>
      </div>

      <div className="ins-grid">
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          {/* to schedule */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 13,
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "15px 20px 13px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#c98a2b" }} />
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>To schedule</div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab" }}>
                {requested.length}
              </span>
            </div>
            {requested.map((r) => {
              const lm = levelMeta(r.level);
              return (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0,1fr) auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "13px 20px",
                    borderBottom: "1px solid #f5f6f8",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span
                        style={{
                          fontSize: 13.5,
                          fontWeight: 600,
                          lineHeight: 1.25,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.customer || "Customer"}
                      </span>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          color: lm.ink,
                          background: lm.soft,
                          border: "1px solid " + lm.bd,
                          padding: "1px 6px",
                          borderRadius: 4,
                          flexShrink: 0,
                        }}
                      >
                        {lm.label}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 11.5,
                        color: "#9aa0ab",
                        marginTop: 2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {(r.venue || "Venue") +
                        (r.lineSets ? " · " + r.lineSets + " line sets" : "") +
                        (r.value ? " · " + money(r.value) : "") +
                        (r.quoteId ? " · from " + r.quoteId : "")}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    <Link
                      href={"/inspections/" + encodeURIComponent(r.id)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        height: 34,
                        padding: "0 11px",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#5b616e",
                        background: "#fff",
                        border: "1px solid #e4e7ec",
                        borderRadius: 9,
                        textDecoration: "none",
                      }}
                    >
                      Brief
                    </Link>
                    <ScheduleButton
                      recId={r.id}
                      mode="new"
                      customer={r.customer || "Customer"}
                      venue={r.venue || ""}
                      defaultDate={r.scheduledDate || iso(Date.now() + 7 * DAY)}
                      defaultTech={r.assignedTo || defaultTech}
                      techOptions={techOptions}
                      triggerLabel="Schedule"
                      triggerStyle={scheduleTrigger}
                    />
                  </div>
                </div>
              );
            })}
            {requested.length === 0 && (
              <div
                style={{
                  padding: "26px 20px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                Nothing waiting. Accepted inspection quotes and direct requests land here to be
                scheduled.
              </div>
            )}
          </div>

          {/* scheduled agenda */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 13,
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "15px 20px 13px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#3155a8" }} />
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>Scheduled</div>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab" }}>
                {agenda.length}
              </span>
            </div>
            {agenda.map((r) => {
              const sm = schedMeta(r.scheduledDate);
              const onsite = r.stage === "onsite";
              return (
                <div
                  key={r.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "64px minmax(0,1fr) auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "13px 20px",
                    borderBottom: "1px solid #f5f6f8",
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        fontWeight: 600,
                        color: "#9aa0ab",
                        letterSpacing: ".04em",
                        textTransform: "uppercase",
                      }}
                    >
                      {sm.mon}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 20,
                        fontWeight: 600,
                        lineHeight: 1.05,
                        color: sm.dayColor,
                      }}
                    >
                      {sm.day}
                    </div>
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 13.5,
                          fontWeight: 600,
                          lineHeight: 1.25,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.customer || "Customer"}
                      </span>
                      <span
                        style={{
                          display: "inline-block",
                          fontSize: 9,
                          fontWeight: 700,
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                          padding: "1px 6px",
                          borderRadius: 4,
                          flexShrink: 0,
                          color: onsite ? "#7b3f8a" : sm.overdue ? "#b4543a" : "#3155a8",
                          background: onsite ? "#f3eaf5" : sm.overdue ? "#f7e9e5" : "#e9eefb",
                        }}
                      >
                        {onsite ? "On-site" : sm.rel}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4 }}>
                      <span
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: "50%",
                          background: r.assignedTo ? colorOf(r.assignedTo) : "#8c919c",
                          color: "#fff",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 9,
                          fontWeight: 600,
                          flexShrink: 0,
                        }}
                      >
                        {r.assignedTo ? initialsOf(r.assignedTo) : "?"}
                      </span>
                      <span
                        style={{
                          fontSize: 11.5,
                          color: "#9aa0ab",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {(r.assignedTo || "Unassigned") +
                          " · " +
                          (r.venue || "Venue") +
                          " · " +
                          levelMeta(r.level).label}
                      </span>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                    {!onsite && (
                      <ScheduleButton
                        recId={r.id}
                        mode="edit"
                        customer={r.customer || "Customer"}
                        venue={r.venue || ""}
                        defaultDate={r.scheduledDate || iso(Date.now() + 7 * DAY)}
                        defaultTech={r.assignedTo || defaultTech}
                        techOptions={techOptions}
                        triggerLabel="Edit"
                        triggerStyle={editTrigger}
                      />
                    )}
                    <Link
                      href={"/inspections/" + encodeURIComponent(r.id)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        fontSize: 12.5,
                        fontWeight: 600,
                        color: "#fff",
                        background: "#1f7a52",
                        borderRadius: 9,
                        padding: "9px 13px",
                        textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Open capture
                    </Link>
                  </div>
                </div>
              );
            })}
            {agenda.length === 0 && (
              <div
                style={{
                  padding: "26px 20px",
                  textAlign: "center",
                  color: "#9aa0ab",
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                No visits on the calendar yet.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              background: "#fff",
              border: "1px solid #ececf0",
              borderRadius: 13,
              boxShadow: "0 1px 2px rgba(0,0,0,.04)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "15px 18px 13px", borderBottom: "1px solid #f0f1f4" }}>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>Requested &amp; booked</div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
                {(
                  [
                    ["#c98a2b", "To schedule"],
                    ["#3155a8", "Scheduled"],
                    ["#7b3f8a", "On-site"],
                  ] as Array<[string, string]>
                ).map(([color, label]) => (
                  <span
                    key={label}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      color: "#8c919c",
                    }}
                  >
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: "50%",
                        background: color,
                        border: "2px solid #fff",
                        boxShadow: "0 0 0 1px " + color,
                      }}
                    />
                    {label}
                  </span>
                ))}
              </div>
            </div>
            <div style={{ position: "relative" }}>
              <InspectionMap pins={pins} height={340} />
              {pins.length === 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: 12,
                    left: "50%",
                    transform: "translateX(-50%)",
                    zIndex: 5,
                    textAlign: "center",
                    color: "#5b616e",
                    fontSize: 12,
                    padding: "6px 12px",
                    background: "rgba(255,255,255,.92)",
                    border: "1px solid #e7eaee",
                    borderRadius: 8,
                    boxShadow: "0 1px 4px rgba(0,0,0,.1)",
                    whiteSpace: "nowrap",
                  }}
                >
                  No open inspections to map.
                </div>
              )}
            </div>
            <div style={{ padding: "11px 18px", fontSize: 11, color: "#aab0bb", lineHeight: 1.5 }}>
              Every inspection that hasn&#39;t been completed yet — plan the route before you book a
              day.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
