/* Auto task calendar — spec checks
   (docs/superpowers/specs/2026-10-09-auto-task-calendar-design.md).
   Chained from test-review-and-spec.ts. */
import { readFileSync } from "node:fs";
import type { CalendarEvent } from "@/lib/google/calendar";
import type { DriveLeg } from "@/lib/drive-plan/plan";
import type { CalendarRead } from "@/lib/visit-plan/check";
import type { SiteVisit } from "@/lib/stores/site-visits";
import { TRIAGE_HOOKS } from "@/lib/triage/hooks";
import { planItemsByPerson } from "@/lib/task-plan/items";
import { handOff, markInProgress, pinBlock, pushDueDate, setTierSize, unpinBlock } from "@/lib/task-plan/write";
import { calendarBudgetMs, loadTaskPlans, savePlanPins, VIEW_PLAN_CALENDAR_MS, type PersonPlan, type PinStore, type TaskPlanDeps } from "@/lib/task-plan/load";
import type { AtRiskShared } from "@/lib/triage/hooks";
import { taskPlanAtRisk } from "@/lib/task-plan/triage";
import { like } from "drizzle-orm";
import { getDb } from "@/db";
import { blobs } from "@/db/schema";
import { activeUsers } from "@/lib/users";
import { autoTaskId, createAutoTask, createTask, createTaskOnce, getTask, normalizeTask, removeTask, setTaskStatus, updateTask, type TaskRecord } from "@/lib/stores/tasks";
import { addPins, clearItemPins, getPins, getPinState, removePinKeys } from "@/lib/stores/task-pins";
import { allAssignments, createAssignment, getAssignment, removeAssignment, setAssignmentDone, updateAssignment, type Assignment } from "@/lib/stores/assignments";
import { upsertDoc } from "@/db/doc-store";
import { triageKey } from "@/lib/triage/keys";
import { tierOf } from "@/lib/triage/feeds/tasks";
import { addDays, chicagoDayKey, chicagoDayStart } from "@/lib/drive-plan/day";
import { chunkFor, floorQuarter, freeDays } from "@/lib/task-plan/free";
import { atRiskLabel, calendarNote, finishText, fmtBlockTime, GOOGLE_NOTE_ME, NOT_PLACED_TEXT } from "@/lib/task-plan/labels";
import { planPerson } from "@/lib/task-plan/plan";
import { cleanPinMove, PIN_MAX_PER_PERSON, pinBlobKey, pinBlobValue, pinsFromBlob, pinsToPrune, releaseBlobKey, releasedFromBlob, type PinMove } from "@/lib/task-plan/pins";
import { chicagoWallMs, weekdayOf } from "@/lib/visit-plan/hours";
import { DEFAULT_WORK_HOURS } from "@/lib/visit-plan/settings";
import {
  autoDueAt,
  deadlineOf,
  defaultDueAt,
  dueStampForDay,
  effectiveDue,
  planDueBackfill,
  type BackfillItem,
} from "@/lib/task-plan/due";
import { overrunsEnd } from "@/lib/consulting-schedule";
import { presetFor, widgetDef } from "@/lib/dashboard/registry";
import { todayRows } from "@/lib/task-plan/today";
import { localDayKey, type CalendarTaskItem } from "@/lib/calendar-tasks";
import { calendarPlanView, clockText, composeCalendarPlan, dragStartMs, layoutIntervals, localInputToMs, monthChips, msToLocalInput, pinArgs, PLAN_FAILED_NOTE, stripTasks } from "@/lib/task-plan/calendar-view";
import { runDueBackfill, setAssignmentDue, setTaskDue } from "@/lib/task-plan/backfill";
import { readTierSize } from "@/lib/task-plan/fields";
import { buildThreadTaskInput } from "@/lib/inbox-task";
import {
  cleanSize,
  cleanTier,
  parsePlanItemKey,
  PLAN_HORIZON_DAYS,
  planItemKey,
  QUARTER_MS,
  SIZE_MIN,
  sizeMinutes,
  tierOrDefault,
  type BusyInterval,
  type PinKind,
  type PlanInput,
  type PlanItem,
  type PlanPin,
  type PlanResult,
  type TaskTier,
} from "@/lib/task-plan/types";
import { daysLeft, sortByUrgency, urgencyWeight, type UrgencyKey } from "@/lib/task-plan/urgency";
import { fixtureId, registerFixture } from "./test-fixtures";

export type Ok = (cond: boolean, msg: string) => void;

/* ---- helpers ---- */
// 2036-10-13 is a Monday; October 2036 is CDT (UTC−5) throughout.
const MON = "2036-10-13";
const TUE = "2036-10-14";
const WED = "2036-10-15";
const FRI = "2036-10-17";
const SAT = "2036-10-18";
const MIN = 60_000;
/** Epoch-ms of h:m Chicago wall time on `day`. */
const at = (day: string, h: number, m = 0) => chicagoWallMs(day, h * 60 + m);
/** A plan item: a Normal, 1 h task for u1, due Friday 5 pm, created at 1. */
function item(id: string, over: Partial<PlanItem> = {}): PlanItem {
  return {
    key: planItemKey("task", id),
    kind: "task",
    id,
    userId: "u1",
    title: id,
    href: "",
    tier: "normal",
    size: "m",
    sizeMin: 60,
    dueMs: at(FRI, 17),
    dueVirtual: false,
    earliestMs: null,
    createdAt: 1,
    inProgress: false,
    ...over,
  };
}
/** One exported function's source, up to the next top-level export. */
function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) return "";
  const next = src.indexOf("\nexport ", start + 1);
  return next < 0 ? src.slice(start) : src.slice(start, next);
}
/** True when `call` is the function body's first `await`. */
function firstAwait(body: string, call: string): boolean {
  const i = body.indexOf("await ");
  return i >= 0 && body.startsWith("await " + call, i);
}

/* ---- Task 1: fields ---- */
export async function autoCalFieldsChecks(ok: Ok): Promise<void> {
  ok(cleanTier("high") === "high" && cleanTier("HIGH") === null && cleanTier("") === null && cleanSize("l") === "l" && cleanSize(4) === null,
    "auto-cal fields: tier and size accept only high|normal|low and s|m|l");
  ok(SIZE_MIN.s === 30 && SIZE_MIN.m === 60 && SIZE_MIN.l === 240 && sizeMinutes(undefined) === 60 && tierOrDefault(undefined) === "normal",
    "auto-cal fields: S 30 min · M 1 h · L 4 h; blank = Normal, 1 h");
  ok(planItemKey("task", "T-1") === triageKey.task("T-1") && planItemKey("assignment", "as-1") === triageKey.assignment("as-1"),
    "auto-cal fields: plan item keys are triage's keys (task:<id> / asg:<id>)");
  ok(JSON.stringify(parsePlanItemKey("asg:as-9")) === JSON.stringify({ kind: "assignment", id: "as-9" }) && parsePlanItemKey("lead:x") === null,
    "auto-cal fields: item keys parse back");
  const n = normalizeTask({ id: "T-x", title: "x", priority: "high", size: "l" });
  const junk = normalizeTask({ id: "T-y", title: "y", priority: "urgent", size: "xl" } as unknown as Partial<TaskRecord> & { id: string });
  const bare = normalizeTask({ id: "T-z", title: "z" });
  ok(n.priority === "high" && n.size === "l" && !("priority" in junk) && !("size" in junk) && !("priority" in bare) && !("size" in bare),
    "auto-cal fields: normalizeTask carries a valid tier/size and drops junk; an old doc reads exactly as before");
  ok(tierOf(n) === "high" && tierOf(bare) === null, "auto-cal fields: morning triage reads the tier off a normalized task");
  const fd = new FormData();
  fd.set("priority", "low");
  fd.set("size", "bogus");
  ok(JSON.stringify(readTierSize(fd)) === JSON.stringify({ priority: "low", size: "m" }) && JSON.stringify(readTierSize(new FormData())) === "{}",
    "auto-cal fields: a form's chips read as tier/size (a bad size reads as M); a form without the chips changes nothing");

  const me = { id: "TESTautocal:u1", name: "Auto Cal" };
  const T = fixtureId("autocal", "fields-task");
  await createTask({ id: T, title: "fields", priority: "low", size: "s" }, me);
  registerFixture("tasks", T);
  const t1 = await getTask(T);
  ok(t1?.priority === "low" && t1?.size === "s", "auto-cal fields: createTask stores tier and size");
  await updateTask(T, { priority: "high", size: "l" });
  const t2 = await getTask(T);
  ok(t2?.priority === "high" && t2?.size === "l", "auto-cal fields: updateTask changes them");
  const a = await createAssignment({ title: "fields asg", assignee: "Auto Cal", createdBy: "Auto Cal", priority: "high", size: "nope" });
  registerFixture("assignments", a.id);
  const a2 = await getAssignment(a.id);
  ok(a2?.priority === "high" && !("size" in (a2 ?? {})), "auto-cal fields: createAssignment keeps a valid tier and drops a bad size");
  await updateAssignment(a.id, { size: "l" });
  ok((await getAssignment(a.id))?.size === "l", "auto-cal fields: updateAssignment sets a size");
}

