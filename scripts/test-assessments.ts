/* Assessments engine (#337) — harness checks. `assessmentChecks` is pure; `assessmentDbChecks` needs the
   test DB. Run alone with `npx tsx scripts/test-assessments.ts` (pure checks only). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { ASSESSMENT_DEF, allQuestions, allModules, getDef } from "../src/lib/assessments/defs";
import type { Cond } from "../src/lib/assessments/defs/types";
import coverage from "../docs/assessments/manitowoc-coverage.json";

const ROOT = process.cwd();

/** Every ☐ line under the four "every venue" headings the coverage map must carry. */
function checklistLines(): string[] {
  const text = readFileSync(join(ROOT, "docs/assessments/briefs/manitowoc-field-checklist.txt"), "utf8");
  const lines = text.split("\n");
  const out: string[] = [];
  const section = (start: string, end: string) => {
    const a = lines.findIndex((l) => l.startsWith(start));
    const b = lines.findIndex((l, i) => i > a && l.startsWith(end));
    return a < 0 || b < 0 ? [] : lines.slice(a + 1, b);
  };
  for (const [s, e] of [
    ["Every venue: capture the same basics", "Site visit intake"],
    ["Rigging triage: every venue", "Power and control: every venue"],
    ["Power and control: every venue", "Added from the comparison sheets"],
  ]) for (const l of section(s, e)) { const m = l.match(/☐ (.+)$/); if (m) out.push(m[1].trim()); }
  // "Site visit intake": a Field / Entry table, one field per non-blank line after the header pair.
  const intake = section("Site visit intake", "Rigging triage: every venue");
  const head = intake.findIndex((l) => l.trim() === "Entry");
  for (const l of intake.slice(head + 1)) {
    const t = l.trim();
    if (t && !t.startsWith("For example")) out.push(t);
  }
  return out;
}

