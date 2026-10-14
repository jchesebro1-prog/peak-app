/* Venue Assessment notes (#342) — harness checks. `vaNotesChecks` is pure; `vaNotesDbChecks` needs the test DB.
   Run alone with `npx tsx scripts/test-va-notes.ts` (pure checks only). */
import type { Ok } from "./test-inbox-org";
import {
  SECTION_ORDER, STEP_BY_ID, STEP_LABELS, GROUP_BY_ID, GROUP_META, RIG_SYSTEMS, isQuoteVisit, scopeSet, inScope,
  rigSystems, hasCounterweight, hasLinesets, sectionVisible, splitGoalLines, recapFor, recapScopeText,
} from "../src/lib/survey-flow";

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
}

export async function vaNotesDbChecks(ok: Ok): Promise<void> {
  void ok;
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
