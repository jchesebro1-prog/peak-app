/* Assessments engine (#337) — harness checks. `assessmentChecks` is pure; `assessmentDbChecks` needs the
   test DB. Run alone with `npx tsx scripts/test-assessments.ts` (pure checks only). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { ASSESSMENT_DEF, allQuestions, allModules, getDef } from "../src/lib/assessments/defs";
import type { AssessmentDef, Cond, ModuleDef, QuestionDef, Rule } from "../src/lib/assessments/defs/types";
import type { Answer, Answers } from "../src/lib/assessments/answers";
import { evaluate, holds, type EvalInput } from "../src/lib/assessments/evaluate";
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

  // ---- Evaluator (Task 2) ----
  const base = { def: ASSESSMENT_DEF, visitType: "condition", profile: {}, photos: [], dismissed: [], resolved: [], now: Date.UTC(2026, 9, 14) };
  const sc = ASSESSMENT_DEF.visitTypes.find((v) => v.key === "condition")!.scopes.map((s) => ({ ...s }));
  const A = (v: unknown): Answer => ({ v, state: "answered", at: 1, by: "u1" });
  const ev = (answers: Answers, extra: Partial<EvalInput> = {}) => evaluate({ ...base, scopes: sc, answers, ...extra });
  // R1
  let r = ev({ "rigging.overhead": A("none") });
  ok(r.visible.has("rigging.hanging_positions") && !r.visibleModules.has("rigging.counterweight") && !r.visible.has("rigging.rope_sets"), "eval R1: none hides other rigging");
  ok(ev({ "rigging.overhead": A("none"), "rigging.access": A(["catwalk"]) }).visibleModules.has("rigging.access_fall"), "eval R1: access_fall survives overhead=none");
  ok(ev({ "rigging.overhead": A("none"), "rigging.pit_lift": A("yes") }).visibleModules.has("rigging.pit_lift_detail"), "eval R1: pit lift detail survives overhead=none");
  ok(ev({ "rigging.overhead": A("none"), "rigging.access": A(["catwalk"]), "rigging.fall_hazard": A("yes") }).prompts.some((p) => p.id === "flag:rigging.fall_hazard"), "eval R1: fall hazard prompt still fires at overhead=none");
  // R2
  r = ev({ "rigging.overhead": A("dead_hung") });
  ok(r.visibleModules.has("rigging.dead_hung") && !r.visibleModules.has("rigging.counterweight") && !r.visibleModules.has("rigging.motorized"), "eval R2: dead hung skips arbors/hoists");
  // R3+R4 mixed
  r = ev({ "rigging.overhead": A("mixed") });
  ok(r.visibleModules.has("rigging.counterweight") && r.visibleModules.has("rigging.motorized"), "eval R3/R4: mixed shows both");
  // R6 screen hides line set schedule
  ok(!ev({ "rigging.overhead": A("counterweight") }).visibleModules.has("rigging.lineset_schedule"), "eval R6: screen depth hides line set schedule");
  ok(evaluate({ ...base, scopes: sc.map((s) => s.code === "S2" ? { ...s, depth: "full" as const } : s), answers: { "rigging.overhead": A("counterweight") } }).visibleModules.has("rigging.lineset_schedule"), "eval R7: full depth shows line set schedule");
  // R8 fall hazard → immediate prompt w/ photo
  r = ev({ "rigging.overhead": A("counterweight"), "rigging.access": A(["catwalk"]), "rigging.fall_hazard": A("yes") });
  ok(r.prompts.some((p) => p.id === "flag:rigging.fall_hazard" && p.rating === "immediate" && p.requirePhoto && p.category === "RIG"), "eval R8/X5: fall hazard prompts Immediate RIG + photo");
  // R9 install year
  ok(ev({ "rigging.overhead": A("counterweight"), "rigging.install_year": A(1980) }).flags.some((f) => f.ruleId === "R9"), "eval R9: > 30 years flags capacity");
  ok(ev({ "rigging.overhead": A("counterweight") }).flags.some((f) => f.ruleId === "R9"), "eval R9: unknown install year flags");
  ok(!ev({ "rigging.overhead": A("counterweight"), "rigging.install_year": A(2015) }).flags.some((f) => f.ruleId === "R9"), "eval R9: recent install no flag");
  // R10
  ok(ev({ "rigging.overhead": A("counterweight") }).prompts.some((p) => p.ruleId === "R10" && p.rating === "needs"), "eval R10: unknown last inspection prompts");
  ok(!ev({ "rigging.overhead": A("counterweight"), "core.last_inspection_date": A(Date.UTC(2026, 3, 1)) }).prompts.some((p) => p.ruleId === "R10"), "eval R10: recent inspection no prompt");
  // F1b / F2
  ok(ev({ "fire_curtain.present": A("yes"), "fire_curtain.last_drop_test": A(Date.UTC(2026, 0, 1)), "fire_curtain.test_log": A("yes") }).prompts.some((p) => p.ruleId === "F1b"), "eval F1: drop test > 90 days prompts");
  ok(ev({ "fire_curtain.present": A("no"), "core.space_type": A("proscenium") }).prompts.some((p) => p.ruleId === "F2" && p.category === "STR"), "eval F2: no curtain on proscenium → AHJ prompt");
  // G4
  ok(ev({ "soft_goods.present": A("yes"), "soft_goods.flame_cert": A("unknown") }).prompts.some((p) => p.ruleId === "G4"), "eval G4: flame cert unknown prompts");
  // L6/L7/L9
  ok(ev({ "stage_lighting.present": A("yes"), "fixtures.overhead": A("yes"), "fixtures.safety_cables": A("some_missing") }).prompts.some((p) => p.ruleId === "L6" && p.rating === "immediate" && p.category === "ELC"), "eval L6: missing safety cable Immediate");
  ok(ev({ "stage_panel.present": A("yes") }).flags.some((f) => f.ruleId === "L7"), "eval L7: observe-only flag");
  ok(!ev({ "power.hazards": A(["none"]) }).prompts.some((p) => p.ruleId === "L9") && ev({ "power.hazards": A(["bare_end_feeders"]) }).prompts.some((p) => p.ruleId === "L9"), "eval L9: hazards except none prompt");
  // L8 via profile
  ok(ev({}, { profile: { "core.year_built": 1931 } }).prompts.some((p) => p.ruleId === "L8"), "eval L8: pre-1970 building (profile) prompts electrician");
  // A4 / H6
  ok(ev({ "sound_system.present": A("yes"), "sound_system.working": A("yes"), "speakers.flown": A("yes"), "speakers.safety_cables": A("no") }).prompts.some((p) => p.ruleId === "A4" && p.rating === "immediate"), "eval A4: flown w/o safety cables Immediate");
  ok(ev({ "house.suspect_materials": A(["asbestos"]) }).prompts.some((p) => p.ruleId === "H6" && p.category === "HAZ"), "eval H6: suspect materials → HAZ");
  // X1 hidden on condition, shown when S8 on
  ok(!ev({}).visibleModules.has("access.load_in"), "eval X1: load-in hidden on condition visit");
  ok(evaluate({ ...base, scopes: sc.map((s) => s.code === "S8" ? { ...s, on: true } : s), answers: {} }).visibleModules.has("access.load_in"), "eval X1: S8 on shows load-in");
  // X4 unable
  r = ev({ "core.owner_concerns": { state: "unable", reason: "no contact on site", at: 1, by: "u1" } });
  ok(r.unable.length === 1 && r.unable[0].reason === "no contact on site", "eval X4: unable answers → follow-up list");
  // dismissed / resolved
  ok(!ev({ "soft_goods.present": A("yes"), "soft_goods.flame_cert": A("no") }, { dismissed: ["rule:G4"] }).prompts.some((p) => p.ruleId === "G4"), "eval: dismissed prompt doesn't return");
  ok(!ev({ "soft_goods.present": A("yes"), "soft_goods.flame_cert": A("no") }, { resolved: ["rule:G4"] }).prompts.some((p) => p.ruleId === "G4"), "eval: resolved prompt doesn't return");
  ok(!ev({ "rigging.overhead": A("counterweight"), "rigging.access": A(["catwalk"]), "rigging.fall_hazard": A("yes") }, { dismissed: ["flag:rigging.fall_hazard"] }).prompts.some((p) => p.id === "flag:rigging.fall_hazard"), "eval: dismissed flag prompt doesn't return");
  // required
  ok(ev({}).missingRequired.includes("core.space_type"), "eval: required space type missing");
  ok(!ev({ "core.space_type": { state: "na", at: 1, by: "u1" } }).missingRequired.includes("core.space_type"), "eval: n/a resolves required");
  ok(!ev({ "core.space_type": { state: "unable", reason: "locked", at: 1, by: "u1" } }).missingRequired.includes("core.space_type"), "eval: unable resolves required");
  ok(ev({}).required.has("core.space_type") && !ev({ "core.space_type": A("gym") }).missingRequired.includes("core.space_type"), "eval: answered required is not missing");
  // hidden answers kept (evaluator never mutates)
  const ans = { "rigging.overhead": A("none"), "rigging.rope_sets": A("yes") }; ev(ans);
  ok("rigging.rope_sets" in ans && Object.keys(ans).length === 2, "eval: hidden answers are not deleted");
  // scope off → its prompts don't fire
  ok(!evaluate({ ...base, scopes: sc.map((s) => s.code === "S3" ? { ...s, on: false } : s), answers: { "soft_goods.present": A("yes"), "soft_goods.flame_cert": A("no") } }).prompts.some((p) => p.ruleId === "G4"), "eval: scope off → no prompts from it");
  ok(!evaluate({ ...base, scopes: sc.map((s) => s.code === "S2" ? { ...s, on: false } : s), answers: {} }).prompts.some((p) => p.ruleId === "R10"), "eval: scope off → unanswered-gated prompts (R10) don't fire");
  // photos
  r = ev({});
  ok(!r.missingPhotos.some((m) => m.req.id.startsWith("core.photo_set:")), "eval photos: named photo set never a gap on an empty assessment");
  r = ev({ "rigging.overhead": A("counterweight") });
  ok(r.missingPhotos.some((m) => m.req.id === "rigging.counterweight:lock_rail") && !r.missingPhotos.some((m) => m.req.optional), "eval photos: required photo of a visible module is a gap; optional ones never are");
  ok(!ev({ "rigging.overhead": A("counterweight") }, { photos: [{ reqId: "rigging.counterweight:lock_rail" }] }).missingPhotos.some((m) => m.req.id === "rigging.counterweight:lock_rail"), "eval photos: a taken photo (by reqId) fills the slot");
  ok(!ev({ "rigging.overhead": A("dead_hung") }).missingPhotos.some((m) => m.moduleId === "rigging.counterweight"), "eval photos: hidden module's photos aren't gaps");
  // progress
  r = ev({ "rigging.overhead": A("none"), "rigging.pit_lift": { state: "na", at: 1, by: "u1" } });
  ok(r.progress.rigging.done === 2 && r.progress.rigging.total > 2 && r.progress.core.done === 0 && !("project" in r.progress), "eval progress: counts any answer state per scope key; off scopes omitted");
  // holds() semantics
  const hctx = { answers: { a: A("yes"), m: A(["x", "y"]), n: { state: "na" as const, at: 1, by: "u" }, u: { state: "unable" as const, reason: "r", at: 1, by: "u" } }, profile: { yr: 1950 }, scopes: sc, visitType: "condition", now: Date.UTC(2026, 9, 14) };
  ok(holds({ key: "m", in: ["y", "z"] }, hctx) && !holds({ key: "m", in: ["z"] }, hctx), "holds: in on a many answer = any overlap");
  ok(!holds({ key: "n", in: ["yes"] }, hctx) && !holds({ key: "u", in: ["yes"] }, hctx), "holds: in is false for n/a and unable");
  ok(holds({ key: "n", state: "unanswered" }, hctx) && holds({ key: "zz", state: "unanswered" }, hctx) && !holds({ key: "u", state: "unanswered" }, hctx) && holds({ key: "u", state: "unable" }, hctx), "holds: unanswered = none or n/a; unable matches only unable");
  ok(!holds({ key: "zz", olderThanDays: 1 }, hctx) && !holds({ key: "zz", olderThanYears: 1 }, hctx), "holds: olderThan is false when unanswered");
  ok(holds({ profile: "yr", lt: 1970 }, hctx) && !holds({ profile: "nope", lt: 1970 }, hctx), "holds: profile reads the fact; false when absent");

  // ---- Evaluator semantics pinned (Task 2 fix round 1) ----
  const NA: Answer = { state: "na", at: 1, by: "u1" };
  const UNABLE: Answer = { state: "unable", reason: "locked", at: 1, by: "u1" };
  const pid = (res: { prompts: { id: string }[] }) => res.prompts.map((p) => p.id);
  // skip beats show (real def): R5 shows rope_set_detail, R2 / R1 skip it
  ok(!ev({ "rigging.overhead": A("dead_hung"), "rigging.rope_sets": A("yes") }).visibleModules.has("rigging.rope_set_detail"), "eval skip>show: R2 skips rope-set detail even though R5 shows it");
  ok(!ev({ "rigging.overhead": A("none"), "rigging.rope_sets": A("yes") }).visibleModules.has("rigging.rope_set_detail"), "eval skip>show: R1 skips rope-set detail even though R5 shows it");
  ok(ev({ "rigging.overhead": A("counterweight"), "rigging.rope_sets": A("yes") }).visibleModules.has("rigging.rope_set_detail"), "eval R5: rope sets = yes shows the detail module when nothing skips it");
  ok(!ev({ "rigging.overhead": A("counterweight"), "rigging.rope_sets": A("no") }).visibleModules.has("rigging.rope_set_detail"), "eval R5: rope sets = no leaves the detail module hidden");
  // question-level skip (R1 skips core.last_inspection_date, a question key)
  ok(ev({ "rigging.overhead": A("counterweight") }).visible.has("core.last_inspection_date") && !ev({ "rigging.overhead": A("none") }).visible.has("core.last_inspection_date"), "eval skip: a rule can skip a single question key");
  // synthetic defs: show/skip on question and module keys, and the fixpoint
  const Q = (key: string, extra: Partial<QuestionDef> = {}): QuestionDef => ({ key, label: key, type: "yesno", ...extra });
  const synth = (modules: ModuleDef[], rules: Rule[]): AssessmentDef => ({ version: 1, visitTypes: [], scopes: [{ code: "S0", key: "core", title: "Core", modules }], rules, pickLists: {} });
  const sev = (d: AssessmentDef, answers: Answers, extra: Partial<EvalInput> = {}) => evaluate({ def: d, visitType: "x", scopes: [{ code: "S0", on: true }], profile: {}, photos: [], dismissed: [], resolved: [], now: base.now, answers, ...extra });
  const NEVER: Cond = { key: "__never", in: ["x"] };
  const yes = (k: string): Cond => ({ key: k, in: ["yes"] });
  const showSkip = synth(
    [
      { id: "m1", title: "m1", questions: [Q("p"), Q("qs", { when: NEVER }), Q("qk")] },
      { id: "m2", title: "m2", when: NEVER, questions: [Q("r")] },
      { id: "m3", title: "m3", questions: [Q("t")] },
    ],
    [
      { id: "Rs", when: yes("p"), show: ["qs", "m2"], skip: ["qk"] },
      { id: "Rboth", when: yes("p"), show: ["m3"], skip: ["m3"] },
    ],
  );
  r = sev(showSkip, { p: A("yes") });
  ok(r.visible.has("qs") && !r.visible.has("qk"), "eval show/skip: a rule shows a question whose own `when` is false, and skips another");
  ok(r.visibleModules.has("m2") && r.visible.has("r"), "eval show/skip: a rule shows a module whose own `when` is false (its questions follow)");
  ok(!r.visibleModules.has("m3") && !r.visible.has("t"), "eval show/skip: skip beats show for the same module");
  r = sev(showSkip, { p: A("no") });
  ok(!r.visible.has("qs") && r.visible.has("qk") && !r.visibleModules.has("m2") && r.visible.has("t"), "eval show/skip: nothing shown or skipped when the rule does not fire");
  // hidden answers don't fire prompts or flags
  ok(!ev({ "sound_system.present": A("no"), "speakers.flown": A("yes"), "speakers.safety_cables": A("no") }).prompts.some((p) => p.ruleId === "A4"), "eval hidden: A4 silent when the sound system is absent but flown/cable answers are stored");
  ok(ev({ "sound_system.present": A("yes"), "speakers.flown": A("yes"), "speakers.safety_cables": A("no") }).prompts.some((p) => p.ruleId === "A4"), "eval hidden: A4 fires once the sound system is present (control)");
  ok(!ev({ "stage_lighting.present": A("no"), "fixtures.overhead": A("yes"), "fixtures.safety_cables": A("some_missing") }).prompts.some((p) => p.ruleId === "L6"), "eval hidden: L6 silent when stage lighting is absent but fixture answers are stored");
  ok(ev({ "stage_lighting.present": A("yes"), "fixtures.overhead": A("yes"), "fixtures.safety_cables": A("some_missing") }).prompts.some((p) => p.ruleId === "L6"), "eval hidden: L6 fires once stage lighting is present (control)");
  // fixpoint: a three-deep chain of hidden gates (a=no hides b; b's stored yes must not reveal c; c's must not reveal d)
  const chain = synth(
    [
      { id: "ma", title: "ma", questions: [Q("a")] },
      { id: "mb", title: "mb", when: yes("a"), questions: [Q("b")] },
      { id: "mc", title: "mc", when: yes("b"), questions: [Q("c")] },
      { id: "md", title: "md", when: yes("c"), questions: [Q("d")] },
    ],
    [{ id: "RD", when: yes("d"), prompt: { category: "GEN", rating: "needs", text: "d" } }],
  );
  r = sev(chain, { a: A("no"), b: A("yes"), c: A("yes"), d: A("yes") });
  ok(r.prompts.length === 0 && [...r.visible].join() === "a", "eval fixpoint: a hidden answer cannot keep later gates open (3-deep chain)");
  r = sev(chain, { a: A("yes"), b: A("yes"), c: A("yes"), d: A("yes") });
  ok(pid(r).join() === "rule:RD" && r.visible.size === 4, "eval fixpoint: the same chain fires when every gate is genuinely open");
  r = sev(chain, { a: A("yes"), b: A("no"), c: A("yes"), d: A("yes") });
  ok(r.prompts.length === 0 && !r.visibleModules.has("mc"), "eval fixpoint: closing the middle gate hides everything after it");
  // rule scope: a rule belongs to the scope of the first key it names
  const noS5 = sc.map((s) => (s.code === "S5" ? { ...s, on: false } : s));
  ok(!evaluate({ ...base, scopes: noS5, answers: {}, profile: { "core.year_built": 1931 } }).prompts.some((p) => p.ruleId === "L8"), "eval scope: L8 (S5's first key) doesn't fire with S5 off, even for a pre-1970 profile");
  ok(evaluate({ ...base, scopes: sc, answers: {}, profile: { "core.year_built": 1931 } }).prompts.some((p) => p.ruleId === "L8"), "eval scope: L8 fires for the same profile with S5 on");
  ok(!ev({}, { profile: { "core.year_built": 1990 } }).prompts.some((p) => p.ruleId === "L8"), "eval L8: a post-1970 profile year doesn't prompt (lt is honoured)");
  ok(ev({ "core.year_built": A(1931) }).prompts.some((p) => p.ruleId === "L8") && !ev({ "core.year_built": A(1990) }).prompts.some((p) => p.ruleId === "L8"), "eval L8: the answered year_built also drives it; post-1970 doesn't");
  // X5 respects visibility
  ok(!ev({ "rigging.overhead": A("counterweight"), "rigging.access": A([]), "rigging.fall_hazard": A("yes") }).prompts.some((p) => p.id === "flag:rigging.fall_hazard"), "eval X5: fall hazard flag silent when the access module is hidden (access = [])");
  ok(!ev({ "rigging.overhead": A("counterweight"), "rigging.access": A(["none"]), "rigging.fall_hazard": A("yes") }).prompts.some((p) => p.id === "flag:rigging.fall_hazard"), "eval X5: fall hazard flag silent when access = none");
  ok(!ev({ "rigging.overhead": A("counterweight"), "rigging.fall_hazard": A("yes") }).prompts.some((p) => p.id === "flag:rigging.fall_hazard"), "eval X5: fall hazard flag silent when access was never answered");
  ok(!ev({ "rigging.overhead": A("counterweight"), "rigging.access": A(["catwalk"]), "rigging.fall_hazard": A("no") }).prompts.some((p) => p.id === "flag:rigging.fall_hazard"), "eval X5: a non-flag value (no) doesn't prompt");
  // X5 on a many answer: any overlap with flag.values
  const redFlag = (v: unknown) => ev({ "rigging.overhead": A("counterweight"), "rigging.red_flags": A(v) }).prompts.some((p) => p.id === "flag:rigging.red_flags" && p.ruleId === "X5");
  ok(redFlag(["frayed_cable"]) && redFlag(["none", "frayed_cable"]) && redFlag(["loose_collars", "none"]) && !redFlag(["none"]) && !redFlag([]), "eval X5: a many answer flags on any overlap (not first-element only); none and [] don't");
  // many/in overlap on a rule condition (R8): the matching value need not be first or last
  ok(ev({ "rigging.access": A(["none", "catwalk"]) }).visibleModules.has("rigging.access_fall") && ev({ "rigging.access": A(["catwalk", "none"]) }).visibleModules.has("rigging.access_fall") && !ev({ "rigging.access": A(["none"]) }).visibleModules.has("rigging.access_fall"), "eval R8: a many answer shows access_fall on any overlap");
  // n/a and unable never satisfy `in`
  ok(!ev({ "rigging.overhead": A("counterweight"), "rigging.rope_sets": NA }).visibleModules.has("rigging.rope_set_detail") && !ev({ "rigging.overhead": A("counterweight"), "rigging.rope_sets": UNABLE }).visibleModules.has("rigging.rope_set_detail"), "eval holds: an n/a or unable answer doesn't satisfy an `in` gate");
  // empty values count as unanswered
  ok(ev({ "core.space_type": A("") }).missingRequired.includes("core.space_type"), "eval empty: an answered empty string is still missing for a required question");
  ok(ev({ "core.space_type": A("   ") }).missingRequired.includes("core.space_type"), "eval empty: a whitespace-only string is still missing");
  ok(ev({ "core.space_type": A(NaN) }).missingRequired.includes("core.space_type"), "eval empty: NaN is still missing");
  ok(ev({ "core.space_type": A(null) }).missingRequired.includes("core.space_type") && ev({ "core.space_type": A([]) }).missingRequired.includes("core.space_type"), "eval empty: null and [] are still missing");
  ok(!ev({ "core.space_type": A(0) }).missingRequired.includes("core.space_type") && !ev({ "core.space_type": A(false) }).missingRequired.includes("core.space_type"), "eval empty: 0 and false are real values");
  ok(ev({ "core.space_type": A("") }).progress.core.done === 0 && ev({ "core.space_type": A("gym") }).progress.core.done === 1, "eval empty: an empty answer doesn't count toward progress");
  ok(!ev({ "power.hazards": A([]) }).prompts.some((p) => p.ruleId === "L9") && !ev({ "power.hazards": A("  ") }).prompts.some((p) => p.ruleId === "L9"), "eval empty: power.hazards = [] / blank doesn't prompt L9 (gate treated as unanswered)");
  ok(ev({ "power.hazards": A(["bare_end_feeders", "improvised_adapters"]) }).prompts.some((p) => p.ruleId === "L9"), "eval L9: several hazards prompt");
  ok(!ev({ "power.hazards": UNABLE }).prompts.some((p) => p.ruleId === "L9"), "eval L9: unable doesn't prompt");
  const ectx = (e: Answer) => ({ ...hctx, answers: { e } });
  ok(holds({ key: "e", state: "unanswered" }, ectx(A(""))) && holds({ key: "e", state: "unanswered" }, ectx(A("  "))) && holds({ key: "e", state: "unanswered" }, ectx(A(NaN))) && !holds({ key: "e", state: "unanswered" }, ectx(A(0))), "holds: empty / blank / NaN answers are unanswered; 0 is answered");
  ok(!holds({ key: "e", in: [""] }, ectx(A(""))) && !holds({ key: "e", lt: 5 }, ectx(A(NaN))), "holds: empty and NaN never satisfy in / lt");
  // unable list: visible questions only, with the reason
  ok(ev({ "rigging.overhead": A("none"), "rigging.rope_sets": UNABLE }).unable.length === 0 && ev({ "rigging.overhead": A("counterweight"), "rigging.rope_sets": UNABLE }).unable.map((u) => `${u.key}:${u.reason}`).join() === "rigging.rope_sets:locked", "eval X4: an unable answer on a hidden question isn't listed; on a visible one it carries its reason");
  // numeric boundaries
  const nowMs = Date.UTC(2026, 9, 14);
  const bctx = (answers: Answers) => ({ ...hctx, answers, now: nowMs });
  ok(!holds({ key: "y", olderThanYears: 30 }, bctx({ y: A(1996) })) && holds({ key: "y", olderThanYears: 30 }, bctx({ y: A(1995) })), "holds: olderThanYears is strictly older (2026 − 1996 = 30 is not older than 30; 1995 is)");
  ok(!holds({ key: "d", olderThanDays: 90 }, bctx({ d: A(nowMs - 90 * 86_400_000) })) && holds({ key: "d", olderThanDays: 90 }, bctx({ d: A(nowMs - 90 * 86_400_000 - 1) })), "holds: olderThanDays is strictly older (exactly 90 days is not; 1 ms more is)");
  ok(!holds({ key: "d", olderThanDays: 90 }, bctx({ d: A(nowMs - 10 * 86_400_000) })), "holds: a recent date is not older than 90 days");
  ok(holds({ key: "n", lt: 5 }, bctx({ n: A(4) })) && !holds({ key: "n", lt: 5 }, bctx({ n: A(5) })) && holds({ key: "n", gt: 5 }, bctx({ n: A(6) })) && !holds({ key: "n", gt: 5 }, bctx({ n: A(5) })) && holds({ key: "n", gt: 1, lt: 5 }, bctx({ n: A(3) })) && !holds({ key: "n", gt: 1, lt: 5 }, bctx({ n: A(7) })), "holds: gt / lt are strict and combine");
  ok(holds({ profile: "yr", gt: 1900 }, hctx) && !holds({ profile: "yr", gt: 1960 }, hctx) && !holds({ profile: "yr", lt: 1900 }, hctx) && holds({ profile: "k", in: ["a", "b"] }, { ...hctx, profile: { k: "b" } }) && !holds({ profile: "k", in: ["a"] }, { ...hctx, profile: { k: "b" } }), "holds: profile lt / gt / in are each applied");
  // scopes
  const off2 = sc.map((s) => (s.code === "S2" ? { ...s, on: false, depth: "screen" as const } : s));
  ok(!holds({ scopeDepth: "S2", is: "screen" }, { ...hctx, scopes: off2 }) && holds({ scopeDepth: "S2", is: "screen" }, { ...hctx, scopes: sc }) && !holds({ scopeOn: "S2" }, { ...hctx, scopes: off2 }), "holds: scopeDepth requires the scope to be on");
  const noS0 = sc.map((s) => (s.code === "S0" ? { ...s, on: false } : s));
  ok(holds({ scopeOn: "S0" }, { ...hctx, scopes: noS0 }) && holds({ scopeOn: "S0" }, { ...hctx, scopes: [] }), "holds: S0 is always on, even switched off or absent from the visit's scopes");
  r = evaluate({ ...base, scopes: noS0, answers: {} });
  ok(r.progress.core !== undefined && r.missingRequired.includes("core.space_type"), "eval scope: S0 can't be switched off — core questions stay visible and required");
  ok(evaluate({ ...base, scopes: [], answers: {} }).missingRequired.includes("core.space_type"), "eval scope: with no scopes listed at all, S0 still applies");
  // flags outlive dismissed prompts and are not prompts
  r = ev({ "rigging.overhead": A("counterweight"), "stage_panel.present": A("yes") }, { dismissed: ["rule:R9", "rule:L7"], resolved: ["rule:R9"] });
  ok(r.flags.some((f) => f.ruleId === "R9") && r.flags.some((f) => f.ruleId === "L7") && !r.prompts.some((p) => p.ruleId === "R9" || p.ruleId === "L7"), "eval flags: R9 / L7 notices stay even when dismissed, and are never prompts");
  // dismissed / resolved are independent id lists
  ok(!ev({ "soft_goods.present": A("yes"), "soft_goods.flame_cert": A("no") }, { dismissed: ["rule:G4"], resolved: [] }).prompts.some((p) => p.ruleId === "G4") && !ev({ "soft_goods.present": A("yes"), "soft_goods.flame_cert": A("no") }, { dismissed: [], resolved: ["rule:G4"] }).prompts.some((p) => p.ruleId === "G4"), "eval: dismissed and resolved each suppress on their own");
  // photos: a taken photo fills only its own slot
  ok(ev({ "rigging.overhead": A("counterweight") }, { photos: [{ reqId: "nope" }] }).missingPhotos.some((m) => m.req.id === "rigging.counterweight:lock_rail"), "eval photos: an unrelated reqId doesn't fill the slot");

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
