/* Jeff's 2026-10-15 decisions — Batch 3 (Lists, pipelines, field) harness checks
   (docs/decisions/2026-10-15-jeff-decisions.md items 8, 10, 11, 34, 35, 42).
   `batch3PureChecks` needs no database; `batch3DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-oct15-batch3.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { like } from "drizzle-orm";
import type { Ok } from "./test-inbox-org";
import { LIST_PAGE_SIZE, paginate, parsePageParam, pageOfIndex, resolvePage, withPage, pageCountFor } from "../src/lib/list-paging";
import { quotesHubView, HUB_TYPE_KEYS, type HubQuote } from "../src/lib/quotes-hub-view";
import { companyRollups, filterCompanyDirectory, companySearchText } from "../src/lib/company-directory";
import { getDb } from "../src/db";
import { companies, sites, contacts, contactEmails } from "../src/db/schema";
import { saveCompany, companiesByNames } from "../src/lib/identity/companies";
import { saveSite } from "../src/lib/identity/sites";
import { companyIdsWithContactMatching } from "../src/lib/identity/contacts";
import { allForDirectory } from "../src/lib/stores/customers";
import { listQuoteRows } from "../src/lib/stores/quotes";
import { createFixture, dropFixtures, fixtureId } from "./test-fixtures";
import { DEFAULT_QUOTE_PIPELINES, LEAD_QUALIFY_FIX, LEAD_QUALIFY_STAGE, withLeadQualifyStage, validateQuotePipeline, type QuotePipeline } from "../src/lib/pipelines";
import { ensureLeadQualifyStage, loadPipelines } from "../src/lib/pipelines-server";
import { getSettingsPatch, setSettings } from "../src/lib/settings";
import { get as getQuote } from "../src/lib/stores/quotes";
import { pickManualPhases } from "../src/lib/consulting-stages";
import { generateSchedule, withEngagementPhaseIds } from "../src/lib/consulting-schedule";
import { phaseWeightsFor } from "../src/lib/settings";
import { createManualEngagement, DEFAULT_CONSULTING_PHASES } from "../src/lib/stores/engagements";
import { canChangeVisit, isVisitLead, VISIT_EDIT_REFUSAL } from "../src/lib/visit-edit-rights";
import { ASSESSMENT_DEF, allQuestions } from "../src/lib/assessments/defs";
import { FIXED_PICK_LISTS } from "../src/lib/assessments/defs/picklists";
import { evaluate, riggingDepth, type EvalInput } from "../src/lib/assessments/evaluate";
import type { Answer, Answers } from "../src/lib/assessments/answers";
import { addPicklistValue } from "../src/lib/stores/assessment-picklists";
import { planReminders, reminderTaskId, inReminderWindow, REMINDER_LEAD_DAYS, type ReminderFinding } from "../src/lib/assessments/reminders";
import { runAssessmentReminders } from "../src/lib/assessments/reminders-server";
import { setNextAssessmentAt, getVenueProfile } from "../src/lib/stores/venue-profiles";
import { getDocRows, softDeleteDoc } from "../src/db/doc-store";
import { DOC_TABLES } from "../src/db/doc-tables";
import { inArray } from "drizzle-orm";

const ROOT = join(__dirname, "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* ------------------------------------------------------------------ #11 lists ------------------------------------------------------------------ */

