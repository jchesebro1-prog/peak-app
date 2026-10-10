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
  SIZE_MIN,
  sizeMinutes,
  tierOrDefault,
  type PlanItem,
} from "@/lib/task-plan/types";
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
