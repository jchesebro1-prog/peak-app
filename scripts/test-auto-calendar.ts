/* Auto task calendar — spec checks
   (docs/superpowers/specs/2026-10-09-auto-task-calendar-design.md).
   Chained from test-review-and-spec.ts. */
import { readFileSync } from "node:fs";
import { createTask, getTask, normalizeTask, updateTask, type TaskRecord } from "@/lib/stores/tasks";
import { createAssignment, getAssignment, updateAssignment } from "@/lib/stores/assignments";
import { triageKey } from "@/lib/triage/keys";
import { tierOf } from "@/lib/triage/feeds/tasks";
import { chicagoWallMs } from "@/lib/visit-plan/hours";
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
