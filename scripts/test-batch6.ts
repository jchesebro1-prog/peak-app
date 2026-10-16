/* Jeff's 2026-10-15 decisions — Batch 6 harness checks (docs/decisions/2026-10-15-jeff-decisions.md
   Round 2 items 64–68, plus the addFieldTask overwrite fix).
   `batch6PureChecks` needs no database; `batch6DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-batch6.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { FIELD_TASK_ID_RE, fieldTaskIdDecision } from "../src/lib/stores/tasks";

const ROOT = join(__dirname, "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* --- Bug fix: addFieldTask could overwrite any task by id --- */
function fieldTaskPureChecks(ok: Ok) {
  const me = { id: "u1" };
  ok(FIELD_TASK_ID_RE.test("tk-a1b2c3") && !FIELD_TASK_ID_RE.test("T-6001") && !FIELD_TASK_ID_RE.test("T-auto-x") && !FIELD_TASK_ID_RE.test("tk-") && !FIELD_TASK_ID_RE.test("tk-AB/../x"),
    "fieldtask: only a Field Work id (tk- + base36) is accepted from the client");
  ok(fieldTaskIdDecision("", null, me, "P-1") === "server", "fieldtask: no client id → the server allocates the id");
  ok(fieldTaskIdDecision("T-6001", null, me, "P-1") === "refuse", "fieldtask: an office id (T-6001) is refused, never written");
  ok(fieldTaskIdDecision("tk-abc123", null, me, "P-1") === "insert", "fieldtask: a free Field Work id is inserted");
  const mine = { projectId: "P-1", section: "Install", assigneeUserId: "u1" };
  ok(fieldTaskIdDecision("tk-abc123", mine, me, "P-1") === "same", "fieldtask: the caller's own capture arriving again is idempotent");
  ok(fieldTaskIdDecision("tk-abc123", { ...mine, assigneeUserId: "u2" }, me, "P-1") === "refuse", "fieldtask: someone else's task under that id is refused");
  ok(fieldTaskIdDecision("tk-abc123", mine, me, "P-2") === "refuse", "fieldtask: another project's task under that id is refused");
  ok(fieldTaskIdDecision("tk-abc123", { ...mine, section: "Office" }, me, "P-1") === "refuse", "fieldtask: a non-Install task under that id is refused");
  ok(fieldTaskIdDecision("tk-abc123", mine, { id: "" }, "P-1") === "refuse", "fieldtask: no caller id never matches");
  const act = src("src/app/(app)/field-work/actions.ts");
  ok(act.includes("createFieldTask({ clientId, title, projectId }, me)") && !/createTask\(\s*\{\s*id:/.test(act), "fieldtask: addFieldTask goes through createFieldTask, never createTask({ id })");
}

async function fieldTaskDbChecks(ok: Ok) {
  const T = await import("../src/lib/stores/tasks");
  const { registerFixture } = await import("./test-fixtures");
  const me = { id: "u-b6", name: "Batch Six" };
  const other = { id: "u-b6b", name: "Other Person" };
  // An office task that the old code would have replaced.
  const office = await T.createTask({ title: "Office task — must survive", section: "" }, other);
  registerFixture("tasks", office.id);
  const hit = await T.createFieldTask({ clientId: office.id, title: "Overwrite attempt", projectId: "P-b6" }, me);
  const after = await T.getTask(office.id);
  ok(!hit.ok && after?.title === "Office task — must survive" && after.createdBy === "Other Person", "fieldtask db: an office id is refused and the office task is unchanged");

  const id = "tk-b6x" + Math.random().toString(36).slice(2, 6);
  registerFixture("tasks", id);
  const a = await T.createFieldTask({ clientId: id, title: "Hang borders", projectId: "P-b6" }, me);
  ok(a.ok && a.task.id === id && a.task.assigneeUserId === "u-b6" && a.task.section === "Install", "fieldtask db: a fresh Field Work id inserts, assigned to the caller");
  await T.setTaskStatus(id, "done");
  const again = await T.createFieldTask({ clientId: id, title: "Hang borders", projectId: "P-b6" }, me);
  ok(again.ok && (await T.getTask(id))?.status === "done", "fieldtask db: a retry of the same push is idempotent and never resets the stored row");
  const theirs = await T.createFieldTask({ clientId: id, title: "Hijack", projectId: "P-b6" }, other);
  ok(!theirs.ok && (await T.getTask(id))?.title === "Hang borders", "fieldtask db: another user reusing the id is refused, the row is unchanged");
  const otherProj = await T.createFieldTask({ clientId: id, title: "Hijack", projectId: "P-b6-other" }, me);
  ok(!otherProj.ok, "fieldtask db: the same id on another project is refused");
  const srv = await T.createFieldTask({ clientId: "", title: "Server id", projectId: "P-b6" }, me);
  if (srv.ok) registerFixture("tasks", srv.task.id);
  ok(srv.ok && /^T-\d+$/.test(srv.task.id), "fieldtask db: no client id gets a server-allocated T-#### id");
}

export async function batch6PureChecks(ok: Ok) {
  fieldTaskPureChecks(ok);
}

export async function batch6DbChecks(ok: Ok) {
  await fieldTaskDbChecks(ok);
}

if (process.argv[1]?.endsWith("test-batch6.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  batch6PureChecks(okf)
    .then(() => (db ? batch6DbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