/* ---- Task 2: due dates ---- */
export async function autoCalDueChecks(ok: Ok): Promise<void> {
  const now = at(MON, 10);
  ok(chicagoDayKey(defaultDueAt(now)) === "2036-10-20" && defaultDueAt(now) === at("2036-10-20", 17), "auto-cal due: +7 days, stamped 5:00 pm Chicago");
  ok(new Date(defaultDueAt(now)).toISOString().slice(0, 10) === "2036-10-20", "auto-cal due: the stamp's UTC date is the same day, so Google Tasks shows the right date");
  ok(deadlineOf(at(FRI, 7)) === chicagoDayStart(SAT), "auto-cal due: a due date holds until the end of its Chicago day");
  ok(autoDueAt(null, true, now) === defaultDueAt(now) && autoDueAt(null, false, now) === null && autoDueAt(at(FRI, 12), true, now) === at(FRI, 12) && autoDueAt(0, true, now) === defaultDueAt(now),
    "auto-cal due: only an assigned item with no date gets the +7 default");
  const v = effectiveDue(null, at(MON, 9));
  ok(v.virtual && v.dueMs === defaultDueAt(at(MON, 9)) && effectiveDue(null, at(FRI, 9)).dueMs === defaultDueAt(at(FRI, 9)) && !effectiveDue(at(FRI, 12), 1).virtual,
    "auto-cal due: an undated item plans as if due 7 days from NOW — a rolling date, never stored (D801)");

  // Backfill plan (pure)
  const items: BackfillItem[] = [
    { kind: "task", id: "T-3", person: "u1", personName: "Dana", createdAt: 300 },
    { kind: "task", id: "T-1", person: "u1", personName: "Dana", createdAt: 100 },
    { kind: "assignment", id: "as-2", person: "u1", personName: "Dana", createdAt: 200 },
    { kind: "task", id: "T-9", person: "u2", personName: "Sam", createdAt: 50 },
  ];
  const hours = new Map([["u1", DEFAULT_WORK_HOURS], ["u2", { days: [2, 4], startMin: 480, endMin: 1020 }]]);
  const plan = planDueBackfill({ items, hoursByPerson: hours, nowMs: at(FRI, 10) });
  const dana = plan.updates.filter((u) => u.person === "u1");
  ok(dana.map((u) => u.id).join() === "T-1,as-2,T-3", "auto-cal backfill: oldest first");
  ok(dana.map((u) => u.dayKey).join() === "2036-10-20,2036-10-28,2036-11-06" && dana.every((u) => weekdayOf(u.dayKey) >= 1 && weekdayOf(u.dayKey) <= 5),
    "auto-cal backfill: spread evenly over the next 4 weeks of work days (never today, never a weekend)");
  const sam = plan.updates.find((u) => u.person === "u2");
  ok(sam?.dayKey === "2036-10-21" && sam.dueAt === dueStampForDay("2036-10-21"), "auto-cal backfill: each person's own work days (Sam works Tue/Thu)");
  ok(JSON.stringify(plan.perPerson.map((p) => [p.name, p.count])) === JSON.stringify([["Dana", 3], ["Sam", 1]]), "auto-cal backfill: counts per person");

  // Backfill runner (in-memory deps): dry run writes nothing, apply writes, a second run is a no-op
  const tasksMem: TaskRecord[] = [
    normalizeTask({ id: "T-1", title: "a", assigneeUserId: "u1", assigneeName: "Dana", createdAt: 1 }),
    normalizeTask({ id: "T-dated", title: "b", assigneeUserId: "u1", assigneeName: "Dana", dueAt: at(FRI, 17), createdAt: 2 }),
    normalizeTask({ id: "T-done", title: "c", assigneeUserId: "u1", assigneeName: "Dana", status: "done", createdAt: 3 }),
    normalizeTask({ id: "T-none", title: "d", createdAt: 4 }),
  ];
  const asgMem: Assignment[] = [{ id: "as-1", title: "e", assignee: "dana", createdBy: "x", createdAt: 5, dueDate: 0, link: null, done: false, doneAt: null, doneVia: null, source: "" }];
  const deps = {
    now: () => at(FRI, 10),
    roster: async () => [{ id: "u1", name: "Dana" }],
    tasks: async () => tasksMem,
    assignments: async () => asgMem,
    workHours: async () => DEFAULT_WORK_HOURS,
    setTaskDue: async (id: string, dueAt: number) => {
      const t = tasksMem.find((x) => x.id === id)!;
      if (t.dueAt && t.dueAt > 0) return false;
      t.dueAt = dueAt;
      return true;
    },
    setAssignmentDue: async (id: string, dueAt: number) => {
      const a = asgMem.find((x) => x.id === id)!;
      if (a.dueDate > 0) return false;
      a.dueDate = dueAt;
      return true;
    },
  };
  const dry = await runDueBackfill({ apply: false, deps });
  ok(dry.planned === 2 && dry.updated === 0 && !tasksMem[0].dueAt && asgMem[0].dueDate === 0, "auto-cal backfill: the dry run counts and writes nothing");
  const applied = await runDueBackfill({ apply: true, deps });
  ok(applied.updated === 2 && (tasksMem[0].dueAt ?? 0) > 0 && asgMem[0].dueDate > 0, "auto-cal backfill: --apply writes the due dates (a name-only assignee resolves case-insensitively)");
  ok((await runDueBackfill({ apply: true, deps })).planned === 0, "auto-cal backfill: a second run finds nothing to change");

  // +7 in the create functions (DB)
  const me = { id: "TESTautocal:u1", name: "Auto Cal" };
  const before = Date.now();
  const T1 = fixtureId("autocal", "due-assigned");
  const T2 = fixtureId("autocal", "due-unassigned");
  const T3 = fixtureId("autocal", "due-explicit");
  await createTask({ id: T1, title: "due assigned", assigneeUserId: me.id, assigneeName: me.name }, me);
  await createTask({ id: T2, title: "due unassigned" }, me);
  await createTask({ id: T3, title: "due explicit", assigneeUserId: me.id, assigneeName: me.name, dueAt: at(FRI, 12) }, me);
  for (const id of [T1, T2, T3]) registerFixture("tasks", id);
  const expect = (ms: number | null | undefined) => ms === defaultDueAt(before) || ms === defaultDueAt(Date.now());
  ok(expect((await getTask(T1))?.dueAt) && (await getTask(T2))?.dueAt === null && (await getTask(T3))?.dueAt === at(FRI, 12),
    "auto-cal due: createTask gives an assigned, undated task a due date 7 days out; unassigned and dated tasks are left alone");
  const cov = fixtureId("autocal", "due-auto-coverage");
  registerFixture("tasks", autoTaskId(cov));
  const auto = await createAutoTask({ title: "due auto", coverageKey: cov, assigneeUserId: me.id, assigneeName: me.name });
  ok(expect(auto?.dueAt), "auto-cal due: createAutoTask (checklists, templates) gets the same default");
  const a = await createAssignment({ title: "due asg", assignee: me.name, createdBy: me.name });
  registerFixture("assignments", a.id);
  const b = await createAssignment({ title: "due asg dated", assignee: me.name, createdBy: me.name, dueDate: at(FRI, 12) });
  registerFixture("assignments", b.id);
  ok(expect(a.dueDate) && b.dueDate === at(FRI, 12), "auto-cal due: createAssignment gives an undated assignment a due date 7 days out");

  // Reassigning an undated item to someone stamps the same +7 (the create rule), never over a real date or an engine's.
  await updateTask(T2, { assigneeUserId: me.id, assigneeName: me.name });
  ok(expect((await getTask(T2))?.dueAt), "auto-cal due: assigning an undated task to someone stamps +7 (same rule as create)");
  await updateTask(T3, { assigneeUserId: "TESTautocal:u2", assigneeName: "Other Person" });
  ok((await getTask(T3))?.dueAt === at(FRI, 12), "auto-cal due: reassigning a dated task keeps its date");
  const unasg = await createAssignment({ title: "due asg unassigned", assignee: "", createdBy: me.name });
  registerFixture("assignments", unasg.id);
  ok(!unasg.dueDate, "auto-cal due: an unassigned assignment stays undated");
  await updateAssignment(unasg.id, { assignee: me.name });
  ok(expect((await getAssignment(unasg.id))?.dueDate), "auto-cal due: assigning an undated assignment to someone stamps +7");

  // Fix round 1: createTaskOnce (Krisp #323 meeting to-dos) stamps the same default
  const O1 = fixtureId("autocal", "once-assigned");
  const O2 = fixtureId("autocal", "once-unassigned");
  const O3 = fixtureId("autocal", "once-explicit");
  for (const id of [O1, O2, O3]) registerFixture("tasks", id);
  const o1 = await createTaskOnce({ id: O1, title: "once assigned", assigneeUserId: me.id, assigneeName: me.name }, me);
  const o2 = await createTaskOnce({ id: O2, title: "once unassigned" }, me);
  const o3 = await createTaskOnce({ id: O3, title: "once explicit", assigneeUserId: me.id, assigneeName: me.name, dueAt: at(FRI, 12) }, me);
  ok(expect(o1.dueAt) && expect((await getTask(O1))?.dueAt), "auto-cal due: createTaskOnce gives an assigned, undated task the +7 stamp (returned and stored)");
  ok(o2.dueAt === null && (await getTask(O2))?.dueAt === null, "auto-cal due: createTaskOnce leaves an unassigned task undated");
  ok(o3.dueAt === at(FRI, 12) && (await getTask(O3))?.dueAt === at(FRI, 12), "auto-cal due: createTaskOnce keeps an explicit date");
  const o1again = await createTaskOnce({ id: O1, title: "once assigned", assigneeUserId: me.id, assigneeName: me.name, dueAt: at(FRI, 12) }, me);
  ok(o1again.dueAt === (await getTask(O1))?.dueAt && o1again.dueAt !== at(FRI, 12), "auto-cal due: a second createTaskOnce returns the stored row, never overwrites it");

  // Fix round 1: consulting engagements — the schedule engine owns its dates
  const ENG = "CE-autocal-fixture";
  const E1 = fixtureId("autocal", "eng-manual");
  const E2 = fixtureId("autocal", "eng-engine");
  const E3 = fixtureId("autocal", "eng-startonly");
  for (const id of [E1, E2, E3]) registerFixture("tasks", id);
  await createTask({ id: E1, title: "eng manual", engagementId: ENG, assigneeUserId: me.id, assigneeName: me.name }, me);
  await createTask({ id: E2, title: "eng engine", engagementId: ENG, assigneeUserId: me.id, assigneeName: me.name, startAt: at(MON, 12), dueAt: at(TUE, 12), schedule: { phaseId: "ph", startPct: 0, lengthPct: 100 } }, me);
  await createTask({ id: E3, title: "eng start only", engagementId: ENG, assigneeUserId: me.id, assigneeName: me.name, startAt: at(MON, 12) }, me);
  const e1 = await getTask(E1);
  const e2 = await getTask(E2);
  const e3 = await getTask(E3);
  ok(expect(e1?.dueAt) && e1?.startAt === null, "auto-cal due: a manual engagement task gets +7 but has no startAt, so it never reaches the Gantt (which needs both dates) or its overrun flag");
  ok(e2?.startAt === at(MON, 12) && e2?.dueAt === at(TUE, 12) && !overrunsEnd(e2, at(TUE, 12)), "auto-cal due: an engine-placed task keeps its own dates exactly");
  ok(e3?.startAt === at(MON, 12) && e3?.dueAt === null, "auto-cal due: a task with a startAt but no dueAt is left to the engine, never stamped");

  const E4 = fixtureId("autocal", "eng-reassign");
  registerFixture("tasks", E4);
  await createTask({ id: E4, title: "eng reassign", engagementId: ENG, startAt: at(MON, 12) }, me);
  await updateTask(E4, { assigneeUserId: me.id, assigneeName: me.name });
  ok((await getTask(E4))?.dueAt === null, "auto-cal due: reassigning an engine-placed task (it has a startAt) never stamps +7");

  // Fix round 1: createTask's insertWithPrefixedId path (no caller-chosen id)
  const p1 = await createTask({ title: "prefixed assigned", assigneeUserId: me.id, assigneeName: me.name }, me);
  const p2 = await createTask({ title: "prefixed unassigned" }, me);
  registerFixture("tasks", p1.id);
  registerFixture("tasks", p2.id);
  ok(/^T-\d+$/.test(p1.id) && expect(p1.dueAt) && expect((await getTask(p1.id))?.dueAt), "auto-cal due: createTask without an id (allocated T-####) stamps +7 on an assigned task");
  ok(p2.dueAt === null && (await getTask(p2.id))?.dueAt === null, "auto-cal due: createTask without an id leaves an unassigned task undated");

  // Fix round 1: the real backfill writers (readers over fixture rows, default writers)
  const W1 = fixtureId("autocal", "bf-task");
  const W2 = fixtureId("autocal", "bf-task-dated");
  const WA1 = fixtureId("autocal", "bf-asg");
  const WA2 = fixtureId("autocal", "bf-asg-dated");
  registerFixture("tasks", W1);
  registerFixture("tasks", W2);
  registerFixture("assignments", WA1);
  registerFixture("assignments", WA2);
  const row = (id: string, over: Partial<TaskRecord> = {}) => normalizeTask({ id, title: id, createdAt: 10, updatedAt: 1, ...over });
  await upsertDoc("tasks", row(W1));
  await upsertDoc("tasks", row(W2, { dueAt: at(FRI, 17) }));
  const asgRow = (id: string, dueDate: number): Assignment => ({ id, title: id, assignee: me.name, createdBy: me.name, createdAt: 10, dueDate, link: null, done: false, doneAt: null, doneVia: null, source: "" });
  await upsertDoc("assignments", asgRow(WA1, 0));
  await upsertDoc("assignments", asgRow(WA2, at(FRI, 17)));
  // The readers claim all four are undated + assigned (a stale scan); only the writers' re-check can know better.
  const readers = {
    now: () => at(FRI, 10),
    roster: async () => [{ id: me.id, name: me.name }],
    tasks: async () => [row(W1, { assigneeUserId: me.id, assigneeName: me.name }), row(W2, { assigneeUserId: me.id, assigneeName: me.name })],
    assignments: async () => [asgRow(WA1, 0), asgRow(WA2, 0)],
    workHours: async () => DEFAULT_WORK_HOURS,
  };
  const real = await runDueBackfill({ apply: true, deps: readers });
  const w1 = await getTask(W1);
  const w2 = await getTask(W2);
  const wa1 = await getAssignment(WA1);
  const wa2 = await getAssignment(WA2);
  const planned = new Map(real.plan.updates.map((u) => [u.id, u.dueAt]));
  ok(real.planned === 4 && real.updated === 2, "auto-cal backfill: the default writers write the two still-undated items and report the two already-dated ones as not written");
  ok(w1?.dueAt === planned.get(W1) && (w1?.dueAt ?? 0) > 0 && wa1?.dueDate === planned.get(WA1) && (wa1?.dueDate ?? 0) > 0, "auto-cal backfill: setTaskDue / setAssignmentDue store the planned 5 pm stamp");
  ok(w2?.dueAt === at(FRI, 17) && w2.updatedAt === 1 && wa2?.dueDate === at(FRI, 17), "auto-cal backfill: an item dated since the scan is left untouched, with no write (updatedAt unchanged)");
  ok((await setTaskDue(W1, 123)) === false && (await getTask(W1))?.dueAt === w1?.dueAt && (await setAssignmentDue(WA1, 123)) === false && (await getAssignment(WA1))?.dueDate === wa1?.dueDate && (await setTaskDue("T-no-such-row", 1)) === false,
    "auto-cal backfill: the writers never overwrite a date and ignore a vanished row");

  // Fix round 1: the dry run reports what it skipped
  const ghostTasks = [
    normalizeTask({ id: "T-g1", title: "g", assigneeUserId: "gone", assigneeName: "Ghost Person", createdAt: 1 }),
    normalizeTask({ id: "T-g2", title: "unassigned", createdAt: 2 }),
    normalizeTask({ id: "T-g3", title: "ok", assigneeUserId: "u1", assigneeName: "Dana", createdAt: 3 }),
  ];
  const ghostAsg = [asgRow("as-g1", 0)];
  ghostAsg[0].assignee = "Nobody Here";
  const skipRun = await runDueBackfill({
    apply: false,
    deps: { now: () => at(FRI, 10), roster: async () => [{ id: "u1", name: "Dana" }], tasks: async () => ghostTasks, assignments: async () => ghostAsg, workHours: async () => DEFAULT_WORK_HOURS },
  });
  ok(skipRun.planned === 1 && skipRun.skipped.length === 2 &&
    skipRun.skipped.some((k) => k.kind === "task" && k.id === "T-g1" && k.assignee === "Ghost Person" && k.reason === "not on the active roster") &&
    skipRun.skipped.some((k) => k.kind === "assignment" && k.id === "as-g1" && k.assignee === "Nobody Here"),
    "auto-cal backfill: items whose assignee is off the roster are reported as skipped (an unassigned task is not)");
  const waitRun = await runDueBackfill({
    apply: false,
    deps: {
      now: () => at(FRI, 10), roster: async () => [{ id: "u1", name: "Dana" }], assignments: async () => [], workHours: async () => DEFAULT_WORK_HOURS,
      tasks: async () => [normalizeTask({ id: "T-w", title: "w", assigneeUserId: "u1", assigneeName: "Dana", waitingOn: { contactId: null, name: "Pat" }, createdAt: 1 }), normalizeTask({ id: "T-o", title: "o", assigneeUserId: "u1", assigneeName: "Dana", createdAt: 2 })],
    },
  });
  ok(waitRun.planned === 1 && waitRun.plan.updates[0]?.id === "T-o" && waitRun.skipped.length === 0, "auto-cal backfill: a Waiting on customer task (#323) is never given a due date");
  // Legacy In-progress tasks lock their first block on the owner's first view (D790) — the dry run lists them per person.
  const ipRun = await runDueBackfill({
    apply: false,
    deps: {
      now: () => at(FRI, 10), roster: async () => [{ id: "u1", name: "Dana" }, { id: "u2", name: "Sam" }], assignments: async () => [], workHours: async () => DEFAULT_WORK_HOURS,
      tasks: async () => [
        normalizeTask({ id: "T-ip1", title: "a", assigneeUserId: "u1", assigneeName: "Dana", status: "in_progress", createdAt: 1 }),
        normalizeTask({ id: "T-ip2", title: "b", assigneeUserId: "u1", assigneeName: "Dana", status: "in_progress", dueAt: at(FRI, 17), createdAt: 2 }),
        normalizeTask({ id: "T-ip3", title: "c", assigneeName: "sam", status: "in_progress", createdAt: 3 }),
        normalizeTask({ id: "T-ip4", title: "d", assigneeUserId: "u2", assigneeName: "Sam", status: "open", createdAt: 4 }),
        normalizeTask({ id: "T-ip5", title: "e", assigneeUserId: "u1", assigneeName: "Dana", status: "in_progress", waitingOn: { contactId: null, name: "Pat" }, createdAt: 5 }),
        normalizeTask({ id: "T-ip6", title: "f", assigneeUserId: "gone", assigneeName: "Ghost", status: "in_progress", createdAt: 6 }),
      ],
    },
  });
  ok(JSON.stringify(ipRun.inProgress) === JSON.stringify([{ id: "u1", name: "Dana", count: 2 }, { id: "u2", name: "Sam", count: 1 }]),
    "auto-cal backfill: the dry run counts open In-progress tasks per person, dated or not (their first block locks on the owner's first view)");
  ok(/inProgress/.test(readFileSync("scripts/backfill-task-due.ts", "utf8")), "auto-cal backfill: the CLI prints the In-progress counts");

  // Task 1 review add-on: update paths validate tier/size; assignments normalize on read
  const TU = fixtureId("autocal", "update-validate");
  await createTask({ id: TU, title: "validate", priority: "low", size: "s" }, me);
  registerFixture("tasks", TU);
  await updateTask(TU, { priority: "urgent", size: "xl" } as unknown as Parameters<typeof updateTask>[1]);
  const tu = await getTask(TU);
  ok(tu?.priority === "low" && tu?.size === "s", "auto-cal fields: updateTask ignores an invalid tier/size and keeps the stored value");
  const TV = fixtureId("autocal", "update-validate-bare");
  await createTask({ id: TV, title: "validate bare" }, me);
  registerFixture("tasks", TV);
  await updateTask(TV, { priority: "urgent" } as unknown as Parameters<typeof updateTask>[1]);
  const tv = await getTask(TV);
  ok(!!tv && !("priority" in tv) && !("size" in tv), "auto-cal fields: updateTask never writes an invalid tier/size onto a bare task");
  const av = await createAssignment({ title: "validate asg", assignee: me.name, createdBy: me.name });
  registerFixture("assignments", av.id);
  await updateAssignment(av.id, { size: "xl", priority: "urgent" } as unknown as Parameters<typeof updateAssignment>[1]);
  const av2 = await getAssignment(av.id);
  ok(!!av2 && !("size" in av2) && !("priority" in av2), "auto-cal fields: updateAssignment ignores an invalid tier/size");
  await updateAssignment(av.id, { size: "s", priority: "high" });
  await updateAssignment(av.id, { size: "xl" } as unknown as Parameters<typeof updateAssignment>[1]);
  const av3 = await getAssignment(av.id);
  ok(av3?.size === "s" && av3?.priority === "high", "auto-cal fields: updateAssignment keeps a valid stored tier/size when a later patch is invalid");
  const junkId = fixtureId("autocal", "asg-junk");
  registerFixture("assignments", junkId);
  await upsertDoc("assignments", {
    id: junkId, title: "junk", assignee: me.name, createdBy: me.name, createdAt: 1, dueDate: 0, link: null,
    done: false, doneAt: null, doneVia: null, source: "", priority: "urgent", size: "xl",
  } as unknown as Assignment);
  const junk1 = await getAssignment(junkId);
  const junk2 = (await allAssignments()).find((x) => x.id === junkId);
  ok(!!junk1 && !!junk2 && !("priority" in junk1) && !("size" in junk1) && !("priority" in junk2) && !("size" in junk2),
    "auto-cal fields: a stored junk assignment tier/size reads back clean (getAssignment and allAssignments)");
}

/* ---- Task 3: urgency ---- */
export async function autoCalUrgencyChecks(ok: Ok): Promise<void> {
  const now = at(MON, 9);
  const uk = (key: string, tier: TaskTier, day: string, createdAt = 1): UrgencyKey => ({ key, tier, dueMs: at(day, 17), createdAt });
  const order = (...ks: UrgencyKey[]) => sortByUrgency(ks, now).map((k) => k.key).join(",");
  ok(daysLeft(at(TUE, 17), now) === 1 && daysLeft(at(MON, 23), now) === 0 && daysLeft(at("2036-10-11", 9), now) === -2, "auto-cal urgency: days left by Chicago calendar day");
  ok(order(uk("high-month", "high", "2036-11-12"), uk("low-tomorrow", "low", TUE)) === "low-tomorrow,high-month",
    "auto-cal urgency: a Low task due tomorrow outranks a High task due in a month (required property)");
  ok(order(uk("high-week", "high", "2036-10-20"), uk("low-tomorrow", "low", TUE)) === "low-tomorrow,high-week", "auto-cal urgency: …and a High task due next week");
  ok(order(uk("low", "low", FRI), uk("high", "high", FRI), uk("normal", "normal", FRI)) === "high,normal,low", "auto-cal urgency: same due day → the tier decides");
  ok(order(uk("high-3d", "high", "2036-10-16"), uk("normal-1d", "normal", TUE)) === "normal-1d,high-3d",
    "auto-cal urgency: closeness rises steeply — Normal due tomorrow beats High due in 3 days");
  ok(order(uk("high-today", "high", MON), uk("low-overdue", "low", "2036-10-12")) === "low-overdue,high-today", "auto-cal urgency: overdue outranks everything");
  ok(order(uk("od1", "high", "2036-10-12"), uk("od5", "low", "2036-10-08")) === "od5,od1", "auto-cal urgency: most overdue first");
  ok(order(uk("high-2d", "high", WED), uk("normal-1d", "normal", TUE)) === "normal-1d,high-2d", "auto-cal urgency: equal weight (3/3 = 2/2) → earlier due first");
  ok(order(uk("b", "normal", FRI, 200), uk("a", "normal", FRI, 100)) === "a,b" && order(uk("z", "normal", FRI, 5), uk("y", "normal", FRI, 5)) === "y,z",
    "auto-cal urgency: then older createdAt, then id");
  const list = [uk("1", "low", TUE), uk("2", "high", "2036-11-12"), uk("3", "normal", FRI), uk("4", "high", "2036-10-10"), uk("5", "normal", FRI, 0)];
  ok(order(...list) === order(...[...list].reverse()), "auto-cal urgency: the order never depends on input order");
  ok(urgencyWeight("normal", 0) / urgencyWeight("normal", 3) === 4 && urgencyWeight("low", 1) > urgencyWeight("high", 30) && urgencyWeight("low", 1) > urgencyWeight("high", 7),
    "auto-cal urgency: the curve is tier × 1/(days left + 1)");
  ok(daysLeft(at("2036-11-03", 17), at("2036-11-01", 9)) === 2 && daysLeft(at("2036-11-02", 23, 30), at("2036-11-02", 0, 30)) === 0 &&
    daysLeft(chicagoDayStart("2036-11-03"), at("2036-11-02", 23, 59)) === 1 && daysLeft(at("2036-11-01", 23, 59), at("2036-11-02", 0, 1)) === -1,
    "auto-cal urgency: days left stays whole Chicago days across the 2036-11-02 fall-back (a 25 h day)");
  ok(order(uk("od-low", "low", "2036-10-10"), uk("od-high", "high", "2036-10-10")) === "od-high,od-low", "auto-cal urgency: same-day overdue → the tier decides");
  ok(order(uk("n-tomorrow", "normal", TUE), uk("n-today", "normal", MON)) === "n-today,n-tomorrow" &&
    order(uk("high-tomorrow", "high", TUE), uk("normal-today", "normal", MON)) === "normal-today,high-tomorrow" &&
    order(uk("low-today", "low", MON), uk("high-tomorrow", "high", TUE)) === "high-tomorrow,low-today",
    "auto-cal urgency: due today vs due tomorrow — 2/1 beats 2/2 and 3/2, 3/2 beats 1/1");
}

/* ---- Task 4: placement ---- */
const blocksOf = (r: PlanResult, key: string) => r.blocks.filter((b) => b.itemKey === key);
const baseInput = (over: Partial<PlanInput> = {}): PlanInput => ({ userId: "u1", nowMs: at(MON, 7), hours: DEFAULT_WORK_HOURS, busy: [], pins: [], items: [], ...over });
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const nothing0 = () => planPerson(baseInput({ items: [item("zero", { sizeMin: 0 })] }));

