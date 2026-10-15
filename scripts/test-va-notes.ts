/* Venue Assessment notes (#344) — harness checks. `vaNotesChecks` is pure; `vaNotesDbChecks` needs the test DB.
   Run alone with `npx tsx scripts/test-va-notes.ts` (pure checks only). */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import {
  SECTION_ORDER, STEP_BY_ID, STEP_LABELS, GROUP_BY_ID, GROUP_META, RIG_SYSTEMS, isQuoteVisit, scopeSet, inScope,
  rigSystems, hasCounterweight, hasLinesets, sectionVisible, splitGoalLines, recapFor, recapScopeText,
} from "../src/lib/survey-flow";
import { migrateSurvey, addLegacyNote, type MigratableSurvey } from "../src/lib/survey-migrate";
import {
  tier1Items, tier1Complete, intakeStatus, DISCIPLINE_GROUPS, presentOptionsFor, disciplineHasData, PIPES_LABEL, SCOPE_OTHER, REPLACE_VS_REUSE_OPTIONS,
  fixtureTotals, fixtureTotalsExcluded, type InventoryRow,
} from "../src/lib/stores/survey-intake";
import { BEAM_FIELDS, blank as blankSurvey } from "../src/lib/stores/surveys";
import { railSheetLabel, SECTION_RAIL_CSS } from "../src/components/section-rail/section-rail";
import { STARTER_SURVEY_TAGS, resolveSurveyTags, mergeSurveyTags, activeSurveyTags, surveyTagLabel } from "../src/lib/survey-tags";
import { sectionProgress } from "../src/app/(app)/venue-assessments/[id]/sections/progress";
import { buildAssessmentSheet } from "../src/lib/venue-assessment-sheet";
import { surveyFindings } from "../src/lib/survey-findings";
import { blankAssessment } from "../src/lib/stores/assessment";
import { parseCollapsed, isCollapsed, collapseStorageKey } from "../src/app/(app)/venue-assessments/[id]/sections/collapse";
import {
  LIFT_TYPES, LOADING_DOOR_TYPES, TRACK_SERIES, TRACK_OPERATIONS, PLUG_TYPES, LIGHTING_POSITIONS, FIXTURE_POSITIONS, CONSOLE_LOCATIONS,
  CONDITION_STEPS, conditionLabel, conditionFromText, parseMonthYear, consoleLocationFrom, travelTimeText, distanceText, listSlug,
  acceptTravel,
} from "../src/lib/field-lists";
import { ASSESSMENT_DEF, allQuestions } from "../src/lib/assessments/defs";
import { sanitizeSurveyDisciplineGoals, withSanitizedSurveyGoals, goalsFromSurvey, goalListsFromSurvey } from "../src/lib/estimate-output/goals";
import { surveyText } from "../src/lib/assist/features/suggest-sources";
import { curtainItemText, positionRowLine, monthText } from "../src/lib/survey-format";
import { cleanPlainText } from "../src/lib/estimate-output/fields";
import * as FLX from "../src/lib/field-lists";
import * as GLX from "../src/lib/estimate-output/goals";
import * as LSX from "../src/lib/stores/linesets";
import * as MGX from "../src/lib/survey-migrate";
import { scopeText } from "../src/lib/survey-format";
import { linesetCondLabel, blankLinesetRow, rowIsEmpty, linesetQuantityPlan, fillDown, fillDownImpact, addMissingSets, markSpare, clampLinesetQty, formatSetRanges, type LinesetRow } from "../src/lib/stores/linesets";

