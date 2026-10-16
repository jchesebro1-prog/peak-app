/* Jeff's 2026-10-15 decisions — Batch 6 harness checks (docs/decisions/2026-10-15-jeff-decisions.md
   Round 2 items 64–68, plus the addFieldTask overwrite fix).
   `batch6PureChecks` needs no database; `batch6DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-batch6.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { FIELD_TASK_ID_RE, fieldTaskIdDecision } from "../src/lib/stores/tasks";
import { sourcingReport, sourcingCsv, sortForNoCost, type SourcingPart } from "../src/lib/sourcing-report";

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

/* --- #66 most-quoted products / projected sourcing --- */
function sourcingChecks(ok: Ok) {
  const parts = new Map<string, SourcingPart>([
    ["ETC:S4", { sku: "ETC:S4", mfr: "ETC", desc: "Source Four", cost: 200, manufacturerModelNumber: "Source Four 750" }],
    ["ETC:LAMP", { sku: "ETC:LAMP", mfr: "ETC", desc: "Lamp", cost: 20 }],
    ["Shure:SM58", { sku: "Shure:SM58", mfr: "Shure", desc: "Mic", cost: 100 }],
    ["doc-id-58", { sku: "Shure:SM58", mfr: "Shure", desc: "Mic", cost: 100 }],
    ["RACK-PANEL", { sku: "RACK-PANEL", mfr: "Middle Atlantic", desc: "Panel", cost: 30 }],
  ]);
  const sec = (items: unknown[], extra: Record<string, unknown> = {}) => ({ id: "s", name: "S", items, ...extra });
  const q = (id: string, status: string, spec: unknown) => ({ id, status, spec });
  const quotes = [
    q("Q1", "sent", { sections: [sec([
      { sku: "ETC:S4", qty: 4, cost: 180, price: 300 },
      { sku: "BONUS", qty: 1, cost: 50, bonus: "package" },
      { sku: "ETC:S4", qty: 9, cost: 180, option: true },
      { sku: "LAB", qty: 8, cost: 50, labor: true },
      { sku: "ASM-1", qty: 2, fixture: true, components: [{ sku: "ETC:S4", qty: 1, cost: 150, role: "fixture" }, { sku: "ETC:LAMP", qty: 2, cost: 15 }] },
    ]), sec([{ sku: "Shure:SM58", qty: 50, cost: 100 }], { alternate: true }), sec([{ sku: "ETC:S4", qty: 99, cost: 1 }], { kind: "labor" })] }),
    q("Q2", "draft", { lines: [{ sku: "doc-id-58", qty: 3 }, { sku: "allow:x", qty: 1 }, { sku: "asm:R1", qty: 1 }] }),
    q("Q3", "won", { sections: [sec([{ sku: "ETC:S4", qty: 100, cost: 180 }])] }),
    q("Q4", "lost", { sections: [sec([{ sku: "Shure:SM58", qty: 100, cost: 100 }])] }),
    q("Q5", "draft", { sections: [sec([{ sku: "CUSTOM", qty: 1, cost: 10 }])] }),
  ];
  const fixtureOf = (id: string) => (id === "R1" ? ({ id: "R1", kind: "system", label: "R", lightEngineSku: "", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] }, parts: [{ sku: "RACK-PANEL", qty: 2 }] } as never) : null);
  const rates: Record<string, number> = { etc: 0.5, shure: 0.25 };
  const rep = sourcingReport(quotes, parts, { rateFor: (k) => rates[k] ?? 0.1, fixtureOf });
  const s4 = rep.parts.find((r) => r.sku === "ETC:S4");
  ok(!!s4 && s4.qty === 6 && s4.estimates === 1, "#66: Source Four counts its own line (4) + the assembly's member (2 × 1); options, bonus, labor and won/lost quotes are left out");
  ok(!!s4 && s4.weightedQty === 3 && s4.weightedCost === (4 * 180 + 2 * 150) * 0.5, "#66: weighted qty / cost = qty / cost × the manufacturer's win rate (a member at its component's quoted cost)");
  ok(s4?.model === "Source Four 750", "#66: the part column is the Model # (#304 partModel)");
  const lamp = rep.parts.find((r) => r.sku === "ETC:LAMP");
  ok(!!lamp && lamp.qty === 4 && lamp.weightedCost === 4 * 15 * 0.5, "#66: an assembly's members count (qty × line qty)");
  const mic = rep.parts.find((r) => r.sku === "Shure:SM58");
  ok(!!mic && mic.qty === 3 && mic.estimates === 1 && mic.weightedCost === 3 * 100 * 0.25, "#66: an Alternate group is left out; a Grid line by document id counts once under its real sku at catalog cost");
  const panel = rep.parts.find((r) => r.sku === "RACK-PANEL");
  ok(rep.parts.every((r) => r.sku !== "CUSTOM" && r.sku !== "ASM-1" && r.sku !== "BONUS"), "#66: only catalog parts are listed (no custom, no assembly id, no bonus line)");
  ok(rep.openEstimates === 2, "#66: open estimates = draft + sent quotes with a counted part");
  const etc = rep.manufacturers.find((m) => m.mfrKey === "etc");
  ok(!!etc && etc.parts === 2 && etc.qty === 10 && etc.estimates === 1, "#66: the manufacturer table sums its parts");
  ok(rep.manufacturers[0].weightedCost >= rep.manufacturers[rep.manufacturers.length - 1].weightedCost, "#66: rows sort by weighted cost");
  ok(!!panel && panel.qty === 2 && panel.weightedCost === 2 * 30 * 0.1, "#66: a Grid asm: line expands into its live members at catalog cost (shop rate when the maker has none)");
  const csv = sourcingCsv([{ ...s4!, model: "=HYPERLINK(1)", desc: "+cmd", manufacturer: "@x" }], true);
  ok(csv.includes("'=HYPERLINK(1)") && csv.includes("'+cmd") && csv.includes("'@x") && csv.startsWith("﻿Model #"), "#66: CSV cells starting = + - @ get a leading '");
  const noCost = sourcingCsv([s4!], false);
  ok(!noCost.includes("Weighted cost") && !noCost.includes(String((4 * 180 + 2 * 150) * 0.5)), "#66: the CSV leaves cost out for a viewer without approve");
  const sorted = sortForNoCost([{ weightedQty: 1, qty: 1, n: "b" }, { weightedQty: 5, qty: 5, n: "a" }], (x) => x.n);
  ok(sorted[0].n === "a", "#66: without cost the rows sort by weighted qty");
  const page = src("src/app/(app)/reports/sourcing/page.tsx");
  const route = src("src/app/(app)/reports/sourcing/export/route.ts");
  ok(/const showCost = can\("approve", me\.roles\)/.test(page) && /\{showCost && <th/.test(page) && /const withCost = can\("approve", me\.roles\)/.test(route),
    "#66: cost shows only to approve holders (the Reports margin-widget gate), page and CSV alike");
  ok(src("src/app/(app)/reports/page.tsx").includes('href="/reports/sourcing"'), "#66: Reports links to the table");
}

export async function batch6PureChecks(ok: Ok) {
  fieldTaskPureChecks(ok);
  sourcingChecks(ok);
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