export async function autoCalPlacementChecks(ok: Ok): Promise<void> {
  const one = planPerson(baseInput({ items: [item("A")] }));
  ok(one.blocks.length === 1 && one.blocks[0].startMs === at(MON, 8) && one.blocks[0].endMs === at(MON, 9) && !one.blocks[0].pinned,
    "auto-cal plan: a 1 h task lands in the first free hour of work");

  const ten = planPerson(baseInput({ items: Array.from({ length: 10 }, (_, i) => item("T" + i, { createdAt: i })) }));
  const monMin = ten.blocks.filter((b) => chicagoDayKey(b.startMs) === MON).reduce((s, b) => s + (b.endMs - b.startMs) / MIN, 0);
  ok(monMin === 420 && ten.blocks.some((b) => chicagoDayKey(b.startMs) === TUE), "auto-cal plan: at most 80 % of a day's free time is filled (540 free → 420 planned, the rest Tuesday)");

  const grid = planPerson(baseInput({ nowMs: at(MON, 8, 7), busy: [{ startMs: at(MON, 9, 10), endMs: at(MON, 9, 50) }], items: [item("A", { size: "l", sizeMin: 240 }), item("B", { createdAt: 2 })] }));
  ok(grid.blocks.every((b) => b.startMs % QUARTER_MS === 0 && b.endMs % QUARTER_MS === 0), "auto-cal plan: every block sits on the 15-minute grid");
  ok(!grid.blocks.some((b) => b.startMs < at(MON, 10) && b.endMs > at(MON, 9)), "auto-cal plan: a busy 9:10–9:50 keeps 9:00–10:00 clear on the grid");

  const chunk = planPerson(baseInput({ busy: [{ startMs: at(MON, 8, 45), endMs: at(MON, 9) }, { startMs: at(MON, 10), endMs: at(MON, 10, 15) }], items: [item("L", { size: "l", sizeMin: 240 })] }));
  const lb = blocksOf(chunk, "task:L");
  ok(lb.length > 1 && lb.every((b) => b.endMs - b.startMs >= 30 * MIN) && lb.reduce((s, b) => s + (b.endMs - b.startMs), 0) === 240 * MIN,
    "auto-cal plan: a long task splits into chunks of at least 30 minutes");
  const tiny = planPerson(baseInput({ busy: [{ startMs: at(MON, 8), endMs: at(MON, 8, 30) }, { startMs: at(MON, 8, 45), endMs: at(MON, 17) }], items: [item("S", { size: "s", sizeMin: 30 })] }));
  ok(tiny.blocks[0].startMs === at(TUE, 8), "auto-cal plan: a 15-minute gap is never used");

  const tpl = planPerson(baseInput({ items: [item("A", { earliestMs: at(WED, 0) })] }));
  ok(tpl.blocks[0].startMs === at(WED, 8), "auto-cal plan: a template's startAt is the earliest it is placed");
  const sat = planPerson(baseInput({ nowMs: at(SAT, 10), items: [item("A", { dueMs: at("2036-10-24", 17) })] }));
  ok(sat.blocks[0].startMs === at("2036-10-20", 8), "auto-cal plan: nothing is placed outside work hours (Saturday → Monday 8:00)");

  const busy = [{ startMs: at(MON, 9), endMs: at(MON, 11) }, { startMs: at(MON, 13), endMs: at(MON, 13, 30) }];
  const around = planPerson(baseInput({ busy, items: ["A", "B", "C", "D"].map((k, i) => item(k, { createdAt: i })) }));
  ok(around.blocks.every((b) => busy.every((x) => b.endMs <= x.startMs || b.startMs >= x.endMs)), "auto-cal plan: blocks never overlap visits, drives or meetings");

  const risk = planPerson(baseInput({ items: [
    item("big1", { size: "l", sizeMin: 240, tier: "high", dueMs: at(MON, 17) }),
    item("big2", { size: "l", sizeMin: 240, tier: "high", dueMs: at(MON, 17), createdAt: 2 }),
    item("late", { dueMs: at(MON, 17), createdAt: 3 }),
  ] }));
  const late = risk.atRisk.find((a) => a.itemKey === "task:late");
  ok(!!late && chicagoDayKey(late.finishMs!) === TUE && late.label === "At risk — due Mon" && blocksOf(risk, "task:late").every((b) => b.atRisk),
    "auto-cal plan: work that can't finish by its due date is still placed, late, and flagged At risk");
  ok(!risk.atRisk.some((a) => a.itemKey === "task:big1"), "auto-cal plan: work that fits isn't flagged");
  const over = planPerson(baseInput({ horizonDays: 1, items: [item("A", { size: "l", sizeMin: 240 }), item("B", { size: "l", sizeMin: 240, createdAt: 2 })] }));
  ok(over.atRisk.some((a) => a.itemKey === "task:B" && a.finishMs === null), "auto-cal plan: work that doesn't fit in the horizon is flagged with no finish date");

  const pr = planPerson(baseInput({ items: [item("high-month", { tier: "high", dueMs: at("2036-11-12", 17) }), item("low-tomorrow", { tier: "low", dueMs: at(TUE, 17) })] }));
  ok(pr.blocks[0].itemKey === "task:low-tomorrow", "auto-cal plan: the most urgent item gets the earliest time");

  const pinned = planPerson(baseInput({ pins: [{ itemKey: "task:A", startMs: at(MON, 10), endMs: at(MON, 11), kind: "hand" }], items: [item("A"), item("B", { tier: "high", dueMs: at(MON, 17) })] }));
  ok(blocksOf(pinned, "task:A").length === 1 && blocksOf(pinned, "task:A")[0].pinned === "hand" && blocksOf(pinned, "task:A")[0].startMs === at(MON, 10),
    "auto-cal plan: a pinned block stays where it is and covers the task");
  ok(!pinned.blocks.some((b) => b.itemKey !== "task:A" && b.startMs < at(MON, 11) && b.endMs > at(MON, 10)), "auto-cal plan: pinned time is taken out of free time first");

  const inp = baseInput({ busy, items: ["A", "B", "C", "D", "E"].map((k, i) => item(k, { createdAt: 5 - i, tier: i % 2 ? "high" : "low" })) });
  ok(JSON.stringify(planPerson(inp)) === JSON.stringify(planPerson({ ...inp, items: [...inp.items].reverse(), busy: [...inp.busy].reverse() })), "auto-cal plan: same input → same plan");
  ok(chunkFor(60, 45) === 30 && chunkFor(240, 225) === 210 && chunkFor(30, 15) === 0 && chunkFor(15, 15) === 15 && chunkFor(45, 30) === 0 && chunkFor(60, 90) === 60,
    "auto-cal plan: chunk sizes keep every piece ≥ 30 minutes");

  /* review add-ons: undated items, midnight end, DST, copy */
  const undated = planPerson(baseInput({ items: [item("undated", { dueMs: 0, dueVirtual: true, createdAt: at("2036-08-01", 6) }), item("dated", { dueMs: at(TUE, 17), createdAt: 5 })] }));
  ok(undated.blocks[0].itemKey === "task:dated" && blocksOf(undated, "task:undated")[0]?.dueMs === defaultDueAt(at(MON, 7)) && !undated.atRisk.some((a) => a.itemKey === "task:undated"),
    "auto-cal plan: an undated item — even one created months ago — plans by a rolling today + 7, never as overdue (D801)");
  // Undated work that can't fit is still never flagged; the same item with a real date that can't fit is.
  const flood = (dueVirtual: boolean) => planPerson(baseInput({ horizonDays: 1, items: [
    item("big", { size: "l", sizeMin: 600, tier: "high", dueMs: at(MON, 17) }),
    item("u", { dueMs: dueVirtual ? 0 : at(MON, 17), dueVirtual, createdAt: 2 }),
  ] }));
  ok(!flood(true).atRisk.some((a) => a.itemKey === "task:u") && flood(true).finishMs["task:u"] === null && flood(false).atRisk.some((a) => a.itemKey === "task:u"),
    "auto-cal plan: an undated item that doesn't fit is never At risk until it gets a real date (a dated one is)");
  const vdue = planPerson(baseInput({ nowMs: at(FRI, 7), items: [item("u", { dueMs: at(MON, 17), dueVirtual: true })] }));
  ok(blocksOf(vdue, "task:u")[0]?.dueMs === defaultDueAt(at(FRI, 7)) && vdue.atRisk.length === 0, "auto-cal plan: a virtual due is re-dated from the plan's clock, never read as stored");
  const nothing = nothing0();
  ok(nothing.blocks.length === 0 && nothing.atRisk.length === 0, "auto-cal plan: an item with nothing left to place isn't flagged");

  const late20 = { days: EVERY_DAY, startMin: 20 * 60, endMin: 1440 };
  const mid = planPerson(baseInput({ hours: late20, fillRatio: 1, items: [item("A", { size: "l", sizeMin: 240 })] }));
  ok(mid.blocks.length === 1 && mid.blocks[0].startMs === at(MON, 20) && mid.blocks[0].endMs === chicagoDayStart(TUE) && fmtBlockTime(mid.blocks[0].startMs, mid.blocks[0].endMs) === "8:00–midnight",
    "auto-cal plan: work hours ending at midnight (1440) fill up to the next day's 00:00");
  const midCap = planPerson(baseInput({ hours: late20, items: [item("A", { size: "l", sizeMin: 240 })] }));
  ok(blocksOf(midCap, "task:A").map((b) => `${chicagoDayKey(b.startMs)} ${(b.endMs - b.startMs) / MIN}`).join(",") === `${MON} 180,${TUE} 60`,
    "auto-cal plan: a midnight-ending day still caps at 80 % (240 free → 180)");

  const allDay = { days: EVERY_DAY, startMin: 0, endMin: 1440 };
  const fall = freeDays({ startMs: chicagoDayStart("2036-11-02"), days: 1, hours: allDay, busy: [] });
  const spring = freeDays({ startMs: chicagoDayStart("2037-03-08"), days: 1, hours: allDay, busy: [] });
  ok(fall[0].free.length === 1 && fall[0].free[0].endMs - fall[0].free[0].startMs === 25 * 60 * MIN && fall[0].capMin === 1200 &&
    spring[0].free[0].endMs - spring[0].free[0].startMs === 23 * 60 * MIN && spring[0].capMin === 1095,
    "auto-cal plan: free time follows DST — 25 h on the fall-back day, 23 h on spring-forward");
  const dst = planPerson(baseInput({ nowMs: at("2036-11-01", 12), hours: { days: [0], startMin: 0, endMin: 1440 }, fillRatio: 1, items: [item("A", { sizeMin: 1500, dueMs: at("2036-11-09", 17) })] }));
  ok(dst.blocks.length === 1 && dst.blocks[0].startMs === chicagoDayStart("2036-11-02") && dst.blocks[0].endMs === chicagoDayStart("2036-11-03") &&
    dst.blocks[0].startMs % QUARTER_MS === 0 && dst.atRisk.length === 0,
    "auto-cal plan: a 25 h fall-back day holds 1,500 minutes on the grid");
  const afterDst = planPerson(baseInput({ nowMs: at("2036-11-01", 10), items: [item("A", { dueMs: at("2036-11-07", 17) })] }));
  ok(afterDst.blocks[0].startMs === at("2036-11-03", 8) && afterDst.blocks[0].endMs === at("2036-11-03", 9), "auto-cal plan: the first work day after the fall-back starts at 8:00 local (CST)");

  ok(atRiskLabel(at(MON, 17), at(MON, 7)) === "At risk — due Mon" && atRiskLabel(at("2036-10-19", 17), at(MON, 7)) === "At risk — due Sun" &&
    atRiskLabel(at("2036-10-20", 17), at(MON, 7)) === "At risk — due Oct 20" && atRiskLabel(at("2036-11-03", 17), at(MON, 7)) === "At risk — due Nov 3" &&
    atRiskLabel(at("2036-10-10", 17), at(MON, 7)) === "At risk — due Fri",
    "auto-cal copy: At risk — due <weekday within 6 days, else Mon D>");
  ok(calendarNote("ok", "Dana", false) === null && calendarNote("failed", "Dana", true) === GOOGLE_NOTE_ME &&
    GOOGLE_NOTE_ME === "Planned without your Google calendar — may overlap meetings" &&
    calendarNote("no-calendar", "Dana", false) === "Planned without Dana's Google calendar — may overlap meetings",
    "auto-cal copy: the Google-calendar note, mine and another person's");
  ok(fmtBlockTime(at(MON, 8), at(MON, 9)) === "8:00–9:00" && finishText(at(TUE, 10)) === "Plan finishes Tue Oct 14" &&
    finishText(chicagoDayStart(TUE)) === "Plan finishes Mon Oct 13" && finishText(null) === NOT_PLACED_TEXT && NOT_PLACED_TEXT === "Doesn't fit in the next 8 weeks",
    "auto-cal copy: block time, Plan finishes, Doesn't fit in the next 8 weeks");
}

