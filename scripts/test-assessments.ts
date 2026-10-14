/* Assessments engine (#340) — harness checks. `assessmentChecks` is pure; `assessmentDbChecks` needs the
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
import { type PhotoRef, PHOTO_PREFIX, PHOTO_CAPS, photoBlobPath, photoPathInScope, photoPathMatches, PHOTO_ID_RE, newPhotoId, photoTooOld, PHOTO_MAX_AGE_MS, INLINE_TOTAL_MAX, INLINE_BLOB_MAX, inlinePhotoProblem, photoBackoffMs } from "../src/lib/assessments/photos";
import { scaledSize, photoFileProblem, HEIC_MESSAGE } from "../src/lib/assessments/photo-resize";
import { photoBytes } from "../src/lib/assessments/photo-bytes";
import coverage from "../docs/assessments/manitowoc-coverage.json";
import { like, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../src/db";
import { companies, sites, users as usersTable } from "../src/db/schema";
import { DOC_TABLES, SYNCABLE_COLLECTIONS, blobs } from "../src/db/doc-tables";
import { CONFIG_COLLECTIONS, DEMO_COLLECTIONS } from "../src/db/seed-data";
import { FIELD_COLLECTIONS, MAX_RETRIES, pushOutcome, retryOutcome } from "../src/lib/sync/engine";
import { saveCompany, getCompany, setCompanyShortCode } from "../src/lib/identity/companies";
import { saveSite, getSite, setSiteShortCode, docLocId } from "../src/lib/identity/sites";
import { registerFixture } from "./test-fixtures";
import { createAssessment, saveAssessment, applyFinalizedPhoto, removePendingPhoto, getAssessment, listAssessments, completeAssessment, reopenAssessment, pushAssessment, clearSyncRejects, checkAssessmentLinks, type Assessment } from "../src/lib/stores/assessments";
import {
  answeredWith, buildFullDoc, buildPatch, changedAnswers, clearMarker, contactValue, createEditorStore, dateInputToMs, editorReducer,
  formatValue, hiddenAnswered, initEditorState, msToDateInput, notApplicable, optionsFor, parseFtinInput, parseNumberInput,
  profileOnFile, reenterAnswer, refusalParts, rejectLabel, resolvedPromptIds, scopeSummaries, setScopeOn, showCounter, textAnswer,
  toggleMany, unableWith, flagsForScope, placePrompts, offScopesWithAnswers, formatRejectPayload, type EditorDoc, type FindingVM,
  placementScope, promptScope, PHOTO_LIMIT_MESSAGE, canAddPhoto, stuckPendingPhotos, findingFromPrompt, photosForQuestions,
  findingSheetProblems, findingSaveDoc, parseMoney, routingHref, mergeFindingLists, photoSetOfferDue, gapGroups,
  foldOutboxEntry, outboxEntryCovered, saveStatusLabel,
} from "../src/lib/assessments/editor-model";
import { mergePlan, splitPlan, newFindingKey, resolvedPromptIds as resolvedFromFindings, voidReasonProblem, codeChangeNeedsApprove, codeScopeMismatch, liveMergeTarget } from "../src/lib/assessments/findings-model";
import { normalizeFinding, saveFinding, getFinding, getFindings, listFindings, countOpenImmediateFindings, transitionFinding, linkQuote, voidFinding, allocatePrintedId, pushFinding, mergeFindings, splitFinding } from "../src/lib/stores/findings";
import { getVenueProfile, profileValues, writeProfileFacts } from "../src/lib/stores/venue-profiles";
import { ASSESSMENT_PICKLISTS_BLOB, slugValue, addPicklistValue, getPicklistExtras, setPicklistRetired, extrasForValidation } from "../src/lib/stores/assessment-picklists";
import { buildQuote, create as createQuote, get as getQuote, getMany as getQuotes, update as updateQuote } from "../src/lib/stores/quotes";
import { softDeleteDoc, upsertDoc } from "../src/db/doc-store";
import { CATEGORIES as REPAIR_CATEGORIES, PRIORITIES as REPAIR_PRIORITIES } from "../src/lib/stores/repair-jobs";
import type { SpecSection } from "../src/app/(app)/estimator/types";
import {
  ONE_VENUE_ERROR, QUOTE_FINDINGS_MAX, REPAIR_CATEGORY, findingLineText, findingsEstimatorSection, findingsSourceLabel, parseFindingKeys,
  quoteSelectionProblem, repairCategoryFor, repairPrefillFromFindings,
} from "../src/lib/assessments/findings-quote";
import { REGISTER_COLUMNS, parseRegisterFilters, registerCells, registerCsvName, registerList, registerQuery } from "../src/lib/assessments/register";
import { LINK_FAILED_NOTICE, OTHER_VENUE_NOTICE, findingKeysForSave, linkOnCreate, linkOnCreateSafe, quoteFromFindings } from "../src/lib/assessments/quote-from-findings";
import {
  EMAIL_INLINE_MAX_BYTES, EMAIL_PDF_MAX_BYTES, EMAIL_TOO_LARGE, EMAIL_TOO_LARGE_LOCAL, INLINE_TOTAL_BYTES, emailAttachmentMode, PHOTO_UNAVAILABLE, REPORT_SECTIONS, REPORT_WAIT_FOR, STANDING_LINE, assessmentPdfName,
  buildAssessmentReport, buildFindingsReport, contactText, documentsToRequest, fileNamePart, findingsPdfName, followUpGaps, inlinePhotoSources,
  liveKeeper, openFindings, reportAnswerText, reportEmailCopy, reportRegisterFindings, reportTable,
} from "../src/lib/assessments/report-model";
import { findingsPdfHref, parseFindingsScope } from "../src/lib/assessments/register";
import { assessmentIdOfPdfPath, assessmentPdfAttachment, assessmentPdfFitsThread, assessmentPdfPath, isAssessmentPdfFile, isAssessmentPdfPath } from "../src/lib/assessments/report-pdf-path";
import { attachmentHref, attachmentMimePart } from "../src/lib/comms-attachments";
import { signPrintToken, verifyPrintToken } from "../src/lib/quote-pdf/token";
import { VISIT_TYPES } from "../src/lib/assessments/defs";
import { NAV, activeKeyFor, parentGroupOf } from "../src/components/nav/nav-data";
import {
  assessmentCardRows, assessmentSearchResult, chicagoDay, confirmedLine, findingSearchResult, immediateOpenCount, isOpenFinding, listTitle,
  carryLeadId, matchesAssessment, matchesFinding, openRatingCounts, pickListAdminRows, profileFactRows, registerHref, startHref,
} from "../src/lib/assessments/integration";
import { quoteCoversVenue, quoteVenueIds } from "../src/lib/assessments/findings-quote";
import { searchDocs, setBlob } from "../src/db/doc-store";

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
  ok(photoBlobPath("AS-1001", "p_abc12345") === "assessments/AS-1001/p_abc12345.jpg" && photoPathInScope(photoBlobPath("AS-1001", "p_abc12345"), "AS-1001") && PHOTO_PREFIX === "assessments/" && PHOTO_CAPS.perAssessment === 200 && PHOTO_CAPS.originalBytes === 25 * 1024 * 1024 && PHOTO_CAPS.longEdge === 1600 && PHOTO_CAPS.quality === 0.8, "photos: blob path + caps");
  // Task 6 — resize maths, file refusals, inline photo shape
  const sz = (w: number, h: number) => JSON.stringify(scaledSize(w, h, 1600));
  ok(sz(4000, 3000) === '{"width":1600,"height":1200}' && sz(3000, 4000) === '{"width":1200,"height":1600}' && sz(800, 600) === '{"width":800,"height":600}' && sz(1600, 1600) === '{"width":1600,"height":1600}', "photo resize: long edge scales to 1600, never upscales");
  ok(sz(10000, 1) === '{"width":1600,"height":1}' && sz(0, 0) === '{"width":1,"height":1}', "photo resize: a sliver keeps at least 1 px");
  const fp = (name: string, type: string, size: number) => photoFileProblem({ name, type, size });
  ok(fp("a.jpg", "image/jpeg", 1000) === null && fp("a.png", "image/png", 1000) === null && fp("a", "", 1000) === null, "photo file: images (and an untyped camera file) are fine");
  ok(fp("a.heic", "image/heic", 10) === HEIC_MESSAGE && fp("IMG.HEIF", "", 10) === HEIC_MESSAGE && HEIC_MESSAGE === "HEIC isn't supported — set the camera to Most Compatible", "photo file: HEIC is refused with the camera hint");
  ok(fp("a.pdf", "application/pdf", 10) !== null && fp("a.jpg", "image/jpeg", 25 * 1024 * 1024 + 1) !== null && fp("a.jpg", "image/jpeg", 25 * 1024 * 1024) === null, "photo file: non-images and files over 25 MB are refused");
  const okJpeg = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]).toString("base64");
  ok(inlinePhotoProblem(okJpeg) === null && inlinePhotoProblem("data:image/png;base64,iVBORw0KGgo=") !== null && inlinePhotoProblem("data:image/jpeg;base64,AAAA") !== null && inlinePhotoProblem("data:image/jpeg;base64,/9j/" + "A".repeat(400 * 1024)) !== null && inlinePhotoProblem("data:image/jpeg;base64,/9j/ !!") !== null && inlinePhotoProblem(5 as never) !== null, "inline photo: JPEG magic, base64 body and ≤ 400 KB are all required");
  ok(photoBackoffMs(0) === 0 && photoBackoffMs(1) === 5000 && photoBackoffMs(2) === 10000 && photoBackoffMs(3) === 20000 && photoBackoffMs(7) === 300000 && photoBackoffMs(500) === 300000, "photo queue: backoff doubles from 5 s and is capped at 5 min");
  ok(photoPathMatches("assessments/AS-1001/p_abc12345.jpg", "AS-1001", "p_abc12345") && photoPathMatches("assessments/AS-1001/p_abc12345-Ab12Cd.jpg", "AS-1001", "p_abc12345"), "photo path: a photo's own file (with or without Blob's suffix) matches");
  ok(!photoPathMatches("assessments/AS-1001/p_abc123456.jpg", "AS-1001", "p_abc12345") && !photoPathMatches("assessments/AS-1001/p_zzz12345-Ab12.jpg", "AS-1001", "p_abc12345") && !photoPathMatches("assessments/AS-1001/p_abc12345x-Ab12.jpg", "AS-1001", "p_abc12345") && !photoPathMatches("assessments/AS-1002/p_abc12345.jpg", "AS-1001", "p_abc12345") && !photoPathMatches("assessments/AS-1001/p_abc12345.jpg", "AS-1001", "") && !photoPathMatches("assessments/AS-1001/../p_abc12345.jpg", "AS-1001", "p_abc12345"), "photo path: another photo's blob, a prefix-alike id or another assessment never matches");
  ok(!photoPathMatches("assessments/AS-1001/p_abc12345-def-x.jpg", "AS-1001", "p_abc12345") && !photoPathMatches("assessments/AS-1001/p_abc12345-.jpg", "AS-1001", "p_abc12345") && !photoPathMatches("assessments/AS-1001/p_abc12345-def67890.jpg", "AS-1001", "p_abc12345-def67890"), "photo path: aliasing refused — id abc can't claim abc-def's file, and an id with a hyphen is no id at all");
  ok(PHOTO_ID_RE.test("p_abc12345") && PHOTO_ID_RE.test("p_" + "a".repeat(32)) && !PHOTO_ID_RE.test("p_abc1234") && !PHOTO_ID_RE.test("p_" + "a".repeat(33)) && !PHOTO_ID_RE.test("p_abc-12345") && !PHOTO_ID_RE.test("P_abc12345") && !PHOTO_ID_RE.test("abc12345") && !PHOTO_ID_RE.test("p_abc12345\n"), "photo id: p_ + 8–32 lowercase letters/digits, no hyphen");
  const nid = Array.from({ length: 200 }, () => newPhotoId());
  ok(nid.every((x) => PHOTO_ID_RE.test(x) && x.length === 14) && new Set(nid).size === 200, "photo id: newPhotoId matches PHOTO_ID_RE and doesn't repeat");
  let badBlobPath = false;
  try { photoBlobPath("AS-1001", "p1"); } catch { badBlobPath = true; }
  ok(badBlobPath && photoBlobPath("AS-1001", "p_abc12345") === "assessments/AS-1001/p_abc12345.jpg", "photo path: photoBlobPath refuses a non-conforming id");
  ok(!photoTooOld(1000, 1000 + PHOTO_MAX_AGE_MS) && photoTooOld(1000, 1001 + PHOTO_MAX_AGE_MS) && PHOTO_MAX_AGE_MS === 7 * 86_400_000, "photo queue: an item older than 7 days is given up on");
  ok(INLINE_BLOB_MAX <= 200 * 1024 && Math.ceil(INLINE_BLOB_MAX * 4 / 3) + "data:image/jpeg;base64,".length + 8 < INLINE_TOTAL_MAX, "photo queue: the dev inline byte target (base64 + prefix) fits the store's 300 KB total cap");
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
  editorModelChecks(ok);
  task8Checks(ok);
  task9Checks(ok);
  await task10Checks(ok);
  task11Checks(ok);
  finalReviewChecks(ok);
  await finalReviewEmailChecks(ok);
}

/** Final whole-branch review fixes (I1 outbox loss, I3 the save-status label). Pure. */
function finalReviewChecks(ok: Ok) {
  const A = (v: unknown, at: number, by = "u1"): Answer => ({ v, state: "answered", at, by });
  // I1: a push reply's per-record outcome — retry stays pending, only a real refusal parks the entry
  ok(pushOutcome("retry") === "retry" && pushOutcome("ok") === "ok" && pushOutcome("conflict") === "conflict" && pushOutcome("error") === "error" && pushOutcome("weird") === "error" && pushOutcome(undefined) === "error", "final I1: push outcome — retry kept pending, unknown statuses park as error");
  ok(MAX_RETRIES === 10 && retryOutcome(1) === "retry" && retryOutcome(9) === "retry" && retryOutcome(10) === "park" && retryOutcome(11) === "park", "retry cap: 9 consecutive retries stay pending, the 10th parks as error");
  // I1: an errored / pending outbox entry is folded in as dirty work, original `at` kept
  const server = initEditorState(editorDoc({ answers: { "core.seats": A(200, 10) }, dismissedPrompts: [{ id: "rule:R1", by: "u1", at: 1 }], spaceLabel: "Aud" }));
  const entry = {
    id: "AS-1001", rev: 4, answers: { "core.seats": A(300, 20), "core.use": A(["school"], 15), "core.year_built": A(1950, 5) },
    photos: [{ id: "p_fold0001", pending: true, takenAt: 7, by: "u1", questionKey: "core.seats" }],
    dismissedPrompts: [{ id: "rule:R1", by: "u1", at: 1 }, { id: "rule:R10", by: "u1", at: 9 }], spaceLabel: "Lab",
  };
  const folded = foldOutboxEntry(server, entry);
  const fp = buildPatch(folded)!;
  ok(!!fp && Object.keys(fp.answers!).sort().join() === "core.seats,core.use,core.year_built" && fp.answers!["core.seats"].at === 20 && fp.answers!["core.use"].at === 15, "final I1: folded answers are dirty (the next save carries them) and keep their original at");
  ok(fp?.photos?.map((x) => x.id).join() === "p_fold0001" && fp?.dismissedPrompts?.map((x) => x.id).join() === "rule:R10" && fp?.spaceLabel === "Lab", "final I1: folded photo refs, dismissed prompts and a fresh scalar travel with the next save");
  const older = foldOutboxEntry(server, { rev: 4, answers: { "core.seats": A(100, 5) } });
  ok(older === server && buildPatch(older) === null, "final I1: an entry answer older than the server's changes nothing");
  const staleScalar = foldOutboxEntry(server, { rev: 3, spaceLabel: "Old room" });
  ok(staleScalar.doc.spaceLabel === "Aud" && !staleScalar.dirty.includes("spaceLabel") && staleScalar.dropped.includes("spaceLabel"), "final I1: a scalar queued on an older rev isn't forced over the server's; it is reported dropped");
  ok(foldOutboxEntry(server, { rev: 4, answers: { "core.seats": A(200, 10) } }) === server, "final I1: an entry the server already holds folds to the same state");
  ok(buildPatch(editorReducer(server, { type: "foldOutbox", entry }))!.answers!["core.use"].at === 15, "final I1: the foldOutbox action folds the entry");
  // I1: the online save may only clear an entry it covered
  ok(!outboxEntryCovered(entry, server), "final I1: before any save the entry is not covered (an online save keeps it)");
  // the bug: an errored entry, an unrelated online save — the save didn't carry the entry, so it must stay
  let unrelated = editorReducer(server, { type: "answer", key: "core.notes", answer: A("x", 30) });
  const up = buildPatch(unrelated)!;
  unrelated = editorReducer(unrelated, { type: "saved", patch: up, rev: 4 });
  ok(!outboxEntryCovered(entry, unrelated), "final I1: an online save that didn't fold the entry does not cover it (recordSynced keeps it)");
  const savedFold = editorReducer(folded, { type: "saved", patch: fp, rev: 4 });
  ok(outboxEntryCovered(entry, savedFold), "final I1: after the folded save is acknowledged, the entry is covered and may be cleared");
  const inFlightEdit = editorReducer(folded, { type: "answer", key: "core.use", answer: A(["community"], 40) });
  ok(outboxEntryCovered(entry, editorReducer(inFlightEdit, { type: "saved", patch: buildPatch(inFlightEdit)!, rev: 4 })), "final I1: a newer local edit, once saved, covers the entry's older answer");
  const photoOnly = { rev: 4, photos: [{ id: "p_gone0001", pending: true, takenAt: 1, by: "u1" }] };
  ok(!outboxEntryCovered(photoOnly, server) && outboxEntryCovered(photoOnly, server, ["p_gone0001"]), "final I1: an entry photo the editor never held keeps the entry, unless it was removed here");
  ok(!outboxEntryCovered({ rev: 4, answers: { "core.seats": A(999, 10) } }, server), "final I1: same at but different content is not covered");
  ok(outboxEntryCovered({ rev: 4, answers: { "core.seats": A(200, 10, "someone") } }, server), "final I1: the server's own answer (by differs) is covered");
  ok(!outboxEntryCovered({ rev: 4, spaceLabel: "Lab" }, folded) && outboxEntryCovered({ rev: 3, spaceLabel: "Old room" }, staleScalar), "final I1: a dirty scalar keeps the entry; a dropped one doesn't");
  // the editor wires it: fold on mount, every save waits for it, keepOutbox guards recordSynced
  const ed = readFileSync(join(ROOT, "src/app/(app)/assessments/[id]/editor.tsx"), "utf8");
  ok(/outboxEntry\("assessments", id\)/.test(ed) && /type: "foldOutbox"/.test(ed) && /await outboxFolded\.current/.test(ed) && /keepOutbox: \(entryDoc\) => !outboxEntryCovered\(/.test(ed), "final I1: the editor folds this device's entry before saving and guards recordSynced with keepOutbox");
  const sv = readFileSync(join(ROOT, "src/lib/sync/save.ts"), "utf8");
  const en = readFileSync(join(ROOT, "src/lib/sync/engine.ts"), "utf8");
  ok(/keepEntry: opts\.keepOutbox/.test(sv) && /!opts\?\.keepEntry\?\.\(entry\.doc\)/.test(en), "final I1: saveThroughOutbox passes keepOutbox to recordSynced, which keeps an uncovered entry");

  // I3: the save-status label
  type LI = Parameters<typeof saveStatusLabel>[0];
  const L = (local: LI["local"], connected: boolean, entry: LI["entry"]) => saveStatusLabel({ local, connected, entry }).text;
  const DEVICE = "Saved on this device — will sync when you're back online";
  ok(L("saved", true, null) === "Saved" && L("queued", true, null) === "Saved", "final I3: online, nothing queued → Saved (also once a queued save drained)");
  ok(L("queued", false, { state: "pending" }) === DEVICE && L("idle", false, { state: "pending" }) === DEVICE, "final I3: queued and offline → saved on this device");
  ok(L("queued", false, null) === DEVICE, "final I3: just queued offline, before the outbox read lands → still saved on this device (never a premature Saved)");
  ok(L("queued", true, { state: "pending" }) === "Syncing…" && L("saved", true, { state: "pending" }) === "Syncing…", "final I3: queued and online → Syncing…");
  ok(L("saved", true, { state: "error", error: "Assessment belongs to a different venue" }) === "Couldn't sync — Assessment belongs to a different venue" && saveStatusLabel({ local: "idle", connected: false, entry: { state: "error" } }).tone === "error", "final I3: errored → Couldn't sync — <error>");
  ok(L("idle", false, { state: "error" }) === "Couldn't sync — the server refused it", "final I3: an errored entry with no reason still says why it's shown");
  ok(L("saved", false, null) === "Saved" && L("idle", true, null) === "" && L("saving", true, { state: "pending" }) === "Saving…" && L("error", true, null) === "Not saved", "final I3: saving / not saved / idle");
  ok(/saveStatusLabel\(\{ local: saveState, connected: sync\.connected, entry: sync\.entry \}\)/.test(ed) && /engine\.subscribe\(load\)/.test(ed) && !ed.includes(`"queued" ? "Saved on this device`), "final I3: the editor's label comes from saveStatusLabel, re-read on every SyncEngine change");
}

/** Final review I2: Email report stores the PDF in Blob and attaches it by reference; inline only without Blob. */
async function finalReviewEmailChecks(ok: Ok) {
  // the path guard
  const P = "assessment-pdfs/AS-1001/1760000000000.pdf";
  ok(isAssessmentPdfPath(P) && isAssessmentPdfPath("assessment-pdfs/AS-1001/1760000000000-Ab12Cd34Ef.pdf") && assessmentIdOfPdfPath(P) === "AS-1001", "final I2: a stored report path (with or without Blob's suffix) passes and names its assessment");
  for (const bad of ["assessment-pdfs/AS-1001/../x.pdf", "assessment-pdfs/AS-1/1760000000000.pdf", "assessment-pdfs/AS-1001/report.pdf", "assessment-pdfs/AS-1001/1760000000000.pdf.exe", "quote-pdfs/Q-1/1760000000000.pdf", "assessments/AS-1001/1760000000000.pdf", "/assessment-pdfs/AS-1001/1760000000000.pdf", "assessment-pdfs/AS-1001/sub/1760000000000.pdf"])
    ok(!isAssessmentPdfPath(bad) && assessmentIdOfPdfPath(bad) === null, `final I2: path guard refuses ${bad}`);
  ok(isAssessmentPdfFile("1760000000000.pdf") && isAssessmentPdfFile("1760000000000-x9.pdf") && !isAssessmentPdfFile("../1760000000000.pdf") && !isAssessmentPdfFile("a/1760000000000.pdf") && !isAssessmentPdfFile("x.pdf"), "final I2: the download route's ?file= is a bare stored file name");
  ok(assessmentPdfPath("AS-1001", 1760000000000.7) === P, "final I2: new reports go to assessment-pdfs/<AS-id>/<ms>.pdf");
  let threw = false;
  try { assessmentPdfPath("../AS-1", 1); } catch { threw = true; }
  ok(threw, "final I2: a malformed assessment id never makes a path");
  // the by-reference attachment shape
  const att = assessmentPdfAttachment("AS-1001", "Assessment AS-1001 — Hall.pdf", 3_000_000, P);
  ok(att.pdfPath === P && att.href === "/api/assessments/AS-1001/report-pdf?file=1760000000000.pdf&download=1" && att.mime === "application/pdf" && att.size === 3_000_000 && !("dataUrl" in att), "final I2: the draft attachment carries pdfPath + a team download href, never the bytes");
  threw = false;
  try { assessmentPdfAttachment("AS-1002", "x.pdf", 1, P); } catch { threw = true; }
  ok(threw, "final I2: an attachment for another assessment's folder is refused");
  ok(attachmentHref(att) === att.href, "final I2: the Inbox reader links the stored copy");
  const reads: string[] = [];
  const part = await attachmentMimePart(att, async (p) => { reads.push(p); return Buffer.from("%PDF-1.7"); });
  ok(part?.dataBase64 === Buffer.from("%PDF-1.7").toString("base64") && part.mime === "application/pdf" && reads.join() === P, "final I2: the sender builds the MIME part from the stored bytes");
  // which threads may read it
  ok(assessmentPdfFitsThread(P, { customerId: "c1", link: null }, "c1") && !assessmentPdfFitsThread(P, { customerId: "c2", link: null }, "c1"), "final I2: a thread for the assessment's customer reads it; another customer's doesn't");
  ok(assessmentPdfFitsThread(P, { customerId: null, link: null }, "c1") && !assessmentPdfFitsThread(P, { customerId: null, link: { type: "lead", id: "L-1" } }, "c1"), "final I2: an unlinked thread with no customer reads it; a linked one without a customer doesn't");
  ok(!assessmentPdfFitsThread(P, { customerId: "c1", link: { type: "quote", id: "Q-1" } }, "c1") && !assessmentPdfFitsThread(P, { customerId: "c1" }, null) && !assessmentPdfFitsThread("quote-pdfs/Q-1/1.pdf", { customerId: "c1" }, "c1"), "final I2: never on a quote thread, for a missing assessment, or for a non-assessment path");
  // the cap
  ok(EMAIL_INLINE_MAX_BYTES === 1.5 * 1024 * 1024 && EMAIL_TOO_LARGE_LOCAL === "Report is too large to email from this computer — download it instead", "final I2: 1.5 MB inline cap and its wording");
  ok(emailAttachmentMode(5 * 1024 * 1024, true).mode === "reference" && emailAttachmentMode(100, true).mode === "reference", "final I2: with Blob every report rides by reference");
  const over = emailAttachmentMode(EMAIL_PDF_MAX_BYTES + 1, true);
  ok(over.mode === "refuse" && over.error === EMAIL_TOO_LARGE, "final I2: past 10 MB it is refused even with Blob");
  const local = emailAttachmentMode(EMAIL_INLINE_MAX_BYTES + 1, false);
  ok(emailAttachmentMode(EMAIL_INLINE_MAX_BYTES, false).mode === "inline" && local.mode === "refuse" && local.error === EMAIL_TOO_LARGE_LOCAL, "final I2: without Blob it rides inline up to 1.5 MB, then refuses");
  // wiring
  const act = readFileSync(join(ROOT, "src/app/(app)/assessments/[id]/report/actions.ts"), "utf8");
  ok(/emailAttachmentMode\(r\.pdf\.length, blobEnabled\(\)\)/.test(act) && /storeAssessmentPdf\(a\.id, r\.pdf/.test(act) && /assessmentPdfAttachment\(/.test(act) && act.indexOf("dataUrl") > act.indexOf('plan.mode === "reference"'), "final I2: Email report stores + attaches by reference, inline only in the no-Blob branch");
  const br = readFileSync(join(ROOT, "src/lib/gmail/bridge.ts"), "utf8");
  ok(/isAssessmentPdfPath\(path\)/.test(br) && /assessmentPdfFitsThread\(path, t, a\?\.customerId \?\? null\) \? readAssessmentPdf\(path\)/.test(br), "final I2: the Gmail bridge reads an assessment PDF only when it fits the thread, from Blob");
  const rt = readFileSync(join(ROOT, "src/app/api/assessments/[id]/report-pdf/route.ts"), "utf8");
  ok(/isAssessmentPdfFile\(file\)/.test(rt) && /streamAssessmentPdf\(`assessment-pdfs\/\$\{id\}\/\$\{file\}`\)/.test(rt), "final I2: the report route serves a stored copy by ?file=, guarded");
}

/** Identity fixtures for the assessment DB checks (ids prefixed `TESTassess:`). Task 5+ reuse these. */
export const ASSESS_FIX = { co1: "TESTassess:co1", co2: "TESTassess:co2", site1: "TESTassess:site1", site2: "TESTassess:site2", site3: "TESTassess:site3" } as const;
export async function assessIdentityFixtures() {
  await dropAssessIdentityFixtures();
  for (const [id, name] of [[ASSESS_FIX.co1, "Assess Co One"], [ASSESS_FIX.co2, "Assess Co Two"]] as const)
    await saveCompany({ id, name, type: "customer", lifecycle: "active", deleted: false });
  await saveSite({ id: ASSESS_FIX.site1, companyId: ASSESS_FIX.co1, name: "Assess Hall", locationName: "Assess Hall", venueKind: "proscenium" });
  await saveSite({ id: ASSESS_FIX.site2, companyId: ASSESS_FIX.co1, name: "Assess Gym", locationName: "Assess Gym", venueKind: "proscenium" });
  await saveSite({ id: ASSESS_FIX.site3, companyId: ASSESS_FIX.co2, name: "Assess Other", locationName: "Assess Other", venueKind: "proscenium" });
}
export async function dropAssessIdentityFixtures() {
  const db = await getDb();
  await db.delete(sites).where(like(sites.id, "TESTassess:%"));
  await db.delete(companies).where(like(companies.id, "TESTassess:%"));
}

export async function assessmentDbChecks(ok: Ok) {
  // registration + pins
  for (const c of ["assessments", "findings", "venue_profiles"]) ok(c in DOC_TABLES, `assess db: ${c} is a registered doc collection`);
  ok(SYNCABLE_COLLECTIONS.slice(-2).join() === "assessments,findings" && FIELD_COLLECTIONS.slice(-2).join() === "assessments,findings", "assess db: assessments + findings appended to SYNCABLE and FIELD collections in the same order");
  ok(!(SYNCABLE_COLLECTIONS as string[]).includes("venue_profiles") && CONFIG_COLLECTIONS.includes("venue_profiles" as never), "assess db: venue_profiles is config (kept through the go-live wipe), not syncable");
  const db = await getDb();
  try {
    await assessIdentityFixtures();
    const { co1, co2, site1, site2, site3 } = ASSESS_FIX;
    // migration 0040: the three tables exist, seq bumps on update
    for (const t of ["assessments", "findings", "venue_profiles"]) {
      const r = await db.execute(sql.raw(`select count(*)::int as n from "${t}"`));
      ok((r.rows[0] as { n: number }).n >= 0, `assess db: table ${t} exists`);
    }
    const trg = await db.execute(sql`select tgname from pg_trigger where tgname in ('assessments_seq_bump','findings_seq_bump','venue_profiles_seq_bump')`);
    ok(trg.rows.length === 3, "assess db: three seq-bump triggers installed");
    // company codes
    ok((await getCompany(co1))!.shortCode === null, "codes db: a new company has a null short code");
    ok((await setCompanyShortCode(co1, "TSTA")).ok && (await getCompany(co1))!.shortCode === "TSTA", "codes db: set company code");
    const dup = await setCompanyShortCode(co2, "TSTA");
    ok(!dup.ok && dup.error === "That code is already used by another company", "codes db: company code unique (exact)");
    let pgCode = "";
    try { await db.update(companies).set({ shortCode: "tsta" }).where(eq(companies.id, co2)); } catch (e) { pgCode = String((e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? ""); }
    ok(pgCode === "23505", "codes db: company code unique case-insensitively (index on lower(short_code))");
    const bad = await setCompanyShortCode(co2, "tsta");
    ok(!bad.ok && bad.error === "That code is already used by another company", "codes db: a lowercase code is normalised (tsta → TSTA) and still collides");
    ok(!(await setCompanyShortCode(co2, "A")).ok && !(await setCompanyShortCode(co2, "TOOLONG7")).ok && !(await setCompanyShortCode(co2, "AB-C")).ok, "codes db: CODE_RE bounds enforced");
    ok((await getCompany(co2))!.shortCode === null, "codes db: a failed set leaves the code untouched");
    await saveCompany({ ...(await getCompany(co1))!, name: "Renamed" });
    ok((await getCompany(co1))!.shortCode === "TSTA" && (await getCompany(co1))!.name === "Renamed", "codes db: regular save never clears short code");
    await saveCompany({ ...(await getCompany(co1))!, shortCode: "ZZZZ" });
    ok((await getCompany(co1))!.shortCode === "TSTA", "codes db: regular save never writes short code either");
    await saveCompany({ id: co1, name: "Renamed", type: "customer", lifecycle: "active", deleted: false });
    ok((await getCompany(co1))!.shortCode === "TSTA", "codes db: a save with no shortCode key keeps it");
    await saveCompany({ id: "TESTassess:co3", name: "Assess Co Three", type: "customer", lifecycle: "active", deleted: false, shortCode: "NOPE" });
    ok((await getCompany("TESTassess:co3"))!.shortCode === null, "codes db: insert strips shortCode (null on create)");
    ok((await setCompanyShortCode(co1, null)).ok && (await getCompany(co1))!.shortCode === null, "codes db: null clears the company code");
    ok((await setCompanyShortCode(co2, "TSTA")).ok, "codes db: a cleared code is free again");
    // site codes (unique per company)
    ok((await setSiteShortCode(site1, "HAL")).ok && (await getSite(site1))!.shortCode === "HAL", "codes db: set site code");
    ok(!(await setSiteShortCode(site1, "h")).ok && (await getSite(site1))!.shortCode === "HAL", "codes db: a malformed site code is rejected and leaves the old one");
    const sdup = await setSiteShortCode(site2, "HAL");
    ok(!sdup.ok && sdup.error === "That code is already used by another venue of this company", "codes db: site code unique within a company");
    ok((await setSiteShortCode(site3, "HAL")).ok, "codes db: the same site code is fine under a different company");
    let sCode = "";
    try { await db.update(sites).set({ shortCode: "hal" }).where(eq(sites.id, site2)); } catch (e) { sCode = String((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code ?? ""); }
    ok(sCode === "23505", "codes db: site code unique case-insensitively within a company");
    await saveSite({ ...(await getSite(site1))!, name: "Assess Hall 2" });
    ok((await getSite(site1))!.shortCode === "HAL", "codes db: regular site save never clears short code");
    await saveSite({ ...(await getSite(site1))!, shortCode: "ZZZ" });
    ok((await getSite(site1))!.shortCode === "HAL", "codes db: regular site save never writes short code");
    ok((await setSiteShortCode(site1, null)).ok && (await getSite(site1))!.shortCode === null, "codes db: null clears the site code");
    // soft-deleted rows do not hold a code
    await setSiteShortCode(site1, "HAL");
    await db.update(sites).set({ deleted: true }).where(eq(sites.id, site1));
    ok((await setSiteShortCode(site2, "HAL")).ok, "codes db: a soft-deleted venue does not hold its code");
  } finally {
    await dropAssessIdentityFixtures();
  }
  await assessmentStoreChecks(ok);
  await assessmentPhotoDbChecks(ok);
  await assessmentEditorDbChecks(ok);
  await task8DbChecks(ok);
  await task9DbChecks(ok);
  await task11DbChecks(ok);
  await finalReviewPushDbChecks(ok);
  await finalReviewMinorDbChecks(ok);
}

/** Final review I1: a push that throws replies `retry` (the device keeps the entry pending). */
async function finalReviewPushDbChecks(ok: Ok) {
  const db = await getDb();
  const created: string[] = [];
  const PU = { id: "u1", roles: ["Estimator"] };
  try {
    await assessIdentityFixtures();
    const a = await createAssessment({ visitType: "condition", customerId: ASSESS_FIX.co1, siteId: ASSESS_FIX.site1, visitDate: Date.now(), assessorId: "u1" }, "u1");
    created.push(a.id); registerFixture("assessments", a.id);
    // a throw is `retry`; a permanent refusal stays `error`
    const throwing = { get answers(): unknown { throw new Error("database went away"); } } as unknown as Record<string, unknown>;
    const pThrow = await pushAssessment({ id: a.id, rev: 2, doc: throwing }, PU);
    ok(pThrow.status === "retry" && typeof pThrow.error === "string", "final I1: a push that throws replies retry, not error");
    ok((await pushAssessment({ id: "AS-999999", rev: 2, doc: {} }, PU)).status === "error" && (await pushAssessment({ id: a.id, rev: 2, doc: {} }, { id: "u9", roles: [] })).status === "error", "final I1: an unknown id or no permission is still a permanent error");
    const fThrow = await pushFinding({ id: "fd_frv0000000000099", rev: 1, doc: throwing }, PU);
    ok(fThrow.status === "retry", "final I1: a finding push that throws replies retry too");
    const route = readFileSync(join(ROOT, "src/app/api/sync/push/route.ts"), "utf8");
    ok(/"ok" \| "conflict" \| "error" \| "retry"/.test(route), "final I1: the push route's reply type carries retry");
  } finally {
    if (created.length) await db.delete(DOC_TABLES.assessments).where(inArray(DOC_TABLES.assessments.id, created));
    await dropAssessIdentityFixtures();
  }
}

/** Final review minors: printed-id prefix (M1), unknown-answer caps (M3), create links (M4). */
async function finalReviewMinorDbChecks(ok: Ok) {
  const db = await getDb();
  const created: string[] = [];
  const fk = (n: number) => `fd_frv${String(n).padStart(13, "0")}`;
  const U1 = { id: "u1" };
  const PU = { id: "u1", roles: ["Estimator"] };
  const USER_ON = "TESTassess:u-on", USER_OFF = "TESTassess:u-off";
  const LINKS = { lead1: "TESTassess:lead1", lead2: "TESTassess:lead2", leadNone: "TESTassess:lead3", proj1: "TESTassess:proj1", proj2: "TESTassess:proj2", visit1: "TESTassess:visit1", visit2: "TESTassess:visit2" };
  try {
    await assessIdentityFixtures();
    const { co1, co2, site1, site2 } = ASSESS_FIX;
    const mkA = async (siteId: string) => {
      const a = await createAssessment({ visitType: "condition", customerId: co1, siteId, visitDate: Date.now(), assessorId: "u1" }, "u1");
      created.push(a.id); registerFixture("assessments", a.id);
      return a;
    };
    const a = await mkA(site1);

    // M3: at most 100 unknown answer keys and 200 KB of unknown answers per assessment
    const now = Date.now();
    const unk = (n: number, from = 0, size = 10) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`future.m3k${from + i}`, { v: "x".repeat(size), state: "answered", at: now }])) as unknown as Answers;
    const tooMany = await saveAssessment(a.id, { answers: unk(101) }, U1);
    ok(!tooMany.ok && /100/.test((tooMany as { error: string }).error), "final M3: action mode refuses a save past 100 unknown answer keys");
    ok(Object.keys((await getAssessment(a.id))!.answers).filter((k) => k.startsWith("future.m3k")).length === 0, "final M3: a refused save stores none of them");
    ok((await saveAssessment(a.id, { answers: unk(100) }, U1)).ok, "final M3: exactly 100 unknown keys is fine");
    ok((await saveAssessment(a.id, { answers: unk(5, 0, 12) }, U1)).ok, "final M3: re-answering a stored unknown key doesn't count as a new one");
    const p101 = await pushAssessment({ id: a.id, rev: 99, doc: { answers: unk(3, 100) } }, PU);
    const afterPush = (await getAssessment(a.id))!;
    ok(p101.status === "ok" && Object.keys(afterPush.answers).filter((k) => k.startsWith("future.m3k")).length === 100 && afterPush.syncRejects?.filter((r) => r.key.startsWith("future.m3k10")).length === 3, "final M3: push mode keeps the cap and records each extra key in syncRejects");
    const b = await mkA(site1);
    const big = (n: number) => unk(n, 500, 19_000);
    const tooBig = await saveAssessment(b.id, { answers: big(11) }, U1);
    ok(!tooBig.ok && /200 KB/.test((tooBig as { error: string }).error), "final M3: action mode refuses past 200 KB of unknown answers");
    ok((await saveAssessment(b.id, { answers: big(10) }, U1)).ok, "final M3: under 200 KB saves");
    const pBig = await pushAssessment({ id: b.id, rev: 99, doc: { answers: unk(1, 600, 19_000) } }, PU);
    const bAfter = (await getAssessment(b.id))!;
    ok(pBig.status === "ok" && !("future.m3k600" in bAfter.answers) && bAfter.syncRejects?.some((r) => r.key === "future.m3k600" && /200 KB/.test(r.error)) === true, "final M3: push mode records an answer past 200 KB instead of storing it");
    ok((await saveAssessment(b.id, { answers: { "core.seats": { v: 300, state: "answered", at: now, by: "u1" } } }, U1)).ok, "final M3: known questions are never capped");

    // M1: the printed number is unique per printed prefix, across a venue code change
    ok((await setCompanyShortCode(co1, "FRV")).ok && (await setSiteShortCode(site1, "LIN")).ok, "final M1: fixtures — company FRV, venue LIN");
    const mk = (n: number, at: Assessment) => saveFinding({ key: fk(n), customerId: at.customerId, siteId: at.siteId, assessmentId: at.id, category: "RIG", rating: "needs", description: `M1 finding ${n}` }, U1);
    const n1 = await mk(1, a), n2 = await mk(2, a), n3 = await mk(3, a);
    ok(n1.ok && n2.ok && n3.ok && n3.doc.printedId === "FRV-LIN-RIG-003", "final M1: three LIN findings numbered 001–003");
    await voidFinding(fk(2), "dup", U1);
    await softDeleteDoc("findings", fk(3));
    ok((await setSiteShortCode(site1, "LN2")).ok && (await setSiteShortCode(site2, "LIN")).ok, "final M1: venue one's code changes LIN → LN2; venue two takes LIN");
    const a2 = await mkA(site2);
    const n4 = await mk(4, a2);
    ok(n4.ok && n4.doc.printedId === "FRV-LIN-RIG-004", "final M1: the new LIN venue's first finding is numbered after the old LIN findings (voided and deleted included)");
    const n5 = await mk(5, a);
    ok(n5.ok && n5.doc.printedId === "FRV-LN2-RIG-004", "final M1: the renamed venue keeps counting its own findings under its new prefix");
    const fsrc = readFileSync(join(ROOT, "src/lib/stores/findings.ts"), "utf8");
    ok(/withAdvisoryLock\(ASSESSMENT_LOCK_NAMESPACE, `printed:\$\{prefix\}`[\s\S]{0,200}withAdvisoryLock\(ASSESSMENT_LOCK_NAMESPACE, `\$\{f\.customerId\}:\$\{f\.siteId\}:\$\{f\.category\}`/.test(fsrc), "final M1: allocation takes the prefix lock, then the venue lock");

    // M4: createAssessmentAction's links
    await db.insert(usersTable).values([
      { id: USER_ON, name: "Assess On", email: "assess-on@example.test", roles: ["Estimator"], color: "#333333", initials: "AO", status: "active", createdAt: now },
      { id: USER_OFF, name: "Assess Off", email: "assess-off@example.test", roles: ["Estimator"], color: "#333333", initials: "AF", status: "archived", createdAt: now },
    ]).onConflictDoNothing();
    await upsertDoc("leads", { id: LINKS.lead1, customerId: co1 });
    await upsertDoc("leads", { id: LINKS.lead2, customerId: co2 });
    await upsertDoc("leads", { id: LINKS.leadNone, customerId: null });
    await upsertDoc("projects", { id: LINKS.proj1, customerId: co1 });
    await upsertDoc("projects", { id: LINKS.proj2, customerId: co2 });
    await upsertDoc("site_visits", { id: LINKS.visit1, customerId: co1 });
    await upsertDoc("site_visits", { id: LINKS.visit2, customerId: co2 });
    const L = (o: Partial<{ assessorId: string; leadId: string; visitId: string; projectId: string }>) => checkAssessmentLinks({ customerId: co1, assessorId: USER_ON, ...o });
    ok((await L({})) === null && (await L({ leadId: LINKS.lead1, visitId: LINKS.visit1, projectId: LINKS.proj1 })) === null, "final M4: an active assessor and the customer's own lead / visit / project pass");
    ok((await L({ assessorId: USER_OFF })) === "Choose an active assessor" && (await L({ assessorId: "TESTassess:nobody" })) === "Choose an active assessor", "final M4: an archived or unknown assessor is refused");
    ok((await L({ leadId: "TESTassess:nolead" })) === "That lead wasn't found" && (await L({ leadId: LINKS.lead2 })) === "That lead belongs to a different customer", "final M4: a missing lead, or another customer's, is refused");
    ok((await L({ visitId: "TESTassess:novisit" })) === "That site visit wasn't found" && (await L({ visitId: LINKS.visit2 })) === "That site visit belongs to a different customer", "final M4: a missing site visit, or another customer's, is refused");
    ok((await L({ projectId: "TESTassess:noproj" })) === "That project wasn't found" && (await L({ projectId: LINKS.proj2 })) === "That project belongs to a different customer", "final M4: a missing project, or another customer's, is refused");
    ok((await L({ leadId: LINKS.leadNone })) === null, "final M4: a lead with no customer yet may be linked (it can't belong to another one)");
    const act = readFileSync(join(ROOT, "src/app/(app)/assessments/new/actions.ts"), "utf8");
    ok(/await checkAssessmentLinks\(/.test(act) && act.indexOf("checkAssessmentLinks(") < act.indexOf("createAssessment("), "final M4: createAssessmentAction checks the links before creating");
  } finally {
    await db.delete(DOC_TABLES.findings).where(like(DOC_TABLES.findings.id, "fd_frv%"));
    if (created.length) await db.delete(DOC_TABLES.assessments).where(inArray(DOC_TABLES.assessments.id, created));
    for (const c of ["leads", "projects", "site_visits"] as const) await db.delete(DOC_TABLES[c]).where(like(DOC_TABLES[c].id, "TESTassess:%"));
    await db.delete(usersTable).where(like(usersTable.id, "TESTassess:%"));
    await dropAssessIdentityFixtures();
  }
}

/** Task 5 — the stores, printed-id allocation under the advisory lock, and the push-handler branches. */
async function assessmentStoreChecks(ok: Ok) {
  const db = await getDb();
  const created: string[] = [];
  const prevPicklists = (await db.select().from(blobs).where(eq(blobs.id, ASSESSMENT_PICKLISTS_BLOB)))[0];
  const track = (a: Assessment) => { created.push(a.id); registerFixture("assessments", a.id); return a; };
  const U1 = { id: "u1" };
  try {
    await assessIdentityFixtures();
    const { co1, co2, site1, site2, site3 } = ASSESS_FIX;
    const CO = co1, SITE = site1;

    // carry-over from Task 4: normalised input, "" refused, zero rows → not found
    ok((await setCompanyShortCode(co2, " tsx ")).ok && (await getCompany(co2))!.shortCode === "TSX", "codes db: company code input is trimmed + uppercased");
    const blankCo = await setCompanyShortCode(co2, "   ");
    ok(!blankCo.ok && (await getCompany(co2))!.shortCode === "TSX", "codes db: a blank company code is refused (a clear sends null)");
    const noCo = await setCompanyShortCode("TESTassess:nope", "ABC");
    ok(!noCo.ok && noCo.error === "Company not found", "codes db: unknown company → Company not found");
    ok((await setSiteShortCode(site3, " oth ")).ok && (await getSite(site3))!.shortCode === "OTH", "codes db: site code input is trimmed + uppercased");
    ok(!(await setSiteShortCode(site3, "")).ok && (await getSite(site3))!.shortCode === "OTH", "codes db: a blank site code is refused");
    const noSite = await setSiteShortCode("TESTassess:nope", "ABC");
    ok(!noSite.ok && noSite.error === "Venue not found", "codes db: unknown venue → Venue not found");
    ok((await setCompanyShortCode(co2, null)).ok && (await setSiteShortCode(site3, null)).ok, "codes db: null still clears");

    // assessments
    const a = track(await createAssessment({ visitType: "condition", customerId: CO, siteId: SITE, visitDate: Date.now(), assessorId: "u1" }, "u1"));
    ok(/^AS-\d{4,}$/.test(a.id) && a.defVersion === 1 && a.scopes.find((s) => s.code === "S2")?.depth === "screen", "store: create AS with condition scopes");
    ok(a.status === "draft" && a.rev === 1 && a.createdBy === "u1" && Object.keys(a.answers).length === 0, "store: a new assessment is a draft at rev 1");
    let threw = "";
    try { await createAssessment({ visitType: "condition", customerId: co2, siteId: SITE, visitDate: Date.now(), assessorId: "u1" }, "u1"); } catch (e) { threw = String(e); }
    ok(/venue/i.test(threw), "store: create refuses a venue that isn't the customer's");
    threw = "";
    try { await createAssessment({ visitType: "moonwalk", customerId: CO, siteId: SITE, visitDate: Date.now(), assessorId: "u1" }, "u1"); } catch (e) { threw = String(e); }
    ok(/visit type/i.test(threw), "store: create refuses an unknown visit type");
    let s = await saveAssessment(a.id, { answers: { "core.space_type": { v: "proscenium", state: "answered", at: 10, by: "u1" } } }, U1);
    ok(s.ok, "store: valid answer saves");
    ok(s.ok && s.doc.status === "onsite" && typeof s.doc.startedAt === "number" && s.doc.rev === 2, "store: the first answer moves a draft onsite and bumps rev");
    s = await saveAssessment(a.id, { answers: { "core.space_type": { v: "spaceship", state: "answered", at: 11, by: "u1" } } }, U1);
    ok(!s.ok && /core\.space_type/.test((s as { error: string }).error), "store: invalid answer refused with key");
    await saveAssessment(a.id, { answers: { "core.space_type": { v: "thrust", state: "answered", at: 5, by: "u2" } } }, { id: "u2" });
    ok((await getAssessment(a.id))!.answers["core.space_type"].v === "proscenium", "store: older answer loses merge");
    await saveAssessment(a.id, { answers: { "future.key": { v: 1, state: "answered", at: 12, by: "u1" } } as Answers }, U1);
    ok("future.key" in (await getAssessment(a.id))!.answers, "store: unknown keys kept");
    // attribution + clock clamp (controller addition)
    await saveAssessment(a.id, { answers: { "core.use": { v: ["school"], state: "answered", at: 20, by: "mallory" } } }, U1);
    ok((await getAssessment(a.id))!.answers["core.use"]?.by === "u1", "store: answer.by is always the session user, never the client's");
    const future = Date.now() + 86_400_000;
    await saveAssessment(a.id, { answers: { "core.use": { v: ["community"], state: "answered", at: future, by: "u1" } } }, U1);
    const clamped = (await getAssessment(a.id))!.answers["core.use"];
    ok(JSON.stringify(clamped.v) === '["community"]' && clamped.at <= Date.now() + 5 * 60_000 && clamped.at < future, "store: a future answer.at is clamped to now + 5 min");
    await saveAssessment(a.id, { answers: { "core.use": { v: ["rentals"], state: "answered", at: Date.now() + 10 * 60_000, by: "u1" } } }, U1);
    ok(((await getAssessment(a.id))!.answers["core.use"].v as string[])[0] === "rentals", "store: a clamped answer can't lock out every later edit");
    // scalars, photos, dismissed prompts
    s = await saveAssessment(a.id, { spaceLabel: "Auditorium rm 132", status: "completed", customerId: co2, defVersion: 99, dismissedPrompts: [{ id: "rule:R10", by: "x", at: 1 }] } as Partial<Assessment>, U1);
    const a1 = (await getAssessment(a.id))!;
    ok(s.ok && a1.spaceLabel === "Auditorium rm 132" && a1.status === "onsite" && a1.customerId === CO && a1.defVersion === 1, "store: scalars replace; status/customerId/defVersion never from a save");
    ok(a1.dismissedPrompts.length === 1 && a1.dismissedPrompts[0].by === "u1", "store: a dismissed prompt is stored, attributed to the session user");
    await saveAssessment(a.id, { dismissedPrompts: [{ id: "rule:R10", by: "u1", at: 2 }, { id: "flag:x", by: "u1", at: 3 }] }, U1);
    ok((await getAssessment(a.id))!.dismissedPrompts.map((d) => d.id).sort().join() === "flag:x,rule:R10", "store: dismissed prompts union by id");
    const stale = await saveAssessment(a.id, { spaceLabel: "Stale label", rev: 1, answers: { "core.seats": { v: 640, state: "answered", at: 30, by: "u1" } } } as Partial<Assessment>, U1);
    const a1b = (await getAssessment(a.id))!;
    ok(stale.ok && a1b.spaceLabel === "Auditorium rm 132" && a1b.answers["core.seats"]?.v === 640, "store: a stale rev still merges answers but keeps the server's scalars");
    const badPath = await saveAssessment(a.id, { photos: [{ id: "p_px000000", blobPath: "assessments/AS-1/p_px000000.jpg", takenAt: 1, by: "u1" }] }, U1);
    ok(!badPath.ok && /px/.test((badPath as { error: string }).error), "store: a photo path outside the assessment is refused");
    const tooMany = Array.from({ length: 201 }, (_, i) => ({ id: `p${i}`, pending: true as const, takenAt: 1, by: "u1" }));
    ok(!(await saveAssessment(a.id, { photos: tooMany }, U1)).ok, "store: more than 200 photos refused");
    // the clear marker
    const a3 = track(await createAssessment({ visitType: "condition", customerId: CO, siteId: SITE, visitDate: Date.now(), assessorId: "u1" }, "u1"));
    await saveAssessment(a3.id, { answers: { "core.space_type": { v: "thrust", state: "answered", at: 10, by: "u1" } } }, U1);
    s = await saveAssessment(a3.id, { answers: { "core.space_type": { v: null, state: "answered", at: 20, by: "u1" } } }, U1);
    ok(s.ok && (await getAssessment(a3.id))!.answers["core.space_type"].v === null, "store: the clear marker (v: null) saves and wins by at");

    // complete refused with gaps, override records them, profile written
    const c1 = await completeAssessment(a.id, U1, false);
    ok(!c1.ok && (c1 as { gaps: string[] }).gaps.length > 0, "store: complete lists gaps");
    ok(!c1.ok && (c1 as { gaps: string[] }).gaps.some((g) => g.includes("Overhead rigging system type")), "store: gaps name questions by label");
    ok((await getAssessment(a.id))!.status === "onsite", "store: a refused completion leaves the status");
    ok((await completeAssessment(a.id, U1, true)).ok, "store: complete with override");
    const done = (await getAssessment(a.id))!;
    ok(done.status === "completed" && done.completedBy === "u1" && typeof done.completedAt === "number" && (done.overriddenGaps?.length ?? 0) > 0, "store: completion stamps who/when and records overridden gaps");
    ok((await getVenueProfile(SITE))?.facts["core.space_type"]?.v === "proscenium", "store: completion writes profile facts");
    ok((await getVenueProfile(SITE))?.facts["core.space_type"]?.from === a.id && (await getVenueProfile(SITE))?.customerId === CO, "store: a profile fact names its assessment");
    ok(!("future.key" in (await getVenueProfile(SITE))!.facts) && !("core.use" in (await getVenueProfile(SITE))!.facts), "store: only profile:true questions reach the profile");
    ok(profileValues(await getVenueProfile(SITE))["core.space_type"] === "proscenium" && Object.keys(profileValues(null)).length === 0, "store: profileValues flattens facts");
    ok(!(await saveAssessment(a.id, { spaceLabel: "late" }, U1)).ok, "store: a completed assessment refuses edits");
    await completeAssessment(a3.id, U1, true);
    ok((await getVenueProfile(SITE))?.facts["core.space_type"]?.from === a.id, "store: a cleared (null) answer never overwrites a profile fact");
    await reopenAssessment(a.id, U1);
    const reo = (await getAssessment(a.id))!;
    ok(reo.status === "onsite" && reo.completedAt === undefined, "store: reopen → onsite");
    ok((await saveAssessment(a.id, { spaceLabel: "Auditorium rm 132" }, U1)).ok, "store: a reopened assessment saves again");
    // pending photo blocks even with override
    const a2 = track(await createAssessment({ visitType: "condition", customerId: CO, siteId: SITE, visitDate: Date.now(), assessorId: "u1" }, "u1"));
    await saveAssessment(a2.id, { photos: [{ id: "p_p1000000", pending: true, takenAt: 1, by: "u1" }] }, U1);
    const c2 = await completeAssessment(a2.id, U1, true);
    ok(!c2.ok && (c2 as { uploading: number }).uploading === 1, "store: uploading photos hard-block completion");
    await saveAssessment(a2.id, { photos: [{ id: "p_p1000000", pending: true, takenAt: 1, by: "u1" }, { id: "p_p2000000", inline: "data:image/jpeg;base64,AAAA", takenAt: 2, by: "u1" }] }, U1);
    await saveAssessment(a2.id, { photos: [{ id: "p_p1000000", blobPath: `assessments/${a2.id}/p_p1000000.jpg`, takenAt: 1, by: "u1" }] }, U1);
    await saveAssessment(a2.id, { photos: [{ id: "p_p1000000", pending: true, takenAt: 1, by: "u1" }] }, U1);
    const ph = (await getAssessment(a2.id))!.photos;
    ok(ph.length === 2 && ph.find((p) => p.id === "p_p1000000")?.blobPath === `assessments/${a2.id}/p_p1000000.jpg` && !ph.find((p) => p.id === "p_p1000000")?.pending, "store: photos merge by id; an upload beats a stale pending");
    ok((await completeAssessment(a2.id, U1, true)).ok, "store: once uploaded, completion goes through");

    // pick-list extras
    ok((await addPicklistValue("space_type", "Arena Bowl")).ok, "picklists: add a value");
    ok(!(await addPicklistValue("space_type", "Proscenium")).ok && !(await addPicklistValue("space_type", "arena  bowl")).ok, "picklists: a code collision (definition or added) is refused");
    ok(!(await addPicklistValue("no_such_list", "X")).ok && !(await addPicklistValue("space_type", "  ")).ok, "picklists: unknown list or blank label refused");
    const ex = await getPicklistExtras();
    ok(ex.space_type?.[0]?.value === "arena_bowl" && ex.space_type[0].label === "Arena Bowl", "picklists: value = slug(label)");
    await setPicklistRetired("space_type", "arena_bowl", true);
    ok((await getPicklistExtras()).space_type[0].retired === true && extrasForValidation(await getPicklistExtras()).space_type.includes("arena_bowl"), "picklists: a retired value still validates stored answers");
    const a5 = track(await createAssessment({ visitType: "condition", customerId: CO, siteId: SITE, visitDate: Date.now(), assessorId: "u1" }, "u1"));
    ok((await saveAssessment(a5.id, { answers: { "core.space_type": { v: "arena_bowl", state: "answered", at: 10, by: "u1" } } }, U1)).ok, "picklists: an added value validates in saveAssessment");

    // findings: allocation + concurrency + void never reused
    const mk = (k: string) => ({ key: k, customerId: CO, siteId: SITE, assessmentId: a.id, category: "RIG" as const, rating: "needs" as const, description: "x", questionKeys: [], photoIds: [], quoteRefs: [] });
    const [f1, f2] = await Promise.all([saveFinding(mk("fd_test000000000001"), U1), saveFinding(mk("fd_test000000000002"), U1)]);
    ok(f1.ok && f2.ok, "findings: both concurrent creates save");
    const ids = [(f1 as { doc: Finding }).doc.printedId!, (f2 as { doc: Finding }).doc.printedId!].sort();
    ok(ids[0].endsWith("-RIG-001") && ids[1].endsWith("-RIG-002"), "findings: concurrent allocation gives 001/002");
    ok(ids[0] === "ACO-ASS-RIG-001", "findings: missing codes are assigned from the suggestions (Assess Co One → ACO, Assess Hall → ASS)");
    ok((await getCompany(CO))!.shortCode === "ACO" && (await getSite(SITE))!.shortCode === "ASS", "findings: the assigned codes are stored on the company and venue");
    await voidFinding("fd_test000000000002", "dup", U1);
    ok((await getFinding("fd_test000000000002"))!.voided?.reason === "dup", "findings: void records the reason");
    const f3 = await saveFinding(mk("fd_test000000000003"), U1);
    ok((f3 as { doc: Finding }).doc.printedId!.endsWith("-RIG-003"), "findings: voided number never reused");
    const elc = await saveFinding({ ...mk("fd_test000000000005"), category: "ELC" }, U1);
    ok((elc as { doc: Finding }).doc.printedId === "ACO-ASS-ELC-001", "findings: the sequence is per category");
    const a4 = track(await createAssessment({ visitType: "condition", customerId: CO, siteId: site2, visitDate: Date.now(), assessorId: "u1" }, "u1"));
    const other = await saveFinding({ ...mk("fd_test000000000006"), siteId: site2, assessmentId: a4.id }, U1);
    ok((other as { doc: Finding }).doc.printedId === "ACO-ASS2-RIG-001", "findings: a venue code collision within the company gets a suffix (ASS2)");
    ok(!(await saveFinding({ ...mk("fd_test000000000007"), siteId: site2 }, U1)).ok, "findings: a finding's venue must match its assessment");
    ok(!(await saveFinding({ ...mk("fd_test000000000004"), rating: "immediate" }, U1)).ok, "findings: immediate without photo/notify refused");
    ok(!(await saveFinding({ ...mk("NOT-A-KEY"), description: "x" }, U1)).ok, "findings: a malformed key is refused");
    const imm = await saveFinding({ ...mk("fd_test000000000008"), rating: "immediate", photoIds: ["p_p1000000"], immediate: { hazardContactNotified: true, notifiedAt: 1, lockout: "tagged" }, recommendedAction: "Take out of service" }, U1);
    ok(imm.ok, "findings: a complete immediate finding saves");
    // protected fields + optimistic rev
    const hack = await saveFinding({ key: "fd_test000000000001", printedId: "HACK-1", seq: 99, status: "closed", history: [], description: "edited", quoteRefs: ["Q-HACK"] } as Partial<Finding> & { key: string }, U1);
    const fh = (await getFinding("fd_test000000000001"))!;
    ok(hack.ok && fh.description === "edited" && fh.printedId!.endsWith("-RIG-00" + fh.seq) && fh.status === "open" && fh.history.length === 1 && fh.quoteRefs.length === 0, "findings: printedId/seq/status/history/quoteRefs never come from a save");
    ok((await saveFinding({ key: "fd_test000000000001", rev: 1, description: "stale" }, U1)).ok === false, "findings: a stale rev is a conflict");
    ok(!(await saveFinding({ key: "fd_test000000000001", category: "HAZ" }, U1)).ok, "findings: the category is fixed once the number is issued");
    ok((await transitionFinding("fd_test000000000001", "inspected", U1)).ok === false, "findings: inspected without specialist refused");
    const tr = await transitionFinding("fd_test000000000001", "inspected", U1, { patch: { specialist: { rating: "needs", by: "Rigger" } } });
    ok(tr.ok && tr.doc.status === "inspected" && tr.doc.history.at(-1)?.status === "inspected" && tr.doc.history.at(-1)?.by === "u1", "findings: a transition with its precondition appends history");
    ok(!(await transitionFinding("fd_test000000000001", "triaged", U1)).ok && (await transitionFinding("fd_test000000000001", "triaged", U1, { note: "Re-triage" })).ok, "findings: a backward move needs a note");
    ok((await transitionFinding("fd_test000000000002", "triaged", U1)).ok === false, "findings: a voided finding can't change status");
    await linkQuote(["fd_test000000000001"], "Q-TEST", U1);
    ok((await getFinding("fd_test000000000001"))!.status === "quoted", "findings: linking a quote → quoted");
    ok((await getFinding("fd_test000000000001"))!.quoteRefs.join() === "Q-TEST", "findings: linkQuote adds the quote ref");
    await linkQuote(["fd_test000000000001"], "Q-TEST", U1);
    ok((await getFinding("fd_test000000000001"))!.quoteRefs.length === 1, "findings: linking the same quote twice is idempotent");
    const lf = await listFindings({ siteId: SITE, category: ["RIG"] });
    ok(lf.length === 3 && lf.every((f) => !f.voided) && (await listFindings({ siteId: SITE, category: ["RIG"], includeVoided: true })).length === 4, "findings: list filters and hides voided by default");
    ok((await listFindings({ assessmentId: a.id, status: ["quoted"] })).length === 1 && (await listFindings({ customerId: CO, rating: ["immediate"] })).length === 1, "findings: list filters by assessment/status/rating");

    // allocation helper: no-op when already numbered; offline null → numbered on the next save
    const already = (await getFinding("fd_test000000000003"))!;
    ok((await allocatePrintedId(already)).printedId === already.printedId, "findings: allocatePrintedId is a no-op once numbered");
    ok((await listAssessments({ siteId: SITE })).every((x) => x.siteId === SITE) && (await listAssessments({ customerId: CO, status: "completed" })).some((x) => x.id === a2.id), "store: listAssessments filters");

    // push-handler branches
    const noPerm = await pushAssessment({ id: a5.id, rev: 1, doc: { answers: {} } }, { id: "u9", roles: [] });
    ok(noPerm.status === "error", "push: assessments need the create permission");
    const ROLES = ["Estimator"];
    const pOk = await pushAssessment({ id: a5.id, rev: 99, doc: { answers: { "core.seats": { v: 300, state: "answered", at: 50, by: "zz" } } } }, { id: "u1", roles: ROLES });
    ok(pOk.status === "ok" && (await getAssessment(a5.id))!.answers["core.seats"]?.by === "u1" && pOk.rev === (await getAssessment(a5.id))!.rev, "push: an assessment push merges through saveAssessment and returns the stored rev");
    // Fix round 1 — push mode never loses valid capture: skipped items land in syncRejects, the reply is ok.
    const PU = { id: "u1", roles: ROLES };
    const pMix = await pushAssessment({ id: a5.id, rev: 99, doc: { answers: { "core.space_type": { v: "spaceship", state: "answered", at: 60, by: "u1" }, "core.seats": { v: 310, state: "answered", at: 61, by: "u1" } } } }, PU);
    const a5m = (await getAssessment(a5.id))!;
    ok(pMix.status === "ok" && a5m.answers["core.seats"]?.v === 310 && a5m.answers["core.space_type"]?.v === "arena_bowl", "push: one bad + one good answer → ok; the good one merges, the bad one doesn't");
    const rej = a5m.syncRejects?.find((r) => r.key === "core.space_type");
    ok(!!rej && rej.by === "u1" && typeof rej.at === "number" && rej.error.length > 0 && (rej.payload as { v?: unknown } | undefined)?.v === "spaceship", "push: the skipped answer is in syncRejects with its error, who/when and payload");
    ok(pMix.rev === a5m.rev, "rev: an assessment push reply carries the stored rev");
    const nRej = a5m.syncRejects?.length ?? 0;
    await pushAssessment({ id: a5.id, rev: 99, doc: { syncRejects: [{ key: "x", error: "forged", at: 1, by: "evil" }], spaceLabel: "Lab" } }, PU);
    await saveAssessment(a5.id, { syncRejects: [] } as unknown as Partial<Assessment>, U1);
    const a5f = (await getAssessment(a5.id))!;
    ok(a5f.spaceLabel === "Lab" && a5f.syncRejects?.length === nRej && !a5f.syncRejects.some((r) => r.error === "forged"), "push: a client-sent syncRejects is ignored (push and action)");
    const pStale = await pushAssessment({ id: a5.id, rev: 1, doc: { spaceLabel: "Stale room", answers: { "core.seats": { v: 999, state: "answered", at: Date.now(), by: "u1" } } } }, PU);
    const a5s = (await getAssessment(a5.id))!;
    ok(pStale.status === "ok" && a5s.answers["core.seats"]?.v === 999 && a5s.spaceLabel === "Lab", "push: a stale-rev push merges answers and keeps the server's scalars");
    ok(!!a5s.syncRejects?.some((r) => r.key === "field:spaceLabel" && r.payload === "Stale room"), "push: the stale-rev scalar is recorded as field:spaceLabel");
    const aStale = await saveAssessment(a5.id, { rev: 1, spaceLabel: "Other", visitDate: 7 } as Partial<Assessment>, U1);
    ok(aStale.ok && [...(aStale.dropped ?? [])].sort().join() === "spaceLabel,visitDate" && (await getAssessment(a5.id))!.spaceLabel === "Lab", "action: a stale-rev save returns the dropped scalars and keeps the server's");
    const sv = await saveAssessment(a5.id, { accompanying: "Facilities lead" }, U1);
    ok(sv.ok && sv.doc.rev === (await getAssessment(a5.id))!.rev && sv.doc.accompanying === "Facilities lead", "rev: an action save returns the stored doc at its stored rev");
    await pushAssessment({ id: a5.id, rev: 99, doc: { answers: { "future.big": { v: "x".repeat(25_000), state: "answered" } } } }, PU);
    const bigRej = (await getAssessment(a5.id))!.syncRejects?.find((r) => r.key === "future.big");
    ok(!!bigRej && bigRej.payload === undefined, "push: a rejected payload over 20 KB is recorded without its payload");
    await pushAssessment({ id: a5.id, rev: 99, doc: { answers: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`future.k${i}`, { v: i, state: "answered" }])) } }, PU);
    const capped = (await getAssessment(a5.id))!.syncRejects ?? [];
    ok(capped.length === 50 && capped.at(-1)?.key === "future.k59" && !capped.some((r) => r.key === "future.k9"), "push: syncRejects keeps the newest 50");
    // a push to a completed assessment: answers untouched, each differing answer recorded, reply ok
    const a6 = track(await createAssessment({ visitType: "condition", customerId: CO, siteId: site2, visitDate: Date.now(), assessorId: "u1" }, "u1"));
    await saveAssessment(a6.id, { answers: { "core.space_type": { v: "thrust", state: "answered", at: 10, by: "u1" }, "core.seats": { v: 100, state: "answered", at: 10, by: "u1" } } }, U1);
    await completeAssessment(a6.id, U1, true);
    const a6c = (await getAssessment(a6.id))!;
    const pDone = await pushAssessment({ id: a6.id, rev: a6c.rev, doc: { answers: { "core.space_type": { v: "proscenium", state: "answered", at: Date.now(), by: "u1" }, "core.seats": { v: 100, state: "answered", at: Date.now(), by: "u1" } } } }, PU);
    const a6d = (await getAssessment(a6.id))!;
    ok(pDone.status === "ok" && a6d.status === "completed" && JSON.stringify(a6d.answers) === JSON.stringify(a6c.answers), "push: a push to a completed assessment replies ok and leaves its answers unchanged");
    ok((a6d.syncRejects ?? []).filter((r) => r.error === "Assessment was already completed").map((r) => r.key).join() === "core.space_type", "push: each differing answer on a completed assessment is in syncRejects (an unchanged one isn't)");
    ok(pDone.rev === a6d.rev, "rev: a completed-assessment push reply carries the stored rev");
    // assessments are created online only
    const offId = "AS-987654";
    created.push(offId); registerFixture("assessments", offId);
    const pNew = await pushAssessment({ id: offId, rev: 2, doc: { id: offId, visitType: "condition", customerId: CO, siteId: SITE, visitDate: 5, assessorId: "u1", answers: { "core.seats": { v: 120, state: "answered", at: 40, by: "u1" } } } }, PU);
    const offRows = await db.select({ id: DOC_TABLES.assessments.id }).from(DOC_TABLES.assessments).where(eq(DOC_TABLES.assessments.id, offId));
    ok(pNew.status === "error" && pNew.error === "Assessment not found. Start assessments while online." && offRows.length === 0, "push: an unknown assessment id is an error and is never created");
    ok((await pushAssessment({ id: "AS-1234567", rev: 1, doc: {} }, PU)).status === "error", "push: an id outside AS- + 4–6 digits is an error");
    const beforeVenue = JSON.stringify(await getAssessment(a5.id));
    const pVenue = await pushAssessment({ id: a5.id, rev: 99, doc: { siteId: site2, answers: { "core.seats": { v: 1, state: "answered", at: Date.now(), by: "u1" } } } }, PU);
    const pCust = await pushAssessment({ id: a5.id, rev: 99, doc: { customerId: co2, spaceLabel: "Moved" } }, PU);
    ok(pVenue.status === "error" && pVenue.error === "Assessment belongs to a different venue" && pCust.status === "error" && JSON.stringify(await getAssessment(a5.id)) === beforeVenue, "push: a different venue or customer is refused and the stored doc is unchanged");
    ok((await pushAssessment({ id: a5.id, rev: 99, doc: { customerId: CO, siteId: SITE, spaceLabel: "Lab" } }, PU)).status === "ok", "push: the same venue/customer echoed back is fine");
    // inline photo total cap (300 KB)
    const a7 = track(await createAssessment({ visitType: "condition", customerId: CO, siteId: SITE, visitDate: Date.now(), assessorId: "u1" }, "u1"));
    const bigInline = "data:image/jpeg;base64," + "A".repeat(200 * 1024);
    ok((await saveAssessment(a7.id, { photos: [{ id: "p_i1000000", inline: bigInline, takenAt: 1, by: "u1" }] }, U1)).ok, "inline: one 200 KB inline photo saves");
    ok((await saveAssessment(a7.id, { photos: [{ id: "p_i1000000", inline: bigInline, takenAt: 1, by: "u1" }] }, U1)).ok, "inline: re-sending the same inline photo isn't counted twice");
    const over = await saveAssessment(a7.id, { photos: [{ id: "p_i2000000", inline: bigInline, takenAt: 2, by: "u1" }] }, U1);
    ok(!over.ok && /300 KB/.test(over.error) && !(await getAssessment(a7.id))!.photos.some((p) => p.id === "p_i2000000"), "inline: an action save over 300 KB of inline photos is refused");
    const pOver = await pushAssessment({ id: a7.id, rev: 99, doc: { photos: [{ id: "p_i2000000", inline: bigInline, takenAt: 2, by: "u1" }] } }, PU);
    const a7p = (await getAssessment(a7.id))!;
    const i2 = a7p.photos.find((p) => p.id === "p_i2000000");
    ok(pOver.status === "ok" && i2?.pending === true && !i2.inline && !!a7p.photos.find((p) => p.id === "p_i1000000")?.inline, "inline: a push over the cap keeps the photo as pending without inline");
    ok(!!a7p.syncRejects?.some((r) => r.key === "photo:p_i2000000" && r.payload === undefined), "inline: the over-cap photo is recorded as photo:<id> (its big payload omitted)");
    const pPh = await pushAssessment({ id: a7.id, rev: 99, doc: { photos: [{ id: "p_i3000000", blobPath: "assessments/AS-1/p_i3000000.jpg", takenAt: 3, by: "u1" }, { id: "p_i4000000", takenAt: 4, by: "u1" }] } }, PU);
    const a7q = (await getAssessment(a7.id))!;
    ok(pPh.status === "ok" && a7q.photos.some((p) => p.id === "p_i4000000" && p.pending) && !a7q.photos.some((p) => p.id === "p_i3000000") && !!a7q.syncRejects?.some((r) => r.key === "photo:p_i3000000"), "push: a bad photo ref is skipped into syncRejects, a good one merges");
    ok((await pushFinding({ id: "fd_test00000000000a", rev: 1, doc: mk("fd_test00000000000a") }, { id: "u9", roles: [] })).status === "error", "push: findings need the create permission");
    const pf = await pushFinding({ id: "fd_test00000000000a", rev: 1, doc: { ...mk("fd_test00000000000a"), printedId: null, status: "triaged" } }, { id: "u1", roles: ROLES });
    const pfDoc = (await getFinding("fd_test00000000000a"))!;
    ok(pf.status === "ok" && pfDoc.printedId === "ACO-ASS-RIG-005" && pfDoc.status === "triaged" && pf.rev === pfDoc.rev, "push: an offline finding (printedId null) is numbered on sync and its intended status applied");
    const pfBad = await pushFinding({ id: "fd_test00000000000a", rev: pfDoc.rev, doc: { ...pfDoc, status: "repaired" } }, { id: "u1", roles: ROLES });
    ok(pfBad.status === "conflict" && (pfBad.server as { status?: string })?.status === "triaged", "push: a refused transition is a conflict carrying the server doc");
    const pfStale = await pushFinding({ id: "fd_test00000000000a", rev: 1, doc: { ...pfDoc, description: "old" } }, { id: "u1", roles: ROLES });
    ok(pfStale.status === "conflict" && (await getFinding("fd_test00000000000a"))!.description === "x", "push: a stale finding push is a conflict");
    ok((await pushFinding({ id: "fd_test00000000000b", rev: 1, doc: { ...mk("fd_test00000000000b"), rating: "immediate" } }, { id: "u1", roles: ROLES })).status === "error", "push: a refused new finding stays an error (no server copy to fall back on)");
    // findings: rev contract, unknown assessment
    const fr = await saveFinding(mk("fd_test00000000000d"), U1);
    ok(fr.ok && fr.doc.rev === (await getFinding("fd_test00000000000d"))!.rev, "rev: saveFinding (create + number) returns the stored rev");
    const fe = await saveFinding({ key: "fd_test00000000000d", rev: fr.ok ? fr.doc.rev : 0, description: "edited" }, U1);
    ok(fe.ok && fe.doc.rev === (await getFinding("fd_test00000000000d"))!.rev, "rev: saveFinding (edit) returns the stored rev");
    const ft = await transitionFinding("fd_test00000000000d", "triaged", U1);
    ok(ft.ok && ft.doc.rev === (await getFinding("fd_test00000000000d"))!.rev, "rev: transitionFinding returns the stored rev");
    ok((await pushFinding({ id: "fd_test00000000000c", rev: 1, doc: { ...mk("fd_test00000000000c"), assessmentId: "AS-999999" } }, PU)).status === "error" && !(await getFinding("fd_test00000000000c")), "push: a finding for an unknown assessment is an error and isn't created");
    // the editor clears what it has shown
    const cl = await clearSyncRejects(a6.id, ["core.space_type"], U1);
    ok(cl.ok && !(await getAssessment(a6.id))!.syncRejects?.some((r) => r.key === "core.space_type"), "clearSyncRejects: removes the given entries");
    await clearSyncRejects(a5.id, ["future.k59"], U1);
    ok((await getAssessment(a5.id))!.syncRejects?.length === 49, "clearSyncRejects: leaves the others");
  } finally {
    await db.delete(DOC_TABLES.findings).where(like(DOC_TABLES.findings.id, "fd_test%"));
    if (created.length) await db.delete(DOC_TABLES.assessments).where(inArray(DOC_TABLES.assessments.id, created));
    await db.delete(DOC_TABLES.venue_profiles).where(like(DOC_TABLES.venue_profiles.id, "TESTassess:%"));
    await db.delete(blobs).where(eq(blobs.id, ASSESSMENT_PICKLISTS_BLOB));
    if (prevPicklists) await db.insert(blobs).values(prevPicklists);
    await dropAssessIdentityFixtures();
  }
}
/** Task 6 — finalising an uploaded photo and reading its bytes back (inline path only: no real Blob call). */
async function assessmentPhotoDbChecks(ok: Ok) {
  const db = await getDb();
  const created: string[] = [];
  const U1 = { id: "u1" };
  const jpeg = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString("base64");
  try {
    await assessIdentityFixtures();
    const { co1, site1 } = ASSESS_FIX;
    const a = await createAssessment({ visitType: "condition", customerId: co1, siteId: site1, visitDate: Date.now(), assessorId: "u1" }, "u1");
    created.push(a.id); registerFixture("assessments", a.id);
    await saveAssessment(a.id, { photos: [{ id: "p_p1000000", pending: true, takenAt: 1234, by: "u1", questionKey: "core.seats", caption: "Left wall" }, { id: "p_p2000000", pending: true, takenAt: 5, by: "u1" }] }, U1);
    const r = await applyFinalizedPhoto(a.id, "p_p1000000", { inline: jpeg }, U1);
    const p1 = (await getAssessment(a.id))!.photos.find((p) => p.id === "p_p1000000")!;
    ok(r.ok && p1.inline === jpeg && !p1.pending && !p1.blobPath, "finalize: an inline JPEG turns pending into inline");
    ok(p1.takenAt === 1234 && p1.questionKey === "core.seats" && p1.caption === "Left wall", "finalize: the photo's capture time and links are kept");
    ok(r.ok && r.ref.inline === jpeg && !("blobPath" in r.ref), "finalize: returns the ref the editor adopts");
    const png = await applyFinalizedPhoto(a.id, "p_p2000000", { inline: "data:image/png;base64,iVBORw0KGgo=" }, U1);
    ok(!png.ok && (await getAssessment(a.id))!.photos.find((p) => p.id === "p_p2000000")!.pending === true, "finalize: a non-JPEG data URL is refused and the photo stays pending");
    const fake = await applyFinalizedPhoto(a.id, "p_p2000000", { inline: "data:image/jpeg;base64,AAAA" }, U1);
    ok(!fake.ok, "finalize: a JPEG label over non-JPEG bytes is refused");
    const huge = await applyFinalizedPhoto(a.id, "p_p2000000", { inline: "data:image/jpeg;base64,/9j/" + "A".repeat(400 * 1024) }, U1);
    ok(!huge.ok, "finalize: an inline photo over 400 KB is refused");
    const none = await applyFinalizedPhoto(a.id, "nope", { inline: jpeg }, U1);
    ok(!none.ok && /isn't on this assessment/.test(none.error) && !(await getAssessment(a.id))!.photos.some((p) => p.id === "nope"), "finalize: a photo the assessment doesn't list is refused (no ref is invented)");
    const both = await applyFinalizedPhoto(a.id, "p_p2000000", {}, U1);
    ok(!both.ok, "finalize: needs a blob path or an inline image");
    const outside = await applyFinalizedPhoto(a.id, "p_p2000000", { blobPath: "assessments/AS-9999/p_p2000000.jpg" }, U1);
    ok(!outside.ok && (await getAssessment(a.id))!.photos.find((p) => p.id === "p_p2000000")!.pending === true, "finalize: a blob path outside this assessment is refused");
    const inScope = await applyFinalizedPhoto(a.id, "p_p2000000", { blobPath: `assessments/${a.id}/p_p2000000-Ab12.jpg` }, U1);
    const p2 = (await getAssessment(a.id))!.photos.find((p) => p.id === "p_p2000000")!;
    ok(inScope.ok && p2.blobPath === `assessments/${a.id}/p_p2000000-Ab12.jpg` && !p2.pending && !p2.inline, "finalize: an in-scope blob path is recorded and pending cleared");
    const rev = (await getAssessment(a.id))!.rev;
    const again = await applyFinalizedPhoto(a.id, "p_p1000000", { inline: jpeg }, U1);
    ok(again.ok && again.already === true && (await getAssessment(a.id))!.rev === rev, "finalize: a repeat for an already-finished photo is a quiet success");
    const other = await applyFinalizedPhoto(a.id, "p_p2000000", { blobPath: `assessments/${a.id}/p_p2000000-Zz99.jpg` }, U1);
    ok(other.ok && other.already === true && other.ref.blobPath === `assessments/${a.id}/p_p2000000-Ab12.jpg` && (await getAssessment(a.id))!.photos.find((p) => p.id === "p_p2000000")!.blobPath === `assessments/${a.id}/p_p2000000-Ab12.jpg`, "finalize: a second upload of a finished photo keeps the first and reports it");
    ok(!(await applyFinalizedPhoto("AS-bogus", "p_p1000000", { inline: jpeg }, U1)).ok, "finalize: an unknown assessment is refused");

    // photoBytes (inline + the guards that never reach Blob)
    const asm = (await getAssessment(a.id))!;
    const pb = await photoBytes(asm, "p_p1000000");
    ok(!!pb && pb.contentType === "image/jpeg" && pb.bytes[0] === 0xff && pb.bytes[1] === 0xd8 && pb.bytes.length === 12, "photoBytes: an inline photo decodes to its JPEG bytes");
    ok((await photoBytes(asm, "nope")) === null, "photoBytes: an unknown photo is null");
    const pend = await saveAssessment(a.id, { photos: [{ id: "p_p3000000", pending: true, takenAt: 9, by: "u1" }] }, U1);
    ok(pend.ok && (await photoBytes(pend.doc, "p_p3000000")) === null, "photoBytes: a still-pending photo is null");
    const evil = { ...asm, photos: [{ id: "p_x1000000", blobPath: "assessments/AS-9999/p_x1000000.jpg", takenAt: 1, by: "u1" }, { id: "p_x2000000", inline: "data:image/jpeg;base64,AAAA", takenAt: 1, by: "u1" }] };
    ok((await photoBytes(evil, "p_x1000000")) === null && (await photoBytes(evil, "p_x2000000")) === null, "photoBytes: an out-of-scope path or a fake inline JPEG is null without any Blob read");

    // Fix round 1 — rev returned, terminal states, dev-only inline, pending-ref removal, own-file paths
    {
      const b = await createAssessment({ visitType: "condition", customerId: co1, siteId: site1, visitDate: Date.now(), assessorId: "u1" }, "u1");
      created.push(b.id); registerFixture("assessments", b.id);
      const PUSHER = { id: "u1", roles: ["Estimator"] };
      await saveAssessment(b.id, { photos: [{ id: "p_q1000000", pending: true, takenAt: 1, by: "u1" }, { id: "p_q2000000", pending: true, takenAt: 2, by: "u1" }] }, U1);
      const f1 = await applyFinalizedPhoto(b.id, "p_q1000000", { inline: jpeg }, U1);
      ok(f1.ok && f1.rev === (await getAssessment(b.id))!.rev, "finalize: the returned rev equals the stored rev after the write");
      const f1b = await applyFinalizedPhoto(b.id, "p_q1000000", { inline: jpeg }, U1);
      ok(f1b.ok && f1b.already === true && f1b.rev === (await getAssessment(b.id))!.rev, "finalize: an already-finished run returns the current stored rev");
      const mis = await applyFinalizedPhoto(b.id, "p_q2000000", { blobPath: `assessments/${b.id}/p_q1000000-Ab12.jpg` }, U1);
      ok(!mis.ok && mis.terminal === true && (await getAssessment(b.id))!.photos.find((p) => p.id === "p_q2000000")!.pending === true, "finalize: another photo's blob path is refused (terminal) and the photo stays pending");
      const unk = await applyFinalizedPhoto("AS-9999", "p_q2000000", { inline: jpeg }, U1);
      ok(!unk.ok && unk.terminal === true, "finalize: an unknown assessment is terminal");
      const bad = await applyFinalizedPhoto(b.id, "p_q2000000", { inline: "data:image/png;base64,iVBORw0KGgo=" }, U1);
      const outs = await applyFinalizedPhoto(b.id, "p_q2000000", { blobPath: "assessments/AS-9999/p_q2000000.jpg" }, U1);
      const both2 = await applyFinalizedPhoto(b.id, "p_q2000000", {}, U1);
      ok(!bad.ok && bad.terminal === true && !outs.ok && outs.terminal === true && !both2.ok && both2.terminal === true, "finalize: every validation refusal is terminal");
      const ghost = await applyFinalizedPhoto(b.id, "p_ghost000", { inline: jpeg }, U1);
      ok(!ghost.ok && ghost.terminal !== true, "finalize: a ref that isn't there yet (no reject) stays retryable");
      await pushAssessment({ id: b.id, rev: 99, doc: { photos: [{ id: "p_ghost200", blobPath: "assessments/AS-9999/x.jpg", takenAt: 1, by: "u1" }] } }, PUSHER);
      const ghost2 = await applyFinalizedPhoto(b.id, "p_ghost200", { inline: jpeg }, U1);
      ok(!ghost2.ok && ghost2.terminal === true && !(await getAssessment(b.id))!.photos.some((p) => p.id === "p_ghost200"), "finalize: a ref absent AND rejected at push (photo:<id> in syncRejects) is terminal");

      // I2 — inline is dev-only: with Blob configured it is refused at finalize and stripped by both save modes
      const prevTok = process.env.BLOB_READ_WRITE_TOKEN;
      process.env.BLOB_READ_WRITE_TOKEN = "test-token-never-used";
      try {
        const inl = await applyFinalizedPhoto(b.id, "p_q2000000", { inline: jpeg }, U1);
        ok(!inl.ok && inl.terminal === true && /file storage/.test(inl.error) && (await getAssessment(b.id))!.photos.find((p) => p.id === "p_q2000000")!.pending === true, "inline: refused (terminal) at finalize when Blob is configured");
        const act = await saveAssessment(b.id, { photos: [{ id: "p_q3000000", inline: jpeg, takenAt: 3, by: "u1" }] as never }, U1);
        const q3 = act.ok ? act.doc.photos.find((p) => p.id === "p_q3000000") : undefined;
        ok(act.ok && !!q3 && q3.pending === true && !q3.inline, "inline: stripped by an action-mode save when Blob is configured (ref stays pending)");
        const psh = await pushAssessment({ id: b.id, rev: 99, doc: { photos: [{ id: "p_q4000000", inline: jpeg, takenAt: 4, by: "u1" }] } }, PUSHER);
        const q4 = (await getAssessment(b.id))!.photos.find((p) => p.id === "p_q4000000");
        ok(psh.status === "ok" && !!q4 && q4.pending === true && !q4.inline, "inline: stripped by a push-mode save when Blob is configured (ref stays pending)");
      } finally {
        if (prevTok === undefined) delete process.env.BLOB_READ_WRITE_TOKEN; else process.env.BLOB_READ_WRITE_TOKEN = prevTok;
      }

      // removePendingPhoto — the escape hatch for a pending ref whose bytes are gone
      await saveAssessment(b.id, { answers: { "core.seats": { v: 300, state: "answered", at: Date.now(), by: "u1", photoIds: ["p_q2000000", "p_q1000000"] } } }, U1);
      const revBefore = (await getAssessment(b.id))!.rev;
      const rm = await removePendingPhoto(b.id, "p_q2000000", U1);
      const after = (await getAssessment(b.id))!;
      ok(rm.ok && rm.rev === after.rev && after.rev === revBefore + 1 && !after.photos.some((p) => p.id === "p_q2000000"), "remove pending: a pending ref is removed and rev bumps");
      ok(JSON.stringify(after.answers["core.seats"]?.photoIds) === '["p_q1000000"]', "remove pending: the id is dropped from the answers' photoIds");
      const rmDone = await removePendingPhoto(b.id, "p_q1000000", U1);
      ok(!rmDone.ok && rmDone.terminal === true && (await getAssessment(b.id))!.photos.some((p) => p.id === "p_q1000000" && !!p.inline), "remove pending: a finished photo is refused and kept");
      const rmGone = await removePendingPhoto(b.id, "p_q2000000", U1);
      ok(rmGone.ok && rmGone.rev === after.rev, "remove pending: an already-removed ref is a quiet success (no rev bump)");
      // aliasing at the source: a hyphenated or capitalised id is no photo id, so it never reaches the document
      const aliasSave = await saveAssessment(b.id, { photos: [{ id: "p_q9000000-x", pending: true, takenAt: 1, by: "u1" }] }, U1);
      ok(!aliasSave.ok && !(await getAssessment(b.id))!.photos.some((p) => p.id.includes("q9000000")), "photo id: a non-conforming id is refused by an action save");
      const aliasRm = await removePendingPhoto(b.id, "q2", U1);
      ok(!aliasRm.ok && aliasRm.terminal === true, "photo id: removePendingPhoto refuses a non-conforming id");
      const aliasFin = await applyFinalizedPhoto(b.id, "p_q2000000", { blobPath: `assessments/${b.id}/p_q2000000-Ab12.jpg` }, U1);
      ok(!aliasFin.ok, "photo id: a ref for a photo that was never added can't be finalized");

      // removePendingPhoto also drops the id from this assessment's findings (through saveFinding: rev bumps)
      await saveAssessment(b.id, { photos: [{ id: "p_q5000000", pending: true, takenAt: 5, by: "u1" }] }, U1);
      const fk = (k: string, photoIds: string[], extra: Record<string, unknown> = {}) => ({ key: k, customerId: co1, siteId: site1, assessmentId: b.id, category: "RIG" as const, rating: "needs" as const, description: "x", questionKeys: [], photoIds, quoteRefs: [], ...extra });
      const fA = await saveFinding(fk("fd_testrmph00000001", ["p_q5000000", "p_q1000000"]), U1);
      const fB = await saveFinding(fk("fd_testrmph00000002", ["p_q1000000"]), U1);
      const fI = await saveFinding(fk("fd_testrmph00000003", ["p_q5000000"], { rating: "immediate", immediate: { hazardContactNotified: true, notifiedAt: 1, lockout: "tagged" }, recommendedAction: "Take out of service" }), U1);
      ok(fA.ok && fB.ok && fI.ok, "remove pending: findings fixtures save");
      const rmF = await removePendingPhoto(b.id, "p_q5000000", U1);
      const gA = (await getFinding("fd_testrmph00000001"))!;
      const gB = (await getFinding("fd_testrmph00000002"))!;
      const gI = (await getFinding("fd_testrmph00000003"))!;
      ok(rmF.ok && JSON.stringify(gA.photoIds) === '["p_q1000000"]' && fA.ok && gA.rev === fA.doc.rev! + 1, "remove pending: the id is dropped from the assessment's findings (their rev bumps)");
      ok(fB.ok && gB.rev === fB.doc.rev! && JSON.stringify(gB.photoIds) === '["p_q1000000"]', "remove pending: a finding that never held the photo is untouched");
      ok(rmF.ok && JSON.stringify(rmF.findingsNotCleaned) === '["fd_testrmph00000003"]' && JSON.stringify(gI.photoIds) === '["p_q5000000"]', "remove pending: an immediate finding that would lose its only photo is refused by the finding rules and reported");
      await db.delete(DOC_TABLES.findings).where(like(DOC_TABLES.findings.id, "fd_testrmph%"));
      await db.update(DOC_TABLES.assessments).set({ doc: sql`jsonb_set(doc, '{status}', '"completed"')` }).where(eq(DOC_TABLES.assessments.id, b.id));
      const rmComp = await removePendingPhoto(b.id, "p_q3000000", U1);
      ok(!rmComp.ok && rmComp.terminal === true, "remove pending: a completed assessment refuses it");
    }

    // completed assessments refuse a finalize
    await saveAssessment(a.id, { photos: [{ id: "p_p4000000", pending: true, takenAt: 9, by: "u1" }] }, U1);
    await db.update(DOC_TABLES.assessments).set({ doc: sql`jsonb_set(doc, '{status}', '"completed"')` }).where(eq(DOC_TABLES.assessments.id, a.id));
    const done = await applyFinalizedPhoto(a.id, "p_p4000000", { inline: jpeg }, U1);
    ok(!done.ok && /completed/i.test(done.error) && done.terminal === true, "finalize: a completed assessment refuses it (reopen first) — terminal");
  } finally {
    if (created.length) await db.delete(DOC_TABLES.assessments).where(inArray(DOC_TABLES.assessments.id, created));
    await dropAssessIdentityFixtures();
  }
}
/* ---------- Task 7: the editor's pure state model ---------- */

function editorDoc(over: Partial<EditorDoc> = {}): EditorDoc {
  return {
    id: "AS-1001", defVersion: 1, visitType: "condition",
    scopes: [{ code: "S0", on: true }, { code: "S1", on: true }, { code: "S2", on: true, depth: "screen" }, { code: "S8", on: false }],
    customerId: "c1", siteId: "s1", status: "onsite", visitDate: 1, assessorId: "u1",
    answers: {}, dismissedPrompts: [], photos: [], rev: 3, createdAt: 1, updatedAt: 1, createdBy: "u1", ...over,
  };
}

function editorModelChecks(ok: Ok) {
  const def = ASSESSMENT_DEF;
  const A = (v: unknown, at: number, by = "u1"): Answer => ({ v, state: "answered", at, by });
  // changedAnswers: same `at` = the edit the server holds; newer or new keys are changed
  const ack = { "core.seats": A(200, 10) };
  ok(Object.keys(changedAnswers(ack, { "core.seats": A(200, 10, "server-attributed") })).length === 0, "editor: an answer the server holds (same at; by may differ) is not resent");
  ok(Object.keys(changedAnswers(ack, { "core.seats": A(201, 11), "core.use": A(["school"], 12) })).join() === "core.seats,core.use", "editor: a newer answer and a new key are the changed ones");

  // buildPatch: changed answers only, the adopted rev, dirty scalars only
  let st = initEditorState(editorDoc({ answers: { "core.seats": A(200, 10) } }));
  ok(buildPatch(st) === null, "editor: nothing changed → no save");
  st = editorReducer(st, { type: "answer", key: "core.use", answer: A(["school"], 20) });
  let p = buildPatch(st)!;
  ok(p.rev === 3 && Object.keys(p.answers!).join() === "core.use" && p.scopes === undefined && p.spaceLabel === undefined, "editor: a save carries only the changed answers, no untouched scalars, and the rev the copy is based on");
  const fd = buildFullDoc({ ...st, doc: { ...st.doc, syncRejects: [{ key: "x", error: "e", at: 1, by: "u1" }] } }, 999);
  ok(fd.rev === 4 && fd.updatedAt === 999 && !("syncRejects" in fd) && (fd.answers as Record<string, unknown>)["core.seats"] !== undefined && (fd.answers as Record<string, unknown>)["core.use"] !== undefined, "editor: the outbox doc is the whole record at adopted rev + 1, stamped now, without syncRejects");
  st = editorReducer(st, { type: "scalar", field: "spaceLabel", value: "" });
  p = buildPatch(st)!;
  ok(p.spaceLabel === "" && st.dirty.includes("spaceLabel"), "editor: a cleared space label is sent as \"\" (JSON drops undefined)");
  ok(buildFullDoc(st, 1).spaceLabel === "", "editor: a cleared space label is sent as \"\" in the outbox doc too");
  const clr = editorReducer(initEditorState(editorDoc({ accompanying: "Pat" })), { type: "scalar", field: "accompanying", value: "" });
  ok(buildFullDoc(clr, 1).accompanying === "", "editor: a cleared Accompanying goes offline as \"\"");
  const dirtyOnly = buildFullDoc(editorReducer(initEditorState(editorDoc({ spaceLabel: "Aud", accompanying: "Pat", photoSetOffered: true })), { type: "scalar", field: "accompanying", value: "Lee" }), 1);
  ok(dirtyOnly.accompanying === "Lee" && !("spaceLabel" in dirtyOnly) && !("scopes" in dirtyOnly) && !("visitDate" in dirtyOnly) && !("photoSetOffered" in dirtyOnly), "editor: the outbox doc carries only the dirty scalars");
  st = editorReducer(st, { type: "scalar", field: "scopes", value: setScopeOn(def, st.doc.scopes, "S8", true) });
  p = buildPatch(st)!;
  ok(p.scopes!.find((s) => s.code === "S8")?.on === true, "editor: a changed scope list is sent");

  // saved: ack + rev adopted; a value changed in flight stays dirty; dropped fields are refused and reported
  const inFlight = editorReducer(st, { type: "answer", key: "core.use", answer: A(["community"], 30) });
  const saved = editorReducer(inFlight, { type: "saved", patch: p, rev: 7, dropped: ["scopes"] });
  ok(saved.doc.rev === 7, "editor: a save reply's rev is adopted");
  ok(Object.keys(buildPatch(saved)?.answers ?? {}).join() === "core.use" && buildPatch(saved)!.answers!["core.use"].at === 30, "editor: an answer changed while its save was in flight is sent again");
  ok(!saved.dirty.includes("scopes") && saved.dropped.join() === "scopes" && !saved.dirty.includes("spaceLabel"), "editor: a dropped scalar stops being dirty and is reported; an acknowledged one is clean");
  ok(editorReducer(saved, { type: "saved", patch: { rev: 7 }, rev: 5 }).doc.rev === 7, "editor: the rev never moves backwards");
  ok(editorReducer(saved, { type: "dismissDropped" }).dropped.length === 0, "editor: the dropped notice can be dismissed");
  ok(buildPatch(saved)!.rev === 7 && buildFullDoc(saved, 1).rev === 8, "editor: the next save and outbox doc build on the latest adopted rev");
  const flight2 = editorReducer(editorReducer(initEditorState(editorDoc()), { type: "scalar", field: "accompanying", value: "Pat" }), { type: "scalar", field: "accompanying", value: "Pat" });
  const sentPat = buildPatch(flight2)!;
  const changedInFlight = editorReducer(flight2, { type: "scalar", field: "accompanying", value: "Pat and Lee" });
  ok(editorReducer(changedInFlight, { type: "saved", patch: sentPat, rev: 4 }).dirty.includes("accompanying") && !editorReducer(flight2, { type: "saved", patch: sentPat, rev: 4 }).dirty.includes("accompanying"), "editor: a scalar changed again while its save was in flight stays dirty");

  // adopt a server copy: newest answer wins per key; dirty scalars kept; server-owned fields taken; rev forward only
  let local = initEditorState(editorDoc({ answers: { "core.seats": A(200, 10), "core.use": A(["school"], 10) }, spaceLabel: "Aud" }));
  local = editorReducer(local, { type: "answer", key: "core.use", answer: A(["rentals"], 50) });
  local = editorReducer(local, { type: "scalar", field: "accompanying", value: "Pat" });
  const server = editorDoc({
    rev: 9, updatedAt: 9, spaceLabel: "Auditorium 132", accompanying: "Someone else", status: "onsite",
    answers: { "core.seats": A(250, 40, "u2"), "core.use": A(["school"], 10) },
    syncRejects: [{ key: "core.seats", error: "bad", at: 1, by: "u1", payload: A(-1, 5) }],
  });
  const ad = editorReducer(local, { type: "adopt", server });
  ok(ad.doc.answers["core.seats"].v === 250 && (ad.doc.answers["core.use"].v as string[])[0] === "rentals", "editor: adopting a server copy takes its newer answers and keeps newer local ones");
  ok(ad.doc.rev === 9 && ad.doc.spaceLabel === "Auditorium 132" && ad.doc.accompanying === "Pat" && ad.doc.syncRejects?.length === 1, "editor: adopt takes the rev, untouched scalars and syncRejects; a scalar changed here is kept");
  ok(Object.keys(buildPatch(ad)!.answers!).join() === "core.use" && buildPatch(ad)!.accompanying === "Pat", "editor: after adopt only the unacknowledged edits are pending");
  const old = editorReducer(ad, { type: "adopt", server: { ...server, rev: 4, spaceLabel: "Stale" } });
  ok(old.doc.rev === 9 && old.doc.spaceLabel === "Auditorium 132", "editor: an older server copy never rolls the rev or fields back");
  const rj = editorReducer(ad, { type: "rejects", syncRejects: [], rev: 10 });
  ok(rj.doc.rev === 10 && rj.doc.syncRejects === undefined, "editor: clearing sync rejects adopts the returned rev and list");
  // photos: the server's ref wins; a local-only one survives only while unacknowledged
  const withPh = { ...ad, doc: { ...ad.doc, photos: [{ id: "p_local0001", pending: true as const, takenAt: 1, by: "u1" }, { id: "p_both00001", pending: true as const, takenAt: 1, by: "u1" }, { id: "p_gone00001", pending: true as const, takenAt: 1, by: "u1" }] }, dirtyPhotos: ["p_local0001"] };
  const adPh = editorReducer(withPh, { type: "adopt", server: { ...server, rev: 11, updatedAt: 11, photos: [{ id: "p_both00001", blobPath: "assessments/AS-1001/p_both00001.jpg", takenAt: 1, by: "u1" }] } });
  ok(adPh.doc.photos.length === 2 && adPh.doc.photos.find((x) => x.id === "p_both00001")?.blobPath !== undefined && adPh.doc.photos.some((x) => x.id === "p_local0001"), "editor: adopt keeps the server's uploaded ref and an unacknowledged local photo; an acknowledged one the server removed goes");

  // the store adopts each server copy once and notifies
  const store = createEditorStore(editorDoc());
  let calls = 0;
  const off = store.subscribe(() => calls++);
  store.adoptServer(editorDoc());
  ok(calls === 0, "editor store: the copy it started from is not adopted again");
  store.adoptServer(editorDoc({ rev: 4, updatedAt: 4 }));
  store.adoptServer(editorDoc({ rev: 4, updatedAt: 4 }));
  ok(calls === 1 && store.getState().doc.rev === 4, "editor store: a new server copy is adopted once");
  store.dispatch({ type: "answer", key: "core.seats", answer: A(1, 1) });
  off();
  store.dispatch({ type: "answer", key: "core.seats", answer: A(2, 2) });
  ok(calls === 2 && store.getState().doc.answers["core.seats"].v === 2, "editor store: dispatch is synchronous; unsubscribe stops notices");

  // controls → answers
  ok(textAnswer("   ", "u1", 5).v === null && textAnswer("   ", "u1", 5).state === "answered" && textAnswer(" hi ", "u1", 5).v === " hi ", "editor: a text trimmed to nothing is the Clear marker, never \"\"");
  const q = allQuestions(def);
  const cm = validateAnswer(q.get("core.owner_concerns")!.q, clearMarker("u1", 5), def, {});
  ok(cm.ok && cm.answer.v === null, "editor: the Clear marker validates for a longtext question");
  ok(validateAnswer(q.get("core.use")!.q, clearMarker("u1", 5), def, {}).ok, "editor: the Clear marker validates for a many question (never [])");
  ok(JSON.stringify(toggleMany(["school", "rentals"], "none")) === '["none"]' && JSON.stringify(toggleMany(["none"], "school")) === '["school"]' && toggleMany(["school"], "school") === null && JSON.stringify(toggleMany(["school"], "rentals")) === '["school","rentals"]', "editor: many chips — none clears the others, another clears none, the last deselect is null (clear)");
  ok(dateInputToMs("2026-10-13") === Date.UTC(2026, 9, 13) && msToDateInput(Date.UTC(2026, 9, 13)) === "2026-10-13" && dateInputToMs("2026-02-30") === null && dateInputToMs("13/10/2026") === null && msToDateInput("x") === "", "editor: dates are UTC midnight ms and round-trip; impossible dates refused");
  ok(parseNumberInput("") === null && parseNumberInput(" 12.5 ") === 12.5 && parseNumberInput("1e") === "invalid", "editor: number input — blank clears, junk waits");
  ok(parseFtinInput("", "") === null && JSON.stringify(parseFtinInput("12", "")) === '{"ft":12,"in":0}' && parseFtinInput("12.5", "1") === "invalid" && parseFtinInput("1", "12") === "invalid" && JSON.stringify(parseFtinInput("0", "6.5")) === '{"ft":0,"in":6.5}', "editor: ft/in — whole feet, inches 0 to under 12, blank both clears");
  ok(contactValue({}) === null && contactValue({ phone: "555" }) === "needsName" && JSON.stringify(contactValue({ name: "Pat", title: " " })) === '{"name":"Pat"}', "editor: contact needs a name; all blank clears");
  ok(unableWith("  ", "u1", 1) === null && unableWith("x".repeat(501), "u1", 1) === null && unableWith(" locked ", "u1", 1)?.reason === "locked" && unableWith("x".repeat(500), "u1", 1) !== null, "editor: Unable needs a 1–500 character reason");
  ok(notApplicable("u1", 3).state === "na" && answeredWith("yes", "u1", 3).v === "yes", "editor: N/A and answered constructors");
  ok(!showCounter(399, 500) && showCounter(400, 500) && showCounter(4000, 5000), "editor: the counter shows from 80 % of the cap");

  // pick lists: def options + active extras; a retired extra shows only when it is the current answer
  const extras = { space_type: [{ value: "arena_bowl", label: "Arena bowl" }, { value: "old_one", label: "Old one", retired: true }] };
  const o1 = optionsFor(def, extras, "space_type");
  ok(o1.some((o) => o.value === "arena_bowl") && !o1.some((o) => o.value === "old_one") && o1[0].value === "proscenium", "editor: options = definition + non-retired extras");
  ok(optionsFor(def, extras, "space_type", "old_one").some((o) => o.value === "old_one") && optionsFor(def, extras, "constructor").length === 0, "editor: a retired current value still shows; an inherited list id is no list");

  // profile pre-fill: offered only with a stored value and no answer; Still true is an ordinary answer
  const facts = { "core.space_type": { v: "thrust", at: 5, from: "AS-1001" }, "core.seats": { v: "", at: 5, from: "AS-1001" } };
  const spaceQ = q.get("core.space_type")!.q;
  ok(profileOnFile(spaceQ, facts, {})?.from === "AS-1001" && profileOnFile(spaceQ, facts, { "core.space_type": clearMarker("u1", 1) }) === null && profileOnFile(q.get("core.seats")!.q, facts, {}) === null && profileOnFile(q.get("core.use")!.q, facts, {}) === null, "editor: On file shows only for a profile question with a stored value and no answer");
  const evalBase = { def, visitType: "condition", scopes: editorDoc().scopes, photos: [], dismissed: [], resolved: [], now: Date.UTC(2026, 9, 13) };
  const before = evaluate({ ...evalBase, answers: {}, profile: { "core.space_type": "thrust" } });
  const after = evaluate({ ...evalBase, answers: { "core.space_type": answeredWith("thrust", "u1", 1) }, profile: { "core.space_type": "thrust" } });
  ok(before.missingRequired.includes("core.space_type") && !after.missingRequired.includes("core.space_type"), "editor: a profile fact alone doesn't answer a required question; Still true (an answered entry) does");

  // gates: counterweight appears; "none" hides it and its answers move under Hidden by earlier answers
  const cw = { "rigging.overhead": A("counterweight", 1), "rigging.cw_sets": A(12, 2) };
  const r1 = evaluate({ ...evalBase, answers: cw, profile: {} });
  ok(r1.visibleModules.has("rigging.counterweight") && r1.visible.has("rigging.cw_sets") && hiddenAnswered(def, "S2", r1, cw).length === 0, "editor: overhead = counterweight shows the counterweight module");
  const none = { ...cw, "rigging.overhead": A("none", 3) };
  const r2 = evaluate({ ...evalBase, answers: none, profile: {} });
  const hid = hiddenAnswered(def, "S2", r2, none);
  ok(!r2.visibleModules.has("rigging.counterweight") && hid.some((h) => h.q.key === "rigging.cw_sets" && h.moduleTitle === "Counterweight"), "editor: overhead = none hides it; its answer is listed under Hidden by earlier answers");
  ok(hiddenAnswered(def, "S2", r2, { ...none, "rigging.cw_purchase": clearMarker("u1", 4) }).every((h) => h.q.key !== "rigging.cw_purchase"), "editor: a cleared hidden answer isn't listed");

  // placePrompts: each prompt once, inside its own scope, under its first visible own-scope question (Task 8 fix)
  const placed = placePrompts(def, r1);
  const placedIds = [...placed.values()].flat().map((x) => x.id);
  const r10 = r1.prompts.find((x) => x.ruleId === "R10");
  const r10Home = [...placed].find(([, ps]) => ps.some((x) => x.id === r10?.id))?.[0];
  const modOfKey = (k: string) => def.scopes.flatMap((x) => x.modules).find((m) => m.questions.some((qq) => qq.key === k))?.id;
  const r10VisibleMods = new Set((r10?.questionKeys ?? []).filter((k) => r1.visible.has(k)).map(modOfKey));
  ok(!!r10 && r10VisibleMods.size > 1, "editor: fixture — R10's visible referenced questions span more than one module (the duplicate-chip scenario)");
  ok(!!r10 && placedIds.length === new Set(placedIds).size && placedIds.length === r1.prompts.filter((x) => x.questionKeys.length > 0).length, "editor: no rule prompt id is placed twice (and none is lost)");
  ok(!!r10 && r10.questionKeys.length > 1 && r10Home === "q:rigging.overhead" && promptScope(def, r10) === "S2", "editor: R10 (scope S2 by its first key) shows once, under rigging.overhead in Rigging — not under the Core question it also reads");
  const hiddenQs = placePrompts(def, { prompts: [{ ...r10!, questionKeys: ["rigging.alteration_since"] }], visible: new Set<string>(), visibleModules: new Set(["core.space", "rigging.system", "rigging.screen"]) });
  const rigScope = def.scopes.find((x) => x.code === "S2")!;
  ok([...hiddenQs.keys()].join() === `m:${rigScope.modules.find((m) => ["rigging.system", "rigging.screen"].includes(m.id))!.id}`, "editor: with none of its own-scope questions visible a prompt lands at the top of the first visible module of its scope");

  // rail summaries: scopes that are on; S8 off is absent; counts line up with evaluate
  const sums = scopeSummaries(def, editorDoc().scopes, r1);
  const s2 = sums.find((x) => x.code === "S2")!;
  ok(sums[0].code === "S0" && !sums.some((x) => x.code === "S8") && !sums.some((x) => x.code === "S3"), "editor: the rail lists only scopes that are on (S0 always)");
  ok(s2.total === r1.progress.rigging.total && s2.done === r1.progress.rigging.done && s2.missingPhotos === r1.missingPhotos.filter((m) => m.moduleId.startsWith("rigging.")).length && s2.missingPhotos > 0, "editor: rail progress and missing photos come from evaluate");
  ok(sums.reduce((n, x) => n + x.prompts, 0) <= r1.prompts.length, "editor: rail prompt badges never exceed the open prompts");
  ok(flagsForScope(def, r1, "S2").every((f) => r1.flags.some((x) => x.ruleId === f.ruleId)), "editor: a scope's flags are evaluate's flags");
  const offScopes = editorDoc().scopes.map((s) => (s.code === "S2" ? { ...s, on: false } : s));
  ok(offScopesWithAnswers(def, offScopes, cw).join() === "S2", "editor: a scope switched off with answers is reported (its answers are kept)");
  const sc = setScopeOn(def, [{ code: "S0", on: true }], "S2", true);
  ok(sc.find((x) => x.code === "S2")?.depth === "screen" && setScopeOn(def, sc, "S0", false) === sc, "editor: turning S2 on takes its screen depth; S0 can't be turned off");

  // messages
  const rp = refusalParts("rigging.overhead: \"x\" is not one of the options", def);
  ok(rp.key === "rigging.overhead" && rp.label === "Overhead rigging system type" && rp.error.startsWith("\"x\""), "editor: a refusal names the question it refused");
  ok(refusalParts("Enter the visit date", def).key === undefined, "editor: a refusal without a key is shown as is");
  ok(rejectLabel("core.seats", def) === "Seat count" && rejectLabel("photo:p_1", def) === "Photo p_1" && rejectLabel("field:spaceLabel", def) === "Space", "editor: sync rejects are labelled by question, photo or field");
  ok(formatRejectPayload("field:scopes", [{ code: "S0", on: true }, { code: "S2", on: false }], def, {}) === "Core", "editor: a rejected scope list reads as the titles of the scopes it had on");
  ok(formatRejectPayload("core.space_type", A("thrust", 1), def, {}) === "Thrust", "editor: a rejected answer reads as its value");
  ok(reenterAnswer(A("thrust", 1, "x"), "u1", 99)?.at === 99 && reenterAnswer({ state: "unable", reason: "locked" }, "u1", 9)?.reason === "locked" && reenterAnswer("junk", "u1", 1) === null, "editor: Re-enter restamps a rejected answer");
  ok(formatValue(q.get("core.stage_width")!.q, { ft: 40, in: 6 }, def, {}) === "40′ 6″" && formatValue(q.get("core.use")!.q, ["school", "rentals"], def, {}) === "School, Rentals", "editor: values format for display");

  const fv: FindingVM[] = [
    { key: "fd_a", printedId: null, category: "RIG", rating: "needs", description: "", questionKeys: ["rigging.x"], ruleId: "X5", status: "open", voided: false, photoIds: [] },
    { key: "fd_b", printedId: null, category: "RIG", rating: "needs", description: "", questionKeys: [], ruleId: "R9", status: "open", voided: false, photoIds: [] },
    { key: "fd_c", printedId: null, category: "RIG", rating: "needs", description: "", questionKeys: [], ruleId: "R2", status: "open", voided: true, photoIds: [] },
  ];
  ok(resolvedPromptIds(fv).join() === "flag:rigging.x,rule:R9", "editor: findings resolve their prompts (voided ones don't)");
}

/** Task 7 — the editor's save contract against the real store: a patch built by the editor model, the reply's rev
 *  adopted, a stale copy's scalars dropped, and the offline outbox doc through the push branch. */
async function assessmentEditorDbChecks(ok: Ok) {
  const db = await getDb();
  const created: string[] = [];
  try {
    await assessIdentityFixtures();
    const a = await createAssessment({ visitType: "condition", customerId: ASSESS_FIX.co1, siteId: ASSESS_FIX.site1, visitDate: Date.UTC(2026, 9, 13), assessorId: "u1" }, "u1");
    created.push(a.id);
    registerFixture("assessments", a.id);
    const U1 = { id: "u1" };
    let st = initEditorState(JSON.parse(JSON.stringify(a)) as EditorDoc);
    st = editorReducer(st, { type: "answer", key: "rigging.overhead", answer: answeredWith("counterweight", "u1", Date.now()) });
    const p1 = buildPatch(st)!;
    const r1 = await saveAssessment(a.id, p1, U1, { mode: "action" });
    ok(r1.ok && r1.doc.rev === a.rev + 1, "editor db: an editor patch saves and returns the stored rev");
    if (!r1.ok) return;
    st = editorReducer(st, { type: "saved", patch: p1, rev: r1.doc.rev });
    ok(st.doc.rev === r1.doc.rev && buildPatch(st) === null, "editor db: after adopting the reply nothing is pending");
    // another device moves the record on
    const other = await saveAssessment(a.id, { rev: r1.doc.rev, spaceLabel: "Stage left" }, { id: "u2" }, { mode: "action" });
    ok(other.ok, "editor db: a second device saves");
    // this device changes the space label from its now-stale copy → dropped, answers still merge
    st = editorReducer(st, { type: "scalar", field: "spaceLabel", value: "Mine" });
    st = editorReducer(st, { type: "answer", key: "rigging.cw_sets", answer: answeredWith(8, "u1", Date.now()) });
    const p2 = buildPatch(st)!;
    const r2 = await saveAssessment(a.id, p2, U1, { mode: "action" });
    ok(r2.ok && JSON.stringify(r2.dropped) === '["spaceLabel"]' && r2.doc.spaceLabel === "Stage left" && r2.doc.answers["rigging.cw_sets"]?.v === 8, "editor db: a stale copy's scalar is dropped (reported), its answers merge");
    if (!r2.ok) return;
    st = editorReducer(st, { type: "saved", patch: p2, rev: r2.doc.rev, dropped: r2.dropped });
    st = editorReducer(st, { type: "adopt", server: JSON.parse(JSON.stringify(r2.doc)) as EditorDoc });
    ok(st.doc.spaceLabel === "Stage left" && st.dropped.join() === "spaceLabel" && st.doc.rev === r2.doc.rev, "editor db: after the refreshed copy the stored space label shows and the drop is reported");
    // a refused answer names the key and changes nothing
    const bad = await saveAssessment(a.id, { rev: st.doc.rev, answers: { "rigging.overhead": answeredWith("spaceship", "u1", Date.now()) } }, U1, { mode: "action" });
    ok(!bad.ok && refusalParts(bad.error, ASSESSMENT_DEF).key === "rigging.overhead", "editor db: a refused save names the question (red banner)");
    // offline: the whole doc goes through the push branch; its clear marker merges; rev returned
    st = editorReducer(st, { type: "answer", key: "rigging.cw_sets", answer: clearMarker("u1", Date.now() + 1) });
    const full = buildFullDoc(st, Date.now());
    const pushed = await pushAssessment({ id: a.id, rev: full.rev as number, doc: full }, { id: "u1", roles: ["Estimator"] });
    const stored = (await getAssessment(a.id))!;
    ok(pushed.status === "ok" && pushed.rev === stored.rev && stored.answers["rigging.cw_sets"]?.v === null && "rigging.cw_sets" in stored.answers, "editor db: the outbox doc pushes ok with the stored rev; Clear keeps the key with v null");
    // the outbox carries base rev + 1: a device whose base is behind loses its dirty scalar; an up-to-date one keeps it
    const base0 = (await getAssessment(a.id))!;
    let dev = initEditorState(JSON.parse(JSON.stringify(base0)) as EditorDoc);
    await saveAssessment(a.id, { rev: base0.rev, spaceLabel: "Second device" }, { id: "u2" }, { mode: "action" });
    dev = editorReducer(dev, { type: "scalar", field: "spaceLabel", value: "Old label" });
    const staleFull = buildFullDoc(dev, Date.now());
    const sPush = await pushAssessment({ id: a.id, rev: staleFull.rev as number, doc: staleFull }, { id: "u1", roles: ["Estimator"] });
    const afterStale = (await getAssessment(a.id))!;
    ok(sPush.status === "ok" && afterStale.spaceLabel === "Second device" && afterStale.syncRejects?.some((r) => r.key === "field:spaceLabel") === true, "editor db: an offline doc from a stale base keeps the other device's label and records field:spaceLabel");
    let cur = initEditorState(JSON.parse(JSON.stringify(afterStale)) as EditorDoc);
    cur = editorReducer(cur, { type: "scalar", field: "spaceLabel", value: "Up to date" });
    const freshFull = buildFullDoc(cur, Date.now());
    await pushAssessment({ id: a.id, rev: freshFull.rev as number, doc: freshFull }, { id: "u1", roles: ["Estimator"] });
    ok((await getAssessment(a.id))!.spaceLabel === "Up to date", "editor db: an offline doc from an up-to-date base applies its edit");
    // clearSyncRejects: a pushed bad answer is recorded, then cleared with its rev returned
    const badFull = { ...full, answers: { ...(full.answers as Record<string, unknown>), "core.space_type": { v: "spaceship", state: "answered", at: Date.now() + 2, by: "u1" } }, rev: stored.rev + 1 };
    await pushAssessment({ id: a.id, rev: badFull.rev, doc: badFull }, { id: "u1", roles: ["Estimator"] });
    const withRej = (await getAssessment(a.id))!;
    ok(withRej.syncRejects?.some((r) => r.key === "core.space_type") === true, "editor db: a bad pushed answer lands in syncRejects");
    const cleared = await clearSyncRejects(a.id, ["core.space_type"], U1);
    ok(cleared.ok && cleared.doc.rev === withRej.rev + 1 && !cleared.doc.syncRejects?.some((r) => r.key === "core.space_type"), "editor db: clearing a sync reject returns the new rev to adopt");
  } finally {
    if (created.length) await db.delete(DOC_TABLES.assessments).where(inArray(DOC_TABLES.assessments.id, created));
    await dropAssessIdentityFixtures();
  }
}

/* ---------- Task 8: prompts → findings, photos, merge/split, codes, mark complete (pure) ---------- */

function task8Checks(ok: Ok) {
  const def = ASSESSMENT_DEF;
  const A = (v: unknown, at = 1): Answer => ({ v, state: "answered", at, by: "u1" });
  const allOn = def.scopes.map((s) => (s.depths?.length ? { code: s.code, on: true, depth: s.depths[s.depths.length - 1] } : { code: s.code, on: true }));
  const evalBase = { def, visitType: "condition", scopes: allOn, photos: [], dismissed: [], resolved: [], profile: {}, now: Date.UTC(2026, 9, 13) };

  // Placement ↔ rail badge: every placed prompt sits in the scope evaluate attributes it to, once; badges = placed.
  const qs = [...allQuestions(def).values()].map((x) => x.q);
  const optionOf = (q: QuestionDef, pick: "first" | "last") => { const o = q.options ? def.pickLists[q.options] ?? [] : []; return o.length ? (pick === "first" ? o[0] : o[o.length - 1]).value : undefined; };
  const fixture = (mode: "yes" | "no" | "flag"): Answers => {
    const out: Answers = {};
    for (const q of qs) {
      if (mode === "flag" && q.flag) { out[q.key] = A(q.type === "many" ? [q.flag.values[0]] : q.flag.values[0]); continue; }
      if (q.type === "yesno") out[q.key] = A(mode === "no" ? "no" : "yes");
      else if (q.type === "one") { const v = optionOf(q, mode === "no" ? "last" : "first"); if (v) out[q.key] = A(v); }
      else if (q.type === "many") { const v = optionOf(q, mode === "no" ? "last" : "first"); if (v) out[q.key] = A([v]); }
      else if (q.type === "number") out[q.key] = A(mode === "no" ? 2025 : 1950);
      else if (q.type === "date") out[q.key] = A(mode === "no" ? Date.UTC(2026, 8, 1) : Date.UTC(2010, 0, 1));
    }
    return out;
  };
  // One more fixture per prompt rule: the yes-ish answers plus answers that satisfy that rule's own condition.
  const satisfy = (c: Cond, out: Answers): void => {
    if ("all" in c) { c.all.forEach((x) => satisfy(x, out)); return; }
    if ("any" in c) { if (c.any.length) satisfy(c.any[0], out); return; }
    if ("not" in c || !("key" in c)) return;
    if ("in" in c) { const q = allQuestions(def).get(c.key)?.q; out[c.key] = A(q?.type === "many" ? [c.in[0]] : c.in[0]); return; }
    if ("olderThanDays" in c) { out[c.key] = A(Date.UTC(2000, 0, 1)); return; }
    if ("olderThanYears" in c) { out[c.key] = A(1900); return; }
    if ("state" in c) { if (c.state === "unanswered") delete out[c.key]; else out[c.key] = c.state === "na" ? { state: "na", at: 1, by: "u1" } : { state: "unable", reason: "x", at: 1, by: "u1" }; return; }
    out[c.key] = A(c.gt !== undefined ? c.gt + 1 : c.lt !== undefined ? c.lt - 1 : 1);
  };
  const perRule: [string, Answers][] = def.rules.filter((r) => r.prompt).map((r) => { const out = fixture("yes"); satisfy(r.when, out); return [r.id, out]; });
  const fixtures: [string, Answers][] = [["counterweight", { "rigging.overhead": A("counterweight"), "rigging.cw_sets": A(12) }], ["yes-ish", fixture("yes")], ["no-ish", fixture("no")], ["every flag", fixture("flag")], ...perRule];
  const exercised = new Set<string>();
  let agree = true, once = true, badges = true;
  for (const [, answers] of fixtures) {
    const r = evaluate({ ...evalBase, answers });
    const placedMap = placePrompts(def, r);
    const ids: string[] = [];
    for (const [place, ps] of placedMap) for (const p of ps) {
      ids.push(p.id);
      exercised.add(p.id);
      if (placementScope(def, place) !== promptScope(def, p)) agree = false;
    }
    if (ids.length !== new Set(ids).size) once = false;
    const sums = scopeSummaries(def, allOn, r);
    if (sums.reduce((n, s) => n + s.prompts, 0) !== ids.length) badges = false;
    for (const s of sums) if (s.prompts !== ids.filter((pid) => { const p = r.prompts.find((x) => x.id === pid)!; return promptScope(def, p) === s.code; }).length) badges = false;
  }
  const ruleIds = new Set([...exercised].filter((x) => x.startsWith("rule:")));
  const promptRules = def.rules.filter((r) => r.prompt).length;
  ok(agree && ruleIds.size === promptRules && [...exercised].some((x) => x.startsWith("flag:")), `prompts: every placed prompt sits in the scope its rail badge counts it in (${ruleIds.size} of ${promptRules} rule prompts + ${exercised.size - ruleIds.size} flag prompts over ${fixtures.length} fixtures)`);
  ok(once && badges, "prompts: each prompt is placed once and the rail badges add up to exactly what is placed, per scope");
  const fall = evaluate({ ...evalBase, answers: { "rigging.overhead": A("counterweight"), "rigging.access": A(["catwalk"]), "rigging.fall_hazard": A("yes") } });
  const fallPrompt = fall.prompts.find((p) => p.id === "flag:rigging.fall_hazard");
  ok(!!fallPrompt && [...placePrompts(def, fall)].some(([pl, ps]) => pl === "q:rigging.fall_hazard" && ps.includes(fallPrompt)), "prompts: rigging.access = catwalk + fall hazard = yes → the chip shows under the fall-hazard question");

  // buildFullDoc / buildPatch: a DIRTY photoSetOffered / visitDate is sent, a non-dirty one is dropped
  const base = initEditorState(editorDoc({ photoSetOffered: false, visitDate: 5 }));
  const fdClean = buildFullDoc(base, 1);
  ok(!("photoSetOffered" in fdClean) && !("visitDate" in fdClean), "editor: a non-dirty photoSetOffered / visitDate is left out of the outbox doc");
  const offered = editorReducer(base, { type: "scalar", field: "photoSetOffered", value: true });
  ok(buildFullDoc(offered, 1).photoSetOffered === true && buildPatch(offered)!.photoSetOffered === true && !("visitDate" in buildFullDoc(offered, 1)), "editor: a dirty photoSetOffered is sent (patch + outbox doc), visitDate still left out");
  const dated = editorReducer(base, { type: "scalar", field: "visitDate", value: Date.UTC(2026, 9, 14) });
  ok(buildFullDoc(dated, 1).visitDate === Date.UTC(2026, 9, 14) && buildPatch(dated)!.visitDate === Date.UTC(2026, 9, 14) && !("photoSetOffered" in buildFullDoc(dated, 1)), "editor: a dirty visitDate is sent, photoSetOffered left out");
  const offeredSaved = editorReducer(offered, { type: "saved", patch: buildPatch(offered)!, rev: 4 });
  ok(!offeredSaved.dirty.includes("photoSetOffered") && buildPatch(offeredSaved) === null, "editor: an acknowledged photoSetOffered stops being sent");

  // photos: add → sent with the next save; finalize → file + rev adopted; remove → gone, rev adopted, answers cleaned
  const ph = { id: "p_aaaaaaaaaaaa", pending: true as const, takenAt: 1, by: "u1", questionKey: "rigging.overhead", moduleId: "rigging.system" };
  let ps = editorReducer(initEditorState(editorDoc()), { type: "addPhoto", photo: ph });
  ok(ps.dirtyPhotos.join() === ph.id && buildPatch(ps)!.photos!.map((p) => p.id).join() === ph.id && editorReducer(ps, { type: "addPhoto", photo: ph }) === ps, "photos: a taken photo is pending in the record and sent with the next save (once)");
  ps = editorReducer(ps, { type: "photoDone", photoId: ph.id, ref: { blobPath: "assessments/AS-1001/p_aaaaaaaaaaaa.jpg" }, rev: 9 });
  ok(ps.doc.rev === 9 && ps.doc.photos[0].blobPath !== undefined && ps.doc.photos[0].pending === undefined && ps.dirtyPhotos.length === 0, "photos: a finished upload adopts its file and the finalize's rev (the rev contract)");
  ok(editorReducer(ps, { type: "photoDone", photoId: ph.id, ref: { inline: "x" }, rev: 3 }).doc.rev === 9, "photos: an older finalize rev never moves the rev back");
  const withAns = { ...initEditorState(editorDoc({ photos: [ph], answers: { "rigging.overhead": { ...A("counterweight"), photoIds: [ph.id, "p_bbbbbbbbbbbb"] } } })) };
  const removed = editorReducer(withAns, { type: "removePhoto", photoId: ph.id, rev: 12 });
  ok(removed.doc.rev === 12 && removed.doc.photos.length === 0 && removed.doc.answers["rigging.overhead"].photoIds!.join() === "p_bbbbbbbbbbbb" && buildPatch(removed) === null, "photos: a removed pending ref adopts the reply rev, drops the photo and its answer mention, and leaves nothing to resend");
  ok(canAddPhoto({ photos: Array.from({ length: 199 }, () => ph) }) && !canAddPhoto({ photos: Array.from({ length: 200 }, () => ph) }) && /200 photos/.test(PHOTO_LIMIT_MESSAGE), "photos: the 200th photo is the last one");
  ok(stuckPendingPhotos([ph, { ...ph, id: "p_cccccccccccc" }, { ...ph, id: "p_dddddddddddd", pending: undefined, blobPath: "x" }], ["p_cccccccccccc"]).map((p) => p.id).join() === ph.id, "photos: a pending photo with no bytes on this device is the stuck one (Remove photo)");

  // a cancelled new finding releases the photos taken in its sheet (they stay on the assessment)
  const fph: PhotoRef = { ...ph, id: "p_ffffffffffff", findingKey: "fd_0123456789abcdef", questionKey: "rigging.overhead" };
  const base0 = initEditorState(editorDoc({ photos: [fph, { ...ph, id: "p_gggggggggggg", findingKey: "fd_other" }] }));
  const unl = editorReducer(base0, { type: "unlinkFindingPhotos", findingKey: "fd_0123456789abcdef" });
  const unlPatch = buildPatch(unl);
  ok(unl.doc.photos.length === 2 && unl.doc.photos[0].findingKey === null && unl.doc.photos[0].questionKey === "rigging.overhead" && unl.doc.photos[1].findingKey === "fd_other" && unlPatch!.photos!.length === 1 && unlPatch!.photos![0].id === "p_ffffffffffff" && unlPatch!.photos![0].findingKey === null && editorReducer(unl, { type: "unlinkFindingPhotos", findingKey: "fd_0123456789abcdef" }) === unl && editorReducer(base0, { type: "unlinkFindingPhotos", findingKey: "fd_none" }) === base0, "sheet: cancelling a new finding clears findingKey (null on the wire) from its photos only, keeps their question, and resends once");

  // a same-rev server copy that still holds the key must not undo the unlink (the null must still be sent)
  const srvSame = editorDoc({ photos: [{ ...fph, blobPath: "assessments/AS-1001/p_ffffffffffff.jpg" }, { ...ph, id: "p_gggggggggggg", findingKey: "fd_other" }] });
  const adopted = editorReducer(unl, { type: "adopt", server: srvSame });
  const adoptedPatch = buildPatch(adopted);
  ok(adopted.doc.photos[0].findingKey === null && adopted.doc.photos[0].blobPath === "assessments/AS-1001/p_ffffffffffff.jpg" && adopted.dirtyPhotos.join() === "p_ffffffffffff" && !!adoptedPatch && adoptedPatch.photos!.length === 1 && adoptedPatch.photos![0].findingKey === null, "sheet: adopting a same-rev server copy keeps the local unlink (findingKey null, still dirty, still sent) and takes the server's file fields");
  const srvCleared = editorDoc({ photos: [{ ...fph, findingKey: undefined }, { ...ph, id: "p_gggggggggggg", findingKey: "fd_other" }] });
  const adopted2 = editorReducer(unl, { type: "adopt", server: srvCleared });
  ok(adopted2.dirtyPhotos.length === 0 && adopted2.doc.photos[0].findingKey === undefined, "sheet: once the server copy has the key cleared the photo stops being dirty");

  // the audit-estimate field keeps what is typed and parses it on blur
  ok(parseMoney("").ok && parseMoney("  ").ok && (parseMoney("") as { value?: number }).value === undefined && (parseMoney("12.50") as { value: number }).value === 12.5 && (parseMoney("$4,000") as { value: number }).value === 4000 && (parseMoney("12.") as { value: number }).value === 12 && !parseMoney("abc").ok && !parseMoney("-5").ok && !parseMoney("1e3x").ok && !parseMoney("1.2.3").ok, "sheet: the audit estimate parses decimals, $ and commas, empty clears, junk is an error");

  // dismiss: appended once, sent with the next save
  const dis = editorReducer(initEditorState(editorDoc()), { type: "dismissPrompt", entry: { id: "rule:G4", by: "u1", at: 5 } });
  ok(buildPatch(dis)!.dismissedPrompts!.map((d) => d.id).join() === "rule:G4" && editorReducer(dis, { type: "dismissPrompt", entry: { id: "rule:G4", by: "u1", at: 6 } }) === dis, "prompts: Dismiss appends { id, by, at } once and sends it");

  // resolution: rule by ruleId; flag by X5 or a rule-less finding linking the question; voided no, merged-away yes
  ok(resolvedFromFindings([{ ruleId: "R10", questionKeys: ["rigging.overhead"] }]).join() === "rule:R10", "prompts: a rule prompt is resolved by its ruleId (R10)");
  ok(resolvedFromFindings([{ ruleId: "X5", questionKeys: ["a.b"] }, { questionKeys: ["c.d"] }]).sort().join() === "flag:a.b,flag:c.d", "prompts: a flag prompt is resolved by an X5 finding, or a finding with no rule that links the question");
  ok(resolvedFromFindings([{ key: "a", ruleId: "R9", questionKeys: [], voided: true }]).length === 0 && resolvedFromFindings([{ key: "a", ruleId: "R9", questionKeys: [], voided: { mergedInto: "k" } }, { key: "k", ruleId: "R1", questionKeys: [] }]).sort().join() === "rule:R1,rule:R9" && resolvedFromFindings([{ key: "a", ruleId: "R9", questionKeys: [], voided: true, mergedInto: "k" }, { key: "k", questionKeys: ["q.x"] }]).sort().join() === "flag:q.x,rule:R9", "prompts: a voided finding resolves nothing, unless it was merged into a live finding (structural mergedInto)");
  // the merge exception can't hide a gap: the keeper voided, a missing keeper, a cycle, a typed reason, a long chain
  const vmo = (key: string, mergedInto?: string): { key: string; questionKeys: string[]; voided: boolean; mergedInto?: string } => ({ key, questionKeys: [], voided: true, ...(mergedInto ? { mergedInto } : {}) });
  ok(resolvedFromFindings([{ ...vmo("a", "k"), ruleId: "R10" }, { ...vmo("k"), ruleId: "R2" }]).length === 0, "prompts: voiding the keeper reopens the merged-away finding's prompt (R10)");
  ok(resolvedFromFindings([{ ...vmo("a", "gone"), ruleId: "R10" }]).length === 0, "prompts: a merge target that isn't in the list resolves nothing");
  ok(resolvedFromFindings([{ ...vmo("a", "b"), ruleId: "R10" }, vmo("b", "a")]).length === 0 && resolvedFromFindings([{ ...vmo("a", "a"), ruleId: "R10" }]).length === 0, "prompts: a merge cycle resolves nothing (and terminates)");
  ok(resolvedFromFindings([{ key: "a", ruleId: "R10", questionKeys: [], voided: { reason: "Merged into X" } as never }, { key: "k", ruleId: "R1", questionKeys: [] }]).join() === "rule:R1", "prompts: a typed \"Merged into …\" reason resolves nothing — only mergedInto counts");
  ok(resolvedFromFindings([{ ...vmo("a", "k1"), ruleId: "R10" }, vmo("k1", "k2"), { key: "k2", ruleId: "R1", questionKeys: [] }]).sort().join() === "rule:R1,rule:R10", "prompts: a chain A→K1→K2 (live) still resolves");
  ok(voidReasonProblem("") !== null && voidReasonProblem("   ") !== null && voidReasonProblem(undefined) !== null && voidReasonProblem("Merged into ACO-ASS-RIG-001") !== null && voidReasonProblem("  merged into x") !== null && voidReasonProblem("Duplicate of RIG-002") === null, "void: a reason is required and can't start \"Merged into\"");

  // merge / split plans
  const fm = (key: string, o: Partial<Finding> = {}): Finding => ({ key, printedId: `ACO-ASS-RIG-00${key.slice(-1)}`, customerId: "c", siteId: "s", category: "RIG", description: `d${key.slice(-1)}`, assessmentId: "AS-1", questionKeys: [], photoIds: [], rating: "needs", quoteRefs: [], status: "open", history: [], createdAt: 1, createdBy: "u1", updatedAt: 1, seq: 1, companyCode: "ACO", siteCode: "ASS", ...o });
  const mp = mergePlan([fm("f1", { photoIds: ["p1"], questionKeys: ["q1"] }), fm("f2", { photoIds: ["p2", "p1"], questionKeys: ["q2"] }), fm("f3", { description: "d1" })]);
  ok(mp.ok && mp.keep === "f1" && mp.patch.description === "d1\n\nd2" && mp.patch.photoIds.join() === "p1,p2" && mp.patch.questionKeys.join() === "q1,q2" && mp.voids.map((v) => `${v.key}:${v.reason}:${v.mergedInto}`).join() === "f2:Merged into ACO-ASS-RIG-001:f1,f3:Merged into ACO-ASS-RIG-001:f1", "merge: the first is kept with the others' descriptions/photos/questions; the rest are voided \"Merged into <printedId>\"");
  const mpd = mergePlan([fm("f1", { description: "d1\n\nd2" }), fm("f2", { description: "d2" }), fm("f3", { description: "d2\n\nd3" })]);
  ok(mpd.ok && mpd.patch.description === "d1\n\nd2\n\nd3", "merge: descriptions are deduped by paragraph, so a retry never appends d2/d3 twice");
  ok(!mergePlan([fm("f1")]).ok && !mergePlan([fm("f1", { printedId: null }), fm("f2")]).ok && !mergePlan([fm("f1"), fm("f2", { voided: { by: "u", at: 1, reason: "x" } })]).ok && !mergePlan([fm("f1"), fm("f2", { assessmentId: "AS-2" })]).ok && !mergePlan([fm("f1"), fm("f1")]).ok, "merge: refused for one finding, an unnumbered keeper, a voided one, another assessment, or a repeat");
  const sp = splitPlan(fm("f1", { photoIds: ["p1", "p2"], questionKeys: ["q1", "q2"], ruleId: "R10", location: "LS 4" }), { photoIds: ["p2"], questionKeys: ["q2"] }, "fd_new");
  ok(sp.ok && sp.kept.photoIds.join() === "p1" && sp.kept.questionKeys.join() === "q1" && sp.created.key === "fd_new" && sp.created.photoIds!.join() === "p2" && sp.created.location === "LS 4" && sp.created.ruleId === undefined && sp.created.printedId === undefined, "split: the chosen photos/questions move to a duplicate with no number or rule of its own");
  const immF = fm("f1", { rating: "immediate", photoIds: ["p1"], recommendedAction: "Close it", immediate: { hazardContactNotified: false, lockout: "none" } });
  ok(!splitPlan(immF, { photoIds: [], questionKeys: [] }, "fd_n").ok && !splitPlan(immF, { photoIds: ["p9"], questionKeys: [] }, "fd_n").ok && !splitPlan(immF, { photoIds: ["p1"], questionKeys: [] }, "fd_n").ok, "split: nothing chosen, a foreign photo, or an Immediate finding left without a photo is refused");
  ok(/^fd_[0-9a-f]{16}$/.test(newFindingKey()) && newFindingKey() !== newFindingKey(), "findings: client keys are fd_ + 16 hex");
  const cf = (customerId: string, siteId: string): Finding => fm("f1", { customerId, siteId });
  ok(codeChangeNeedsApprove([cf("cA", "sA")], "company", "ACO", { customerId: "cA" }) && !codeChangeNeedsApprove([cf("cA", "sA")], "company", "ACO", { customerId: "cB" }) && codeChangeNeedsApprove([cf("cA", "sA")], "site", "ASS", { customerId: "cA", siteId: "sA" }) && !codeChangeNeedsApprove([cf("cA", "sA")], "site", "ASS", { customerId: "cA", siteId: "sB" }) && !codeChangeNeedsApprove([], "site", "ASS", { customerId: "cA", siteId: "sA" }), "codes: whether a change needs approve is decided from that company's / venue's own findings");
  ok(codeScopeMismatch("cB", { companyId: "cA" }) && !codeScopeMismatch("cA", { companyId: "cA" }) && !codeScopeMismatch(undefined, { companyId: "cA" }) && !codeScopeMismatch("cA", null), "codes: a company id that isn't the venue's company is a mismatch (the create-only bypass)");
  ok(!codeInUse([fm("f1")], null, "company") && codeInUse([fm("f1")], "ACO", "company"), "codes: a missing code is never in use");

  // the finding sheet's model
  const fdoc = editorDoc({ photos: [ph, { ...ph, id: "p_eeeeeeeeeeee", questionKey: "rigging.fall_hazard" }], answers: { "rigging.access": { ...A(["catwalk"]), photoIds: [ph.id] } } });
  const pre = findingFromPrompt(fallPrompt!, fdoc, "fd_0123456789abcdef");
  ok(pre.category === "RIG" && pre.rating === "immediate" && pre.description === fallPrompt!.text && pre.ruleId === "X5" && pre.questionKeys.join() === "rigging.fall_hazard" && pre.photoIds.join() === "p_eeeeeeeeeeee" && pre.rev === 0 && pre.assessmentId === "AS-1001", "sheet: Create from a chip pre-fills category, rating, text, question, rule and that question's photos");
  ok(photosForQuestions(fdoc, ["rigging.access"]).join() === ph.id, "sheet: photos listed on an answer count as attached to that question");
  const probs = findingSheetProblems(pre);
  ok(probs.length === 3 && !probs.some((p) => /photo/i.test(p)) && findingSheetProblems({ ...pre, photoIds: [] }).some((p) => /photo/i.test(p)) && findingSheetProblems({ ...pre, photoIds: ["p1"], recommendedAction: "Close the catwalk", immediate: { hazardContactNotified: true, notifiedAt: 5, lockout: "locked" } }).length === 0, "sheet: Save stays disabled until the Immediate rules (notify + time, lockout, action) are met");
  ok(findingSheetProblems({ ...pre, rating: "needs", description: "  " }).join() === "Describe the finding.", "sheet: a description is required");
  const sd = findingSaveDoc({ ...pre, rating: "needs", location: " ", owner: { kind: "staff", name: "" }, auditRef: { item: "A-12", estimate: 4000 } }, 7);
  ok(sd.location === null && sd.owner === null && sd.immediate === null && JSON.stringify(sd.auditRef) === '{"item":"A-12","estimate":4000}' && sd.ruleId === "X5" && sd.rev === 0 && sd.status === "open" && sd.key === pre.key, "sheet: the saved doc clears empty optional fields with null, drops immediate unless Immediate, keeps the base rev");
  ok(routingHref("RIG", "c 1", "loc1") === "/inspections/quote?customer=c+1&venue=loc1" && routingHref("ELC", "c1", null) === null, "sheet: RIG routes to the inspection quote builder for this customer + venue; others have no link");
  const vm = (key: string, rev: number, printedId: string | null): FindingVM => ({ key, printedId, category: "RIG", rating: "needs", description: "", questionKeys: [], status: "open", voided: false, photoIds: [], rev });
  const ml = mergeFindingLists([vm("a", 3, "X-001"), vm("b", 2, "X-002")], { a: { ...vm("a", 3, "X-001"), description: "local" }, b: { ...vm("b", 1, "X-002"), description: "stale" }, c: vm("c", 0, null) });
  ok(ml.map((f) => `${f.key}:${f.description || "-"}`).join() === "a:local,b:-,c:-", "sheet: a local copy shows until the server moves past its base rev; an unsynced one lists last");

  // photo set banner + Mark complete gap groups
  const coreReq = [...allQuestions(def).values()].filter((x) => x.q.required && def.scopes[0].modules.some((m) => m.questions.includes(x.q))).map((x) => x.q.key);
  const coreDone: Answers = Object.fromEntries(coreReq.map((k) => [k, { state: "na" as const, at: 1, by: "u1" }]));
  const rDone = evaluate({ ...evalBase, scopes: [{ code: "S0", on: true }], answers: coreDone });
  ok(coreReq.length > 0 && photoSetOfferDue(def, rDone, {}) && !photoSetOfferDue(def, rDone, { photoSetOffered: true }) && !photoSetOfferDue(def, evaluate({ ...evalBase, answers: {} }), {}), "photo set: offered once Core's required questions are done, never again after Dismiss");
  const gg = gapGroups(["Question: Seat count", "Photo: Access — The access point", "Prompt: Rigging inspection due", "Assessment not found"]);
  ok(gg.questions.join() === "Seat count" && gg.photos.join() === "Access — The access point" && gg.prompts.join() === "Rigging inspection due" && gg.other.length === 1, "complete: gaps group into questions, photos and prompts");
}

/** Task 8 — merge / split against the real store (voided "Merged into <printedId>", numbers never reused) and the
 *  short-code in-use rule over listFindings. */
async function task8DbChecks(ok: Ok) {
  const db = await getDb();
  const created: string[] = [];
  const k8 = (n: number) => `fd_t8${String(n).padStart(14, "0")}`;
  try {
    await assessIdentityFixtures();
    const { co1, site1 } = ASSESS_FIX;
    const U1 = { id: "u1" };
    const a = await createAssessment({ visitType: "condition", customerId: co1, siteId: site1, visitDate: Date.UTC(2026, 9, 13), assessorId: "u1" }, "u1");
    created.push(a.id);
    registerFixture("assessments", a.id);
    const mk = (n: number, o: Partial<Finding> = {}) => saveFinding({ key: k8(n), customerId: co1, siteId: site1, assessmentId: a.id, category: "RIG", rating: "needs", description: `Finding ${n}`, ...o }, U1);
    ok(!codeInUse(await listFindings({ customerId: co1 }), (await getCompany(co1))?.shortCode, "company"), "codes db: before any finding the company code is not in use (editable with create)");
    await saveAssessment(a.id, { answers: { "rigging.overhead": answeredWith("counterweight", "u1", Date.now()) } }, U1);
    const g0 = await completeAssessment(a.id, U1, false);
    ok(!g0.ok && g0.gaps.some((x) => /^Prompt: Rigging inspection due/.test(x)), "merge db: precondition — R10 is an open prompt on this assessment");
    // f2 carries R10; after the merge it is voided, and the prompt must stay resolved through the kept f1.
    const f1 = await mk(1, { photoIds: ["p_t8aaaaaaaa"], questionKeys: ["rigging.overhead"] });
    const f2 = await mk(2, { photoIds: ["p_t8bbbbbbbb"], questionKeys: ["rigging.fall_hazard"], ruleId: "R10" });
    const f3 = await mk(3);
    ok(f1.ok && f2.ok && f3.ok, "merge db: three findings created");
    if (!f1.ok || !f2.ok || !f3.ok) return;
    const company = (await getCompany(co1))!.shortCode;
    const live = await listFindings({ customerId: co1 });
    ok(!!company && codeInUse(live, company, "company") && codeInUse(live.filter((f) => f.siteId === site1), (await getSite(site1))!.shortCode, "site"), "codes db: once a live finding carries the codes they are in use (changing them needs approve)");
    const maxBefore = Math.max(f1.doc.seq!, f2.doc.seq!, f3.doc.seq!);
    const m = await mergeFindings([k8(1), k8(2), k8(3)], U1);
    ok(m.ok && m.kept.key === k8(1) && m.voided.length === 2 && m.voided.every((v) => v.voided?.reason === `Merged into ${f1.doc.printedId}`), "merge db: the others are voided with \"Merged into <printedId>\"");
    if (!m.ok) return;
    ok(m.kept.photoIds.join() === "p_t8aaaaaaaa,p_t8bbbbbbbb" && m.kept.questionKeys.join() === "rigging.overhead,rigging.fall_hazard" && m.kept.description === "Finding 1\n\nFinding 2\n\nFinding 3" && m.kept.rev! > f1.doc.rev!, "merge db: the kept finding has every description, photo and question (and a new rev)");
    ok(m.voided.map((v) => v.printedId).join() === [f2.doc.printedId, f3.doc.printedId].join(), "merge db: merged-away findings keep their printed ids");
    const f4 = await mk(4);
    ok(f4.ok && f4.doc.seq === maxBefore + 1 && f4.doc.printedId !== f2.doc.printedId && f4.doc.printedId !== f3.doc.printedId, "merge db: the next finding takes max + 1 — merged numbers are never reused");
    const g = await completeAssessment(a.id, U1, false);
    ok(!g.ok && !g.gaps.some((x) => /Rigging inspection due/.test(x)), "merge db: Mark complete still refuses for other gaps, but no longer lists the Rigging-inspection-due (R10) prompt — it resolves through the kept finding");
    // retry = idempotent: already merged into this keeper → skipped, nothing rewritten
    const again = await mergeFindings([k8(1), k8(2), k8(3)], U1);
    ok(again.ok && again.kept.rev === m.kept.rev && again.kept.description === m.kept.description && again.voided.length === 2, "merge db: repeating a finished merge is an idempotent no-op (same rev and description)");
    // a half-finished merge picked up again appends only the new finding's text, once
    const [f10, f11, f12] = [await mk(10), await mk(11), await mk(12)];
    const part = await mergeFindings([k8(10), k8(11)], U1);
    const rest = await mergeFindings([k8(10), k8(11), k8(12)], U1);
    ok(f10.ok && f11.ok && f12.ok && part.ok && rest.ok && rest.kept.description === "Finding 10\n\nFinding 11\n\nFinding 12" && rest.voided.length === 2, "merge db: re-running a merge with one more finding skips the merged one and appends the new description once");
    // two merges of the same findings at once serialize under the merge lock
    await mk(13); await mk(14);
    const [c1, c2] = await Promise.all([mergeFindings([k8(13), k8(14)], U1), mergeFindings([k8(13), k8(14)], U1)]);
    ok(c1.ok && c2.ok && c1.kept.description === "Finding 13\n\nFinding 14" && c2.kept.description === "Finding 13\n\nFinding 14" && (await getFinding(k8(14)))?.voided?.mergedInto === k8(13), "merge db: concurrent merges of the same findings serialize (each description once, mergedInto recorded)");
    ok(m.voided.every((v) => v.voided?.mergedInto === k8(1)), "merge db: a merged-away finding records the keeper's key as voided.mergedInto");
    // a voided finding that wasn't merged away can't be merged, and a typed "Merged into" reason can't forge a merge
    const f15 = await mk(15);
    await voidFinding(k8(15), "Duplicate entry", U1);
    ok(f15.ok && (await getFinding(k8(15)))?.voided?.mergedInto === undefined && !(await mergeFindings([k8(1), k8(15)], U1)).ok, "merge db: a plainly voided finding has no mergedInto and can't be merged");
    const forged = await voidFinding(k8(4), "Merged into " + f1.doc.printedId, U1).then(() => true, () => false);
    const blankVoid = await voidFinding(k8(4), "  ", U1).then(() => true, () => false);
    ok(!forged && !blankVoid && !(await getFinding(k8(4)))?.voided, "void db: a blank reason and a typed \"Merged into …\" reason are refused");
    // a voided keeper can't be "merged" even when every other key is already merged into it
    const f16 = await mk(16); const f17 = await mk(17);
    const m16 = await mergeFindings([k8(16), k8(17)], U1);
    await voidFinding(k8(16), "Entered in error", U1);
    const m16b = await mergeFindings([k8(16), k8(17)], U1);
    ok(f16.ok && f17.ok && m16.ok && !m16b.ok && /voided/i.test(m16b.error), "merge db: a voided keeper is refused on the idempotent retry too");
    // rollback: a failure after the keeper's save and the first void persists nothing
    const f18 = await mk(18, { photoIds: ["p_t8dddddddd"] }); await mk(19, { photoIds: ["p_t8eeeeeeee"] }); await mk(20);
    const before18 = await getFinding(k8(18));
    const rb = await mergeFindings([k8(18), k8(19), k8(20)], U1, { __failAfterFirstWriteForTest: true });
    const after = [await getFinding(k8(18)), await getFinding(k8(19)), await getFinding(k8(20))];
    ok(f18.ok && !rb.ok && after[0]?.rev === before18?.rev && after[0]?.description === "Finding 18" && after[0]?.photoIds.join() === "p_t8dddddddd" && !after[1]?.voided && !after[2]?.voided, "merge db: a failure part-way rolls back the keeper save and the first void");
    const retry18 = await mergeFindings([k8(18), k8(19), k8(20)], U1);
    ok(retry18.ok && retry18.voided.length === 2, "merge db: the merge succeeds when retried after the rollback");
    // photos: findingKey null clears the link (a cancelled new-finding sheet), keeping the photo on the assessment
    await saveAssessment(a.id, { photos: [{ id: "p_t8cccccccc", findingKey: k8(30) } as PhotoRef] }, U1);
    const withKey = (await getAssessment(a.id))!.photos.find((p) => p.id === "p_t8cccccccc");
    await saveAssessment(a.id, { photos: [{ id: "p_t8cccccccc", findingKey: null } as PhotoRef] }, U1);
    const cleared = (await getAssessment(a.id))!.photos.find((p) => p.id === "p_t8cccccccc");
    ok(withKey?.findingKey === k8(30) && !!cleared && cleared.findingKey === undefined, "photos db: findingKey null clears the link and the photo stays");
    // split
    const s = await splitFinding(k8(1), { photoIds: ["p_t8bbbbbbbb"], questionKeys: ["rigging.fall_hazard"] }, k8(5), U1);
    ok(s.ok && s.created.key === k8(5) && s.created.photoIds.join() === "p_t8bbbbbbbb" && s.kept.photoIds.join() === "p_t8aaaaaaaa" && s.kept.questionKeys.join() === "rigging.overhead" && !!s.created.printedId && s.created.printedId !== s.kept.printedId && f4.ok && s.created.seq! > f4.doc.seq!, "split db: the chosen photo + question move to a new, newly numbered finding");
    // splitting an unnumbered original numbers it before the new finding (original seq < new seq)
    const f21 = await mk(21, { photoIds: ["p_t8ffffffff"], questionKeys: ["rigging.overhead", "rigging.fall_hazard"] });
    await db.update(DOC_TABLES.findings).set({ doc: sql`doc || '{"printedId":null,"seq":null}'::jsonb` }).where(eq(DOC_TABLES.findings.id, k8(21)));
    const un = await getFinding(k8(21));
    const s21 = await splitFinding(k8(21), { photoIds: [], questionKeys: ["rigging.fall_hazard"] }, k8(22), U1);
    ok(f21.ok && un?.printedId == null && s21.ok && !!s21.kept.printedId && !!s21.created.printedId && s21.kept.seq! < s21.created.seq!, "split db: splitting an unnumbered original numbers it before the new finding");
    ok(!(await splitFinding(k8(1), { photoIds: [], questionKeys: [] }, k8(6), U1)).ok, "split db: nothing chosen is refused");
    // voiding the keeper takes the merged-away finding's prompt with it: R10 is a gap again
    await voidFinding(k8(1), "Entered in error", U1);
    const gv = await completeAssessment(a.id, U1, false);
    ok(!gv.ok && gv.gaps.some((x) => /^Prompt: Rigging inspection due/.test(x)), "merge db: voiding the keeper reopens the merged-away finding's R10 prompt (Mark complete lists it again)");
    // completed assessments refuse merge / split
    const f7 = await mk(7, { questionKeys: ["rigging.overhead"] });
    const f8 = await mk(8);
    await db.update(DOC_TABLES.assessments).set({ doc: sql`jsonb_set(doc, '{status}', '"completed"')` }).where(eq(DOC_TABLES.assessments.id, a.id));
    const mDone = await mergeFindings([k8(7), k8(8)], U1);
    const sDone = await splitFinding(k8(7), { photoIds: [], questionKeys: ["rigging.overhead"] }, k8(9), U1);
    ok(f7.ok && f8.ok && !mDone.ok && /completed/.test(mDone.error) && !sDone.ok && /completed/.test(sDone.error), "merge/split db: refused once the assessment is completed");
    // codes free again once every finding of the customer is voided
    for (const f of await listFindings({ customerId: co1 })) await voidFinding(f.key, "test", U1);
    ok(!codeInUse(await listFindings({ customerId: co1, includeVoided: true }), company, "company"), "codes db: voided findings don't lock a code");
  } finally {
    await db.delete(DOC_TABLES.findings).where(like(DOC_TABLES.findings.id, "fd_t8%"));
    if (created.length) await db.delete(DOC_TABLES.assessments).where(inArray(DOC_TABLES.assessments.id, created));
    await dropAssessIdentityFixtures();
  }
}

/* ---------- Task 9: the findings register, Quote these findings, CSV ---------- */

const t9Finding = (o: Partial<Finding> = {}): Finding => ({
  key: "fd_t9pure0000000001", printedId: "TSTA-HAL-RIG-001", customerId: "c1", siteId: "s1", category: "RIG",
  description: "Frayed lift line", assessmentId: "AS-1001", questionKeys: [], photoIds: [], rating: "needs", quoteRefs: [],
  status: "open", history: [], createdAt: 1, createdBy: "u1", updatedAt: 1, seq: 1, companyCode: "TSTA", siteCode: "HAL", ...o,
});

function task9Checks(ok: Ok) {
  // buildQuote carries findingKeys only when set
  const withKeys = buildQuote("Q-T9", { name: "x", findingKeys: ["fd_aaaaaaaaaaaaaaaa"] }, "repair", null, 1);
  const without = buildQuote("Q-T9", { name: "x" }, "repair", null, 1);
  const emptyKeys = buildQuote("Q-T9", { name: "x", findingKeys: [] }, "repair", null, 1);
  ok(withKeys.findingKeys?.join() === "fd_aaaaaaaaaaaaaaaa" && !("findingKeys" in without) && !("findingKeys" in emptyKeys), "quote findingKeys: buildQuote keeps them when set; absent (no key at all) when unset or empty");
  ok(JSON.stringify(buildQuote("Q-T9", { name: "x", owner: "A" }, "system", null, 7)) === JSON.stringify(buildQuote("Q-T9", { name: "x", owner: "A", findingKeys: undefined }, "system", null, 7)), "quote findingKeys: a quote without findings is built byte-identically");

  // finding keys from a URL / form field
  const k1 = "fd_0123456789abcdef", k2 = "fd_fedcba9876543210";
  ok(parseFindingKeys(` ${k1},${k2},${k1},fd_BAD,nope,fd_0123`).join() === `${k1},${k2}` && parseFindingKeys([k2, 3, k1]).join() === `${k2},${k1}` && parseFindingKeys(undefined).length === 0, "quote keys: fd_ keys only, trimmed, de-duplicated, first-seen order");
  ok(parseFindingKeys(Array.from({ length: 150 }, (_, i) => "fd_" + String(i).padStart(16, "0"))).length === QUOTE_FINDINGS_MAX, "quote keys: capped at QUOTE_FINDINGS_MAX");

  // the selection rule
  ok(quoteSelectionProblem([t9Finding(), t9Finding({ key: "fd_t9pure0000000002", siteId: "s2" })]) === ONE_VENUE_ERROR && ONE_VENUE_ERROR === "Pick findings from one venue", "quote selection: two venues → \"Pick findings from one venue\"");
  ok(quoteSelectionProblem([t9Finding(), t9Finding({ key: "fd_t9pure0000000002", customerId: "c2" })]) === ONE_VENUE_ERROR, "quote selection: two customers → refused the same way");
  ok(quoteSelectionProblem([t9Finding({ voided: { by: "u", at: 1, reason: "x" } })]) !== null && quoteSelectionProblem([]) !== null && quoteSelectionProblem([t9Finding(), t9Finding({ key: "fd_t9pure0000000002" })]) === null, "quote selection: voided or empty refused; one venue is fine");

  // category / priority mapping
  ok(REPAIR_CATEGORY.RIG === "rigging" && REPAIR_CATEGORY.ELC === "electrics" && REPAIR_CATEGORY.STR === "structural" && REPAIR_CATEGORY.HAZ === "other" && REPAIR_CATEGORY.GEN === "other", "repair intake: RIG→rigging, ELC→electrics, STR→structural, HAZ/GEN→other");
  ok(repairCategoryFor(["ELC", "RIG", "RIG"]) === "rigging" && repairCategoryFor(["HAZ", "GEN", "RIG"]) === "other" && repairCategoryFor(["ELC", "RIG"]) === "electrics" && repairCategoryFor([]) === "other", "repair intake: the most common mapped category wins; a tie goes to the first seen");
  const repairCats = new Set<string>(REPAIR_CATEGORIES.map((c) => c.key));
  const repairPris = new Set<string>(REPAIR_PRIORITIES.map((p) => p.key));
  ok(Object.values(REPAIR_CATEGORY).every((c) => repairCats.has(c)) && repairPris.has("urgent") && repairPris.has("standard"), "repair intake: every mapped category / priority is a real repair builder key");

  // the repair builder's pre-fill
  const fa = t9Finding({ rating: "immediate", description: "Frayed\n  lift line", recommendedAction: "Take the set out of service" });
  const fb = t9Finding({ key: "fd_t9pure0000000002", printedId: "TSTA-HAL-ELC-001", category: "ELC", description: "Loose dimmer cover" });
  const pre = repairPrefillFromFindings([fa, fb], "Assess Hall");
  ok(pre.scopeItems.length === 2 && pre.scopeItems[0] === "TSTA-HAL-RIG-001 — Frayed lift line" && pre.scopeItems[1].startsWith("TSTA-HAL-ELC-001 — "), "repair intake: one scope item per finding, \"<printedId> — <description>\" (whitespace collapsed)");
  ok(pre.notes === "TSTA-HAL-RIG-001: Take the set out of service" && pre.priority === "urgent" && pre.category === "rigging", "repair intake: notes carry each recommended action; any immediate → urgent");
  ok(repairPrefillFromFindings([fb], "Assess Hall").priority === "standard", "repair intake: no immediate finding → standard");
  ok(pre.source.kind === "direct" && pre.source.label === "Assessment findings TSTA-HAL-RIG-001, TSTA-HAL-ELC-001" && pre.quoteName === "Repairs — Assess Hall" && pre.findingKeys.join() === `${fa.key},${fb.key}`, "repair intake: a direct source labelled with the printed ids; the keys ride along");
  ok(findingLineText(t9Finding({ description: "x".repeat(400) })).length === 240 && findingLineText(t9Finding({ printedId: null })).startsWith("TSTA-HAL-RIG-… — "), "repair intake: long lines are capped; an unnumbered finding shows its pending label");
  ok(findingsSourceLabel(Array.from({ length: 12 }, (_, i) => t9Finding({ printedId: `X-Y-RIG-${i}` }))).endsWith("X-Y-RIG-9 + 2 more"), "repair intake: the source label lists ten ids, then + N more");

  // the Estimator system
  const sec = findingsEstimatorSection([fa, fb], { sectionId: "sys9", venueName: "Assess Hall", freightPct: 4 });
  ok(sec.id === "sys9" && sec.kind === "materials" && sec.items.length === 2 && sec.items.every((it) => it.qty === 1 && it.unit === "ea" && it.cost === 0 && it.price === 0 && it.sku === "" && it.custom === true) && sec.items[0].desc.startsWith("TSTA-HAL-RIG-001 — ") && sec.items.map((it) => it.id).join() === "1,2", "estimator findings: one zero-priced ea line per finding, desc starts with the printed id");

  // register filters + sort
  const pf = parseRegisterFilters({ customer: " c1 ", category: "RIG", rating: "bogus", status: "quoted", priority: "high", budget: "lt10k", voided: "1", venue: ["s1", "s2"] });
  ok(pf.customer === "c1" && pf.venue === "s1" && pf.category === "RIG" && pf.rating === "" && pf.status === "quoted" && pf.priority === "high" && pf.budget === "lt10k" && pf.voided, "register filters: read from the query; unknown values drop");
  ok(registerQuery(pf) === "customer=c1&venue=s1&category=RIG&status=quoted&priority=high&budget=lt10k&voided=1" && JSON.stringify(parseRegisterFilters(new URLSearchParams(registerQuery(pf)))) === JSON.stringify(pf), "register filters: round-trip through the query string");
  const list = [
    t9Finding({ key: "fd_s0000000000000001", printedId: "A-B-RIG-010", rating: "good" }),
    t9Finding({ key: "fd_s0000000000000002", printedId: "A-B-RIG-002", rating: "needs", priority: "low" }),
    t9Finding({ key: "fd_s0000000000000003", printedId: "A-B-RIG-009", rating: "immediate" }),
    t9Finding({ key: "fd_s0000000000000004", printedId: "A-B-RIG-003", rating: "needs", priority: "high" }),
    t9Finding({ key: "fd_s0000000000000005", printedId: "A-B-RIG-001", rating: "immediate", voided: { by: "u", at: 1, reason: "x" } }),
  ];
  ok(registerList(list, parseRegisterFilters({})).map((f) => f.printedId).join() === "A-B-RIG-009,A-B-RIG-003,A-B-RIG-002,A-B-RIG-010", "register sort: immediate pinned first, then rating, priority, printed id; voided hidden");
  ok(registerList(list, parseRegisterFilters({ voided: "1" })).at(-1)?.printedId === "A-B-RIG-001" && registerList(list, parseRegisterFilters({ priority: "high" })).length === 1, "register: voided shown last with ?voided=1; priority filters");

  // the CSV rows
  ok(REGISTER_COLUMNS.join("|") === "Finding ID|Building and space|Category|Description|Photos|Rating at visit|Audit reference|Inspector rating|Recommended action|Priority|Budget tier|Owner|Quote reference|Repair|Verified|Next due|Status", "register csv: the brief's columns, in order");
  const full = t9Finding({
    description: "=HYPERLINK(\"x\")", spaceLabel: "Stage", location: "LS 14", photoIds: ["p1", "p2"], auditRef: { item: "A-12", estimate: 4500 },
    specialist: { rating: "good", standard: "ANSI E1.47" }, recommendedAction: "Replace", priority: "high", budgetTier: "lt10k",
    owner: { kind: "contractor", name: "J. Rigger" }, quoteRefs: ["Q-1", "Q-2"], repair: { date: Date.UTC(2026, 9, 1, 18), by: "Peak", work: "New line" },
    verified: { by: "Jeff", at: Date.UTC(2026, 9, 2, 18) }, nextDue: Date.UTC(2027, 9, 2, 18), status: "verified",
  });
  const cells = registerCells(full, { siteName: "Assess Hall", quoteLabels: { "Q-1": "RIG-1001" } });
  ok(cells.length === REGISTER_COLUMNS.length && cells.join("|") === "TSTA-HAL-RIG-001|Assess Hall · Stage · LS 14|RIG|=HYPERLINK(\"x\")|2|Needs attention|A-12 ($4,500)|Good — ANSI E1.47|Replace|High|Under $10,000|J. Rigger (Contractor)|RIG-1001, Q-2|2026-10-01 — Peak — New line|Jeff — 2026-10-02|2027-10-02|Verified", "register csv: one row's cells in column order (labels, dates as Chicago days, quote labels)");
  const csv = toCsv([...REGISTER_COLUMNS], [cells]);
  ok(csv.split("\r\n")[1].startsWith("TSTA-HAL-RIG-001,Assess Hall · Stage · LS 14,RIG,\"'=HYPERLINK(\"\"x\"\")\",2,"), "register csv: a formula-looking description is guarded and quoted; the photo count stays a number");
  ok(registerCells(t9Finding({ voided: { by: "u", at: 1, reason: "x" } }), { siteName: "H" }).at(-1) === "Voided (Open)" && registerCsvName(Date.UTC(2026, 9, 13, 18)) === "findings-2026-10-13.csv", "register csv: a voided row says so; the file is findings-<date>.csv");

  // source pins: the repair builder's findings intake leaves every other path alone
  const ra = readFileSync(join(ROOT, "src/app/(app)/repairs/quote/actions.ts"), "utf8");
  ok(ra.includes("await createQuote({ ...payload, owner: user.name, ...(findingKeys.length ? { findingKeys } : {}) })") && ra.includes("await findingKeysForSave(formData.get(\"findingKeys\"), customerId, !!editingId, venues.map((v) => v.id))") && ra.includes("await linkOnCreateSafe(findingKeys, q?.id, user, !!editingId)") && !/\bawait linkOnCreate\(/.test(ra), "repair builder: persist carries findingKeys on create only and links them once created");
  const rc = readFileSync(join(ROOT, "src/app/(app)/repairs/quote/controls.tsx"), "utf8");
  ok(rc.includes('if (initial.findingKeys?.length) fd.set("findingKeys", initial.findingKeys.join(","));') && rc.includes("Quoting {initial.findingKeys.length} assessment finding"), "repair builder: the findingKeys field is posted only for a findings intake, with its banner");
  const rp = readFileSync(join(ROOT, "src/app/(app)/repairs/quote/page.tsx"), "utf8");
  ok(rp.includes('const findingsParam = !editId && !inspId && preCustomer ? one(sp.findings) : "";') && rp.includes("repairPrefillFromFindings(findingsIntake.list, findingsIntake.venueName)"), "repair builder: ?findings= is read only for a new quote for that customer");
  const fc = readFileSync(join(ROOT, "src/app/(app)/assessments/findings/controls.tsx"), "utf8");
  ok(fc.includes("const selectable = shown.filter((r) => !r.finding.voided);") && fc.indexOf("const shown = ") < fc.indexOf("const selectable = ") && fc.includes("document.getElementById(`frc-${focus}`)"), "register: select-all follows the shown rows; the focus scroll finds the phone card too");
  const fsrc = readFileSync(join(ROOT, "src/app/(app)/assessments/findings/actions.ts"), "utf8");
  ok(fsrc.includes("if (!q.customerId)") && fsrc.includes('q.status === "lost"') && fsrc.includes("!quoteCoversVenue(q, docLocId(site))") && fsrc.includes("refresh(r.assessmentIds ?? [])") && fsrc.includes('"&err=" + encodeURIComponent(r.linkNotice)'), "register actions: Link existing refuses no-customer, lost and other-venue quotes; Estimator quote revalidates assessment pages and surfaces a link failure");
  ok(/from "\.\.\/\[id\]\/finding-sheet"/.test(fc) && !/^import (?!type )[^;]*from "@\/(lib\/stores|db)\//m.test(fc) && !/register-server/.test(fc), "register: reuses the editor's finding sheet and imports no store");
  const smoke = readFileSync(join(ROOT, "scripts/smoke-routes.ts"), "utf8");
  ok(smoke.includes('"/assessments/findings"'), "register: /assessments/findings is a smoke route");
}

/** Task 9 — Quote these findings against the real stores: the Estimator quote links its findings, mixed venues are
 *  refused, the repair kind only hands over the builder's intake, and the builder's link-on-create helper. */
async function task9DbChecks(ok: Ok) {
  const db = await getDb();
  const assessments: string[] = [];
  const quoteIds: string[] = [];
  const k9 = (n: number) => `fd_t9${String(n).padStart(14, "0")}`;
  const U = { id: "u1", name: "Test Estimator" };
  try {
    await assessIdentityFixtures();
    const { co1, co2, site1, site2, site3 } = ASSESS_FIX;
    const mkA = async (customerId: string, siteId: string) => {
      const a = await createAssessment({ visitType: "condition", customerId, siteId, visitDate: Date.UTC(2026, 9, 13), assessorId: "u1" }, "u1");
      assessments.push(a.id);
      registerFixture("assessments", a.id);
      return a;
    };
    const a1 = await mkA(co1, site1);
    const a2 = await mkA(co1, site2);
    const a3 = await mkA(co2, site3);
    const mk = (n: number, a: Assessment, o: Partial<Finding> = {}) => saveFinding({ key: k9(n), customerId: a.customerId, siteId: a.siteId, assessmentId: a.id, category: "RIG", rating: "needs", description: `T9 finding ${n}`, ...o }, U);
    const [f1, f2, f3, f4, f5] = [
      await mk(1, a1, { recommendedAction: "Replace the line" }),
      await mk(2, a1, { category: "ELC" }),
      await mk(3, a2),
      await mk(4, a3),
      await mk(5, a1),
    ];
    ok(f1.ok && f2.ok && f3.ok && f4.ok && f5.ok, "quote db: fixtures — findings on two venues of one customer and one of another");
    if (!f1.ok || !f2.ok || !f3.ok || !f4.ok || !f5.ok) return;

    // mixed venues refused, nothing created or linked
    const mixed = await quoteFromFindings([k9(1), k9(3)], "estimator", U);
    ok(!mixed.ok && mixed.error === "Pick findings from one venue" && (await getFinding(k9(1)))!.quoteRefs.length === 0, "quote db: findings from two venues are refused (\"Pick findings from one venue\") and nothing is linked");
    const mixedCo = await quoteFromFindings([k9(1), k9(4)], "repair", U);
    ok(!mixedCo.ok && mixedCo.error === "Pick findings from one venue", "quote db: findings from two customers are refused too");
    ok(!(await quoteFromFindings([k9(1), "fd_t9nothere0000000"], "estimator", U)).ok, "quote db: a key that names no finding refuses the selection");

    // repair: only the builder's intake — no quote created. Printed-id order: f2 is ELC, which sorts before RIG.
    const ordered = [f1.doc, f2.doc].sort((a, b) => a.printedId!.localeCompare(b.printedId!, undefined, { numeric: true }));
    ok(ordered[0].key === k9(2), "quote db: precondition — the ELC finding's printed id sorts first");
    const rep = await quoteFromFindings([k9(1), k9(2)], "repair", U);
    ok(rep.ok && !rep.quote && rep.href === `/repairs/quote?customer=${encodeURIComponent(co1)}&findings=${encodeURIComponent(`${k9(2)},${k9(1)}`)}` && (await getFinding(k9(1)))!.status === "open", "quote db: Repair quote hands over /repairs/quote?customer=&findings= (printed-id order) and creates nothing");

    // estimator: a draft quote, linked
    const est = await quoteFromFindings([k9(2), k9(1)], "estimator", U);
    ok(est.ok && !!est.quote && est.href === `/estimator?id=${encodeURIComponent(est.quote.id)}`, "quote db: Estimator quote creates a quote and redirects to it");
    if (est.ok && est.quote) {
      quoteIds.push(est.quote.id);
      const q = (await getQuote(est.quote.id))!;
      const items = ((q.spec as { sections: SpecSection[] }).sections[0]?.items ?? []).filter((it) => !it.bonus);
      ok(q.status === "draft" && q.source === "estimator" && q.customerId === co1 && q.findingKeys?.join() === `${k9(2)},${k9(1)}` && q.owner === U.name, "quote db: a draft Estimator quote for that customer, carrying the finding keys");
      ok(items.length === 2 && items[0].desc.startsWith(`${f2.doc.printedId} — `) && items[1].desc.startsWith(`${f1.doc.printedId} — `) && items.every((it) => it.price === 0 && it.qty === 1), "quote db: one zero-priced line per finding, starting with its printed id");
      const g1 = (await getFinding(k9(1)))!, g2 = (await getFinding(k9(2)))!;
      ok(g1.status === "quoted" && g2.status === "quoted" && g1.quoteRefs.includes(q.id) && g2.quoteRefs.includes(q.id) && g1.history.at(-1)?.status === "quoted", "quote db: the findings get the quote in quoteRefs and move to quoted (with history)");
    }

    // the repair builder's save: keys kept only for live findings of the quote's customer AND the quote's venue, only on create
    await voidFinding(k9(5), "Entered in error", U);
    const loc2 = docLocId((await getSite(site2))!), loc1 = docLocId((await getSite(site1))!);
    const raw = [k9(3), k9(4), k9(5), "fd_t9nothere0000000", "junk", k9(3)].join(",");
    const sv = await findingKeysForSave(raw, co1, false, [loc2]);
    ok(sv.keys.join() === k9(3) && sv.notice === null, "repair save: only live findings of the quote's own customer are kept (other customer, voided, missing, junk dropped)");
    const noField = [await findingKeysForSave(raw, co1, true, [loc2]), await findingKeysForSave(null, co1, false, [loc2]), await findingKeysForSave("", co1, false, [loc2])];
    ok(noField.every((r) => r.keys.length === 0 && r.notice === null), "repair save: an edit, or no field, carries no keys and no notice");
    const otherVenue = await findingKeysForSave(k9(3), co1, false, [loc1]);
    ok(otherVenue.keys.length === 0 && otherVenue.notice === OTHER_VENUE_NOTICE, "repair save: findings of another venue of the same customer are not linked (non-blocking notice)");
    const mixedVenue = await findingKeysForSave([k9(1), k9(3)].join(","), co1, false, [loc1, loc2]);
    ok(mixedVenue.keys.length === 0 && mixedVenue.notice === OTHER_VENUE_NOTICE, "repair save: a mixed-venue list is not linked even when both venues are posted");
    const noVenue = await findingKeysForSave(k9(3), co1, false, []);
    ok(noVenue.keys.length === 0 && noVenue.notice === OTHER_VENUE_NOTICE, "repair save: no posted venue links nothing");
    const keys = (await findingKeysForSave(k9(3), co1, false, [loc1, loc2])).keys;
    ok(keys.join() === k9(3), "repair save: the matching venue (among several posted) links");
    const rq = await createQuote({ name: "T9 repair", customer: "Assess Co One", customerId: co1, quoteType: "repair", source: "repair", owner: U.name, ...(keys.length ? { findingKeys: keys } : {}) });
    quoteIds.push(rq.id);
    await linkOnCreate(keys, rq.id, U, true);
    ok((await getFinding(k9(3)))!.quoteRefs.length === 0, "repair save: an edit never links");
    await linkOnCreate(keys, rq.id, U, false);
    const g3 = (await getFinding(k9(3)))!;
    ok(rq.findingKeys?.join() === k9(3) && g3.status === "quoted" && g3.quoteRefs.join() === rq.id, "repair save: a created repair quote carries its finding keys and links them (quoted)");
    await linkOnCreate(keys, rq.id, U, false);
    ok((await getFinding(k9(3)))!.history.filter((h) => h.status === "quoted").length === 1, "repair save: linking twice is a no-op");

    // a link failure after the quote exists is a notice, never a throw (repair path)
    const rq2 = await createQuote({ name: "T9 repair 2", customer: "Assess Co One", customerId: co1, quoteType: "repair", source: "repair", owner: U.name });
    quoteIds.push(rq2.id);
    const safe = await linkOnCreateSafe([k9(1)], rq2.id, U, false, { __failLinkForTest: true });
    ok(safe === LINK_FAILED_NOTICE && !(await getFinding(k9(1)))!.quoteRefs.includes(rq2.id), "repair save: a link failure is caught and returned as a notice (nothing thrown, nothing linked)");
    ok((await linkOnCreateSafe([k9(1)], rq2.id, U, false)) === null && (await getFinding(k9(1)))!.quoteRefs.includes(rq2.id), "repair save: the safe wrapper links normally otherwise");

    // estimator path: a link failure still returns the created quote (exactly one created) with a notice
    const countQuotes = async () => (await db.select({ id: DOC_TABLES.quotes.id }).from(DOC_TABLES.quotes).where(like(DOC_TABLES.quotes.id, "Q-%"))).length;
    const before = await countQuotes();
    const failed = await quoteFromFindings([k9(3)], "estimator", U, Date.now(), { __failLinkForTest: true });
    if (failed.ok && failed.quote) quoteIds.push(failed.quote.id);
    const after = await countQuotes();
    ok(failed.ok && !!failed.quote && failed.linkNotice === LINK_FAILED_NOTICE && after === before + 1 && !!(await getQuote(failed.quote.id)), "quote db: a link failure after create still returns the created quote (exactly one) with a notice");
    ok(failed.ok && !!failed.quote && failed.quote.findingKeys?.join() === k9(3) && failed.assessmentIds?.join() === a2.id, "quote db: the failed-link quote still carries its finding keys; assessment ids are returned for revalidation");
    ok(est.ok && est.assessmentIds?.join() === a1.id && !est.linkNotice, "quote db: a clean Estimator quote returns its assessment ids and no notice");

    // store: getMany / getFindings / findingKeys is creation-only
    const many = await getQuotes([rq.id, rq2.id, "Q-nope-0000", rq.id]);
    ok(many.size === 2 && JSON.stringify(many.get(rq.id)) === JSON.stringify(await getQuote(rq.id)), "quotes.getMany: returns the same docs as get and skips missing ids");
    // a SYSTEM (Estimator) quote carries a pipeline: stored without one, get() and getMany() must both normalise it the same way
    const sysQ = await createQuote({ name: "T9 system", customer: "Assess Co One", customerId: co1, source: "estimator", owner: U.name });
    quoteIds.push(sysQ.id);
    await db.execute(sql`update quotes set doc = doc - 'pipelineId' - 'stage' where id = ${sysQ.id}`);
    const rawSys = await db.select({ doc: DOC_TABLES.quotes.doc }).from(DOC_TABLES.quotes).where(eq(DOC_TABLES.quotes.id, sysQ.id));
    const sysMany = await getQuotes([sysQ.id, rq.id]);
    const sysOne = (await getQuote(sysQ.id))!;
    ok(!("pipelineId" in (rawSys[0].doc as object)) && !!sysOne.pipelineId && !!sysOne.stage, "quotes.getMany: precondition — the stored system quote has no pipeline; get() gives it one");
    ok(sysMany.size === 2 && JSON.stringify(sysMany.get(sysQ.id)) === JSON.stringify(sysOne) && JSON.stringify(sysMany.get(rq.id)) === JSON.stringify(await getQuote(rq.id)), "quotes.getMany: a system (Estimator) quote reads exactly as get() does (pipeline normalised), repair quote too");
    const gone = await createQuote({ name: "T9 gone", customerId: co1, quoteType: "repair", source: "repair", owner: U.name });
    quoteIds.push(gone.id);
    await softDeleteDoc("quotes", gone.id);
    ok((await getQuotes([gone.id])).size === 0 && (await getQuote(gone.id)) === null, "quotes.getMany: ignores a soft-deleted quote exactly as get does");
    await updateQuote(rq.id, { findingKeys: ["fd_other"], name: "T9 repair renamed" });
    const rq3 = (await getQuote(rq.id))!;
    ok(rq3.name === "T9 repair renamed" && rq3.findingKeys?.join() === k9(3), "quotes.update: findingKeys is stripped from patches (set at creation only)");
    const fm = await getFindings([k9(1), k9(5), "fd_t9nothere0000000", k9(1)]);
    ok(fm.size === 2 && JSON.stringify(fm.get(k9(1))) === JSON.stringify(await getFinding(k9(1))) && !!fm.get(k9(5))?.voided, "findings.getFindings: same docs as getFinding (voided included), missing skipped");
    const plain = await createQuote({ name: "T9 plain", customerId: co1, quoteType: "repair", source: "repair", owner: U.name });
    quoteIds.push(plain.id);
    ok(!("findingKeys" in plain), "repair save: a quote without findings has no findingKeys");
  } finally {
    await db.delete(DOC_TABLES.findings).where(like(DOC_TABLES.findings.id, "fd_t9%"));
    if (assessments.length) await db.delete(DOC_TABLES.assessments).where(inArray(DOC_TABLES.assessments.id, assessments));
    if (quoteIds.length) await db.delete(DOC_TABLES.quotes).where(inArray(DOC_TABLES.quotes.id, quoteIds));
    await dropAssessIdentityFixtures();
  }
}

/* ---------- Task 10: reports, print tokens, PDFs, Email report (pure) ---------- */

const t10Finding = (o: Partial<Finding> = {}): Finding => ({ ...t9Finding(), assessmentId: "AS-1010", ...o });

async function task10Checks(ok: Ok) {
  // print tokens: the two new kinds sign and verify; a token never crosses kinds or ids
  const S = "t10-secret", t0 = 1_700_000_000_000;
  const at = signPrintToken(S, "assessment", "AS-1010", t0);
  ok(verifyPrintToken(S, at, "assessment", "AS-1010", t0 + 1000), "print token: an \"assessment\" token verifies for its id");
  ok(!verifyPrintToken(S, at, "assessment-findings", "AS-1010", t0) && !verifyPrintToken(S, at, "cover", "AS-1010", t0) && !verifyPrintToken(S, at, "assessment", "AS-1011", t0), "print token: an \"assessment\" token fails for another kind or another id");
  const ft = signPrintToken(S, "assessment-findings", "site:st-c1-1", t0);
  ok(verifyPrintToken(S, ft, "assessment-findings", "site:st-c1-1", t0) && !verifyPrintToken(S, ft, "assessment-findings", "company:st-c1-1", t0) && !verifyPrintToken(S, ft, "assessment", "site:st-c1-1", t0), "print token: an \"assessment-findings\" token is bound to its scope and kind");
  ok(!verifyPrintToken(S, at, "assessment", "AS-1010", t0 + 121_000), "print token: an assessment token expires after 120 s");

  // sections and the standing line
  ok(REPORT_SECTIONS.map((x) => x.id).join() === "intake,scope,summary,scopes,register,followup,photos", "report: seven sections in the spec's order");
  ok(STANDING_LINE === "Structure and building electrical are flagged for an engineer or electrician and are not rated (ANSI E1.47 excludes them).", "report: section 2's standing line is verbatim");
  ok(REPORT_WAIT_FOR === "[data-assessment-report]:not([data-report-ready])", "report: the render waits until the report root is marked ready (waitFor waits for no match)");

  // answers as text
  const def = ASSESSMENT_DEF;
  const qs = allQuestions(def);
  const q = (k: string) => qs.get(k)!.q;
  const A = (v: unknown, at = 1): Answer => ({ v, state: "answered", at, by: "u1" });
  const extras = { use: [{ value: "weddings", label: "Weddings" }, { value: "old", label: "Old use", retired: true }] };
  ok(reportAnswerText(q("core.seats"), { state: "na", at: 1, by: "u" }, def, {}) === "N/A", "report answer: n/a prints \"N/A\"");
  ok(reportAnswerText(q("core.seats"), { state: "unable", reason: "Locked", at: 1, by: "u" }, def, {}) === "Unable to inspect — Locked", "report answer: unable prints \"Unable to inspect — <reason>\"");
  ok(reportAnswerText(q("core.seats"), A(null), def, {}) === null && reportAnswerText(q("core.seats"), undefined, def, {}) === null && reportAnswerText(q("core.owner_concerns"), A("  "), def, {}) === null, "report answer: cleared (v null), missing and blank answers print nothing");
  ok(reportAnswerText(q("core.contact_primary"), A({ name: "Pat Lee", title: "Director", phone: "555-0100", email: "pat@x.org" }), def, {}) === "Pat Lee, Director · 555-0100 · pat@x.org", "report answer: a contact prints \"Name, Title · phone · email\"");
  ok(contactText({ name: "Sam", email: "s@x.org" }) === "Sam · s@x.org" && contactText({ name: "Sam", title: "Custodian" }) === "Sam, Custodian", "report answer: missing contact parts are dropped");
  ok(reportAnswerText(q("core.use"), A(["school", "weddings", "old"]), def, extras) === "School, Weddings, Old use" && reportAnswerText(q("core.space_type"), A("black_box"), def, {}) === "Black box", "report answer: pick values print their labels, admin extras (retired ones too) included");
  const tbl = reportTable(q("core.docs_detail"), [{ doc: "drawings", format: "hard_copy", status: "received" }, { doc: "manuals" }], def, {});
  ok(tbl.columns.join("|") === "Document|Format|Status" && tbl.rows[0].join("|") === "Drawings|Hard copy|Received" && tbl.rows[1].join("|") === "Manuals||", "report answer: a table prints its column labels and labelled cells (blank cells stay blank)");

  // the whole report
  const ruleP = def.rules.find((r) => r.prompt)!;
  const flagQ = [...qs.values()].find((x) => x.q.flag)!.q;
  const fk = (n: number) => "fd_t10pure00000" + String(n).padStart(3, "0");
  const findings: Finding[] = [
    t10Finding({ key: fk(1), printedId: "TSTA-HAL-RIG-002", rating: "immediate", priority: "low", recommendedAction: "Take it out of service", photoIds: ["p_t10aaaaaaaa"], immediate: { hazardContactNotified: true, notifiedAt: t0, lockout: "tagged" } }),
    t10Finding({ key: fk(2), printedId: "TSTA-HAL-ELC-001", category: "ELC", rating: "needs", priority: "high" }),
    t10Finding({ key: fk(3), printedId: "TSTA-HAL-RIG-003", rating: "needs", priority: "low", photoIds: ["p_t10bbbbbbbb"] }),
    t10Finding({ key: fk(4), printedId: "TSTA-HAL-GEN-001", category: "GEN", rating: "good" }),
    t10Finding({ key: fk(5), printedId: "TSTA-HAL-RIG-004", rating: "immediate", voided: { by: "u", at: 2, reason: "Duplicate" } }),
    t10Finding({ key: fk(6), printedId: "TSTA-HAL-RIG-005", ruleId: ruleP.id, rating: "needs", voided: { by: "u", at: 2, reason: "Merged into TSTA-HAL-RIG-003", mergedInto: fk(3) } }),
    t10Finding({ key: fk(7), printedId: "TSTA-HAL-GEN-002", category: "GEN", ruleId: "X5", questionKeys: [flagQ.key], rating: "good", priority: "medium" }),
  ];
  const reg = reportRegisterFindings(findings).map((f) => f.key);
  ok(reg.join() === [fk(1), fk(2), fk(3), fk(7), fk(4)].join(), "report register: Immediate → Needs → Good, then priority; voided and merged-away findings left out");
  const byKey = new Map(findings.map((f) => [f.key, f]));
  ok(liveKeeper(findings[5], byKey)?.key === fk(3) && liveKeeper(findings[4], byKey) === null && liveKeeper(findings[0], byKey)?.key === fk(1), "report: a merged finding resolves to its live keeper; a plain void resolves to nothing");
  const cyc = [t10Finding({ key: fk(8), voided: { by: "u", at: 1, reason: "m", mergedInto: fk(9) } }), t10Finding({ key: fk(9), voided: { by: "u", at: 1, reason: "m", mergedInto: fk(8) } })];
  ok(liveKeeper(cyc[0], new Map(cyc.map((f) => [f.key, f]))) === null, "report: a merge cycle resolves to nothing");
  ok(liveMergeTarget(byKey, findings[5])?.key === fk(3) && liveMergeTarget(byKey, findings[4]) === null && liveMergeTarget(byKey, findings[0])?.key === fk(1), "merge walker: one walker — report liveKeeper and resolvedPromptIds agree on keeper / plain void / live");
  ok(resolvedFromFindings([{ key: fk(1), ruleId: "RA", questionKeys: [], voided: { mergedInto: fk(1) } }, { key: fk(2), ruleId: "RB", questionKeys: [], voided: { mergedInto: fk(3) } }, { key: fk(3), ruleId: "RC", questionKeys: [] }]).join() === "rule:RB,rule:RC", "merge walker: resolvedPromptIds drops a self-merge cycle and counts a merge into a live keeper");
  const { zipStream } = await import("../src/lib/zip");
  const six = Buffer.alloc(6 * 1024 * 1024, 7);
  const six2 = Buffer.from(await new Response(zipStream(six)).arrayBuffer());
  ok(six2.length === six.length && six2.equals(six), "report PDF routes: a 6 MB buffer streams back byte-identically (shared chunker)");
  const routeSrc = ["src/app/api/assessments/[id]/report-pdf/route.ts", "src/app/api/assessments/findings-pdf/route.ts"].map((f) => readFileSync(join(ROOT, f), "utf8"));
  ok(routeSrc.every((s) => s.includes("zipStream(r.pdf)") && !s.includes("new Uint8Array(r.pdf)")), "report PDF routes: both stream the PDF instead of buffering it");
  const actSrc = readFileSync(join(ROOT, "src/app/(app)/assessments/[id]/report/actions.ts"), "utf8");
  ok(!/link:\s*\{/.test(actSrc), "email report: the draft carries no invented link type (the customer rides customerId)");

  const gaps = ["Question: Seat count", `Prompt: ${ruleP.prompt!.text}`, `Prompt: ${flagQ.flag!.text}`, "Prompt: Nothing like this exists"];
  const fg = followUpGaps(gaps, def, findings);
  ok(fg[0].text === gaps[0] && !fg[0].addressedBy && fg[3].addressedBy === undefined, "follow-up gaps: a question gap and an unmatched prompt stay open");
  ok(fg[1].addressedBy === "TSTA-HAL-RIG-003", "follow-up gaps: a prompt resolved by a late finding that was later merged reads \"since addressed by\" the keeper's id");
  ok(fg[2].addressedBy === "TSTA-HAL-GEN-002", "follow-up gaps: a flagged-answer prompt resolved by a late X5 finding reads \"since addressed by\" its id");
  const keeperVoided = findings.map((f) => (f.key === fk(3) ? { ...f, voided: { by: "u", at: 3, reason: "Wrong" } } : f));
  ok(!followUpGaps(gaps, def, keeperVoided)[1].addressedBy, "follow-up gaps: a merge whose keeper was later voided leaves the gap open");

  const answers: Answers = {
    "core.contact_primary": A({ name: "Pat Lee", title: "Director", phone: "555-0100", email: "pat@x.org" }),
    "core.contact_hazard": A({ name: "Sam Ortiz", phone: "555-0199" }),
    "core.owner_concerns": { state: "unable", reason: "Owner not present", at: 1, by: "u" },
    "core.use": A(["school", "weddings"]),
    "core.incidents": A(null),
    "core.space_type": A("proscenium"),
    "core.has_stage": A("yes"),
    "core.seats": { state: "na", at: 1, by: "u" },
    "core.docs_available": A(["drawings", "manuals", "lighting_plot"]),
    "core.docs_detail": A([{ doc: "drawings", format: "hard_copy", status: "received" }, { doc: "manuals", format: "electronic", status: "to_follow" }]),
    "core.not_accessible": A("Grid — no key on site"),
  };
  ok(documentsToRequest(answers, def, {}).join("|") === "Manuals (electronic, to follow)|Lighting plot", "follow-up documents: listed-but-not-received documents, with format and status");
  ok(documentsToRequest({ "core.docs_available": A(["none"]) }, def, {}).length === 0, "follow-up documents: \"None\" requests nothing");
  const m = buildAssessmentReport({
    assessment: {
      id: "AS-1010", defVersion: 1, visitType: "condition", scopes: VISIT_TYPES[0].scopes, answers,
      photos: [
        { id: "p_t10aaaaaaaa", takenAt: 1, by: "u", questionKey: "core.contact_hazard" },
        { id: "p_t10bbbbbbbb", takenAt: 2, by: "u", findingKey: fk(6) },
        { id: "p_t10cccccccc", takenAt: 3, by: "u", pending: true },
        { id: "p_t10dddddddd", takenAt: 4, by: "u", questionKey: "core.has_stage" },
      ],
      dismissedPrompts: [], overriddenGaps: gaps, visitDate: Date.UTC(2026, 9, 1), spaceLabel: "Main stage", accompanying: "Chris",
    },
    def, extras, profile: {}, findings, names: { customer: "Test District", venue: "Hall HS", address: "1 Main St, Town, WI 54220", assessor: "Jeff" }, now: t0,
  });
  const intake = Object.fromEntries(m.intake.map((r) => [r.label, r.value]));
  ok(intake["Facility"] === "Test District" && intake["Building and space"] === "Hall HS · Main stage" && intake["Visit date"] === "Oct 1, 2026" && intake["Accompanied by"] === "Chris", "report intake: facility, building and space, date, accompanying");
  ok(intake["Primary contact"] === "Pat Lee, Director · 555-0100 · pat@x.org" && intake["Hazard contact"] === "Sam Ortiz · 555-0199" && intake["Owner concerns"] === "Unable to inspect — Owner not present" && intake["Seats"] === "N/A" && intake["Use"] === "School, Weddings", "report intake: contacts, concerns, use and seats as printed text");
  ok(m.standingLine === STANDING_LINE && m.notAccessible === "Grid — no key on site" && m.scopesRun[0].title === "Core" && m.scopesRun.some((s) => s.title === "Rigging" && s.depth === "Screening") && !m.scopesRun.some((s) => s.title === "Project and quote"), "report scope: the scopes run (with depth), the standing line, areas not accessible");
  const ratingRow = (r: string) => m.summary.rows.find((x) => x.rating === r)!;
  ok(ratingRow("immediate").total === 1 && ratingRow("needs").counts.join() === "1,1,0,0,0" && ratingRow("good").counts.join() === "0,0,0,0,2" && m.summary.total === 5, "report summary: counts by rating × category over live findings only");
  ok(m.summary.immediate.length === 1 && m.summary.immediate[0].label === "TSTA-HAL-RIG-002" && m.summary.immediate[0].immediate?.lockout === "Tagged" && m.summary.immediate[0].immediate.notified.startsWith("Yes"), "report summary: Immediate items in full (hazard contact, lockout)");
  const core = m.scopes.find((s) => s.code === "S0")!;
  const coreKeys = core.modules.flatMap((x) => x.rows.map((r) => r.key));
  ok(coreKeys.join() === "core.contact_primary,core.contact_hazard,core.owner_concerns,core.use,core.space_type,core.seats,core.docs_available,core.docs_detail,core.not_accessible", `report scopes: visible answers in definition order; cleared and hidden answers left out (${coreKeys.join()})`);
  const docsRow = core.modules.flatMap((x) => x.rows).find((r) => r.key === "core.docs_detail")!;
  ok(docsRow.kind === "table" && docsRow.table!.rows.length === 2, "report scopes: a table answer prints as a table");
  const coreRows = core.modules.flatMap((x) => x.rows);
  ok(coreRows.find((r) => r.key === "core.contact_hazard")!.photoIds.join() === "p_t10aaaaaaaa" && !coreRows.some((r) => r.photoIds.includes("p_t10dddddddd")), "report scopes: a photo taken on a question prints inline on its row; a hidden question's photo doesn't");
  ok(m.scopes.map((s) => s.code).join() === "S0,S1,S2,S3,S4,S5,S6,S7", "report scopes: one section per scope that was run, in definition order");
  ok(m.register.map((f) => f.key).join() === reg.join(), "report register: the same rows as reportRegisterFindings");
  ok(m.followUp.unable.length === 1 && m.followUp.unable[0].label === q("core.owner_concerns").label && m.followUp.unable[0].reason === "Owner not present", "report follow-up: unable answers with their reason");
  ok(m.followUp.gaps[1].addressedBy === "TSTA-HAL-RIG-003" && m.followUp.documents.length === 2, "report follow-up: overridden gaps (with late resolutions) and documents to request");
  ok(m.photos.length === 4 && m.photos[0].caption === `TSTA-HAL-RIG-002 · ${q("core.contact_hazard").label}` && m.photos[1].caption === "TSTA-HAL-RIG-003" && m.photos[2].pending, `report photos: captioned with finding ids (merged ones through the keeper) and the question (${m.photos.map((p) => p.caption).join(" | ")})`);

  // findings-only report
  const open = openFindings([...findings, t10Finding({ key: fk(10), status: "closed" })]);
  ok(open.map((f) => f.key).join() === reg.join(), "findings report: open findings only (closed and voided left out), register sort");
  const fr = buildFindingsReport({ findings, subject: "Hall HS", siteNames: { s1: "Hall HS" }, now: t0 });
  ok(fr.rows.length === 5 && fr.rows[0].where === "Hall HS" && fr.rows[0].assessmentId === "AS-1010" && fr.counts.map((c) => c.n).join() === "1,2,2", "findings report: rows carry the venue and the assessment; counts by rating");
  ok(JSON.stringify(parseFindingsScope("site:st-c1-1")) === JSON.stringify({ kind: "site", id: "st-c1-1", scope: "site:st-c1-1" }) && parseFindingsScope("company:TESTassess:co1")?.id === "TESTassess:co1" && parseFindingsScope("venue:x") === null && parseFindingsScope("site:") === null && parseFindingsScope("site:a\nb") === null && parseFindingsScope(7) === null, "findings scope: site:<id> / company:<id> only");
  ok(findingsPdfHref("site:st-c1-1") === "/api/assessments/findings-pdf?scope=site%3Ast-c1-1" && findingsPdfHref("company:c1", true).endsWith("&download=1"), "findings scope: the PDF link carries the scope encoded");

  // file names and the email copy
  ok(assessmentPdfName("AS-1001", "Lincoln HS") === "Assessment AS-1001 — Lincoln HS.pdf" && assessmentPdfName("AS-1001", "A/B: \"C\"") === "Assessment AS-1001 — A B C.pdf", "file names: Assessment AS-#### — <venue>.pdf, unsafe characters dropped");
  ok(findingsPdfName("Hall HS", Date.UTC(2026, 9, 13, 18)) === "Findings — Hall HS — 2026-10-13.pdf" && fileNamePart("x".repeat(200)).length === 80, "file names: Findings — <venue or company> — <date>.pdf (Chicago day)");
  const copy = reportEmailCopy({ id: "AS-1010", venue: "Hall HS", customer: "Test District", visitDate: Date.UTC(2026, 9, 1), contactName: "Pat Lee", senderName: "Jeff" });
  ok(copy.subject === "Venue assessment report — Hall HS (AS-1010)" && copy.body.startsWith("Hello Pat,") && copy.body.includes("from our visit on Oct 1, 2026") && copy.body.endsWith("Jeff"), "email report: subject names the venue and id; body greets the contact and names the visit date");
  ok(EMAIL_PDF_MAX_BYTES === 10 * 1024 * 1024 && EMAIL_TOO_LARGE === "Report is too large to email — download it instead", "email report: 10 MB cap and the refusal wording");

  // photo inlining: bounded concurrency, pending / failed skipped, total cap
  let inFlight = 0, maxInFlight = 0;
  const reads: string[] = [];
  const read = async (id: string) => {
    reads.push(id);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 2));
    inFlight--;
    if (id === "p_bad") throw new Error("blob down");
    if (id === "p_none") return null;
    return { bytes: new Uint8Array(id === "p_big" ? 60 : 10), contentType: "image/jpeg" };
  };
  const photos10: { id: string; pending?: true }[] = [...Array.from({ length: 9 }, (_, i) => ({ id: `p_ok${i}` })), { id: "p_pending", pending: true }, { id: "p_bad" }, { id: "p_none" }];
  const res = await inlinePhotoSources(photos10, read);
  ok(maxInFlight <= 4 && maxInFlight >= 2, `photo inlining: at most 4 reads at a time (saw ${maxInFlight})`);
  ok(!reads.includes("p_pending") && res.sources.p_pending === null, "photo inlining: a pending photo is never read and prints as unavailable");
  ok(res.sources.p_bad === null && res.sources.p_none === null && !!res.sources.p_ok0?.startsWith("data:image/jpeg;base64,") && !res.overCap && res.inlinedBytes === 90, "photo inlining: a failed or empty read is skipped; the rest are data URIs");
  const capped = await inlinePhotoSources([{ id: "p_a" }, { id: "p_big" }, { id: "p_c" }], read, { maxBytes: 50 });
  ok(capped.overCap && capped.sources.p_a !== null && capped.sources.p_big === null && capped.sources.p_c === null && capped.inlinedBytes === 10, "photo inlining: past the byte budget that photo and every later one are left out (overCap)");
  ok(INLINE_TOTAL_BYTES === 20 * 1024 * 1024 && PHOTO_UNAVAILABLE === "Photo unavailable", "photo inlining: 20 MB total; placeholder wording");
}

/* ---------- Task 11: nav, search, cards, pick-list admin, carry-overs ---------- */

function task11Checks(ok: Ok) {
  // nav: the Customers group gets Assessments right after Venue Assessments; /assessments* lights it
  const crm = NAV.find((e) => e.kind === "group" && e.key === "crm");
  const keys = crm && crm.kind === "group" ? crm.children.map((c) => c.key) : [];
  const at = keys.indexOf("field");
  ok(at >= 0 && keys[at + 1] === "assessments", "nav: Assessments sits directly after Venue Assessments in the Customers group");
  const item = crm && crm.kind === "group" ? crm.children.find((c) => c.key === "assessments") : undefined;
  ok(item?.label === "Assessments" && item?.href === "/assessments", "nav: the item is { key assessments, label Assessments, href /assessments }");
  ok(NAV.filter((e) => e.kind === "group").every((g) => g.kind !== "group" || g.key !== "field"), "nav: there is no Field group");
  ok(["/assessments", "/assessments/AS-1001", "/assessments/findings", "/assessments/new", "/assessments/pick-lists"].every((p) => activeKeyFor(p) === "assessments") && activeKeyFor("/venue-assessments") === "field", "nav: every /assessments* route lights Assessments; /venue-assessments still lights Venue Assessments");
  ok(parentGroupOf("assessments") === "crm", "nav: the Assessments child lights the Customers group");

  // badge: open (not closed, not voided) findings rated immediate
  const fx = (o: Partial<Finding>) => ({ rating: "immediate" as const, status: "open" as const, ...o });
  ok(immediateOpenCount([fx({}), fx({ status: "triaged" }), fx({ status: "closed" }), fx({ voided: { by: "u", at: 1, reason: "x" } }), fx({ rating: "needs" }), fx({ rating: "good" })]) === 2, "badge: counts immediate findings that are neither closed nor voided");
  ok(immediateOpenCount([]) === 0 && isOpenFinding({ status: "scheduled" }) && !isOpenFinding({ status: "closed" }), "badge: empty is 0; open means not closed");

  // ⌘K mapping
  const names = { customer: "Mercy Prep", venue: "Lincoln Auditorium" };
  const r = assessmentSearchResult({ id: "AS-1001", status: "onsite" }, names);
  ok(r.title === "AS-1001 · Mercy Prep" && r.sub === "Lincoln Auditorium · On site" && r.href === "/assessments/AS-1001" && r.letter === "A" && r.color === "#7a4f1f" && r.id === "AS-1001", "search: an assessment reads \"AS-1001 · customer\" / \"venue · status\" and opens its editor");
  ok(assessmentSearchResult({ id: "AS-1002", status: "draft", spaceLabel: "Stage" }, names).sub === "Lincoln Auditorium — Stage · Draft", "search: a space label follows the venue");
  ok(matchesAssessment("as-1001", { id: "AS-1001" }, names) && matchesAssessment("mercy", { id: "AS-1" }, names) && matchesAssessment("lincoln", { id: "AS-1" }, names) && matchesAssessment("on site", { id: "AS-1", status: "onsite" }, names) && !matchesAssessment("zzz", { id: "AS-1", status: "draft" }, names), "search: an assessment matches its id, customer, venue, status and space");
  const fnd = { key: "fd_0123456789abcdef", printedId: "MPSD-LIN-RIG-003", companyCode: "MPSD", siteCode: "LIN", category: "RIG" as const, description: "Fly line 7 is frayed at the termination.", voided: undefined };
  const fr = findingSearchResult(fnd);
  ok(fr.title === "MPSD-LIN-RIG-003" && fr.sub === "Fly line 7 is frayed at the termination." && fr.href === "/assessments/findings?focus=fd_0123456789abcdef" && fr.letter === "F" && fr.color === "#7a4f1f", "search: a finding reads its printed id / description and opens the register on it (?focus=)");
  ok(findingSearchResult({ ...fnd, printedId: null }).title === "MPSD-LIN-RIG-…", "search: an unnumbered finding shows its pending label");
  ok(findingSearchResult({ ...fnd, description: "x".repeat(200) }).sub.length === 80 && findingSearchResult({ ...fnd, description: "x".repeat(200) }).sub.endsWith("…"), "search: a long description is cut to 80 characters");
  ok(findingSearchResult({ ...fnd, voided: { by: "u", at: 1, reason: "dup" } }).sub.startsWith("Voided — ") && findingSearchResult({ ...fnd, voided: { by: "u", at: 1, reason: "dup" }, description: "y".repeat(200) }).sub.length === 80, "search: a voided finding is marked and still ≤ 80 characters");
  ok(matchesFinding("mpsd-lin", fnd) && matchesFinding("frayed", fnd) && !matchesFinding("zzz", fnd), "search: a finding matches its printed id and description (case-insensitive)");

  // cards
  const f2 = (rating: Finding["rating"], status: Finding["status"], voided = false) => ({ rating, status, ...(voided ? { voided: { by: "u", at: 1, reason: "x" } } : {}) });
  const oc = openRatingCounts([f2("immediate", "open"), f2("immediate", "closed"), f2("needs", "quoted"), f2("needs", "open", true), f2("good", "open")]);
  ok(oc.total === 3 && oc.counts.map((c) => `${c.rating}:${c.n}`).join() === "immediate:1,needs:1,good:1" && oc.counts[0].label === "Immediate attention" && oc.counts[1].label === "Needs attention" && oc.counts[2].label === "Good", "cards: open counts by rating skip closed and voided, in the register's order, with the brief's labels");
  const rows = assessmentCardRows(
    [
      { id: "AS-1001", visitType: "condition", status: "completed", visitDate: 100, siteId: "s1", customerId: "c1" },
      { id: "AS-1003", visitType: "condition", status: "draft", visitDate: 300, siteId: "s2", customerId: "c1", spaceLabel: "Pit" },
      { id: "AS-1002", visitType: "condition", status: "onsite", visitDate: 300, siteId: "s1", customerId: "c1" },
    ],
    { showVenue: true, siteNames: new Map([["s1", "Hall"], ["s2", "Gym"]]), openCounts: new Map([["AS-1003", 2], ["AS-1002", 1]]) },
  );
  ok(rows.map((x) => x.id).join() === "AS-1003,AS-1002,AS-1001", "cards: assessments list newest visit first (ties: newest id)");
  ok(rows[0].sub === "Gym — Pit · Condition assessment · Draft · 2 open findings" && rows[1].sub === "Hall · Condition assessment · On site · 1 open finding" && rows[2].sub === "Hall · Condition assessment · Completed" && rows[0].href === "/assessments/AS-1003", "cards: a row names the venue (company card), visit type, status and open findings");
  ok(assessmentCardRows([{ id: "AS-1", visitType: "condition", status: "draft", visitDate: 1, siteId: "s1", customerId: "c1", spaceLabel: "Pit" }])[0].sub === "Pit · Condition assessment · Draft", "cards: a venue card leaves the venue out and keeps the space");
  const pq = [...allQuestions(ASSESSMENT_DEF).values()].filter((x) => x.q.profile);
  ok(pq.length >= 2, "cards: precondition — the definition has profile questions");
  const [p1, p2] = pq;
  const facts = { [p1.q.key]: { v: p1.q.type === "yesno" ? "yes" : p1.q.type === "number" ? 7 : "x", at: Date.UTC(2026, 9, 13, 18), from: "AS-1001" }, [p2.q.key]: { v: "", at: 1, from: "AS-1001" }, "not.a.question": { v: "z", at: 1, from: "AS-1" } };
  const pf = profileFactRows(facts, ASSESSMENT_DEF);
  ok(pf.length === 1 && pf[0].key === p1.q.key && pf[0].label === p1.q.label && pf[0].from === "AS-1001", "cards: profile facts list only profile questions with a non-empty value, labelled");
  ok(profileFactRows(undefined, ASSESSMENT_DEF).length === 0 && profileFactRows({}, ASSESSMENT_DEF).length === 0, "cards: no profile → no rows (the card hides)");
  ok(confirmedLine("AS-1001", Date.UTC(2026, 9, 13, 18)) === "confirmed on AS-1001 · Oct 13, 2026" && chicagoDay(0) === "" && confirmedLine("", Date.UTC(2026, 9, 13, 18)) === "confirmed · Oct 13, 2026", "cards: \"confirmed on AS-xxxx · date\"");
  ok(registerHref({ siteId: "st-1" }) === "/assessments/findings?venue=st-1" && registerHref({ customerId: "c 1" }, "immediate") === "/assessments/findings?customer=c+1&rating=immediate&open=1" && registerHref({}) === "/assessments/findings", "cards: count chips link the filtered register");
  ok(startHref({ siteId: "st-1" }) === "/assessments/new?site=st-1" && startHref({ visitId: "SV-1", customerId: "c1", siteId: "st-1" }) === "/assessments/new?visit=SV-1" && startHref({ customerId: "c1" }) === "/assessments/new?company=c1" && startHref({ leadId: "L-1" }) === "/assessments/new?lead=L-1" && startHref({ projectId: "P-1" }) === "/assessments/new?project=P-1", "cards: Start assessment hrefs (visit wins; company / site / lead / project)");
  ok(startHref({ customerId: "c1", leadId: "L-1" }) === "/assessments/new?company=c1&lead=L-1" && startHref({ customerId: "c1", projectId: "P-1" }) === "/assessments/new?company=c1&project=P-1", "fix 5: a lead / project Start link carries the customer too");
  ok(carryLeadId("", { leadId: "L-9" }) === "L-9" && carryLeadId("L-1", { leadId: "L-9" }) === "L-1" && carryLeadId("", { leadId: null }) === "" && carryLeadId("", null) === "", "fix 5: a visit's lead rides onto the new assessment unless ?lead= says otherwise");
  const src = (f: string) => readFileSync(join(ROOT, f), "utf8");
  const leadsSrc = src("src/app/(app)/leads/page.tsx");
  const projSrc = src("src/app/(app)/projects/[id]/page.tsx");
  ok(/<AssessmentsCard leadId=\{leadRec\.id\} customerId=\{/.test(leadsSrc) && /<AssessmentsCard projectId=\{sel\.id\} customerId=\{/.test(projSrc), "fix 5: the lead and project cards are given the customer");
  ok(/leadId = carryLeadId\(leadId, v\)/.test(src("src/app/(app)/assessments/new/page.tsx")), "fix 5: /assessments/new?visit= carries the visit's lead");
  ok(isOpenFinding({ status: "triaged" }) && !/status !== "closed"/.test(src("src/components/assessments/assessment-cards.tsx")) && /isOpenFinding\(f\)/.test(src("src/components/assessments/assessment-cards.tsx")), "fix 4: the cards use the shared open rule");
  // the open-only register filter
  const of = parseRegisterFilters({ open: "1", rating: "immediate" });
  const openList = [t9Finding({ key: "fd_s0000000000000011", printedId: "A-B-RIG-001", rating: "immediate", status: "open" }), t9Finding({ key: "fd_s0000000000000012", printedId: "A-B-RIG-002", rating: "immediate", status: "closed" })];
  ok(of.open && !parseRegisterFilters({}).open && !parseRegisterFilters({ open: "0" }).open, "fix 3: ?open=1 parses; absent or other values are off");
  ok(registerQuery(of) === "rating=immediate&open=1" && JSON.stringify(parseRegisterFilters(new URLSearchParams(registerQuery(of)))) === JSON.stringify(of) && registerQuery({ rating: "immediate" }) === "rating=immediate", "fix 3: open=1 round-trips through the query string and is omitted when off");
  ok(registerList(openList, of).map((f) => f.printedId).join() === "A-B-RIG-001" && registerList(openList, parseRegisterFilters({ rating: "immediate" })).length === 2, "fix 3: Open only hides closed findings; without it they stay");
  ok(/Open only/.test(src("src/app/(app)/assessments/findings/controls.tsx")) && /go\(\{ open: false \}\)/.test(src("src/app/(app)/assessments/findings/controls.tsx")), "fix 3: the filter bar shows a removable Open only chip");

  // pick-list admin
  const extras = { [Object.keys(ASSESSMENT_DEF.pickLists)[0]]: [{ value: "a_b", label: "A b" }, { value: "old", label: "Old", retired: true }] };
  const pl = pickListAdminRows(ASSESSMENT_DEF, extras);
  const ids = Object.keys(ASSESSMENT_DEF.pickLists);
  ok(pl.length === ids.length && pl.map((x) => x.id).join() === [...ids].sort().join(), "pick lists: one row per code list, sorted by id");
  const first = pl.find((x) => x.id === ids[0])!;
  ok(first.builtIn.length === ASSESSMENT_DEF.pickLists[ids[0]].length && first.added.length === 2 && first.added[0].retired === false && first.added[1].retired === true && pl.filter((x) => x.id !== ids[0]).every((x) => x.added.length === 0), "pick lists: built-in values listed, added values carry their retired flag");
  ok(pl.some((x) => x.usedBy.length > 0) && listTitle("arena_bowl") === "Arena bowl" && listTitle("venue-types") === "Venue types", "pick lists: a list names the questions that use it; titles read plainly");

  // go-live wipe: assessments + findings are demo data; the venue profile is authored knowledge
  ok(DEMO_COLLECTIONS.includes("assessments" as never) && DEMO_COLLECTIONS.includes("findings" as never), "go-live: assessments and findings are wiped with the demo data");
  ok(CONFIG_COLLECTIONS.includes("venue_profiles" as never) && !DEMO_COLLECTIONS.includes("venue_profiles" as never), "go-live: venue_profiles is config, kept through the wipe");

  // Task 9 carry-over 3: a repair quote covers every venue it was saved with
  const rq = { locationId: "loc1", repair: { venues: [{ id: "loc1", label: "A" }, { id: "loc2", label: "B" }, { id: null, label: "C" }] } };
  ok(quoteVenueIds(rq).join() === "loc1,loc2" && quoteCoversVenue(rq, "loc2") && quoteCoversVenue(rq, "loc1") && !quoteCoversVenue(rq, "loc3"), "link quote: a repair quote covers its locationId and every repair.venues[].id");
  ok(quoteCoversVenue({ locationId: "loc1" }, "loc1") && !quoteCoversVenue({ locationId: "loc1" }, "loc2") && quoteCoversVenue({}, "loc9") && quoteCoversVenue({ locationId: null, repair: null }, "loc9") && quoteCoversVenue({ repair: { venues: [{ id: "x" }] } }, "x"), "link quote: a quote naming no venue links anywhere; a venue-less repair falls back to its venues");

  // source pins for the wiring that has no pure seam
  const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
  const repairActions = read("src/app/(app)/repairs/quote/actions.ts");
  const approve = repairActions.slice(repairActions.indexOf("export async function approveRepairQuote"));
  ok(/&approved=1" \+\s*\(note\.creditNote \? "&credit=" \+ encodeURIComponent\(note\.creditNote\) : ""\)/.test(approve), "fix 1: approveRepairQuote also appends &credit= from note.creditNote (mirrors saveRepairQuote)");
  ok(/persist\(formData, note\)/.test(approve) && /&approved=1"[\s\S]*\(note\.findingNote \? "&findingnote=" \+ encodeURIComponent\(note\.findingNote\)/.test(approve), "carry-over: approveRepairQuote passes a notice sink to persist and appends &findingnote= to its approved redirect");
  ok(/quoteCoversVenue\(q, docLocId\(site\)\)/.test(read("src/app/(app)/assessments/findings/actions.ts")), "carry-over: Link existing quote checks the quote's venues (repair.venues included)");
  ok(/assessments: immediateFindingCount/.test(read("src/lib/nav-counts.ts")) && /countOpenImmediateFindings\(\)/.test(read("src/lib/nav-counts.ts")) && !/listFindings/.test(read("src/lib/nav-counts.ts")), "nav badge: key assessments = one countOpenImmediateFindings() SQL count, no findings read");
  const search = read("src/lib/search/global-search.ts"); // ⌘K moved here on main (shared with Ask AI)
  ok(/searchDocs\("assessments", q, CANDIDATES\)/.test(search) && /searchDocs\("findings", q, CANDIDATES\)/.test(search) && /"Assessments"/.test(search) && /"Findings"/.test(search), "global search: assessments and findings join the ⌘K Promise.all and add their groups");
  const venuePage = read("src/app/(app)/venues/[id]/page.tsx");
  ok(venuePage.indexOf("<DocumentsCard") < venuePage.indexOf("<VenueProfileCard") && venuePage.indexOf("<VenueProfileCard") < venuePage.indexOf("<AssessmentsCard") && venuePage.indexOf("<AssessmentsCard") < venuePage.indexOf("<FindingsCard"), "venue page: Venue profile, Assessments and Findings follow the Documents card, in that order");
  const companyPage = read("src/app/(app)/companies/[id]/page.tsx");
  ok(companyPage.indexOf("No site surveys yet.") < companyPage.indexOf("<AssessmentsCard") && companyPage.indexOf("<AssessmentsCard") < companyPage.indexOf("<FindingsCard") && /assessments\/new\?visit=/.test(companyPage), "company page: Assessments + Findings follow Site surveys; each site visit row links Start assessment");
  ok(/assessments\/new\?visit=/.test(read("src/app/(app)/venue-assessments/visit-requests.tsx")), "visit queue: a row links Start assessment");
  ok(/AssessmentsCard leadId=/.test(read("src/app/(app)/leads/page.tsx")) && /AssessmentsCard projectId=/.test(read("src/app/(app)/projects/[id]/page.tsx")), "lead drawer and project page list the assessments linked to them");
  ok(/can\("manage_users", user\.roles\)/.test(read("src/app/(app)/assessments/page.tsx")) && /requirePerm\("manage_users"\)/.test(read("src/app/(app)/assessments/pick-lists/page.tsx")), "pick lists: the button and the page are manage_users only");
}

async function task11DbChecks(ok: Ok) {
  const db = await getDb();
  const assessments: string[] = [];
  const kk = (n: number) => `fd_t11${String(n).padStart(13, "0")}`;
  const U = { id: "u1", name: "Test Estimator" };
  try {
    await assessIdentityFixtures();
    const { co1, co2, site1, site2, site3 } = ASSESS_FIX;
    const mkA = async (customerId: string, siteId: string, extra: { leadId?: string; projectId?: string } = {}) => {
      const a = await createAssessment({ visitType: "condition", customerId, siteId, visitDate: Date.UTC(2026, 9, 13), assessorId: "u1", ...extra }, "u1");
      assessments.push(a.id);
      registerFixture("assessments", a.id);
      return a;
    };
    const a1 = await mkA(co1, site1, { leadId: "L-t11a", projectId: "P-t11a" });
    const a2 = await mkA(co1, site2, { leadId: "L-t11b" });
    const a3 = await mkA(co2, site3);
    const imm = { recommendedAction: "Take the line out of service", photoIds: ["ph_t11"], immediate: { hazardContactNotified: false, lockout: "none" as const } };
    const mk = (n: number, a: Assessment, o: Partial<Finding> = {}) => saveFinding({ key: kk(n), customerId: a.customerId, siteId: a.siteId, assessmentId: a.id, category: "RIG", rating: "needs", description: `T11 finding ${n}`, ...o }, U);
    const saved = [
      await mk(1, a1, { rating: "immediate", ...imm }),
      await mk(2, a2, { rating: "immediate", ...imm }),
      await mk(3, a1),
      await mk(4, a3, { rating: "immediate", ...imm }),
      await mk(5, a1, { rating: "immediate", ...imm }),
    ];
    ok(saved.every((x) => x.ok), "t11 db: fixtures — findings on three venues, four rated immediate");
    if (!saved.every((x) => x.ok)) return;
    await voidFinding(kk(5), "Entered in error", U);
    const mine = (list: { key: string }[]) => list.filter((f) => f.key.startsWith("fd_t11")).map((f) => f.key).sort();

    // the SQL-narrowed reads return exactly what the JS filters would
    const all = await listFindings();
    const same = async (f: Parameters<typeof listFindings>[0], pick: (x: Finding) => boolean, label: string) =>
      ok(JSON.stringify(await listFindings(f)) === JSON.stringify(all.filter(pick)), `t11 db: listFindings(${label}) equals the unfiltered read filtered in JS`);
    await same({ rating: ["immediate"] }, (x) => x.rating === "immediate" && !x.voided, "rating immediate");
    await same({ rating: ["immediate", "needs"] }, (x) => (x.rating === "immediate" || x.rating === "needs") && !x.voided, "rating immediate+needs");
    await same({ siteId: site1 }, (x) => x.siteId === site1 && !x.voided, "siteId");
    await same({ customerId: co1 }, (x) => x.customerId === co1 && !x.voided, "customerId");
    await same({ assessmentId: a2.id }, (x) => x.assessmentId === a2.id && !x.voided, "assessmentId");
    await same({ customerId: co1, rating: ["needs"] }, (x) => x.customerId === co1 && x.rating === "needs" && !x.voided, "customerId + rating");
    ok((await listFindings({ siteId: site1, includeVoided: true })).filter((f) => f.key.startsWith("fd_t11")).length === 3 && (await listFindings({ siteId: site1 })).filter((f) => f.key.startsWith("fd_t11")).length === 2, "t11 db: includeVoided brings the voided finding back");

    // the badge: immediate, open, not voided
    const badge = await listFindings({ rating: ["immediate"] });
    ok(mine(badge).join() === [kk(1), kk(2), kk(4)].join() && immediateOpenCount(badge.filter((f) => f.key.startsWith("fd_t11"))) === 3, "t11 db: the badge read has the three live immediate findings (the voided one is out)");

    // the badge count: one SQL count equals the JS rule over the whole register, closed and voided included
    const mk6 = await mk(6, a1, { rating: "immediate", ...imm });
    const mk7 = await mk(7, a2, { rating: "immediate", ...imm });
    ok(mk6.ok && mk7.ok, "t11 db: badge fixtures — an immediate finding to close and one with a JSON-null voided");
    await db.execute(sql`update ${DOC_TABLES.findings} set doc = jsonb_set(doc, '{status}', '"closed"') where id = ${kk(6)}`);
    await db.execute(sql`update ${DOC_TABLES.findings} set doc = jsonb_set(doc, '{voided}', 'null'::jsonb) where id = ${kk(7)}`);
    const sqlCount = await countOpenImmediateFindings();
    const jsCount = immediateOpenCount(await listFindings({ rating: ["immediate"], includeVoided: true }));
    ok(sqlCount === jsCount, `t11 db: countOpenImmediateFindings (${sqlCount}) equals immediateOpenCount over the register (${jsCount})`);
    ok(sqlCount >= 4, "t11 db: the count includes the three live fixtures and the JSON-null voided one; the closed and voided ones are out");
    const before = sqlCount;
    await db.execute(sql`update ${DOC_TABLES.findings} set doc = jsonb_set(doc, '{status}', '"closed"') where id = ${kk(7)}`);
    ok((await countOpenImmediateFindings()) === before - 1, "t11 db: closing a finding drops the count by one");
    await db.delete(DOC_TABLES.findings).where(inArray(DOC_TABLES.findings.id, [kk(6), kk(7)]));

    // listAssessments narrowing
    const allA = await listAssessments();
    const sameA = async (f: Parameters<typeof listAssessments>[0], pick: (x: Assessment) => boolean, label: string) =>
      ok(JSON.stringify(await listAssessments(f)) === JSON.stringify(allA.filter(pick)), `t11 db: listAssessments(${label}) equals the unfiltered read filtered in JS`);
    await sameA({ siteId: site1 }, (x) => x.siteId === site1, "siteId");
    await sameA({ customerId: co1 }, (x) => x.customerId === co1, "customerId");
    await sameA({ leadId: "L-t11a" }, (x) => x.leadId === "L-t11a", "leadId");
    await sameA({ projectId: "P-t11a" }, (x) => x.projectId === "P-t11a", "projectId");
    await sameA({ customerId: co1, status: "draft" }, (x) => x.customerId === co1 && x.status === "draft", "customerId + status");
    ok((await listAssessments({ leadId: "L-t11a" })).map((x) => x.id).join() === a1.id && (await listAssessments({ leadId: "L-t11b" })).map((x) => x.id).join() === a2.id && (await listAssessments({ projectId: "P-t11a" })).map((x) => x.id).join() === a1.id && (await listAssessments({ leadId: "L-none" })).length === 0, "t11 db: an assessment shows under the lead and project it was created with");
    ok((await listAssessments({ customerId: co2 })).map((x) => x.id).join() === a3.id, "t11 db: the company card's read is the customer's assessments");

    // ⌘K: the candidate scan finds an assessment by id and a finding by printed id, and the mapping opens them
    const f1 = (await getFinding(kk(1)))!;
    const hitsF = (await searchDocs("findings", f1.printedId!.toLowerCase(), 100)).map((d) => normalizeFinding(d));
    ok(hitsF.some((f) => f.key === kk(1)) && hitsF.filter((f) => matchesFinding(f1.printedId!.toLowerCase(), f)).length >= 1, "t11 db: ⌘K finds a finding by its printed id");
    const hitA = (await searchDocs("assessments", a2.id.toLowerCase(), 100)).find((d) => d.id === a2.id);
    ok(!!hitA && assessmentSearchResult({ id: a2.id, status: "draft" }, { customer: "Assess Co One", venue: "Assess Gym" }).href === `/assessments/${a2.id}`, "t11 db: ⌘K finds an assessment by its id");
    const hitTitle = findingSearchResult(f1);
    ok(hitTitle.title === f1.printedId && hitTitle.href === `/assessments/findings?focus=${kk(1)}`, "t11 db: the finding result titles the printed id and focuses its key");

    // the venue profile card reads what a completed assessment confirmed
    const pkey = [...allQuestions(ASSESSMENT_DEF).values()].find((x) => x.q.profile && x.q.type === "yesno")?.q.key;
    if (pkey) {
      await writeProfileFacts(site1, co1, { [pkey]: "yes" }, a1.id);
      const rows = profileFactRows((await getVenueProfile(site1))?.facts, ASSESSMENT_DEF);
      ok(rows.length === 1 && rows[0].key === pkey && rows[0].from === a1.id && rows[0].value === "Yes", "t11 db: the venue profile card lists the confirmed fact and the assessment that confirmed it");
      ok(profileFactRows((await getVenueProfile(site2))?.facts, ASSESSMENT_DEF).length === 0, "t11 db: a venue with no profile shows no rows");
    }

    // pick lists: add / duplicate / retire / restore (the admin page's own calls)
    const listId = Object.keys(ASSESSMENT_DEF.pickLists)[0];
    const label = `T11 choice ${Date.now()}`;
    const added = await addPicklistValue(listId, label);
    ok(added.ok, "t11 db: Add puts a new value on a list");
    const dupBuiltIn = await addPicklistValue(listId, ASSESSMENT_DEF.pickLists[listId][0].label);
    ok(!dupBuiltIn.ok, "t11 db: Add refuses a duplicate of a built-in value");
    const dupLabel = await addPicklistValue(listId, ASSESSMENT_DEF.pickLists[listId][0].label.toUpperCase());
    ok(!dupLabel.ok && dupLabel.error === "That choice already exists", "fix 2: a built-in label in other case is refused with 'That choice already exists'");
    const partly = await addPicklistValue("working", "Partly");
    const partlyLower = await addPicklistValue("working", " partly ");
    ok(!partly.ok && !partlyLower.ok && partly.error === "That choice already exists", "fix 2: 'Partly' on the working list is refused (the built-in label is Partly, value partial)");
    ok(!(await getPicklistExtras()).working?.length, "fix 2: nothing was stored for the refused 'Partly'");
    const dupAdded = await addPicklistValue(listId, label);
    ok(!dupAdded.ok && dupAdded.error === "That choice already exists", "t11 db: Add refuses a duplicate of an added value (fix 2: same message)");
    const dupAddedCase = await addPicklistValue(listId, label.toUpperCase());
    ok(!dupAddedCase.ok, "fix 2: an added label in other case is refused too");
    const slug = slugValue(label);
    await setPicklistRetired(listId, slug, true);
    let row = pickListAdminRows(ASSESSMENT_DEF, await getPicklistExtras()).find((x) => x.id === listId)!;
    ok(row.added.find((o) => o.value === slug)?.retired === true, "t11 db: Retire marks an added value retired");
    await setPicklistRetired(listId, slug, false);
    row = pickListAdminRows(ASSESSMENT_DEF, await getPicklistExtras()).find((x) => x.id === listId)!;
    ok(row.added.find((o) => o.value === slug)?.retired === false && row.builtIn.length === ASSESSMENT_DEF.pickLists[listId].length, "t11 db: Restore brings it back; built-in values are untouched");
  } finally {
    await db.delete(DOC_TABLES.findings).where(like(DOC_TABLES.findings.id, "fd_t11%"));
    if (assessments.length) await db.delete(DOC_TABLES.assessments).where(inArray(DOC_TABLES.assessments.id, assessments));
    await db.delete(DOC_TABLES.venue_profiles).where(like(DOC_TABLES.venue_profiles.id, "TESTassess:%"));
    await removeTestPicklistValues();
    await dropAssessIdentityFixtures();
  }
}

async function removeTestPicklistValues() {
  // the admin blob is shared: take the T11 additions back out so a re-run starts clean
  const cur = await getPicklistExtras();
  const next: Record<string, unknown> = {};
  for (const [id, list] of Object.entries(cur)) next[id] = list.filter((o) => !o.label.startsWith("T11 choice"));
  await setBlob(ASSESSMENT_PICKLISTS_BLOB, next);
}

if (process.argv[1] && /test-assessments\.ts$/.test(process.argv[1])) {
  let fail = 0; const ok: Ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };
  assessmentChecks(ok).then(() => { console.log(fail ? `${fail} FAIL` : "all PASS"); process.exit(fail ? 1 : 0); });
}
