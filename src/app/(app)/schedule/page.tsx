import Link from "next/link";
import { requireUser } from "@/lib/session";
import { safeSweep } from "@/lib/safe-sweep";
import ActionError from "@/components/action-error";
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
} from "@/lib/stores/projects";
import { loadPipelines } from "@/lib/pipelines-server";
import { PROJECT_TAG_META, projectStageMeta, type Pipelines, type ProjectTag, type StageMeta } from "@/lib/pipelines";
import { loadServiceWork } from "@/lib/operations-work-server";
import { WORK_TYPE_META, type WorkType } from "@/lib/operations-work";
import { allEngagements, syncEngagementsFromQuotes } from "@/lib/stores/engagements";
import { OPEN_ENGAGEMENT_STAGES } from "@/lib/consulting-stages";
import { tasksForEngagement } from "@/lib/stores/tasks";
import { groupByPerson, mergeBookingsIntoPersonRows, UNASSIGNED_LABEL } from "./people-lib";
import { PortfolioGantt } from "./portfolio-gantt";
import type { GanttRow } from "@/components/gantt/gantt-grid";
import { dayColumns, ganttWindow, snapToDay, type GanttWindow } from "@/components/gantt/gantt-lib";
import { BookingDateField } from "./booking-date-field";

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

/* ---------- stage colours: the one tag map ----------
   Every colour read goes through tagColor(), which falls back to the backlog
   set for any tag it doesn't know — a stage id renamed/added in Settings →
   Pipelines (or a legacy key) can never throw here again. Labels come from
   the record's stageMeta, so Settings-edited names show. */
const tagColor = (tag: ProjectTag | null | undefined) =>
  PROJECT_TAG_META[tag as ProjectTag] ?? PROJECT_TAG_META.backlog;
const metaOf = (p: ProjectRecord, pipelines: Pipelines): StageMeta => p.stageMeta || projectStageMeta(pipelines, p);

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
  /** The project's stage tag (service bars: "scheduled") — colour key. */
  tag: ProjectTag;
  /** The project's stage label as named in Settings (service bars: "Scheduled"). */
  label: string;
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

/** #157 (D232) — px per day for the Project timeline's shared window, by
 *  zoom. The only place the timeline's horizontal scale is decided: both
 *  its sections lay out as percentages of one window, and this is what
 *  turns that window into a scrollable pixel width. */
const TL_DAYW: Record<number, number> = { 8: 26, 12: 18, 16: 13 };

/* #157 — the two section bands inside the one shared timeline grid. The
   band spans the full (scrollable) inner width so it reads as a divider;
   its label is `position: sticky` against the same scroll container the
   row label columns stick to, so "Consulting"/"Installs" stays readable
   however far the grid is scrolled instead of sliding off to the left. */