function listPagingChecks(ok: Ok) {
  ok(LIST_PAGE_SIZE === 50, "b3 #11: 50 rows a page");
  ok(parsePageParam("3") === 3 && parsePageParam("") === 1 && parsePageParam("0") === 1 && parsePageParam("-2") === 1 && parsePageParam("2.5") === 1 && parsePageParam("abc") === 1 && parsePageParam(undefined) === 1,
    "b3 #11: ?page= parses to a positive integer, anything else is page 1");
  const all = Array.from({ length: 123 }, (_, i) => i);
  const p1 = paginate(all, 1), p3 = paginate(all, 3), p9 = paginate(all, 9);
  ok(p1.rows.length === 50 && p1.rows[0] === 0 && p1.from === 1 && p1.to === 50 && p1.pageCount === 3 && p1.total === 123, "b3 #11: page 1 of 123 rows is rows 1–50 of 3 pages");
  ok(p3.rows.length === 23 && p3.rows[0] === 100 && p3.from === 101 && p3.to === 123, "b3 #11: the last page holds the remainder");
  ok(p9.page === 3 && p9.rows[0] === 100, "b3 #11: a page past the end shows the last page");
  const empty = paginate([], 4);
  ok(empty.page === 1 && empty.pageCount === 1 && empty.from === 0 && empty.to === 0 && pageCountFor(0) === 1, "b3 #11: an empty list is page 1 of 1");
  ok(pageOfIndex(0) === 1 && pageOfIndex(49) === 1 && pageOfIndex(50) === 2 && pageOfIndex(-1) === 1, "b3 #11: the page holding a row index");
  ok(resolvePage(1, 120) === 3 && resolvePage(2, -1) === 2, "b3 #11: a ?id= row found in the filtered set opens on its page; not found keeps ?page=");
  const params = new URLSearchParams("status=sent&page=4&q=gym");
  ok(withPage("/quotes", params, 2) === "/quotes?status=sent&q=gym&page=2" && withPage("/quotes", params, 1) === "/quotes?status=sent&q=gym" && withPage("/quotes", new URLSearchParams(), 1) === "/quotes",
    "b3 #11: page links keep every filter; page 1 has the plain URL");

  /* Quotes hub: filters, chips and stats over the FULL set, never one page. 260 quotes, newest first. */
  const owners = ["Pat", "Sam", "Lee"];
  const types = [undefined, "flame_test", "repair", "inspection", "consulting", "rental", "system"];
  const statuses = ["draft", "sent", "won", "lost"];
  const rows: HubQuote[] = Array.from({ length: 260 }, (_, i) => ({
    id: "Q-" + i,
    name: i === 237 ? "Needle in the haystack" : "Quote " + i,
    customer: i === 201 ? "Farfield Schools" : "Cust " + (i % 9),
    owner: owners[i % 3],
    status: statuses[i % 4],
    quoteType: types[i % 7],
    value: 100,
    estNo: 1001 + i,
  }));
  const bidderMap = new Map<string, Array<{ bid: { result: "pending" } }>>([["Q-249", [{ bid: { result: "pending" } }]], ["Q-12", [{ bid: { result: "pending" } }]]]);
  const bidders = (id: string) => (bidderMap.get(id) ?? []) as never;
  const bidderNames = (id: string) => (id === "Q-255" ? ["Acme Mechanical"] : []);
  const base = { scope: "all", me: "Pat", status: "all", type: "all", bid: false, q: "" };
  const v0 = quotesHubView(rows, base, bidders, bidderNames);
  ok(v0.filtered.length === 260 && v0.statusCounts.all === 260 && v0.statusCounts.won === 65 && v0.typeCounts.system === 75 && v0.typeCounts.rental === 37,
    "b3 #11 quotes: status and type counts cover all 260 quotes (system = no quoteType + 'system')");
  ok(HUB_TYPE_KEYS.reduce((a, k) => a + v0.typeCounts[k], 0) === 260, "b3 #11 quotes: the type chips add up to every quote");
  const vNeedle = quotesHubView(rows, { ...base, q: "needle" }, bidders, bidderNames);
  ok(vNeedle.filtered.length === 1 && vNeedle.filtered[0].id === "Q-237", "b3 #11 quotes: a search finds a quote far past page 1 (row 238 of 260)");
  ok(quotesHubView(rows, { ...base, q: "farfield" }, bidders, bidderNames).filtered[0]?.id === "Q-201", "b3 #11 quotes: search reads the customer");
  ok(quotesHubView(rows, { ...base, q: "acme mech" }, bidders, bidderNames).filtered.map((q) => q.id).join() === "Q-255", "b3 #11 quotes: search reads bidder company names");
  const vNum = quotesHubView(rows, { ...base, q: "1250" }, bidders, bidderNames);
  ok(vNum.filtered[0]?.id === "Q-249", "b3 #11 quotes: an estimate number finds its quote first, wherever it sits");
  const vBid = quotesHubView(rows, { ...base, bid: true }, bidders, bidderNames);
  ok(v0.outToBidCount === 2 && vBid.filtered.map((q) => q.id).sort().join() === "Q-12,Q-249", "b3 #11 quotes: Out to bid counts and filters across every page");
  const vMine = quotesHubView(rows, { ...base, scope: "mine", status: "won" }, bidders, bidderNames);
  ok(vMine.scoped.every((q) => q.owner === "Pat") && vMine.scoped.length === 87 && vMine.filtered.every((q) => q.status === "won") && vMine.statusCounts.won === vMine.filtered.length,
    "b3 #11 quotes: My work + a status chip count the whole of my quotes");
  const vType = quotesHubView(rows, { ...base, type: "repair", status: "sent" }, bidders, bidderNames);
  ok(vType.typeCounts.all === 260 && vType.scoped.every((q) => q.quoteType === "repair") && vType.filtered.every((q) => q.status === "sent" && q.quoteType === "repair"),
    "b3 #11 quotes: type chip counts are taken before the type filter; status after");
  const pg = paginate(v0.filtered, resolvePage(1, v0.filtered.findIndex((q) => q.id === "Q-180")));
  ok(pg.page === 4 && pg.rows.some((q) => q.id === "Q-180"), "b3 #11 quotes: /quotes?id=Q-180 opens on page 4");

  /* Companies directory */
  const cos = Array.from({ length: 140 }, (_, i) => ({
    id: "co" + i,
    name: i === 133 ? "Zephyr Arts Center" : "Company " + i,
    type: i % 2 ? "School" : "Church",
    owner: i === 5 ? "Lee" : undefined,
    createdAt: i === 120 ? Date.now() - 86_400_000 : Date.now() - 30 * 86_400_000,
    locations: [{ label: "Hall " + i, city: i === 99 ? "Oshkosh" : "Madison", state: "WI", address: "1 Main", zip: "53703" }],
  }));
  const qrows = [
    { customerId: "co7", status: "sent", value: 500, owner: "Sam", updatedAt: 10 },
    { customerId: "co7", status: "won", value: 900, owner: "Pat", updatedAt: 20 },
    { customer: "Company 8", status: "draft", value: 300, owner: "Pat", updatedAt: 5 },
  ];
  const prows = [{ customerId: "co7", owner: "Lee", updatedAt: 15 }, { customerId: "co5", owner: "Pat", updatedAt: 99 }];
  const drows = companyRollups(cos, qrows, prows);
  const r7 = drows.find((r) => r.c.id === "co7")!, r8 = drows.find((r) => r.c.id === "co8")!, r5 = drows.find((r) => r.c.id === "co5")!;
  ok(r7.openValue === 500 && r7.quoteCount === 2 && r7.owner === "Pat" && r8.quoteCount === 1 && r8.openValue === 300 && r5.owner === "Lee",
    "b3 #11 companies: rollups (open value, quote count by id or name, latest-activity owner, stored owner wins)");
  const f = { scope: "all", me: "Pat", type: "all", q: "", added: "" };
  ok(filterCompanyDirectory(drows, { ...f, q: "zephyr" }).filtered.map((r) => r.c.id).join() === "co133", "b3 #11 companies: search finds a company far past page 1");
  ok(filterCompanyDirectory(drows, { ...f, q: "oshkosh" }).filtered.map((r) => r.c.id).join() === "co99", "b3 #11 companies: search reads venue city");
  ok(companySearchText(cos[3]).includes("53703") && companySearchText(cos[3]).includes("school"), "b3 #11 companies: search text holds type, address and zip");
  ok(filterCompanyDirectory(drows, { ...f, q: "pat person", contactHits: new Set(["co77"]) }).filtered.map((r) => r.c.id).join() === "co77", "b3 #11 companies: a contact match (SQL) brings its company in");
  const mine = filterCompanyDirectory(drows, { ...f, scope: "mine" }).filtered.map((r) => r.c.id).sort().join();
  ok(mine === "co7,co8", "b3 #11 companies: My companies reads the rollup owner across every company");
  const sch = filterCompanyDirectory(drows, { ...f, type: "School" });
  ok(sch.filtered.length === 70 && paginate(sch.filtered, 2).rows.length === 20, "b3 #11 companies: a type filter counts the full set, then pages it");
  const add = filterCompanyDirectory(drows, { ...f, added: "7d" });
  ok(add.addedCount === 1 && add.filtered.map((r) => r.c.id).join() === "co120", "b3 #11 companies: Added in 7 days over the full set");

  /* Pins: the pages read slim projections, page last, and show the pager. */
  const qp = src("src/app/(app)/quotes/page.tsx");
  ok(!/\bgetAll\(\)/.test(qp) && !/allCustomers/.test(qp) && /listQuoteRows\(\)/.test(qp) && /quotesHubView\(/.test(qp) && /getQuotesMany\(paged\.rows/.test(qp) && /<ListPager/.test(qp) && /pageQuotes\.map\(/.test(qp),
    "b3 #11 pin: the Quotes hub filters a slim projection of every quote, reads only the page in full, and pages it");
  const cp = src("src/app/(app)/companies/page.tsx");
  ok(/allForDirectory\(\)/.test(cp) && /listQuoteRows\(\)/.test(cp) && /listProjectActivityRows\(\)/.test(cp) && /companyIdsWithContactMatching\(q\)/.test(cp) && /filterCompanyDirectory\(rows/.test(cp) && /<ListPager/.test(cp) && !/parsePageSize/.test(cp),
    "b3 #11 pin: the Companies directory filters every company (slim reads + SQL contact search) and pages with ?page=");
  const vp = src("src/app/(app)/venues/page.tsx");
  const vh = src("src/lib/venue-history-server.ts");
  ok(/<ListPager/.test(vp) && /parsePageParam\(one\(sp\.page\)\)/.test(vp) && /activityRows\("quotes", AT\)/.test(vh) && !/loadVenueDirectory[\s\S]{0,400}getAllQuotes\(\)/.test(vh),
    "b3 #11 pin: the Venues directory reads activity as projections and pages with ?page=");
}

async function listDbChecks(ok: Ok) {
  const db = await getDb();
  const PFX = "TESTb3:";
  const cleanup = async () => {
    await db.delete(contactEmails).where(like(contactEmails.id, PFX + "%"));
    await db.delete(contacts).where(like(contacts.id, PFX + "%"));
    await db.delete(sites).where(like(sites.id, PFX + "%"));
    await db.delete(companies).where(like(companies.id, PFX + "%"));
  };
  try {
    await cleanup();
    await saveCompany({ id: PFX + "co1", name: "B3 Lattice Theatre", type: "customer", lifecycle: "active", deleted: false });
    await saveSite({ id: PFX + "st1", companyId: PFX + "co1", name: "B3 Hall", locationName: "B3 Hall", venueKind: "proscenium" });
    const t = Date.now();
    await db.insert(contacts).values({ id: PFX + "ct1", firstName: "Quinby", lastName: "Marsh", homeCompanyId: PFX + "co1", title: "TD", isPrimary: true, createdAt: t, updatedAt: t });
    await db.insert(contactEmails).values({ id: PFX + "ce1", contactId: PFX + "ct1", email: "qmarsh@lattice-b3.example", isPrimary: true } as never);
    const byName = await companyIdsWithContactMatching("quinby mar");
    const byMail = await companyIdsWithContactMatching("LATTICE-B3");
    const none = await companyIdsWithContactMatching("50%_");
    ok(byName.has(PFX + "co1") && byMail.has(PFX + "co1") && !none.has(PFX + "co1"), "b3 #11 db: the SQL contact search matches name and email; LIKE wildcards are literal");
    const dir = await allForDirectory();
    const mine = dir.find((c) => c.id === PFX + "co1");
    ok(!!mine && mine.contacts.length === 0 && mine.locations.length === 1, "b3 #11 db: the directory read carries venues and no contacts");
    const named = await companiesByNames(["b3 lattice THEATRE"]);
    ok(named.get("b3 lattice theatre")?.id === PFX + "co1", "b3 #11 db: companiesByNames matches ignoring case");

    const Q = fixtureId("b3", "list-quote");
    await createFixture("quotes", { id: Q, name: "B3 list quote", customer: "B3 Lattice Theatre", customerId: PFX + "co1", owner: "Pat", status: "sent", value: 4321, updatedAt: t, spec: { sections: [{ id: "s1", items: [{ id: "l1", desc: "big" }] }] }, revisions: [{ rev: 1 }] } as never);
    const rows = await listQuoteRows();
    const r = rows.find((x) => x.id === Q) as Record<string, unknown> | undefined;
    ok(!!r && r.value === 4321 && r.status === "sent" && r.customerId === PFX + "co1" && !("spec" in r) && !("revisions" in r), "b3 #11 db: listQuoteRows is a projection — list fields, no spec or revisions");
    ok(rows.every((x, i) => i === 0 || (rows[i - 1].updatedAt || 0) >= (x.updatedAt || 0)), "b3 #11 db: listQuoteRows is newest first, like getAll()");
  } finally {
    await dropFixtures("b3");
    await cleanup();
  }
}

/* ------------------------------------------------------------------ #42 BID SPEC Lead / Qualify ------------------------------------------------------------------ */

const OLD_BID_SPEC: QuotePipeline = {
  id: "bid-spec",
  label: "BID SPEC",
  stages: [
    { id: "collect-info", label: "Collect Information", tag: "draft" },
    { id: "create-bid", label: "Create BID", tag: "draft" },
    { id: "bid-sent", label: "BID Sent", tag: "sent" },
    { id: "awarded", label: "Awarded", tag: "won" },
  ],
};
const OLD_LIST: QuotePipeline[] = [DEFAULT_QUOTE_PIPELINES[0], OLD_BID_SPEC];

function pipelineChecks(ok: Ok) {
  const seed = DEFAULT_QUOTE_PIPELINES.find((p) => p.id === "bid-spec")!;
  ok(seed.stages[0].id === "lead-qualify" && seed.stages[0].label === "Lead / Qualify" && seed.stages[0].tag === "draft" && seed.stages[1].id === "collect-info" && !validateQuotePipeline(seed).length,
    "b3 #42: the BID SPEC seed starts Lead / Qualify (a plain Draft stage) → Collect Information, and validates");
  const once = withLeadQualifyStage(OLD_LIST);
  ok(!!once && once[1].stages.map((s) => s.id).join() === "lead-qualify,collect-info,create-bid,bid-sent,awarded" && once[0] === OLD_LIST[0] && OLD_BID_SPEC.stages.length === 4,
    "b3 #42: a stored list gains the stage before Collect Information; other pipelines and the input are untouched");
  ok(withLeadQualifyStage(once!) === null, "b3 #42: idempotent — a list that has it changes nothing (never a duplicate)");
  const renamed = [{ ...OLD_BID_SPEC, stages: [{ id: "lq", label: "Lead/qualify", tag: "draft" as const }, ...OLD_BID_SPEC.stages] }];
  ok(withLeadQualifyStage(renamed) === null, "b3 #42: a stage already named Lead / Qualify (any spelling) counts as present");
  ok(withLeadQualifyStage([DEFAULT_QUOTE_PIPELINES[0]]) === null, "b3 #42: no BID SPEC pipeline → nothing to do");
  const noCollect = withLeadQualifyStage([{ ...OLD_BID_SPEC, stages: OLD_BID_SPEC.stages.filter((s) => s.id !== "collect-info") }]);
  ok(noCollect?.[0].stages[0].id === LEAD_QUALIFY_STAGE.id, "b3 #42: with Collect Information gone it goes first");
  ok(/"lead \/ qualify": \{ stage: "lead-qualify" \}/.test(src("src/lib/daylite/history.ts")), "b3 #42: the Daylite import maps a \"Lead / Qualify\" stage label");
}

async function pipelineDbChecks(ok: Ok) {
  const before = await getSettingsPatch();
  const Q = fixtureId("b3", "bid-quote");
  try {
    await setSettings({ quotePipelines: OLD_LIST, pipelineFixes: undefined });
    await createFixture("quotes", { id: Q, name: "B3 bid", customer: "x", status: "draft", quoteType: "system", pipelineId: "bid-spec", stage: "collect-info", updatedAt: Date.now() } as never);
    ok((await ensureLeadQualifyStage()) === true, "b3 #42 db: the ensure adds the stage to a stored list");
    const p1 = await getSettingsPatch();
    const bs1 = (p1.quotePipelines as QuotePipeline[]).find((p) => p.id === "bid-spec")!;
    ok(bs1.stages.map((s) => s.id).join() === "lead-qualify,collect-info,create-bid,bid-sent,awarded" && (p1.pipelineFixes as string[]).includes(LEAD_QUALIFY_FIX),
      "b3 #42 db: stored BID SPEC now reads Lead / Qualify → Collect Information…, and the marker is set");
    ok((await ensureLeadQualifyStage()) === false, "b3 #42 db: a second run changes nothing");
    await setSettings({ pipelineFixes: undefined });
    ok((await ensureLeadQualifyStage()) === false && ((await getSettingsPatch()).quotePipelines as QuotePipeline[])[1].stages.filter((s) => s.id === "lead-qualify").length === 1,
      "b3 #42 db: even with the marker cleared it never duplicates the stage");
    ok((await getQuote(Q))?.stage === "collect-info", "b3 #42 db: an existing quote keeps its stage");
    // One-time: a stage Jeff deletes afterwards stays deleted.
    await setSettings({ quotePipelines: OLD_LIST });
    const loaded = await loadPipelines();
    ok(loaded.quote.find((p) => p.id === "bid-spec")!.stages.length === 4, "b3 #42 db: once marked, a later list without the stage is left alone (a deliberate delete sticks)");
    // A fresh environment (no stored list): loadPipelines marks it and reads the seeds.
    await setSettings({ quotePipelines: undefined, pipelineFixes: undefined });
    const fresh = await loadPipelines();
    const pf = await getSettingsPatch();
    ok(fresh.quote.find((p) => p.id === "bid-spec")!.stages[0].id === "lead-qualify" && !pf.quotePipelines && (pf.pipelineFixes as string[]).includes(LEAD_QUALIFY_FIX),
      "b3 #42 db: with no stored list the seeds carry the stage and only the marker is written");
  } finally {
    await setSettings({ quotePipelines: before.quotePipelines, pipelineFixes: before.pipelineFixes });
    await dropFixtures("b3");
  }
}

/* ------------------------------------------------------------------ #34 consulting phases ------------------------------------------------------------------ */

function phasePickerChecks(ok: Ok) {
  const menu = ["Programming", "Schematic Design", "Design Development", "Construction Documents", "Construction Admin"];
  ok(JSON.stringify(pickManualPhases(menu, undefined)) === JSON.stringify(menu), "b3 #34: no posted list (an older client) = every phase, as before");
  ok(JSON.stringify(pickManualPhases(menu, ["construction admin", " Programming ", "Nope"])) === '["Programming","Construction Admin"]',
    "b3 #34: ticked phases are kept in menu order; names off the menu are dropped");
  ok(pickManualPhases(menu, []) === null && pickManualPhases(menu, ["Nope"]) === null && pickManualPhases(menu, "Programming") === null,
    "b3 #34: no phase ticked (or garbage) is refused");
  // Only ticked phases get tasks: generateSchedule places lines by the engagement's own phases.
  const eng = [{ id: "ph-a", name: "Programming" }, { id: "ph-b", name: "Construction Admin" }];
  const phases = withEngagementPhaseIds(phaseWeightsFor({}, eng.map((p) => p.name)), eng);
  const gen = generateSchedule({
    startAt: Date.UTC(2026, 0, 1), endAt: Date.UTC(2026, 11, 31), phases, disciplines: [],
    lines: menu.map((ph, i) => ({ key: "k" + i, title: "Task " + ph, section: "", phase: ph, discipline: "", startPct: 0, lengthPct: 100 })),
    milestones: [{ id: "m1", phaseId: "ph-b", targetDate: 0 }],
  });
  ok(gen.tasks.map((t) => t.title).join("|") === "Task Programming|Task Construction Admin" && gen.milestones[0].targetDate > 0,
    "b3 #34: with two phases ticked only their task lines are scheduled; a phase milestone dates to its phase");
  const modal = src("src/app/(app)/design/engagements/new-engagement-modal.tsx");
  ok(/useState<string\[\]>\(\(\) => \[\.\.\.phaseMenu\]\)/.test(modal) && /data-testid="new-engagement-phases"/.test(modal) && /disciplines,\s*phases,\s*\}\);/.test(modal),
    "b3 #34 pin: the modal's phase checklist starts all ticked and posts the ticks");
  const act = src("src/app/(app)/design/engagements/actions.ts");
  ok(/requirePerm\("create"\)[\s\S]{0,2200}pickManualPhases\(mergedConsultingPhases\(\(await getSettings\(\)\)\.consultingPhases\), input\?\.phases\)/.test(act) && /if \(!phases\) return \{ ok: false, error: "Tick at least one phase\." \}/.test(act) && /^      phases,$/m.test(act),
    "b3 #34 pin: the create action (create permission) allowlists the ticked phases against Settings and seeds only those");
  ok(src("src/app/(app)/design/engagements/view.tsx").includes("phaseMenu={data.phaseMenu}"), "b3 #34 pin: the hub hands the modal the Settings phase menu");
}

async function phaseDbChecks(ok: Ok) {
  const eng = await createManualEngagement({ customerId: "TESTb3:co-none", customer: "B3 Co", name: "TESTb3 phases", phases: ["Programming", "Construction Admin"], startAt: Date.UTC(2026, 0, 1), endAt: Date.UTC(2026, 5, 1) }, { name: "Pat" });
  try {
    ok(eng.phases.map((p) => p.name).join("|") === "Programming|Construction Admin" && eng.phases.every((p) => p.status === "pending"),
      "b3 #34 db: a hand-added project seeds exactly the ticked phases, all pending");
    ok(DEFAULT_CONSULTING_PHASES.length > 2, "b3 #34 db: (the full menu is longer than the pick)");
  } finally {
    const db = await getDb();
    const { DOC_TABLES } = await import("../src/db/doc-tables");
    const { eq } = await import("drizzle-orm");
    await db.delete(DOC_TABLES.consulting_engagements).where(eq(DOC_TABLES.consulting_engagements.id, eng.id));
  }
}

/* ------------------------------------------------------------------ #35 visit edit rights ------------------------------------------------------------------ */

function visitRightsChecks(ok: Ok) {
  const roster = [
    { id: "u1", name: "Jeff Chesebro" },
    { id: "u2", name: "Sam Okafor" },
    { id: "u3", name: "Pat Lee" },
    { id: "u4", name: "pat lee " }, // an (archived) namesake makes "Pat Lee" ambiguous
  ];
  const tech = { id: "u2", name: "Sam Okafor", roles: ["Estimator"] };
  const other = { id: "u1", name: "Jeff Chesebro", roles: ["Estimator"] };
  const approver = { id: "u9", name: "Rae Approver", roles: ["Reviewer"] };
  const sched = { stage: "scheduled", assignedTo: "sam okafor" };
  ok(isVisitLead(sched, tech, roster) && canChangeVisit(sched, tech, roster), "b3 #35: the lead (by unique name, case-insensitive) can change a scheduled visit");
  ok(!canChangeVisit(sched, other, roster), "b3 #35: a teammate who is neither lead nor approver cannot");
  ok(canChangeVisit(sched, approver, roster) && canChangeVisit(sched, { ...other, roles: ["Manager"] }, roster) && canChangeVisit(sched, { ...other, roles: ["Admin"] }, roster),
    "b3 #35: anyone holding approve (Reviewer / Manager / Admin) can");
  const amb = { stage: "scheduled", assignedTo: "Pat Lee" };
  ok(!isVisitLead(amb, { id: "u3", name: "Pat Lee" }, roster) && !canChangeVisit(amb, { id: "u3", name: "Pat Lee", roles: ["Estimator"] }, roster) && canChangeVisit(amb, approver, roster),
    "b3 #35: an ambiguous lead name (#349: a namesake on the roster, any status) is nobody's — approvers only");
  ok(!canChangeVisit({ stage: "scheduled", assignedTo: "" }, tech, roster), "b3 #35: a scheduled visit with no lead is approvers-only");
  ok(canChangeVisit({ stage: "claimed", assignedTo: "Jeff Chesebro" }, tech, roster) && canChangeVisit({ stage: "open" }, tech, roster),
    "b3 #35: request-pool visits keep their own claim model (not restricted here)");
  const ba = src("src/app/(app)/visit-booking-actions.ts");
  const gate = "if (!canChangeVisit(v, me, await allUsers())) return { ok: false, error: VISIT_EDIT_REFUSAL };";
  const before = (text: string, a: string, b: string) => text.indexOf(a) >= 0 && text.indexOf(b) > text.indexOf(a);
  ok(before(ba, 'if (v.stage !== "scheduled")', gate) && before(ba, gate, "await updateVisitBooking("),
    "b3 #35 pin: updateVisitAction refuses before it writes (edit / re-lead)");
  const va = src("src/app/(app)/venue-assessments/visit-actions.ts");
  const rm = va.slice(va.indexOf("export async function removeVisitAction"), va.indexOf("export async function scheduleVisitAction"));
  const sc = va.slice(va.indexOf("export async function scheduleVisitAction"));
  ok(before(rm, gate, "await cancelVisitInvites(v") && before(rm, gate, "await removeVisit(id)"), "b3 #35 pin: removeVisitAction refuses before cancelling invites or deleting");
  ok(before(sc, gate, "await scheduleVisit(id"), "b3 #35 pin: scheduleVisitAction refuses to re-time a scheduled visit before it writes");
  const cp = src("src/app/(app)/companies/[id]/page.tsx");
  ok(cp.includes("canEdit={canChangeVisit(v, me, visitRoster)}") && cp.includes("<DeleteVisitButton id={v.id} canDelete={canChangeVisit(v, me, visitRoster)} />"),
    "b3 #35 pin: the company record shows read-only Edit / Delete to everyone else");
  ok(/if \(!canEdit\)[\s\S]{0,200}disabled/.test(src("src/components/visit-booking/visit-edit-button.tsx")) && VISIT_EDIT_REFUSAL.includes("lead or an approver"),
    "b3 #35 pin: the read-only Edit is a disabled control");
  ok(!/from "@\/lib\/stores|from "@\/db/.test(src("src/lib/visit-edit-rights.ts")), "b3 #35 pin: the rule module is store-free");
}

/* ------------------------------------------------------------------ #8 rigging depth ------------------------------------------------------------------ */

async function rigDepthChecks(ok: Ok) {
  const def = ASSESSMENT_DEF;
  const rig = def.scopes.find((x) => x.code === "S2")!;
  const sys = rig.modules.find((m) => m.id === "rigging.system")!;
  ok(sys.questions[0].key === "rigging.depth" && sys.questions[0].type === "one" && sys.questions[0].options === "rig_depth" && !sys.questions[0].required,
    "b3 #8: rigging asks its depth first, in the form (one scope, a toggle — not two scopes)");
  ok(def.pickLists.rig_depth.map((o) => o.value + "=" + o.label).join() === "screen=Quick check,full=Full inspection" && FIXED_PICK_LISTS.has("rig_depth"),
    "b3 #8: Quick check / Full inspection, a fixed list (values match the scope depth)");
  const refused = await addPicklistValue("rig_depth", "Medium");
  ok(!refused.ok && refused.error === "This list is fixed", "b3 #8: an admin can't add a third depth");
  ok(def.version === 1 && def.rules.some((r) => r.id === "R6") && def.rules.some((r) => r.id === "R7") && allQuestions(def).get("rigging.depth")?.scope === "S2",
    "b3 #8: additive change — defVersion stays 1, R6 / R7 keep their ids, the key is new");

  const base = { def, visitType: "condition", profile: {}, photos: [], dismissed: [], resolved: [], now: Date.UTC(2026, 9, 15) };
  const sc = def.visitTypes.find((v) => v.key === "condition")!.scopes.map((x) => ({ ...x }));
  const A = (v: unknown): Answer => ({ v, state: "answered", at: 1, by: "u1" });
  const ev = (answers: Answers, extra: Partial<EvalInput> = {}) => evaluate({ ...base, scopes: sc, answers, ...extra });
  const FULL = ["rigging.dimensions", "rigging.lineset_schedule", "rigging.hardware_inventory"];
  const QUICK = ["rigging.system", "rigging.screen", "rigging.counterweight", "rigging.wire_rope"];
  const cw = { "rigging.overhead": A("counterweight") };
  const legacy = ev(cw);
  ok(legacy.visible.has("rigging.depth") && FULL.every((m) => !legacy.visibleModules.has(m)) && QUICK.every((m) => legacy.visibleModules.has(m)),
    "b3 #8: no depth answered on a Condition assessment = Quick check (as every assessment before the toggle evaluated)");
  const quick = ev({ ...cw, "rigging.depth": A("screen") });
  ok([...quick.visibleModules].sort().join() === [...legacy.visibleModules].sort().join() && [...quick.visible].sort().join() === [...legacy.visible].sort().join(),
    "b3 #8: answering Quick check evaluates exactly like no answer (existing assessments unchanged)");
  const full = ev({ ...cw, "rigging.depth": A("full") });
  ok(FULL.every((m) => full.visibleModules.has(m)) && QUICK.every((m) => full.visibleModules.has(m)) && full.visible.has("rigging.plaster_to_rear") && full.visible.has("rigging.lineset_table"),
    "b3 #8: Full inspection adds R7's modules (dimensions, install history, line set schedule, hardware inventory) on top of the quick check");
  const scFull = sc.map((x) => (x.code === "S2" ? { ...x, depth: "full" as const } : x));
  ok(FULL.every((m) => ev(cw, { scopes: scFull }).visibleModules.has(m)) && FULL.every((m) => !ev({ ...cw, "rigging.depth": A("screen") }, { scopes: scFull }).visibleModules.has(m)),
    "b3 #8: unanswered reads the scope's own depth (a visit type's default); the answer wins over it");
  ok(!ev({ "rigging.overhead": A("none"), "rigging.depth": A("full") }).visibleModules.has("rigging.lineset_schedule") && !ev({ "rigging.overhead": A("none") }).visible.has("rigging.depth"),
    "b3 #8: with no overhead rigging (R1) the depth isn't asked and full-inspection modules stay skipped");

  // Answers carry over when a quick check becomes a full inspection (and back).
  const table = A([{ set: "1", distance: "2'0\"", hangs: "Main valance" }]);
  const fullAnswers: Answers = { ...cw, "rigging.depth": A("full"), "rigging.lineset_table": table, "rigging.plaster_to_rear": A(480), "rigging.total_sets": A(30) };
  const asQuick: Answers = { ...fullAnswers, "rigging.depth": A("screen") };
  const q1 = ev(asQuick);
  ok(!q1.visible.has("rigging.lineset_table") && !q1.visible.has("rigging.plaster_to_rear") && q1.visible.has("rigging.total_sets") && asQuick["rigging.lineset_table"] === table,
    "b3 #8: switching to Quick check hides the full-inspection answers but keeps them stored");
  const back = ev({ ...asQuick, "rigging.depth": A("full") });
  ok(back.visible.has("rigging.lineset_table") && back.visible.has("rigging.plaster_to_rear") && back.progress.rigging.done > q1.progress.rigging.done,
    "b3 #8: switching back to Full inspection brings them back answered (they count toward progress again)");
  ok(riggingDepth({}, sc) === "screen" && riggingDepth({ "rigging.depth": A("full") }, sc) === "full" && riggingDepth({}, scFull) === "full" && riggingDepth({ "rigging.depth": A("screen") }, scFull) === "screen",
    "b3 #8: riggingDepth — the answer, else the scope default");
  const rm = src("src/lib/assessments/report-model.ts");
  ok(rm.includes('{ screen: "Quick check", full: "Full inspection" }') && /s\.code === "S2" \? riggingDepth\(/.test(rm), "b3 #8 pin: the report names the depth in force: Quick check / Full inspection");
  ok(/Quick check = everything the brief's R6 keeps/.test(src("src/lib/assessments/defs/scopes/rigging.ts")),
    "b3 #8: the quick/full split is documented in the S2 definition");
}

/* ------------------------------------------------------------------ #10 assessment reminders ------------------------------------------------------------------ */

const DAY = 86_400_000;

function reminderChecks(ok: Ok) {
  const now = Date.UTC(2026, 9, 15, 15);
  ok(REMINDER_LEAD_DAYS === 30 && inReminderWindow(now + 30 * DAY, now) && inReminderWindow(now + 1, now) && !inReminderWindow(now + 31 * DAY, now) && !inReminderWindow(now - DAY, now) && !inReminderWindow(null, now),
    "b3 #10: a reminder is due from 30 days before the date until the date itself");
  const f = (key: string, extra: Partial<ReminderFinding>): ReminderFinding => ({ key, printedId: "MPSD-LIN-RIG-00" + key.slice(-1), customerId: "co1", siteId: "st1", assessmentId: "AS-1001", category: "RIG", description: "Fire curtain test", ...extra });
  const findings = [
    f("fd1", { nextDue: now + 20 * DAY }),
    f("fd2", { nextDue: now + 45 * DAY }),
    f("fd3", { nextDue: now - 2 * DAY }),
    f("fd4", { nextDue: now + 5 * DAY, voided: { by: "x", at: 1, reason: "dup" } }),
    f("fd5", {}),
    f("fd6", { nextDue: now + 10 * DAY, customerId: "co2", assessmentId: "AS-1002" }),
  ];
  const base = {
    findings,
    venues: [{ siteId: "st1", customerId: "co1", nextAssessmentAt: now + 25 * DAY }, { siteId: "st2", customerId: "co2", nextAssessmentAt: now + 60 * DAY }, { siteId: "st3", customerId: "co3", nextAssessmentAt: now + 3 * DAY }],
    assessments: [
      { id: "AS-1001", siteId: "st1", createdBy: "u7", visitDate: 1 },
      { id: "AS-1002", siteId: "st2", createdBy: "u8", visitDate: 1 },
      { id: "AS-1003", siteId: "st3", createdBy: "u7", visitDate: 1 },
      { id: "AS-1004", siteId: "st3", createdBy: "u8", visitDate: 9 },
    ],
    owners: new Map<string, string | null>([["co1", "u1"], ["co2", "u-gone"], ["co3", null]]),
    activeUserIds: new Set(["u1", "u7", "u8"]),
    siteNames: new Map([["st1", "Lincoln HS — Auditorium"]]),
    dayLabel: (ms: number) => new Date(ms).toISOString().slice(0, 10),
    now,
  };
  const plans = planReminders(base);
  ok(plans.filter((x) => x.kind === "finding").map((x) => x.ref).join() === "fd1,fd6", "b3 #10: one reminder per live finding with a next-due date inside the window (not later, not past, not voided, not undated)");
  ok(plans.filter((x) => x.kind === "venue").map((x) => x.ref).join() === "st1,st3", "b3 #10: one per venue whose next assessment falls inside the window");
  const p1 = plans.find((x) => x.ref === "fd1")!, p6 = plans.find((x) => x.ref === "fd6")!, v1 = plans.find((x) => x.ref === "st1")!, v3 = plans.find((x) => x.ref === "st3")!;
  ok(p1.assigneeUserId === "u1" && v1.assigneeUserId === "u1", "b3 #10: assigned to the venue's account rep (the company owner)");
  ok(p6.assigneeUserId === "u8", "b3 #10: an owner who is no longer active falls back to the assessment's creator");
  ok(v3.assigneeUserId === "u8", "b3 #10: with no owner a venue reminder goes to the creator of its most recent assessment");
  ok(planReminders({ ...base, activeUserIds: new Set() }).every((x) => x.assigneeUserId === null), "b3 #10: nobody active → an unassigned task, never a guess");
  ok(p1.dueAt === now + 20 * DAY && p1.title.includes("MPSD-LIN-RIG-001") && p1.title.includes("Lincoln HS — Auditorium") && v3.title.includes("the venue"), "b3 #10: the task is due on the date and names the finding / venue");
  ok(p1.id === reminderTaskId("finding", "fd1", now + 20 * DAY) && p1.id === planReminders(base).find((x) => x.ref === "fd1")!.id && /^T-asr-f-fd1-\d{8}$/.test(p1.id) && /^T-asr-v-st1-\d{8}$/.test(v1.id),
    "b3 #10: deterministic task ids (record + due day) — the sweep is idempotent");
  ok(reminderTaskId("finding", "fd1", now + 21 * DAY) !== p1.id, "b3 #10: a moved due date gets its own reminder");
  const route = src("src/app/api/drive/sync/route.ts");
  ok(/runAssessmentReminders\(\{ deadlineMs: started \+ 10_000 \}\)/.test(route) && route.indexOf("runAssessmentReminders(") < route.indexOf("syncAllDrivers("), "b3 #10 pin: the daily drive cron runs the reminders first, inside a 10 s deadline");
  ok(/after\(maybeRunAssessmentReminders\)/.test(src("src/app/(app)/assessments/page.tsx")), "b3 #10 pin: the Assessments page runs them lazily (throttled)");
  const act = src("src/app/(app)/assessments/reminder-actions.ts");
  ok(/await requirePerm\("create"\);[\s\S]*getSite\(siteId\)[\s\S]*setNextAssessmentAt\(site\.id, site\.companyId, at\)/.test(act), "b3 #10 pin: setting a venue's next assessment needs `create` and a real venue");
  ok(!/from "@\/lib\/stores|from "@\/db/.test(src("src/components/assessments/next-assessment-edit.tsx")) && !/from "@\/lib\/stores|from "@\/db/.test(src("src/lib/assessments/reminders.ts")), "b3 #10 pin: the client control and the planner import no store");
}

async function reminderDbChecks(ok: Ok) {
  const db = await getDb();
  const PFX = "TESTb3r:";
  const now = Date.now();
  const F1 = PFX + "fd1", F2 = PFX + "fd2", SITE = PFX + "st1", CO = PFX + "co1", AS = PFX + "AS1";
  const ids = [reminderTaskId("finding", F1, now + 12 * DAY), reminderTaskId("venue", SITE, now + 20 * DAY)];
  const cleanup = async () => {
    await db.delete(DOC_TABLES.tasks).where(inArray(DOC_TABLES.tasks.id, ids));
    for (const [coll, id] of [["findings", F1], ["findings", F2], ["assessments", AS], ["venue_profiles", SITE]] as const)
      await db.delete(DOC_TABLES[coll]).where(inArray(DOC_TABLES[coll].id, [id]));
    await db.delete(sites).where(like(sites.id, PFX + "%"));
    await db.delete(companies).where(like(companies.id, PFX + "%"));
  };
  try {
    await cleanup();
    await saveCompany({ id: CO, name: "B3 Reminder Co", type: "customer", lifecycle: "active", deleted: false, ownerUserId: "u1" });
    await saveSite({ id: SITE, companyId: CO, name: "B3 Reminder Hall", locationName: "B3 Reminder Hall", venueKind: "proscenium" });
    const ins = async (coll: "findings" | "assessments", id: string, doc: Record<string, unknown>) =>
      db.insert(DOC_TABLES[coll]).values({ id, doc: { ...doc, id }, rev: 1, updatedAt: now, receivedAt: now, review: { state: "new" }, deleted: false });
    await ins("assessments", AS, { customerId: CO, siteId: SITE, status: "completed", visitDate: now - 300 * DAY, assessorId: "u1", createdBy: "u1", answers: {}, scopes: [], photos: [], dismissedPrompts: [], visitType: "condition", createdAt: now, updatedAt: now });
    await ins("findings", F1, { key: F1, customerId: CO, siteId: SITE, assessmentId: AS, category: "RIG", rating: "needs", description: "Fire curtain drop test", status: "closed", nextDue: now + 12 * DAY, createdAt: now, updatedAt: now, createdBy: "u1" });
    await ins("findings", F2, { key: F2, customerId: CO, siteId: SITE, assessmentId: AS, category: "RIG", rating: "needs", description: "Later", status: "closed", nextDue: now + 90 * DAY, createdAt: now, updatedAt: now, createdBy: "u1" });
    await setNextAssessmentAt(SITE, CO, now + 20 * DAY);
    ok((await getVenueProfile(SITE))?.nextAssessmentAt === Math.round(now + 20 * DAY), "b3 #10 db: a venue's next assessment date is stored on its profile (the new minimal field)");
    const r1 = await runAssessmentReminders({ now });
    const rows = await getDocRows<{ id: string; assigneeUserId: string | null; dueAt: number; customerId: string; siteId: string; title: string }>("tasks", ids);
    ok(rows.length === 2 && rows.every((r) => !r.deleted && r.doc.assigneeUserId === "u1" && r.doc.customerId === CO) && r1.created >= 2,
      "b3 #10 db: the sweep creates the finding and venue reminders, assigned to the account rep: " + JSON.stringify(r1));
    ok(rows.find((r) => r.id === ids[0])!.doc.dueAt === now + 12 * DAY && rows.find((r) => r.id === ids[0])!.doc.siteId === SITE, "b3 #10 db: due on the finding's date, linked to the venue");
    const r2 = await runAssessmentReminders({ now });
    ok(r2.created === 0 && (await getDocRows("tasks", ids)).length === 2, "b3 #10 db: a second run creates nothing (idempotent)");
    await softDeleteDoc("tasks", ids[0]);
    const r3 = await runAssessmentReminders({ now });
    const after3 = await getDocRows("tasks", [ids[0]]);
    ok(r3.created === 0 && after3.length === 1 && after3[0].deleted, "b3 #10 db: a reminder someone deleted is never re-created");
    await setNextAssessmentAt(SITE, CO, null);
    ok((await getVenueProfile(SITE))?.nextAssessmentAt === undefined, "b3 #10 db: clearing the date removes it");
  } finally {
    await cleanup();
  }
}

/* ------------------------------------------------------------------ entry points ------------------------------------------------------------------ */

export async function batch3PureChecks(ok: Ok) {
  listPagingChecks(ok);
  pipelineChecks(ok);
  phasePickerChecks(ok);
  visitRightsChecks(ok);
  await rigDepthChecks(ok);
  reminderChecks(ok);
}

export async function batch3DbChecks(ok: Ok) {
  await listDbChecks(ok);
  await pipelineDbChecks(ok);
  await phaseDbChecks(ok);
  await reminderDbChecks(ok);
}

if (process.argv[1]?.endsWith("test-oct15-batch3.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  batch3PureChecks(okf)
    .then(() => (db ? batch3DbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
