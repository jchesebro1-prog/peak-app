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
import { tier1Items, tier1Complete, intakeStatus, DISCIPLINE_GROUPS, presentOptionsFor } from "../src/lib/stores/survey-intake";
import { BEAM_FIELDS } from "../src/lib/stores/surveys";
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
} from "../src/lib/field-lists";
import { ASSESSMENT_DEF, allQuestions } from "../src/lib/assessments/defs";

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
      lighting: { scope: [], scopeOther: "LED retrofit study" },
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