/* ---- Task 5: pin lifecycle ---- */
export async function autoCalPinRuleChecks(ok: Ok): Promise<void> {
  const p: PlanPin = { itemKey: "task:T-1", startMs: at(MON, 10), endMs: at(MON, 11), kind: "hand" };
  ok(pinBlobKey(p) === `task:T-1@${at(MON, 10)}` && JSON.stringify(pinsFromBlob({ [pinBlobKey(p)]: pinBlobValue(p) })) === JSON.stringify([p]),
    "auto-cal pins: a pin is one blob key (<item>@<start>) → { endMs, kind }");
  ok(pinsFromBlob({
    "task:T-1@x": { endMs: 5, kind: "hand" },
    "lead:1@5": { endMs: 9, kind: "hand" },
    [`task:T-2@${at(MON, 10)}`]: { endMs: at(MON, 9), kind: "hand" },
    [`asg:a@${at(MON, 10)}`]: { endMs: at(MON, 11), kind: "moved" },
    [`task:T-3@${at(MON, 10)}`]: null,
  }).length === 0, "auto-cal pins: junk keys and values are ignored");

  const begun = planPerson(baseInput({ nowMs: at(MON, 10, 7), items: [item("A")] }));
  ok(begun.blocks[0].startMs === at(MON, 10) && begun.blocks[0].pinned === "started" && begun.newPins.length === 1 && begun.newPins[0].kind === "started" && begun.newPins[0].endMs === at(MON, 11),
    "auto-cal pins: a block that has begun when the plan is computed is pinned as started");
  const notYet = planPerson(baseInput({ items: [item("A")] }));
  ok(notYet.newPins.length === 0 && !notYet.blocks[0].pinned, "auto-cal pins: a block that hasn't begun stays movable");

  const pins: PlanPin[] = [
    { itemKey: "task:A", startMs: at(MON, 13), endMs: at(MON, 14), kind: "hand" },
    { itemKey: "task:B", startMs: at(MON, 8), endMs: at(MON, 9), kind: "started" },
  ];
  const before = planPerson(baseInput({ nowMs: at(MON, 8, 30), pins, items: [item("A"), item("B")] }));
  const after = planPerson(baseInput({ nowMs: at(MON, 8, 30), pins, items: [item("A"), item("B"), item("URGENT", { tier: "high", dueMs: at(MON, 17), size: "l", sizeMin: 240 })] }));
  const pinnedAt = (r: PlanResult) => r.blocks.filter((b) => b.pinned).map((b) => b.key).join();
  ok(pinnedAt(before) === pinnedAt(after) && blocksOf(after, "task:A")[0].startMs === at(MON, 13), "auto-cal pins: started and hand-pinned blocks never move when new work arrives");

  const ip = planPerson(baseInput({ items: [item("A"), item("IP", { inProgress: true })] }));
  const ipb = blocksOf(ip, "task:IP")[0];
  ok(ipb.pinned === "started" && ip.newPins.some((x) => x.itemKey === "task:IP" && x.startMs === ipb.startMs), "auto-cal pins: a task marked In progress has its current block pinned");

  const NEXT_MON = "2036-10-20";
  const fri: PlanPin[] = [{ itemKey: "task:L", startMs: at(FRI, 8), endMs: at(FRI, 10), kind: "started" }];
  const mon = planPerson(baseInput({ nowMs: at(NEXT_MON, 7, 30), pins: fri, items: [item("OD", { tier: "high", dueMs: at(FRI, 17) }), item("L", { size: "l", sizeMin: 240 })] }));
  const rem = blocksOf(mon, "task:L").filter((b) => b.startMs > at(FRI, 23));
  ok(rem.length === 1 && rem[0].startMs === at(NEXT_MON, 8) && rem[0].endMs === at(NEXT_MON, 10) && rem[0].pinned === "started" && mon.newPins.some((x) => x.startMs === at(NEXT_MON, 8)),
    "auto-cal pins: an unfinished started task's remaining time (4 h − 2 h) is pinned first thing the next work day (over the weekend)");
  const whole: PlanPin[] = [...fri, { itemKey: "task:L", startMs: at(FRI, 10), endMs: at(FRI, 14), kind: "started" }];
  const again = planPerson(baseInput({ nowMs: at(NEXT_MON, 7, 30), pins: whole, items: [item("L", { size: "l", sizeMin: 240 })] }));
  const againL = blocksOf(again, "task:L").filter((b) => b.startMs > at(FRI, 23));
  ok(againL.reduce((s, b) => s + b.endMs - b.startMs, 0) === 30 * MIN && againL.every((b) => !b.pinned) && again.newPins.length === 0,
    "auto-cal pins: still open after its whole size → never pinned ahead again; one fresh 30-minute chunk, movable (D796)");
  const againHigh = planPerson(baseInput({ nowMs: at(NEXT_MON, 7, 30), pins: whole, items: [item("L", { size: "l", sizeMin: 240, dueMs: at("2036-10-30", 17) }), item("NEW", { tier: "high", dueMs: at(NEXT_MON, 17), createdAt: 9 })] }));
  ok(blocksOf(againHigh, "task:NEW")[0]?.startMs === at(NEXT_MON, 8) && blocksOf(againHigh, "task:L").filter((b) => !b.pinned)[0]?.startMs === at(NEXT_MON, 9),
    "auto-cal pins: that fresh chunk is urgency-ordered — more urgent new work goes ahead of it");
  const begunToday = planPerson(baseInput({ nowMs: at(NEXT_MON, 11), pins: [...whole, { itemKey: "task:L", startMs: at(NEXT_MON, 8), endMs: at(NEXT_MON, 8, 30), kind: "started" }], items: [item("L", { size: "l", sizeMin: 240 })] }));
  ok(blocksOf(begunToday, "task:L").filter((b) => b.startMs >= at(NEXT_MON, 11)).length === 0 && begunToday.newPins.length === 0,
    "auto-cal pins: once today's fresh chunk has begun (and locked), nothing more is placed until tomorrow");
  const shortRem = planPerson(baseInput({ nowMs: at(NEXT_MON, 7, 30), pins: fri, items: [item("L", { size: "l", sizeMin: 240 })] }));
  ok(shortRem.newPins.reduce((s, x) => s + x.endMs - x.startMs, 0) === 120 * MIN, "auto-cal pins: a remainder is pinned only while size − pinned so far > 0, and only for that difference");
  const sameDay = planPerson(baseInput({ nowMs: at(NEXT_MON, 9), pins: [...fri, { itemKey: "task:L", startMs: at(NEXT_MON, 8), endMs: at(NEXT_MON, 10), kind: "started" }], items: [item("L", { size: "l", sizeMin: 240 })] }));
  ok(sameDay.newPins.length === 0, "auto-cal pins: the remainder is pinned once, not again the same day");
  // Released (Unpin of a held started pin, D798): no remainder, no In-progress pin ahead; still planned, movable.
  const rel = planPerson(baseInput({ nowMs: at(NEXT_MON, 7, 30), pins: fri, released: ["task:L", "task:IPR", "task:GONE"], items: [item("L", { size: "l", sizeMin: 240 }), item("IPR", { inProgress: true })] }));
  ok(rel.newPins.length === 0 && blocksOf(rel, "task:L").filter((b) => b.startMs > at(FRI, 23)).reduce((s, b) => s + b.endMs - b.startMs, 0) === 120 * MIN &&
    blocksOf(rel, "task:L").every((b) => b.startMs < at(FRI, 23) || !b.pinned) && blocksOf(rel, "task:IPR").every((b) => !b.pinned),
    "auto-cal pins: a released item gets no remainder pin and no In-progress pin ahead — its time is planned, movable");
  ok(rel.staleKeys.join() === "task:GONE@released", "auto-cal pins: a release marker of an item that's no longer open work is swept as stale");
  const relBegun = planPerson(baseInput({ nowMs: at(NEXT_MON, 8, 5), released: ["task:IPR"], items: [item("IPR", { inProgress: true })] }));
  ok(relBegun.newPins.length === 1 && relBegun.newPins[0].startMs === at(NEXT_MON, 8), "auto-cal pins: a released item's block that has begun still locks (a pin covering now)");
  ok(JSON.stringify(releasedFromBlob({ [releaseBlobKey("task:L")]: { kind: "released", atMs: 1 }, "asg:a@released": { kind: "hand" }, "lead:x@released": { kind: "released" } })) === JSON.stringify(["task:L"]) &&
    pinsFromBlob({ [releaseBlobKey("task:L")]: { kind: "released", atMs: 1 } }).length === 0,
    "auto-cal pins: release markers parse from the pin blob and are never read as pins");

  const stale = planPerson(baseInput({ pins: [{ itemKey: "task:GONE", startMs: at(MON, 8), endMs: at(MON, 12), kind: "hand" }], items: [item("A")] }));
  ok(stale.staleKeys.join() === `task:GONE@${at(MON, 8)}` && stale.blocks[0].startMs === at(MON, 8) && !stale.blocks.some((b) => b.itemKey === "task:GONE"),
    "auto-cal pins: a done, deleted or handed-off item's pins are dropped and its time is free again");
  ok(before.futurePins.map((x) => x.itemKey).join() === "task:A", "auto-cal pins: the pins that haven't begun are what Unpin offers");

  const moved = cleanPinMove({ kind: "task", id: "T-1", startMs: at(MON, 10, 7), minutes: 60 }, at(MON, 9));
  ok(moved.ok && (moved as { ok: true; value: PinMove }).value.startMs === at(MON, 10), "auto-cal pins: a drop snaps to the 15-minute grid");
  ok(!cleanPinMove({ kind: "task", id: "T-1", startMs: at(MON, 8), minutes: 60 }, at(MON, 9)).ok &&
     !cleanPinMove({ kind: "task", id: "T-1", startMs: at(MON, 10), minutes: 20 }, at(MON, 9)).ok &&
     !cleanPinMove({ kind: "lead", id: "x", startMs: at(MON, 10), minutes: 60 }, at(MON, 9)).ok &&
     !cleanPinMove({ kind: "task", id: "T-1", startMs: at(MON, 10), minutes: 600 }, at(MON, 9)).ok,
    "auto-cal pins: a drop in the past, off the grid, over 8 h or on an unknown kind is refused");

  /* Task 4 review add-ons */
  const partial = planPerson(baseInput({ pins: [{ itemKey: "task:A", startMs: at(MON, 13), endMs: at(MON, 13, 45), kind: "hand" }], items: [item("A")] }));
  const loose = blocksOf(partial, "task:A").filter((b) => !b.pinned);
  ok(loose.length === 1 && loose[0].startMs === at(MON, 8) && loose[0].endMs === at(MON, 8, 30),
    "auto-cal pins: a 15-minute remainder (1 h − a 45-minute hand pin) is placed as 30 minutes, never under 30");
  const odd = planPerson(baseInput({ nowMs: at(NEXT_MON, 7, 30), pins: [{ itemKey: "task:O", startMs: at(FRI, 8), endMs: at(FRI, 8, 50), kind: "started" }], items: [item("O")] }));
  ok(blocksOf(odd, "task:O").filter((b) => b.startMs > at(FRI, 23)).map((b) => (b.endMs - b.startMs) / MIN).join() === "30",
    "auto-cal pins: a 10-minute unfinished remainder is pinned as 30 minutes");
  ok(!("task:zero" in nothing0().finishMs) && planPerson(baseInput({ horizonDays: 1, items: [item("A", { size: "l", sizeMin: 240 }), item("B", { size: "l", sizeMin: 240, createdAt: 2 })] })).finishMs["task:B"] === null,
    "auto-cal plan: finishMs has no key for an item with nothing left to place; null still means it doesn't fit");
  const huge = baseInput({ items: [item("H", { sizeMin: 20_000, dueMs: at("2036-12-31", 17) })] });
  const capped = planPerson({ ...huge, horizonDays: 999 });
  ok(JSON.stringify(capped) === JSON.stringify(planPerson(huge)) && capped.finishMs["task:H"] === null &&
    capped.blocks.every((b) => b.endMs <= chicagoDayStart(addDays(MON, PLAN_HORIZON_DAYS))),
    "auto-cal plan: horizonDays is capped at 8 weeks");

  /* property check: a big, messy week-by-week load */
  let seed = 327;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const nowMs = at(MON, 10, 7);
  const sizes = [30, 45, 60, 90, 240, 600];
  const tiers: TaskTier[] = ["high", "normal", "low"];
  const bigItems = Array.from({ length: 200 }, (_, i) => item("P" + i, {
    tier: tiers[i % 3],
    sizeMin: sizes[Math.floor(rnd() * sizes.length)],
    dueMs: at(addDays(MON, Math.floor(rnd() * 45) - 5), 17),
    createdAt: i,
    inProgress: i % 37 === 0,
  }));
  const bigBusy: BusyInterval[] = [];
  for (let d = 0; d < PLAN_HORIZON_DAYS; d++) {
    const day = addDays(MON, d);
    for (let n = Math.floor(rnd() * 4); n > 0; n--) {
      const s = at(day, 8 + Math.floor(rnd() * 6), Math.floor(rnd() * 60));
      bigBusy.push({ startMs: s, endMs: s + (10 + Math.floor(rnd() * 110)) * MIN });
    }
  }
  const bigPins: PlanPin[] = [
    { itemKey: "task:P1", startMs: at("2036-10-10", 8), endMs: at("2036-10-10", 9), kind: "started" },
    ...Array.from({ length: 10 }, (_, i): PlanPin => ({ itemKey: `task:P${10 + i * 7}`, startMs: at(addDays(MON, 1 + i), 16), endMs: at(addDays(MON, 1 + i), 17), kind: "hand" })),
  ];
  const bigIn = baseInput({ nowMs, busy: bigBusy, pins: bigPins, items: bigItems });
  const t0 = performance.now();
  const big = planPerson(bigIn);
  const ms = performance.now() - t0;
  const sorted = [...big.blocks].sort((a, b) => a.startMs - b.startMs);
  ok(sorted.every((b, i) => i === 0 || sorted[i - 1].endMs <= b.startMs) &&
    big.blocks.every((b) => bigBusy.every((x) => b.endMs <= x.startMs || b.startMs >= x.endMs)),
    "auto-cal plan (property, 200 items × 8 weeks): no two blocks or pins overlap, and none overlaps busy time");
  const pinKeys = new Set(bigPins.map(pinBlobKey));
  const placed = big.blocks.filter((b) => !pinKeys.has(b.key));
  const caps = new Map(freeDays({ startMs: floorQuarter(nowMs), days: PLAN_HORIZON_DAYS, hours: DEFAULT_WORK_HOURS, busy: [...bigBusy, ...bigPins] }).map((d) => [d.dayKey, d.capMin] as const));
  const perDay = new Map<string, number>();
  for (const b of placed) perDay.set(chicagoDayKey(b.startMs), (perDay.get(chicagoDayKey(b.startMs)) ?? 0) + (b.endMs - b.startMs) / MIN);
  ok(placed.length > 100 && [...perDay].every(([k, m]) => m <= (caps.get(k) ?? 0)), "auto-cal plan (property): each Chicago day's placed minutes stay within its 80 % cap");
  ok(placed.every((b) => b.endMs - b.startMs >= 30 * MIN && b.startMs % QUARTER_MS === 0 && b.endMs % QUARTER_MS === 0),
    "auto-cal plan (property): every placed chunk is ≥ 30 minutes and on the grid");
  ok(ms < 1000, `auto-cal plan (property): 200 items over 8 weeks plan in well under a second (${Math.round(ms)} ms)`);

  /* Task 5 review add-ons (landed with Task 6) */
  // (a) a remainder that runs past its first day is pinned on that day only
  const NEXT_TUE = "2036-10-21";
  const bigItem = item("BIG", { size: "l", sizeMin: 1200, dueMs: at("2036-10-31", 17) });
  const friBig: PlanPin = { itemKey: "task:BIG", startMs: at(FRI, 8), endMs: at(FRI, 10), kind: "started" };
  const longRem = planPerson(baseInput({ nowMs: at(NEXT_MON, 7, 30), busy: [{ startMs: at(NEXT_MON, 12), endMs: at(NEXT_MON, 13) }], pins: [friBig], items: [bigItem] }));
  const remBlocks = blocksOf(longRem, "task:BIG").filter((b) => b.startMs > at(FRI, 23));
  const monRem = remBlocks.filter((b) => chicagoDayKey(b.startMs) === NEXT_MON);
  const laterRem = remBlocks.filter((b) => chicagoDayKey(b.startMs) > NEXT_MON);
  ok(monRem.length === 2 && monRem.every((b) => b.pinned === "started") && laterRem.length > 0 && laterRem.every((b) => !b.pinned) &&
    longRem.newPins.length === 2 && longRem.newPins.every((x) => chicagoDayKey(x.startMs) === NEXT_MON),
    "auto-cal pins: a remainder that runs past its first day is pinned only on that day; its later chunks stay movable");
  const tueRem = planPerson(baseInput({ nowMs: at(NEXT_TUE, 7, 30), pins: [friBig, ...longRem.newPins], items: [bigItem] }));
  const pinnedBig = [friBig, ...longRem.newPins, ...tueRem.newPins].reduce((s, x) => s + (x.endMs - x.startMs) / MIN, 0);
  ok(tueRem.newPins.length > 0 && tueRem.newPins.every((x) => chicagoDayKey(x.startMs) === NEXT_TUE) && pinnedBig <= 1200,
    "auto-cal pins: the next morning recomputes the remainder from the pins and pins that day's share");
  // (b) In progress: a far-future hand pin doesn't suppress the current block; no ratchet
  const farHand = planPerson(baseInput({ pins: [{ itemKey: "task:IP", startMs: at(FRI, 13), endMs: at(FRI, 14), kind: "hand" }], items: [item("IP", { inProgress: true, size: "l", sizeMin: 120 })] }));
  ok(farHand.newPins.some((x) => x.itemKey === "task:IP" && x.startMs === at(MON, 8) && x.endMs === at(MON, 9)),
    "auto-cal pins: a far-future hand pin doesn't stop an In-progress item's current block from being pinned");
  const splitIn = baseInput({ busy: [{ startMs: at(MON, 9), endMs: at(MON, 17) }], items: [item("IP2", { inProgress: true, size: "l", sizeMin: 240 })] });
  const split1 = planPerson(splitIn);
  const split2 = planPerson({ ...splitIn, nowMs: at(MON, 7, 15), pins: split1.newPins });
  ok(split1.newPins.length === 1 && split1.newPins[0].startMs === at(MON, 8) && split2.newPins.length === 0 && blocksOf(split2, "task:IP2").some((b) => !b.pinned),
    "auto-cal pins: In progress pins only the current block — the next compute leaves the rest movable");
  const covering = planPerson(baseInput({ nowMs: at(MON, 8, 30), pins: [{ itemKey: "task:IP3", startMs: at(MON, 8), endMs: at(MON, 9), kind: "started" }], items: [item("IP3", { inProgress: true, size: "l", sizeMin: 120 })] }));
  ok(covering.newPins.length === 0, "auto-cal pins: an In-progress item whose pin covers now gets no second pin");
  // (c) futurePins includes this compute's new pins that haven't begun
  ok(longRem.futurePins.some((x) => x.itemKey === "task:BIG" && x.startMs === at(NEXT_MON, 8)) && !longRem.futurePins.some((x) => x.startMs <= at(NEXT_MON, 7, 30)),
    "auto-cal pins: a pin made by this compute that hasn't begun is offered to Unpin");
  // (d) one key format
  const planSrc = readFileSync("src/lib/task-plan/plan.ts", "utf8");
  ok(!/\$\{[^}]*\}@\$\{/.test(planSrc) && /pinBlobKey\(/.test(planSrc), "auto-cal pins: plan.ts builds block/pin keys only through pinBlobKey");

  // (e) save-and-recompute loop: compute every 15 min Sat → Wed, persist newPins, drop staleKeys
  {
    const SAT0 = SAT; // 2036-10-18
    const THU = "2036-10-23";
    const loopItems: PlanItem[] = [
      item("L1", { size: "l", sizeMin: 240, dueMs: at("2036-10-21", 17) }),
      item("BIG", { size: "l", sizeMin: 1200, dueMs: at("2036-10-31", 17) }),
      item("IP", { inProgress: true, size: "l", sizeMin: 120 }),
      item("H", { sizeMin: 60, dueMs: at("2036-10-22", 17) }),
      item("DONE", { sizeMin: 60, tier: "high", dueMs: at("2036-10-21", 17) }),
      item("N1", { size: "s", sizeMin: 30, tier: "high", dueMs: at("2036-10-20", 17) }),
      item("N2", { sizeMin: 90, tier: "low", dueMs: at("2036-10-24", 17) }),
      item("N3", { size: "l", sizeMin: 240, dueMs: at("2036-10-22", 17), createdAt: 5 }),
      item("N4", { sizeMin: 45, dueMs: at("2036-10-19", 17), createdAt: 6 }),
    ];
    const loopBusy: BusyInterval[] = [
      { startMs: at("2036-10-20", 10), endMs: at("2036-10-20", 11, 30) },
      { startMs: at("2036-10-21", 13), endMs: at("2036-10-21", 15) },
      { startMs: at("2036-10-22", 8), endMs: at("2036-10-22", 9) },
    ];
    const store = new Map<string, PlanPin>();
    for (const x of [
      { itemKey: "task:L1", startMs: at(FRI, 8), endMs: at(FRI, 10), kind: "started" },
      { itemKey: "task:BIG", startMs: at(FRI, 13), endMs: at(FRI, 14), kind: "started" },
      { itemKey: "task:H", startMs: at("2036-10-21", 14), endMs: at("2036-10-21", 15), kind: "hand" },
      { itemKey: "task:DONE", startMs: at("2036-10-22", 15), endMs: at("2036-10-22", 16), kind: "hand" },
    ] as PlanPin[]) store.set(pinBlobKey(x), x);
    const sizeOf = new Map(loopItems.map((i) => [i.key, i.sizeMin] as const));
    const total = (k: string) => [...store.values()].filter((x) => x.itemKey === k).reduce((s, x) => s + (x.endMs - x.startMs) / MIN, 0);
    let dupFree = true, overlapFree = true, bounded = true, staleDropped = true, computes = 0;
    let curDay = "";
    const dayStart = new Map<string, number>();
    for (let t = at(SAT0, 0); t < chicagoDayStart(THU); t += QUARTER_MS) {
      const doneNow = t >= at("2036-10-21", 12);
      const its = doneNow ? loopItems.filter((i) => i.id !== "DONE") : loopItems;
      const day = chicagoDayKey(t);
      if (day !== curDay) {
        curDay = day;
        for (const i of its) dayStart.set(i.key, total(i.key));
      }
      const r = planPerson(baseInput({ nowMs: t, busy: loopBusy, pins: [...store.values()], items: its }));
      computes++;
      const fresh = r.newPins.map(pinBlobKey);
      if (new Set(fresh).size !== fresh.length || fresh.some((k) => store.has(k))) dupFree = false;
      for (const x of r.newPins) store.set(pinBlobKey(x), x);
      for (const k of r.staleKeys) store.delete(k);
      if (doneNow && [...store.values()].some((x) => x.itemKey === "task:DONE")) staleDropped = false;
      const sorted = [...store.values()].sort((a, b) => a.startMs - b.startMs);
      if (!sorted.every((x, i) => i === 0 || sorted[i - 1].endMs <= x.startMs)) overlapFree = false;
      for (const i of its) if (total(i.key) > Math.max((dayStart.get(i.key) ?? 0) + 30, (sizeOf.get(i.key) ?? 0) + 29)) bounded = false;
    }
    ok(computes === 5 * 96 && dupFree && store.size > 10, `auto-cal pins (save loop, ${computes} computes Sat → Wed): no compute re-adds a stored pin key or repeats one`);
    ok(overlapFree, "auto-cal pins (save loop): stored pins never overlap");
    ok(bounded, "auto-cal pins (save loop): an item's pinned minutes never pass its size (+ under one grid piece), except at most one 30-minute chunk a day for still-open work that actually began");
    ok(staleDropped, "auto-cal pins (save loop): a done item's pins are dropped by the next compute");
    ok(total("task:L1") >= 240 && total("task:N4") >= 45 && total("task:IP") >= 120, "auto-cal pins (save loop): by Wednesday night the week's work has all been pinned as it began");
  }

  /* the planner stays client-safe; the harness's source helpers work (later tasks lean on them) */
  const pure = ["pins.ts", "plan.ts", "free.ts", "labels.ts", "due.ts", "urgency.ts", "types.ts"].map((f) => readFileSync(`src/lib/task-plan/${f}`, "utf8")).join("\n").replace(/import type[^;]+;/g, "");
  ok(!/from "@\/(db|lib\/stores\/|lib\/users")/.test(pure), "auto-cal pins: the pin rules, planner, due, urgency and types never import the database");
  const demo = "export async function a() {\n  const s = await requireUser();\n}\nexport async function b() {\n  await other();\n  await requireUser();\n}\n";
  ok(firstAwait(fnBody(demo, "a"), "requireUser()") && !firstAwait(fnBody(demo, "b"), "requireUser()") && fnBody(demo, "c") === "",
    "auto-cal harness: fnBody/firstAwait find a function's first await");
}