export async function vaNotesChecks(ok: Ok): Promise<void> {
  /* ---- Task 1: survey-flow ---- */
  ok(SECTION_ORDER.indexOf("tier1") === 2 && SECTION_ORDER[0] === "cust" && SECTION_ORDER[1] === "visit",
    "#344 A1: Kill questions come third, right after Customer & venue and Visit");
  ok(SECTION_ORDER.at(-1) === "assign" && SECTION_ORDER.indexOf("project") > SECTION_ORDER.indexOf("notes") &&
     SECTION_ORDER.indexOf("recap") > SECTION_ORDER.indexOf("project") && SECTION_ORDER.indexOf("finalThoughts") > SECTION_ORDER.indexOf("recap"),
    "#344 A1: wrap-up runs Scope & notes → Existing materials & quote → Customer recap → Final thoughts → Assignment (last)");
  ok(SECTION_ORDER.indexOf("m3d") === SECTION_ORDER.indexOf("mHouse") + 1 && SECTION_ORDER.indexOf("m3d") < SECTION_ORDER.indexOf("dRigging"),
    "#344 A1: the 3D preview is the last of the site information");
  ok(!SECTION_ORDER.includes("signoff") && !SECTION_ORDER.includes("conditions"), "#344 A6/A5: no Sign-off, no Site conditions section");
  ok(STEP_LABELS.join("|") === "Brief|Site & access|Measurements|Site intake|Assessment|Wrap-up", "#344 A1: wizard step labels");
  ok(SECTION_ORDER.every((id) => STEP_BY_ID[id] != null && GROUP_BY_ID[id] != null), "#344 A1: every section has a step and a group");
  ok(STEP_BY_ID.tier1 === 0 && STEP_BY_ID.assign === 5 && STEP_BY_ID.linesets === 3 && STEP_BY_ID.assessmentToggle === 4, "#344 A1: steps by id");
  ok(GROUP_BY_ID.tier1 === "brief" && GROUP_BY_ID.assign === "wrapup" && GROUP_META.wrapup.label === "Wrap-up", "#344 A1: groups by id");
  ok(RIG_SYSTEMS.join("|") === "Counterweight|Dead-hung|Motorized|Hemp|Fixed points|None", "#344 R3: rigging system options");

  ok(isQuoteVisit({ visitPurpose: "New system design" }) && !isQuoteVisit({ visitPurpose: "Bid walk" }) && !isQuoteVisit({}),
    "#344 A3: only New system design counts as a quote visit (Jeff, Q2)");

  ok(scopeSet({}) === null && scopeSet({ scope: [] }) === null && scopeSet({ scope: ["junk"] }) === null, "#344 R2: no known scope = unset");
  ok(JSON.stringify(scopeSet({ scope: ["av", "rigging", "x"] })) === '["rigging","av"]', "#344 R2: scope keeps known keys in canonical order");
  ok(inScope({}, "av") && inScope({ scope: ["av"] }, "av") && !inScope({ scope: ["rigging"] }, "av"), "#344 R2: unset scope filters nothing");

  const cw = { disciplines: { rigging: { present: ["Counterweight", "Motorized"] } } };
  ok(rigSystems(cw).join() === "Counterweight,Motorized" && hasCounterweight(cw) && hasLinesets(cw), "#344 R3: rig helpers read disciplines.rigging.present");
  ok(!hasLinesets({ disciplines: { rigging: { present: ["Fixed points"] } } }) && !hasCounterweight({}), "#344 R3: fixed points has no line sets");

  ok(sectionVisible({}, "dAv") && sectionVisible({}, "linesets"), "#344 R2: everything shows while scope is unset");
  ok(!sectionVisible({ scope: ["curtain"] }, "mBeams") && !sectionVisible({ scope: ["curtain"] }, "dRigging") && !sectionVisible({ scope: ["curtain"] }, "linesets"),
    "#344 R2: Beams, Rigging and Line sets need Rigging in scope");
  ok(!sectionVisible({ scope: ["rigging"] }, "mFOH") && sectionVisible({ scope: ["lighting"] }, "mFOH"), "#344 R2: FOH positions needs Lighting");
  ok(sectionVisible({ scope: ["rigging"] }, "mLayout") && sectionVisible({ scope: ["rigging"] }, "cust"), "#344 R2: unscoped sections always show");
  ok(!sectionVisible({ scope: ["rigging"], disciplines: { rigging: { present: ["None"] } } }, "linesets") &&
     sectionVisible({ scope: ["rigging"], disciplines: { rigging: { present: ["None"] } }, linesets: [{}] }, "linesets") &&
     sectionVisible({ scope: ["rigging"], disciplines: { rigging: { present: ["Hemp"] } } }, "linesets"),
    "#344 A1: Line set schedule hides for None / Fixed points unless rows exist");

  ok(JSON.stringify(splitGoalLines("- Fix the main\n• Add a cyc\n\n2. Quieter fly system  \nplain")) === '["Fix the main","Add a cyc","Quieter fly system","plain"]',
    "#344 A7: goal text splits on lines and drops bullets");
  ok(JSON.stringify(splitGoalLines([" a ", "", "b"])) === '["a","b"]' && splitGoalLines(undefined).length === 0, "#344 A7: goal arrays are trimmed");

  const rc = recapFor({
    scope: ["rigging", "lighting"],
    disciplines: {
      rigging: { scope: ["New grid"], goals: "Safer fly rail" },
      lighting: { scope: ["Other"], scopeOther: "LED retrofit study" },
      curtain: { scope: ["Flame test"] },
    },
  });
  ok(rc.map((e) => e.disc).join() === "rigging,lighting", "#344 A7: the recap lists in-scope disciplines only (curtain is out of scope)");
  ok(rc[0].label === "Rigging" && rc[0].scopes.join() === "New grid" && rc[0].goals.join() === "Safer fly rail" && rc[1].other === "LED retrofit study",
    "#344 A7: each entry carries scopes, Other text and goal lines");
  ok(recapFor({ disciplines: { curtain: { scope: ["Flame test"] }, av: {} } }).map((e) => e.disc).join() === "curtain",
    "#344 A7: with scope unset the recap lists disciplines that have scopes or goals");
  const rcLong = recapFor({ scope: ["rigging"], disciplines: { rigging: { goals: "x".repeat(1200) } } });
  ok(rcLong[0].goals.length === 1 && rcLong[0].goals[0].length === 1000, "#344 A7: the recap reads sanitized goals (capped like the Estimator's)");
  ok(recapScopeText(rc[1]) === "Other: LED retrofit study" && recapScopeText(rc[0]) === "New grid", "#344 A7: recap scope text");

  /* ---- Task 2: migration + Tier 1 ---- */
  const m = (s: MigratableSurvey) => migrateSurvey(JSON.parse(JSON.stringify(s)) as MigratableSurvey);
  const a1 = m({ measurements: { rigType: "Hemp" } });
  ok(JSON.stringify(a1.disciplines?.rigging?.present) === '["Hemp"]' && (a1.legacyNotes || []).length === 0,
    "#344 R3: an unanswered rigging system copies up from Beams' Existing rig type");
  const a2 = m({ measurements: { rigType: "None existing" }, disciplines: { rigging: { counterweight: true } } });
  ok(JSON.stringify(a2.disciplines?.rigging?.present) === '["Counterweight"]', "#344 R3: None drops out when another source names a system");
  const a3 = m({ conditions: ["Existing rigging — hemp", "Motorized hoists present", "Low grid clearance"] });
  ok(JSON.stringify(a3.disciplines?.rigging?.present) === '["Hemp","Motorized"]', "#344 R3: the old condition chips copy up");
  const a4 = m({ measurements: { rigType: "Hemp" }, disciplines: { rigging: { present: ["Counterweight system", "Dead-hung battens"], counterweight: true } } });
  ok(JSON.stringify(a4.disciplines?.rigging?.present) === '["Counterweight","Dead-hung"]', "#344 R3: old Present labels relabel on read");
  ok((a4.legacyNotes || []).some((n) => n.section === "mBeams" && n.text === "Hemp") && !(a4.legacyNotes || []).some((n) => n.section === "dRigging"),
    "#344 R1: an answered system keeps a disagreeing rig type as an Older note");
  ok(a4.measurements?.rigType === "Hemp" && a4.disciplines?.rigging?.counterweight === true, "#344 R1: migration never deletes the old keys");
  const a5 = m({ systemsState: { rigging: { installed: "yes", desc: "" } } });
  ok(JSON.stringify(a5.disciplines?.rigging?.present) === JSON.stringify([presentOptionsFor("rigging", "theatre")[0]]) && (a5.disciplines?.rigging?.present as string[] | undefined)?.[0] === "Counterweight",
    "#344: the systemsState fold still seeds Present (now the new first option)");
  const a5b = m({ measurements: { rigType: "Hemp" }, systemsState: { rigging: { installed: "yes", desc: "" } } });
  ok(JSON.stringify(a5b.disciplines?.rigging?.present) === '["Hemp"]', "#344 R3: Beams' rig type beats the systemsState fold's first option");
  const a5c = m({ measurements: { rigType: "Hemp" }, disciplines: { rigging: { present: [] } } });
  ok(JSON.stringify(a5c.disciplines?.rigging?.present) === '["Hemp"]', "#344 R3: an empty Present counts as unanswered and copies up");
  const a5d = m({ disciplines: { rigging: { present: [], counterweight: true } } });
  ok(JSON.stringify(a5d.disciplines?.rigging?.present) === '["Counterweight"]', "#344 R3: an empty Present copies up from the old Counterweight check");
  const sv1 = m({ measurements: { rigType: "None existing" }, disciplines: { rigging: { counterweight: true } } });
  const sv2 = m({ measurements: { rigType: "None existing" }, disciplines: { rigging: { counterweight: true, present: ["Counterweight"] } } });
  ok(JSON.stringify(sv1.legacyNotes) === JSON.stringify(sv2.legacyNotes) && (sv1.legacyNotes || []).some((n) => n.section === "mBeams" && n.text === "None existing"),
    "#344 R1: Older notes are the same whether or not the record was saved (a dropped rig type keeps its note)");
  const a6 = m({ disciplines: { lighting: { goals: "Brighter wash" }, curtain: { present: ["None"] } } });
  ok(JSON.stringify(a6.scope) === '["lighting"]', "#344 R2: scope seeds from disciplines with data (None-only doesn't count)");
  ok(m({}).scope === undefined && JSON.stringify(m({ scope: [] }).scope) === "[]", "#344 R2: nothing to seed → scope stays unset; an answered scope is kept");
  const twice = m(m({ measurements: { rigType: "Bogus" }, disciplines: { rigging: { present: ["Hemp"] } } }) as MigratableSurvey);
  ok((twice.legacyNotes || []).filter((n) => n.text === "Bogus").length === 1, "#344 R1: migration is idempotent (notes de-duplicate)");
  const stored = m({ legacyNotes: [{ section: "x", label: "y", text: "stale" }] });
  ok((stored.legacyNotes || []).length === 0, "#344 R1: legacyNotes are re-derived on every read, never trusted from storage");
  const ln: MigratableSurvey = {};
  addLegacyNote(ln, { section: "s", label: "l", text: "   " });
  ok(!(ln.legacyNotes || []).length, "#344 R1: a blank note is dropped");

  ok(!BEAM_FIELDS.some((f) => f.key === "rigType"), "#344 R3: Beams & rigging no longer asks Existing rig type");
  const rigGroup = DISCIPLINE_GROUPS.find((g) => g.key === "rigging")!;
  ok(rigGroup.presentOptions.join("|") === "Counterweight|Dead-hung|Motorized|Hemp|Fixed points|None" && !rigGroup.fields.some((f) => f.key === "counterweight"),
    "#344 R3: Rigging Present uses the rig-system list; its Counterweight check is gone");

  const base = { venue: "Hall", contact: "Pat", contactEmail: "p@x.org", measurements: { proW: "40", stageDepth: "30" } };
  ok(tier1Items(base).map((i) => i.key).join() === "venue,contact,contactEmail,stageWidth,stageDepth,scope", "#344 A2: Tier 1 items (no phone; scope added)");
  ok(!tier1Complete(base) && tier1Complete({ ...base, scope: ["curtain"] }), "#344 A2: Tier 1 needs a scope; contact phone isn't required");
  ok(tier1Items({ ...base, scope: ["rigging"] }).some((i) => i.key === "rigSystem" && !i.done) && !tier1Complete({ ...base, scope: ["rigging"] }),
    "#344 A2: Rigging in scope adds an unanswered Rigging system item");
  ok(tier1Complete({ ...base, scope: ["rigging"], disciplines: { rigging: { present: ["Hemp"] } } }), "#344 A2: answering the rigging system completes Tier 1");
  const rigOnly = { ...base, scope: ["rigging"], disciplines: { rigging: { present: ["Hemp"] } } };
  ok(intakeStatus(rigOnly) === "general-complete", "#344 A2: the rigging-system kill answer alone doesn't count as a discipline added");
  ok(intakeStatus({ ...rigOnly, disciplines: { rigging: { present: ["Hemp"], gridHeight: "30" } } }) === "discipline-added",
    "#344 A2: real Rigging intake data still flips the status to discipline-added");
  ok(tier1Items(base).find((i) => i.key === "stageWidth")?.section === "tier1" && tier1Items(base).find((i) => i.key === "contact")?.section === "cust",
    "#344 A2: stage W/D are answered on the card; contact jumps to Customer & venue");

  /* ---- Task 3: internal tags ---- */
  ok(STARTER_SURVEY_TAGS.map((t) => t.label).join("|") ===
    "Tight timeline|Price-sensitive|Strong champion|Competitor involved|Budget not confirmed|Decision-maker not met|Active venue (work around events)|Volunteer install crew available|Historic / preservation constraints",
    "#344 A5: the nine starter tags (Jeff, Q6)");
  ok(STARTER_SURVEY_TAGS.every((t) => /^tg_[a-z0-9_]+$/.test(t.id)) && new Set(STARTER_SURVEY_TAGS.map((t) => t.id)).size === 9, "#344 A5: starter ids are tg_ slugs, unique");
  ok(resolveSurveyTags(undefined).length === 9 && resolveSurveyTags([]).length === 9, "#344 A5: absent / empty reads as the starter list");
  ok(resolveSurveyTags([{ id: "tg_a", label: " A " }, { id: "bad id", label: "B" }, { id: "tg_a", label: "dup" }, { id: "tg_c", label: "" }]).map((t) => t.id + ":" + t.label).join() === "tg_a:A",
    "#344 A5: resolve drops bad ids, duplicates and blank labels");
  const st = resolveSurveyTags(undefined);
  const r1 = mergeSurveyTags(st, [{ id: "tg_tight_timeline", label: "Very tight timeline" }, { label: "Board approval needed" }]);
  ok(r1.ok && r1.tags[0].label === "Very tight timeline" && r1.tags[1].id === "tg_board_approval_needed" && !r1.tags[1].retired,
    "#344 A5: rename keeps the id; a new row mints a tg_ id");
  ok(r1.ok && r1.tags.filter((t) => t.retired).length === 8, "#344 A5: rows dropped from the editor are kept, retired (stored surveys keep their label)");
  ok(r1.ok && activeSurveyTags(r1.tags).length === 2 && surveyTagLabel(r1.tags, "tg_price_sensitive") === "Price-sensitive" && surveyTagLabel(r1.tags, "tg_gone") === "tg_gone",
    "#344 A5: active filter and labels (unknown id shows raw)");
  const r2 = mergeSurveyTags(st, [{ label: "X" }, { label: "x" }]);
  ok(!r2.ok && /Two tags/.test(r2.error), "#344 A5: duplicate active labels are refused");
  const r3 = mergeSurveyTags(st, [{ id: "tg_nope", label: "Y" }]);
  ok(!r3.ok && /Unknown tag/.test(r3.error), "#344 A5: an unknown id is refused");
  const r4 = mergeSurveyTags(st, [{ label: "" }]);
  ok(!r4.ok, "#344 A5: a blank label is refused");

  /* ---- Task 4: assignment defaults (source pin) ---- */
  const vaActs = readFileSync(join(process.cwd(), "src/app/(app)/venue-assessments/actions.ts"), "utf8");
  ok(/create\(\{ owner: user\.name, requestedBy: user\.name, stage: "requested", assignedTo: user\.name, scheduledDate: chicagoDayKey\(Date\.now\(\)\) \}, user\.name\)/.test(vaActs),
    "#344 A4: New request defaults Assigned to = me and Scheduled date = today (Chicago); stage stays requested");

  /* ---- Task 5: shared rail ---- */
  ok(railSheetLabel({ key: "S1", label: "Core", done: 3, total: 7, badges: [
      { tone: "prompt", n: 2, title: "", text: "2 to review" }, { tone: "photo", n: 1, title: "", text: "1 photo" }, { tone: "photo", n: 0, title: "", text: "0 photos" }] }, true) === "Core — 3/7 · 2 to review · 1 photo",
    "#344 A8: the phone select label matches the engine's old format (zero badges skipped)");
  ok(railSheetLabel({ key: "recap", label: "Customer recap", done: 0, total: 0 }) === "Customer recap" &&
     railSheetLabel({ key: "x", label: "X", done: 0, total: 0 }, true) === "X — 0/0", "#344 A8: no count for a section without fields unless showEmpty");
  ok(SECTION_RAIL_CSS.includes("@media (max-width: 759px)") && SECTION_RAIL_CSS.includes(".sr-rail-sheet"), "#344 A8: the rail carries its own phone breakpoint");
  const engRail = readFileSync(join(process.cwd(), "src/app/(app)/assessments/[id]/scope-rail.tsx"), "utf8");
  const engEditor = readFileSync(join(process.cwd(), "src/app/(app)/assessments/[id]/editor.tsx"), "utf8");
  ok(engRail.includes('from "@/components/section-rail/section-rail"') && !/function Ring\(/.test(engRail) && engRail.includes("showEmpty"),
    "#344 A8: the engine's scope rail renders the shared SectionRail");
  ok(!/\.as-rail[\s{-]/.test(engEditor) && engEditor.includes("${SECTION_RAIL_CSS}"), "#344 A8: the engine's CSS takes the rail rules from the shared component");

  /* ---- Task 6: editor flow (source pins) ---- */
  const vaDir = "src/app/(app)/venue-assessments/[id]";
  const ctl = readFileSync(join(process.cwd(), `${vaDir}/controls.tsx`), "utf8");
  const sys = readFileSync(join(process.cwd(), `${vaDir}/sections/systems.tsx`), "utf8");
  const kq = readFileSync(join(process.cwd(), `${vaDir}/sections/kill-questions.tsx`), "utf8");
  const vaPage = readFileSync(join(process.cwd(), `${vaDir}/page.tsx`), "utf8");
  const vaActsId = readFileSync(join(process.cwd(), `${vaDir}/actions.ts`), "utf8");
  ok(ctl.includes('from "@/lib/survey-flow"') && !/const ORDER = \[/.test(ctl) && !/const STEP_BY_ID/.test(ctl), "#344 A1: the editor takes order, steps and groups from survey-flow");
  ok(!ctl.includes("SignoffSection") && !ctl.includes('kind: "signoff"'), "#344 A6: the Sign-off section is gone from the editor");
  ok(/isQuoteVisit\(draft\)/.test(ctl), "#344 A3: the quote half of Existing materials & quote is gated on isQuoteVisit");
  ok(/sectionVisible\(draft, s\.id\)/.test(ctl), "#344 R2: the section list is filtered by sectionVisible");
  ok(!sys.includes("Venue-class guidance") && !sys.includes("doctrine"), "#344 A9: the Venue-class guidance panel is removed from the intake");
  ok(sys.includes("presentFromKill") && sys.includes("from Kill questions"), "#344 R3: the Rigging intake shows the rig system read-only");
  ok(kq.includes("SCOPE_KEYS") && kq.includes("RIG_SYSTEMS") && kq.includes("TIER1_WIDTH_BY_CLASS"), "#344 A2: Kill questions carries Scope, Rigging system and stage W/D inputs");
  ok(!vaPage.includes("resolveVenueDoctrine") && vaPage.includes("resolveSurveyTags"), "#344: the editor page drops doctrine and passes internal tags");
  ok(/\| "scope"/.test(vaActsId) && /\| "internalTags"/.test(vaActsId), "#344: SurveyPatch carries scope and internalTags");
  ok(/legacyNotes: _legacy/.test(ctl), "#344 R1: the outbox doc strips legacyNotes (derived, never stored)");

  /* ---- Task 7: progress + collapse ---- */
  const d0 = {
    customer: "Acme", venue: "Hall", address: "", contact: "Pat", contactEmail: "", contactPhone: "", venueClass: "theatre",
    measurements: { proW: "40" } as Record<string, string | boolean>, disciplines: {} as Record<string, Record<string, unknown>>,
    lifeSafety: { deluge: "Yes", smokeVent: "", adaNotes: "", egressNotes: "" }, linesets: [] as unknown[], scope: [] as string[],
    travelTime: "35 min", distance: "", reason: "", visitPurpose: "Bid walk",
  } as never;
  const fieldsSec = { id: "visit", title: "", subtitle: "", group: "brief", step: 0, kind: "fields", fields: [
    { kind: "select", key: "visitPurpose", label: "", options: [] }, { kind: "text", key: "travelTime", label: "" },
    { kind: "text", key: "distance", label: "" }, { kind: "textarea", key: "reason", label: "" }, { kind: "toggle", key: "budgetary", label: "" },
  ] } as never;
  const p1 = sectionProgress(fieldsSec, d0, { tier1Done: true });
  ok(p1.done === 2 && p1.total === 4 && !p1.gate, "#344 A8: fields progress counts answered text/select/textarea and skips yes/no toggles");
  const measSec = { id: "mLayout", kind: "fields", fields: [{ kind: "measure", key: "proW", label: "" }, { kind: "measure", key: "proH", label: "" }] } as never;
  ok(sectionProgress(measSec, d0, { tier1Done: true }).done === 1, "#344 A8: measure fields read measurements");
  const subSec = { id: "lifeSafety", kind: "fields", fields: [{ kind: "sub", obj: "lifeSafety", key: "deluge", label: "" }, { kind: "sub", obj: "lifeSafety", key: "smokeVent", label: "" }] } as never;
  ok(sectionProgress(subSec, d0, { tier1Done: true }).done === 1, "#344 A8: sub fields read the sub-object");
  const t1 = sectionProgress({ id: "tier1", kind: "tier1" } as never, d0, { tier1Done: false });
  ok(t1.total === 6 && t1.gate, "#344 A8: Kill questions counts its items and flags the gate while incomplete");
  ok(sectionProgress({ id: "recap", kind: "recap" } as never, d0, { tier1Done: true }).total === 0, "#344 A8: read-only sections have no ring");

  ok(collapseStorageKey("FS-1100") === "va:collapsed:FS-1100", "#344 A8: collapsed state is remembered per survey");
  ok(JSON.stringify(parseCollapsed('{"a":true,"b":"x","c":false}')) === '{"a":true,"c":false}' && JSON.stringify(parseCollapsed("not json")) === "{}" && JSON.stringify(parseCollapsed("[1]")) === "{}",
    "#344 A8: stored state parses defensively");
  ok(isCollapsed({}, { id: "m", advanced: true }) && !isCollapsed({}, { id: "v" }) && !isCollapsed({ m: false }, { id: "m", advanced: true }),
    "#344 A8: default collapsed = advanced; a stored choice wins");

  const ctl7 = readFileSync(join(process.cwd(), "src/app/(app)/venue-assessments/[id]/controls.tsx"), "utf8");
  ok(!ctl7.includes('"accordion"') && ctl7.includes("<SectionRail") && ctl7.includes("SECTION_RAIL_CSS"), "#344 A8: Accordion mode is gone; long scroll has the shared rail");
  ok(ctl7.includes('role="button"') && ctl7.includes("tabIndex={0}") && ctl7.includes("aria-expanded={open}") && ctl7.includes("aria-controls={") && ctl7.includes("onKeyDown"),
    "#344 A8: the section header is keyboard-operable (role=button, tabIndex, aria-expanded, key handler)");
  ok(ctl7.includes("active={shownActive}") && ctl7.includes("const shownActive"), "#344 A8: the rail's active section is always a shown one");
  ok(ctl7.includes("onPick={pickFromRail}"), "#344 A8: the rail routes a locked discipline to Kill questions");

  /* ---- Task 8: recap, final thoughts, older notes ---- */
  const dir8 = "src/app/(app)/venue-assessments/[id]";
  const ctl8 = readFileSync(join(process.cwd(), `${dir8}/controls.tsx`), "utf8");
  const ft = readFileSync(join(process.cwd(), `${dir8}/sections/final-thoughts.tsx`), "utf8");
  const rcp = readFileSync(join(process.cwd(), `${dir8}/sections/recap.tsx`), "utf8");
  ok(ctl8.includes('id: "recap"') && ctl8.includes('id: "finalThoughts"') && !ctl8.includes('id: "conditions"'), "#344 A5/A7: Customer recap and Final thoughts replace Site conditions");
  ok(ft.includes("activeSurveyTags") && ft.includes("Older site conditions") && ft.includes("Internal only"), "#344 A5: Final thoughts shows active tags, retired-but-carried tags and the old chips read-only");
  ok(rcp.includes("recapFor(") && rcp.includes("What we heard"), "#344 A7: the recap reads recapFor");
  ok(/<OlderNotes notes=\{draft\.legacyNotes\.filter\(\(n\) => n\.section === sec\.id\)\}/.test(ctl8), "#344 R1: every section shows its Older notes");
  ok(ctl8.includes("scrollIntoView(") && ctl8.includes("scrollMarginTop") && !ctl8.includes("window.scrollTo(") && !ctl8.includes("pageYOffset"),
    "#344 A8: jumps scroll the section into view (the app scrolls main.pk-main, not the window)");

  /* ---- Task 9: sheet + findings + list ---- */
  const sheetBase = {
    id: "FS-9", venueClass: "theatre", venue: "Hall", customer: "Acme", measurements: {}, linesets: [], linesetsEnabled: false,
    lifeSafety: { deluge: "", smokeVent: "", adaNotes: "", egressNotes: "" }, assessmentEnabled: false, assessment: blankAssessment(), templateRev: "5.1",
    signoff: { repName: "", repSignedAt: "", contactName: "", contactSignedAt: "", reviewerName: "", reviewerRole: "", reviewerSignedAt: "" },
    scope: ["rigging"], disciplines: { rigging: { scope: ["New grid"], goals: "Safer rail\nQuieter" } },
    legacyNotes: [{ section: "mBeams", label: "Existing rig type (before #344)", text: "Hemp" }],
    internalTags: ["tg_price_sensitive"],
  } as never;
  const sh = buildAssessmentSheet(sheetBase);
  const pages = sh.fieldSheet!.pages;
  const heard = pages[0].sections.find((s) => s.heading === "What we heard");
  ok(!!heard && heard.rows.some((r) => r.label === "Rigging" && r.value === "New grid") && heard.rows.some((r) => r.label === "Rigging goals" && r.value === "Safer rail; Quieter"),
    "#344 A7: the field sheet prints the recap on page 1");
  ok(!pages.some((p) => p.sections.some((s) => s.heading === "Sign-off")), "#344 A6: no Close-out page when nobody signed (new surveys)");
  ok(pages.some((p) => p.sections.some((s) => s.heading === "Older notes" && s.rows.some((r) => r.value === "Hemp"))), "#344 R1: Older notes print");
  ok(!JSON.stringify(sh).includes("Price-sensitive") && !JSON.stringify(sh).includes("tg_price_sensitive"), "#344 A5: internal tags never print");
  const withLs = buildAssessmentSheet({ ...(sheetBase as object), linesets: [{ ...blankLinesetRow(1), setName: "Main curtain" }], linesetsEnabled: false } as never);
  ok(withLs.fieldSheet!.pages.some((p) => p.sections.some((s) => s.heading === "Linesets" && s.rows.length === 1)) &&
     !pages.some((p) => p.sections.some((s) => s.heading === "Linesets")),
    "#344 B6 fix: the field sheet prints entered line sets even with the old toggle off, and nothing when there are none");
  const signed = buildAssessmentSheet({ ...(sheetBase as object), signoff: { repName: "Rep", repSignedAt: "2026-09-20", contactName: "", contactSignedAt: "", reviewerName: "", reviewerRole: "", reviewerSignedAt: "" } } as never);
  ok(signed.fieldSheet!.pages.at(-1)!.sections.at(-1)!.heading === "Sign-off", "#344 A6: an old signed survey still prints its Close-out page");

  const fx = surveyFindings({ reason: "walk", scope: ["rigging"], disciplines: { rigging: { scope: ["New grid"], goals: "Safer rail" } } } as never);
  ok(fx.includes("What we heard:\n  - Rigging: New grid\n    Goal: Safer rail"), "#344 A7: the plain-text findings carry the recap");
  ok(surveyFindings({ reason: "walk" }) === "Reason for visit: walk", "#344 A7: no recap block when there's nothing to read back");

  const listSrc = readFileSync(join(process.cwd(), "src/app/(app)/venue-assessments/page.tsx"), "utf8");
  ok(/sp\.tag/.test(listSrc) && listSrc.includes("internalTags") && listSrc.includes("resolveSurveyTags"), "#344 A5: the list filters by internal tag");

  const railSrc = readFileSync(join(process.cwd(), "src/components/section-rail/section-rail.tsx"), "utf8");
  const ctlRail = readFileSync(join(process.cwd(), "src/app/(app)/venue-assessments/[id]/controls.tsx"), "utf8");
  ok(/maxHeight\?: number/.test(railSrc) && railSrc.includes("overflowY") && ctlRail.includes("maxHeight={railMax}"),
    "#344 A8: the rail scrolls inside its own column when taller than the pane");

  /* ---- B1: field lists ---- */
  ok(LIFT_TYPES.join("|") === "Ladder >12ft|Scaffolding|Single Man Lift|Scissor >20ft|Scissor >40ft|Scissor >50ft", "#344 B1: lift types (Jeff)");
  ok(LOADING_DOOR_TYPES.join("|") === "Roll-up / overhead|Double doors|Single door|Dock door|Other", "#344 B1: loading door types");
  ok(TRACK_SERIES.join("|") === "N/A|None|Lightweight|Standard|Curved" && TRACK_OPERATIONS.join("|") === "SL|SR", "#344 B1: track lists");
  ok(PLUG_TYPES.join("|") === "Stage-pin|Edison|Twist-lock|Other|Mixed", "#344 B1: plug types");
  ok(LIGHTING_POSITIONS.join("|") === "Electric 1|Electric 2|Electric 3|Electric 4|Electric 5|FOH 1|FOH 2|FOH 3|Torms|Balcony|Other", "#344 B1: lighting positions");
  ok(FIXTURE_POSITIONS.join("|") === "Front|Down|Side|Back|Cyc|Movers" && CONSOLE_LOCATIONS.join("|") === "Booth|Stage|Other", "#344 B1: fixture positions + console locations");
  ok(CONDITION_STEPS.join("|") === "Bad|Poor|Fair|Good|New" && conditionLabel(4) === "New" && conditionLabel(0) === "Bad" && conditionLabel(undefined) === "" && conditionLabel(7) === "", "#344 B1: condition steps");
  ok(conditionFromText("Good") === 3 && conditionFromText(" fair ") === 2 && conditionFromText("POOR") === 1 && conditionFromText("new") === 4 && conditionFromText("bad") === 0 && conditionFromText("Needs replacement") === null && conditionFromText("ok-ish") === null,
    "#344 B1: condition text maps only on exact words");
  ok(parseMonthYear("3/2024") === "2024-03" && parseMonthYear("03/2024") === "2024-03" && parseMonthYear("2024-03") === "2024-03" && parseMonthYear("2024-03-17") === "2024-03" &&
     parseMonthYear("March 2024") === "2024-03" && parseMonthYear("Mar 2024") === "2024-03" && parseMonthYear("3/17/2024") === "2024-03" && parseMonthYear("last spring") === null && parseMonthYear("13/2024") === null && parseMonthYear("") === null,
    "#344 B1: month-year parser");
  const cl = consoleLocationFrom("Booth, back of house");
  ok(cl.value === "Booth" && !cl.exact && consoleLocationFrom("stage").value === "Stage" && consoleLocationFrom("stage").exact && consoleLocationFrom("SL wing").value === "Other" && consoleLocationFrom("SL wing").other === "SL wing" && consoleLocationFrom("").value === "",
    "#344 B1: console location keywords");
  ok(travelTimeText(35) === "35 min" && travelTimeText(80) === "1 h 20 min" && travelTimeText(60) === "1 h" && distanceText(22.4) === "22 mi" && distanceText(0.4) === "1 mi", "#344 B1: travel text");
  ok(listSlug("Ladder >12ft") === "ladder_12ft" && listSlug("Roll-up / overhead") === "roll_up_overhead", "#344 B1: engine slugs");
  const pl = ASSESSMENT_DEF.pickLists;
  ok(pl.lift_type?.map((o) => o.label).join("|") === LIFT_TYPES.join("|") && pl.door_type?.length === 5 && pl.lighting_position?.length === 11 && pl.connector.some((o) => o.value === "mixed"),
    "#344 B1 (R4): engine pick lists share the survey lists; connector gains Mixed");
  const qk = [...allQuestions(ASSESSMENT_DEF).keys()];
  ok(["access.lift_type", "access.lift_height", "access.load_in_door_type", "lighting.positions"].every((k) => qk.includes(k)) && ASSESSMENT_DEF.version === 1,
    "#344 B1 (R4): additive engine questions; definition version unchanged");

  /* ---- B2: field definitions + read-time migration ---- */
  const mm = (s: MigratableSurvey) => migrateSurvey(JSON.parse(JSON.stringify(s)) as MigratableSurvey);
  const notes = (s: MigratableSurvey) => s.legacyNotes || [];
  const hasNote = (s: MigratableSurvey, section: string, label: string, text?: string) =>
    notes(s).some((n) => n.section === section && n.label === label && (text === undefined || n.text === text));
  const grp = (k: string) => DISCIPLINE_GROUPS.find((g) => g.key === k)!;
  const fkeys = (k: string) => grp(k).fields.map((f) => f.key);

  /* definitions */
  ok(DISCIPLINE_GROUPS.every((g) => g.scopeOptions.at(-1) === "Other") && SCOPE_OTHER === "Other", "#344 B2: every scope list ends with Other");
  ok(grp("rigging").scopeOptions.join("|") === "New grid|System refurbish|Add hoists|Capacity upgrade|Inspection only|Other", "#344 B2: rigging scope options");
  ok(grp("curtain").scopeOptions.join("|") === "Single curtain replacement|Single set replacement|Flame test|Full curtain replacement|Other", "#344 B2: curtain scope options");
  ok(grp("lighting").scopeOptions.join("|") === "New rig|Controls upgrade|Fixture replacement|Console upgrade|Full system audit|Other", "#344 B2: lighting scope options");
  ok(grp("av").scopeOptions.length === 7 && grp("av").scopeOptions[0] === "New projector", "#344 B2: AV keeps its six scopes plus Other");
  ok(PIPES_LABEL === "Additional general purpose / scenery pipes" && grp("curtain").presentOptions.includes(PIPES_LABEL) && !grp("curtain").presentOptions.includes("Fixed pipe"),
    "#344 B2: curtain Present offers the pipes label instead of Fixed pipe");
  ok(fkeys("curtain").join("|") === "prosHeightToGrid|travelerCondition|trackOperation|fixedPipeQty|pipeTrackLengths|heightAboveFloor|loadCapacity|curtainType|lastFlameTest",
    "#344 B2: curtain fields, in order");
  {
    const f = (k: string) => grp("curtain").fields.find((x) => x.key === k)!;
    ok(f("trackOperation").type === "select" && (f("trackOperation").options || []).join() === TRACK_OPERATIONS.join() && f("trackOperation").label === "Track operation" &&
       f("fixedPipeQty").label === "Additional general purpose / scenery pipes (qty)" && f("pipeTrackLengths").type === "textarea" && f("pipeTrackLengths").label === "Pipe / track lengths" &&
       f("lastFlameTest").type === "month" && f("lastFlameTest").label === "Last flame test" && f("curtainType").visibleFor?.join() === "auditorium",
      "#344 B2: curtain field labels and types");
  }
  ok(REPLACE_VS_REUSE_OPTIONS.join("|") === "Replace|Reuse|Mixed|TBD" && !fkeys("curtain").includes("replaceVsReuse"), "#344 B2: Replace vs. reuse leaves the curtain list (options exported)");
  ok(fkeys("lighting").join("|") === "consoleMfr|consoleLocation|installYear|controls|controlProtocol|dimmerRack|dmxUniverses|followSpotBooth|electricalService|plugType",
    "#344 B2: lighting fields, in order");
  {
    const f = (k: string) => grp("lighting").fields.find((x) => x.key === k)!;
    ok(f("consoleLocation").type === "select" && (f("consoleLocation").options || []).join() === CONSOLE_LOCATIONS.join() &&
       f("controls").label === "Architectural control — manufacturer / model" && f("electricalService").label === "Panel power feeds & locations" &&
       f("plugType").label === "Plug type" && (f("plugType").options || []).join() === PLUG_TYPES.join(),
      "#344 B2: lighting field labels and lists");
  }
  {
    const rf = grp("rigging").fields;
    ok(rf.find((x) => x.key === "gridHeight")?.bind === "gridH" && rf.find((x) => x.key === "loadingGalleryNotes")?.bind === "loadingGallery" &&
       !rf.some((x) => x.key === "battenCount" || x.key === "linesetCount"), "#344 B2: rigging binds grid height / loading gallery; no batten or lineset count");
  }
  ok(grp("av").fields.some((x) => x.key === "conditionLevel" && x.type === "condition" && x.label === "Condition") && !fkeys("av").includes("condition"),
    "#344 B2: AV condition is a condition-type field");
  ok(BEAM_FIELDS.slice(0, 3).map((f) => `${f.key}:${f.type}:${f.label}`).join("|") ===
       "structuralDrawingOnFile:check:Structural drawing on file|brickDrawingOnFile:check:Brick drawing on file|cwElevationOnFile:check:CW Elevation sheet on file" &&
     !BEAM_FIELDS.some((f) => f.key === "hhSheet" || f.key === "brickDrawing"),
    "#344 B2: Beams starts with the three drawing checks (no H&H / brick)");
  ok(!disciplineHasData({ items: {} }, [], "curtain") && disciplineHasData({ items: { Legs: { qty: "4" } } }, [], "curtain") && disciplineHasData({ linesetN: 0 }, [], "rigging"),
    "#344 B2: disciplineHasData ignores {} and counts a number");
  ok(SECTION_ORDER.indexOf("finalQuestions") === SECTION_ORDER.indexOf("project") + 1 && SECTION_ORDER.indexOf("recap") === SECTION_ORDER.indexOf("finalQuestions") + 1 &&
     STEP_BY_ID.finalQuestions === 5 && GROUP_BY_ID.finalQuestions === "wrapup", "#344 B2: Final questions sits between Existing materials & quote and the recap");
  ok(!sectionVisible({ scope: ["rigging"] }, "finalQuestions") && sectionVisible({ scope: ["curtain"] }, "finalQuestions") && sectionVisible({}, "finalQuestions"),
    "#344 B2: Final questions needs Curtains in scope");
  {
    const blankRec = blankSurvey();
    ok(["loadingDoorType", "loadingDoorLocation", "loadingDoorWH", "liftRequired", "liftType", "liftWorkingHeight"].every((k) => blankRec[k] === "") && !("linesetQty" in blankRec),
      "#344 B2: blank() carries the new access fields (linesetQty stays optional)");
  }

  /* stepAccess */
  const ac1 = mm({ loadingDoorSize: "Rear dock 10x12", liftNeeded: "Scaffold", liftHeight: "30 ft" } as MigratableSurvey);
  ok(ac1.loadingDoorLocation === "Rear dock 10x12" && ac1.loadingDoorSize === "Rear dock 10x12" && ac1.liftRequired === "yes" && ac1.liftType === "Scaffolding" && ac1.liftNeeded === "Scaffold" &&
     hasNote(ac1, "site", "Lift needed — type / height (before #344)", "30 ft") && ac1.liftHeight === "30 ft",
    "#344 B2 stepAccess: door size → location, Scaffold → Scaffolding, lift height → note; old keys kept");
  const ac2 = mm({ loadingDoorSize: "Side door", loadingDoorLocation: "Stage left", liftNeeded: "Articulating boom" } as MigratableSurvey);
  ok(ac2.loadingDoorLocation === "Stage left" && hasNote(ac2, "site", "Loading door location & W × H (before #344)", "Side door") &&
     ac2.liftRequired === "yes" && !ac2.liftType && hasNote(ac2, "site", "Kind of lift needed (before #344)", "Articulating boom"),
    "#344 B2 stepAccess: a filled location keeps the old size as a note; an unmapped lift kind is a note");
  const ac3 = mm({ liftNeeded: "None needed" } as MigratableSurvey);
  ok(ac3.liftRequired === "no" && !ac3.liftType && notes(ac3).length === 0 && ac3.liftNeeded === "None needed", "#344 B2 stepAccess: None needed → Lift required: no");
  const ac4 = mm({ liftNeeded: "Scissor lift", liftRequired: "no", liftType: "Scissor >20ft" } as MigratableSurvey);
  ok(ac4.liftRequired === "no" && ac4.liftType === "Scissor >20ft" && notes(ac4).length === 0, "#344 B2 stepAccess: answered lift fields are never overwritten");

  /* stepMeasureLinks */
  const ml1 = mm({ disciplines: { rigging: { present: ["Hemp"], gridHeight: "48'", loadingGalleryNotes: "SR, 40'" } } } as MigratableSurvey);
  ok(ml1.measurements?.gridH === "48'" && ml1.measurements?.loadingGallery === "SR, 40'" && ml1.disciplines?.rigging?.gridHeight === "48'" && notes(ml1).length === 0,
    "#344 B2 stepMeasureLinks: rigging grid height / loading gallery copy into the measurements");
  const ml2 = mm({ measurements: { gridH: "50'", loadingGallery: "SR, 40'" }, disciplines: { rigging: { present: ["Hemp"], gridHeight: "48'", loadingGalleryNotes: " SR, 40' " } } } as MigratableSurvey);
  ok(ml2.measurements?.gridH === "50'" && hasNote(ml2, "dRigging", "Grid height (Rigging, before #344)", "48'") && !notes(ml2).some((n) => n.label.startsWith("Loading gallery")),
    "#344 B2 stepMeasureLinks: a disagreeing rigging value becomes a note; an equal one doesn't");
  const ml3 = mm({ disciplines: { rigging: { present: ["Hemp"], linesetCount: "24", battenCount: "30" } } } as MigratableSurvey);
  ok(ml3.linesetQty === 24 && ml3.disciplines?.rigging?.linesetCount === "24" && hasNote(ml3, "dRigging", "Lineset count / Batten count (before #344)", "Batten count: 30"),
    "#344 B2 stepMeasureLinks: line set quantity from Lineset count; a different Batten count is a note");
  const ml4 = mm({ linesets: [{ id: "a", pos: "1" }, { id: "b", pos: "2" }], disciplines: { rigging: { present: ["Hemp"], battenCount: "about 12" } } } as unknown as MigratableSurvey);
  ok(ml4.linesetQty === 2 && hasNote(ml4, "dRigging", "Lineset count / Batten count (before #344)", "Batten count: about 12"),
    "#344 B2 stepMeasureLinks: existing rows set the line set quantity");
  const ml5 = mm({ linesetQty: 9, disciplines: { rigging: { present: ["Hemp"], battenCount: "9", linesetCount: "300" } } } as MigratableSurvey);
  ok(ml5.linesetQty === 9 && hasNote(ml5, "dRigging", "Lineset count / Batten count (before #344)", "Lineset count: 300"), "#344 B2 stepMeasureLinks: a stored quantity wins; out-of-range counts note");

  /* stepBeamsDrawings */
  const bd1 = mm({ measurements: { brickDrawing: true, hhSheet: true } });
  ok(bd1.measurements?.structuralDrawingOnFile === true && bd1.measurements?.cwElevationOnFile === true && bd1.measurements?.brickDrawing === true && bd1.measurements?.hhSheet === true &&
     hasNote(bd1, "mBeams", "Brick / structural drawing on file (before #344)", "Yes — check whether it was the structural or the brick drawing"),
    "#344 B2 stepBeamsDrawings: old drawing checks copy forward with a which-drawing note");
  const bd2 = mm({ measurements: { brickDrawing: true, structuralDrawingOnFile: false, brickDrawingOnFile: true, hhSheet: true, cwElevationOnFile: false } });
  ok(bd2.measurements?.structuralDrawingOnFile === false && bd2.measurements?.cwElevationOnFile === false && notes(bd2).length === 0,
    "#344 B2 stepBeamsDrawings: answered drawing checks are never overwritten");

  /* stepScopeRelabels */
  const sr1 = mm({ disciplines: {
    rigging: { scope: ["Grid refurbish", "System refurbish", "New grid"] },
    curtain: { present: ["Fixed pipe", "Cyc / backdrop"], scope: ["New main", "New legs / borders", "Traveler replacement", "Full masking upgrade"] },
    lighting: { scope: ["Dimmer upgrade"] },
  } });
  ok(JSON.stringify(sr1.disciplines?.rigging?.scope) === '["System refurbish","New grid"]', "#344 B2 stepScopeRelabels: rigging relabels and de-duplicates");
  ok(JSON.stringify(sr1.disciplines?.curtain?.scope) === '["Single curtain replacement","Single set replacement","Other","Full curtain replacement"]' &&
     sr1.disciplines?.curtain?.scopeOther === "Traveler replacement", "#344 B2 stepScopeRelabels: curtain relabels; Traveler replacement → Other with its text");
  ok(JSON.stringify(sr1.disciplines?.lighting?.scope) === '["Controls upgrade"]' && JSON.stringify(sr1.disciplines?.curtain?.present) === JSON.stringify([PIPES_LABEL, "Cyc / backdrop"]),
    "#344 B2 stepScopeRelabels: lighting relabel; curtain Present Fixed pipe → pipes label");
  const sr2 = mm({ disciplines: { curtain: { scope: ["Traveler replacement"], scopeOther: "Rehang the cyc" } } });
  ok(JSON.stringify(sr2.disciplines?.curtain?.scope) === '["Other"]' && sr2.disciplines?.curtain?.scopeOther === "Traveler replacement; Rehang the cyc",
    "#344 B2 stepScopeRelabels: a filled Other text keeps Traveler replacement in front of it");

  /* stepGoalsList */
  const gl = mm({ disciplines: { rigging: { goals: "- Safer rail\n• Faster changeovers" }, av: { goals: ["kept"] } } });
  ok(JSON.stringify(gl.disciplines?.rigging?.goals) === '["Safer rail","Faster changeovers"]' && JSON.stringify(gl.disciplines?.av?.goals) === '["kept"]',
    "#344 B2 stepGoalsList: goal text becomes a list; lists stay");

  /* stepCurtain */
  const cu1 = mm({ venueClass: "auditorium", disciplines: { curtain: {
    present: ["Legs", "Borders"], maskingNeeds: "Legs + borders", pipeDiameter: "1.5\"", mounting: "Batten", fabricColor: "Black", fabricWeightOz: "25",
    finishedWH: "20x30", condition: "Worn", legsBorders: "4 pr", mainCondition: "Faded", trackSeries: "ADC 280",
    legsQtyPairs: "4", bordersQty: "3", cycScrimFabric: "Muslin", trackOperation: "sr", operation: "Walk-along", lastFlameTest: "March 2023",
  } } } as MigratableSurvey);
  const c1 = cu1.disciplines?.curtain as Record<string, unknown>;
  const it1 = c1.items as Record<string, Record<string, string>>;
  ok([["Masking needed", "Legs + borders"], ["Pipe diameter", "1.5\""], ["Mounting", "Batten"], ["Fabric / colour", "Black"], ["Fabric weight (oz)", "25"],
      ["Finished width × height", "20x30"], ["Condition", "Worn"], ["Legs & borders", "4 pr"], ["Main curtain", "Faded"], ["Track series", "ADC 280"]]
      .every(([l, t]) => hasNote(cu1, "dCurtain", `${l} (before #344)`, t)) && c1.maskingNeeds === "Legs + borders" && c1.trackSeries === "ADC 280",
    "#344 B2 stepCurtain: removed curtain fields become notes; keys kept");
  ok(it1?.Legs?.qty === "4" && it1?.Borders?.qty === "3" && c1.legsQtyPairs === "4" && hasNote(cu1, "dCurtain", "Cyc / scrim fabric (before #344)", "Muslin") && !it1?.["Cyc / scrim"],
    "#344 B2 stepCurtain: legs / borders fold into ticked curtain rows; an unticked cyc stays a note");
  ok(c1.trackOperation === "SR" && hasNote(cu1, "dCurtain", "Operation (before #344)", "Walk-along") && c1.operation === "Walk-along", "#344 B2 stepCurtain: track operation normalises; other operation text is a note");
  ok(c1.lastFlameTest === "2023-03" && !notes(cu1).some((n) => n.label.startsWith("Last flame")), "#344 B2 stepCurtain: last flame test parses to a month");
  const cu2 = mm({ disciplines: { curtain: { present: ["Legs"], items: { Legs: { qty: "6" } }, legsQtyPairs: "4", trackOperation: "Both sides", operation: "SL", lastFlameTest: "a while ago" } } });
  const c2 = cu2.disciplines?.curtain as Record<string, unknown>;
  ok((c2.items as Record<string, Record<string, string>>).Legs.qty === "6" && hasNote(cu2, "dCurtain", "Legs quantity (pairs) (before #344)", "4"),
    "#344 B2 stepCurtain: a filled row isn't overwritten; the old quantity is a note");
  ok(c2.trackOperation === "Both sides" && hasNote(cu2, "dCurtain", "Track operation (before #344)", "Both sides") && hasNote(cu2, "dCurtain", "Operation (before #344)", "SL"),
    "#344 B2 stepCurtain: unmapped track operation stays stored + noted; a disagreeing SL/SR operation is a note");
  ok(c2.lastFlameTest === "a while ago" && hasNote(cu2, "dCurtain", "Last flame test (before #344)", "a while ago"), "#344 B2 stepCurtain: an unparseable flame test date stays + notes");
  const cu3 = mm({ disciplines: { curtain: { operation: "sl", lastFlameTest: "2024-05" } } });
  ok((cu3.disciplines?.curtain as Record<string, unknown>).trackOperation === "SL" && (cu3.disciplines?.curtain as Record<string, unknown>).lastFlameTest === "2024-05" && notes(cu3).length === 0,
    "#344 B2 stepCurtain: SL/SR operation fills an empty track operation");

  /* stepLighting */
  const li1 = mm({ disciplines: { lighting: { fixtureQty: "60", fixtureTypes: "Source 4", console: "ETC Ion", fohPositions: "2 pipes", positions: "Electrics 1-3", circuitAccess: "Fair", consoleLocation: "Booth at rear" } } });
  const l1 = li1.disciplines?.lighting as Record<string, unknown>;
  ok([["Fixture quantity", "60"], ["Fixture types", "Source 4"], ["Control console", "ETC Ion"], ["FOH positions", "2 pipes"], ["Lighting positions", "Electrics 1-3"], ["Circuit accessibility", "Fair"]]
      .every(([l, t]) => hasNote(li1, "dLighting", `${l} (before #344)`, t)) && l1.fixtureQty === "60" && l1.circuitAccess === "Fair",
    "#344 B2 stepLighting: removed lighting fields become notes; keys kept");
  ok(l1.consoleLocation === "Booth" && hasNote(li1, "dLighting", "Console location (before #344)", "Booth at rear"), "#344 B2 stepLighting: console location maps to Booth, extra words noted");
  const li2 = mm({ disciplines: { lighting: { consoleLocation: "Rear balcony" } } });
  const l2 = li2.disciplines?.lighting as Record<string, unknown>;
  ok(l2.consoleLocation === "Other" && l2.consoleLocationOther === "Rear balcony" && notes(li2).length === 0, "#344 B2 stepLighting: other console locations go to Other + its text");
  const li3 = mm({ disciplines: { lighting: { consoleLocation: "Stage", positions: ["FOH 1"] } } });
  ok((li3.disciplines?.lighting as Record<string, unknown>).consoleLocation === "Stage" && notes(li3).length === 0, "#344 B2 stepLighting: a listed location and a non-string positions are left alone");

  /* stepAvCondition */
  const av1 = mm({ disciplines: { av: { condition: "good" } } });
  ok((av1.disciplines?.av as Record<string, unknown>).conditionLevel === 3 && (av1.disciplines?.av as Record<string, unknown>).condition === "good" && notes(av1).length === 0,
    "#344 B2 stepAvCondition: an exact word maps to a level");
  const av2 = mm({ disciplines: { av: { condition: "Speakers blown", conditionLevel: 1 } } });
  ok((av2.disciplines?.av as Record<string, unknown>).conditionLevel === 1 && hasNote(av2, "dAv", "Condition (before #344)", "Speakers blown"),
    "#344 B2 stepAvCondition: free text is a note; a set level is kept");

  /* stepLinesets */
  const ls1 = mm({ linesets: [{ id: "a", cond: "G" }, { id: "b", cond: "X" }, { id: "c", cond: "P", condition: 4 }, { id: "d", cond: "" }] } as unknown as MigratableSurvey);
  const rows = (ls1 as unknown as { linesets: Array<Record<string, unknown>> }).linesets;
  ok(rows[0].condition === 3 && rows[1].condition === 0 && rows[2].condition === 4 && rows[3].condition === undefined && rows[0].cond === "G",
    "#344 B2 stepLinesets: lineset codes map to condition levels once");

  /* goals lists survive the save sanitizer and still reach the Estimator as text (interim; B7 adds goalListsFromSurvey) */
  {
    const san = sanitizeSurveyDisciplineGoals({ rigging: { goals: [" Safer rail ", "", "x".repeat(400), ...Array(30).fill("g")] }, av: { goals: ["  "] } }) as Record<string, Record<string, unknown>>;
    const list = san.rigging.goals as string[];
    ok(Array.isArray(list) && list[0] === "Safer rail" && list[1].length === 400 && list.join("\n").length <= 1000 && !("goals" in san.av),
      "#344 B2: the save sanitizer keeps a goals list (blanks dropped; joined text within 1,000)");
    ok(goalsFromSurvey(gl).rigging === "Safer rail\nFaster changeovers", "#344 B2: a migrated goals list still reads as text for the Estimator");

    /* Fix 1: R1 — a save never shortens anything an old goals string (≤ 1,000 chars) could hold */
    const savedGoals = (goals: string) => {
      const first = mm({ disciplines: { rigging: { goals } } });
      const before = goalsFromSurvey(first).rigging;
      const saved = withSanitizedSurveyGoals({ disciplines: JSON.parse(JSON.stringify(first.disciplines)) });
      const again = mm({ disciplines: saved.disciplines } as MigratableSurvey);
      return { before, after: goalsFromSurvey(again).rigging };
    };
    const one = "w".repeat(651);
    const r651 = savedGoals(one);
    ok(r651.before === one && r651.after === one, "#344 B2 fix: a 651-char one-line goal survives migrate → save sanitize → migrate unchanged");
    const thirty = Array.from({ length: 30 }, (_, i) => `Goal ${i + 1}`).join("\n");
    const r30 = savedGoals(thirty);
    ok(r30.after === thirty && r30.after?.split("\n").length === 30, "#344 B2 fix: a 30-line goal keeps all 30 lines through a save");
    const big = "y".repeat(1500);
    ok(savedGoals(big).after === cleanPlainText(big, 1000), "#344 B2 fix: a 1,500-char goal is cut exactly as before (the old 1,000 cap)");
  }

  /* Fix 1b: an unmappable track operation / flame-test date survives the rep picking a new value (write-once …Old keys) */
  {
    const fx = mm({ disciplines: { curtain: { trackOperation: "Both sides", lastFlameTest: "a while ago" } } });
    const c = fx.disciplines?.curtain as Record<string, unknown>;
    ok(c.trackOperationOld === "Both sides" && hasNote(fx, "dCurtain", "Track operation (before #344)", "Both sides"),
      "#344 B2 fix: an unmappable track operation moves to trackOperationOld and notes");
    ok(c.lastFlameTestOld === "a while ago" && hasNote(fx, "dCurtain", "Last flame test (before #344)", "a while ago"),
      "#344 B2 fix: an unparseable flame-test date moves to lastFlameTestOld and notes");
    const picked = JSON.parse(JSON.stringify(fx)) as MigratableSurvey;
    (picked.disciplines!.curtain as Record<string, unknown>).trackOperation = "SL";
    (picked.disciplines!.curtain as Record<string, unknown>).lastFlameTest = "2024-03";
    const again = mm(picked);
    const c2x = again.disciplines?.curtain as Record<string, unknown>;
    ok(c2x.trackOperation === "SL" && c2x.lastFlameTest === "2024-03" && c2x.trackOperationOld === "Both sides" && c2x.lastFlameTestOld === "a while ago" &&
       hasNote(again, "dCurtain", "Track operation (before #344)", "Both sides") && hasNote(again, "dCurtain", "Last flame test (before #344)", "a while ago"),
      "#344 B2 fix: after picking SL / a month the old text and its notes are still there");
    ok(JSON.stringify(mm(again)) === JSON.stringify(again) && JSON.stringify(mm(fx)) === JSON.stringify(fx), "#344 B2 fix: the …Old migration is idempotent");
  }

  /* idempotency over everything above */
  const fixtures: MigratableSurvey[] = [ac1, ac2, ac3, ml1, ml2, ml3, ml4, ml5, bd1, sr1, sr2, gl, cu1, cu2, cu3, li1, li2, av1, av2, ls1];
  ok(fixtures.every((f) => JSON.stringify(mm(f)) === JSON.stringify(f)), "#344 B2: migrating twice gives identical JSON");

  /* B3: shared UI pieces (source pins) */
  const b3dir = "src/app/(app)/venue-assessments/[id]/sections";
  const rd = (f: string) => readFileSync(join(process.cwd(), f), "utf8");
  const slider = rd(`${b3dir}/condition-slider.tsx`);
  const goals = rd(`${b3dir}/goals-list.tsx`);
  const chips = rd(`${b3dir}/scope-chips.tsx`);
  const css = rd("src/app/globals.css");
  ok(/type="range"/.test(slider) && /min=\{0\}/.test(slider) && /max=\{4\}/.test(slider) && /step=\{1\}/.test(slider) && slider.includes("var(--cond-") && slider.includes("aria-valuetext"),
    "#344 B3: condition slider is a 0–4 native range, coloured from --cond-N, with aria-valuetext");
  ok(slider.includes("CONDITION_STEPS") && slider.includes("onChange(null)") && slider.includes("Not rated"),
    "#344 B3: condition slider shows step labels, 'Not rated' until touched, and Clear stores null (a kept key, so it stays cleared)");
  ok(goals.includes("maxLength={goalMaxLength(value, i)}") && /MAX_GOALS\s*=\s*20/.test(goals) && goals.includes("+ Add goal") && goals.includes("value.length < MAX_GOALS") && goals.includes("disabled={!canAdd}"),
    "#344 B3: goals editor caps typing at 300 chars a line and 20 goals (B-final: and the 1,000 total)");
  ok(goals.includes("Enter") && goals.includes("focus()") && goals.includes("↑") && goals.includes("↓") && goals.includes("×"),
    "#344 B3: goals editor adds-after on Enter, reorders and removes");
  ok(goals.includes("nativeEvent.isComposing") && goals.includes("role=\"group\"") && goals.includes("aria-label={`${label} ${i + 1}`}"),
    "#344 B3 fix: goals Enter ignores IME composition; group + per-input names come from the label prop");
  ok(goals.includes("pending.current") && goals.includes("ups.current") && goals.includes("downs.current") && goals.includes("addBtn"),
    "#344 B3 fix: goals reorder/remove restore keyboard focus (same ↑/↓ button, next/previous row, or + Add goal)");
  ok(slider.includes("aria-label={`Clear ${label}`}") && slider.includes("aria-label={`Rate ${label}`}") && slider.includes("onPointerUp"),
    "#344 B3 fix: slider Rate/Clear buttons carry unique names; a tap on the unrated thumb rates it");
  ok(chips.includes("role=\"group\"") && chips.includes("aria-labelledby") && chips.includes("useId") && chips.includes("htmlFor={otherId}"),
    "#344 B3 fix: scope chips are a labelled group and the explain box has a real label");
  ok(/value\.includes\("Other"\)/.test(chips) && chips.includes("Explain the scope") && chips.includes("maxLength={500}"),
    "#344 B3: scope chips show the 500-char explain box only when Other is selected");
  ok([0, 1, 2, 3, 4].every((i) => new RegExp(`--cond-${i}:\\s*#[0-9a-f]{6}`, "i").test(css)), "#344 B3: globals.css defines --cond-0 … --cond-4");
  ok(![slider, goals, chips].some((f) => /from "@\/db|stores\/|"server-only"/.test(f)) && [slider, goals, chips].every((f) => f.startsWith('"use client"')),
    "#344 B3: the three components are client-safe (use client, no store imports)");

  /* B4: discipline sections */
  const inv = (position: string | undefined, quantity: string): InventoryRow =>
    ({ id: "x", discipline: "lighting", category: "lighting.fixture", type: "PAR", quantity, flag: false, notes: "", position });
  const fxRows = [inv("Side", "8"), inv("Front", "12"), inv("Front", " 3 "), inv(undefined, "4"), inv("Back", "~20"), inv("Down", ""), inv("Cyc", "0")];
  ok(JSON.stringify(fixtureTotals(fxRows)) === JSON.stringify([{ position: "Front", qty: 15 }, { position: "Side", qty: 8 }, { position: "Cyc", qty: 0 }]),
    "#344 B4: fixtureTotals sums numeric qty per position in FIXTURE_POSITIONS order");
  ok(fixtureTotalsExcluded(fxRows) === 2 && fixtureTotals([]).length === 0 && fixtureTotalsExcluded([inv("Front", "")]) === 0,
    "#344 B4: rows with a qty but no position or a non-number qty are counted as excluded; blank rows are not");
  ok(JSON.stringify(fixtureTotals([inv("Balcony rail", "2"), inv("Front", "1")])) === JSON.stringify([{ position: "Front", qty: 1 }, { position: "Balcony rail", qty: 2 }]),
    "#344 B4: an unlisted stored position still totals, after the listed ones");
  const sysB4 = rd(`${b3dir}/systems.tsx`);
  const curt = rd(`${b3dir}/curtain-rows.tsx`);
  const lpos = rd(`${b3dir}/lighting-positions.tsx`);
  const ctlB4 = rd("src/app/(app)/venue-assessments/[id]/controls.tsx");
  const pageB4 = rd("src/app/(app)/venue-assessments/[id]/page.tsx");
  const iScope = sysB4.indexOf("<ScopeChips"), iGoals = sysB4.indexOf("<GoalsListEditor"), iPresent = sysB4.indexOf(">Present</label>"), iRig = sysB4.indexOf(">Rigging system</label>");
  ok(iScope > 0 && iScope < iGoals && iGoals < iPresent && iGoals < iRig, "#344 B4: each discipline shows Scope of interest, then Client goals, then Present");
  ok(sysB4.includes("group.scopeLabel") && sysB4.includes('"scopeOther"') && !sysB4.includes("toggleScope") && !ctlB4.includes("toggleScope="),
    "#344 B4: scope chips write scope + scopeOther (the old toggleScope prop is gone)");
  ok(sysB4.includes("splitGoalLines") && /Array\.isArray\(raw\)/.test(sysB4), "#344 B4: goals read a list as-is (blank rows survive editing) and split an old string");
  ok(sysB4.includes('field.type === "month"') && sysB4.includes('type="month"') && sysB4.includes('placeholder="YYYY-MM"') && !/value=\{\/\^\\d\{4\}/.test(sysB4),
    "#344 B4: month fields use <input type=month> and pass the stored text through (the text fallback stays typeable)");
  ok(sysB4.includes('field.type === "condition"') && sysB4.includes("<ConditionSlider") && sysB4.includes('field.type === "textarea"') && sysB4.includes("taStyle"),
    "#344 B4: condition fields render the slider and textarea fields a full-width textarea");
  ok(sysB4.includes("field.bind") && sysB4.includes("props.setMeasure(") && sysB4.includes("Same value as Measurements") && ctlB4.includes("measureValue={mv}") && ctlB4.includes("setMeasure={setMeasure}"),
    "#344 B4: a bound field reads and writes measurements[bind] and says so");
  ok(sysB4.includes("PIPES_LABEL") && /fixedPipeQty/.test(sysB4), "#344 B4: the pipes qty field shows only when the pipes chip is ticked");
  ok(curt.includes("TRACK_SERIES") && curt.includes("<datalist") && curt.includes("<ConditionSlider") && curt.includes("compact") &&
     ["QTY", "Fabric type", "oz", "Track series", "W", "H"].every((l) => curt.includes(`>${l}</label>`)),
    "#344 B4: curtain rows carry QTY, Fabric type (datalist), oz, Track series, W, H and a compact condition slider");
  ok(/label\.toLowerCase\(\) !== "none" && label !== PIPES_LABEL/.test(sysB4) && sysB4.includes('"items"'),
    "#344 B4: one curtain row per ticked type except None and the pipes chip, written to items");
  ok(lpos.includes("LIGHTING_POSITIONS") && lpos.includes("Lighting positions") && ["Circuits", "Length", "Trim / height", "Notes"].every((l) => lpos.includes(`>${l}</label>`)) &&
     sysB4.includes('"positionList"') && sysB4.includes('"positionRows"'),
    "#344 B4: lighting position chips write positionList; each ticked position gets a Circuits / Length / Trim / Notes row");
  ok(lpos.includes("Other — where?") && sysB4.includes('"consoleLocationOther"') && /=== "Other"/.test(sysB4), "#344 B4: console location Other asks where");
  ok(sysB4.includes("FIXTURE_POSITIONS") && sysB4.includes("fixtureTotals(") && sysB4.includes('"lighting.fixture"') && ctlB4.includes(".sv-inv-pos"),
    "#344 B4: fixture rows get a Position select and derived totals under the inventory");
  ok([curt, lpos].every((f) => f.startsWith('"use client"') && !/^import (?!type)[^\n]*stores\//m.test(f) && !/"server-only"|@\/db/.test(f)),
    "#344 B4: the new row components are client-safe (no runtime store imports)");
  {
    /* a cleared bound field stays cleared; the old Rigging value stays visible as an Older note */
    const cleared = mm({ measurements: { gridH: "" }, disciplines: { rigging: { gridHeight: "28" } } } as MigratableSurvey);
    ok(cleared.measurements?.gridH === "" && hasNote(cleared, "dRigging", "Grid height (Rigging, before #344)", "28"),
      "#344 B4: a cleared Grid height stays cleared and the old Rigging value shows as an Older note");
    const again = mm(cleared);
    ok(again.measurements?.gridH === "" && notes(again).filter((n) => n.label === "Grid height (Rigging, before #344)").length === 1,
      "#344 B4: the cleared-field migration is idempotent");
    const gal = mm({ measurements: { loadingGallery: "" }, disciplines: { rigging: { loadingGalleryNotes: "stage left" } } } as MigratableSurvey);
    ok(gal.measurements?.loadingGallery === "" && hasNote(gal, "dRigging", "Loading gallery notes (Rigging, before #344)", "stage left"),
      "#344 B4: a cleared Loading gallery stays cleared and its old value shows as an Older note");
    const never = mm({ disciplines: { rigging: { gridHeight: "28" } } } as MigratableSurvey);
    ok(never.measurements?.gridH === "28" && !hasNote(never, "dRigging", "Grid height (Rigging, before #344)"), "#344 B4: a never-answered Grid height still takes the Rigging value");
  }
  ok(pageB4.includes("disciplinesActive") && /needsFabric \?[^\n]*fabricPartsByCategory/.test(pageB4) && /needsFabric/.test(pageB4),
    "#344 B4: the fabric list is read only when curtains are in play");
  ok(pageB4.includes("fabricPartsByCategory") && pageB4.includes("fabricOptions") && ctlB4.includes("fabricOptions={meta.fabricOptions}"),
    "#344 B4: the fabric datalist comes from the catalog's fabric parts via meta");
  ok(rd(`${b3dir}/goals-list.tsx`).includes("e.keyCode === 229"), "#344 B4: goals Enter also ignores Safari's IME keyCode 229");
  ok(/\{meetingsSlot\}\s*\{visibleSections\.map\(/.test(ctlB4), "#344 B4: the meetings slot still sits right before the sections");
  /* progress: bound fields read measurements; curtain rows and lighting positions count */
  const dp = (disc: Record<string, Record<string, unknown>>, meas: Record<string, string | boolean> = {}, venueClass = "theatre") =>
    ({ ...(d0 as object), venueClass, measurements: meas, disciplines: disc }) as never;
  const rigSec = { id: "dRigging", kind: "discipline", disc: "rigging" } as never;
  const curSec = { id: "dCurtain", kind: "discipline", disc: "curtain" } as never;
  const litSec = { id: "dLighting", kind: "discipline", disc: "lighting" } as never;
  const rigA = sectionProgress(rigSec, dp({ rigging: { present: ["Dead-hung"] } }), { tier1Done: true });
  const rigB = sectionProgress(rigSec, dp({ rigging: { present: ["Dead-hung"] } }, { gridH: "40" }), { tier1Done: true });
  ok(rigB.done === rigA.done + 1 && rigB.total === rigA.total, "#344 B4: progress reads a bound field (Grid height) from measurements");
  const cA = sectionProgress(curSec, dp({ curtain: { present: ["Divider curtain"] } }), { tier1Done: true });
  const cB = sectionProgress(curSec, dp({ curtain: { present: ["Divider curtain"], items: { "Divider curtain": { qty: "2" } } } }), { tier1Done: true });
  const cP = sectionProgress(curSec, dp({ curtain: { present: ["Divider curtain", PIPES_LABEL] } }), { tier1Done: true });
  ok(cB.done === cA.done + 1 && cB.total === cA.total && cP.total === cA.total + 1, "#344 B4: progress counts curtain rows, and the pipes qty only when its chip is ticked");
  const lA = sectionProgress(litSec, dp({ lighting: { present: ["House lighting"] } }), { tier1Done: true });
  const lB = sectionProgress(litSec, dp({ lighting: { present: ["House lighting"], positionList: ["FOH 1"], positionRows: { "FOH 1": { circuits: "6" } } } }), { tier1Done: true });
  ok(lB.done === lA.done + 2 && lB.total === lA.total + 1, "#344 B4: progress counts the lighting positions and, once picked, their rows");
  const nA = sectionProgress(curSec, dp({ curtain: { present: ["None"], scope: ["Flame test"] } }), { tier1Done: true });
  ok(nA.total === 3 && nA.done === 2, "#344 B4: with Present = None only, progress counts just scope, goals and Present");

  /* B5: travel pre-fill, access fields, beams drawing gate, Final questions */
  ok(JSON.stringify(acceptTravel({ source: "manual", minutes: 35, miles: 22.4 })) === JSON.stringify({ min: 35, miles: 22.4 }) &&
     JSON.stringify(acceptTravel({ source: "routed", minutes: 80, miles: 61 })) === JSON.stringify({ min: 80, miles: 61 }),
    "#344 B5: acceptTravel keeps a manual or routed estimate");
  ok(acceptTravel({ source: "auto", minutes: 35, miles: 22 }) === null && acceptTravel({ source: "none", minutes: null, miles: null }) === null,
    "#344 B5: acceptTravel rejects auto (straight-line) and none estimates");
  ok(acceptTravel({ source: "routed", minutes: null, miles: 22 }) === null && acceptTravel({ source: "manual", minutes: 35, miles: null }) === null &&
     acceptTravel({ source: "routed", minutes: Number.NaN, miles: 22 }) === null,
    "#344 B5: acceptTravel rejects a missing or non-finite minutes / miles");
  const ctlB5 = rd("src/app/(app)/venue-assessments/[id]/controls.tsx");
  const pageB5 = rd("src/app/(app)/venue-assessments/[id]/page.tsx");
  const actsB5 = rd("src/app/(app)/venue-assessments/[id]/actions.ts");
  const fieldsB5 = rd(`${b3dir}/fields.tsx`);
  const travelSrv = rd("src/lib/survey-travel-server.ts");
  const siteSec = ctlB5.slice(ctlB5.indexOf('id: "site"'), ctlB5.indexOf('id: "lifeSafety"'));
  ok(siteSec.length > 0 && ["loadingDock", "elevatorSize", "floorType", "accessDoorSize", "loadingDoorType", "loadingDoorLocation", "loadingDoorWH",
      "liftRequired", "liftType", "liftWorkingHeight", "liftSupplier", "workingHours", "firstImpressions"].every((k) => siteSec.includes(`key: "${k}"`)),
    "#344 B5: Site access carries the loading door type / location / W × H and the lift fields");
  ok(!["liftNeeded", "loadingDoorSize", "liftHeight"].some((k) => siteSec.includes(`key: "${k}"`)),
    "#344 B5: the old liftNeeded / loadingDoorSize / liftHeight fields are gone from Site access");
  ok(siteSec.includes('{ kind: "textarea", key: "pathToFloor", label: "Path: truck → floor"') && siteSec.includes("LOADING_DOOR_TYPES") && siteSec.includes("LIFT_TYPES"),
    "#344 B5: Path: truck → floor is a textarea; door type and lift type use the fixed lists");
  ok(/showLiftDetails\(draft\)/.test(siteSec) && ["Loading door type", "Loading door location", "Loading door W × H", "Lift needed?", "Lift type", "Working height", "Who supplies lift"].every((l) => siteSec.includes(`label: "${l}"`)),
    "#344 B5: Lift type, Working height and Who supplies lift show only when a lift is needed (B-final: or one of them holds a value)");
  ok(["loadingDoorType", "loadingDoorLocation", "loadingDoorWH", "liftRequired", "liftType", "liftWorkingHeight"].every((k) =>
      actsB5.includes(`| "${k}"`) && ctlB5.includes(`${k}: draft.${k}`) && ctlB5.includes(`${k}: r.${k}`)),
    "#344 B5: the new access keys are in SurveyPatch, toDraft and buildPatch");
  ok(fieldsB5.includes('f.kind === "choice"') && fieldsB5.includes("aria-pressed") && fieldsB5.includes('f.kind === "note"') && fieldsB5.includes("f.hint"),
    "#344 B5: the field renderer gains a value/label choice, a note line and a hint under a text field");
  const beamsB5 = ctlB5.slice(ctlB5.indexOf("beamFields"), ctlB5.indexOf('id: "m3d"'));
  ok(beamsB5.includes("hasCounterweight(draft)") && beamsB5.includes("structuralDrawingOnFile") && beamsB5.includes("brickDrawingOnFile") &&
     beamsB5.includes("cwElevationOnFile") && beamsB5.includes("The structural drawing covers the beam measurements."),
    "#344 B5: the Beams builder gates the brick / CW drawings on counterweight and hides measurements when the structural drawing is on file");
  ok(ctlB5.includes('id: "finalQuestions", title: "Final questions", subtitle: "Last things to settle before you leave"') &&
     ctlB5.includes('key: "replaceVsReuse", label: "Replace vs. reuse (curtains)"') && ctlB5.includes("REPLACE_VS_REUSE_OPTIONS") && /disc: "curtain"/.test(ctlB5),
    "#344 B5: Final questions holds Replace vs. reuse (curtains), written to disciplines.curtain");
  ok(travelSrv.includes("acceptTravel(") && travelSrv.includes("venueAddressState(") && travelSrv.includes("getSiteByDocLocId(") &&
     travelSrv.includes("officesFromSettings()") && /catch\s*\{\s*return null;/.test(travelSrv) && /!== "verified"\) return null/.test(travelSrv),
    "#344 B5: the travel lookup needs a verified venue address, uses acceptTravel and never throws");
  ok(pageB5.includes("surveyTravelSuggestion(") && pageB5.includes("travelSuggestion={travelSuggestion}") && ctlB5.includes("toDraft(record, travelSuggestion)") &&
     ctlB5.includes("travelTimeText(") && ctlB5.includes("distanceText(") && ctlB5.includes("From the venue's verified address"),
    "#344 B5: the page passes the suggestion; toDraft fills blank Travel time / Distance and the hint shows while it matches");
  ok(sectionVisible({ scope: ["rigging"] }, "finalQuestions") === false && sectionVisible({ scope: ["curtain"] }, "finalQuestions") === true,
    "#344 B5: Final questions shows only with curtains in scope");
  ok(/\{meetingsSlot\}\s*\{visibleSections\.map\(/.test(ctlB5), "#344 B5: the meetings slot still sits right before the sections");
  {
    /* a cleared access / track-operation answer stays cleared; the old answer stays visible as an Older note */
    const L = "Kind of lift needed (before #344)";
    const lc = mm({ liftNeeded: "Scissor lift", liftRequired: "" } as MigratableSurvey);
    ok(lc.liftRequired === "" && hasNote(lc, "site", L, "Scissor lift"), "#344 B5: a cleared Lift needed? stays cleared and the old lift answer shows as an Older note");
    const lc2 = mm(lc);
    ok(lc2.liftRequired === "" && notes(lc2).filter((n) => n.label === L).length === 1, "#344 B5: the cleared Lift needed? migration is idempotent");
    const lt = mm({ liftNeeded: "Scaffold", liftRequired: "yes", liftType: "" } as MigratableSurvey);
    ok(lt.liftType === "" && hasNote(lt, "site", L, "Scaffold"), "#344 B5: a cleared Lift type stays cleared and the old answer shows as an Older note");
    const ln = mm({ liftNeeded: "None needed", liftRequired: "" } as MigratableSurvey);
    ok(ln.liftRequired === "" && hasNote(ln, "site", L, "None needed"), "#344 B5: a cleared Lift needed? is not refilled from None needed");
    const dc = mm({ loadingDoorSize: "Rear dock 10x12", loadingDoorLocation: "" } as MigratableSurvey);
    const dl = "Loading door location & W × H (before #344)";
    ok(dc.loadingDoorLocation === "" && hasNote(dc, "site", dl, "Rear dock 10x12") && mm(dc).loadingDoorLocation === "" && notes(mm(dc)).filter((n) => n.label === dl).length === 1,
      "#344 B5: a cleared Loading door location stays cleared (twice) and the old text shows as an Older note");
    const nv = mm({ loadingDoorSize: "Rear dock 10x12", liftNeeded: "Scaffold" } as MigratableSurvey);
    ok(nv.loadingDoorLocation === "Rear dock 10x12" && nv.liftRequired === "yes" && nv.liftType === "Scaffolding" && notes(nv).length === 0,
      "#344 B5: never-answered access keys still fill from the old fields");
    const tc = mm({ disciplines: { curtain: { operation: "SL", trackOperation: "" } } } as MigratableSurvey);
    ok(tc.disciplines?.curtain?.trackOperation === "" && hasNote(tc, "dCurtain", "Operation (before #344)", "SL") && mm(tc).disciplines?.curtain?.trackOperation === "",
      "#344 B5: a cleared Track operation stays cleared and the auditorium Operation shows as an Older note");
    const tn = mm({ disciplines: { curtain: { operation: "SR" } } } as MigratableSurvey);
    ok(tn.disciplines?.curtain?.trackOperation === "SR" && !hasNote(tn, "dCurtain", "Operation (before #344)"), "#344 B5: a never-answered Track operation still takes the auditorium SL / SR");
  }

  /* ---- B6: quantity-first line set schedule ---- */
  {
    const mk = (pos: string, over: Partial<LinesetRow> = {}): LinesetRow => ({ ...blankLinesetRow(1), pos, ...over });
    const emptyRow = mk("2");
    ok(rowIsEmpty(emptyRow) && !rowIsEmpty(mk("2", { setName: "Main" })) && !rowIsEmpty(mk("2", { condition: 0 })) && !rowIsEmpty(mk("2", { type: "O" })),
      "#344 B6: rowIsEmpty — blank except the set number is empty; any value, type or condition (even 0) is not");
    const grown = linesetQuantityPlan([], 4);
    ok(grown.rows.map((r) => r.pos).join(",") === "1,2,3,4" && grown.dropped.length === 0 && new Set(grown.rows.map((r) => r.id)).size === 4,
      "#344 B6: quantity 4 on an empty schedule makes sets 1–4 with distinct ids");
    const base = [mk("1", { setName: "Main" }), mk("2"), mk("3", { notes: "bent" })];
    const bigger = linesetQuantityPlan(base, 5);
    ok(bigger.rows.length === 5 && bigger.rows[0].id === base[0].id && bigger.rows[2].id === base[2].id && bigger.rows[4].pos === "5",
      "#344 B6: growing keeps existing rows (same ids) and appends blanks");
    const shrinkEmpty = linesetQuantityPlan(base, 1);
    ok(shrinkEmpty.rows.length === 1 && shrinkEmpty.dropped.length === 1 && shrinkEmpty.dropped[0].pos === "3",
      "#344 B6: shrinking returns only the rows with data in dropped (the empty set 2 goes silently)");
    const shrinkSilent = linesetQuantityPlan(base.slice(0, 2).concat(mk("3")), 2);
    ok(shrinkSilent.rows.length === 2 && shrinkSilent.dropped.length === 0, "#344 B6: shrinking past only empty sets drops them silently");
    const again = linesetQuantityPlan(bigger.rows, 5);
    ok(again.rows.every((r, i) => r.id === bigger.rows[i].id) && again.rows.length === 5, "#344 B6: re-running the same quantity is stable (ids unchanged)");
    const zero = linesetQuantityPlan(base, 0);
    ok(zero.rows.length === 0 && zero.dropped.length === 2, "#344 B6: quantity 0 clears the table and lists the sets with data");
    const odd = [mk("2", { setName: "B" }), mk("1", { setName: "A" }), mk("Ext", { setName: "X" })];
    const oddPlan = linesetQuantityPlan(odd, 3);
    ok(oddPlan.rows.map((r) => r.pos).join(",") === "1,2,3,Ext" && oddPlan.rows[0].setName === "A" && oddPlan.rows[1].id === odd[0].id && oddPlan.rows[3].id === odd[2].id,
      "#344 B6: rows sort by set number, a non-numeric set stays (shown last) and is never dropped");
    ok(linesetQuantityPlan(odd, 0).rows.map((r) => r.pos).join(",") === "Ext" && clampLinesetQty(999) === 200 && clampLinesetQty(-3) === 0 && clampLinesetQty(Number.NaN) === 0 && clampLinesetQty(3.9) === 3,
      "#344 B6: a quantity of 0 still keeps a non-numeric set; the quantity clamps to 0–200");

    const fd = [mk("1", { type: "L", condition: 3 }), mk("2", { type: "B" }), mk("3")];
    const filled = fillDown(fd, fd[0].id, "type");
    ok(filled[0].type === "L" && filled[1].type === "L" && filled[2].type === "L" && filled[1].id === fd[1].id && fd[1].type === "B",
      "#344 B6: Fill down copies the column below the focused row without touching the input");
    const filledCond = fillDown(fd, fd[0].id, "condition");
    ok(filledCond[2].condition === 3 && filledCond[0].condition === 3, "#344 B6: Fill down also copies the Condition level");
    const cleared = fillDown([mk("1"), mk("2", { condition: 2 })], fd[0].id + "x", "condition");
    ok(cleared[1].condition === 2, "#344 B6: Fill down from an unknown row changes nothing");

    const gapped = [mk("1", { setName: "A" }), mk("2", { setName: "B" }), mk("3", { setName: "C" }), mk("12", { setName: "Twelve", notes: "keep me" })];
    const added = addMissingSets(gapped, 4);
    ok(added.length === 5 && added.map((r) => r.pos).join(",") === "1,2,3,4,12" && gapped.every((g) => added.some((r) => r.id === g.id && r.setName === g.setName)) &&
       added.find((r) => r.pos === "12")?.notes === "keep me" && rowIsEmpty(added.find((r) => r.pos === "4") as LinesetRow),
      "#344 B6 fix: Add the missing sets adds blanks only — row 12 with data stays, existing ids unchanged");
    ok(addMissingSets(added, 4).length === 5 && addMissingSets([], 0).length === 0 && addMissingSets([mk("Ext", { setName: "X" })], 2).map((r) => r.pos).join(",") === "1,2,Ext",
      "#344 B6 fix: Add the missing sets is stable when nothing is missing and keeps non-numeric sets");

    const fi = [mk("1", { type: "L" }), mk("2", { type: "B" }), mk("3", { type: "L" }), mk("4")];
    ok(fillDownImpact(fi, fi[0].id, "type") === 1 && fillDownImpact(fi, fi[1].id, "type") === 1 && fillDownImpact(fi, fi[3].id, "type") === 0 && fillDownImpact(fi, "nope", "type") === 0,
      "#344 B6 fix: fillDownImpact counts filled cells that differ from the source (blank cells and equal values are free)");
    const blankSrc = [mk("1"), mk("2", { type: "B" }), mk("3", { type: "D" }), mk("4")];
    ok(fillDownImpact(blankSrc, blankSrc[0].id, "type") === 2, "#344 B6 fix: a blank source counts the filled cells it would blank");
    const cs = [mk("1", { condition: 3 }), mk("2", { condition: 3 }), mk("3", { condition: 1 }), mk("4")];
    ok(fillDownImpact(cs, cs[0].id, "condition") === 1 && fillDownImpact(cs, cs[2].id, "condition") === 0, "#344 B6 fix: fillDownImpact reads Condition levels (0 counts as filled)");

    ok(formatSetRanges(["14", "12", "13", "20", "Ext"]) === "12–14, 20, Ext" && formatSetRanges(["5"]) === "5" && formatSetRanges([]) === "",
      "#344 B6: the removal prompt lists set numbers as ranges");
    const sp = [mk("1"), mk("2", { type: "D" }), mk("3"), mk("4"), mk("Ext")];
    const marked = markSpare(sp, 1, 4);
    ok(marked.rows[0].type === "O" && marked.rows[1].type === "D" && marked.rows[2].type === "O" && marked.rows[3].type === "O" && marked.rows[4].type === "" && marked.skipped.join(",") === "2",
      "#344 B6: Mark range spare sets Open / spare on untyped sets and reports the typed ones it skipped");
    const swapped = markSpare(sp, 4, 3);
    ok(swapped.rows[2].type === "O" && swapped.rows[3].type === "O" && swapped.rows[0].type === "" && swapped.skipped.length === 0,
      "#344 B6: Mark range spare accepts the range in either order");
  }
  const lsTsx = readFileSync(join(process.cwd(), "src/app/(app)/venue-assessments/[id]/sections/linesets.tsx"), "utf8");
  ok(lsTsx.includes("rowIsEmpty(") && lsTsx.includes("requestRemove(row)") && !lsTsx.includes("onClick={() => onRemove(row.id)}"),
    "#344 B6: removing a line set row that holds data asks first (rowIsEmpty gates the immediate remove)");

  /* ---- B7: goals as lists downstream; field sheet, findings and Assist print the new fields ---- */
  {
    const gls = goalListsFromSurvey({ disciplines: { rigging: { goals: "- Safer rail\n• Quieter\n" }, av: { goals: [" Stream it ", "", "Clear mics"] }, curtain: { goals: [] }, lighting: { goals: "  " } } });
    ok(JSON.stringify(gls) === '{"rigging":["Safer rail","Quieter"],"av":["Stream it","Clear mics"]}',
      "#344 B7: goalListsFromSurvey cleans lists, splits old goal text one per line, and leaves out disciplines with none");
    const glLong = goalListsFromSurvey({ disciplines: { av: { goals: ["a".repeat(600), "b".repeat(600)] } } });
    ok(glLong.av!.length === 1 && glLong.av![0].length === 600, "#344 B7: goal lists keep the save sanitizer's 1,000-character joined rule");
    ok(goalsFromSurvey({ disciplines: { av: { goals: ["Stream it", "Clear mics"] } } }).av === "Stream it\nClear mics", "#344 B7: goalsFromSurvey still joins a list with newlines");
    const rcl = recapFor({ scope: ["av"], disciplines: { av: { goals: [" Stream it ", "Clear mics"] } } });
    ok(rcl.length === 1 && rcl[0].goals.join("|") === "Stream it|Clear mics", "#344 B7: the recap reads goal lists");
    ok(splitGoalLines === (await import("../src/lib/estimate-output/goals")).splitGoalLines, "#344 B7: survey-flow re-exports splitGoalLines from goals.ts");

    ok(curtainItemText({ qty: "4", fabric: "Velour", oz: "25", trackSeries: "Standard", w: "40", h: "22", condition: 3 }) === "qty 4 · Velour 25 oz · Standard track · 40' × 22' · Good",
      "#344 B7: a curtain row reads qty · fabric oz · track · W × H · condition");
    ok(curtainItemText({ fabric: "IFR Velour", trackSeries: "N/A", w: "40'-6\"" }) === "IFR Velour · W 40'-6\"" && curtainItemText({}) === "",
      "#344 B7: a curtain row skips empty parts and N/A, and keeps typed units");
    ok(positionRowLine("Electric 1", { circuits: "24", length: "40", trim: "22", notes: "needs  new cable" }) === "Electric 1 · 24 circuits · 40' · trim 22' · needs new cable",
      "#344 B7: a lighting position row reads position · circuits · length · trim · notes");
    ok(monthText("2024-03") === "Mar 2024" && monthText("3/2024") === "Mar 2024" && monthText("spring") === "spring" && monthText(undefined) === "",
      "#344 B7: month fields print as Mar 2024 (unreadable text as typed)");

    const b7 = {
      ...(sheetBase as object),
      venueClass: "auditorium",
      measurements: { gridH: "58'" },
      loadingDoorType: "Roll-up / overhead", loadingDoorLocation: "Dock B", loadingDoorWH: "10' × 12'",
      liftRequired: "yes", liftType: "Scissor >20ft", liftWorkingHeight: "32'", liftSupplier: "Peak", pathToFloor: "Ramp to stage",
      loadingDoorSize: "OLD-DOOR", liftNeeded: "Scaffold", liftHeight: "OLD-HEIGHT",
      scope: ["rigging", "curtain", "lighting", "av"],
      disciplines: {
        rigging: { gridHeight: "OLD-GRID", scope: ["New grid"] },
        curtain: {
          present: ["Main / act curtain", "Legs"],
          items: {
            "Main / act curtain": { qty: "4", fabric: "Velour", oz: "25", trackSeries: "Standard", w: "40", h: "22", condition: 3 },
            Borders: { qty: "9", fabric: "Unticked" },
          },
          lastFlameTest: "2024-03", replaceVsReuse: "Reuse", scope: ["Flame test", "Other"], scopeOther: "Re-hang the teaser",
          goals: ["Even wash", "Quieter tracks"],
        },
        lighting: {
          consoleLocation: "Other", consoleLocationOther: "Balcony rail", plugType: "Stage-pin",
          positionList: ["FOH 1", "Electric 1"], positionRows: { "Electric 1": { circuits: "24", length: "40", trim: "22", notes: "needs new cable" } },
        },
        av: { conditionLevel: 2 },
      },
      linesets: [{ ...blankLinesetRow(1), setName: "Border 1", condition: 1, cond: "G" }, { ...blankLinesetRow(2), setName: "Legs 1", cond: "F" }],
      legacyNotes: [],
      internalTags: ["tg_price_sensitive"],
    } as never;
    const sh7 = buildAssessmentSheet(b7);
    const secs7 = sh7.fieldSheet!.pages.flatMap((p) => p.sections);
    const sec = (h: string) => secs7.find((x) => x.heading === h)!;
    const val = (h: string, label: string) => sec(h)?.rows.find((r) => r.label === label)?.value;
    ok(sec("Site access").rows.slice(0, 8).map((r) => `${r.label}=${r.value}`).join("|") ===
      "Loading door type=Roll-up / overhead|Loading door location=Dock B|Loading door W × H=10' × 12'|Lift needed=Yes|Lift type=Scissor >20ft|Working height=32'|Who supplies lift=Peak|Path to floor=Ramp to stage",
      "#344 B7: Site access prints the loading door and lift answers first, then Path to floor");
    ok(!JSON.stringify(sec("Site access")).includes("OLD-"), "#344 B7: a migrated record (legacyNotes set) never prints the old access keys again");
    ok(val("Rigging intake", "Grid height") === "58'", "#344 B7: a bound field prints its measurement value");
    ok(val("Curtain intake", "Main / act curtain") === "qty 4 · Velour 25 oz · Standard track · 40' × 22' · Good" && val("Curtain intake", "Legs") === "" &&
       !sec("Curtain intake").rows.some((r) => r.label === "Borders"),
      "#344 B7: one curtain row per ticked type (blank write-in when empty); an unticked type's stored row doesn't print");
    ok(val("Curtain intake", "Last flame test") === "Mar 2024", "#344 B7: month fields print as Mar 2024 on the sheet");
    ok(val("Curtain intake", "Replace vs. reuse (curtains)") === "Reuse", "#344 B7: the Final questions Replace vs. reuse prints with the curtains");
    ok(val("Curtain intake", "Curtain scope of interest") === "Flame test, Other: Re-hang the teaser", "#344 B7: scope prints with Other's text");
    ok(val("Curtain intake", "Client goals") === "Even wash; Quieter tracks", "#344 B7: discipline goals print as a ; list");
    ok(val("Lighting intake", "Console location") === "Other: Balcony rail" && val("Lighting intake", "Plug type") === "Stage-pin",
      "#344 B7: console location prints Other's text; plug type prints");
    const litRows = sec("Lighting intake").rows.map((r) => r.label);
    ok(val("Lighting intake", "Electric 1") === "24 circuits · 40' · trim 22' · needs new cable" && val("Lighting intake", "FOH 1") === "" &&
       litRows.indexOf("Electric 1") < litRows.indexOf("FOH 1"),
      "#344 B7: one row per chosen lighting position, in the editor's order");
    ok(val("AV intake", "Condition") === "Fair", "#344 B7: a condition field prints its label");
    const lsRows = sec("Linesets").rows;
    ok(lsRows[0].value.includes("Poor") && !lsRows[0].value.includes("Good") && lsRows[1].value.includes(linesetCondLabel("F")),
      "#344 B7: a line set's condition level prints, else the old code's label");
    ok(!JSON.stringify(sh7).includes("tg_price_sensitive") && !JSON.stringify(sh7).includes("[object Object]"), "#344 B7: no internal tags or raw objects on the sheet");

    const oldOnly = buildAssessmentSheet({ ...(sheetBase as object), legacyNotes: undefined, loadingDoorSize: "8' × 10' at dock", liftNeeded: "Scissor lift", liftHeight: "30'", liftSupplier: "Sunbelt" } as never);
    const oldAccess = oldOnly.fieldSheet!.pages.flatMap((p) => p.sections).find((x) => x.heading === "Site access")!.rows;
    const ov = (l: string) => oldAccess.find((r) => r.label === l)?.value;
    ok(ov("Loading door location") === "8' × 10' at dock" && ov("Lift needed") === "Yes" && ov("Lift type") === "Scissor lift" && ov("Working height") === "30'" && ov("Who supplies lift") === "Sunbelt",
      "#344 B7: an unmigrated old survey still prints its access answers from the old keys");
    const noneNeeded = buildAssessmentSheet({ ...(sheetBase as object), legacyNotes: undefined, liftNeeded: "None needed" } as never);
    const nn = noneNeeded.fieldSheet!.pages.flatMap((p) => p.sections).find((x) => x.heading === "Site access")!.rows;
    ok(nn.find((r) => r.label === "Lift needed")?.value === "No" && !nn.some((r) => r.label === "Lift type"), "#344 B7: old None needed prints Lift needed No (and, B-final, no lift details)");

    const fx7 = surveyFindings(b7);
    ok(fx7.includes("Access/logistics: loading door: Roll-up / overhead, Dock B, 10' × 12'; lift: Yes — Scissor >20ft, working height 32' (Peak)"),
      "#344 B7: the findings access line reads the new loading door + lift answers");
    ok(surveyFindings({ liftRequired: "no", liftType: "Scissor >20ft", liftSupplier: "Peak" } as never) === "Access/logistics: lift: No",
      "#344 B7: findings say lift: No without the details");
    ok(surveyFindings({ loadingDoorSize: "8x10", liftNeeded: "Scissor", liftSupplier: "Sunbelt" } as never) === "Access/logistics: loading door: 8x10; lift: Scissor (Sunbelt)",
      "#344 B7: findings fall back to the old access keys when the new ones are empty");
    ok(!fx7.includes("tg_price_sensitive"), "#344 B7: internal tags never reach the findings");

    const st7 = surveyText(b7);
    ok(st7.includes("  - Main / act curtain: qty 4 · Velour 25 oz · Standard track · 40' × 22' · Good") && !st7.includes("Unticked"),
      "#344 B7: Assist's site-visit text carries each ticked curtain row");
    ok(st7.includes("  - Electric 1 · 24 circuits · 40' · trim 22' · needs new cable") && st7.includes("  - Condition: Fair") && st7.includes("  - Last flame test: Mar 2024"),
      "#344 B7: Assist's text carries lighting position rows, the AV condition label and month fields");
    ok(!st7.includes("[object Object]") && !st7.includes("tg_price_sensitive"), "#344 B7: no raw objects or internal tags in Assist's text");
    const many: Record<string, unknown> = { present: Array.from({ length: 60 }, (_, i) => `Type ${i}`), items: {} };
    for (let i = 0; i < 60; i++) { many[`f${i}`] = `v${i}`; (many.items as Record<string, unknown>)[`Type ${i}`] = { qty: String(i + 1) }; }
    const stMany = surveyText({ id: "FS-B7", disciplines: { curtain: many } } as never);
    ok(stMany.split("\n").filter((l) => l.startsWith("  - ")).length === 40, "#344 B7: Assist's discipline lines stay within their 40-line budget");

    /* Fix 1: a cleared field stays cleared in print, Assist and the condition sliders; the pipes row follows its chip */
    const clearedBound = { ...(b7 as object), measurements: { gridH: "" }, disciplines: { rigging: { gridHeight: "OLD" } } } as never;
    const cbRows = buildAssessmentSheet(clearedBound).fieldSheet!.pages.flatMap((p) => p.sections).find((x) => x.heading === "Rigging intake")!.rows;
    ok(cbRows.find((r) => r.label === "Grid height")?.value === "" && !JSON.stringify(cbRows).includes("OLD"),
      "#344 B7 fix: a cleared bound field (measurement blank) never prints its old discipline value on the sheet");
    const stBound = surveyText(b7);
    ok(!stBound.includes("OLD-GRID") && !stBound.includes("gridHeight"),
      "#344 B7 fix: Assist skips a bound discipline key (the measurement is already in the findings)");
    const pipesRow = (present: string[], qty: string) => {
      const d = { ...(b7 as object), disciplines: { curtain: { present, fixedPipeQty: qty } } } as never;
      return buildAssessmentSheet(d).fieldSheet!.pages.flatMap((p) => p.sections).find((x) => x.heading === "Curtain intake")!.rows
        .filter((r) => r.value === qty && qty);
    };
    ok(pipesRow(["Legs"], "7").length === 0 && pipesRow(["Legs", PIPES_LABEL], "7").length === 1,
      "#344 B7 fix: the pipes qty row prints only when the pipes chip is ticked");

    /* cleared condition: null stays null through migrate and prints nothing */
    const clr = migrateSurvey(migrateSurvey({
      linesets: [{ id: "a", cond: "G", condition: null }, { id: "b", cond: "G" }],
      disciplines: { av: { condition: "Good", conditionLevel: null } },
    } as unknown as MigratableSurvey));
    const clrRows = clr.linesets as unknown as { condition?: number | null }[];
    ok(clrRows[0].condition === null && clrRows[1].condition === 3 && (clr.disciplines?.av as Record<string, unknown>).conditionLevel === null,
      "#344 B7 fix: a cleared (null) condition stays null through migrate, twice; an absent key still seeds");
    const clrSheet = buildAssessmentSheet({ ...(b7 as object), linesets: [{ ...blankLinesetRow(1), setName: "Border 1", cond: "G", condition: null }, { ...blankLinesetRow(2), setName: "Legs 1", cond: "G" }] } as never);
    const clrLs = clrSheet.fieldSheet!.pages.flatMap((p) => p.sections).find((x) => x.heading === "Linesets")!.rows;
    ok(!clrLs[0].value.includes(linesetCondLabel("G")) && clrLs[1].value.includes(linesetCondLabel("G")),
      "#344 B7 fix: a cleared line set condition prints no condition (the old code only shows when the key is absent)");
  }

  /* ---- B-final2: findings by label; a None-only discipline prints nothing else ---- */
  {
    const mig = {
      venueClass: "auditorium", legacyNotes: [], disciplines: { rigging: { present: ["Counterweight"] } },
      measurements: { brickDrawing: true, hhSheet: true, structuralDrawingOnFile: false, brickDrawingOnFile: true, gridH: "58'", proW: "40'", loadingBridge: true, midrail: "4'", stray: "x" },
    };
    const f1 = surveyFindings(mig as never);
    ok(!f1.includes("brickDrawing:") && !f1.includes("hhSheet") && !f1.includes("gridH") && !f1.includes("stray") && /  - Grid height[^:]*: 58'/.test(f1) && f1.includes("  - Proscenium width: 40'"),
      "#344 B-final2: findings for a migrated record print measurements by label, never the raw stored keys");
    ok(f1.includes("  - Brick drawing on file: Yes") && f1.includes("  - Loading bridge present: Yes") && f1.includes("  - Midrail height: 4'") && !f1.includes("Structural drawing on file") && !f1.includes("CW Elevation"),
      "#344 B-final2: checks print as Yes (off ones skipped); brick drawing shows with Counterweight, beams show with no structural drawing");
    const f2 = surveyFindings({ ...mig, measurements: { ...mig.measurements, structuralDrawingOnFile: true } } as never);
    ok(f2.includes("  - Structural drawing on file: Yes") && !f2.includes("Midrail") && !f2.includes("Loading bridge"), "#344 B-final2: a structural drawing on file hides the beam measurements from findings");
    const f3 = surveyFindings({ ...mig, disciplines: { rigging: { present: ["Dead-hung"] } } } as never);
    ok(!f3.includes("Brick drawing on file") && f3.includes("  - Midrail height: 4'"), "#344 B-final2: brick / CW drawings print only with a Counterweight rigging system");
    ok(surveyFindings({ measurements: { proW: "40'" } } as never) === "Measurements:\n  - proW: 40'", "#344 B-final2: an unmigrated record keeps the old key lines");

    const noneRec = {
      ...(sheetBase as object), venueClass: "auditorium", scope: ["lighting"], id: "FS-NONE",
      disciplines: { lighting: { present: ["None"], goals: ["Brighter"], scope: ["New fixtures"], consoleLocation: "Booth", positionList: ["FOH 1"], positionRows: { "FOH 1": { circuits: "12" } }, notes: "SECRET-NOTE" } },
    };
    const noneSheet = JSON.stringify(buildAssessmentSheet(noneRec as never).fieldSheet);
    ok(!noneSheet.includes("SECRET-NOTE") && !noneSheet.includes("Console location") && !noneSheet.includes("FOH 1") && noneSheet.includes("Brighter") && noneSheet.includes("New fixtures"),
      "#344 B-final2: a None-only discipline prints only goals, Present and scope on the sheet");
    const noneText = surveyText(noneRec as never);
    ok(!noneText.includes("SECRET-NOTE") && !noneText.includes("Console location") && !noneText.includes("FOH 1") && noneText.includes("Present: None"),
      "#344 B-final2: a None-only discipline prints no console, positions or notes in Assist");
    const someRec = { ...noneRec, disciplines: { lighting: { ...(noneRec.disciplines.lighting as object), present: ["None", "Dimmers"] } } };
    ok(JSON.stringify(buildAssessmentSheet(someRec as never).fieldSheet).includes("SECRET-NOTE") && surveyText(someRec as never).includes("SECRET-NOTE"),
      "#344 B-final2: with anything besides None ticked, the discipline prints in full");
  }

  /* ---- B-final: whole-branch review fixes ---- */
  {
    const t = (label: string, fn: () => boolean) => {
      let pass = false;
      try { pass = fn(); } catch (err) { console.log("  threw: " + (err instanceof Error ? err.message : String(err))); }
      ok(pass, "#344 B-final: " + label);
    };
    const secsOf = (rec: unknown) => buildAssessmentSheet(rec as never).fieldSheet!.pages.flatMap((p) => p.sections);

    /* 1. findings never resurrect old access answers on a migrated record */
    t("findings read a migrated record's access only from the new keys (no old door, lift kind or lift height)", () => {
      const a = surveyFindings({ legacyNotes: [], liftNeeded: "Scissor OLDKIND", liftHeight: "OLD-H30", loadingDoorSize: "OLD-DOOR", liftRequired: "", liftSupplier: "" });
      const b = surveyFindings({ legacyNotes: [], liftRequired: "yes", liftType: "Scissor >20ft", liftHeight: "OLD-H30", liftWorkingHeight: "" });
      return !a.includes("OLD") && !a.includes("lift:") && b.includes("lift: Yes — Scissor >20ft") && !b.includes("OLD-H30");
    });
    t("findings of a migrated old survey print Lift needed Yes but never the old height as the working height", () => {
      const m = MGX.migrateSurvey({ liftNeeded: "Scissor lift", liftHeight: "30'" } as MigratableSurvey);
      const f = surveyFindings(m as never);
      return f.includes("lift: Yes") && !f.includes("30'") && !f.includes("Scissor lift");
    });

    /* 2. Assist reads only what the editor shows, plus Older notes */
    const oldRec = MGX.migrateSurvey({
      id: "FS-BF", venueClass: "auditorium", scope: ["curtain", "lighting", "av"],
      disciplines: {
        curtain: { present: ["Legs"], legsQtyPairs: "4", trackOperation: "Manual OLDOP", lastFlameTest: "spring OLDFLAME", scope: ["Flame test"],
          scopeOther: "UNTICKED-OTHER", fixedPipeQty: "PIPEQTY9", notes: "Curtain note", replaceVsReuse: "Reuse", junkKey: "JUNKVAL" },
        lighting: { consoleLocation: "Booth by the window", consoleLocationOther: "HIDDEN-OTHER", positionList: ["Electric 1"],
          positionRows: { "Electric 1": { circuits: "24" }, "FOH 2": { circuits: "UNTICKEDPOS" } } },
        av: { condition: "Good", conditionLevel: 1 },
      },
    } as unknown as MigratableSurvey);
    const stBF = surveyText(oldRec as never);
    t("Assist never prints removed or old keys as fields (legsQtyPairs, trackOperationOld, consoleLocationOld, lastFlameTestOld, AV condition text)", () =>
      !/legsQtyPairs|trackOperationOld|consoleLocationOld|lastFlameTestOld|junkKey|JUNKVAL/.test(stBF) && !/condition: Good/i.test(stBF));
    t("Assist skips an unticked Other's text, an Other text when the console isn't Other, an unticked pipes qty and unticked positions", () =>
      !stBF.includes("UNTICKED-OTHER") && !stBF.includes("HIDDEN-OTHER") && !stBF.includes("PIPEQTY9") && !stBF.includes("UNTICKEDPOS"));
    t("Assist prints the editor's fields by label: Present, curtain rows, scope, notes, console location, positions, AV condition", () =>
      stBF.includes("  - Present: Legs") && stBF.includes("  - Legs: qty 4") && stBF.includes("  - Curtain scope of interest: Flame test") &&
      stBF.includes("  - Notes: Curtain note") && stBF.includes("  - Replace vs. reuse (curtains): Reuse") && stBF.includes("  - Console location: Booth") &&
      stBF.includes("  - Electric 1 · 24 circuits") && stBF.includes("  - Condition: Poor"));
    t("Assist appends the record's Older notes (the old answers' text survives)", () =>
      stBF.includes("Older notes:") && stBF.includes("  - Track operation (before #344): Manual OLDOP") &&
      stBF.includes("  - Console location (before #344): Booth by the window") && stBF.includes("  - Last flame test (before #344): spring OLDFLAME"));

    /* 3. Fill down on Condition never resurrects an old rating */
    t("Fill down from an unrated row writes null Condition below, which stays null through migrate", () => {
      const r0 = { ...blankLinesetRow(1) };
      const r1 = { ...blankLinesetRow(2), cond: "G" as const, condition: 3 as const };
      const r2 = { ...blankLinesetRow(3), cond: "F" as const };
      const filled = LSX.fillDown([r0, r1, r2], r0.id, "condition");
      const mig = MGX.migrateSurvey({ linesets: filled } as unknown as MigratableSurvey).linesets as unknown as LinesetRow[];
      return filled[1].condition === null && "condition" in filled[2] && filled[2].condition === null && mig[1].condition === null && mig[2].condition === null &&
        LSX.fillDownImpact([r0, r1, r2], r0.id, "condition") === 2;
    });

    /* 4. Goals: the editor enforces the save's 1,000-character total */
    t("goalsBudgetLeft counts trimmed lines plus their newline joins, like the save sanitizer", () =>
      GLX.goalsBudgetLeft([]) === 1000 && GLX.goalsBudgetLeft(["a".repeat(10), "", "  ", " " + "b".repeat(5) + " "]) === 1000 - 16 &&
      GLX.goalsBudgetLeft(["a".repeat(700), "b".repeat(400)]) === 0);
    t("a goal input's maxLength is min(300, its length + the budget left) and never below its length", () => {
      const full = ["a".repeat(500), "b".repeat(499)];
      return GLX.goalMaxLength(full, 0) === 300 + 200 && GLX.goalMaxLength(["abc"], 0) === 300 && GLX.goalMaxLength(full.concat([""]), 2) === 0 &&
        GLX.goalMaxLength(["a".repeat(900), ""], 1) === 99 && GLX.goalMaxLength(["a".repeat(900), "xx"], 1) === 99;
    });
    const glTsx = rd("src/app/(app)/venue-assessments/[id]/sections/goals-list.tsx");
    t("the goals editor shows characters left and gates + Add goal / Enter on the budget", () =>
      glTsx.includes("characters left") && glTsx.includes("goalsBudgetLeft(") && glTsx.includes("goalMaxLength(") && !glTsx.includes("maxLength={300}"));

    /* 5. An unticked Other never prints */
    t("scopeText and the recap use Other's text only while Other is ticked", () => {
      const d = { scope: ["Flame test"], scopeOther: "Rehang" };
      const rc = recapFor({ scope: ["curtain"], disciplines: { curtain: d } });
      const rcNone = recapFor({ disciplines: { curtain: { scope: [], scopeOther: "Rehang" } } });
      return scopeText(d) === "Flame test" && scopeText({ scope: ["Other"], scopeOther: "Rehang" }) === "Other: Rehang" &&
        rc[0].other === "" && recapScopeText(rc[0]) === "Flame test" && rcNone.length === 0;
    });

    /* 6. Line sets in use turn the schedule on */
    const ctlBF = rd("src/app/(app)/venue-assessments/[id]/controls.tsx");
    t("linesetsInUse: a quantity above 0 or any row", () =>
      LSX.linesetsInUse([], 3) && LSX.linesetsInUse([blankLinesetRow(1)], 0) && !LSX.linesetsInUse([], 0) && !LSX.linesetsInUse([], undefined));
    t("the editor's line set apply path also sets linesetsEnabled", () => /const applyLinesets[\s\S]{0,400}linesetsInUse\([\s\S]{0,200}linesetsEnabled/.test(ctlBF));

    /* 7. Travel fills once */
    t("shouldAutoFillTravel fills a blank travel only while the record was never auto-filled", () => {
      const sug = { min: 30, miles: 20 };
      return FLX.shouldAutoFillTravel({ travelTime: "", distance: "" }, sug) && FLX.shouldAutoFillTravel({ travelTime: "35 min", distance: "" }, sug) &&
        !FLX.shouldAutoFillTravel({ travelTime: "", distance: "", travelAutoFilled: true }, sug) && !FLX.shouldAutoFillTravel({ travelTime: "", distance: "" }, null) &&
        !FLX.shouldAutoFillTravel({ travelTime: "35 min", distance: "20 mi" }, sug);
    });
    t("the editor stores travelAutoFilled (toDraft sets it when it fills; buildPatch and SurveyPatch carry it)", () =>
      /shouldAutoFillTravel\(/.test(ctlBF) && /travelAutoFilled: draft\.travelAutoFilled/.test(ctlBF) &&
      rd("src/app/(app)/venue-assessments/[id]/actions.ts").includes('| "travelAutoFilled"') && rd("src/lib/stores/surveys.ts").includes("travelAutoFilled?: true"));

    /* 8. Lift details */
    t("showLiftDetails: Lift needed yes, or any lift detail holds a value", () =>
      FLX.showLiftDetails({ liftRequired: "yes" }) && FLX.showLiftDetails({ liftRequired: "", liftSupplier: "Sunbelt" }) &&
      FLX.showLiftDetails({ liftRequired: "no", liftWorkingHeight: "30'" }) && !FLX.showLiftDetails({ liftRequired: "no" }) && !FLX.showLiftDetails({}));
    t("the editor's lift details follow showLiftDetails", () => /showLiftDetails\(draft\)/.test(ctlBF));
    t("migration: an old supplier with Lift needed never answered sets Lift needed yes (idempotent; a cleared one stays cleared)", () => {
      const a = MGX.migrateSurvey(MGX.migrateSurvey({ liftSupplier: "Sunbelt" } as MigratableSurvey));
      const b = MGX.migrateSurvey({ liftRequired: "", liftSupplier: "Sunbelt" } as MigratableSurvey);
      return a.liftRequired === "yes" && b.liftRequired === "" && MGX.migrateSurvey({} as MigratableSurvey).liftRequired === undefined;
    });
    t("the sheet skips Lift type / Working height / Who supplies lift when Lift needed is No", () => {
      const rows = secsOf({ ...(sheetBase as object), legacyNotes: [], liftRequired: "no", liftType: "Scissor >20ft", liftWorkingHeight: "30'", liftSupplier: "Peak" })
        .find((x) => x.heading === "Site access")!.rows.map((r) => r.label);
      const yes = secsOf({ ...(sheetBase as object), legacyNotes: [], liftRequired: "yes" }).find((x) => x.heading === "Site access")!.rows.map((r) => r.label);
      return rows.includes("Lift needed") && !rows.includes("Lift type") && !rows.includes("Working height") && !rows.includes("Who supplies lift") &&
        yes.includes("Lift type") && yes.includes("Who supplies lift");
    });

    /* 9. Engine codes are pinned */
    t("engine pick-list codes derived from the survey lists never change", () => {
      const pl = ASSESSMENT_DEF.pickLists;
      return pl.lift_type.map((o) => o.value).join("|") === "ladder_12ft|scaffolding|single_man_lift|scissor_20ft|scissor_40ft|scissor_50ft" &&
        pl.door_type.map((o) => o.value).join("|") === "roll_up_overhead|double_doors|single_door|dock_door|other" &&
        pl.lighting_position.map((o) => o.value).join("|") === "electric_1|electric_2|electric_3|electric_4|electric_5|foh_1|foh_2|foh_3|torms|balcony|other" &&
        (rd("src/lib/field-lists.ts").match(/Engine codes are derived from these labels — add new labels, never edit or remove one\./g) || []).length === 3;
    });

    /* 10. Print of unsaved edits; line set quantity seed */
    t("printRecordFor migrates the merged draft (the edits' notes show) and ignores an incoming legacyNotes", () => {
      const existing = MGX.migrateSurvey({ liftNeeded: "Scissor lift", legacyNotes: [] } as MigratableSurvey);
      const before = JSON.stringify(existing);
      const out = MGX.printRecordFor(existing, { liftRequired: "", legacyNotes: [{ section: "x", label: "BOGUS", text: "BOGUS" }] } as never);
      const labels = (out.legacyNotes || []).map((n) => n.label);
      return labels.includes("Kind of lift needed (before #344)") && !labels.includes("BOGUS") && JSON.stringify(existing) === before &&
        rd("src/app/(app)/venue-assessments/[id]/actions.ts").includes("buildAssessmentSheet(printRecordFor(existing, patch))");
    });
    t("the line set quantity seed counts only rows with a set number", () => {
      const a = MGX.migrateSurvey({ linesets: [{ id: "a", pos: "1" }, { id: "b", pos: "Ext" }, { id: "c", pos: "" }] } as unknown as MigratableSurvey);
      const b = MGX.migrateSurvey({ linesets: [{ id: "a", pos: "Ext" }], disciplines: { rigging: { linesetCount: "12" } } } as unknown as MigratableSurvey);
      return a.linesetQty === 1 && b.linesetQty === 12;
    });
  }

  // ─── C1: pure ink model ───
  {
    const INK = await import("../src/lib/ink/model");
    const mk = (id: string, pts: number[], width = 2, color = "#16181d"): import("../src/lib/ink/model").Stroke => ({ id, tool: "pen", color, width, pts });
    const line = [0, 0, 0.5, 5, 0.2, 0.5, 10, 0, 0.5, 20, 0, 0.9];
    const sp = INK.simplify(line);
    ok(sp.length === 6 && sp[0] === 0 && sp[3] === 20 && sp[2] === 0.5 && sp[5] === 0.9,
      "#344 C1: simplify keeps endpoints (with pressure) and drops collinear points");
    const bent = INK.simplify([0, 0, 1, 10, 10, 0.5, 20, 0, 1]);
    ok(bent.length === 9 && bent[2] === 1 && bent[5] === 0.5, "#344 C1: simplify keeps a corner point with its pressure");
    ok(INK.simplify([1, 2, 0.3]).length === 3 && INK.simplify([]).length === 0, "#344 C1: simplify handles 0/1 points");

    let d = INK.emptyInk(100, 80);
    d = INK.addStroke(d, mk("a", [10.3, 10.74, 1.7, 50, 10, -2]));
    ok(d.strokes.length === 1 && d.strokes[0].pts.join() === "10.5,10.5,1,50,10,0",
      "#344 C1: addStroke rounds x/y to 0.5 and clamps pressure to [0,1] at 2 decimals");
    ok(INK.addStroke(d, mk("bad", [1, 2])) === d && INK.addStroke(d, mk("bad", [1, 2, NaN])) === d,
      "#344 C1: addStroke ignores malformed pts");
    d = INK.addStroke(d, mk("b", [10, 40, 0.5, 50, 40, 0.5]));
    const hit = INK.eraseAt(d, 30, 12, 3);
    ok(hit.strokes.length === 1 && hit.strokes[0].id === "b", "#344 C1: eraseAt removes only the stroke within radius");
    ok(INK.eraseAt(d, 30, 25, 3) === d, "#344 C1: eraseAt returns the same doc on a miss");
    const dot = INK.addStroke(INK.emptyInk(10, 10), mk("dot", [5, 5, 0.5]));
    ok(INK.eraseAt(dot, 6, 5, 2).strokes.length === 0 && INK.eraseAt(dot, 9, 5, 2) === dot, "#344 C1: eraseAt works on a single-point stroke");

    // labels
    const lab = { id: "l1", x: 5.3, y: 6, text: "x".repeat(300), color: "#c0392b", size: 14 };
    const ld = INK.addLabel(INK.emptyInk(100, 100), lab);
    ok(ld.labels.length === 1 && ld.labels[0].text.length === INK.INK_CAPS.labelChars && ld.labels[0].x === 5.5,
      "#344 C1: addLabel trims text to 120 chars and rounds position");
    ok(INK.addLabel(ld, { ...lab, id: "l2", text: "   " }) === ld, "#344 C1: addLabel ignores blank text");
    const moved = INK.moveLabel(ld, "l1", 40, 41);
    ok(moved.labels[0].x === 40 && ld.labels[0].x === 5.5 && INK.moveLabel(ld, "nope", 1, 1) === ld, "#344 C1: moveLabel moves immutably; unknown id is a no-op");
    ok(INK.removeLabel(moved, "l1").labels.length === 0 && INK.removeLabel(moved, "z") === moved, "#344 C1: removeLabel");
    let full = INK.emptyInk(100, 100);
    for (let i = 0; i < 205; i++) full = INK.addLabel(full, { ...lab, id: "q" + i, text: "t" });
    ok(full.labels.length === INK.INK_CAPS.labels, "#344 C1: addLabel caps at 200 labels");
    ok(INK.clearInk(d).strokes.length === 0 && INK.clearInk(INK.emptyInk(1, 1)).labels.length === 0, "#344 C1: clearInk empties strokes and labels");

    // caps via parseInk
    const many = Array.from({ length: 5001 }, (_, i) => ({ id: "s" + i, tool: "pen", color: "#16181d", width: 2, pts: [i % 50, 1, 0.5, (i % 50) + 1, 2, 0.5] }));
    const capped = INK.parseInk({ v: 1, w: 10, h: 10, strokes: many, labels: [] });
    ok(!!capped && capped.strokes.length === 5000, "#344 C1: parseInk caps 5001 strokes to 5000");
    const mixed = INK.parseInk({
      v: 1, w: 10, h: 10, labels: [{ id: "x", x: 1, y: 1, text: "ok", color: "javascript:1", size: 10 }, { id: "y", x: NaN, y: 1, text: "bad", color: "#000", size: 10 }],
      strokes: [
        { id: "odd", tool: "pen", color: "#16181d", width: 2, pts: [1, 2, 0.5, 3] },
        { id: "nan", tool: "pen", color: "#16181d", width: 2, pts: [1, 2, NaN] },
        { id: "good", tool: "pen", color: "url(x)", width: 2, pts: [1, 2, 0.5, 3, 4, 0.5] },
        null, 7,
      ],
    });
    ok(!!mixed && mixed.strokes.length === 1 && mixed.strokes[0].id === "good" && mixed.strokes[0].color === "#16181d" &&
      mixed.labels.length === 1 && mixed.labels[0].color === "#16181d",
      "#344 C1: parseInk drops odd-length/NaN strokes and bad labels; non-hex colours fall back to ink");
    const bigPts = Array.from({ length: 3 * 100_000 }, (_, i) => (i % 3 === 2 ? 0.5 : i));
    const numCap = INK.parseInk({ v: 1, w: 10, h: 10, strokes: [0, 1, 2, 3, 4].map((i) => ({ id: "n" + i, tool: "pen", color: "#16181d", width: 2, pts: bigPts })), labels: [] });
    ok(!!numCap && numCap.strokes.length === 1, "#344 C1: parseInk enforces the 400,000-number cap (300k each → one stroke fits)");
    ok(INK.parseInk(null) === null && INK.parseInk(5) === null && INK.parseInk([]) === null && INK.parseInk("{nope") === null &&
      INK.parseInk({ v: 1, strokes: [] }) === null, "#344 C1: parseInk returns null for non-objects and size-less docs");

    // serialize round trip
    let rt = INK.emptyInk(300, 200);
    rt = INK.addStroke(rt, mk("r1", [1.25, 2, 0.333, 9, 9.9, 0.8, 30, 31, 1]));
    rt = INK.addLabel(rt, { id: "rl", x: 4, y: 5, text: "FOH", color: "#1f5f9a", size: 12 });
    const back = INK.parseInk(INK.serializeInk(rt));
    ok(!!back && JSON.stringify(back) === JSON.stringify(rt) && JSON.stringify(INK.parseInk(JSON.parse(INK.serializeInk(rt)))) === JSON.stringify(rt),
      "#344 C1: serialize → parse round trip is identical (string and object input)");

    // history
    const h = INK.createHistory(INK.emptyInk(50, 50));
    ok(!h.canUndo && !h.canRedo, "#344 C1: history starts with nothing to undo/redo");
    h.do({ t: "stroke", stroke: mk("h1", [1, 1, 0.5, 5, 5, 0.5]) });
    h.do({ t: "stroke", stroke: mk("h2", [10, 1, 0.5, 15, 5, 0.5]) });
    ok(h.current.strokes.length === 2 && h.canUndo && !h.canRedo, "#344 C1: history do applies ops");
    h.undo();
    ok(h.current.strokes.length === 1 && h.canRedo, "#344 C1: history undo steps back");
    h.redo();
    ok(h.current.strokes.length === 2 && !h.canRedo, "#344 C1: history redo steps forward");
    h.undo();
    h.do({ t: "label", label: { id: "hl", x: 1, y: 1, text: "A", color: "#16181d", size: 10 } });
    ok(!h.canRedo && h.current.labels.length === 1, "#344 C1: a new op after undo clears redo");
    const before = h.current;
    h.do({ t: "erase", x: 40, y: 40, radius: 1 });
    ok(h.current === before, "#344 C1: a no-op (erase miss) adds no history entry");
    h.do({ t: "clear" });
    ok(h.current.strokes.length === 0 && h.current.labels.length === 0, "#344 C1: clear op empties; undo restores");
    h.undo();
    ok(h.current.strokes.length === 1 && h.current.labels.length === 1, "#344 C1: undo after clear restores strokes and labels");
    const ch = INK.createHistory(INK.emptyInk(50, 50), 3);
    for (let i = 0; i < 6; i++) ch.do({ t: "stroke", stroke: mk("c" + i, [i, 1, 0.5, i + 2, 3, 0.5]) });
    let undone = 0;
    while (ch.canUndo) { ch.undo(); undone++; }
    ok(undone === 3 && ch.current.strokes.length === 3, "#344 C1: history cap keeps only the last 3 undo steps");

    // hardening: clamps, strict parse, code points, cap floor, prototype safety
    {
      const big = INK.emptyInk(1e300, 1e300);
      ok(big.w === 16384 && big.h === 16384 && INK.emptyInk(-5, 0.2).w === 1 && INK.emptyInk(NaN, 10).w > 0 && INK.emptyInk(NaN, 10).w <= 16384,
        "#344 C1: emptyInk clamps w/h to 1…16384 and defaults non-finite");
      const cs = INK.addStroke(INK.emptyInk(100, 100), mk("cw", [1, 1, 0.5, 5, 5, 0.5], 1e300));
      const cs2 = INK.addStroke(INK.emptyInk(100, 100), mk("cw2", [1, 1, 0.5, 5, 5, 0.5], 0.1));
      ok(cs.strokes[0]?.width === 64 && cs2.strokes[0]?.width === 0.5, "#344 C1: addStroke clamps width to 0.5…64");
      const cl = INK.addLabel(INK.emptyInk(100, 100), { id: "cl", x: 1, y: 1, text: "t", color: "#000", size: 1e300 });
      const cl2 = INK.addLabel(INK.emptyInk(100, 100), { id: "cl2", x: 1, y: 1, text: "t", color: "#000", size: 1 });
      ok(cl.labels[0]?.size === 200 && cl2.labels[0]?.size === 4, "#344 C1: addLabel clamps size to 4…200");
      const pc = INK.parseInk({ v: 1, w: 1e300, h: 0.001, labels: [{ id: "a", x: 1, y: 1, text: "t", color: "#000", size: 1e300 }],
        strokes: [{ id: "b", tool: "pen", color: "#000", width: 1e300, pts: [1, 1, 0.5, 2, 2, 0.5] }] });
      ok(!!pc && pc.w === 16384 && pc.h === 1 && pc.strokes[0].width === 64 && pc.labels[0].size === 200,
        "#344 C1: parseInk clamps w/h (1e300 → 16384), width (→ 64) and size (→ 200)");
      ok(INK.parseInk({ v: 99, w: 10, h: 10, strokes: [], labels: [] }) === null && !!INK.parseInk({ w: 10, h: 10 }) && !!INK.parseInk({ v: 1, w: 10, h: 10 }),
        "#344 C1: parseInk rejects v: 99, accepts v absent or 1");
      const dup = INK.parseInk({ v: 1, w: 10, h: 10,
        strokes: [{ id: "d", tool: "pen", color: "#000", width: 2, pts: [1, 1, 0.5] }, { id: "d", tool: "pen", color: "#000", width: 9, pts: [2, 2, 0.5] }],
        labels: [{ id: "L", x: 1, y: 1, text: "first", color: "#000", size: 10 }, { id: "L", x: 2, y: 2, text: "second", color: "#000", size: 10 }] });
      ok(!!dup && dup.strokes.length === 1 && dup.strokes[0].width === 2 && dup.labels.length === 1 && dup.labels[0].text === "first",
        "#344 C1: parseInk drops duplicate stroke/label ids (keeps the first)");
      const hx = (c: string) => INK.addStroke(INK.emptyInk(10, 10), mk("hx", [1, 1, 0.5, 2, 2, 0.5], 2, c)).strokes[0].color;
      ok(hx("#12345") === INK.INK_COLORS[0] && hx("#1234567") === INK.INK_COLORS[0] && hx("#123") === "#123" && hx("#1234") === "#1234" &&
        hx("#123456") === "#123456" && hx("#12345678") === "#12345678", "#344 C1: colours accept only 3, 4, 6 or 8 hex digits (#12345 rejected)");
      const em = "a".repeat(119) + "😀" + "tail";
      const el = INK.addLabel(INK.emptyInk(10, 10), { id: "em", x: 1, y: 1, text: em, color: "#000", size: 10 }).labels[0].text;
      const ep = INK.parseInk({ v: 1, w: 10, h: 10, labels: [{ id: "em", x: 1, y: 1, text: em, color: "#000", size: 10 }] })!.labels[0].text;
      const okText = (t: string) => Array.from(t).length === 120 && t.endsWith("😀") && !/[\ud800-\udbff]$/.test(t);
      ok(okText(el) && okText(ep), "#344 C1: label text truncates by code points (emoji at the 120 boundary not split)");
      const h0 = INK.createHistory(INK.emptyInk(50, 50), 0);
      h0.do({ t: "stroke", stroke: mk("z1", [1, 1, 0.5, 5, 5, 0.5]) });
      h0.do({ t: "stroke", stroke: mk("z2", [10, 1, 0.5, 15, 5, 0.5]) });
      ok(h0.canUndo && (h0.undo(), h0.current.strokes.length === 1) && !h0.canUndo, "#344 C1: createHistory cap 0 still allows exactly one undo");
      const before = (Object.prototype as Record<string, unknown>).polluted;
      const pj = INK.parseInk('{"v":1,"w":10,"h":10,"__proto__":{"polluted":"yes"},"strokes":[{"id":"p","tool":"pen","color":"#000","width":2,"pts":[1,1,0.5],"__proto__":{"polluted":"yes"}}],"labels":[]}');
      ok(!!pj && before === undefined && (Object.prototype as Record<string, unknown>).polluted === undefined && ({} as Record<string, unknown>).polluted === undefined,
        "#344 C1: a __proto__ key in JSON does not pollute Object.prototype");
      const budget = INK.parseInk({ v: 1, w: 10, h: 10, labels: [], strokes: [
        { id: "b1", tool: "pen", color: "#000", width: 2, pts: Array.from({ length: 3 * 100_000 }, (_, i) => (i % 3 === 2 ? 0.5 : i)) },
        { id: "b2", tool: "pen", color: "#000", width: 2, pts: Array.from({ length: 3 * 100_000 }, (_, i) => (i % 3 === 2 ? 0.5 : i)) },
        { id: "b3", tool: "pen", color: "#000", width: 2, pts: [1, 1, 0.5] }] });
      ok(!!budget && budget.strokes.map((x) => x.id).join() === "b1,b3", "#344 C1: parseInk skips an over-budget stroke but keeps later ones that fit");
    }

    // render against a fake ctx
    const calls: Array<[string, ...unknown[]]> = [];
    const widths: number[] = [];
    const fake = {
      strokeStyle: "" as unknown, fillStyle: "" as unknown, lineCap: "" as unknown, lineJoin: "" as unknown, font: "", textBaseline: "" as unknown,
      _lw: 0,
      get lineWidth() { return this._lw; },
      set lineWidth(v: number) { this._lw = v; },
      beginPath() { calls.push(["beginPath"]); },
      moveTo(x: number, y: number) { calls.push(["moveTo", x, y]); },
      lineTo(x: number, y: number) { calls.push(["lineTo", x, y]); },
      quadraticCurveTo(a: number, b: number, c: number, e: number) { calls.push(["quadraticCurveTo", a, b, c, e]); },
      stroke() { widths.push(this._lw); calls.push(["stroke"]); },
      fillText(t: string, x: number, y: number) { calls.push(["fillText", t, x, y, this.font, this.fillStyle]); },
    };
    let rd = INK.emptyInk(100, 100);
    rd = INK.addStroke(rd, mk("rs", [0, 0, 1, 10, 0, 1, 20, 10, 0, 30, 10, 0], 4, "#c0392b"));
    rd = INK.addLabel(rd, { id: "rl", x: 5, y: 6, text: "Hi", color: "#1f5f9a", size: 10 });
    INK.renderInk(fake, rd, 2);
    const names = calls.map((c) => c[0]);
    ok(names.includes("moveTo") && names.includes("quadraticCurveTo") && names.includes("lineTo") && names.includes("stroke") && names.includes("fillText"),
      "#344 C1: renderInk issues moveTo/quadraticCurveTo/lineTo/stroke/fillText");
    ok(widths.length === 3 && widths[0] === 4 * 2 * 1.5 && widths[1] === 4 * 2 * 1 && widths[2] === 4 * 2 * 0.5,
      "#344 C1: renderInk scales width × scale × (0.5 + p) per segment (" + widths.join(",") + ")");
    const ft = calls.find((c) => c[0] === "fillText")!;
    ok(ft[1] === "Hi" && ft[2] === 10 && ft[3] === 12 && ft[4] === "20px sans-serif" && ft[5] === "#1f5f9a" && fake.strokeStyle === "#c0392b" && fake.lineCap === "round",
      "#344 C1: renderInk draws labels at scaled position/size and strokes in colour with round caps");
    ok(typeof INK.inkId() === "string" && /^[0-9a-z]{8,10}$/.test(INK.inkId()) && INK.inkId() !== INK.inkId(), "#344 C1: inkId is short base-36 and unique");
  }
}

export async function vaNotesDbChecks(ok: Ok): Promise<void> {
  const { fixtureId, registerFixture } = await import("./test-fixtures");
  const { requestVisitForLead } = await import("../src/lib/stores/site-visits");
  const S = await import("../src/lib/stores/surveys");
  const { chicagoDayKey } = await import("../src/lib/drive-plan/day");
  const lead = (n: string) => ({ id: fixtureId(342, n), org: "VA fixture", contact: "Pat", email: "p@x.org", phone: "", address: "", city: "", state: "", customerId: null });

  const r1 = await requestVisitForLead(lead("lead-a"), { reason: "walk", timing: "", assignee: "Sam Surveyor" }, "Office Person");
  if (r1.ok) { registerFixture("site_visits", r1.visitId); registerFixture("surveys", r1.surveyId); }
  const s1 = r1.ok ? await S.get(r1.surveyId) : null;
  ok(!!s1 && s1.assignedTo === "Sam Surveyor" && s1.scheduledDate === chicagoDayKey(Date.now()) && s1.stage === "requested",
    "#344 A4: a lead's visit request pre-fills the survey with the visit's assignee and today; stage stays requested");

  const r2 = await requestVisitForLead(lead("lead-b"), { reason: "walk", timing: "", assignee: "  " }, "Office Person");
  if (r2.ok) { registerFixture("site_visits", r2.visitId); registerFixture("surveys", r2.surveyId); }
  const s2 = r2.ok ? await S.get(r2.surveyId) : null;
  ok(!!s2 && s2.assignedTo === "Office Person", "#344 A4: with no assignee the survey defaults to whoever requested it");

  /* R1/R2: clearing a scope stores no scope key, and a save never persists the derived legacyNotes */
  const { getDoc } = await import("../src/db/doc-store");
  const made = await S.create({ owner: "Sam Surveyor" } as never);
  registerFixture("surveys", made.id);
  await S.update(made.id, { scope: ["rigging"] } as never);
  await S.update(made.id, { scope: undefined } as never);
  const raw = (await getDoc("surveys", made.id)) as Record<string, unknown> | null;
  const back = await S.get(made.id);
  ok(!!raw && !("scope" in raw) && !("legacyNotes" in raw) && !!back && Array.isArray(back.legacyNotes),
    "#344 R1/R2: clearing scope leaves no scope key and a save never stores legacyNotes (get() still derives them)");
}

if (process.argv[1] && /test-va-notes\.ts$/.test(process.argv[1])) {
  let fail = 0;
  const ok: Ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  (async () => {
    await vaNotesChecks(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall va-notes checks passed");
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}
