import Link from "next/link";
import { requireUser } from "@/lib/session";
import { activeUsers } from "@/lib/users";
import { deriveInitials, fallbackColor } from "@/lib/team";
import { coordsOf } from "@/lib/geo";
import { locationById } from "@/lib/stores/customers";
import type { MapPin } from "@/components/map/LeafletMap";
import { ScheduleMap } from "./controls";
import { bookCrew, updateBooking, removeBooking } from "./actions";
import {
  getAllProjects,
  syncProjectsFromQuotes,
  criticalLineId,
  orderByDate,
  type ProjectRecord,
  type ProjectStage,
} from "@/lib/stores/projects";
import { loadServiceWork } from "@/lib/operations-work-server";
import { WORK_TYPE_META, type WorkType } from "@/lib/operations-work";

export const metadata = { title: "Schedule — Quartzite-6" };

const DAY = 86400000;

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/* ---------- date helpers (port of Scheduling.dc.html) ---------- */
function sod(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function sow(ts: number): number {
  const d = new Date(sod(ts));
  d.setDate(d.getDate() - d.getDay()); // week starts Sunday
  return d.getTime();
}
function isoOf(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
function md(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ---------- stage palette (port of Scheduling stageMeta) ---------- */
const SM: Record<ProjectStage, { ink: string; soft: string; bd: string; label: string }> = {
  procurement: { ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd", label: "Materials" },
  delivery: { ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3", label: "Deliveries" },
  scheduled: { ink: "#5b4b8a", soft: "#efeaf6", bd: "#ddd3ec", label: "Scheduled" },
  install: { ink: "#9a5a1f", soft: "#fbeede", bd: "#f0dcc0", label: "Installing" },
  training: { ink: "#1f6a8a", soft: "#e4f1f6", bd: "#c5e2ec", label: "Training" },
  signoff: { ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", label: "Sign-off" },
  complete: { ink: "#5b616e", soft: "#f1f2f5", bd: "#e4e7ec", label: "Complete" },
};

const PALETTE = ["#5b4b8a", "#2f6f4f", "#3155a8", "#9a5a1f", "#1f6a8a", "#b4543a", "#7b3f8a", "#3f7a6a"];

const ZOOM_DAYW: Record<number, number> = { 8: 34, 12: 24, 16: 19 };
const RESW = 214;
const HEADH = 60;
const ROWH = 64;
const PASTD = 7; // days of history shown before the current week (drag-back is not ported)

const CSS = `
  .sch-back:hover { color: #16181d; }
  .sch-scroll::-webkit-scrollbar { width: 11px; height: 11px; }
  .sch-scroll::-webkit-scrollbar-thumb { background: #d2d6de; border-radius: 8px; border: 3px solid #fff; }
  .sch-bar-link:hover { filter: brightness(1.04); }
  .sch-tray-chip:hover { background: #fafbff; }
`;

type Booking = {
  projectId: string;
  projectName: string;
  customer: string;
  stage: ProjectStage;
  completed: boolean;
  crewId: string;
  mobId: string | null;
  person: string;
  role: string;
  start: number;
  end: number;
  color: string;
  /** Set on service (flame/inspection/repair) bars: links to the record instead of the booking editor. */
  recordHref?: string;
  /** Set on service bars: source work type, for reference/debugging. */
  workType?: WorkType;
};

/* greedy track packing so overlapping bars don't collide */
function packTracks(items: Array<{ s: number; e: number; k: string }>): {
  map: Record<string, number>;
  n: number;
} {
  const sorted = items.slice().sort((a, b) => a.s - b.s);
  const ends: number[] = [];
  const map: Record<string, number> = {};
  sorted.forEach((it) => {
    let tk = ends.findIndex((en) => en < it.s);
    if (tk < 0) {
      tk = ends.length;
      ends.push(it.e);
    } else ends[tk] = it.e;
    map[it.k] = tk;
  });
  return { map, n: Math.max(1, ends.length) };
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  await syncProjectsFromQuotes();
  const [projects, users] = await Promise.all([getAllProjects(), activeUsers()]);
  const serviceWork = await loadServiceWork();

  /* ---- URL state ---- */
  const view = one(sp.view) === "timeline" ? "timeline" : "crew";
  const zoom = [8, 12, 16].includes(Number(one(sp.zoom))) ? Number(one(sp.zoom)) : 8;
  const weekOffset = parseInt(one(sp.week) || "0", 10) || 0;
  const showMap = one(sp.map) !== "0";
  const now = Date.now();

  /* ---- project colors + bookings ---- */
  const byId = projects.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const projColor: Record<string, string> = {};
  byId.forEach((p, i) => {
    projColor[p.id] = PALETTE[i % PALETTE.length];
  });
  const colorOf = (p: ProjectRecord) => projColor[p.id] || "#5b4b8a";

  const bookings: Booking[] = [];
  projects.forEach((p) =>
    (p.crew || []).forEach((c) =>
      bookings.push({
        projectId: p.id,
        projectName: p.name,
        customer: p.customer || "",
        stage: p.stage,
        completed: p.stage === "complete",
        crewId: c.id,
        mobId: c.mobId || null,
        person: c.person,
        role: c.role || "Installer",
        start: c.start,
        end: c.end,
        color: colorOf(p),
      })
    )
  );

  const schedulable = projects.filter((p) => p.stage !== "complete");
  const activeProjects = projects.filter((p) => p.kind === "project" && p.stage !== "complete");
  const onSiteNow = bookings.filter((b) => b.start <= now && b.end >= now).length;

  const standfirst =
    view === "timeline"
      ? schedulable.length +
        " project" +
        (schedulable.length === 1 ? "" : "s") +
        " · lead times → install windows"
      : bookings.length +
        " booking" +
        (bookings.length === 1 ? "" : "s") +
        " across " +
        activeProjects.length +
        " active project" +
        (activeProjects.length === 1 ? "" : "s") +
        (onSiteNow ? " · " + onSiteNow + " on site today" : "");

  /* ---- service work (flame/inspection/repair) overlaid as single-day bars ----
     Synthesized as Booking-shaped entries so the crew board's roster building,
     track packing and row rendering (below) handle them for free. Appended
     after onSiteNow/standfirst are computed so those project-only stats are
     unaffected. */
  const UNASSIGNED_LANE = "Unassigned";
  serviceWork.forEach((w) => {
    bookings.push({
      projectId: w.id,
      projectName: w.title,
      customer: w.subtitle,
      stage: "scheduled",
      completed: false,
      crewId: w.id,
      mobId: null,
      person: w.assignee || UNASSIGNED_LANE,
      role: WORK_TYPE_META[w.type].label,
      start: w.startMs,
      end: w.endMs, // inclusive single day — do not add a day
      color: WORK_TYPE_META[w.type].color,
      recordHref: w.href,
      workType: w.type,
    });
  });

  /* ---- roster (booked first) ---- */
  const roster = users.map((u) => ({ name: u.name, initials: u.initials, color: u.color }));
  const bookedNames = new Set(bookings.map((b) => b.person));
  bookings.forEach((b) => {
    if (!roster.some((r) => r.name === b.person))
      roster.push({
        name: b.person,
        initials: deriveInitials(b.person),
        color: fallbackColor(b.person),
      });
  });
  roster.sort((a, b) => (bookedNames.has(a.name) ? 0 : 1) - (bookedNames.has(b.name) ? 0 : 1));

  /* ---- href helper preserving board state ---- */
  const boardParams = (extra: Record<string, string | number | null>) => {
    const q = new URLSearchParams();
    if (view !== "crew") q.set("view", view);
    if (zoom !== 8) q.set("zoom", String(zoom));
    if (weekOffset !== 0) q.set("week", String(weekOffset));
    if (!showMap) q.set("map", "0");
    for (const [k, v] of Object.entries(extra)) {
      if (v === null) q.delete(k);
      else q.set(k, String(v));
    }
    const s = q.toString();
    return "/schedule" + (s ? "?" + s : "");
  };

  /* ---- job-location pins ---- */
  const mapRows = await Promise.all(
    schedulable.map(async (p) => {
      const loc = await locationById(p.customerId, p.locationId);
      const c = loc ? coordsOf(loc) : null;
      if (!c) return null;
      const sm = SM[p.stage] || SM.procurement;
      return {
        id: p.id,
        name: p.name,
        city: loc?.city || "",
        state: loc?.state || "",
        color: colorOf(p),
        stageLabel: sm.label,
        pin: {
          id: p.id,
          lat: c.lat,
          lng: c.lng,
          color: colorOf(p),
          label: p.name,
          sub: (loc?.city || "") + (loc?.state ? ", " + loc.state : ""),
        } as MapPin,
      };
    })
  );
  const mapped = mapRows.filter((r): r is NonNullable<typeof r> => r !== null);
  mapped.sort((a, b) => {
    const ca = a.city.toLowerCase(),
      cb = b.city.toLowerCase();
    if (ca !== cb) return ca < cb ? -1 : 1;
    return a.name < b.name ? -1 : 1;
  });
  const pins = mapped.map((m) => m.pin);

  /* ================= CREW BOARD MODEL ================= */
  const dayW = ZOOM_DAYW[zoom] || 34;
  const rangeDays = zoom * 7 + PASTD;
  const startDay = sow(now) - PASTD * DAY + weekOffset * 7 * DAY;
  const gridW = rangeDays * dayW;
  const frameW = RESW + gridW;
  const idxOf = (ts: number) => Math.round((sod(ts) - startDay) / DAY);
  const workdays = Math.max(1, zoom * 5);

  // per-person track packing → global row height
  const packs: Record<string, ReturnType<typeof packTracks>> = {};
  let maxTracks = 1;
  roster.forEach((person) => {
    const items = bookings
      .filter((b) => b.person === person.name)
      .map((b) => ({ s: b.start, e: b.end, k: b.crewId }));
    const pk = packTracks(items);
    packs[person.name] = pk;
    if (pk.n > maxTracks) maxTracks = pk.n;
  });
  const BARH = maxTracks > 1 ? 40 : 46;
  const gapT = 6;
  const padT = 9;
  const rowH = maxTracks > 1 ? padT * 2 + maxTracks * BARH + (maxTracks - 1) * gapT : ROWH;

  // header cells
  const dayCells = [];
  for (let i = 0; i < rangeDays; i++) {
    const ts = startDay + i * DAY;
    const d = new Date(ts);
    const wd = d.getDay();
    const weekend = wd === 0 || wd === 6;
    const today = sod(ts) === sod(now);
    dayCells.push({ i, wd: ["S", "M", "T", "W", "T", "F", "S"][wd], day: d.getDate(), weekend, today });
  }
  const weekMarks = [];
  for (let w = 0; w * 7 < rangeDays; w++) {
    weekMarks.push({ w, label: md(startDay + w * 7 * DAY).toUpperCase() });
  }
  const todayIdx = idxOf(now);
  const hasToday = todayIdx >= 0 && todayIdx < rangeDays;

  /* ---- tray chips (unplaced mobilizations / whole projects) ---- */
  type Chip = { key: string; name: string; meta: string; color: string; href: string };
  const tray: Chip[] = [];
  activeProjects.forEach((p) => {
    const col = colorOf(p);
    const mobs = p.mobilizations || [];
    const unplaced = mobs.filter(
      (m) => !bookings.some((b) => b.projectId === p.id && b.mobId === m.id)
    );
    if (unplaced.length) {
      unplaced.forEach((m, mi) =>
        tray.push({
          key: p.id + ":" + (m.id || mi),
          name: (m.type || "Mobilization") + " · " + (m.days || 1) + "d",
          meta: p.name + " · " + (m.crew || 1) + " crew",
          color: col,
          href: boardParams({
            book: 1,
            project: p.id,
            role: m.type || "Installer",
            days: m.days || 1,
            mob: m.id || "",
          }),
        })
      );
    } else if (!mobs.length) {
      const span =
        p.installStart && p.installEnd
          ? Math.max(1, Math.round((sod(p.installEnd) - sod(p.installStart)) / DAY) + 1)
          : 3;
      const crewN = (p.crew || []).length;
      tray.push({
        key: p.id,
        name: p.name,
        meta: (p.customer || "—") + " · " + (crewN ? crewN + " booked" : "no crew"),
        color: col,
        href: boardParams({ book: 1, project: p.id, days: span }),
      });
    }
  });

  /* ================= PROJECT TIMELINE MODEL ================= */
  const tlProjects = projects
    .filter((p) => p.stage !== "complete")
    .sort((a, b) => (a.installStart || a.targetDate || 0) - (b.installStart || b.targetDate || 0));
  const critOf = (p: ProjectRecord) => {
    const id = criticalLineId(p);
    return (p.procurement || []).find((x) => x.id === id) || null;
  };
  let tlStart = 0,
    tlDays = 0,
    tlDayW = 18,
    tlGridW = 0;
  const TLLBLW = 240;
  if (view === "timeline" && tlProjects.length) {
    let lo = Infinity,
      hi = -Infinity;
    tlProjects.forEach((p) => {
      const cl = critOf(p);
      const leadStart = cl ? orderByDate(p, cl) : p.startedAt || p.createdAt || now;
      const onSite = p.installStart || p.targetDate || now;
      lo = Math.min(lo, leadStart, onSite);
      hi = Math.max(hi, p.installEnd || p.targetDate || now, p.targetDate || now);
    });
    if (!isFinite(lo)) {
      lo = now - 14 * DAY;
      hi = now + 28 * DAY;
    }
    tlStart = sow(lo - 3 * DAY);
    const tlEnd = sow(hi + 10 * DAY) + 7 * DAY;
    tlDays = Math.max(14, Math.round((tlEnd - tlStart) / DAY));
    tlDayW = ({ 8: 26, 12: 18, 16: 13 } as Record<number, number>)[zoom] || 18;
    tlGridW = tlDays * tlDayW;
  }
  const tlXOf = (ts: number) => Math.round((sod(ts) - tlStart) / DAY) * tlDayW;
  const tlSeg = (a: number, b: number) => {
    const x = tlXOf(a);
    const x2 = (Math.round((sod(b) - tlStart) / DAY) + 1) * tlDayW;
    return { x: Math.max(0, x), w: Math.max(tlDayW, x2 - Math.max(0, x)) };
  };
  const tlTodayX = tlXOf(now);

  /* ================= POPOVER MODEL ================= */
  const bookOpen = one(sp.book) === "1";
  const editKey = one(sp.edit); // "projectId~crewId"
  let editBooking: Booking | null = null;
  if (editKey) {
    const [pid, cid] = editKey.split("~");
    editBooking = bookings.find((b) => b.projectId === pid && b.crewId === cid) || null;
  }
  const popOpen = bookOpen || !!editBooking;
  const popMode: "new" | "edit" = editBooking ? "edit" : "new";

  const projectProjects = projects.filter((p) => p.kind === "project");
  const prefProject = one(sp.project);
  const prefRole = one(sp.role);
  const prefDays = one(sp.days);
  const prefMob = one(sp.mob);

  const popProjectId = editBooking?.projectId || prefProject || projectProjects[0]?.id || "";
  const popProject = projects.find((p) => p.id === popProjectId) || null;
  const popPerson = editBooking?.person || roster[0]?.name || "";
  const popRole = editBooking?.role || prefRole || "Installer";
  const popStart = editBooking ? editBooking.start : sod(now);
  const popDays = editBooking
    ? Math.round((sod(editBooking.end) - sod(editBooking.start)) / DAY) + 1
    : parseInt(prefDays || "3", 10) || 3;
  const closeHref = boardParams({
    book: null,
    edit: null,
    project: null,
    role: null,
    days: null,
    mob: null,
  });

  const segBtn = (on: boolean): React.CSSProperties => ({
    fontFamily: "var(--font-ui)",
    fontSize: 12.5,
    fontWeight: 600,
    padding: "7px 14px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
    ...(on
      ? { background: "#fff", color: "#16181d", boxShadow: "0 1px 2px rgba(0,0,0,.12)" }
      : { background: "transparent", color: "#787d87" }),
  });
  const zoomBtn = (on: boolean): React.CSSProperties => ({
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    fontWeight: 600,
    padding: "6px 11px",
    borderRadius: 7,
    border: "none",
    cursor: "pointer",
    textDecoration: "none",
    display: "inline-block",
    ...(on
      ? { background: "#fff", color: "#16181d", boxShadow: "0 1px 2px rgba(0,0,0,.12)" }
      : { background: "transparent", color: "#787d87" }),
  });
  const labelCap: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    color: "#9aa0ab",
    letterSpacing: ".04em",
    textTransform: "uppercase",
    marginBottom: 6,
  };
  const inputCss: React.CSSProperties = {
    width: "100%",
    fontFamily: "var(--font-ui)",
    fontSize: 14,
    border: "1px solid #e4e7ec",
    borderRadius: 10,
    padding: "11px 12px",
    outline: "none",
    background: "#fff",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <style>{CSS}</style>

      {/* ===== toolbar ===== */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-.015em", lineHeight: 1.1 }}>
            Schedule
          </div>
          <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 3 }}>{standfirst}</div>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginLeft: "auto",
            flexWrap: "wrap",
          }}
        >
          <Link
            href={boardParams({ map: showMap ? "0" : null })}
            title="Toggle job-location map"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 12.5,
              fontWeight: 600,
              padding: "7px 13px",
              borderRadius: 9,
              textDecoration: "none",
              border: `1px solid ${showMap ? "var(--accent)" : "#e7e9ee"}`,
              background: showMap ? "var(--accent-soft)" : "#fff",
              color: showMap ? "var(--accent)" : "#5b616e",
              whiteSpace: "nowrap",
            }}
          >
            Map
          </Link>

          {/* view switcher */}
          <div style={{ display: "flex", background: "#eef0f3", borderRadius: 10, padding: 3 }}>
            <Link href={boardParams({ view: null })} style={segBtn(view === "crew")}>
              Crew board
            </Link>
            <Link href={boardParams({ view: "timeline" })} style={segBtn(view === "timeline")}>
              Project timeline
            </Link>
          </div>

          {view === "crew" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                  background: "#f4f5f7",
                  border: "1px solid #e7e9ee",
                  borderRadius: 9,
                  padding: 2,
                }}
              >
                <Link
                  href={boardParams({ week: weekOffset - 1 })}
                  title="Previous week"
                  style={{
                    width: 30,
                    height: 30,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 7,
                    fontSize: 15,
                    color: "#5b616e",
                    textDecoration: "none",
                  }}
                >
                  ‹
                </Link>
                <Link
                  href={boardParams({ week: null })}
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#3a3f4a",
                    borderRadius: 7,
                    padding: "0 10px",
                    height: 30,
                    display: "flex",
                    alignItems: "center",
                    textDecoration: "none",
                  }}
                >
                  Today
                </Link>
                <Link
                  href={boardParams({ week: weekOffset + 1 })}
                  title="Next week"
                  style={{
                    width: 30,
                    height: 30,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 7,
                    fontSize: 15,
                    color: "#5b616e",
                    textDecoration: "none",
                  }}
                >
                  ›
                </Link>
              </div>
              <div style={{ display: "flex", background: "#eef0f3", borderRadius: 9, padding: 3 }}>
                {[8, 12, 16].map((z) => (
                  <Link key={z} href={boardParams({ zoom: z === 8 ? null : z })} style={zoomBtn(zoom === z)}>
                    {z}w
                  </Link>
                ))}
              </div>
              <Link
                href={boardParams({ book: 1 })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#fff",
                  background: "var(--accent)",
                  borderRadius: 9,
                  padding: "9px 14px",
                  textDecoration: "none",
                  whiteSpace: "nowrap",
                }}
              >
                + Book crew
              </Link>
            </div>
          )}
          {view === "timeline" && (
            <div style={{ display: "flex", background: "#eef0f3", borderRadius: 9, padding: 3 }}>
              {[8, 12, 16].map((z) => (
                <Link key={z} href={boardParams({ zoom: z === 8 ? null : z })} style={zoomBtn(zoom === z)}>
                  {z}w
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== board area + map ===== */}
      <div style={{ display: "flex", gap: 0, alignItems: "stretch", minHeight: 0 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            background: "#fff",
            border: "1px solid #e7e9ee",
            borderRadius: showMap ? "13px 0 0 13px" : 13,
            overflow: "hidden",
          }}
        >
          {projects.length === 0 && (
            <div
              style={{
                padding: "60px 24px",
                textAlign: "center",
                color: "#9aa0ab",
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: "#5b616e" }}>
                Nothing scheduled yet
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 6 }}>
                Projects with install labor show up here. Convert a won quote in{" "}
                <Link
                  href="/projects"
                  style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}
                >
                  Projects
                </Link>
                , or book a crew to get started.
              </div>
            </div>
          )}

          {/* ---------- CREW BOARD ---------- */}
          {projects.length > 0 && view === "crew" && (
            <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
              <div
                className="sch-scroll"
                style={{ overflow: "auto", maxHeight: "calc(100vh - 250px)" }}
              >
                <div style={{ minWidth: frameW, position: "relative" }}>
                  {/* header */}
                  <div
                    style={{
                      display: "flex",
                      position: "sticky",
                      top: 0,
                      zIndex: 15,
                      height: HEADH,
                      background: "#fff",
                      borderBottom: "1px solid #e7e9ee",
                    }}
                  >
                    <div
                      style={{
                        position: "sticky",
                        left: 0,
                        zIndex: 16,
                        width: RESW,
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "flex-end",
                        padding: "0 14px 9px",
                        background: "#fff",
                        borderRight: "1px solid #e7e9ee",
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: "#9aa0ab",
                          letterSpacing: ".04em",
                          textTransform: "uppercase",
                        }}
                      >
                        Crew
                      </span>
                    </div>
                    <div style={{ position: "relative", flex: 1, height: HEADH }}>
                      {weekMarks.map((w) => (
                        <div
                          key={"wl" + w.w}
                          style={{
                            position: "absolute",
                            top: 5,
                            left: w.w * 7 * dayW + 6,
                            fontFamily: "var(--font-mono)",
                            fontSize: 9.5,
                            fontWeight: 600,
                            letterSpacing: ".04em",
                            color: "#aab0bb",
                          }}
                        >
                          {w.label}
                        </div>
                      ))}
                      {dayCells.map((d) => (
                        <div
                          key={"dc" + d.i}
                          style={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            left: d.i * dayW,
                            width: dayW,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 1,
                            borderLeft: `1px solid ${d.i % 7 === 0 ? "#e4e7ec" : "#f1f2f5"}`,
                            background: d.weekend ? "#fafbfc" : undefined,
                          }}
                        >
                          <span style={{ fontSize: 9.5, color: "#aab0bb", fontWeight: 600 }}>
                            {d.wd}
                          </span>
                          <span
                            style={{
                              fontFamily: "var(--font-mono)",
                              fontSize: 12,
                              fontWeight: 600,
                              lineHeight: 1.4,
                              ...(d.today
                                ? {
                                    color: "#fff",
                                    background: "var(--accent)",
                                    width: 20,
                                    height: 20,
                                    borderRadius: "50%",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                  }
                                : { color: "#5b616e" }),
                            }}
                          >
                            {d.day}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* rows */}
                  <div style={{ position: "relative" }}>
                    {/* background shading */}
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        left: RESW,
                        width: gridW,
                        height: roster.length * rowH,
                        zIndex: 0,
                        pointerEvents: "none",
                      }}
                    >
                      {dayCells
                        .filter((d) => d.weekend)
                        .map((d) => (
                          <div
                            key={"we" + d.i}
                            style={{
                              position: "absolute",
                              top: 0,
                              bottom: 0,
                              left: d.i * dayW,
                              width: dayW,
                              background: "#fafbfc",
                            }}
                          />
                        ))}
                      {hasToday && (
                        <div
                          style={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            left: todayIdx * dayW,
                            width: dayW,
                            background: "var(--accent-soft)",
                            borderLeft: "1.5px solid var(--accent)",
                          }}
                        />
                      )}
                      {weekMarks.map((w) => (
                        <div
                          key={"ws" + w.w}
                          style={{
                            position: "absolute",
                            top: 0,
                            bottom: 0,
                            left: w.w * 7 * dayW,
                            width: 1,
                            background: "#e4e7ec",
                          }}
                        />
                      ))}
                      {roster.map((_, r) => (
                        <div
                          key={"rl" + r}
                          style={{
                            position: "absolute",
                            left: 0,
                            right: 0,
                            top: (r + 1) * rowH,
                            height: 1,
                            background: "#f1f2f5",
                          }}
                        />
                      ))}
                    </div>

                    {roster.map((person, rowIndex) => {
                      const mine = bookings.filter((b) => b.person === person.name);
                      const pk = packs[person.name] || { map: {}, n: 1 };
                      const barTop = (tk: number) =>
                        Math.round((rowH - (pk.n * BARH + (pk.n - 1) * gapT)) / 2) +
                        tk * (BARH + gapT);
                      let clash = false;
                      for (let i = 0; i < mine.length; i++)
                        for (let j = i + 1; j < mine.length; j++)
                          if (mine[i].start <= mine[j].end && mine[i].end >= mine[j].start)
                            clash = true;
                      const covered: Record<number, boolean> = {};
                      mine.forEach((b) => {
                        const s = Math.max(0, idxOf(b.start));
                        const e = Math.min(rangeDays - 1, idxOf(b.end));
                        for (let i = s; i <= e; i++) {
                          const wd = new Date(startDay + i * DAY).getDay();
                          if (wd !== 0 && wd !== 6) covered[i] = true;
                        }
                      });
                      const util = Math.min(1, Object.keys(covered).length / workdays);
                      const totalDays = mine.reduce(
                        (a, b) => a + (Math.round((sod(b.end) - sod(b.start)) / DAY) + 1),
                        0
                      );
                      const sub = mine.length
                        ? mine.length + " job" + (mine.length === 1 ? "" : "s") + " · " + totalDays + "d"
                        : "Available";

                      return (
                        <div
                          key={person.name}
                          style={{ display: "flex", height: rowH, position: "relative" }}
                        >
                          <div
                            style={{
                              position: "sticky",
                              left: 0,
                              zIndex: 10,
                              width: RESW,
                              flexShrink: 0,
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              padding: "0 14px",
                              background: "#fff",
                              borderRight: "1px solid #e7e9ee",
                              borderBottom: "1px solid #f1f2f5",
                            }}
                          >
                            <span
                              style={{
                                width: 34,
                                height: 34,
                                borderRadius: 9,
                                background: person.color || "#6b7079",
                                color: "#fff",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 12,
                                fontWeight: 600,
                                flexShrink: 0,
                              }}
                            >
                              {person.initials}
                            </span>
                            <span style={{ minWidth: 0, flex: 1 }}>
                              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <span
                                  style={{
                                    fontSize: 13.5,
                                    fontWeight: 600,
                                    lineHeight: 1.2,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {person.name}
                                </span>
                                {clash && (
                                  <span
                                    title="Double-booked"
                                    style={{
                                      width: 7,
                                      height: 7,
                                      borderRadius: "50%",
                                      background: "#d6452f",
                                      flexShrink: 0,
                                    }}
                                  />
                                )}
                              </span>
                              <span
                                style={{
                                  display: "block",
                                  fontSize: 11,
                                  color: "#9aa0ab",
                                  marginTop: 2,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {sub}
                              </span>
                              <span
                                style={{
                                  display: "block",
                                  width: 64,
                                  height: 3,
                                  borderRadius: 2,
                                  background: "#eef0f3",
                                  marginTop: 6,
                                  overflow: "hidden",
                                }}
                              >
                                <span
                                  style={{
                                    display: "block",
                                    height: "100%",
                                    width: Math.round(util * 100) + "%",
                                    background: clash
                                      ? "#d6452f"
                                      : util > 0.85
                                        ? "#9a5a1f"
                                        : "var(--accent)",
                                    borderRadius: 2,
                                  }}
                                />
                              </span>
                            </span>
                          </div>
                          <div
                            style={{
                              position: "relative",
                              flex: 1,
                              height: rowH,
                              borderBottom: "1px solid #f1f2f5",
                            }}
                          >
                            {mine.map((b) => {
                              const s = idxOf(b.start),
                                e = idxOf(b.end);
                              if (e < 0 || s > rangeDays - 1) return null;
                              const cs = Math.max(0, s),
                                ce = Math.min(rangeDays, e + 1);
                              const x = cs * dayW,
                                w = Math.max(dayW * 0.5, (ce - cs) * dayW);
                              const truncStart = s < 0,
                                truncEnd = e > rangeDays - 1;
                              const conflict =
                                mine.some(
                                  (o) => o !== b && b.start <= o.end && b.end >= o.start
                                );
                              return (
                                <Link
                                  key={b.crewId}
                                  href={
                                    b.recordHref ??
                                    boardParams({ edit: b.projectId + "~" + b.crewId })
                                  }
                                  className="sch-bar-link"
                                  title={b.projectName + " · " + b.role}
                                  style={{
                                    position: "absolute",
                                    top: barTop(pk.map[b.crewId] || 0),
                                    left: x,
                                    width: w,
                                    height: BARH,
                                    background: b.color,
                                    borderRadius: 8,
                                    padding: "6px 9px",
                                    overflow: "hidden",
                                    textDecoration: "none",
                                    zIndex: 2,
                                    boxShadow: "0 1px 2px rgba(0,0,0,.18)",
                                    ...(b.completed ? { opacity: 0.5 } : {}),
                                    ...(truncStart
                                      ? { borderTopLeftRadius: 0, borderBottomLeftRadius: 0 }
                                      : {}),
                                    ...(truncEnd
                                      ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 }
                                      : {}),
                                    ...(conflict ? { border: "2px solid #d6452f" } : {}),
                                  }}
                                >
                                  <span
                                    style={{
                                      display: "block",
                                      fontSize: 12,
                                      fontWeight: 600,
                                      color: "#fff",
                                      lineHeight: 1.2,
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {b.projectName}
                                  </span>
                                  <span
                                    style={{
                                      display: "block",
                                      fontFamily: "var(--font-mono)",
                                      fontSize: 9.5,
                                      color: "rgba(255,255,255,.82)",
                                      lineHeight: 1.3,
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      marginTop: 1,
                                    }}
                                  >
                                    {b.role}
                                  </span>
                                </Link>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* tray */}
              <div
                style={{
                  flexShrink: 0,
                  borderTop: "1px solid #e7e9ee",
                  background: "#fafbfc",
                  padding: "9px 14px 11px",
                }}
              >
                <div
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: "#9aa0ab",
                    letterSpacing: ".05em",
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  Projects · tap to book onto a crew member
                </div>
                <div
                  className="sch-scroll"
                  style={{ display: "flex", gap: 9, overflowX: "auto", paddingBottom: 4 }}
                >
                  {tray.map((c) => (
                    <Link
                      key={c.key}
                      href={c.href}
                      className="sch-tray-chip"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        minWidth: 200,
                        maxWidth: 250,
                        flexShrink: 0,
                        background: "#fff",
                        border: "1px solid #e7e9ee",
                        borderRadius: 11,
                        padding: "9px 12px",
                        textDecoration: "none",
                        color: "inherit",
                        boxShadow: "0 1px 2px rgba(0,0,0,.05)",
                      }}
                    >
                      <span
                        style={{
                          width: 11,
                          height: 11,
                          borderRadius: "50%",
                          flexShrink: 0,
                          background: c.color,
                        }}
                      />
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span
                          style={{
                            display: "block",
                            fontSize: 12.5,
                            fontWeight: 600,
                            lineHeight: 1.2,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {c.name}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: 10.5,
                            color: "#9aa0ab",
                            lineHeight: 1.3,
                            marginTop: 1,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {c.meta}
                        </span>
                      </span>
                    </Link>
                  ))}
                  {tray.length === 0 && (
                    <div style={{ fontSize: 12, color: "#aab0bb", padding: "8px 4px" }}>
                      No active projects to schedule.
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ---------- PROJECT TIMELINE ---------- */}
          {projects.length > 0 && view === "timeline" && tlProjects.length > 0 && (
            <div
              className="sch-scroll"
              style={{ overflow: "auto", maxHeight: "calc(100vh - 210px)" }}
            >
              <div style={{ minWidth: TLLBLW + tlGridW, position: "relative" }}>
                <div
                  style={{
                    display: "flex",
                    position: "sticky",
                    top: 0,
                    zIndex: 15,
                    height: 40,
                    background: "#fff",
                    borderBottom: "1px solid #e7e9ee",
                  }}
                >
                  <div
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 16,
                      width: TLLBLW,
                      flexShrink: 0,
                      display: "flex",
                      alignItems: "center",
                      padding: "0 14px",
                      background: "#fff",
                      borderRight: "1px solid #e7e9ee",
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: "#9aa0ab",
                        letterSpacing: ".04em",
                        textTransform: "uppercase",
                      }}
                    >
                      Project
                    </span>
                  </div>
                  <div style={{ position: "relative", flex: 1, height: 40 }}>
                    {Array.from({ length: Math.ceil(tlDays / 7) }).map((_, w) => (
                      <div
                        key={"tw" + w}
                        style={{
                          position: "absolute",
                          top: "50%",
                          transform: "translateY(-50%)",
                          left: w * 7 * tlDayW + 6,
                          fontFamily: "var(--font-mono)",
                          fontSize: 9.5,
                          fontWeight: 600,
                          color: "#aab0bb",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {md(tlStart + w * 7 * DAY)}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ position: "relative" }}>
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: TLLBLW,
                      width: tlGridW,
                      height: tlProjects.length * 72,
                      zIndex: 0,
                      pointerEvents: "none",
                    }}
                  >
                    {Array.from({ length: Math.ceil(tlDays / 7) }).map((_, w) => (
                      <div
                        key={"tsep" + w}
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: w * 7 * tlDayW,
                          width: 1,
                          background: "#eef0f3",
                        }}
                      />
                    ))}
                    {tlTodayX >= 0 && tlTodayX <= tlGridW && (
                      <div
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: tlTodayX,
                          width: 2,
                          background: "var(--accent)",
                          opacity: 0.7,
                        }}
                      />
                    )}
                    {tlProjects.map((_, r) => (
                      <div
                        key={"trl" + r}
                        style={{
                          position: "absolute",
                          left: 0,
                          right: 0,
                          top: (r + 1) * 72,
                          height: 1,
                          background: "#f1f2f5",
                        }}
                      />
                    ))}
                  </div>

                  {tlProjects.map((p) => {
                    const cl = critOf(p);
                    const leadStart = cl ? orderByDate(p, cl) : p.startedAt || p.createdAt || now;
                    const onSite = p.installStart || p.targetDate || now;
                    const sm = SM[p.stage] || SM.procurement;
                    const ps = tlSeg(leadStart, onSite - DAY);
                    const tgX = tlXOf(p.targetDate || 0) + tlDayW / 2;
                    const hasTarget = !!p.targetDate && tgX >= 0 && tgX <= tlGridW;
                    return (
                      <Link
                        key={p.id}
                        href={"/projects?id=" + encodeURIComponent(p.id)}
                        style={{
                          display: "flex",
                          height: 72,
                          position: "relative",
                          textDecoration: "none",
                          color: "inherit",
                        }}
                      >
                        <div
                          style={{
                            position: "sticky",
                            left: 0,
                            zIndex: 6,
                            width: TLLBLW,
                            flexShrink: 0,
                            padding: "11px 14px",
                            background: "#fff",
                            borderRight: "1px solid #e7e9ee",
                            borderBottom: "1px solid #f1f2f5",
                          }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              fontSize: 10,
                              fontWeight: 600,
                              color: sm.ink,
                              background: sm.soft,
                              border: `1px solid ${sm.bd}`,
                              padding: "2px 8px",
                              borderRadius: 20,
                            }}
                          >
                            {sm.label}
                          </span>
                          <span
                            style={{
                              display: "block",
                              fontSize: 13,
                              fontWeight: 600,
                              lineHeight: 1.25,
                              marginTop: 6,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {p.name}
                          </span>
                          <span
                            style={{
                              display: "block",
                              fontSize: 11,
                              color: "#9aa0ab",
                              marginTop: 2,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {cl ? cl.vendor + " · " + cl.leadDays + "d lead" : "In-house"}
                          </span>
                        </div>
                        <div
                          style={{
                            position: "relative",
                            flex: 1,
                            height: 72,
                            borderBottom: "1px solid #f1f2f5",
                          }}
                        >
                          <div
                            style={{
                              position: "absolute",
                              top: 18,
                              left: ps.x,
                              width: ps.w,
                              height: 12,
                              borderRadius: 6,
                              background:
                                "repeating-linear-gradient(45deg,#fbf3dd,#fbf3dd 5px,#f6ebcf 5px,#f6ebcf 10px)",
                              border: "1px solid #f0e2bd",
                            }}
                          />
                          {p.kind === "project" && p.installStart && p.installEnd && (
                            <div
                              style={{
                                position: "absolute",
                                top: 33,
                                left: tlSeg(p.installStart, p.installEnd).x,
                                width: tlSeg(p.installStart, p.installEnd).w,
                                height: 20,
                                borderRadius: 7,
                                background: sm.ink,
                                color: "#fff",
                                display: "flex",
                                alignItems: "center",
                                padding: "0 8px",
                                fontSize: 10.5,
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                              }}
                            >
                              Install
                            </div>
                          )}
                          {hasTarget && (
                            <div
                              title={"Target " + md(p.targetDate || 0)}
                              style={{
                                position: "absolute",
                                top: 38,
                                left: tgX - 6,
                                width: 11,
                                height: 11,
                                background: "#16181d",
                                transform: "rotate(45deg)",
                                borderRadius: 2,
                                border: "2px solid #fff",
                                boxShadow: "0 0 0 1px #16181d",
                              }}
                            />
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {projects.length > 0 && view === "timeline" && tlProjects.length === 0 && (
            <div
              style={{
                padding: "50px 24px",
                textAlign: "center",
                color: "#9aa0ab",
                fontSize: 13,
              }}
            >
              No active projects to chart.
            </div>
          )}
        </div>

        {/* ---------- map sidebar ---------- */}
        {showMap && (
          <div
            style={{
              width: 320,
              flexShrink: 0,
              borderTop: "1px solid #e7e9ee",
              borderRight: "1px solid #e7e9ee",
              borderBottom: "1px solid #e7e9ee",
              borderRadius: "0 13px 13px 0",
              background: "#fff",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "12px 14px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.15 }}>Job locations</div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#9aa0ab",
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {mapped.length
                    ? mapped.length +
                      " job" +
                      (mapped.length === 1 ? "" : "s") +
                      " mapped · click to locate"
                    : "No mappable jobs yet"}
                </div>
              </div>
              <Link
                href={boardParams({ map: "0" })}
                title="Hide map"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: "#f4f5f7",
                  color: "#8c919c",
                  fontSize: 15,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  textDecoration: "none",
                }}
              >
                ×
              </Link>
            </div>
            <ScheduleMap pins={pins} />
            <div className="sch-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              {mapped.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 14px",
                    borderBottom: "1px solid #f5f6f8",
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: m.color,
                    }}
                  />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: 12.5,
                        fontWeight: 600,
                        lineHeight: 1.25,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {m.name}
                    </span>
                    <span
                      style={{
                        display: "block",
                        fontSize: 10.5,
                        color: "#9aa0ab",
                        lineHeight: 1.3,
                        marginTop: 1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {(m.city || "—") + (m.state ? ", " + m.state : "")}
                    </span>
                  </span>
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 9.5,
                      fontWeight: 600,
                      color: SM[projects.find((p) => p.id === m.id)?.stage || "procurement"].ink,
                      background: SM[projects.find((p) => p.id === m.id)?.stage || "procurement"].soft,
                      border: `1px solid ${SM[projects.find((p) => p.id === m.id)?.stage || "procurement"].bd}`,
                      padding: "2px 7px",
                      borderRadius: 20,
                    }}
                  >
                    {m.stageLabel}
                  </span>
                </div>
              ))}
              {mapped.length === 0 && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#aab0bb",
                    padding: "18px 14px",
                    textAlign: "center",
                    lineHeight: 1.5,
                  }}
                >
                  No mappable jobs — add a venue address on the customer to place it here.
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ===== booking popover ===== */}
      {popOpen && (
        <div
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
          <Link href={closeHref} aria-label="Close" style={{ position: "absolute", inset: 0 }} />
          <div
            style={{
              position: "relative",
              width: 380,
              maxWidth: "100%",
              background: "#fff",
              borderRadius: 16,
              boxShadow: "0 24px 60px rgba(0,0,0,.28)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "16px 18px 14px",
                borderBottom: "1px solid #f0f1f4",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, flex: 1 }}>
                {popMode === "edit" ? "Edit booking" : "Book crew"}
              </div>
              <Link
                href={closeHref}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "#f4f5f7",
                  color: "#8c919c",
                  fontSize: 17,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  textDecoration: "none",
                }}
              >
                ×
              </Link>
            </div>
            <form action={popMode === "edit" ? updateBooking : bookCrew}>
              <input type="hidden" name="projectId" value={popProjectId} />
              {popMode === "edit" && editBooking && (
                <input type="hidden" name="crewId" value={editBooking.crewId} />
              )}
              {popMode === "new" && prefMob && <input type="hidden" name="mobId" value={prefMob} />}
              <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 13 }}>
                <label style={{ display: "block" }}>
                  <span style={labelCap}>Project</span>
                  {popMode === "edit" ? (
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        padding: "11px 12px",
                        background: "#f7f8fa",
                        border: "1px solid #eef0f3",
                        borderRadius: 10,
                      }}
                    >
                      {popProject ? popProject.id + " · " + popProject.name : "—"}
                    </div>
                  ) : (
                    <select
                      name="projectId"
                      defaultValue={popProjectId}
                      style={{ ...inputCss, cursor: "pointer" }}
                    >
                      {projectProjects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.id + " · " + p.name}
                        </option>
                      ))}
                    </select>
                  )}
                </label>

                <label style={{ display: "block" }}>
                  <span style={labelCap}>Crew member</span>
                  <select
                    name="person"
                    defaultValue={popPerson}
                    style={{ ...inputCss, cursor: "pointer" }}
                  >
                    {roster.map((r) => (
                      <option key={r.name} value={r.name}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div style={{ display: "flex", gap: 11 }}>
                  <label style={{ display: "block", flex: 1 }}>
                    <span style={labelCap}>Start</span>
                    <input
                      type="date"
                      name="start"
                      defaultValue={isoOf(popStart)}
                      required
                      style={{ ...inputCss, fontFamily: "var(--font-mono)", fontSize: 13 }}
                    />
                  </label>
                  <label style={{ display: "block", width: 96 }}>
                    <span style={labelCap}>Days</span>
                    <input
                      type="number"
                      name="days"
                      min={1}
                      defaultValue={popDays}
                      style={{
                        ...inputCss,
                        fontFamily: "var(--font-mono)",
                        textAlign: "center",
                        padding: "11px 8px",
                      }}
                    />
                  </label>
                </div>

                <label style={{ display: "block" }}>
                  <span style={labelCap}>Role</span>
                  <input
                    name="role"
                    defaultValue={popRole}
                    placeholder="Installer"
                    style={inputCss}
                  />
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
                {popMode === "edit" && editBooking && (
                  <button
                    type="submit"
                    formAction={removeBooking}
                    style={{
                      fontFamily: "var(--font-ui)",
                      fontSize: 13,
                      fontWeight: 600,
                      color: "#d6452f",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: "9px 4px",
                    }}
                  >
                    Remove
                  </button>
                )}
                <Link
                  href={closeHref}
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
                    textDecoration: "none",
                  }}
                >
                  Cancel
                </Link>
                <button
                  type="submit"
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#fff",
                    border: "none",
                    borderRadius: 9,
                    padding: "10px 18px",
                    cursor: "pointer",
                    background: "var(--accent)",
                  }}
                >
                  {popMode === "edit" ? "Save" : "Book crew"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