/* ---- Task 6: pin store ---- */
export async function autoCalPinStoreChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const U = "TESTautocal:pins-u1";
  const U2 = "TESTautocal:pins-u2";
  const t0 = floorQuarter(Date.now() + 86_400_000);
  const pin = (itemKey: string, h: number, kind: PinKind = "hand"): PlanPin => ({ itemKey, startMs: t0 + h * 3_600_000, endMs: t0 + (h + 1) * 3_600_000, kind });
  try {
    await Promise.all([addPins(U, [pin("task:A", 0)]), addPins(U, [pin("task:B", 2)])]);
    ok((await getPins(U)).length === 2, "auto-cal pin store: two pins added at once are both kept (one blob key each)");
    await removePinKeys(U, [pinBlobKey(pin("task:A", 0))]);
    ok((await getPins(U)).map((p) => p.itemKey).join() === "task:B", "auto-cal pin store: removing one pin leaves the rest");
    ok((await clearItemPins(U, "task:B")) === 1 && (await getPins(U)).length === 0, "auto-cal pin store: clearing an item removes its pins");

    const me = { id: U, name: "Auto Cal" };
    const T = fixtureId("autocal", "pins-done");
    const T2 = fixtureId("autocal", "pins-keep");
    const T3 = fixtureId("autocal", "pins-handoff");
    const T4 = fixtureId("autocal", "pins-delete");
    for (const id of [T, T2, T3, T4]) {
      await createTask({ id, title: id, assigneeUserId: U, assigneeName: "Auto Cal" }, me);
      registerFixture("tasks", id);
    }
    await addPins(U, [pin(planItemKey("task", T), 0), pin(planItemKey("task", T2), 1), pin(planItemKey("task", T3), 2), pin(planItemKey("task", T4), 3)]);
    const has = async (uid: string, id: string) => (await getPins(uid)).some((x) => x.itemKey === planItemKey("task", id));
    await setTaskStatus(T, "done");
    ok(!(await has(U, T)) && (await has(U, T2)), "auto-cal pin store: Done clears that task's pins, nobody else's");
    await updateTask(T3, { assigneeUserId: U2, assigneeName: "Other" });
    ok(!(await has(U, T3)), "auto-cal pin store: handing a task off clears its pins from the old calendar");
    await removeTask(T4);
    ok(!(await has(U, T4)), "auto-cal pin store: deleting a task clears its pins");
    await setTaskStatus(T2, "in_progress");
    ok(await has(U, T2), "auto-cal pin store: In progress keeps its pins");
    await updateTask(T2, { title: "renamed", priority: "high" });
    ok((await has(U, T2)) && (await getTask(T2))?.priority === "high", "auto-cal pin store: an edit that keeps the assignee keeps its pins (and still writes the tier)");

    const roster = await activeUsers();
    ok(roster.length > 0, "auto-cal pin store: the dev roster has someone to own the assignment checks (no silent skip)");
    {
      const who = roster[0];
      const pinsOf = async (k: string) => (await getPins(who.id)).filter((x) => x.itemKey === k).length;
      const mk = async (title: string, assignee: string) => {
        const a = await createAssignment({ title, assignee, createdBy: "Auto Cal" });
        registerFixture("assignments", a.id);
        const k = planItemKey("assignment", a.id);
        await addPins(who.id, [pin(k, 4)]);
        return { id: a.id, k };
      };
      const done = await mk("pins asg done", who.name);
      await setAssignmentDone(done.id, true, "app");
      ok((await pinsOf(done.k)) === 0, "auto-cal pin store: a completed assignment's pins are cleared (also when Google Tasks completes it)");

      const hand = await mk("pins asg handoff", who.name.toLowerCase());
      await updateAssignment(hand.id, { assignee: who.name });
      ok((await pinsOf(hand.k)) === 1, "auto-cal pin store: re-spelling the assignee's name (case) is not a hand-off — pins stay");
      await updateAssignment(hand.id, { title: "pins asg handoff 2" });
      ok((await pinsOf(hand.k)) === 1, "auto-cal pin store: an assignment edit that leaves the assignee alone keeps its pins");
      await updateAssignment(hand.id, { assignee: "Nobody Else" });
      ok((await pinsOf(hand.k)) === 0, "auto-cal pin store: handing an assignment to someone else clears its pins from the old calendar");

      const gone = await mk("pins asg delete", who.name);
      await removeAssignment(gone.id);
      ok((await pinsOf(gone.k)) === 0, "auto-cal pin store: deleting an assignment clears its pins");
      await removePinKeys(who.id, [pinBlobKey(pin(done.k, 4)), pinBlobKey(pin(hand.k, 4)), pinBlobKey(pin(gone.k, 4))]);
    }

    /* (g) PIN_MAX_PER_PERSON: prune only past pins the plan no longer depends on */
    const nowCap = at(WED, 7, 30);
    const capItems = [item("KEEP", { sizeMin: 60 }), item("NEED", { size: "l", sizeMin: 600, dueMs: at("2036-10-31", 17) })];
    const cp = (k: string, day: string, h: number, m = 0, kind: PinKind = "started"): PlanPin => ({ itemKey: `task:${k}`, startMs: at(day, h, m), endMs: at(day, h, m + 30), kind });
    const capPins: PlanPin[] = [
      cp("GONE", MON, 8), cp("GONE", MON, 9),
      cp("KEEP", MON, 10), cp("KEEP", MON, 11), cp("KEEP", MON, 13, 0, "hand"), cp("KEEP", TUE, 8),
      cp("NEED", MON, 14), cp("NEED", TUE, 9),
      cp("KEEP", "2036-10-16", 9, 0, "hand"),
    ];
    const keysOf = (ps: PlanPin[]) => ps.map(pinBlobKey).join();
    ok(pinsToPrune({ pins: capPins, items: capItems, nowMs: nowCap, max: 9 }).length === 0, "auto-cal pin cap: at or under the cap nothing is pruned");
    const p5 = pinsToPrune({ pins: capPins, items: capItems, nowMs: nowCap, max: 5 });
    ok(p5.join() === keysOf([cp("GONE", MON, 8), cp("GONE", MON, 9), cp("KEEP", MON, 10), cp("KEEP", MON, 11)]),
      "auto-cal pin cap: over the cap, past pins of finished items go first, then the oldest past pins of an item already pinned past its size");
    const p3 = pinsToPrune({ pins: capPins, items: capItems, nowMs: nowCap, max: 3 });
    ok(p3.join() === keysOf([cp("GONE", MON, 8), cp("GONE", MON, 9), cp("KEEP", MON, 10), cp("KEEP", MON, 11)]),
      "auto-cal pin cap: never a future pin, never one an item's remaining time still depends on (its past pins alone must cover its size) — still over the cap, the rest is kept");
    const strip = (r: PlanResult) => JSON.stringify({ ...r, staleKeys: [], blocks: r.blocks.filter((b) => b.endMs > r.nowMs), finishMs: Object.entries(r.finishMs).sort() });
    const pruned = new Set(p3);
    const kept = capPins.filter((x) => !pruned.has(pinBlobKey(x)));
    ok([nowCap, at(FRI, 7), at("2036-10-20", 7)].every((n) => strip(planPerson(baseInput({ nowMs: n, pins: capPins, items: capItems }))) === strip(planPerson(baseInput({ nowMs: n, pins: kept, items: capItems })))),
      "auto-cal pin cap: pruning leaves the plan from now on exactly as it was");

    /* a later Unpin/drag of a FUTURE pin must not change what pruning already did */
    {
      const fk = [item("FUT", { sizeMin: 90 })];
      const fa = cp("FUT", MON, 8), fb = cp("FUT", MON, 9), ff: PlanPin = { itemKey: "task:FUT", startMs: at(FRI, 9), endMs: at(FRI, 10), kind: "hand" };
      const fpins = [fa, fb, ff];
      const fprune = pinsToPrune({ pins: fpins, items: fk, nowMs: nowCap, max: 2 });
      const fkept = fpins.filter((x) => !fprune.includes(pinBlobKey(x)));
      const noFuture = (ps: PlanPin[]) => ps.filter((x) => x !== ff);
      ok([nowCap, at(FRI, 7)].every((n) => strip(planPerson(baseInput({ nowMs: n, pins: noFuture(fpins), items: fk }))) === strip(planPerson(baseInput({ nowMs: n, pins: noFuture(fkept), items: fk })))),
        "auto-cal pin cap: pruning counts only past pins — removing a future pin afterwards leaves the plan as it would have been unpruned");
    }

    const U3 = "TESTautocal:pins-cap";
    const U4 = "TESTautocal:pins-cap-keep";
    const nowMs = Date.now();
    const hourAgo = floorQuarter(nowMs) - 3_600_000;
    const past = (k: string, i: number): PlanPin => ({ itemKey: k, startMs: hourAgo - i * 3_600_000, endMs: hourAgo - i * 3_600_000 + 1_800_000, kind: "started" });
    const futureX: PlanPin = { itemKey: "task:X", startMs: t0, endMs: t0 + 1_800_000, kind: "hand" };
    const many = [...Array.from({ length: PIN_MAX_PER_PERSON + 3 }, (_, i) => past("task:X", i)), past("task:GONE", 600), past("task:GONE", 601), futureX];
    const logs: string[] = [];
    const quiet = { info: (m: string) => void logs.push(`info ${m}`), warn: (m: string) => void logs.push(`warn ${m}`), error: (m: string) => void logs.push(`error ${m}`) };
    await addPins(U3, many, { items: [item("X", { sizeMin: 60 })], nowMs }, quiet);
    const after = await getPins(U3);
    ok(after.length === PIN_MAX_PER_PERSON && !after.some((x) => x.itemKey === "task:GONE") && after.some((x) => pinBlobKey(x) === pinBlobKey(futureX)) &&
      !after.some((x) => pinBlobKey(x) === pinBlobKey(past("task:X", PIN_MAX_PER_PERSON + 2))) && after.some((x) => pinBlobKey(x) === pinBlobKey(past("task:X", 0))),
      `auto-cal pin store: over ${PIN_MAX_PER_PERSON} pins, the store prunes the oldest past pins the plan no longer needs and keeps future ones`);
    const needy = Array.from({ length: PIN_MAX_PER_PERSON + 1 }, (_, i) => past("task:Y", i));
    ok(logs.length === 1 && logs[0].startsWith("info ") && /pruned \d+ past pin/.test(logs[0]), "auto-cal pin store: the cap prune reports once, through the injected logger");
    logs.length = 0;
    await addPins(U4, needy, { items: [item("Y", { sizeMin: 100_000 })], nowMs }, quiet);
    ok(logs.length === 1 && logs[0].startsWith("warn "), "auto-cal pin store: nothing prunable over the cap → one warning, through the injected logger");
    logs.length = 0;
    await addPins(U4, [{ itemKey: "task:Y", startMs: t0, endMs: t0 + 1_800_000, kind: "hand" }], undefined, quiet);
    ok((await getPins(U4)).length === PIN_MAX_PER_PERSON + 2 && logs.length === 0, "auto-cal pin store: pins the plan still depends on are never pruned, and a plain add (no cap context) neither prunes nor logs");
  } finally {
    await db.delete(blobs).where(like(blobs.id, "task_pins:TESTautocal:%"));
  }
}

/* ---- Task 7: loader + triage hook ---- */
export async function autoCalLoaderChecks(ok: Ok): Promise<void> {
  const roster = [{ id: "u1", name: "Dana" }, { id: "u2", name: "Sam" }, { id: "u3", name: "Lee" }];
  const tk = (id: string, over: Partial<TaskRecord> = {}) => normalizeTask({ id, title: id, assigneeUserId: "u1", assigneeName: "Dana", dueAt: at(FRI, 17), createdAt: 1, ...over });
  const asg = (id: string, over: Partial<Assignment> = {}): Assignment => ({ id, title: id, assignee: "Dana", createdBy: "x", createdAt: 1, dueDate: at(FRI, 17), link: null, done: false, doneAt: null, doneVia: null, source: "", ...over });
  const tasks = [
    tk("T-open"), tk("T-ip", { status: "in_progress" }), tk("T-blocked", { status: "blocked" }), tk("T-done", { status: "done" }),
    tk("T-none", { assigneeUserId: null, assigneeName: "" }), tk("T-legacy", { assigneeUserId: null, assigneeName: "sam" }),
    tk("T-auto-p1-x", { coverageKey: "P-1:installation:x", startAt: at(WED, 0) }), tk("T-undated", { dueAt: null, createdAt: at(MON, 9) }),
    tk("T-waiting", { waitingOn: { contactId: null, name: "Pat Customer" } }), tk("T-waiting-ip", { status: "in_progress", waitingOn: { contactId: "C-1", name: "Pat" } }),
  ];
  const asgs = [asg("as-1"), asg("as-done", { done: true }), asg("as-lee", { assignee: "LEE" }), asg("as-noone", { assignee: "" })];
  const by = planItemsByPerson(tasks, asgs, roster);
  const keys = (u: string) => (by.get(u) ?? []).map((i) => i.key).sort().join();
  ok(keys("u1") === ["asg:as-1", "task:T-auto-p1-x", "task:T-ip", "task:T-open", "task:T-undated"].sort().join(),
    "auto-cal items: every open task and Queue assignment with an assignee — checklist/template tasks too; blocked, done, unassigned and Waiting on customer (#323) wait");
  ok(keys("u2") === "task:T-legacy" && keys("u3") === "asg:as-lee", "auto-cal items: a name-only assignee resolves through the roster (case-insensitive)");
  const u1 = by.get("u1")!;
  ok(u1.find((i) => i.id === "T-auto-p1-x")?.earliestMs === at(WED, 0) && u1.find((i) => i.id === "T-ip")?.inProgress === true && u1.find((i) => i.id === "T-undated")?.dueVirtual === true,
    "auto-cal items: a template start, In progress and a virtual due date carry into the plan");

  const visit = { id: "SV-1", assignedTo: "Dana", attendees: [], invites: [], venue: "Lone Pine", customer: "LP", stage: "scheduled", startAt: at(MON, 10), endAt: at(MON, 11), googleEventId: null, address: "", customerId: null, locationId: null } as unknown as SiteVisit;
  const gev = (id: string, s: number, e: number, over: Partial<CalendarEvent> = {}): CalendarEvent => ({ id, iCalUID: id + "@google.com", title: id, startMs: s, endMs: e, allDay: false, location: "", htmlLink: "", meetingUrl: "", selfDeclined: false, selfResponse: "", peakDriveKey: "", peakDriveDay: "", ...over });
  const events = [gev("accepted", at(MON, 13), at(MON, 14), { selfResponse: "accepted" }), gev("tentative", at(MON, 14), at(MON, 15), { selfResponse: "tentative" }), gev("allday", at(MON, 0), at(TUE, 0), { allDay: true })];
  const leg = { startMs: at(MON, 9, 30), endMs: at(MON, 10), flag: null } as unknown as DriveLeg;
  const deps = (over: Partial<TaskPlanDeps> = {}): Partial<TaskPlanDeps> => ({
    now: () => at(MON, 8),
    roster: async () => roster,
    tasks: async () => [],
    assignments: async () => [],
    visits: async () => [visit],
    workHours: async () => DEFAULT_WORK_HOURS,
    pins: async () => [],
    released: async () => [],
    readEvents: async () => ({ status: "ok", events }),
    drive: async () => [{ dayKey: MON, stops: [], legs: [leg], totalMin: 30 }],
    calendarTimeoutMs: 200,
    ...over,
  });
  const many = Array.from({ length: 8 }, (_, i) => tk("M" + i, { createdAt: i }));
  const [plan] = await loadTaskPlans({ userIds: ["u1"], meId: "u1", deps: deps({ tasks: async () => many }) });
  const mon = plan.result.blocks.filter((b) => chicagoDayKey(b.startMs) === MON);
  const hits = (s: number, e: number) => mon.some((b) => b.startMs < e && b.endMs > s);
  ok(plan.calendar === "ok" && plan.note === null, "auto-cal loader: a readable calendar plans with no note");
  ok(!hits(at(MON, 10), at(MON, 11)) && !hits(at(MON, 9, 30), at(MON, 10)) && !hits(at(MON, 13), at(MON, 14)),
    "auto-cal loader: free time excludes the visit, its drive block and accepted timed events");
  ok(hits(at(MON, 14), at(MON, 15)), "auto-cal loader: a tentative event isn't busy and an all-day event is ignored");
  const [failed] = await loadTaskPlans({ userIds: ["u1"], meId: "u1", deps: deps({ tasks: async () => many, readEvents: async () => ({ status: "failed", events: [] }) }) });
  ok(failed.calendar === "failed" && failed.note === "Planned without your Google calendar — may overlap meetings" && failed.result.blocks.length > 0,
    "auto-cal loader: an unreadable Google calendar still plans, with the note");
  const warned: string[] = [];
  const realWarn = console.warn;
  console.warn = (...a: unknown[]) => void warned.push(a.map(String).join(" "));
  let slow: Awaited<ReturnType<typeof loadTaskPlans>>[number];
  try {
    [slow] = await loadTaskPlans({ userIds: ["u1"], meId: "u1", deps: deps({ tasks: async () => many, readEvents: () => new Promise(() => {}) }) });
  } finally {
    console.warn = realWarn;
  }
  ok(slow.calendar === "failed" && slow.result.blocks.length > 0, "auto-cal loader: a calendar read that hangs times out and plans without it");
  ok(warned.some((w) => w.includes("[task-plan] calendar read timed out: u1")), "auto-cal loader: a calendar timeout is logged with the user id");

  // DST: the Google read covers exactly the planned days — through the 2036-11-02 fall-back (a 25-hour day).
  const ranges: Array<{ timeMinMs: number; timeMaxMs: number }> = [];
  for (const nowMs of [chicagoDayStart(MON), at(MON, 8)]) {
    await loadTaskPlans({ userIds: ["u1"], meId: "u1", deps: deps({ now: () => nowMs, readEvents: async (_u, r) => (ranges.push(r), { status: "ok", events: [] }) }) });
  }
  const horizonEnd = chicagoDayStart(addDays(MON, 56));
  ok(
    ranges.length === 2 && ranges.every((r) => r.timeMaxMs === horizonEnd) && chicagoDayKey(horizonEnd - 1) === addDays(MON, 55) && horizonEnd - chicagoDayStart(MON) === 56 * 86_400_000 + 3_600_000,
    "auto-cal loader: the calendar range ends at 00:00 Chicago after the last planned day, across the fall-back"
  );

  // The cron's calendar budget: min(timeout, deadline − now − 2 s), 0 = skip the read.
  ok(calendarBudgetMs(6000, undefined, 0) === 6000 && calendarBudgetMs(6000, 20_000, 0) === 6000 && calendarBudgetMs(6000, 5000, 0) === 3000 && calendarBudgetMs(6000, 1500, 0) === 0 && calendarBudgetMs(6000, -5, 0) === 0,
    "auto-cal loader: a cron calendar read is bounded by the build's deadline (2 s margin, floor 0)");
  let lateReads = 0;
  const [late] = await loadTaskPlans({ userIds: ["u1"], meId: "u1", deadlineMs: Date.now() + 1000, deps: deps({ tasks: async () => many, readEvents: async () => (lateReads++, { status: "ok", events: [] }) }) });
  ok(lateReads === 0 && late.calendar === "failed" && late.note === "Planned without your Google calendar — may overlap meetings" && late.result.blocks.length > 0,
    "auto-cal loader: with no time left before the deadline the Google read is skipped and the plan carries the calendar note");
  const everyone = await loadTaskPlans({
    userIds: "everyone",
    meId: "u2",
    deps: deps({ tasks: async () => tasks, assignments: async () => asgs, readEvents: async (uid) => (uid === "u3" ? { status: "no-calendar", events: [] } : { status: "ok", events: [] }) }),
  });
  ok(everyone.map((p) => p.userId).join() === "u2,u1,u3", "auto-cal loader: Everyone plans each person with work — viewer first, then by name");
  ok(everyone.find((p) => p.userId === "u3")?.note === "Planned without Lee's Google calendar — may overlap meetings", "auto-cal loader: another person's note names them");

  const added: string[] = [];
  const removed: string[] = [];
  const memStore: PinStore = { add: async (u, ps) => { added.push(`${u}:${ps.length}`); }, remove: async (u, ks) => { removed.push(`${u}:${ks.join()}`); } };
  const okPlan = (userId: string) => ({ userId, name: "X", calendar: "ok" as CalendarRead, note: null, result: { ...plan.result, newPins: [{ itemKey: "task:A", startMs: 1, endMs: 2, kind: "started" as PinKind }], staleKeys: ["task:B@5"] } });
  await savePlanPins([okPlan("u9")], { persistStartedFor: "u9", store: memStore });
  ok(added.join() === "u9:1" && removed.join() === "u9:task:B@5", "auto-cal loader: the owner's own view persists its new started pins and drops stale ones");
  added.length = 0;
  removed.length = 0;
  await savePlanPins([okPlan("u9"), okPlan("u8")], { persistStartedFor: null, store: memStore });
  await savePlanPins([okPlan("u9"), okPlan("u8")], { persistStartedFor: "u7", store: memStore });
  ok(added.length === 0 && removed.join("|") === "u9:task:B@5|u8:task:B@5|u9:task:B@5|u8:task:B@5",
    "auto-cal loader: a cron/triage save (persistStartedFor null) or someone else's view (Everyone, an admin) never persists a started pin — stale removal still runs (D797)");
  added.length = 0;
  await savePlanPins([okPlan("u9"), okPlan("u8")], { persistStartedFor: "u8", store: memStore });
  ok(added.join() === "u8:1", "auto-cal loader: on an Everyone view only the viewer's own plan locks started pins");
  const loadSrc0 = readFileSync("src/lib/task-plan/load.ts", "utf8");
  ok(/export async function savePlanPins\(plans: readonly PersonPlan\[\], opts: SavePlanOpts\)/.test(loadSrc0) && /persistStartedFor: string \| null;/.test(loadSrc0),
    "auto-cal loader: persistStartedFor is a required, explicit choice on every save");
  // A plan built without the person's meetings must not freeze its guesses as "started" pins.
  const addedBlind: string[] = [];
  const removedBlind: string[] = [];
  const blindPlan = (calendar: CalendarRead, newPins: PlanPin[]) => ({ userId: "u9", name: "X", calendar, note: null, result: { ...plan.result, newPins, staleKeys: ["task:B@5"] } });
  const startedPin: PlanPin = { itemKey: "task:A", startMs: 1, endMs: 2, kind: "started" };
  for (const c of ["failed", "no-calendar"] as const) {
    await savePlanPins([blindPlan(c, [startedPin])], { persistStartedFor: "u9", store: { add: async (u, ps) => { addedBlind.push(`${c}:${u}:${ps.length}`); }, remove: async (u, ks) => { removedBlind.push(`${c}:${ks.join()}`); } } });
  }
  ok(addedBlind.length === 0 && removedBlind.length === 2, "auto-cal loader: when the person's Google calendar wasn't read, new started pins are not saved (stale removal still runs)");
  const handPin: PlanPin = { itemKey: "task:H", startMs: 3, endMs: 4, kind: "hand" };
  await savePlanPins([blindPlan("failed", [startedPin, handPin])], { persistStartedFor: "u9", store: { add: async (u, ps) => { addedBlind.push(ps.map((x) => x.kind).join()); }, remove: async () => {} } });
  ok(addedBlind.join() === "hand", "auto-cal loader: a hand pin is unaffected by a failed calendar read");

  const noStore = { add: async () => {}, remove: async () => {} };
  const risky = Array.from({ length: 3 }, (_, i) => tk("R" + i, { size: "l", dueAt: at(MON, 17), createdAt: i }));
  const me = { id: "u1", name: "Dana", canApprove: false };
  const set = await taskPlanAtRisk(me, at(MON, 8), undefined, { deps: deps({ tasks: async () => risky }), store: noStore });
  ok(set.has("task:R2") && !set.has("task:R0"), "auto-cal triage: the planner's At risk keys feed morning triage");
  const boom = await taskPlanAtRisk(me, at(MON, 8), undefined, { deps: deps({ tasks: async () => { throw new Error("x"); } }), store: noStore });
  ok(boom.size === 0, "auto-cal triage: a planner failure never hides the tasks feed");
  ok(TRIAGE_HOOKS.atRisk === taskPlanAtRisk, "auto-cal triage: the app's triage hooks run the planner's at-risk provider");
  {
    // A view build (no cron deadline — the lazy first view) waits on Google for at most VIEW_PLAN_CALENDAR_MS, like Home.
    const { calendarTimeoutMs: _unused, ...noLimit } = deps({ tasks: async () => risky, readEvents: () => new Promise(() => {}) });
    void _unused;
    const realWarn = console.warn;
    console.warn = () => {};
    const t0 = Date.now();
    let viewSet: ReadonlySet<string>;
    try {
      viewSet = await taskPlanAtRisk(me, at(MON, 8), undefined, { deps: noLimit, store: noStore });
    } finally {
      console.warn = realWarn;
    }
    const took = Date.now() - t0;
    ok(VIEW_PLAN_CALENDAR_MS <= 2_500 && took >= VIEW_PLAN_CALENDAR_MS - 50 && took < VIEW_PLAN_CALENDAR_MS + 1_500 && viewSet.has("task:R2"),
      `auto-cal triage: a lazy first-view build gives Google at most ${VIEW_PLAN_CALENDAR_MS} ms, then plans without it (${took} ms)`);
  }

  // Fail closed: a partial item list or an unread pin blob never writes, removes or prunes a pin.
  const calls: string[] = [];
  const rec: PinStore = {
    add: async (u, ps, cap) => {
      calls.push(`add ${u} ${ps.map(pinBlobKey).join("|")} cap=${cap ? `${cap.items.map((i) => i.key).sort().join("|")}@${cap.nowMs}` : "none"}`);
    },
    remove: async (u, ks) => {
      calls.push(`rm ${u} ${ks.join("|")}`);
    },
  };
  const stale: PlanPin = { itemKey: "task:GONE", startMs: at(MON, 16), endMs: at(MON, 17), kind: "hand" };
  const work = [tk("IP1", { status: "in_progress" }), tk("Q1")];
  const down = async (): Promise<never> => {
    throw new Error("down");
  };
  const partial: Array<[string, Partial<TaskPlanDeps>]> = [
    ["tasks", { tasks: down }],
    ["assignments", { assignments: down }],
    ["roster", { roster: down }],
    ["pins", { pins: down }],
    ["released", { released: down }],
    ["visits", { visits: down }],
    ["workHours", { workHours: down }],
  ];
  for (const [label, over] of partial) {
    calls.length = 0;
    const d = deps({ tasks: async () => work, pins: async () => [stale], ...over });
    const rejected = await loadTaskPlans({ userIds: ["u1"], meId: "u1", deps: d }).then(() => false, () => true);
    const s = await taskPlanAtRisk(me, at(MON, 8), undefined, { deps: d, store: rec });
    ok(rejected && s.size === 0 && calls.length === 0, `auto-cal fail-closed: when ${label} can't be read the plan isn't computed, and no pin is written, removed or pruned`);
  }
  calls.length = 0;
  await taskPlanAtRisk(me, at(MON, 8), undefined, { deps: deps({ tasks: async () => work, pins: async () => [stale] }), store: rec });
  ok(calls.join() === `rm u1 ${pinBlobKey(stale)}`, "auto-cal triage: a triage build drops the stale pin but locks nothing — not even the In-progress block (D797)");
  calls.length = 0;
  await savePlanPins(await loadTaskPlans({ userIds: ["u1"], meId: "u1", deps: deps({ tasks: async () => work, pins: async () => [stale] }) }), { persistStartedFor: "u1", store: rec });
  const adds = calls.filter((c) => c.startsWith("add "));
  ok(calls.includes(`rm u1 ${pinBlobKey(stale)}`) && adds.length === 1 && adds[0].includes("task:IP1@") && adds[0].endsWith(` cap=task:IP1|task:Q1@${at(MON, 8)}`),
    "auto-cal fail-closed: the owner's full load saves the in-progress pin with the cap given exactly the items it planned with, and drops the stale pin");
  const everyoneDown = await loadTaskPlans({
    userIds: "everyone",
    meId: "u2",
    deps: deps({ tasks: async () => tasks, assignments: async () => asgs, pins: async (uid) => (uid === "u3" ? down() : []) }),
  }).then(() => false, () => true);
  ok(everyoneDown, "auto-cal fail-closed: in Everyone mode one person's unreadable pins fail the whole load");

  // One plan per build: the triage cron shares its memoized loaders and plans every user once.
  const loadsBy: Record<string, number> = {};
  const readsBy: Record<string, number> = {};
  const cnt = <T,>(n: string, v: T) => async () => ((loadsBy[n] = (loadsBy[n] ?? 0) + 1), v);
  const started = [
    tk("S1", { status: "in_progress" }),
    tk("S2", { status: "in_progress", assigneeUserId: "u2", assigneeName: "Sam" }),
    tk("S3", { status: "in_progress", assigneeUserId: "u3", assigneeName: "Lee" }),
  ];
  const shared = (over: Partial<AtRiskShared> = {}): AtRiskShared => ({
    build: {},
    roster: cnt("roster", roster),
    tasks: cnt("tasks", started),
    assignments: cnt("assignments", [] as Assignment[]),
    visits: cnt("visits", [] as SiteVisit[]),
    userIds: roster.map((r) => r.id),
    ...over,
  });
  const pdeps: Partial<TaskPlanDeps> = {
    workHours: async () => DEFAULT_WORK_HOURS,
    pins: async () => [],
    released: async () => [],
    readEvents: async (uid) => ((readsBy[uid] = (readsBy[uid] ?? 0) + 1), { status: "ok", events: [] }),
    drive: async () => [],
    calendarTimeoutMs: 200,
  };
  const people = roster.map((r) => ({ ...r, canApprove: false }));
  calls.length = 0;
  const build = shared();
  for (const u of people) await taskPlanAtRisk(u, at(MON, 8), build, { deps: pdeps, store: rec });
  ok(
    ["u1", "u2", "u3"].every((u) => readsBy[u] === 1) && loadsBy.tasks === 1 && loadsBy.assignments === 1 && loadsBy.visits === 1 && loadsBy.roster === 1,
    `auto-cal triage: a 3-user build plans everyone once — one Google read per user, each shared collection read once (${JSON.stringify({ ...loadsBy, ...readsBy })})`
  );
  ok(calls.filter((c) => c.startsWith("add ")).length === 0, "auto-cal triage: the cron build plans everyone (each has an In-progress block) but persists no started pin for anyone (D797)");
  await taskPlanAtRisk(people[0], at(MON, 8), shared({ userIds: undefined }), { deps: pdeps, store: rec });
  ok(readsBy.u1 === 2 && readsBy.u2 === 1 && readsBy.u3 === 1, "auto-cal triage: a single-user view (a fresh build) plans only that person");
  calls.length = 0;
  const failing = shared({ tasks: down });
  const failSets = [];
  for (const u of people) failSets.push(await taskPlanAtRisk(u, at(MON, 8), failing, { deps: pdeps, store: rec }));
  ok(failSets.every((x) => x.size === 0) && calls.length === 0 && readsBy.u2 === 1,
    "auto-cal fail-closed: a failed shared read stays failed for the whole build — no plan, no pin written or removed");

  const loadSrc = readFileSync("src/lib/task-plan/load.ts", "utf8");
  ok(/add: \(userId, pins, cap\) => addPins\(userId, pins, cap\)/.test(loadSrc), "auto-cal fail-closed: the app's pin store passes the cap context through to addPins");

  const planSrc = ["items.ts", "load.ts", "plan.ts", "pins.ts", "triage.ts"].map((f) => readFileSync(`src/lib/task-plan/${f}`, "utf8")).join("\n").replace(/import type[^;]+;/g, "");
  ok(!/from "@\/lib\/google\/calendar"/.test(planSrc), "auto-cal google: the planner never writes to (or even value-imports) Google Calendar — task blocks are app-only");
}

