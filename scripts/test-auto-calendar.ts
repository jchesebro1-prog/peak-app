/* Auto task calendar — spec checks
   (docs/superpowers/specs/2026-10-09-auto-task-calendar-design.md).
   Chained from test-review-and-spec.ts. */
import { readFileSync } from "node:fs";
import { autoTaskId, createAutoTask, createTask, createTaskOnce, getTask, normalizeTask, updateTask, type TaskRecord } from "@/lib/stores/tasks";
import { allAssignments, createAssignment, getAssignment, updateAssignment, type Assignment } from "@/lib/stores/assignments";
import { upsertDoc } from "@/db/doc-store";
import { triageKey } from "@/lib/triage/keys";
import { tierOf } from "@/lib/triage/feeds/tasks";
import { chicagoDayKey, chicagoDayStart } from "@/lib/drive-plan/day";
import { chunkFor, freeDays } from "@/lib/task-plan/free";
import { atRiskLabel, calendarNote, finishText, fmtBlockTime, GOOGLE_NOTE_ME, NOT_PLACED_TEXT } from "@/lib/task-plan/labels";
import { planPerson } from "@/lib/task-plan/plan";
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
import { runDueBackfill, setAssignmentDue, setTaskDue } from "@/lib/task-plan/backfill";
import { readTierSize } from "@/lib/task-plan/fields";
import {
  cleanSize,
  cleanTier,
  parsePlanItemKey,
  planItemKey,
  QUARTER_MS,
  SIZE_MIN,
  sizeMinutes,
  tierOrDefault,
  type PlanInput,
  type PlanItem,
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
  ok(v.virtual && v.dueMs === defaultDueAt(at(MON, 9)) && !effectiveDue(at(FRI, 12), 1).virtual, "auto-cal due: an undated item plans as if due 7 days after it was created");

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
  const undated = planPerson(baseInput({ items: [item("undated", { dueMs: 0, dueVirtual: true, createdAt: at(MON, 6) }), item("dated", { dueMs: at(TUE, 17), createdAt: 5 })] }));
  ok(undated.blocks[0].itemKey === "task:dated" && blocksOf(undated, "task:undated")[0]?.dueMs === defaultDueAt(at(MON, 6)) && !undated.atRisk.some((a) => a.itemKey === "task:undated"),
    "auto-cal plan: an undated item plans by its effective due (created + 7), never as overdue");
  const nothing = planPerson(baseInput({ items: [item("zero", { sizeMin: 0 })] }));
  ok(nothing.blocks.length === 0 && nothing.atRisk.length === 0, "auto-cal plan: an item with nothing left to place isn't flagged");

  const late20 = { days: EVERY_DAY, startMin: 20 * 60, endMin: 1440 };
  const mid = planPerson(baseInput({ hours: late20, fillRatio: 1, items: [item("A", { size: "l", sizeMin: 240 })] }));
  ok(mid.blocks.length === 1 && mid.blocks[0].startMs === at(MON, 20) && mid.blocks[0].endMs === chicagoDayStart(TUE) && fmtBlockTime(mid.blocks[0].startMs, mid.blocks[0].endMs) === "8:00–12:00",
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
