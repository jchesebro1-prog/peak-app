/* Assessments engine (#337) — harness checks. `assessmentChecks` is pure; `assessmentDbChecks` needs the
   test DB. Run alone with `npx tsx scripts/test-assessments.ts` (pure checks only). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { ASSESSMENT_DEF, allQuestions, allModules, getDef } from "../src/lib/assessments/defs";
import type { AssessmentDef, Cond, ModuleDef, QuestionDef, Rule } from "../src/lib/assessments/defs/types";
import type { Answer, Answers } from "../src/lib/assessments/answers";
import { evaluate, holds, type EvalInput } from "../src/lib/assessments/evaluate";
import { validateAnswer, mergeAnswers } from "../src/lib/assessments/answers";
import { CODE_RE, suggestCompanyCode, suggestSiteCode, withCollisionSuffix } from "../src/lib/assessments/codes";
import { STATUSES, CATEGORY_ROUTING, formatPrintedId, pendingPrintedLabel, immediateProblems, transitionProblems, legacyRating, codeInUse, type Finding } from "../src/lib/assessments/findings-model";
import { csvCell, toCsv } from "../src/lib/assessments/csv";
import { PHOTO_PREFIX, PHOTO_CAPS, photoBlobPath, photoPathInScope } from "../src/lib/assessments/photos";
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

  // ---- Task 3: pure model ----
  ok(suggestSiteCode("Lincoln High School") === "LIN" && suggestSiteCode("Wilson Middle School") === "WIL" && suggestSiteCode("Washington Middle School") === "WAS" && suggestSiteCode("St. Norbert College") === "NOR" && suggestSiteCode("The Grand Theatre") === "GRA", "codes: venue = first 3 letters of first meaningful word");
  ok(suggestSiteCode("Saint Mary of the Lake") === "MAR" && suggestSiteCode("  the  ") !== "" && CODE_RE.test(suggestSiteCode("  the  ")) && CODE_RE.test(suggestSiteCode("A")), "codes: venue edge cases still yield a valid code");
  ok(suggestCompanyCode("Manitowoc Public School District") === "MPSD", "codes: company initials");
  ok(suggestCompanyCode("Acme") === "ACM" && CODE_RE.test(suggestCompanyCode("X")) && suggestCompanyCode("Alpha Beta Gamma Delta Epsilon Zeta Eta").length === 6 && CODE_RE.test(suggestCompanyCode("St. Mary's & Sons, Inc.")), "codes: company single word / short / long names stay 2–6");
  ok(withCollisionSuffix("LIN", new Set(["LIN"])) === "LIN2" && withCollisionSuffix("LIN", new Set(["LIN", "LIN2"])) === "LIN3" && withCollisionSuffix("ABCDEF", new Set(["ABCDEF"])).length <= 6 && withCollisionSuffix("LIN", new Set()) === "LIN", "codes: collision suffix ≤ 6");
  ok(withCollisionSuffix("ABCDEF", new Set(["ABCDEF"])) === "ABCDE2" && CODE_RE.test(withCollisionSuffix("ABCDEF", new Set(["ABCDEF", "ABCDE2"]))), "codes: long base is truncated for the suffix");
  ok(CODE_RE.test("MPSD") && !CODE_RE.test("mp") && !CODE_RE.test("TOOLONG7") && !CODE_RE.test("A") && CODE_RE.test("LIN2"), "codes: validation");
  ok(formatPrintedId("MPSD", "LIN", "RIG", 3) === "MPSD-LIN-RIG-003" && formatPrintedId("MPSD", "LIN", "RIG", 1234) === "MPSD-LIN-RIG-1234", "findings: printed id format");
  ok(pendingPrintedLabel("MPSD", "LIN", "RIG") === "MPSD-LIN-RIG-…" && pendingPrintedLabel(null, null, "ELC") === "—-—-ELC-…", "findings: pending label");
  const f0 = { rating: "immediate", photoIds: [], recommendedAction: "", status: "open", quoteRefs: [], history: [] } as unknown as Finding;
  ok(immediateProblems(f0).length >= 3, "findings: immediate requires photo/notify/lockout/action");
  ok(immediateProblems({ ...f0, photoIds: ["p1"], recommendedAction: "Close the catwalk", immediate: { hazardContactNotified: true, notifiedAt: 5, lockout: "locked" } }).length === 0, "findings: immediate complete");
  ok(immediateProblems({ ...f0, photoIds: ["p1"], recommendedAction: "Close", immediate: { hazardContactNotified: true, lockout: "tagged" } }).length === 1 && immediateProblems({ ...f0, photoIds: ["p1"], recommendedAction: "  ", immediate: { hazardContactNotified: false, lockout: "none" } }).length === 1 && immediateProblems({ ...f0, rating: "needs" } as Finding).length === 0, "findings: notifiedAt only when notified; blank action refused; non-immediate has no immediate rules");
  const fn = { ...f0, rating: "needs" } as Finding;
  ok(transitionProblems({ ...fn, status: "open" }, "inspected").length > 0 && transitionProblems({ ...fn, status: "open", specialist: { rating: "needs" } }, "inspected").length === 0, "findings: inspected needs specialist rating");
  ok(transitionProblems({ ...fn, status: "scheduled" }, "repaired").length > 0 && transitionProblems({ ...fn, status: "scheduled", repair: { date: 1, by: "Bob", work: "Replaced" } }, "repaired").length === 0 && transitionProblems({ ...fn, status: "scheduled", repair: { date: 1, by: "", work: "Replaced" } }, "repaired").length > 0, "findings: repaired needs repair date/by/work");
  ok(transitionProblems({ ...fn, status: "repaired" }, "verified").length > 0 && transitionProblems({ ...fn, status: "repaired", verified: { by: "u", at: 1 } }, "verified").length === 0, "findings: verified needs verified by/at");
  ok(transitionProblems({ ...fn, status: "triaged" }, "quoted").length > 0 && transitionProblems({ ...fn, status: "triaged", quoteRefs: ["Q-1"] }, "quoted").length === 0, "findings: quoted needs a quote ref");
  ok(transitionProblems({ ...fn, status: "quoted", quoteRefs: ["Q-1"] }, "open").length > 0 && transitionProblems({ ...fn, status: "quoted", quoteRefs: ["Q-1"] }, "open", "customer declined").length === 0 && transitionProblems({ ...fn, status: "quoted", quoteRefs: ["Q-1"] }, "open", "  ").length > 0, "findings: backward move needs note");
  ok(transitionProblems({ ...fn, status: "open", voided: { by: "u", at: 1, reason: "dup" } }, "triaged").length > 0 && transitionProblems({ ...fn, status: "open" }, "triaged").length === 0 && transitionProblems({ ...fn, status: "open" }, "closed").length === 0, "findings: voided can't transition; plain forward moves are fine");
  ok(STATUSES.length === 8 && STATUSES[0] === "open" && STATUSES[7] === "closed", "findings: status order");
  ok(Object.keys(CATEGORY_ROUTING).sort().join() === "ELC,GEN,HAZ,RIG,STR" && CATEGORY_ROUTING.RIG.label !== "" && CATEGORY_ROUTING.ELC.routedTo !== CATEGORY_ROUTING.RIG.routedTo, "findings: category routing covers all five categories");
  ok(legacyRating("RI", "Poor")?.rating === "immediate" && legacyRating("RI", "urgent")?.rating === "immediate" && legacyRating("RI", "Fair")?.rating === "needs" && legacyRating("RI", "necessary")?.rating === "needs" && legacyRating("RI", "GOOD")?.rating === "good" && legacyRating("RI", "basic")?.rating === "good" && legacyRating("FS", "Monitor")?.actionTag === "monitor" && legacyRating("FS", "monitor")?.rating === "good" && legacyRating("FS", "Replace")?.rating === "needs" && legacyRating("FS", "Good")?.rating === "good" && legacyRating("RI", "weird") === null && legacyRating("FS", "Poor") === null && legacyRating("RI", "Monitor") === null, "ratings: legacy map");
  const fc = (id: string, o: Partial<Finding>) => ({ ...f0, key: id, companyCode: "MPSD", siteCode: "LIN", ...o }) as Finding;
  ok(codeInUse([fc("a", {})], "MPSD", "company") && codeInUse([fc("a", {})], "LIN", "site") && !codeInUse([fc("a", {})], "LIN", "company") && !codeInUse([fc("a", { voided: { by: "u", at: 1, reason: "x" } })], "MPSD", "company") && !codeInUse([], "MPSD", "company"), "findings: codeInUse ignores voided findings and the other kind");
  ok(csvCell("=SUM(A1)") === "'=SUM(A1)" && csvCell("-3") === "'-3" && csvCell("+1") === "'+1" && csvCell("@x") === "'@x" && csvCell('a,"b"') === '"a,""b"""' && csvCell(null) === "" && csvCell(5) === "5" && csvCell("line\nbreak") === '"line\nbreak"', "csv: formula guard + quoting");
  ok(csvCell("=a,b") === "\"'=a,b\"" && csvCell("\tx") === "'\tx" && csvCell("\rx") === "\"'\rx\"", "csv: guarded and quoted together");
  ok(toCsv(["a"], [["x"]]).startsWith("\uFEFF") && toCsv(["a"], [["x"]]).includes("\r\n") && toCsv(["a", "b"], [["x", "=1"]]) === "\uFEFFa,b\r\nx,'=1\r\n", "csv: BOM + CRLF");
  ok(photoPathInScope("assessments/AS-1001/p_abc-Xy12.jpg", "AS-1001") && !photoPathInScope("assessments/AS-1002/p.jpg", "AS-1001") && !photoPathInScope("assessments/AS-1001/../x.jpg", "AS-1001") && !photoPathInScope("assessments/AS-1001/a/b.jpg", "AS-1001") && !photoPathInScope("other/AS-1001/p.jpg", "AS-1001") && !photoPathInScope("assessments/AS-1001/", "AS-1001") && !photoPathInScope("assessments/AS-1001/p q.jpg", "AS-1001"), "photos: path scope");
  ok(photoBlobPath("AS-1001", "p_abc") === "assessments/AS-1001/p_abc.jpg" && photoPathInScope(photoBlobPath("AS-1001", "p_abc"), "AS-1001") && PHOTO_PREFIX === "assessments/" && PHOTO_CAPS.perAssessment === 200 && PHOTO_CAPS.originalBytes === 25 * 1024 * 1024 && PHOTO_CAPS.longEdge === 1600 && PHOTO_CAPS.quality === 0.8, "photos: blob path + caps");
  // answers
  const aq = allQuestions(ASSESSMENT_DEF);
  const QD = (k: string) => aq.get(k)!.q;
  const V = (k: string, a: unknown, extra: Record<string, string[]> = {}) => validateAnswer(QD(k), a, ASSESSMENT_DEF, extra);
  const An = (v: unknown, extra: Partial<Answer> = {}) => ({ v, state: "answered", at: 1, by: "u", ...extra });
  ok(!V("core.space_type", An("arena")).ok, "answers: unknown option refused");
  ok(V("core.space_type", An("arena"), { space_type: ["arena"] }).ok, "answers: admin-added option allowed");
  ok(!V("core.seats", { state: "unable", at: 1, by: "u" }).ok && !V("core.seats", { state: "unable", reason: "", at: 1, by: "u" }).ok && !V("core.seats", { state: "unable", reason: "x".repeat(501), at: 1, by: "u" }).ok, "answers: unable needs reason (1–500)");
  const un = V("core.seats", { state: "unable", reason: "Locked room", v: 5, at: 1, by: "u" });
  ok(un.ok && un.answer.state === "unable" && un.answer.reason === "Locked room" && !("v" in un.answer), "answers: unable keeps the reason and drops v");
  const na = V("core.seats", { state: "na", v: 5, reason: "zz", at: 1, by: "u" });
  ok(na.ok && na.answer.state === "na" && !("v" in na.answer), "answers: n/a drops v");
  ok(!V("core.owner_concerns", An("x".repeat(5001))).ok && V("core.owner_concerns", An("x".repeat(5000))).ok, "answers: long text cap");
  const tr = V("core.owner_concerns", An("  hello  "));
  ok(tr.ok && tr.answer.v === "hello", "answers: text is trimmed");
  ok(!V("core.owner_concerns", An("   ")).ok && !V("core.owner_concerns", An("")).ok, "answers: whitespace-only answered text refused as empty");
  ok(!V("core.seats", An("12")).ok && !V("core.seats", An(Infinity)).ok && !V("core.seats", An(NaN)).ok && V("core.seats", An(0)).ok && V("core.seats", An(450)).ok, "answers: number must be finite");
  ok(!V("core.seats", { v: 1, state: "bogus", at: 1, by: "u" }).ok && !V("core.seats", null).ok && !V("core.seats", { v: 1, state: "answered", by: "u" }).ok && !V("core.seats", { v: 1, state: "answered", at: 1 }).ok, "answers: malformed envelope refused");
  const ynQ: QuestionDef = { key: "t.yn", label: "t", type: "yesno" };
  const mk = (q: QuestionDef, a: unknown, extra: Record<string, string[]> = {}) => validateAnswer(q, a, ASSESSMENT_DEF, extra);
  ok(mk(ynQ, An("yes")).ok && mk(ynQ, An("no")).ok && !mk(ynQ, An("maybe")).ok && !mk(ynQ, An(true)).ok, "answers: yesno");
  const ftQ: QuestionDef = { key: "t.ft", label: "t", type: "ftin" };
  ok(mk(ftQ, An({ ft: 12, in: 6.5 })).ok && !mk(ftQ, An({ ft: -1, in: 0 })).ok && !mk(ftQ, An({ ft: 1.5, in: 0 })).ok && !mk(ftQ, An({ ft: 1, in: 12 })).ok && !mk(ftQ, An({ ft: 1, in: -1 })).ok && mk(ftQ, An({ ft: 0, in: 11.99 })).ok && !mk(ftQ, An("5'6")).ok, "answers: ftin ranges");
  const dQ: QuestionDef = { key: "t.d", label: "t", type: "date" };
  ok(mk(dQ, An(1_700_000_000_000)).ok && !mk(dQ, An("2026-01-01")).ok && !mk(dQ, An(NaN)).ok, "answers: date is epoch ms");
  ok(QD("core.docs_available").type === "many", "answers: fixture sanity — docs_available is a many");
  const mv = V("core.docs_available", An(["maintenance_logs", "maintenance_logs", "prior_inspections"]));
  ok(mv.ok && JSON.stringify(mv.answer.v) === JSON.stringify(["maintenance_logs", "prior_inspections"]), "answers: many is deduped");
  ok(!V("core.docs_available", An(["maintenance_logs", "bogus"])).ok && !V("core.docs_available", An("maintenance_logs")).ok, "answers: many ⊆ options and must be an array");
  ok(V("core.docs_available", An(["maintenance_logs", "zzz"]), { docs: ["zzz"] }).ok, "answers: many allows admin extras");
  const none = V("core.docs_available", An(["none", "maintenance_logs"]));
  ok(!none.ok && (none as { error: string }).error === "\"None\" can't be combined with other choices" && V("core.docs_available", An(["none"])).ok && V("core.docs_available", An(["none", "none"])).ok, "answers: None can't be combined with others");
  const ct = QD("core.contact_primary");
  const cv = validateAnswer(ct, An({ name: "Ann", title: "Director", phone: "555", email: "a@b.c", junk: "drop" }), ASSESSMENT_DEF, {});
  ok(cv.ok && JSON.stringify(cv.answer.v) === JSON.stringify({ name: "Ann", title: "Director", phone: "555", email: "a@b.c" }), "answers: contact keeps known keys only");
  ok(!validateAnswer(ct, An({ title: "x" }), ASSESSMENT_DEF, {}).ok && !validateAnswer(ct, An({ name: "" }), ASSESSMENT_DEF, {}).ok && !validateAnswer(ct, An({ name: "x".repeat(201) }), ASSESSMENT_DEF, {}).ok && !validateAnswer(ct, An({ name: "A", phone: "9".repeat(201) }), ASSESSMENT_DEF, {}).ok && !validateAnswer(ct, An("Ann"), ASSESSMENT_DEF, {}).ok, "answers: contact needs a name; fields ≤ 200");
  const tq = QD("core.docs_detail");
  const col1 = tq.columns!.find((c) => c.type === "one")!;
  const optVal = ASSESSMENT_DEF.pickLists[col1.options!][0].value;
  const tv = validateAnswer(tq, An([{ [col1.key]: optVal, bogus: "drop" }]), ASSESSMENT_DEF, {});
  ok(tv.ok && Array.isArray(tv.answer.v) && !("bogus" in (tv.answer.v as Record<string, unknown>[])[0]) && (tv.answer.v as Record<string, unknown>[])[0][col1.key] === optVal, "answers: table drops unknown columns");
  ok(!validateAnswer(tq, An([{ [col1.key]: "nope" }]), ASSESSMENT_DEF, {}).ok && validateAnswer(tq, An([{ [col1.key]: "nope" }]), ASSESSMENT_DEF, { [col1.options!]: ["nope"] }).ok, "answers: table 'one' cells check the column pick list (+ extras)");
  ok(!validateAnswer(tq, An(Array.from({ length: 201 }, () => ({}))), ASSESSMENT_DEF, {}).ok && validateAnswer(tq, An(Array.from({ length: 200 }, () => ({}))), ASSESSMENT_DEF, {}).ok && !validateAnswer(tq, An({}), ASSESSMENT_DEF, {}).ok, "answers: table ≤ 200 rows, must be an array");
  const numCol = [...aq.values()].map((x) => x.q).find((q) => q.type === "table" && q.columns?.some((c) => c.type === "number"))!;
  const nk = numCol.columns!.find((c) => c.type === "number")!.key;
  ok(!validateAnswer(numCol, An([{ [nk]: "abc" }]), ASSESSMENT_DEF, {}).ok && validateAnswer(numCol, An([{ [nk]: 3 }]), ASSESSMENT_DEF, {}).ok, "answers: table number cells are validated");
  const ftCol = [...aq.values()].map((x) => x.q).find((q) => q.type === "table" && q.columns?.some((c) => c.type === "ftin"))!;
  const fk = ftCol.columns!.find((c) => c.type === "ftin")!.key;
  ok(!validateAnswer(ftCol, An([{ [fk]: { ft: 1, in: 13 } }]), ASSESSMENT_DEF, {}).ok && validateAnswer(ftCol, An([{ [fk]: { ft: 1, in: 6 } }]), ASSESSMENT_DEF, {}).ok, "answers: table ftin cells are validated");
  const withPhotos = V("core.seats", An(4, { photoIds: ["p1", "p1", "p2"] }));
  ok(withPhotos.ok && JSON.stringify(withPhotos.answer.photoIds) === JSON.stringify(["p1", "p2"]) && !V("core.seats", An(4, { photoIds: [1] as unknown as string[] })).ok, "answers: photoIds kept, deduped, strings only");
  const m = mergeAnswers({ a: { v: 1, state: "answered", at: 10, by: "s" }, b: { v: 1, state: "answered", at: 10, by: "s" } }, { a: { v: 2, state: "answered", at: 20, by: "c" }, b: { v: 2, state: "answered", at: 5, by: "c" }, c: { v: 3, state: "answered", at: 1, by: "c" } });
  ok(m.a.v === 2 && m.b.v === 1 && m.c.v === 3, "answers: per-key newest wins");
  const tie = mergeAnswers({ a: { v: "s", state: "answered", at: 10, by: "s" } }, { a: { v: "c", state: "answered", at: 10, by: "c" } });
  const inA: Answers = { a: { v: 1, state: "answered", at: 1, by: "s" } };
  mergeAnswers(inA, { a: { v: 2, state: "answered", at: 9, by: "c" } });
  ok(tie.a.v === "s" && inA.a.v === 1, "answers: ties keep server; inputs aren't mutated");
  // ---- fix round 1 ----
  // 1. clear marker
  const typeQ = (t: string) => [...aq.values()].map((x) => x.q).find((q) => q.type === t)!;
  const clearTypes = ["yesno", "one", "many", "number", "ftin", "date", "text", "longtext", "contact", "table"];
  const clearOk = clearTypes.every((t) => { const r = mk(typeQ(t), An(null)); return r.ok && r.answer.v === null && r.answer.state === "answered" && "v" in r.answer; });
  ok(clearOk, "answers: the clear marker (answered, v: null) is accepted for every answer type");
  ok(!mk(ynQ, { state: "answered", at: 1, by: "u" }).ok && !V("core.seats", { state: "answered", at: 1, by: "u" }).ok, "answers: a missing v is still refused (only an explicit null clears)");
  ok(!V("core.docs_available", An([])).ok && !mk(tq, An([])).ok && !mk(tq, An("")).ok && !V("core.owner_concerns", An("  ")).ok, "answers: [] many, [] table and blank text are refused (the editor sends the clear marker)");
  const mc = mergeAnswers({ a: { v: "old", state: "answered", at: 10, by: "s" }, b: { v: "keep", state: "answered", at: 10, by: "s" } }, { a: { v: null, state: "answered", at: 20, by: "c" }, b: { v: null, state: "answered", at: 5, by: "c" } });
  ok(mc.a.v === null && mc.a.at === 20 && mc.b.v === "keep", "answers: a newer clear marker overrides an older value; an older one does not");
  // 2. diacritics
  ok(suggestSiteCode("École Lincoln") === "ECO" && suggestSiteCode("Zoë") === "ZOE" && suggestCompanyCode("École Lincoln") === "EL" && suggestCompanyCode("Zoë") === "ZOE" && suggestSiteCode("Café Müller") === "CAF", "codes: diacritics are folded");
  // 3. caps
  ok(V("core.seats", An(4, { by: "u".repeat(100) })).ok && !V("core.seats", An(4, { by: "u".repeat(101) })).ok && !V("core.seats", An(4, { by: "" })).ok, "answers: by is 1–100 chars");
  ok(V("core.seats", An(4, { photoIds: ["p".repeat(100)] })).ok && !V("core.seats", An(4, { photoIds: ["p".repeat(101)] })).ok, "answers: a photo id is ≤ 100 chars");
  ok(V("core.seats", An(4, { photoIds: Array.from({ length: 50 }, (_, i) => "p" + i) })).ok && !V("core.seats", An(4, { photoIds: Array.from({ length: 51 }, (_, i) => "p" + i) })).ok, "answers: at most 50 photo ids");
  ok(V("core.seats", An(4, { at: 0 })).ok && V("core.seats", An(4, { at: 8.64e15 })).ok && !V("core.seats", An(4, { at: 8.64e15 + 2 })).ok && !V("core.seats", An(4, { at: -1 })).ok, "answers: at is 0 ≤ x ≤ 8.64e15");
  ok(mk(dQ, An(0)).ok && mk(dQ, An(8.64e15)).ok && !mk(dQ, An(8.64e15 + 2)).ok && !mk(dQ, An(-1)).ok, "answers: date is 0 ≤ x ≤ 8.64e15");
  ok(mk(ftQ, An({ ft: 10000, in: 0 })).ok && !mk(ftQ, An({ ft: 10001, in: 0 })).ok && !validateAnswer(ftCol, An([{ [fk]: { ft: 10001, in: 0 } }]), ASSESSMENT_DEF, {}).ok, "answers: ftin.ft ≤ 10000 (questions and table cells)");
  ok(V("core.seats", An(1e9)).ok && V("core.seats", An(-1e9)).ok && !V("core.seats", An(1e9 + 1)).ok && !V("core.seats", An(-1e9 - 1)).ok && !validateAnswer(numCol, An([{ [nk]: 1e9 + 1 }]), ASSESSMENT_DEF, {}).ok && validateAnswer(numCol, An([{ [nk]: 1e9 }]), ASSESSMENT_DEF, {}).ok, "answers: |number| ≤ 1e9 (questions and table cells)");
  // 4. robustness
  const wq: QuestionDef = { key: "t.w", label: "t", type: "weird" as unknown as QuestionDef["type"] };
  let threw = false; let wr: ReturnType<typeof mk> | undefined;
  try { wr = mk(wq, An("x")); } catch { threw = true; }
  ok(!threw && wr !== undefined && !wr.ok && (wr as { error: string }).error === "unknown answer type", "answers: an unknown question type → ok:false, never a throw");
  threw = false; const evil: boolean[] = [];
  try {
    for (const id of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      evil.push(mk({ key: "t.o", label: "t", type: "one", options: id }, An("x")).ok);
      evil.push(mk({ key: "t.m", label: "t", type: "many", options: id }, An(["x"])).ok);
    }
  } catch { threw = true; }
  ok(!threw && evil.length === 8 && evil.every((x) => !x), "answers: pick-list ids like 'constructor' / '__proto__' → ok:false, not a throw");
  const tcq: QuestionDef = { key: "t.tc", label: "t", type: "table", columns: [{ key: "c", label: "c", type: "one", options: "constructor" }] };
  let tcOk = true; try { tcOk = mk(tcq, An([{ c: "x" }])).ok; } catch { threw = true; }
  ok(!threw && !tcOk, "answers: a table column pick-list id of 'constructor' → ok:false, not a throw");
  // 5. merge keys
  const evilIn = JSON.parse('{"__proto__":{"v":1,"state":"answered","at":99,"by":"c"},"constructor":{"v":1,"state":"answered","at":99,"by":"c"},"prototype":{"v":1,"state":"answered","at":99,"by":"c"},"ok":{"v":2,"state":"answered","at":1,"by":"c"}}') as Answers;
  const evilSrv = JSON.parse('{"__proto__":{"v":0,"state":"answered","at":1,"by":"s"},"keep":{"v":3,"state":"answered","at":1,"by":"s"}}') as Answers;
  const me = mergeAnswers(evilSrv, evilIn);
  ok(Object.keys(me).sort().join() === "keep,ok" && Object.getPrototypeOf(me) === Object.prototype && ({} as Record<string, unknown>).v === undefined, "answers: merge skips __proto__ / constructor / prototype keys and never pollutes");
  const inh = JSON.parse('{"toString":{"v":1,"state":"answered","at":1,"by":"c"},"hasOwnProperty":{"v":2,"state":"answered","at":1,"by":"c"}}') as Answers;
  const mi = mergeAnswers({}, inh);
  ok((mi.toString as unknown as Answer).v === 1 && (mi.hasOwnProperty as unknown as Answer).v === 2, "answers: merge treats inherited names (toString…) as ordinary new keys");
  // 6. photo path
  ok(!photoPathInScope("assessments/AS-1001/p.png", "AS-1001") && !photoPathInScope("assessments/AS-1001/p", "AS-1001") && !photoPathInScope("assessments/AS-1001/p.jpg.exe", "AS-1001") && photoPathInScope("assessments/AS-1001/p_abc-Xy12.jpg", "AS-1001"), "photos: path must end in .jpg");
  ok(!photoPathInScope("assessments/AS-1001/.", "AS-1001") && !photoPathInScope("assessments/AS-1001/...", "AS-1001") && !photoPathInScope("assessments/AS-1001/.jpg", "AS-1001") && !photoPathInScope("assessments/AS-1001/..jpg", "AS-1001"), "photos: dots-only / dot-led remainders refused");
  ok(!photoPathInScope("assessments/../x.jpg", "..") && !photoPathInScope("assessments/./x.jpg", ".") && !photoPathInScope("assessments/AS-x/p.jpg", "AS-x") && !photoPathInScope("assessments/AS-/p.jpg", "AS-") && !photoPathInScope("assessments/AS-1001x/p.jpg", "AS-1001x") && photoPathInScope("assessments/AS-7/p.jpg", "AS-7"), "photos: assessment id must be AS-<digits>");
  // 7. csv
  ok(csvCell(-3) === "-3" && csvCell("-3") === "'-3" && csvCell(-0.5) === "-0.5" && csvCell(true) === "true" && csvCell(0) === "0", "csv: numbers are never guarded, strings are");
  ok(toCsv(["a"], [[-3]]) === "﻿a\r\n-3\r\n" && toCsv(["a"], [["-3"]]) === "﻿a\r\n'-3\r\n" && toCsv(["a"], [["x"]]).charCodeAt(0) === 0xfeff, "csv: BOM is U+FEFF; a numeric -3 stays -3");
  // carry-over: blank profile values never satisfy a numeric profile condition
  ok(!holds({ profile: "yr", lt: 1970 }, { ...hctx, profile: { yr: "  " } }) && !holds({ profile: "yr", lt: 1970 }, { ...hctx, profile: { yr: [] } }) && !holds({ profile: "yr", lt: 1970 }, { ...hctx, profile: { yr: NaN } }) && holds({ profile: "yr", lt: 1970 }, { ...hctx, profile: { yr: 1931 } }) && holds({ profile: "yr", lt: 1970 }, { ...hctx, profile: { yr: 0 } }), "holds: blank / [] / NaN profile value never satisfies lt");
}
export async function assessmentDbChecks(_ok: Ok) {}
if (process.argv[1] && /test-assessments\.ts$/.test(process.argv[1])) {
  let fail = 0; const ok: Ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  assessmentChecks(ok).then(() => { console.log(fail ? `${fail} FAIL` : "all PASS"); process.exit(fail ? 1 : 0); });
}