/* ---- Task 8: write actions ---- */
export async function autoCalWriteChecks(ok: Ok): Promise<void> {
  const db = await getDb();
  const U = "TESTautocal:w-u1";
  const me = { id: U, name: "Auto Cal" };
  const OWN = { id: U, admin: false };
  const OTHER = { id: "TESTautocal:w-other", admin: false };
  const ADMIN = { id: "TESTautocal:w-admin", admin: true };
  const T = fixtureId("autocal", "w-task");
  const K = planItemKey("task", T);
  const now = Date.now();
  const later = floorQuarter(now) + 26 * 3_600_000;
  try {
    await createTask({ id: T, title: "write", assigneeUserId: U, assigneeName: "Auto Cal" }, me);
    registerFixture("tasks", T);
    ok((await pinBlock({ kind: "task", id: T, fromStartMs: null, startMs: later, minutes: 60 }, OWN, now)).ok, "auto-cal write: dropping a block pins it by hand");
    const pins = await getPins(U);
    ok(pins.length === 1 && pins[0].kind === "hand" && pins[0].startMs === later && pins[0].endMs === later + 3_600_000, "auto-cal write: the hand pin is stored at the dropped time");
    ok((await pinBlock({ kind: "task", id: T, fromStartMs: later, startMs: later + 7_200_000, minutes: 60 }, OWN, now)).ok && (await getPins(U)).map((p) => p.startMs).join() === String(later + 7_200_000),
      "auto-cal write: dragging a pinned block moves its pin");
    ok((await pinBlock({ kind: "task", id: T, fromStartMs: later + 7_200_000, startMs: later + 7_200_000, minutes: 90 }, OWN, now)).ok && (await getPins(U)).map((p) => p.endMs - p.startMs).join() === String(60 * 60_000),
      "auto-cal write: re-dropping a pin in place keeps exactly one pin, at its stored length (the client's minutes are ignored on a move)");
    const stale = await pinBlock({ kind: "task", id: T, fromStartMs: later + 3_600_000, startMs: later + 10_800_000, minutes: 60 }, OWN, now);
    ok(!stale.ok && stale.error === "That block moved — refresh." && (await getPins(U)).map((p) => p.startMs).join() === String(later + 7_200_000),
      "auto-cal write: a stale from-time is refused, not turned into a second pin");
    const [m1, m2] = await Promise.all([
      pinBlock({ kind: "task", id: T, fromStartMs: later + 7_200_000, startMs: later + 14_400_000, minutes: 60 }, OWN, now),
      pinBlock({ kind: "task", id: T, fromStartMs: later + 7_200_000, startMs: later + 18_000_000, minutes: 60 }, OWN, now),
    ]);
    const after = await getPins(U);
    ok([m1.ok, m2.ok].filter(Boolean).length === 1 && after.length === 1, "auto-cal write: two concurrent drags of one block leave exactly one pin");
    const pinAt = after[0].startMs;
    ok((await pinBlock({ kind: "task", id: T, fromStartMs: pinAt, startMs: later + 7_200_000, minutes: 60 }, OWN, now)).ok, "auto-cal write: (reset) the pin goes back to its spot");
    const bigDrop = await pinBlock({ kind: "task", id: T, fromStartMs: null, startMs: later + 28_800_000, minutes: 240 }, OWN, now);
    const dropped = (await getPins(U)).find((p) => p.startMs === later + 28_800_000);
    ok(bigDrop.ok && dropped?.endMs === later + 28_800_000 + 30 * 60_000,
      "auto-cal write: a fresh drop is capped at the item's remaining minutes (a 1 h task with 1 h already pinned → 30 min, the floor)");
    await removePinKeys(U, [pinBlobKey({ itemKey: K, startMs: later + 28_800_000 })]);
    const forged = await pinBlock({ kind: "task", id: T, fromStartMs: null, startMs: later + 21_600_000, minutes: 15 }, OWN, now);
    ok(!forged.ok && (await getPins(U)).length === 1, "auto-cal write: a fresh drop under 30 minutes is refused");
    const stranger = await pinBlock({ kind: "task", id: T, fromStartMs: later + 7_200_000, startMs: later + 3_600_000, minutes: 60 }, OTHER, now);
    ok(!stranger.ok && stranger.error === "Only the owner or an admin can change this plan." && (await getPins(U)).map((p) => p.startMs).join() === String(later + 7_200_000),
      "auto-cal write: another user can't drag the owner's block");
    const strangerUn = await unpinBlock({ kind: "task", id: T, startMs: later + 7_200_000 }, OTHER, now);
    ok(!strangerUn.ok && (await getPins(U)).length === 1, "auto-cal write: another user can't unpin the owner's block");
    ok(!(await pinBlock({ kind: "task", id: T, fromStartMs: null, startMs: later, minutes: 60 }, OTHER, now)).ok && (await getPins(U)).length === 1, "auto-cal write: another user can't pin onto the owner's calendar");
    ok((await pinBlock({ kind: "task", id: T, fromStartMs: later + 7_200_000, startMs: later + 3_600_000, minutes: 60 }, ADMIN, now)).ok && (await getPins(U)).map((p) => p.startMs).join() === String(later + 3_600_000),
      "auto-cal write: an admin can drag it");
    ok((await pinBlock({ kind: "task", id: T, fromStartMs: later + 3_600_000, startMs: later + 7_200_000, minutes: 60 }, OWN, now)).ok, "auto-cal write: (reset) the owner moves it back");
    const nowSlot = floorQuarter(now);
    ok((await pinBlock({ kind: "task", id: T, fromStartMs: later + 7_200_000, startMs: nowSlot, minutes: 60 }, OWN, now)).ok
      && (await getPins(U)).map((p) => `${p.startMs}:${p.kind}`).join() === `${nowSlot + 900_000}:hand`,
      "auto-cal write: a drop at the current quarter lands at the next one, still a hand pin");
    ok((await unpinBlock({ kind: "task", id: T, startMs: nowSlot + 900_000 }, OWN, now)).ok && (await getPins(U)).length === 0, "auto-cal write: that block can be unpinned (never born started)");
    ok((await pinBlock({ kind: "task", id: T, fromStartMs: null, startMs: later + 7_200_000, minutes: 60 }, OWN, now)).ok, "auto-cal write: (reset) pin it again");
    ok((await unpinBlock({ kind: "task", id: T, startMs: later + 7_200_000 }, OWN, now)).ok && (await getPins(U)).length === 0, "auto-cal write: Unpin returns it to the scheduler");
    await addPins(U, [{ itemKey: K, startMs: floorQuarter(now) - 900_000, endMs: floorQuarter(now) + 2_700_000, kind: "started" }]);
    const stuck = await unpinBlock({ kind: "task", id: T, startMs: floorQuarter(now) - 900_000 }, OWN, now);
    ok(!stuck.ok && stuck.error === "This block has started — it stays put.", "auto-cal write: a started block can't be unpinned or moved");
    const moveStuck = await pinBlock({ kind: "task", id: T, fromStartMs: floorQuarter(now) - 900_000, startMs: later, minutes: 60 }, OWN, now);
    ok(!moveStuck.ok && moveStuck.error === "This block has started — it stays put." && (await getPins(U)).length === 1, "auto-cal write: dragging a started block is refused and leaves its pin");
    ok(!(await pinBlock({ kind: "task", id: T, fromStartMs: null, startMs: now - 3_600_000, minutes: 60 }, OWN, now)).ok, "auto-cal write: a time in the past is refused");
    ok(!(await pinBlock({ kind: "task", id: T, fromStartMs: null, startMs: later, minutes: 7 }, OWN, now)).ok, "auto-cal write: a block off the 15-minute grid is refused");
    await addPins(U, [{ itemKey: K, startMs: later + 86_400_000, endMs: later + 86_400_000 + 1_800_000, kind: "started" }]);
    const dragHeld = await pinBlock({ kind: "task", id: T, fromStartMs: later + 86_400_000, startMs: later, minutes: 60 }, OWN, now);
    ok(!dragHeld.ok && dragHeld.error === "This block holds started work — Unpin it to free the time." && (await getPins(U)).some((p) => p.startMs === later + 86_400_000),
      "auto-cal write: a held started pin (remainder / In progress) that hasn't begun can't be dragged — the error points to Unpin");
    ok(!(await unpinBlock({ kind: "task", id: T, startMs: later + 86_400_000 }, OTHER, now)).ok, "auto-cal write: another user can't release it");
    const heldOut = await unpinBlock({ kind: "task", id: T, startMs: later + 86_400_000 }, OWN, now);
    ok(heldOut.ok && !(await getPins(U)).some((p) => p.startMs === later + 86_400_000) && (await getPinState(U)).released.join() === K,
      "auto-cal write: the owner can Unpin a held started pin that hasn't begun — the escape hatch — and the item is marked released (D798)");
    ok((await getPins(U)).some((p) => p.startMs === floorQuarter(now) - 900_000), "auto-cal write: …while the started pin covering now stays");
    await addPins(U, [{ itemKey: K, startMs: later + 2 * 86_400_000, endMs: later + 2 * 86_400_000 + 1_800_000, kind: "started" }]);
    ok((await unpinBlock({ kind: "task", id: T, startMs: later + 2 * 86_400_000 }, ADMIN, now)).ok && !(await getPins(U)).some((p) => p.startMs === later + 2 * 86_400_000),
      "auto-cal write: an admin can release one too");
    await removePinKeys(U, [pinBlobKey({ itemKey: K, startMs: floorQuarter(now) - 900_000 })]);
    ok((await clearItemPins(U, K)) === 0 && (await getPinState(U)).released.length === 0, "auto-cal pin store: clearing an item also drops its release marker");
    await addPins(U, [{ itemKey: K, startMs: later + 3 * 86_400_000, endMs: later + 3 * 86_400_000 + 1_800_000, kind: "started" }]);
    await unpinBlock({ kind: "task", id: T, startMs: later + 3 * 86_400_000 }, OWN, now); // released again; In progress below lifts it
    const day = chicagoDayKey(now + 10 * 86_400_000);
    ok((await pushDueDate({ kind: "task", id: T, dayKey: day }, now)).ok && (await getTask(T))?.dueAt === dueStampForDay(day), "auto-cal write: Push due date sets the plan's finish day");
    ok(!(await pushDueDate({ kind: "task", id: T, dayKey: "2026-02-31" }, now)).ok, "auto-cal write: a bad day is refused");
    ok(!(await pushDueDate({ kind: "task", id: T, dayKey: addDays(chicagoDayKey(now), -1) }, now)).ok, "auto-cal write: a day in the past is refused");
    ok((await setTierSize({ kind: "task", id: T, priority: "high", size: "s" })).ok && (await getTask(T))?.priority === "high" && (await getTask(T))?.size === "s",
      "auto-cal write: the block's chips set tier and size");
    ok(!(await setTierSize({ kind: "task", id: T, priority: "urgent", size: "xl" })).ok && (await getTask(T))?.priority === "high",
      "auto-cal write: an invalid tier or size is refused, never stored");
    ok(!(await setTierSize({ kind: "task", id: T })).ok, "auto-cal write: nothing to change is refused");
    ok(!(await setTierSize({ kind: "task", id: T, priority: "high", size: "xl" })).ok && !(await setTierSize({ kind: "task", id: T, priority: "bogus" })).ok,
      "auto-cal write: an invalid field is refused outright, not silently dropped");
    ok((await getPinState(U)).released.join() === K && (await markInProgress({ kind: "task", id: T }, OTHER)).ok && (await getTask(T))?.status === "in_progress" && (await getPinState(U)).released.join() === K,
      "auto-cal write: anyone may mark a task In progress (existing task permissions), but only the owner or an admin lifts its release marker");
    ok((await markInProgress({ kind: "task", id: T }, OWN)).ok && (await getTask(T))?.status === "in_progress" && (await getPinState(U)).released.length === 0,
      "auto-cal write: In progress from the block — and it lifts an earlier release, so its current block locks again");
    await addPins(U, [{ itemKey: K, startMs: later + 4 * 86_400_000, endMs: later + 4 * 86_400_000 + 1_800_000, kind: "started" }]);
    await unpinBlock({ kind: "task", id: T, startMs: later + 4 * 86_400_000 }, OWN, now);
    ok((await getPinState(U)).released.join() === K && (await markInProgress({ kind: "task", id: T }, ADMIN)).ok && (await getPinState(U)).released.length === 0,
      "auto-cal write: an admin's In progress lifts the release marker too");
    ok(!(await handOff({ kind: "task", id: T, userId: "nobody-autocal" })).ok, "auto-cal write: hand off only to someone on the team");
    await addPins(U, [{ itemKey: K, startMs: later, endMs: later + 3_600_000, kind: "hand" }]);
    const roster = await activeUsers();
    ok(roster.length > 0, "auto-cal write: the roster is non-empty (so the hand-off check below runs)");
    if (roster.length) {
      ok((await handOff({ kind: "task", id: T, userId: roster[0].id })).ok && (await getTask(T))?.assigneeUserId === roster[0].id && !(await getPins(U)).some((p) => p.itemKey === K),
        "auto-cal write: Hand off reassigns and clears the old calendar's pins");
      const old = await pinBlock({ kind: "task", id: T, fromStartMs: null, startMs: later, minutes: 60 }, OWN, now);
      ok(!old.ok && old.error === "Only the owner or an admin can change this plan.", "auto-cal write: after a hand-off the old owner can't pin it");
    }
    await setTaskStatus(T, "done");
    ok(!(await markInProgress({ kind: "task", id: T }, OWN)).ok && (await getTask(T))?.status === "done", "auto-cal write: a done task isn't reopened by In progress");
    ok(!(await pinBlock({ kind: "task", id: T, fromStartMs: null, startMs: later, minutes: 60 }, OWN, now)).ok, "auto-cal write: a task handed off and done can't be pinned");
    // The owner (not a stranger) pinning a done task is refused for being done.
    const D = fixtureId("autocal", "w-done");
    await createTask({ id: D, title: "finished", assigneeUserId: U, assigneeName: "Auto Cal" }, me);
    registerFixture("tasks", D);
    await setTaskStatus(D, "done");
    const doneTry = await pinBlock({ kind: "task", id: D, fromStartMs: null, startMs: later, minutes: 60 }, OWN, now);
    ok(!doneTry.ok && doneTry.error === "That item isn't open." && (await getPins(U)).every((p) => p.itemKey !== planItemKey("task", D)),
      "auto-cal write: a done task can't be pinned (the owner is refused for being done, nothing stored)");
    ok(!(await pinBlock({ kind: "task", id: "T-missing-autocal", fromStartMs: null, startMs: later, minutes: 60 }, OWN, now)).ok, "auto-cal write: a missing item is refused");
    ok(!(await pinBlock({ kind: "bogus", id: T, fromStartMs: null, startMs: later, minutes: 60 }, OWN, now)).ok && !(await pinBlock(null, OWN, now)).ok, "auto-cal write: junk input is refused");
  } finally {
    await db.delete(blobs).where(like(blobs.id, "task_pins:TESTautocal:%"));
  }
  const src = readFileSync("src/app/(app)/calendar/plan-actions.ts", "utf8");
  for (const name of ["pinBlockAction", "unpinBlockAction", "pushDueDateAction", "handOffAction", "setTierSizeAction", "markInProgressAction"]) {
    ok(firstAwait(fnBody(src, name), "requireUser()"), `auto-cal write: ${name} checks the session first`);
  }
  ok(!/google\/calendar/.test(readFileSync("src/lib/task-plan/write.ts", "utf8")), "auto-cal write: the plan's writes never touch Google Calendar");
}