export async function assessmentChecks(ok: Ok) {
  const def = ASSESSMENT_DEF;
  const qs = allQuestions(def); const ms = allModules(def);
  const keys = def.scopes.flatMap((s) => s.modules.flatMap((m) => m.questions.map((q) => q.key)));
  ok(keys.length === new Set(keys).size, "assess defs: question keys unique");
  ok([...ms.keys()].length === new Set(def.scopes.flatMap((s) => s.modules.map((m) => m.id))).size, "assess defs: module ids unique");
  ok(def.scopes.flatMap((s) => s.modules).length === ms.size, "assess defs: no duplicate module id across scopes");
  ok([...ms.keys()].every((id) => !qs.has(id)), "assess defs: no module id collides with a question key (rule targets are unambiguous)");
  ok(def.version === 1 && getDef(1) === def && getDef(99) === def, "assess defs: version 1; unknown version → current def");
  const ids = def.rules.map((r) => r.id);
  ok(ids.length === new Set(ids).size, "assess defs: rule ids unique");
  for (const want of ["R1","R2","R3","R4","R5","R6","R7","R8","R9","R10","R11","R12","F1","F2","F3","F4","F5","G1","G2","G3","G4","L1","L2","L3","L4","L5","L6","L7","L8","L9","A1","A2","A3","A4","A5","A6","A7","A8","A9","H1","H2","H3","H4","H5","H6","H7","X1","X2","X3"])
    ok(ids.includes(want), `assess defs: rule ${want} defined`);
  ok(ids.includes("F1b") && ids.includes("F3b"), "assess defs: F1b / F3b prompt rules defined");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refs = (c: any): string[] => !c ? [] : c.all ? c.all.flatMap(refs) : c.any ? c.any.flatMap(refs) : c.not ? refs(c.not) : c.key && c.key !== "__never" ? [c.key] : c.profile ? [c.profile] : [];
  for (const r of def.rules) {
    for (const k of refs(r.when)) ok(qs.has(k), `assess defs: ${r.id} references known key ${k}`);
    for (const t of [...(r.show || []), ...(r.skip || [])]) ok(qs.has(t) || ms.has(t), `assess defs: ${r.id} targets known ${t}`);
    ok(!!(r.show?.length || r.skip?.length || r.prompt || r.flag), `assess defs: ${r.id} has an effect`);
  }
  for (const [id, { m }] of ms) {
    for (const k of refs(m.when)) ok(qs.has(k), `assess defs: module ${id} gate references known key ${k}`);
    for (const p of m.photos || []) ok(p.id.startsWith(`${id}:`), `assess defs: photo ${p.id} is <moduleId>:<slug>`);
  }
  const photoIds = [...ms.values()].flatMap(({ m }) => (m.photos || []).map((p) => p.id));
  ok(photoIds.length === new Set(photoIds).size, "assess defs: photo ids unique");
  for (const [k, { q }] of qs) {
    if (q.options) ok(!!def.pickLists[q.options], `assess defs: ${k} pick list ${q.options} exists`);
    for (const c of q.columns || []) if (c.options) ok(!!def.pickLists[c.options], `assess defs: ${k}.${c.key} pick list ${c.options} exists`);
    if (q.type === "one" || q.type === "many") ok(!!q.options, `assess defs: ${k} (${q.type}) names a pick list`);
    if (q.type === "table") ok(!!q.columns?.length, `assess defs: ${k} (table) has columns`);
    for (const r of refs(q.when)) ok(qs.has(r), `assess defs: ${k} visibility references known key ${r}`);
    if (q.flag && q.options) for (const v of q.flag.values) ok(def.pickLists[q.options].some((o) => o.value === v), `assess defs: ${k} flag value ${v} is an option`);
  }
  // Rules whose `in` values must be real options of the referenced question.
  const ins = (c: Cond | undefined): { key: string; vals: string[] }[] => {
    if (!c) return [];
    if ("all" in c) return c.all.flatMap(ins);
    if ("any" in c) return c.any.flatMap(ins);
    if ("not" in c) return ins(c.not);
    if ("key" in c && "in" in c && Array.isArray(c.in) && c.key !== "__never") return [{ key: c.key, vals: c.in }];
    return [];
  };
  const yesno = new Set(["yes", "no"]);
  const conds: { owner: string; c?: Cond }[] = [
    ...def.rules.map((r) => ({ owner: r.id, c: r.when })),
    ...[...ms.values()].map(({ m }) => ({ owner: m.id, c: m.when })),
    ...[...qs.values()].map(({ q }) => ({ owner: q.key, c: q.when })),
  ];
  for (const { owner, c } of conds) for (const { key, vals } of ins(c)) {
    const q = qs.get(key)?.q; if (!q) continue;
    const valid = q.type === "yesno" ? (v: string) => yesno.has(v) : (v: string) => !!q.options && def.pickLists[q.options].some((o) => o.value === v);
    ok(vals.every(valid), `assess defs: ${owner} tests real values of ${key} (${vals.join(",")})`);
  }
  const cond = def.visitTypes.find((v) => v.key === "condition");
  ok(!!cond && cond.scopes.find((s) => s.code === "S8")?.on === false && cond.scopes.find((s) => s.code === "S2")?.depth === "screen", "assess defs: condition visit = S0–S7 on, S2 screen, S8 off");
  ok(!!cond && ["S0","S1","S2","S3","S4","S5","S6","S7"].every((c) => cond.scopes.find((s) => s.code === c)?.on === true), "assess defs: condition visit turns S0–S7 on");
  ok(def.scopes.map((s) => s.code).join() === "S0,S1,S2,S3,S4,S5,S6,S7,S8", "assess defs: nine scopes S0–S8 in order");
  for (const want of ["rigging.counterweight","rigging.motorized","rigging.dead_hung","rigging.lineset_schedule","rigging.hardware_inventory","rigging.dimensions","rigging.wire_rope","access.load_in","core.photo_set"])
    ok(ms.has(want), `assess defs: module ${want} exists`);
  ok((qs.get("core.space_type")?.q.required && qs.get("core.contact_hazard")?.q.required && qs.get("rigging.overhead")?.q.required) === true, "assess defs: space type, hazard contact and rigging type are required");
  const fall = qs.get("rigging.fall_hazard");
  ok(fall?.moduleId === "rigging.access_fall" && fall.q.flag?.rating === "immediate" && fall.q.flag.requirePhoto === true && fall.q.flag.category === "RIG", "assess defs: fall hazard flag → RIG Immediate + photo, inside the access module");

  // R1 (no overhead rigging) must not hide the pit lift or the access / fall questions.
  const r1 = def.rules.find((r) => r.id === "R1");
  const r1Skip = r1?.skip || [];
  for (const t of ["rigging.pit_lift", "rigging.pit_lift_detail", "rigging.access", "rigging.access_fall"])
    ok(!r1Skip.includes(t), `assess defs: R1 does not skip ${t}`);
  const pitMod = qs.get("rigging.pit_lift")?.moduleId;
  const accMod = qs.get("rigging.access")?.moduleId;
  const skipped = new Set(def.rules.flatMap((r) => r.skip || []));
  ok(!!pitMod && !ms.get(pitMod)?.m.when && !skipped.has(pitMod) && !skipped.has("rigging.pit_lift"), "assess defs: rigging.pit_lift lives in a module with no `when`, targeted by no rule's skip");
  ok(!!accMod && !ms.get(accMod)?.m.when && !skipped.has(accMod) && !skipped.has("rigging.access"), "assess defs: rigging.access lives in a module with no `when`, targeted by no rule's skip");
  // Conditionally-worded photos never gate Mark complete.
  for (const { m } of ms.values()) for (const p of m.photos || [])
    if (/^(every|any)\b/i.test(p.label) || /if (posted|visible)/i.test(p.label)) ok(p.optional === true, `assess defs: photo ${p.id} ("${p.label}") is optional`);
  ok(["stage", "house", "foh", "overhead"].every((s) => ms.get("core.photo_set")?.m.photos?.find((p) => p.id === `core.photo_set:${s}`)?.optional === true), "assess defs: the named photo set is all optional");
  for (const k of ["house.exits_clear", "house.traps_guarded"]) {
    const f = qs.get(k)?.q.flag;
    ok(f?.category === "GEN" && f.rating === "immediate", `assess defs: ${k} flag → GEN Immediate`);
  }

  // Coverage map
  const rows = coverage as { line: string; keys: string[] }[];
  for (const row of rows)
    for (const k of row.keys) ok(k.startsWith("@record.") || qs.has(k) || ms.has(k), `assess coverage: "${row.line.slice(0, 40)}" → ${k}`);
  ok(rows.length >= 50, "assess coverage: every-venue checklist lines mapped (≥ 50)");
  ok(rows.every((r) => r.keys.length > 0), "assess coverage: every row maps to at least one key");
  const want = checklistLines();
  ok(want.length >= 50, `assess coverage: checklist parse found the every-venue lines (${want.length})`);
  for (const l of want) ok(rows.some((r) => r.line === l), `assess coverage: checklist line covered — "${l.slice(0, 50)}"`);
  for (const r of rows) ok(want.includes(r.line), `assess coverage: row is an exact checklist line — "${r.line.slice(0, 50)}"`);
}
export async function assessmentDbChecks(_ok: Ok) {}
if (process.argv[1] && /test-assessments\.ts$/.test(process.argv[1])) {
  let fail = 0; const ok: Ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  assessmentChecks(ok).then(() => { console.log(fail ? `${fail} FAIL` : "all PASS"); process.exit(fail ? 1 : 0); });
}
