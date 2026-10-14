/* Venue Assessment notes (#342) — harness checks. `vaNotesChecks` is pure; `vaNotesDbChecks` needs the test DB.
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

export async function vaNotesChecks(ok: Ok): Promise<void> {
  /* ---- Task 1: survey-flow ---- */
  ok(SECTION_ORDER.indexOf("tier1") === 2 && SECTION_ORDER[0] === "cust" && SECTION_ORDER[1] === "visit",
    "#342 A1: Kill questions come third, right after Customer & venue and Visit");
  ok(SECTION_ORDER.at(-1) === "assign" && SECTION_ORDER.indexOf("project") > SECTION_ORDER.indexOf("notes") &&
     SECTION_ORDER.indexOf("recap") > SECTION_ORDER.indexOf("project") && SECTION_ORDER.indexOf("finalThoughts") > SECTION_ORDER.indexOf("recap"),
    "#342 A1: wrap-up runs Scope & notes → Existing materials & quote → Customer recap → Final thoughts → Assignment (last)");
  ok(SECTION_ORDER.indexOf("m3d") === SECTION_ORDER.indexOf("mHouse") + 1 && SECTION_ORDER.indexOf("m3d") < SECTION_ORDER.indexOf("dRigging"),
    "#342 A1: the 3D preview is the last of the site information");
  ok(!SECTION_ORDER.includes("signoff") && !SECTION_ORDER.includes("conditions"), "#342 A6/A5: no Sign-off, no Site conditions section");
  ok(STEP_LABELS.join("|") === "Brief|Site & access|Measurements|Site intake|Assessment|Wrap-up", "#342 A1: wizard step labels");
  ok(SECTION_ORDER.every((id) => STEP_BY_ID[id] != null && GROUP_BY_ID[id] != null), "#342 A1: every section has a step and a group");
  ok(STEP_BY_ID.tier1 === 0 && STEP_BY_ID.assign === 5 && STEP_BY_ID.linesets === 3 && STEP_BY_ID.assessmentToggle === 4, "#342 A1: steps by id");
  ok(GROUP_BY_ID.tier1 === "brief" && GROUP_BY_ID.assign === "wrapup" && GROUP_META.wrapup.label === "Wrap-up", "#342 A1: groups by id");
  ok(RIG_SYSTEMS.join("|") === "Counterweight|Dead-hung|Motorized|Hemp|Fixed points|None", "#342 R3: rigging system options");

  ok(isQuoteVisit({ visitPurpose: "New system design" }) && !isQuoteVisit({ visitPurpose: "Bid walk" }) && !isQuoteVisit({}),
    "#342 A3: only New system design counts as a quote visit (Jeff, Q2)");

  ok(scopeSet({}) === null && scopeSet({ scope: [] }) === null && scopeSet({ scope: ["junk"] }) === null, "#342 R2: no known scope = unset");
  ok(JSON.stringify(scopeSet({ scope: ["av", "rigging", "x"] })) === '["rigging","av"]', "#342 R2: scope keeps known keys in canonical order");
  ok(inScope({}, "av") && inScope({ scope: ["av"] }, "av") && !inScope({ scope: ["rigging"] }, "av"), "#342 R2: unset scope filters nothing");

  const cw = { disciplines: { rigging: { present: ["Counterweight", "Motorized"] } } };
  ok(rigSystems(cw).join() === "Counterweight,Motorized" && hasCounterweight(cw) && hasLinesets(cw), "#342 R3: rig helpers read disciplines.rigging.present");
  ok(!hasLinesets({ disciplines: { rigging: { present: ["Fixed points"] } } }) && !hasCounterweight({}), "#342 R3: fixed points has no line sets");

  ok(sectionVisible({}, "dAv") && sectionVisible({}, "linesets"), "#342 R2: everything shows while scope is unset");
  ok(!sectionVisible({ scope: ["curtain"] }, "mBeams") && !sectionVisible({ scope: ["curtain"] }, "dRigging") && !sectionVisible({ scope: ["curtain"] }, "linesets"),
    "#342 R2: Beams, Rigging and Line sets need Rigging in scope");
  ok(!sectionVisible({ scope: ["rigging"] }, "mFOH") && sectionVisible({ scope: ["lighting"] }, "mFOH"), "#342 R2: FOH positions needs Lighting");
  ok(sectionVisible({ scope: ["rigging"] }, "mLayout") && sectionVisible({ scope: ["rigging"] }, "cust"), "#342 R2: unscoped sections always show");
  ok(!sectionVisible({ scope: ["rigging"], disciplines: { rigging: { present: ["None"] } } }, "linesets") &&
     sectionVisible({ scope: ["rigging"], disciplines: { rigging: { present: ["None"] } }, linesets: [{}] }, "linesets") &&
     sectionVisible({ scope: ["rigging"], disciplines: { rigging: { present: ["Hemp"] } } }, "linesets"),
    "#342 A1: Line set schedule hides for None / Fixed points unless rows exist");

  ok(JSON.stringify(splitGoalLines("- Fix the main\n• Add a cyc\n\n2. Quieter fly system  \nplain")) === '["Fix the main","Add a cyc","Quieter fly system","plain"]',
    "#342 A7: goal text splits on lines and drops bullets");
  ok(JSON.stringify(splitGoalLines([" a ", "", "b"])) === '["a","b"]' && splitGoalLines(undefined).length === 0, "#342 A7: goal arrays are trimmed");

  const rc = recapFor({
    scope: ["rigging", "lighting"],
    disciplines: {
      rigging: { scope: ["New grid"], goals: "Safer fly rail" },
      lighting: { scope: [], scopeOther: "LED retrofit study" },
      curtain: { scope: ["Flame test"] },
    },
  });
  ok(rc.map((e) => e.disc).join() === "rigging,lighting", "#342 A7: the recap lists in-scope disciplines only (curtain is out of scope)");
  ok(rc[0].label === "Rigging" && rc[0].scopes.join() === "New grid" && rc[0].goals.join() === "Safer fly rail" && rc[1].other === "LED retrofit study",
    "#342 A7: each entry carries scopes, Other text and goal lines");
  ok(recapFor({ disciplines: { curtain: { scope: ["Flame test"] }, av: {} } }).map((e) => e.disc).join() === "curtain",
    "#342 A7: with scope unset the recap lists disciplines that have scopes or goals");
  ok(recapScopeText(rc[1]) === "Other: LED retrofit study" && recapScopeText(rc[0]) === "New grid", "#342 A7: recap scope text");

  /* ---- Task 2: migration + Tier 1 ---- */
  const m = (s: MigratableSurvey) => migrateSurvey(JSON.parse(JSON.stringify(s)) as MigratableSurvey);
  const a1 = m({ measurements: { rigType: "Hemp" } });
  ok(JSON.stringify(a1.disciplines?.rigging?.present) === '["Hemp"]' && (a1.legacyNotes || []).length === 0,
    "#342 R3: an unanswered rigging system copies up from Beams' Existing rig type");
  const a2 = m({ measurements: { rigType: "None existing" }, disciplines: { rigging: { counterweight: true } } });
  ok(JSON.stringify(a2.disciplines?.rigging?.present) === '["Counterweight"]', "#342 R3: None drops out when another source names a system");
  const a3 = m({ conditions: ["Existing rigging — hemp", "Motorized hoists present", "Low grid clearance"] });
  ok(JSON.stringify(a3.disciplines?.rigging?.present) === '["Hemp","Motorized"]', "#342 R3: the old condition chips copy up");
  const a4 = m({ measurements: { rigType: "Hemp" }, disciplines: { rigging: { present: ["Counterweight system", "Dead-hung battens"], counterweight: true } } });
  ok(JSON.stringify(a4.disciplines?.rigging?.present) === '["Counterweight","Dead-hung"]', "#342 R3: old Present labels relabel on read");
  ok((a4.legacyNotes || []).some((n) => n.section === "mBeams" && n.text === "Hemp") && !(a4.legacyNotes || []).some((n) => n.section === "dRigging"),
    "#342 R1: an answered system keeps a disagreeing rig type as an Older note");
  ok(a4.measurements?.rigType === "Hemp" && a4.disciplines?.rigging?.counterweight === true, "#342 R1: migration never deletes the old keys");
  const a5 = m({ systemsState: { rigging: { installed: "yes", desc: "" } } });
  ok(JSON.stringify(a5.disciplines?.rigging?.present) === JSON.stringify([presentOptionsFor("rigging", "theatre")[0]]) && (a5.disciplines?.rigging?.present as string[] | undefined)?.[0] === "Counterweight",
    "#342: the systemsState fold still seeds Present (now the new first option)");
  const a6 = m({ disciplines: { lighting: { goals: "Brighter wash" }, curtain: { present: ["None"] } } });
  ok(JSON.stringify(a6.scope) === '["lighting"]', "#342 R2: scope seeds from disciplines with data (None-only doesn't count)");
  ok(m({}).scope === undefined && JSON.stringify(m({ scope: [] }).scope) === "[]", "#342 R2: nothing to seed → scope stays unset; an answered scope is kept");
  const twice = m(m({ measurements: { rigType: "Bogus" }, disciplines: { rigging: { present: ["Hemp"] } } }) as MigratableSurvey);
  ok((twice.legacyNotes || []).filter((n) => n.text === "Bogus").length === 1, "#342 R1: migration is idempotent (notes de-duplicate)");
  const stored = m({ legacyNotes: [{ section: "x", label: "y", text: "stale" }] });
  ok((stored.legacyNotes || []).length === 0, "#342 R1: legacyNotes are re-derived on every read, never trusted from storage");
  const ln: MigratableSurvey = {};
  addLegacyNote(ln, { section: "s", label: "l", text: "   " });
  ok(!(ln.legacyNotes || []).length, "#342 R1: a blank note is dropped");

  ok(!BEAM_FIELDS.some((f) => f.key === "rigType"), "#342 R3: Beams & rigging no longer asks Existing rig type");
  const rigGroup = DISCIPLINE_GROUPS.find((g) => g.key === "rigging")!;
  ok(rigGroup.presentOptions.join("|") === "Counterweight|Dead-hung|Motorized|Hemp|Fixed points|None" && !rigGroup.fields.some((f) => f.key === "counterweight"),
    "#342 R3: Rigging Present uses the rig-system list; its Counterweight check is gone");

  const base = { venue: "Hall", contact: "Pat", contactEmail: "p@x.org", measurements: { proW: "40", stageDepth: "30" } };
  ok(tier1Items(base).map((i) => i.key).join() === "venue,contact,contactEmail,stageWidth,stageDepth,scope", "#342 A2: Tier 1 items (no phone; scope added)");
  ok(!tier1Complete(base) && tier1Complete({ ...base, scope: ["curtain"] }), "#342 A2: Tier 1 needs a scope; contact phone isn't required");
  ok(tier1Items({ ...base, scope: ["rigging"] }).some((i) => i.key === "rigSystem" && !i.done) && !tier1Complete({ ...base, scope: ["rigging"] }),
    "#342 A2: Rigging in scope adds an unanswered Rigging system item");
  ok(tier1Complete({ ...base, scope: ["rigging"], disciplines: { rigging: { present: ["Hemp"] } } }), "#342 A2: answering the rigging system completes Tier 1");
  const rigOnly = { ...base, scope: ["rigging"], disciplines: { rigging: { present: ["Hemp"] } } };
  ok(intakeStatus(rigOnly) === "general-complete", "#342 A2: the rigging-system kill answer alone doesn't count as a discipline added");
  ok(intakeStatus({ ...rigOnly, disciplines: { rigging: { present: ["Hemp"], gridHeight: "30" } } }) === "discipline-added",
    "#342 A2: real Rigging intake data still flips the status to discipline-added");
  ok(tier1Items(base).find((i) => i.key === "stageWidth")?.section === "tier1" && tier1Items(base).find((i) => i.key === "contact")?.section === "cust",
    "#342 A2: stage W/D are answered on the card; contact jumps to Customer & venue");

  /* ---- Task 3: internal tags ---- */
  ok(STARTER_SURVEY_TAGS.map((t) => t.label).join("|") ===
    "Tight timeline|Price-sensitive|Strong champion|Competitor involved|Budget not confirmed|Decision-maker not met|Active venue (work around events)|Volunteer install crew available|Historic / preservation constraints",
    "#342 A5: the nine starter tags (Jeff, Q6)");
  ok(STARTER_SURVEY_TAGS.every((t) => /^tg_[a-z0-9_]+$/.test(t.id)) && new Set(STARTER_SURVEY_TAGS.map((t) => t.id)).size === 9, "#342 A5: starter ids are tg_ slugs, unique");
  ok(resolveSurveyTags(undefined).length === 9 && resolveSurveyTags([]).length === 9, "#342 A5: absent / empty reads as the starter list");
  ok(resolveSurveyTags([{ id: "tg_a", label: " A " }, { id: "bad id", label: "B" }, { id: "tg_a", label: "dup" }, { id: "tg_c", label: "" }]).map((t) => t.id + ":" + t.label).join() === "tg_a:A",
    "#342 A5: resolve drops bad ids, duplicates and blank labels");
  const st = resolveSurveyTags(undefined);
  const r1 = mergeSurveyTags(st, [{ id: "tg_tight_timeline", label: "Very tight timeline" }, { label: "Board approval needed" }]);
  ok(r1.ok && r1.tags[0].label === "Very tight timeline" && r1.tags[1].id === "tg_board_approval_needed" && !r1.tags[1].retired,
    "#342 A5: rename keeps the id; a new row mints a tg_ id");
  ok(r1.ok && r1.tags.filter((t) => t.retired).length === 8, "#342 A5: rows dropped from the editor are kept, retired (stored surveys keep their label)");
  ok(r1.ok && activeSurveyTags(r1.tags).length === 2 && surveyTagLabel(r1.tags, "tg_price_sensitive") === "Price-sensitive" && surveyTagLabel(r1.tags, "tg_gone") === "tg_gone",
    "#342 A5: active filter and labels (unknown id shows raw)");
  const r2 = mergeSurveyTags(st, [{ label: "X" }, { label: "x" }]);
  ok(!r2.ok && /Two tags/.test(r2.error), "#342 A5: duplicate active labels are refused");
  const r3 = mergeSurveyTags(st, [{ id: "tg_nope", label: "Y" }]);
  ok(!r3.ok && /Unknown tag/.test(r3.error), "#342 A5: an unknown id is refused");
  const r4 = mergeSurveyTags(st, [{ label: "" }]);
  ok(!r4.ok, "#342 A5: a blank label is refused");

  /* ---- Task 4: assignment defaults (source pin) ---- */
  const vaActs = readFileSync(join(process.cwd(), "src/app/(app)/venue-assessments/actions.ts"), "utf8");
  ok(/create\(\{ owner: user\.name, requestedBy: user\.name, stage: "requested", assignedTo: user\.name, scheduledDate: chicagoDayKey\(Date\.now\(\)\) \}, user\.name\)/.test(vaActs),
    "#342 A4: New request defaults Assigned to = me and Scheduled date = today (Chicago); stage stays requested");

  /* ---- Task 5: shared rail ---- */
  ok(railSheetLabel({ key: "S1", label: "Core", done: 3, total: 7, badges: [
      { tone: "prompt", n: 2, title: "", text: "2 to review" }, { tone: "photo", n: 1, title: "", text: "1 photo" }, { tone: "photo", n: 0, title: "", text: "0 photos" }] }, true) === "Core — 3/7 · 2 to review · 1 photo",
    "#342 A8: the phone select label matches the engine's old format (zero badges skipped)");
  ok(railSheetLabel({ key: "recap", label: "Customer recap", done: 0, total: 0 }) === "Customer recap" &&
     railSheetLabel({ key: "x", label: "X", done: 0, total: 0 }, true) === "X — 0/0", "#342 A8: no count for a section without fields unless showEmpty");
  ok(SECTION_RAIL_CSS.includes("@media (max-width: 759px)") && SECTION_RAIL_CSS.includes(".sr-rail-sheet"), "#342 A8: the rail carries its own phone breakpoint");
  const engRail = readFileSync(join(process.cwd(), "src/app/(app)/assessments/[id]/scope-rail.tsx"), "utf8");
  const engEditor = readFileSync(join(process.cwd(), "src/app/(app)/assessments/[id]/editor.tsx"), "utf8");
  ok(engRail.includes('from "@/components/section-rail/section-rail"') && !/function Ring\(/.test(engRail) && engRail.includes("showEmpty"),
    "#342 A8: the engine's scope rail renders the shared SectionRail");
  ok(!/\.as-rail[\s{-]/.test(engEditor) && engEditor.includes("${SECTION_RAIL_CSS}"), "#342 A8: the engine's CSS takes the rail rules from the shared component");

  /* ---- Task 6: editor flow (source pins) ---- */
  const vaDir = "src/app/(app)/venue-assessments/[id]";
  const ctl = readFileSync(join(process.cwd(), `${vaDir}/controls.tsx`), "utf8");
  const sys = readFileSync(join(process.cwd(), `${vaDir}/sections/systems.tsx`), "utf8");
  const kq = readFileSync(join(process.cwd(), `${vaDir}/sections/kill-questions.tsx`), "utf8");
  const vaPage = readFileSync(join(process.cwd(), `${vaDir}/page.tsx`), "utf8");
  const vaActsId = readFileSync(join(process.cwd(), `${vaDir}/actions.ts`), "utf8");
  ok(ctl.includes('from "@/lib/survey-flow"') && !/const ORDER = \[/.test(ctl) && !/const STEP_BY_ID/.test(ctl), "#342 A1: the editor takes order, steps and groups from survey-flow");
  ok(!ctl.includes("SignoffSection") && !ctl.includes('kind: "signoff"'), "#342 A6: the Sign-off section is gone from the editor");
  ok(/isQuoteVisit\(draft\)/.test(ctl), "#342 A3: the quote half of Existing materials & quote is gated on isQuoteVisit");
  ok(/sectionVisible\(draft, s\.id\)/.test(ctl), "#342 R2: the section list is filtered by sectionVisible");
  ok(!sys.includes("Venue-class guidance") && !sys.includes("doctrine"), "#342 A9: the Venue-class guidance panel is removed from the intake");
  ok(sys.includes("presentFromKill") && sys.includes("from Kill questions"), "#342 R3: the Rigging intake shows the rig system read-only");
  ok(kq.includes("SCOPE_KEYS") && kq.includes("RIG_SYSTEMS") && kq.includes("TIER1_WIDTH_BY_CLASS"), "#342 A2: Kill questions carries Scope, Rigging system and stage W/D inputs");
  ok(!vaPage.includes("resolveVenueDoctrine") && vaPage.includes("resolveSurveyTags"), "#342: the editor page drops doctrine and passes internal tags");
  ok(/\| "scope"/.test(vaActsId) && /\| "internalTags"/.test(vaActsId), "#342: SurveyPatch carries scope and internalTags");
  ok(/legacyNotes: _legacy/.test(ctl), "#342 R1: the outbox doc strips legacyNotes (derived, never stored)");
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
    "#342 A4: a lead's visit request pre-fills the survey with the visit's assignee and today; stage stays requested");

  const r2 = await requestVisitForLead(lead("lead-b"), { reason: "walk", timing: "", assignee: "  " }, "Office Person");
  if (r2.ok) { registerFixture("site_visits", r2.visitId); registerFixture("surveys", r2.surveyId); }
  const s2 = r2.ok ? await S.get(r2.surveyId) : null;
  ok(!!s2 && s2.assignedTo === "Office Person", "#342 A4: with no assignee the survey defaults to whoever requested it");
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