const tlBand: React.CSSProperties = {
  position: "relative",
  zIndex: 5,
  padding: "10px 14px 8px",
  background: "#fbfbfc",
  borderBottom: "1px solid #f1f2f5",
};
const tlBandLabel: React.CSSProperties = {
  position: "sticky",
  left: 14,
  display: "inline-block",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".05em",
  textTransform: "uppercase",
  color: "#9aa0ab",
};
const tlEmptyBand: React.CSSProperties = {
  position: "relative",
  zIndex: 5,
  padding: "26px 14px",
  background: "#fff",
  borderBottom: "1px solid #f1f2f5",
};
const tlEmptyLabel: React.CSSProperties = {
  position: "sticky",
  left: 14,
  display: "inline-block",
  fontSize: 13,
  color: "#9aa0ab",
};

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  const projectSyncOutcome = await safeSweep("schedule projects", syncProjectsFromQuotes, { created: 0, skipped: [] });
  const projectSyncBase = projectSyncOutcome.value;
  const projectSync = {
    ...projectSyncBase,
    skipped: projectSyncOutcome.error ? [...projectSyncBase.skipped, projectSyncOutcome.error] : projectSyncBase.skipped,
  };
  const [projects, users, pipelines] = await Promise.all([getAllProjects(), activeUsers(), loadPipelines()]);
  const tagOf = (p: ProjectRecord) => metaOf(p, pipelines).tag;
  const serviceWork = await loadServiceWork();

  /* ---- URL state ---- */
  const rawView = one(sp.view);
  const view = rawView === "timeline" ? "timeline" : rawView === "people" ? "people" : "crew";
  const zoom = [8, 12, 16].includes(Number(one(sp.zoom))) ? Number(one(sp.zoom)) : 8;
  const weekOffset = parseInt(one(sp.week) || "0", 10) || 0;
  // #145 — the By person view has no map/venue geometry of its own; force it
  // off rather than let a stale `?map=` param render an empty sidebar next
  // to a view it was never built for.
  const showMap = one(sp.map) !== "0" && view !== "people";
  const now = Date.now();

  /* ================= CONSULTING (#145 D172) ================= */
  // Loaded for both new views: "timeline" groups these into a Consulting
  // section above Installs; "people" needs every open engagement's tasks to
  // build the By person lanes. Skipped for "crew" — that view never touches
  // consulting data, so there's no reason to pay for it on the common case.
  // syncEngagementsFromQuotes() mirrors syncProjectsFromQuotes() above (same
  // idempotent won-quote-spawns-a-record idiom, D90) — without it, a won
  // consulting quote with no engagement record yet (nothing else on this
  // request path has visited the engagements hub) would read as "no
  // consulting engagements" here even though one is really pending.
  const engagementSyncOutcome = view === "timeline" || view === "people"
    ? await safeSweep("schedule consulting engagements", syncEngagementsFromQuotes, { created: 0, skipped: [] })
    : { value: { created: 0, skipped: [] as string[] }, error: null };
  const engagementSyncBase = engagementSyncOutcome.value;
  const engagementSync = {
    ...engagementSyncBase,
    skipped: engagementSyncOutcome.error ? [...engagementSyncBase.skipped, engagementSyncOutcome.error] : engagementSyncBase.skipped,
  };
  const engagements = view === "timeline" || view === "people" ? await allEngagements() : [];
  const openEngagements = engagements.filter((e) => OPEN_ENGAGEMENT_STAGES.includes(e.status));
  const consultingTasks =
    view === "people"
      ? (await Promise.all(openEngagements.map((e) => tasksForEngagement(e.id)))).flat()
      : [];

  /* ---- project colors + bookings ---- */
  const byId = projects.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
  const projColor: Record<string, string> = {};
  byId.forEach((p, i) => {
    projColor[p.id] = PALETTE[i % PALETTE.length];
  });
  const colorOf = (p: ProjectRecord) => projColor[p.id] || "#5b4b8a";

  const bookings: Booking[] = [];
  projects.forEach((p) => {
    const meta = metaOf(p, pipelines);
    (p.crew || []).forEach((c) =>
      bookings.push({
        projectId: p.id,
        projectName: p.name,
        customer: p.customer || "",
        tag: meta.tag,
        label: meta.label,
        completed: meta.tag === "done",
        crewId: c.id,
        mobId: c.mobId || null,
        person: c.person,
        role: c.role || "Installer",
        start: c.start,
        end: c.end,
        color: colorOf(p),
      })
    );
  });

  const schedulable = projects.filter((p) => tagOf(p) !== "done");
  const activeProjects = projects.filter((p) => p.kind === "project" && tagOf(p) !== "done");
  const onSiteNow = bookings.filter((b) => b.start <= now && b.end >= now).length;

  const standfirst =
    view === "timeline"
      ? schedulable.length +
        " project" +
        (schedulable.length === 1 ? "" : "s") +
        " · lead times → install windows" +
        (openEngagements.length
          ? " · " + openEngagements.length + " consulting engagement" + (openEngagements.length === 1 ? "" : "s")
          : "")
      : view === "people"
        ? users.length +
          " " +
          (users.length === 1 ? "person" : "people") +
          " · consulting + install work in one lane per person"
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
     unaffected.
     #145 review fix: this used to be its own locally-declared "Unassigned"
     string, agreeing with people-lib.ts's UNASSIGNED_LABEL only by
     coincidence of an identical literal — an independent edit to either one
     would silently break the By person view's Unassigned-lane merge (see
     mergeBookingsIntoPersonRows' own doc comment). Import the one real
     sentinel instead of restating it. */
  serviceWork.forEach((w) => {
    bookings.push({
      projectId: w.id,
      projectName: w.title,
      customer: w.subtitle,
      tag: "scheduled",
      label: "Scheduled",
      completed: false,
      crewId: w.id,
      mobId: null,
      person: w.assignee || UNASSIGNED_LABEL,
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
      const meta = metaOf(p, pipelines);
      return {
        id: p.id,
        name: p.name,
        city: loc?.city || "",
        state: loc?.state || "",
        color: colorOf(p),
        stageTag: meta.tag,
        stageLabel: meta.label,
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
    .filter((p) => tagOf(p) !== "done")
    .sort((a, b) => (a.installStart || a.targetDate || 0) - (b.installStart || b.targetDate || 0));
  const critOf = (p: ProjectRecord) => {
    const id = criticalLineId(p);
    return (p.procurement || []).find((x) => x.id === id) || null;
  };
  const TLLBLW = 240;
  /** The extent each install row actually draws: its critical line's order
   *  date through its on-site window (and its target diamond). Built as
   *  plain `{startAt,dueAt}` bars so the shared window below can be the
   *  union of these and the consulting bars (#157). */
  const installBars: Array<{ startAt: number; dueAt: number }> =
    view === "timeline"
      ? tlProjects.map((p) => {
          const cl = critOf(p);
          const leadStart = cl ? orderByDate(p, cl) : p.startedAt || p.createdAt || now;
          const onSite = p.installStart || p.targetDate || now;
          // The target diamond too, so the window really does contain
          // everything the row draws. Falls back to `onSite` rather than 0
          // when there's no target, or a missing date would drag the whole
          // window back to 1970.
          const target = p.targetDate || onSite;
          return {
            startAt: Math.min(leadStart, onSite, target),
            dueAt: Math.max(p.installEnd || p.targetDate || now, target, onSite),
          };
        })
      : [];

  /* ================= CONSULTING ROWS (#145 D172) =================
     The "Consulting" section of the Project timeline: one row per open
     engagement. A scheduled engagement gets a single bar spanning its
     startAt/endAt (the span is edited on the engagement's own Schedule tab,
     not by dragging here — same rule as install project bars); an
     unscheduled one still gets a row, just with no bar — the same "empty
     lane" idiom the By person view uses for a free person.

     #157 (D232): these rows used to render through PortfolioGantt/GanttGrid
     as a separate card above the board area, which is exactly how they came
     to have their own date window and their own layout strategy. They are
     now drawn by the same row markup as the Installs section below, under
     the same ruler, over the same window — so the shape here is a plain
     one-bar row rather than a GanttRow (nothing reads `group`, `tone`,
     `draggable` or `overrun` any more). GanttGrid is still what the By
     person view renders. */
  const engColor: Record<string, string> = {};
  openEngagements
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .forEach((e, i) => {
      engColor[e.id] = PALETTE[i % PALETTE.length];
    });
  type ConsultingTimelineRow = {
    id: string;
    label: string;
    bar: { startAt: number; dueAt: number; color: string } | null;
  };
  const consultingRows: ConsultingTimelineRow[] = openEngagements
    .slice()
    .sort((a, b) => (a.startAt || Infinity) - (b.startAt || Infinity))
    .map((e) => {
      const scheduled = (e.startAt || 0) > 0 && (e.endAt || 0) > (e.startAt || 0);
      return {
        id: e.id,
        label: e.name,
        bar: scheduled
          ? { startAt: e.startAt as number, dueAt: e.endAt as number, color: engColor[e.id] || "#5b4b8a" }
          : null,
      };
    });

  /* ===== ONE shared timeline window + ONE ruler (#157, D232) =====
     The Consulting and Installs sections used to build a window each — from
     their own bar set, and with two different layout strategies (percentage
     of container vs. a fixed px-per-day) — so the same x-position in the two
     stacked grids was, in general, two different calendar dates, with
     nothing on screen to say so. They now share one `{start, end, dayWidth}`
     spanning the earliest start and latest end of BOTH sets, one scroll
     container, one sticky ruler, and one layout strategy: percentage of that
     window, inside an inner width of exactly `days × dayWidth`, which is
     what keeps the zoom control meaningful while the percentages stay the
     single source of x. Boundaries are local-noon anchored (#154). */
  const timelineWindow: GanttWindow = ganttWindow(
    [...consultingRows.flatMap((r) => (r.bar ? [r.bar] : [])), ...installBars],
    now,
    TL_DAYW[zoom] || 18
  );
  const tlCols = view === "timeline" ? dayColumns(timelineWindow.start, timelineWindow.end) : [];
  const tlDays = tlCols.length;
  const tlGridW = tlDays * timelineWindow.dayWidth;
  /* Percentages are measured against the DAY-COLUMN frame — midnight of the
     first visible day through the END of the last — so the day columns tile
     the track exactly 0…100%. Measuring against the window's own noon-to-
     noon span instead would leave the grid hanging half a column off each
     edge, since `dayColumns` floors both boundaries to midnight. */
  const tlOrigin = tlCols.length ? tlCols[0] : snapToDay(timelineWindow.start);
  const tlSpan = Math.max(1, (tlCols.length ? tlCols[tlCols.length - 1] : tlOrigin) + DAY - tlOrigin);
  const tlPct = (ts: number) => ((ts - tlOrigin) / tlSpan) * 100;
  const tlDayPct = (DAY / tlSpan) * 100;
  /** An inclusive day span [a..b] as percentages of the shared window. */
  const tlSeg = (a: number, b: number) => {
    const left = Math.max(0, tlPct(snapToDay(a)));
    const right = tlPct(snapToDay(b)) + tlDayPct;
    return { left, width: Math.max(tlDayPct, Math.min(100, right) - left) };
  };
  const tlWeekStarts = tlCols.filter((d) => new Date(d).getDay() === 0);
  const tlWeekends = tlCols.filter((d) => new Date(d).getDay() === 0 || new Date(d).getDay() === 6);
  const tlTodayCol = snapToDay(now);
  const tlHasToday = tlCols.length > 0 && tlTodayCol >= tlCols[0] && tlTodayCol <= tlCols[tlCols.length - 1];

  /* ================= PEOPLE ROWS (#145 D172) =================
     The By person portfolio view: groupByPerson (people-lib.ts, pure, zero
     DB) builds one lane per active user plus Unassigned from consulting
     tasks alone; install/service work (this file's own `bookings`, already
     built above from project crew + flame/repair/inspection jobs) is
     merged in here as non-draggable bars, matched by person name — the
     same matching `bookedNames`/roster-building above already relies on.
     A booking whose person matches no user (a name-only crew booking, same
     as the crew board's own roster fallback) gets its own extra lane. */
  const sortedUsersByName = users
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const personBaseRows =
    view === "people"
      ? groupByPerson(
          consultingTasks.map((t) => ({
            id: t.id,
            title: t.title,
            assigneeUserId: t.assigneeUserId,
            assigneeName: t.assigneeName,
            startAt: t.startAt,
            dueAt: t.dueAt,
            engagementId: t.engagementId,
          })),
          sortedUsersByName.map((u) => ({ id: u.id, name: u.name }))
        )
      : [];
  // #145 review fix: the merge itself is now a pure, exported helper
  // (people-lib.ts's mergeBookingsIntoPersonRows) — same reason
  // groupByPerson was pulled out on its own, and the merge needed the same
  // treatment (it was previously exercised only by a live browser session
  // and an HTTP-200 smoke check, neither of which asserts anything about
  // rows/bars/draggability).
  const personRows: GanttRow[] = view === "people" ? mergeBookingsIntoPersonRows(personBaseRows, bookings) : [];
  // One window for the one grid this view renders. `dayWidth` stays 0:
  // GanttGrid is percentage-of-container with no fixed scale, so there is
  // no px-per-day to share here — but the noon anchoring (#154) matters,
  // since this window IS computed on the server and re-floored in the
  // browser by GanttGrid's `dayColumns`.
  const peopleRange = ganttWindow(
    personRows.flatMap((r) => r.bars),
    now
  );

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
      <ActionError
        message={
          projectSync.skipped.length || engagementSync.skipped.length
            ? `Some won quotes could not be reconciled for this schedule (${[...projectSync.skipped, ...engagementSync.skipped].join(", ")}). Refresh later or contact an administrator.`
            : undefined
        }
      />

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
          {view !== "people" && (
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
          )}

          {/* view switcher */}
          <div style={{ display: "flex", background: "#eef0f3", borderRadius: 10, padding: 3 }}>
            <Link href={boardParams({ view: null })} style={segBtn(view === "crew")}>
              Crew board
            </Link>
            <Link href={boardParams({ view: "timeline" })} style={segBtn(view === "timeline")}>
              Project timeline
            </Link>
            {/* #145 — the third view: every assignee's consulting + install
                work in one lane, spanning both kinds of work at once. */}
            <Link href={boardParams({ view: "people" })} style={segBtn(view === "people")}>
              By person
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
          style={
            view === "people"
              ? { flex: 1, minWidth: 0 }
              : {
                  flex: 1,
                  minWidth: 0,
                  background: "#fff",
                  border: "1px solid #e7e9ee",
                  borderRadius: showMap ? "13px 0 0 13px" : 13,
                  overflow: "hidden",
                }
          }
        >
          {/* ---------- BY PERSON (#145 D172) ---------- */}
          {view === "people" && (
            personRows.length > 0 ? (
              <PortfolioGantt rows={personRows} startAt={peopleRange.start} endAt={peopleRange.end} draggable />
            ) : (
              <div
                className="pk-card"
                style={{ padding: "60px 24px", textAlign: "center", color: "#9aa0ab" }}
              >
                <div style={{ fontSize: 15, fontWeight: 600, color: "#5b616e" }}>No one to schedule yet</div>
                <div style={{ fontSize: 13, lineHeight: 1.6, marginTop: 6 }}>
                  Active team members show up here, each in their own lane, once there is a team.
                </div>
              </div>
            )
          )}

          {/* #157: the Project timeline no longer falls back to this — it
              always renders both of its sections, each with its own empty
              state, so the Consulting rows don't vanish just because there
              are no install projects. */}
          {projects.length === 0 && view === "crew" && (
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

          {/* ---------- PROJECT TIMELINE (#157, D232) ----------
              ONE scroll container, ONE sticky ruler and ONE shared window
              for both sections, so a given x-position is the same calendar
              date in Consulting as it is in Installs. Everything below is
              positioned as a percentage of `timelineWindow` (via tlPct /
              tlSeg); the inner width of `TLLBLW + tlGridW` is what turns
              that percentage into the zoom's px-per-day and gives the two
              sections one shared horizontal scroll. */}
          {view === "timeline" && (
            <div
              className="sch-scroll"
              style={{ overflow: "auto", maxHeight: "calc(100vh - 210px)" }}
            >
              <div style={{ minWidth: TLLBLW + tlGridW, position: "relative" }}>
                {/* one calendar background behind BOTH sections */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: TLLBLW,
                    right: 0,
                    zIndex: 0,
                    pointerEvents: "none",
                  }}
                >
                  {tlWeekends.map((d) => (
                    <div
                      key={"twe" + d}
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${tlPct(d)}%`,
                        width: `${tlDayPct}%`,
                        background: "#fafbfc",
                      }}
                    />
                  ))}
                  {tlWeekStarts.map((w) => (
                    <div
                      key={"tsep" + w}
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${tlPct(w)}%`,
                        width: 1,
                        background: "#eef0f3",
                      }}
                    />
                  ))}
                  {tlHasToday && (
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: `${tlPct(tlTodayCol)}%`,
                        width: `${tlDayPct}%`,
                        background: "var(--accent-soft)",
                        borderLeft: "1.5px solid var(--accent)",
                      }}
                    />
                  )}
                </div>

                {/* ===== the one ruler, shared by both sections ===== */}
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
                  />
                  <div style={{ position: "relative", flex: 1, height: 40, overflow: "hidden" }}>
                    {tlWeekends.map((d) => (
                      <div
                        key={"rwe" + d}
                        style={{
                          position: "absolute",
                          top: 0,
                          bottom: 0,
                          left: `${tlPct(d)}%`,
                          width: `${tlDayPct}%`,
                          background: "#fafbfc",
                        }}
                      />
                    ))}
                    {tlWeekStarts.map((w) => (
                      <div
                        key={"rwl" + w}
                        style={{
                          position: "absolute",
                          top: "50%",
                          transform: "translateY(-50%)",
                          left: `calc(${tlPct(w)}% + 5px)`,
                          fontFamily: "var(--font-mono)",
                          fontSize: 9.5,
                          fontWeight: 600,
                          letterSpacing: ".04em",
                          color: "#aab0bb",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {md(w).toUpperCase()}
                      </div>
                    ))}
                  </div>
                </div>

                {/* ===== consulting (#145 D172, re-homed under the shared
                    ruler by #157) ===== */}
                <div style={tlBand}>
                  <span style={tlBandLabel}>Consulting</span>
                </div>
                {consultingRows.length > 0 ? (
                  consultingRows.map((row) => (
                    <div key={row.id} style={{ display: "flex", height: 44, position: "relative", zIndex: 1 }}>
                      <div
                        style={{
                          position: "sticky",
                          left: 0,
                          zIndex: 6,
                          width: TLLBLW,
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          padding: "0 14px",
                          background: "#fff",
                          borderRight: "1px solid #e7e9ee",
                          borderBottom: "1px solid #f1f2f5",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            lineHeight: 1.25,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {row.label}
                        </span>
                      </div>
                      <div
                        style={{
                          position: "relative",
                          flex: 1,
                          height: 44,
                          borderBottom: "1px solid #f1f2f5",
                        }}
                      >
                        {row.bar && (
                          <div
                            title={row.label + " · " + md(row.bar.startAt) + " – " + md(row.bar.dueAt)}
                            style={{
                              position: "absolute",
                              top: 11,
                              left: `${tlSeg(row.bar.startAt, row.bar.dueAt).left}%`,
                              width: `${tlSeg(row.bar.startAt, row.bar.dueAt).width}%`,
                              height: 22,
                              borderRadius: 7,
                              background: row.bar.color,
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
                            {row.label}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={tlEmptyBand}>
                    <span style={tlEmptyLabel}>No consulting engagements yet.</span>
                  </div>
                )}

                {/* ===== installs ===== */}
                <div style={tlBand}>
                  <span style={tlBandLabel}>Installs</span>
                </div>
                {tlProjects.length > 0 ? (
                  tlProjects.map((p) => {
                    const cl = critOf(p);
                    const leadStart = cl ? orderByDate(p, cl) : p.startedAt || p.createdAt || now;
                    const onSite = p.installStart || p.targetDate || now;
                    const pm = metaOf(p, pipelines);
                    const sm = { ...tagColor(pm.tag), label: pm.label };
                    const ps = tlSeg(leadStart, onSite - DAY);
                    const tgPct = tlPct(snapToDay(p.targetDate || 0)) + tlDayPct / 2;
                    const hasTarget = !!p.targetDate && tgPct >= 0 && tgPct <= 100;
                    return (
                      <Link
                        key={p.id}
                        href={"/projects?id=" + encodeURIComponent(p.id)}
                        style={{
                          display: "flex",
                          height: 72,
                          position: "relative",
                          zIndex: 1,
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
                              left: `${ps.left}%`,
                              width: `${ps.width}%`,
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
                                left: `${tlSeg(p.installStart, p.installEnd).left}%`,
                                width: `${tlSeg(p.installStart, p.installEnd).width}%`,
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
                                left: `${tgPct}%`,
                                marginLeft: -6,
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
                  })
                ) : (
                  <div style={tlEmptyBand}>
                    <span style={tlEmptyLabel}>No active projects to chart.</span>
                  </div>
                )}
              </div>
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
                      color: tagColor(m.stageTag).ink,
                      background: tagColor(m.stageTag).soft,
                      border: `1px solid ${tagColor(m.stageTag).bd}`,
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
                    <BookingDateField locationId={popProject?.locationId ?? null} defaultValue={isoOf(popStart)} />
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