/* ---- Task 9: calendar view ---- */
export async function autoCalCalendarViewChecks(ok: Ok): Promise<void> {
  const r = planPerson(baseInput({
    nowMs: at(MON, 10, 7),
    pins: [{ itemKey: "task:P", startMs: at(TUE, 9), endMs: at(TUE, 10), kind: "hand" }],
    items: [
      item("A"),
      item("P"),
      item("R1", { size: "l", sizeMin: 240, dueMs: at(MON, 17), createdAt: 8 }),
      item("R2", { size: "l", sizeMin: 240, dueMs: at(MON, 17), createdAt: 9 }),
      item("Z", { dueMs: at("2036-11-30", 17), createdAt: 10 }),
    ],
  }));
  const view = calendarPlanView([{ userId: "u1", name: "Dana", note: null, result: r }], { minMs: at(MON, 0), maxMs: at(TUE, 23), initials: () => "DA" });
  ok(view.blocks.every((b) => b.endMs >= at(MON, 0) && b.startMs <= at(TUE, 23)) && view.plannedKeys.includes("task:Z"),
    "auto-cal view: blocks are cut to the visible window; planned keys cover the whole plan");
  const p = view.blocks.find((b) => b.itemKey === "task:P")!;
  ok(p.pinned === "hand" && p.canUnpin && p.draggable, "auto-cal view: a pin that hasn't begun can be unpinned and dragged");
  const begun = view.blocks.find((b) => b.pinned === "started");
  ok(!!begun && !begun.canUnpin && !begun.draggable, "auto-cal view: a block that has begun can't be unpinned or dragged");
  const held = planPerson(baseInput({ nowMs: at(MON, 10, 7), pins: [{ itemKey: "task:H", startMs: at(TUE, 8), endMs: at(TUE, 9), kind: "started" }], items: [item("H", { size: "l", sizeMin: 240 })] }));
  const heldView = calendarPlanView([{ userId: "u1", name: "Dana", note: null, result: held }], { minMs: at(MON, 0), maxMs: at(TUE, 23), initials: () => "DA", viewer: { id: "u1", admin: false } });
  const hb = heldView.blocks.find((b) => b.startMs === at(TUE, 8));
  ok(hb?.pinned === "started" && hb.canUnpin && !hb.draggable && heldView.futurePins.some((f) => f.startMs === at(TUE, 8) && f.pinKind === "started" && f.canUnpin),
    "auto-cal view: a held started pin that hasn't begun (remainder / In progress) offers Unpin — the escape hatch — but doesn't drag (D798)");
  const heldOther = calendarPlanView([{ userId: "u1", name: "Dana", note: null, result: held }], { minMs: at(MON, 0), maxMs: at(TUE, 23), initials: () => "DA", viewer: { id: "u2", admin: false } });
  ok(!heldOther.blocks.some((b) => b.canUnpin) && !heldOther.futurePins.some((f) => f.canUnpin), "auto-cal view: …only for the owner or an admin");
  // A started pin this compute made (In progress, its block still ahead) isn't stored yet — the owner's view saves it
  // in the same request, anyone else's never does — so it offers no Unpin until a later compute reads it back.
  const unsaved = planPerson(baseInput({ nowMs: at(MON, 10, 7), busy: [{ startMs: at(MON, 10), endMs: at(MON, 17) }], items: [item("IPV", { inProgress: true, size: "l", sizeMin: 240 })] }));
  const unsavedPin = unsaved.newPins.find((x) => x.itemKey === "task:IPV" && x.startMs > at(MON, 10, 7));
  for (const viewer of [{ id: "u1", admin: false }, { id: "u2", admin: true }]) {
    const v = calendarPlanView([{ userId: "u1", name: "Dana", note: null, result: unsaved }], { minMs: at(MON, 0), maxMs: at(TUE, 23), initials: () => "DA", viewer });
    const ub = v.blocks.find((b) => b.startMs === unsavedPin?.startMs && b.itemKey === "task:IPV");
    ok(!!unsavedPin && ub?.pinned === "started" && !ub.canUnpin && !v.futurePins.some((f) => f.itemKey === "task:IPV" && f.canUnpin),
      `auto-cal view: a started pin made by this compute (not stored yet) offers no Unpin — viewer ${viewer.id}${viewer.admin ? " (admin)" : ""}`);
  }
  const savedBack = planPerson(baseInput({ nowMs: at(MON, 10, 7), busy: [{ startMs: at(MON, 10), endMs: at(MON, 17) }], pins: unsaved.newPins, items: [item("IPV", { inProgress: true, size: "l", sizeMin: 240 })] }));
  const sbView = calendarPlanView([{ userId: "u1", name: "Dana", note: null, result: savedBack }], { minMs: at(MON, 0), maxMs: at(TUE, 23), initials: () => "DA", viewer: { id: "u1", admin: false } });
  ok(sbView.blocks.some((b) => b.startMs === unsavedPin?.startMs && b.canUnpin) && sbView.futurePins.some((f) => f.startMs === unsavedPin?.startMs && f.canUnpin),
    "auto-cal view: once that pin is stored (read back as an input pin), the owner can Unpin it");
  const popSrc = readFileSync("src/app/(app)/calendar/task-block-popover.tsx", "utf8");
  ok(/block\.pinned === "started" && block\.canUnpin/.test(popSrc) && popSrc.includes("Unpin frees this time"), "auto-cal view: the popover explains what Unpin does to held started work");
  ok(view.blocks.filter((b) => b.itemKey === "task:R2").every((b) => b.atRiskLabel === "At risk — due Mon") && view.atRisk[0]?.itemKey === "task:R2",
    "auto-cal view: an at-risk block carries the badge text");
  ok(view.atRisk[0]?.finishDayKey === TUE && view.atRisk[0]?.finishText === "Plan finishes Tue Oct 14",
    "auto-cal view: the at-risk list gives the plan's finish day (Push due date's target)");
  const tasks: CalendarTaskItem[] = [
    { kind: "task", id: "A", title: "A", dueAt: at(FRI, 17), done: false, assigneeName: "Dana", assigneeInitials: "DA", href: "" },
    { kind: "task", id: "BLK", title: "blocked", dueAt: at(MON, 12), done: false, assigneeName: "Dana", assigneeInitials: "DA", href: "" },
  ];
  const range = { today: localDayKey(at(MON, 10)), rangeStart: localDayKey(at(MON, 0)), rangeEnd: localDayKey(at(TUE, 23)) };
  const chips = monthChips(tasks, view, range);
  const aDays = [...new Set(view.blocks.filter((b) => b.itemKey === "task:A").map((b) => localDayKey(b.startMs)))].sort().join();
  ok(chips.filter((c) => c.item.id === "A").map((c) => c.dayKey).sort().join() === aDays, "auto-cal view: month chips sit on each day the task is planned");
  ok(stripTasks(tasks, view).map((t) => t.id).join() === "BLK" && chips.some((c) => c.item.id === "BLK"), "auto-cal view: an unplanned item (blocked) keeps its old chip");
  const lay = layoutIntervals([{ key: "a", startMs: 0, endMs: 10 }, { key: "b", startMs: 5, endMs: 15 }, { key: "c", startMs: 20, endMs: 30 }]);
  ok(lay.map((x) => `${x.it.key}${x.col}/${x.cols}`).join() === "a0/2,b1/2,c0/1", "auto-cal view: overlapping blocks (Everyone) sit side by side");

  const page = readFileSync("src/app/(app)/calendar/page.tsx", "utf8");
  const client = readFileSync("src/app/(app)/calendar/calendar-client.tsx", "utf8");
  ok(/loadTaskPlans\(/.test(page) && /after\(\(\) => savePlanPins\(/.test(page), "auto-cal view: /calendar computes plans on view and saves pins after the response");
  ok(client.includes("<TaskBlockLayer") && client.includes("monthChips(") && client.includes("plan.notes") && client.includes("<TaskBlockPopover"),
    "auto-cal view: Week/Day draw task blocks, Month chips come from the plan, the Google note and block popover show");
  const noDb = (f: string) => !/^import\s+(?!type\b)[^;]*from\s+"@\/(lib\/stores\/|db\b|db\/|lib\/users"|lib\/task-plan\/load"|lib\/task-plan\/write")/m.test(readFileSync(f, "utf8"));
  ok(["src/app/(app)/calendar/task-block-layer.tsx", "src/app/(app)/calendar/task-block-popover.tsx", "src/components/task-plan/tier-size-chips.tsx", "src/lib/task-plan/calendar-view.ts"].every(noDb),
    "auto-cal view: client files never import a module that reaches the database");
  // Viewer rules: pin controls are only for the plan's owner or an admin (the server enforces it too).
  const asOther = calendarPlanView([{ userId: "u1", name: "Dana", note: null, result: r }], { minMs: at(MON, 0), maxMs: at(TUE, 23), initials: () => "DA", viewer: { id: "u2", admin: false } });
  const asOwner = calendarPlanView([{ userId: "u1", name: "Dana", note: null, result: r }], { minMs: at(MON, 0), maxMs: at(TUE, 23), initials: () => "DA", viewer: { id: "u1", admin: false } });
  const asAdmin = calendarPlanView([{ userId: "u1", name: "Dana", note: null, result: r }], { minMs: at(MON, 0), maxMs: at(TUE, 23), initials: () => "DA", viewer: { id: "u2", admin: true } });
  ok(asOther.blocks.every((b) => !b.canUnpin && !b.draggable) && asOther.blocks.length === view.blocks.length, "auto-cal view: someone else's blocks can't be unpinned or dragged by a non-admin");
  ok(asOwner.blocks.find((b) => b.itemKey === "task:P")?.canUnpin === true && asAdmin.blocks.find((b) => b.itemKey === "task:P")?.draggable === true, "auto-cal view: the owner and an admin keep the controls");
  const noteView = calendarPlanView([{ userId: "u1", name: "Dana", note: GOOGLE_NOTE_ME, result: r }, { userId: "u2", name: "Sam", note: GOOGLE_NOTE_ME, result: r }], { minMs: at(MON, 0), maxMs: at(TUE, 23), initials: () => "X" });
  ok(noteView.notes.length === 1 && noteView.notes[0] === "Planned without your Google calendar — may overlap meetings", "auto-cal view: the Google note shows once, verbatim");
  const note = (n: string, name: string, id: string) => ({ userId: id, name, note: n, result: r });
  const opts = { minMs: at(MON, 0), maxMs: at(TUE, 23), initials: () => "X" };
  const other = (n: string) => `Planned without ${n}'s Google calendar — may overlap meetings`;
  ok(calendarPlanView([note(other("Dana"), "Dana", "u1")], opts).notes.join() === "Planned without Dana's Google calendar — may overlap meetings",
    "auto-cal view: one other person's Google note stays as it is");
  ok(calendarPlanView([note(other("Dana"), "Dana", "u1"), note(other("Sam"), "Sam", "u2"), note(other("Lee"), "Lee", "u3")], opts).notes.join() === "Planned without Google calendars for Dana, Sam, Lee — may overlap meetings",
    "auto-cal view: Everyone collapses several Google notes into one line naming them");
  const mixed = calendarPlanView([note(GOOGLE_NOTE_ME, "Me", "u0"), note(other("Sam"), "Sam", "u2"), note("Something else", "Lee", "u3"), note("Something else", "Kim", "u4")], opts);
  ok(mixed.notes.length === 2 && mixed.notes.includes("Planned without Google calendars for Me, Sam — may overlap meetings") && mixed.notes.includes("Something else"),
    "auto-cal view: the collapse covers the viewer's own note too; other notes still show once");
  // The failed-load composition (note + fallback chips + skip the save) is one pure helper.
  const okPlans = [{ userId: "u1", name: "Dana", note: null, result: r }];
  const good = composeCalendarPlan(okPlans, opts);
  ok(good.toSave === okPlans && good.view.blocks.length > 0 && !good.view.notes.includes(PLAN_FAILED_NOTE), "auto-cal view: a loaded plan is drawn and its pins are saved");
  const failed = composeCalendarPlan(null, opts);
  ok(failed.toSave.length === 0 && failed.view.blocks.length === 0 && failed.view.plannedKeys.length === 0 && failed.view.atRisk.length === 0 && failed.view.notes.join() === PLAN_FAILED_NOTE,
    "auto-cal view: a failed plan load draws nothing planned (old due-day chips stay), shows the note and saves nothing");
  const failedChips = monthChips(tasks, failed.view, { ...range, rangeEnd: localDayKey(at(FRI, 23)) });
  ok(failedChips.some((c) => c.item.id === "A" && c.dayKey === localDayKey(at(FRI, 17))) && failedChips.some((c) => c.item.id === "BLK") && stripTasks(tasks, failed.view).length === tasks.length, "auto-cal view: with no plan every task keeps its due-day chip");
  ok(/composeCalendarPlan\(/.test(page) && !/PLAN_FAILED_NOTE/.test(page), "auto-cal view: the page uses the pure helper for the failed-load note");
  // Keyboard "Move to…" input <-> ms (local time, 15-minute steps).
  const mv = new Date(2036, 9, 14, 10, 0).getTime();
  ok(msToLocalInput(mv) === "2036-10-14T10:00" && localInputToMs("2036-10-14T10:00") === mv && localInputToMs("2036-10-14T10:07") === mv && localInputToMs("2036-10-14T10:08") === mv + 15 * MIN,
    "auto-cal view: Move to… reads and writes local time in 15-minute steps");
  ok(localInputToMs("") === null && localInputToMs("2036-02-31T10:00") === null && localInputToMs("nope") === null, "auto-cal view: Move to… refuses a blank or impossible time");
  ok(dragStartMs({ startMs: at(MON, 9), dyPx: 24, dxPx: 0, hourPx: 48, colPx: 100, dayCount: 7 }) === at(MON, 9, 30)
    && dragStartMs({ startMs: at(MON, 9), dyPx: 0, dxPx: 210, hourPx: 48, colPx: 100, dayCount: 7 }) === at(MON, 9) + 2 * 86_400_000
    && dragStartMs({ startMs: at(MON, 9), dyPx: 0, dxPx: 210, hourPx: 48, colPx: 100, dayCount: 1 }) === at(MON, 9),
    "auto-cal view: a drag snaps to 15 minutes and whole days (Week only)");
  ok(/Couldn.t load the task plan/.test(PLAN_FAILED_NOTE) && /\.catch\(\(err\) => \{\s*console\.error\("\[task-plan\] calendar plan failed:", err\);\s*return null;/.test(page), "auto-cal view: a failed plan load shows a clear message and the page still renders");
  ok(/viewer:/.test(page) && /can\("manage_users"/.test(page), "auto-cal view: the page tells the view who is looking (owner or admin only)");
  ok(/disabled=\{pending\}/.test(readFileSync("src/app/(app)/calendar/task-block-popover.tsx", "utf8")), "auto-cal view: the popover disables its actions while one is pending");
}

/* ---- Task 10: drag + At risk panel ---- */
export async function autoCalDragPanelChecks(ok: Ok): Promise<void> {
  const s = new Date(2036, 9, 14, 10, 0).getTime();
  ok(dragStartMs({ startMs: s, dyPx: 72, dxPx: 0, hourPx: 48, colPx: 100, dayCount: 7 }) === new Date(2036, 9, 14, 11, 30).getTime(), "auto-cal drag: dragging down 1.5 hours moves the block 1.5 hours");
  ok(dragStartMs({ startMs: s, dyPx: 13, dxPx: 0, hourPx: 48, colPx: 100, dayCount: 7 }) === new Date(2036, 9, 14, 10, 15).getTime(), "auto-cal drag: drops snap to 15 minutes");
  ok(dragStartMs({ startMs: s, dyPx: 0, dxPx: 160, hourPx: 48, colPx: 100, dayCount: 7 }) === new Date(2036, 9, 16, 10, 0).getTime() &&
     dragStartMs({ startMs: s, dyPx: 0, dxPx: 160, hourPx: 48, colPx: 100, dayCount: 1 }) === s,
    "auto-cal drag: sideways moves whole days in Week view, never in Day view");
  const layer = readFileSync("src/app/(app)/calendar/task-block-layer.tsx", "utf8");
  ok(/onPointerDown/.test(layer) && /pinBlockAction\(/.test(layer) && /pinArgs\(/.test(layer) && /fromStartMs: block\.pinned \? block\.startMs : null/.test(readFileSync("src/lib/task-plan/calendar-view.ts", "utf8")), "auto-cal drag: dropping a block pins it (moving a pin replaces it)");
  ok(/if \(!b\.draggable\)/.test(layer) && /disabled=\{busy\}/.test(layer) && /aria-label=/.test(layer), "auto-cal drag: only draggable blocks drag, drags are off while any action is pending, blocks are labelled");
  ok(/if \(!r\.ok\) \{[^}]*setError\(r\.error\);\s*\}\s*\/\/[^\n]*\n\s*router\.refresh\(\)/.test(layer), "auto-cal drag: a refused or stale move (\"That block moved — refresh.\") shows the message and refreshes the view");
  const panel = readFileSync("src/app/(app)/calendar/at-risk-panel.tsx", "utf8");
  ok(["Push due date", "Hand off", "Unpin something"].every((t) => panel.includes(t)) && /pushDueDateAction\(/.test(panel) && /handOffAction\(/.test(panel) && /unpinBlockAction\(/.test(panel),
    "auto-cal at risk: the panel's three one-click fixes");
  const client = readFileSync("src/app/(app)/calendar/calendar-client.tsx", "utf8");
  ok(client.includes("<AtRiskPanel") && !/void roster/.test(client), "auto-cal at risk: the panel shows on /calendar");
  const pop = readFileSync("src/app/(app)/calendar/task-block-popover.tsx", "utf8");
  ok(/\.focus\(/.test(pop) && /previouslyFocused|returnFocus/.test(pop) && /Move to/.test(pop), "auto-cal drag: the popover takes focus, gives it back on close, and offers a keyboard Move to…");
  const noDb = (f: string) => !/^import\s+(?!type\b)[^;]*from\s+"@\/(lib\/stores\/|db\b|db\/|lib\/users"|lib\/task-plan\/load"|lib\/task-plan\/write"|lib\/task-plan\/backfill")/m.test(readFileSync(f, "utf8"));
  ok(["src/app/(app)/calendar/at-risk-panel.tsx", "src/app/(app)/calendar/task-block-layer.tsx", "src/app/(app)/calendar/task-block-popover.tsx"].every(noDb), "auto-cal drag: the new client files import pure modules only");
}

/* ---- Task 11: Home Today card + Task 10 polish ---- */
export async function autoCalHomeChecks(ok: Ok): Promise<void> {
  ok(widgetDef("today-plan")?.title === "Today" && !!widgetDef("today-plan")?.surfaces.includes("home") && presetFor("home", ["Admin"]).includes("today-plan"),
    "auto-cal home: a Today card on Home");
  const home = presetFor("home", ["Admin"]);
  ok(home.indexOf("today-plan") === home.indexOf("my-queue") + 1, "auto-cal home: the Today card sits right after My Queue");
  const r = planPerson(baseInput({ items: [item("A"), item("B", { createdAt: 2 })] }));
  const rows = todayRows(r, at(MON, 7));
  ok(rows.length === 2 && rows[0].time === "8:00–9:00" && rows[1].time === "9:00–10:00" && rows.every((x) => !x.pinned && !x.atRisk), "auto-cal home: today's blocks in order with their times");
  ok(todayRows(r, at(TUE, 7)).length === 0, "auto-cal home: only today's blocks");
  const cards = readFileSync("src/app/(app)/_dashboard/widgets/home-cards.tsx", "utf8");
  const today = readFileSync("src/app/(app)/home-today.tsx", "utf8");
  ok(cards.includes('"today-plan"') && /savePlanPins\(/.test(cards) && today.includes("/calendar?view=day"),
    "auto-cal home: the card links to the day view and saves the plan's pins");
  const data = readFileSync("src/lib/dashboard/data.ts", "utf8");
  ok(/taskPlan: once\(/.test(data) && /\.catch\(/.test(data) && /calendarTimeoutMs/.test(data), "auto-cal home: one plan per Home render, a failed load never crashes Home, the Google read is bounded");
  ok(/Couldn.t load today/.test(today) && /failed: true/.test(cards), "auto-cal home: a failed plan load shows a small note");

  // Task 10 polish
  const block = { kind: "task" as const, id: "t1", pinned: "hand" as const, startMs: at(MON, 9), endMs: at(MON, 10) };
  const a = pinArgs(block, at(MON, 11));
  ok(a.kind === "task" && a.id === "t1" && a.fromStartMs === at(MON, 9) && a.startMs === at(MON, 11) && a.minutes === 60, "auto-cal polish: pinArgs carries the block's own start when pinned and its length");
  ok(pinArgs({ ...block, pinned: null }, at(MON, 11)).fromStartMs === null, "auto-cal polish: pinArgs from an unpinned block moves nothing");
  ok(typeof clockText(at(MON, 9)) === "string" && /9:00/.test(clockText(new Date(2036, 9, 13, 9, 0).getTime())), "auto-cal polish: one shared clock formatter");
  const layer = readFileSync("src/app/(app)/calendar/task-block-layer.tsx", "utf8");
  ok(/e\.button === 0 && e\.isPrimary/.test(layer) || (/e\.button !== 0/.test(layer) && /isPrimary/.test(layer)), "auto-cal polish: only the primary button starts a drag");
  ok(/onPointerUp[\s\S]*clientX/.test(layer) && /addEventListener\("keydown"/.test(layer), "auto-cal polish: the drop uses the pointer-up position; a window Escape cancels a drag");
  ok(/onBusy\?\.\(false\)/.test(layer) && /onBusy\?\.\(false\)/.test(readFileSync("src/app/(app)/calendar/at-risk-panel.tsx", "utf8")), "auto-cal polish: shared busy state resets on unmount");
  const panel = readFileSync("src/app/(app)/calendar/at-risk-panel.tsx", "utf8");
  ok(panel.includes("Hand off to…") && /disabled=\{off \|\| !target\}/.test(panel), "auto-cal polish: Hand off waits for a chosen person");
  ok(/BLOCK_MOVED_ERROR/.test(readFileSync("src/app/(app)/calendar/task-block-popover.tsx", "utf8")) && /BLOCK_MOVED_ERROR = "That block moved — refresh\."/.test(readFileSync("src/lib/task-plan/types.ts", "utf8")), "auto-cal polish: the popover closes when a move finds the block moved");
  ok(/pinArgs\(/.test(layer) && /pinArgs\(/.test(readFileSync("src/app/(app)/calendar/task-block-popover.tsx", "utf8")), "auto-cal polish: layer and popover share pinArgs");
}

/* ---- Task 12: task forms + Task 11 review add-ons ---- */
export async function autoCalFormChecks(ok: Ok): Promise<void> {
  const args = (priority: string, size: string) => ({
    req: { threadId: "C-1", title: "Call back", notes: "", assigneeUserId: "u1", dueDate: "", linkKeys: [], priority, size },
    candidates: [{ key: "thread", kind: "thread" as const, id: "C-1" }],
    workLabel: "",
    roster: [{ id: "u1", name: "Dana" }],
    me: { id: "u1", name: "Dana" },
  });
  const built = buildThreadTaskInput(args("high", "l"));
  ok(built.ok && built.input.priority === "high" && built.input.size === "l", "auto-cal forms: the email-task dialog's chips reach the task");
  const junk = buildThreadTaskInput(args("urgent", ""));
  ok(junk.ok && !("priority" in junk.input) && !("size" in junk.input), "auto-cal forms: junk chip values are ignored");
  const rd = (f: string) => readFileSync(f, "utf8");
  for (const f of ["src/components/tasks-card.tsx", "src/app/(app)/inbox/task-dialog.tsx", "src/app/(app)/recordings/[id]/detail-client.tsx", "src/app/(app)/queue/view.tsx", "src/app/(app)/calendar/task-block-popover.tsx"]) {
    ok(rd(f).includes("<TierSizeChips"), `auto-cal forms: ${f} offers High/Normal/Low and S/M/L`);
  }
  for (const f of ["src/app/(app)/projects/actions.ts", "src/app/(app)/estimator/actions.ts", "src/app/(app)/design/designs/actions.ts"]) {
    ok((rd(f).match(/readTierSize\(formData\)/g) ?? []).length >= 2, `auto-cal forms: ${f} reads the chips on add and on edit`);
  }
  ok(/priority: input\?\.priority/.test(rd("src/app/(app)/queue/actions.ts")) && /priority: tierSize\?\.priority/.test(rd("src/lib/krisp/write-back.ts")),
    "auto-cal forms: Queue and meeting to-dos pass the chips to createAssignment");
  ok(rd("src/app/(app)/inbox/task-dialog.tsx").includes("due in a week"), "auto-cal forms: the email-task help text says a blank date means due in a week");

  // Task 11 review add-ons
  const cards = rd("src/app/(app)/_dashboard/widgets/home-cards.tsx");
  ok(/<Suspense[^>]*fallback=/.test(cards) && /<TodayPlanCard\b/.test(cards) && /async function TodayPlanCard/.test(cards),
    "auto-cal addons: the Home Today card streams behind a Suspense boundary");
  const body = cards.slice(cards.indexOf("async function TodayPlanCard"), cards.indexOf("const TODAY_FALLBACK"));
  ok(/try \{[\s\S]*await ctx\.data\.taskPlan\(\)[\s\S]*after\(\(\) => savePlanPins[\s\S]*\} catch/.test(body) && /Planning today/.test(cards),
    "auto-cal addons: the streamed Today card catches its own load failure and shows a planning fallback");
  const layer = rd("src/app/(app)/calendar/task-block-layer.tsx");
  const move = layer.slice(layer.indexOf("onPointerMove"), layer.indexOf("onPointerUp"));
  ok(/if \(!e\.isPrimary\) return;/.test(move), "auto-cal addons: a second finger's pointer-move never steers a drag");
  const up = layer.slice(layer.indexOf("onPointerUp"), layer.indexOf("onPointerCancel"));
  ok(/if \(!e\.isPrimary\) return;/.test(up), "auto-cal addons: a second finger's pointer-up never drops a drag");
  const panel = rd("src/app/(app)/calendar/at-risk-panel.tsx");
  ok(/others\.some\(\(u\) => u\.id === handTo\[a\.itemKey\]\)/.test(panel), "auto-cal addons: a stored hand-off pick that left the list reads as empty");
  const data = rd("src/lib/dashboard/data.ts");
  ok(/status: "none"/.test(data) && /status: "failed"/.test(data) && /status: "ok"/.test(data), "auto-cal addons: taskPlan() tells no plan from a failed load");
}

/* ---- Final review: "nobody clicks Done" (D796–D797) ----
   Adapted from the final reviewer's simulation: 15 work days, the plan
   computed 6 times a day, nothing ever marked Done. Before the fix every
   still-open item got a locked 30-minute remainder each morning forever, the
   day filled with locked slivers, pins grew ~17 a day, and a new High task
   due tomorrow landed behind them, At risk. */
type DoneSim = {
  /** stored pins after the run */
  pins: Map<string, PlanPin>;
  /** minutes pinned AHEAD of the compute (startMs > now) per item, over the whole run */
  lockedAhead: Map<string, number>;
  /** pins added per work day */
  addedPerDay: number[];
  /** the High task's first block and At risk state on the day it arrives (7 am compute) */
  urgent: { startMs: number | null; atRisk: boolean; dayKey: string };
  /** items (URGENT aside) whose stored pins already cover their whole size, on the day URGENT arrives (before its first compute) */
  finishedSizeAtUrgent: number;
  computes: number;
};
const SIM_VIEWS = [7 * 60, 9 * 60 + 5, 10 * 60 + 35, 12 * 60, 14 * 60 + 5, 16 * 60 + 5];

/** `save` decides what a compute persists (the owner's view saves all; a cron save goes through savePlanPins). */
async function nobodyClicksDone(opts: { items: number; dueOffsetDays: number; workDays?: number; seedFullSizePins?: boolean; save: (plan: PersonPlan, store: PinStore) => Promise<void> }): Promise<DoneSim> {
  const WORK_DAYS = opts.workDays ?? 15;
  const START = MON;
  const items: PlanItem[] = Array.from({ length: opts.items }, (_, i) =>
    item("N" + i, { userId: "u1", dueMs: dueStampForDay(addDays(START, opts.dueOffsetDays + i)), createdAt: i })
  );
  const pins = new Map<string, PlanPin>();
  const store: PinStore = {
    add: async (_u, ps) => {
      for (const p of ps) pins.set(pinBlobKey(p), p);
    },
    remove: async (_u, ks) => {
      for (const k of ks) pins.delete(k);
    },
  };
  if (opts.seedFullSizePins) {
    // each item already worked for its whole size on an earlier day (8 one-hour pins a day, the week before START)
    items.forEach((it, i) => {
      const day = addDays(START, -1 - Math.floor(i / 8));
      const startMs = chicagoWallMs(day, 8 * 60 + (i % 8) * 60);
      const p: PlanPin = { itemKey: it.key, startMs, endMs: startMs + it.sizeMin * MIN, kind: "started" };
      pins.set(pinBlobKey(p), p);
    });
  }
  const lockedAhead = new Map<string, number>();
  const addedPerDay: number[] = [];
  const urgent = { startMs: null as number | null, atRisk: false, dayKey: "" };
  let finishedSizeAtUrgent = 0;
  let computes = 0;
  for (let day = START, wd = 0; wd < WORK_DAYS; day = addDays(day, 1)) {
    if (weekdayOf(day) === 0 || weekdayOf(day) === 6) continue;
    wd++;
    if (wd === WORK_DAYS) {
      finishedSizeAtUrgent = items.filter((it) => [...pins.values()].filter((p) => p.itemKey === it.key).reduce((s, p) => s + (p.endMs - p.startMs) / MIN, 0) >= it.sizeMin).length;
      items.push(item("URGENT", { userId: "u1", tier: "high", dueMs: dueStampForDay(addDays(day, 1)), createdAt: 999 }));
    }
    const before = pins.size;
    for (const m of SIM_VIEWS) {
      const nowMs = chicagoWallMs(day, m);
      const result = planPerson({ userId: "u1", nowMs, hours: DEFAULT_WORK_HOURS, busy: [], pins: [...pins.values()], items });
      computes++;
      if (wd === WORK_DAYS && m === SIM_VIEWS[0]) {
        urgent.startMs = blocksOf(result, "task:URGENT")[0]?.startMs ?? null;
        urgent.atRisk = result.atRisk.some((a) => a.itemKey === "task:URGENT");
        urgent.dayKey = day;
      }
      const keys = new Set(pins.keys());
      await opts.save({ userId: "u1", name: "Dana", calendar: "ok", note: null, result, items }, store);
      for (const p of pins.values()) {
        if (!keys.has(pinBlobKey(p)) && p.startMs > nowMs) lockedAhead.set(p.itemKey, (lockedAhead.get(p.itemKey) ?? 0) + (p.endMs - p.startMs) / MIN);
      }
    }
    addedPerDay.push(pins.size - before);
  }
  return { pins, lockedAhead, addedPerDay, urgent, finishedSizeAtUrgent, computes };
}

export async function autoCalNobodyDoneChecks(ok: Ok): Promise<void> {
  const owner = (plan: PersonPlan, store: PinStore) => savePlanPins([plan], { persistStartedFor: "u1", store });
  for (const [n, off] of [[16, 25], [25, 3]] as const) {
    const r = await nobodyClicksDone({ items: n, dueOffsetDays: off, save: owner });
    const maxAhead = Math.max(0, ...r.lockedAhead.values());
    ok(r.computes === 90 && maxAhead <= 60,
      `auto-cal nobody-done (${n} tasks, owner views 6×/day × 15 days): no item is ever locked ahead beyond its size (max ${maxAhead} min, size 60)`);
    ok(r.addedPerDay.every((x) => x <= SIM_VIEWS.length) && r.addedPerDay.slice(5).every((x) => x <= Math.max(...r.addedPerDay.slice(0, 5))),
      `auto-cal nobody-done (${n} tasks): pins per day stay bounded — about one per compute a block began at, no growth after week 1 (${r.addedPerDay.join(" ")})`);
  }
  const roomy = await nobodyClicksDone({ items: 16, dueOffsetDays: 25, save: owner });
  ok(roomy.urgent.startMs != null && chicagoDayKey(roomy.urgent.startMs) === roomy.urgent.dayKey && !roomy.urgent.atRisk,
    `auto-cal nobody-done: a High task due tomorrow, added on day 15, is planned TODAY and isn't At risk (${roomy.urgent.startMs ? fmtBlockTime(roomy.urgent.startMs, roomy.urgent.startMs + 3_600_000) : "not placed"})`);

  // Overloaded (D805): every one of 25 tasks is overdue AND already pinned for its whole size, so each gets a daily
  // fresh 30-min chunk (D796). Those chunks queue AFTER all work that still has size left, so the new High task due
  // tomorrow still lands TODAY on the owner's 7 am view — not behind 25 overdue chunks for weeks.
  const overloaded = await nobodyClicksDone({ items: 25, dueOffsetDays: -20, workDays: 5, seedFullSizePins: true, save: owner });
  ok(overloaded.finishedSizeAtUrgent === 25,
    `auto-cal nobody-done (overloaded): all 25 overdue tasks are pinned for their whole size before the High task arrives (${overloaded.finishedSizeAtUrgent}/25)`);
  ok(overloaded.urgent.startMs != null && chicagoDayKey(overloaded.urgent.startMs) === overloaded.urgent.dayKey && !overloaded.urgent.atRisk,
    `auto-cal nobody-done (overloaded): with 25 overdue finished-size tasks, a High task due tomorrow added on day 5 is planned TODAY at the 7 am view, not At risk (${overloaded.urgent.startMs ? fmtBlockTime(overloaded.urgent.startMs, overloaded.urgent.startMs + 3_600_000) : "not placed"})`);

  // The triage cron (and anyone else's view) computes just as often but never locks anything.
  const cron = await nobodyClicksDone({ items: 16, dueOffsetDays: 25, save: (plan, store) => savePlanPins([plan], { persistStartedFor: null, store }) });
  const other = await nobodyClicksDone({ items: 16, dueOffsetDays: 25, save: (plan, store) => savePlanPins([plan], { persistStartedFor: "u2", store }) });
  ok(cron.pins.size === 0 && other.pins.size === 0, "auto-cal nobody-done: 90 cron computes, or 90 computes on someone else's view, persist zero started pins (D797)");
  ok(!cron.urgent.atRisk && cron.urgent.startMs != null, "auto-cal nobody-done: with nothing locked, the new High task is planned and not At risk");
}
