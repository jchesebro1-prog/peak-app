import { matchBom, assemble, renderSpecHtml, report, type MatchedRow } from "@/lib/bid-spec";
import { parseCsv } from "@/app/(app)/design/engagements/spec/parse-bom";
import { approvalIsStale, openChecklistItems } from "@/lib/consulting-review";
import type { EngagementPhase } from "@/lib/stores/engagements";
import {
  msOf as opMsOf,
  serviceToWorkItems,
  WORK_TYPE_META,
  startOfDay as opStartOfDay,
} from "@/lib/operations-work";
import { venueDimsFromEstimator, venueDimsFromLineset, DEFAULT_VENUE_DIMS } from "@/lib/design/venue-dims";
import { curtainCost, curtainPrice, makingRateFor, DEFAULT_MAKING_RATE, DEFAULT_CYC_MAKING_RATE, SEED_FABRIC_RATES } from "@/lib/design/curtain-pricing";
import { DEFAULT_SETTINGS } from "@/db/seed-data";
import { accentContrast } from "@/lib/color";
import { emailFor, legacyEmailFor } from "@/lib/team";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };

/* --- BOM parsing --- */
const p = parseCsv("sku,description,qty\nS4LED,Source Four LED,12\n,Mystery fixture,3\nJUNK");
ok(p.ok, "parses CSV with header aliases");
if (p.ok) ok(p.rows.length === 3, `keeps all usable rows (got ${p.rows.length})`);
const bad = parseCsv("just one line");
ok(!bad.ok, "rejects a single-line paste");

/* --- matching --- */
const catalog = [
  { id: "S4LED", sku: "S4LED", desc: "ETC Source Four LED Series 2", category: "Lighting", unit: "ea", list: 1200, cost: 800, specSectionId: "ss-light", specBody: "Provide LED ellipsoidal.\n\nColor rendering index 90 minimum." },
  { id: "CYC1", sku: "CYC1", desc: "Cyclorama fixture 4-cell", category: "Lighting", unit: "ea", list: 900, cost: 600 },
] as any[];

const rep = matchBom(
  [ { sku: "S4LED", desc: "Source Four LED", qty: 12 },
    { sku: "CYC1", desc: "Cyc light", qty: 4 },
    { sku: "NOPE", desc: "ETC Source Four LED Series 2", qty: 1 } ],
  catalog
);
ok(rep.counts.ready === 1, `exact SKU with spec text -> ready (${rep.counts.ready})`);
ok(rep.counts["no-spec"] === 1, `exact SKU without spec text -> no-spec (${rep.counts["no-spec"]})`);
ok(rep.counts["no-match"] === 1, `unknown SKU -> no-match (${rep.counts["no-match"]})`);
ok(rep.rows[2].candidates.length > 0, "unmatched row gets similarity candidates");
ok(rep.rows[2].part === null, "candidates are SUGGESTED, never auto-assigned");
ok(!rep.finalizable, "cannot finalize while rows are unresolved");

const waived = rep.rows.map((r, i) => i === 0 ? r : { ...r, waived: true, waiveReason: "n/a" });
ok(report(waived).finalizable, "finalizable once every row is ready or waived");

/* --- assembly --- */
const spec = assemble(
  rep.rows.map((r, i) => i === 1 ? { ...r, waived: true, waiveReason: "owner-furnished" } : r) as MatchedRow[],
  [{ id: "ss-light", number: "26 55 61", title: "Theatrical Lighting Fixtures", sort: 40, part1: "Scope of work.", part3: "Install per manufacturer.", updatedAt: 0, updatedBy: "t" }],
  { projectName: "Test PAC", customer: "Test District", engagementId: "CE-1001", preparedBy: "Jeff", date: Date.now() }
);
ok(spec.sections.length === 1, "assembles one section from the ready row");
ok(spec.sections[0].parts.length === 1, "only ready rows contribute Part 2 text");
ok(spec.waived.length === 1, "waived rows are recorded, not rendered as specs");

const html = renderSpecHtml(spec);
ok(html.includes("SECTION 26 55 61"), "renders the CSI section heading");
ok(html.includes("PART 1 — GENERAL") && html.includes("PART 2 — PRODUCTS") && html.includes("PART 3 — EXECUTION"), "renders all three CSI parts");
ok(html.includes("2.01"), "numbers products automatically");
ok(html.includes("ITEMS NOT SPECIFIED"), "documents the deliberate omission");
ok(!html.includes("<script"), "no script injection in output");

/* --- approval staleness --- */
const phase = (docs: any[], pin: any): EngagementPhase => ({ id: "ph-1", name: "Final Documents", status: "active", review: {} as any, attachments: docs, checklist: [{ id: "ck1", text: "x", state: "open", by: null, at: null, reason: "" }], approvalPin: pin });
const d1 = { id: "ed-1", name: "A.pdf", mime: "application/pdf", size: 10, dataUrl: "", addedBy: "j", addedAt: 100 };
const pin = { at: 1, by: "Jack", snapshotId: "rs-1", docs: [{ docId: "ed-1", name: "A.pdf", size: 10, version: 100 }] };
ok(!approvalIsStale(phase([d1], pin)), "approval is fresh when documents are unchanged");
ok(approvalIsStale(phase([{ ...d1, id: "ed-2", addedAt: 200 }], pin)), "approval goes stale when a document is replaced");
ok(approvalIsStale(phase([], pin)), "approval goes stale when a document is removed");
ok(openChecklistItems(phase([d1], pin)).length === 1, "open checklist items are detected");


/* --- annotation geometry (D95) --- */
import { bounds, hitTest, cloudPath, polyPath, isDragTool } from "@/lib/annotations";
import type { Annotation } from "@/lib/annotations";

const ann = (pts: Array<{x:number;y:number}>, tool: any = "rect"): Annotation =>
  ({ id:"a1", docId:"d1", page:1, tool, color:"#d5342a", points:pts, text:"", author:"J", at:0, commentId:null });

const b = bounds([{x:.2,y:.3},{x:.5,y:.1}]);
ok(Math.abs(b.x-.2)<1e-9 && Math.abs(b.y-.1)<1e-9, "bounds takes min corner regardless of drag direction");
ok(Math.abs(b.w-.3)<1e-9 && Math.abs(b.h-.2)<1e-9, "bounds computes width/height");

const boxAnn = ann([{x:.2,y:.2},{x:.4,y:.4}]);
ok(hitTest(boxAnn, {x:.3,y:.3}), "hit inside the mark");
ok(hitTest(boxAnn, {x:.205,y:.205}), "hit near the edge (generous target)");
ok(!hitTest(boxAnn, {x:.8,y:.8}), "miss far away");

// Normalized coords must be zoom-independent: same fractions, different page px.
const small = polyPath([{x:0,y:0},{x:1,y:1}], 100, 100);
const large = polyPath([{x:0,y:0},{x:1,y:1}], 1000, 1000);
ok(small === "M 0 0 L 100 100", "polyline scales to page pixels (small)");
ok(large === "M 0 0 L 1000 1000", "same normalized points scale up (zoom independence)");

const cp = cloudPath([{x:.1,y:.1},{x:.5,y:.4}], 900, 1200);
ok(cp.startsWith("M ") && cp.includes("a ") && cp.endsWith("z"), "cloud path is a closed run of arcs");
ok(cloudPath([{x:.1,y:.1},{x:.1005,y:.1005}], 900, 1200) === "", "degenerate cloud produces no path");

ok(isDragTool("rect") && isDragTool("arrow") && !isDragTool("freehand"), "drag tools classified");


/* --- calibration & measurement (D96) --- */
import { pageDistance, calibrationScale, measureLength, formatMeasure } from "@/lib/annotations";
import type { Calibration } from "@/lib/annotations";

// A letter page: 612x792 => aspect 1.294
const ASPECT = 792 / 612;

// Horizontal and vertical lines of the SAME real length must measure the same.
const dH = pageDistance({x:.1,y:.5}, {x:.6,y:.5}, ASPECT);          // half the width
const dV = pageDistance({x:.5,y:.1}, {x:.5,y:.1 + .5/ASPECT}, ASPECT); // same real span vertically
ok(Math.abs(dH - dV) < 1e-9, "aspect correction makes x and y measure equally");

const scale = calibrationScale({x:.1,y:.5}, {x:.6,y:.5}, ASPECT, 40)!;
ok(Math.abs(scale - 80) < 1e-9, "scale = real length per page width (40ft over half a page => 80)");

const cal: Calibration = { docId:"d", page:1, scale, unit:"ft", refLength:40, by:"J", at:0 };
const half = measureLength([{x:.1,y:.5},{x:.6,y:.5}], ASPECT, cal)!;
ok(Math.abs(half - 40) < 1e-9, "measuring the calibration line returns its real length");
const quarter = measureLength([{x:.1,y:.5},{x:.35,y:.5}], ASPECT, cal)!;
ok(Math.abs(quarter - 20) < 1e-9, "half the reference measures half the length");
const diag = measureLength([{x:0,y:0},{x:.6,y:.5}], ASPECT, cal)!;
ok(diag > 40, "diagonal accounts for both axes");
ok(measureLength([{x:0,y:0},{x:1,y:0}], ASPECT, null) === null, "uncalibrated pages report no measurement");

ok(formatMeasure(12.5, "ft") === `12'-6"`, "feet render as feet-inches");
ok(formatMeasure(11.999, "ft") === `12'-0"`, "rounding up 12in carries to the next foot");
ok(formatMeasure(2.5, "m") === "2.50 m", "metric renders with units");


/* --- design module route map (D97) --- */
import { designRedirect } from "@/lib/design-routes";

ok(designRedirect("/consulting", {}) === "/design/engagements",
  "consulting list redirects to engagements");
ok(designRedirect("/consulting/CE-1001", {}) === "/design/engagements/CE-1001",
  "engagement detail keeps its id");
ok(designRedirect("/consulting/CE-1001", { tab: "phases" }) === "/design/engagements/CE-1001?tab=phases",
  "engagement detail preserves ?tab=");
ok(designRedirect("/consulting/markup", { eng: "CE-1001", phase: "ph-2", doc: "ed-3" })
     === "/design/engagements/markup?eng=CE-1001&phase=ph-2&doc=ed-3",
  "markup preserves all three params in order");
ok(designRedirect("/design-studio", {}) === "/design",
  "design-studio overview redirects to the new Design overview");
ok(designRedirect("/design-studio/steel", {}) === "/design/steel",
  "calculators keep their leaf name");
ok(designRedirect("/design-studio/lineset", { design: "DS-abc" }) === "/design/lineset?design=DS-abc",
  "lineset preserves its ?design= deep link");
ok(designRedirect("/design-studio/weights", { design: "DS-abc" }) === "/design/lineset?design=DS-abc",
  "weights was folded into lineset — it must not land on a nonexistent /design/weights page");
ok(designRedirect("/design", { id: "D-101" }) === "/design/designs?id=D-101",
  "old sandbox deep link lands on the designs list");
ok(designRedirect("/design", {}) === null,
  "bare /design is the Overview and must NOT redirect");
ok(designRedirect("/quotes", {}) === null,
  "unrelated paths are not redirected");
ok(designRedirect("/consulting/CE-1001", { tab: "bogus" }) === "/design/engagements/CE-1001?tab=bogus",
  "unknown tab values pass through — the destination validates, not the redirect");

/* --- design module nav (D97) --- */
import { activeKeyFor, NAV, parentGroupOf } from "@/components/nav/nav-data";

ok(activeKeyFor("/design") === "designoverview",
  "the Design overview resolves to the designoverview key");
ok(activeKeyFor("/design/engagements") === "designoverview",
  "/design/engagements resolves to the designoverview key");
ok(activeKeyFor("/design/steel") === "designoverview",
  "/design/steel resolves to the designoverview key (segment-1 matching)");
ok(NAV.some((e) => e.kind === "group" && e.key === "design"),
  "Design exists as a nav group");
ok(!NAV.some((e) => e.kind === "link" && e.key === "consulting"),
  "the standalone Consulting link is gone");
ok(!NAV.some((e) => e.kind === "group" && e.key === "designstudio"),
  "the Design Studio group is gone");
const designGroup = NAV.find((e) => e.kind === "group" && e.key === "design");
/* Assert the exact keys, not just the count: when a screen is added or moved
 * this reports WHICH child changed. The Fixture Cross-Ref screen joined the
 * group after D97 shipped, which is why a bare `length === 6` went stale. */
const DESIGN_CHILDREN = [
  "designoverview", "engagements", "designs", "grid",
  "steel", "lineset", "motors", "fixtures",
];
ok(
  !!designGroup && designGroup.kind === "group" &&
    JSON.stringify(designGroup.children.map((c) => c.key)) === JSON.stringify(DESIGN_CHILDREN),
  `Design's children are exactly [${DESIGN_CHILDREN.join(", ")}]`);

/* --- home tabbed hub (D98) ---
 * homeTabFor() was deleted (final-review Fix 2): every hub route is a
 * server component that already knows which tab it is, so the four call
 * sites pass a hardcoded `active="…"` literal instead of resolving one from
 * a pathname — a literal cannot mis-resolve the way a lookup function could,
 * and nothing in src/scripts ever called the resolver. HOME_TABS itself is
 * still live (HomeTabs renders it), so it stays covered here. */
import { HOME_TABS } from "@/app/(app)/home-tabs-keys";
import {
  resolveSettingsSection,
  ADMIN_SCREENS,
  SETTINGS_SECTIONS,
} from "@/app/(app)/settings/settings-sections";

ok(HOME_TABS.length === 5, "five Home tabs after Reports joins (D99)");
ok(HOME_TABS[0].key === "dashboard", "Dashboard is first and is the landing tab");

/* --- home hub nav (D98) --- */
ok(NAV.length === 4, "the header keeps 4 top-level items (chips, D117)");
ok(!NAV.some((e) => e.kind === "link" && e.key === "queue"), "My Queue is no longer top-level");
ok(!NAV.some((e) => e.kind === "link" && e.key === "calendar"), "Calendar is no longer top-level");
ok(!NAV.some((e) => e.kind === "link" && e.key === "inbox"), "Inbox is no longer top-level");
ok(!NAV.some((e) => e.kind === "link" && e.key === "home"), "Home is no longer a tab — the Q6 mark is the home link (D117)");
ok(activeKeyFor("/") === "home", "root lights Home");
ok(activeKeyFor("/queue") === "home", "queue lights Home");
ok(activeKeyFor("/calendar") === "home", "calendar lights Home — this path had NO map entry before");
ok(activeKeyFor("/inbox") === "home", "inbox lights Home");
ok(activeKeyFor("/reports") === "home", "Reports lights Home now that it is a Home tab (D99)");

// ---- General dissolution (D99): Companies/People/Field Survey → Sales (now CRM, D117) ----
const d99Sales = NAV.find((e) => e.kind === "group" && e.key === "crm");
ok(
  !!(d99Sales && d99Sales.kind === "group" && d99Sales.children.length === 5),
  "CRM has five children — Quotes and Reviews moved to EST (D117)",
);
ok(
  !!(
    d99Sales &&
    d99Sales.kind === "group" &&
    d99Sales.children.map((c) => c.key).join(",") ===
      "leads,companies,people,venues,field"
  ),
  "CRM children are leads, companies, people, venues, field in order",
);
ok(
  parentGroupOf("companies") === "crm" &&
    parentGroupOf("people") === "crm" &&
    parentGroupOf("field") === "crm",
  "companies, people, field now report CRM as their parent group",
);
const d99Keys = NAV.flatMap((e) =>
  e.kind === "group" ? [e.key, ...e.children.map((c) => c.key)] : [e.key],
);
ok(
  d99Keys.length === new Set(d99Keys).size,
  "all nav keys (groups + children) are globally unique — no duplicate left behind",
);

// ---- Venues directory (D101): the venues child + route ----
ok(activeKeyFor("/venues") === "venues", "/venues lights the venues key");
ok(activeKeyFor("/venues/st-lakefront-1") === "venues", "/venues/[id] resolves to venues (segment-1)");
ok(parentGroupOf("venues") === "crm", "venues reports CRM as its parent group (D117)");

// ---- General dissolution (D99): Reports is a Home tab ----
ok(
  HOME_TABS.some((t) => t.key === "reports" && t.href === "/reports"),
  "Reports is present in HOME_TABS with its own route",
);

// ---- General dissolution (D99): Settings sections + Admin ----
ok(resolveSettingsSection(undefined) === "general", "no ?section= defaults to general");
ok(resolveSettingsSection("nope") === "general", "an unknown ?section= falls back to general");
ok(resolveSettingsSection("team") === "team", "?section=team is honored");
ok(resolveSettingsSection("admin") === "admin", "?section=admin is honored");
ok(resolveSettingsSection(["admin", "team"]) === "admin", "an array ?section= takes the first value");
ok(
  SETTINGS_SECTIONS.map((s) => s.key).join(",") === "general,team,admin",
  "Settings exposes general, team, admin sections in order",
);
ok(ADMIN_SCREENS.length === 4, "Admin lists exactly four screens");
ok(
  ADMIN_SCREENS.map((s) => s.href).join(",") ===
    "/catalog,/templates,/estimating-rules,/import",
  "Admin links Catalog, Templates, Estimating Rules, Import — by their own routes",
);

// ---- General dissolution (D99): the group is gone ----
ok(!NAV.some((e) => e.kind === "group" && e.key === "general"), "the General group is gone");
ok(
  NAV.map((e) => e.key).join(",") === "est,pm,crm,design",
  "the four top-level chips are EST, PM, CRM, DESIGN in order (D117)",
);
ok(
  activeKeyFor("/catalog") === "settings" &&
    activeKeyFor("/templates") === "settings" &&
    activeKeyFor("/estimating-rules") === "settings" &&
    activeKeyFor("/import") === "settings",
  "catalog, templates, estimating-rules, import all light Settings",
);

// ---- Operations merge (D100): Installs + Service → Operations (now PM, D117) ----
const d100Ops = NAV.find((e) => e.kind === "group" && e.key === "pm");
ok(
  !!(d100Ops && d100Ops.kind === "group" && d100Ops.children.length === 6),
  "PM has six children",
);
ok(
  !!(
    d100Ops &&
    d100Ops.kind === "group" &&
    d100Ops.children.map((c) => c.key).join(",") ===
      "projects,schedule,fieldwork,flametests,inspections,repairs"
  ),
  "PM children are projects, schedule, fieldwork, flametests, inspections, repairs in order",
);
ok(!NAV.some((e) => e.kind === "group" && e.key === "installs"), "the Installs group is gone");
ok(!NAV.some((e) => e.kind === "group" && e.key === "service"), "the Service group is gone");
ok(
  parentGroupOf("projects") === "pm" &&
    parentGroupOf("schedule") === "pm" &&
    parentGroupOf("fieldwork") === "pm" &&
    parentGroupOf("flametests") === "pm" &&
    parentGroupOf("inspections") === "pm" &&
    parentGroupOf("repairs") === "pm",
  "all six work children report PM as their parent group",
);

// ---- Operations merge (D100): pure work normalization ----
// msOf: strict local midnight; '' and malformed -> null (never epoch 0, never UTC-shifted)
ok(opMsOf("") === null, "msOf('') is null (unset is excluded, not epoch 0)");
ok(opMsOf(undefined) === null, "msOf(undefined) is null");
ok(opMsOf("not-a-date") === null, "msOf of a non-ISO string is null (no UTC fallback)");
ok(
  opMsOf("2026-07-20") === new Date(2026, 6, 20).getTime(),
  "msOf parses YYYY-MM-DD as LOCAL midnight (agrees with the job's own screen)",
);
// A date that naive `new Date('2026-01-01')` would render as Dec 31 west of UTC:
ok(
  opMsOf("2026-01-01") === new Date(2026, 0, 1).getTime(),
  "msOf('2026-01-01') is local Jan 1, not UTC (no day shift)",
);

const svc = [
  { id: "A", customer: "Alpha HS", venue: "Auditorium", assignedTo: "Nic", scheduledDate: "2026-07-20", stage: "scheduled" },
  { id: "B", customer: "Beta MS", venue: "Gym", assignedTo: "", scheduledDate: "2026-07-21", stage: "onsite" },
  { id: "C", customer: "Gamma HS", venue: "Theater", assignedTo: "Nic", scheduledDate: "", stage: "scheduled" }, // unset date -> excluded
  { id: "D", customer: "Delta HS", venue: "PAC", assignedTo: "Jena", scheduledDate: "2026-07-22", stage: "completed" }, // done -> excluded
];
const svcItems = serviceToWorkItems(svc, "inspection", (id) => "/inspections/" + id);
ok(svcItems.length === 2, "serviceToWorkItems drops the unset-date and the completed job");
ok(svcItems.every((w) => w.startMs === w.endMs), "a service item is a single day (start === end, inclusive)");
ok(
  svcItems.some((w) => w.id === "B" && w.assignee === "" && w.startMs != null),
  "an unassigned in-progress (onsite) job is KEPT with assignee '' (unassigned lane)",
);
ok(
  svcItems.find((w) => w.id === "A")?.href === "/inspections/A",
  "serviceToWorkItems uses the provided hrefFor for the deep link",
);
ok(
  svcItems.find((w) => w.id === "A")?.type === "inspection" &&
    WORK_TYPE_META.inspection.color.length > 0,
  "each item carries its work type and the type has a color",
);
ok(
  opStartOfDay(new Date(2026, 6, 20, 15, 30).getTime()) === new Date(2026, 6, 20).getTime(),
  "startOfDay truncates to local midnight",
);

/* --- home queue card (D98) --- */
import { queueCardCounts, queueDueLabel } from "@/lib/queue-types";
import {
  venueDocLocId,
  docMatchesVenue,
  engagementMatchesVenue,
  quoteDeepLink,
  isOpenStage,
} from "@/lib/venue-match";

const NOW = 1_800_000_000_000;
const qi = (due: number) => ({ key: "k" + due, source: "assignment", title: "t", context: "c", due, href: "/queue", writable: true }) as any;

ok(queueCardCounts([], NOW).open === 0, "empty queue reports zero open");
ok(queueCardCounts([], NOW).overdue === 0, "empty queue reports zero overdue");
ok(queueCardCounts([qi(NOW - 1000), qi(NOW + 1000)], NOW).open === 2, "open counts every item loadQueue returned");
ok(queueCardCounts([qi(NOW - 1000), qi(NOW + 1000)], NOW).overdue === 1, "overdue counts only items due before now");
ok(queueCardCounts([qi(0)], NOW).overdue === 0, "undated items (due === 0) are never overdue");
ok(queueCardCounts([qi(0)], NOW).open === 1, "undated items still count as open");
ok(queueCardCounts([qi(NOW)], NOW).overdue === 0, "an item due exactly now is not yet overdue");

/* --- shared queue due-label (D98) — one implementation for the Home queue
 *  card and the queue view, asserted against literal expected strings so a
 *  regression in either branch is caught even if the other call site were
 *  broken the same way. --- */
const DAY = 86_400_000;
ok(queueDueLabel(0, NOW).text === "", "undated (due === 0) renders no text");
ok(queueDueLabel(0, NOW).tone === "#9aa0ab", "undated tone matches the neutral/beyond tone");

const overdueLabel = queueDueLabel(NOW - 3 * DAY, NOW);
ok(overdueLabel.text === "3d overdue", "overdue renders 'Nd overdue'");
ok(overdueLabel.tone === "#c4553a", "overdue tone is the overdue red");

const todayLabel = queueDueLabel(NOW, NOW);
ok(todayLabel.text === "Today", "due today renders 'Today'");
ok(todayLabel.tone === "#c07f28", "today tone is the amber warning tone");

const tomorrowLabel = queueDueLabel(NOW + DAY, NOW);
ok(tomorrowLabel.text === "Tomorrow", "due tomorrow renders 'Tomorrow'");
ok(tomorrowLabel.tone === "#c07f28", "tomorrow tone matches today's amber tone");

const withinWeekLabel = queueDueLabel(NOW + 5 * DAY, NOW);
ok(withinWeekLabel.text === "5d", "within a week renders 'Nd'");
ok(withinWeekLabel.tone === "#5b616e", "within-a-week tone is neutral gray");

// The rendered date string itself is deliberately not asserted here: it's
// built via toLocaleDateString(undefined, …), so it depends on both the
// runner's timezone (NOW + 20d can land on Feb 3 or Feb 4 depending on UTC
// offset) and its locale — not a stable literal to pin in this test.
const beyondLabel = queueDueLabel(NOW + 20 * DAY, NOW);
ok(beyondLabel.tone === "#9aa0ab", "beyond-a-week tone matches the undated tone");

// ---- Venues directory (D101): the matching gotcha ----
const migVenue = { id: "st-lakefront-1", legacyLocId: "loc1" };
const freshVenue = { id: "st-new-2", legacyLocId: null };
ok(venueDocLocId(migVenue) === "loc1", "a migrated venue resolves to its legacyLocId (loc1), not sites.id");
ok(venueDocLocId(freshVenue) === "st-new-2", "a fresh venue with no legacy id resolves to sites.id");

const doc = { customerId: "lakefront", locationId: "loc1" };
ok(
  docMatchesVenue(doc, "lakefront", venueDocLocId(migVenue)) === true,
  "a doc stored with locationId 'loc1' MATCHES the migrated venue — history is not empty",
);
// The anti-regression: matching on sites.id alone silently MISSES the migrated doc.
ok(
  docMatchesVenue(doc, "lakefront", migVenue.id) === false,
  "matching on sites.id alone misses the migrated venue's doc (the bug this feature must avoid)",
);
ok(docMatchesVenue({ customerId: "other", locationId: "loc1" }, "lakefront", "loc1") === false, "a doc for a different company does not match");
ok(docMatchesVenue({ customerId: "lakefront", locationId: null }, "lakefront", "loc1") === false, "a doc with no locationId does not match a specific venue");

ok(
  engagementMatchesVenue({ companyId: "lakefront", siteIds: ["loc1", "loc9"] }, "lakefront", "loc1") === true,
  "an engagement whose siteIds hold the legacy loc id matches",
);
ok(
  engagementMatchesVenue({ companyId: "lakefront", siteIds: ["st-lakefront-1"] }, "lakefront", "loc1") === false,
  "an engagement matched against sites.id would miss (siteIds hold legacy ids)",
);

ok(quoteDeepLink("flame_test", "Q-1") === "/flame-tests/quote?id=Q-1", "flame quote deep-links to the flame quote builder");
ok(quoteDeepLink("consulting", "Q-2") === "/design/engagements/quote?id=Q-2", "consulting quote deep-links to the engagements quote builder");
ok(quoteDeepLink("system", "Q-3") === "/estimator?id=Q-3", "a system quote deep-links to the estimator");

ok(isOpenStage("project", "install") === true && isOpenStage("project", "complete") === false, "project open = any stage but complete");
ok(isOpenStage("inspection", "onsite") === true, "inspection onsite counts as open work (the 4th stage)");
ok(isOpenStage("quote", "won") === false && isOpenStage("quote", "sent") === true, "quote open = draft or sent");

/* --- venue dimensions (lineset PRO dims, task 1) --- */
const vdEst = venueDimsFromEstimator({ width: 36, ph: 18, depth: 26, grid: 24, wing: 12 });
ok(vdEst.proWidthFt === 36, "estimator `width` maps to PRO width, not stage width");
ok(vdEst.proHeightFt === 18, "estimator `ph` maps to PRO height");
ok(vdEst.stageWidthFt === 60, `stage width = pro + 2 wings (got ${vdEst.stageWidthFt})`);
ok(vdEst.proWidthFt !== vdEst.stageWidthFt, "pro and stage width stay distinct — the collision guard");
ok(vdEst.stageDepthFt === 26, `estimator depth maps straight through to stage depth (got ${vdEst.stageDepthFt})`);
ok(vdEst.gridHeightFt === 24, `estimator grid maps straight through to grid height (got ${vdEst.gridHeightFt})`);

const vdLine = venueDimsFromLineset({ proWidthFt: 40, proHeightFt: 20, stageWidthFt: 50, stageDepthFt: 30 });
ok(vdLine.proWidthFt === 40 && vdLine.stageWidthFt === 50, "lineset inputs keep pro and stage width separate");
ok(vdLine.proHeightFt === 20, `lineset proHeightFt lands on its own value, not swapped with stage depth (got ${vdLine.proHeightFt})`);
ok(vdLine.stageDepthFt === 30, `lineset stageDepthFt lands on its own value, not swapped with pro height (got ${vdLine.stageDepthFt})`);

ok(DEFAULT_VENUE_DIMS.proWidthFt === 40, `DEFAULT_VENUE_DIMS proWidthFt is 40 (got ${DEFAULT_VENUE_DIMS.proWidthFt})`);
ok(DEFAULT_VENUE_DIMS.proHeightFt === 20, `DEFAULT_VENUE_DIMS proHeightFt is 20 (got ${DEFAULT_VENUE_DIMS.proHeightFt})`);
ok(DEFAULT_VENUE_DIMS.stageWidthFt === 50, `DEFAULT_VENUE_DIMS stageWidthFt is 50 (got ${DEFAULT_VENUE_DIMS.stageWidthFt})`);
ok(DEFAULT_VENUE_DIMS.stageDepthFt === 30, `DEFAULT_VENUE_DIMS stageDepthFt is 30 (got ${DEFAULT_VENUE_DIMS.stageDepthFt})`);

/* --- fabric catalog weight join (task 2) --- */
import { fabricFromPart, ozPerFt2, computeSetWeight, DEFAULT_WEIGHTS } from "@/lib/design/steel";

const velourPart = { id: "RB-MV-MN", sku: "RB-MV-MN", desc: "25 oz Memorable Velour", category: "Fabric", unit: "sq ft", list: 6.4, cost: 4.2, oz: 25, ozBasis: "lin-yd" as const, boltWidthIn: 54 };
const muslinPart = { id: "RB-MUS", sku: "RB-MUS", desc: "Seamless Muslin", category: "Fabric", unit: "sq ft", list: 1.7, cost: 1.1, oz: 6, ozBasis: "sq-yd" as const, boltWidthIn: 120 };

const fV = fabricFromPart(velourPart);
ok(fV !== null && Math.abs(ozPerFt2(fV) - 25 / 13.5) < 1e-9, "54in lin-yd velour resolves to oz/13.5 per sqft");
const fM = fabricFromPart(muslinPart);
ok(fM !== null && Math.abs(ozPerFt2(fM) - 6 / 9) < 1e-9, "sq-yd muslin resolves to oz/9 per sqft");
ok(fabricFromPart({ ...velourPart, oz: undefined }) === null, "a part with no oz cannot produce a weight");

const marvel = fabricFromPart({ desc: "21 oz Marvel Velour", oz: 21, ozBasis: "lin-yd", boltWidthIn: 54 })!;
const wLine = computeSetWeight({ name: "t", fabResolved: marvel, w: 20, h: 19, full: 50, qty: 2 }, DEFAULT_WEIGHTS);
ok(wLine.goods > 0, "a catalog-only fabric (Marvel is NOT in FABLIB) still produces goods weight");
ok(computeSetWeight({ name: "t", fab: "21 oz Marvel Velour", w: 20, h: 19, full: 50, qty: 2 }, DEFAULT_WEIGHTS).goods === 0, "name-only lookup of a catalog desc weighs ZERO — the bug this join fixes");

/* --- drape rule table (task 3) --- */
import { drapeRule, TRACK_TRAVELER, DEFAULT_GEAR, shellGearLb, electricCounts, electricGearLb, ruleToWeightLine, mergeLineFabric } from "@/lib/design/goods";

const DIMS36 = { proWidthFt: 36, proHeightFt: 18, stageWidthFt: 50, stageDepthFt: 30 };

const rDraw = drapeRule("Draw", DIMS36, "better")!;
ok(rDraw.w === 20, `draw panel = PW/2+2 (got ${rDraw.w})`);
ok(rDraw.h === 19, `draw height = PH+1 (got ${rDraw.h})`);
ok(rDraw.qty === 2 && rDraw.fullness === 50, "draw is a pair at 50% fullness");
ok(rDraw.track === TRACK_TRAVELER, "draw travels on standard traveler track");
ok(rDraw.fabricSku === "RB-CHAR-25", "better tier draw resolves to 25oz Charisma — the tier the lineset builder defaults to when none is picked");

const rRear = drapeRule("Rear", DIMS36, "better")!;
ok(rRear.w === rDraw.w && rRear.h === rDraw.h && rRear.qty === rDraw.qty, "rear is a draw curtain — same geometry as the main");
ok(rRear.fabricSku === "RB-CHAR-25", "rear resolves to 25oz Charisma — the same SKU as draw today, but Rear is kept as its own row in the type table so a cheaper rear blackout can be swapped in later without touching the main drape");

const rMid = drapeRule("Midstage Draw", DIMS36, "better")!;
ok(rMid.w === rDraw.w && rMid.h === rDraw.h, "midstage matches the main's geometry");
ok(rMid.fabricSku === "RB-CHAR-25", "better tier midstage draw resolves to 25oz Charisma");

const rLegs = drapeRule("Legs", DIMS36, "better")!;
ok(rLegs.w === 6 && rLegs.h === 19 && rLegs.qty === 2, "legs are 6ft x PH+1, one pair");
ok(rLegs.track === null, "legs tie to pipe, no track");
ok(rLegs.fabricSku === "RB-EN-22", "better tier legs resolve to 22oz Encore");

const rBorder = drapeRule("Border", DIMS36, "better")!;
ok(rBorder.w === 36 && rBorder.h === 5 && rBorder.qty === 1, "border is PW wide x 5ft drop");
ok(rBorder.fabricSku === "RB-CHAR-25", "better tier border resolves to 25oz Charisma");

const rCyc = drapeRule("CYC", DIMS36, "better")!;
ok(rCyc.w === 36 && rCyc.h === 18, "cyc is PW x PH EXACTLY — no +1 trim allowance");
ok(rCyc.fullness === 0, "cyc hangs FLAT — 0% fullness, else it runs ~50% heavy");
ok(rCyc.track === null && rCyc.chain === "None", "cyc has no track and no bottom chain (pocket)");

ok(drapeRule("Electric", DIMS36, "better") === null, "electrics carry no goods");
ok(drapeRule("Shell", DIMS36, "better") === null, "shell lines carry no goods");
ok(drapeRule("General Purpose", DIMS36, "better") === null, "general purpose lines are empty");

ok(drapeRule("Draw", DIMS36, "good")!.fabricSku === "RB-EN-22", "good mains = Encore 22oz");
ok(drapeRule("Draw", DIMS36, "best")!.fabricSku === "RB-MV-MN", "best tier uses 25oz Memorable");
ok(drapeRule("Legs", DIMS36, "good")!.fabricSku === "RB-EN-16", "good legs = Encore 16oz");
ok(drapeRule("Legs", DIMS36, "best")!.fabricSku === "RB-CHAR-25", "best legs = Charisma 25oz");
ok(drapeRule("CYC", DIMS36, "good")!.fabricSku === "RB-MUS", "cyc is muslin at every tier");
ok(rCyc.fabricSku === "RB-MUS", "cyc is muslin at the better tier too — the tier the lineset builder defaults to");
ok(drapeRule("CYC", DIMS36, "best")!.fabricSku === "RB-MUS", "cyc is muslin at the best tier too — good, better, and best all confirmed, matching the 'every tier' claim above");

/* --- gear weights: fixtures, distribution, shell (task 4) --- */
ok(DEFAULT_GEAR.shellPsf === 2.5, "shell ceiling is 2.5 lb per sqft (Jeff, 2026-07-24)");
ok(shellGearLb(DIMS36, 12) === 1080, `36ft pro x 12ft shell spacing x 2.5psf = 1080 lb (got ${shellGearLb(DIMS36, 12)})`);

const cReg = electricCounts(DIMS36, "medium", "regular");
ok(cReg.front === 0, "FOH fixtures NEVER load a lineset batten — front count is always 0");
ok(cReg.cyc === 0, "cyc fixtures belong to the cyc electric, not a regular one");
ok(cReg.par === 5, `par count = round(PW/8) x 1.0 at medium (got ${cReg.par})`);
ok(cReg.side === 3, `side count = round(wUnit x 0.5) = round(5 x 0.5) = round(2.5) = 3 at medium — JS's Math.round breaks halves toward +Infinity, so a FIX_MUL slip that lands here wouldn't round the other way unnoticed (got ${cReg.side})`);
ok(cReg.automated === 3, `automated count = round(wUnit x 0.5) = round(2.5) = 3 at medium — same half-value rounding case as side (got ${cReg.automated})`);

const cSmall = electricCounts(DIMS36, "small", "regular");
ok(cSmall.par === 4, `par count = round(wUnit x 0.7) = round(3.5) = 4 at small (got ${cSmall.par})`);
ok(cSmall.side === 0, `side count = round(wUnit x 0) = 0 at small — small carries no side light, pinned so the zero can't quietly grow back (got ${cSmall.side})`);
ok(cSmall.automated === 0, `automated count = round(wUnit x 0) = 0 at small — small carries no movers either (got ${cSmall.automated})`);

const cLarge = electricCounts(DIMS36, "large", "regular");
ok(cLarge.par === 6, `par count = round(wUnit x 1.2) = round(6) = 6 at large (got ${cLarge.par})`);
ok(cLarge.side === 4, `side count = round(wUnit x 0.75) = round(3.75) = 4 at large (got ${cLarge.side})`);
ok(cLarge.automated === 5, `automated count = round(wUnit x 0.9) = round(4.5) = 5 at large — another half-value rounding case (got ${cLarge.automated})`);

const cCyc = electricCounts(DIMS36, "medium", "cyc");
ok(cCyc.cyc === 6 && cCyc.par === 0, `the cyc electric carries cyc fixtures only — cyc count = round(wUnit x 1.25) = round(6.25) = 6 (got ${cCyc.cyc})`);

const lb = electricGearLb({ par: 5, side: 3 }, 44);
ok(lb === 5 * 12 + 3 * 18 + 1.5 * 44, `gear = fixtures + 1.5 lb/ft distribution (got ${lb})`);
ok(electricGearLb({ front: 10 }, 0) === 0, "an explicit front count still contributes nothing — FOH is off-batten");
ok(electricGearLb({}, 44) === 66, "a bare electric still carries its distribution allowance");

/* --- PRO dims on lineset inputs + v3 save format (task 5) --- */
import { generateLineset, DEFAULT_LINESET_INPUTS } from "@/lib/design/lineset";

ok(DEFAULT_LINESET_INPUTS.proWidthFt === 40 && DEFAULT_LINESET_INPUTS.proHeightFt === 20, "lineset defaults carry PRO dims");
ok(DEFAULT_LINESET_INPUTS.stageWidthFt === 50, "stage width default is unchanged at 50ft");
ok(DEFAULT_LINESET_INPUTS.proWidthFt !== DEFAULT_LINESET_INPUTS.stageWidthFt, "PRO width and stage width are distinct values");

const baseOut = generateLineset(DEFAULT_LINESET_INPUTS);
const wideProOut = generateLineset({ ...DEFAULT_LINESET_INPUTS, proWidthFt: 44, proHeightFt: 26 });
ok(baseOut.schedule.length === wideProOut.schedule.length, "changing PRO dims does NOT change line placement");
ok(baseOut.summary.activeSlotCount === wideProOut.summary.activeSlotCount, "PRO dims do not affect the 8in grid");

/* --- rule -> WeightLine, override precedence (task 6) --- */
const wlDraw = ruleToWeightLine(drapeRule("Draw", DIMS36, "better")!, [
  { sku: "RB-CHAR-25", desc: "25 oz Charisma Velour", oz: 25, ozBasis: "lin-yd" as const, boltWidthIn: 54 },
]);
ok(wlDraw.w === 20 && wlDraw.h === 19, "rule dimensions carry into the WeightLine unchanged");
ok(wlDraw.full === 50, "fullness rides on the line, not the schedule default");
ok(wlDraw.fabResolved !== undefined && wlDraw.fabResolved.oz === 25, "the SKU resolves to a weighable fabric, not just a name");
ok(computeSetWeight({ name: "t", ...wlDraw }, DEFAULT_WEIGHTS).goods > 0, "a rule-built line actually weighs something — the end-to-end join");

const merged = { ...wlDraw, h: 24 };
ok(merged.h === 24 && merged.w === 20, "a hand-entered height overrides the rule; untouched fields keep it");

const wlCyc = ruleToWeightLine(drapeRule("CYC", DIMS36, "better")!, [
  { sku: "RB-MUS", desc: "Seamless Muslin", oz: 6, ozBasis: "sq-yd" as const, boltWidthIn: 120 },
]);
ok(wlCyc.full === 0, "the cyc reaches computeSetWeight at 0% fullness, not the 50% default");

/* --- fabric override re-resolution on rule-derived lines (whole-branch review: F1/F2) ---
 * computeSetWeight prefers fabResolved over a fab name lookup (steel.ts). A
 * rule-derived line's fabResolved comes from the CATALOG (ruleToWeightLine),
 * so when a user overrides `fab` the merge must re-resolve fabResolved from
 * the catalog too — otherwise the rule's stale fabResolved silently wins and
 * the override never touches the weight (this was the bug: Task 2's catalog
 * join and Task 7's override UI were each reviewed alone and never wired
 * together). These assertions call mergeLineFabric() (goods.ts) directly —
 * the SAME function the lineset-builder.tsx `rows` memo calls to build
 * `line` — so a reverted or broken extraction fails HERE, not just in a
 * hand-copied reimplementation of the merge (task 7). The dropdown-vocabulary
 * swap (F2 — listing catalog fabrics instead of FABLIB on rule lines) is a
 * rendering-only concern with no separate pure seam; it's verified live in
 * the dev server instead. */
const OVERRIDE_FABRICS = [
  { sku: "RB-CHAR-25", desc: "25 oz Charisma Velour", oz: 25, ozBasis: "lin-yd" as const, boltWidthIn: 54 },
  { sku: "RB-MARVEL", desc: "21 oz Marvel Velour", oz: 21, ozBasis: "lin-yd" as const, boltWidthIn: 54 },
];
const drawRule = drapeRule("Draw", DIMS36, "better")!;
const ruleLine = ruleToWeightLine(drawRule, OVERRIDE_FABRICS);
ok(ruleLine.fabResolved?.oz === 25, "unoverridden draw line carries the tier's 25oz Charisma");
const ruleWeight = computeSetWeight({ name: "t", ...ruleLine }, DEFAULT_WEIGHTS);

// (c) no override at all — mergeLineFabric passes the rule's fab/fabResolved straight through
const kept = mergeLineFabric(ruleLine, undefined, drawRule, OVERRIDE_FABRICS);
ok(kept.fab === ruleLine.fab && kept.fabResolved?.oz === 25, "no override: mergeLineFabric leaves the rule's fabResolved intact");

// (a) an overridden catalog fabric — fabResolved must track the OVERRIDE, not the rule
const overrideDesc = "21 oz Marvel Velour";
const overridden = mergeLineFabric(ruleLine, { fab: overrideDesc }, drawRule, OVERRIDE_FABRICS);
ok(overridden.fab === overrideDesc, "mergeLineFabric carries the override label through as fab");
ok(overridden.fabResolved?.oz === 21, "the fix: overriding fab on a rule line re-resolves fabResolved to the OVERRIDE fabric, not the rule's — via the real production function, not a copy of it");
const overriddenWeight = computeSetWeight({ name: "t", ...ruleLine, ...overridden }, DEFAULT_WEIGHTS);
ok(overriddenWeight.goods < ruleWeight.goods, `lighter override lowers goods weight end-to-end through mergeLineFabric (rule ${ruleWeight.goods.toFixed(1)} -> override ${overriddenWeight.goods.toFixed(1)})`);

// (b) an override that misses the catalog — fabResolved must clear, not keep the stale rule value
const missDesc = "Not in catalog";
const missed = mergeLineFabric(ruleLine, { fab: missDesc }, drawRule, OVERRIDE_FABRICS);
ok(missed.fab === missDesc && missed.fabResolved === undefined, "a catalog-miss override clears fabResolved rather than keeping the stale rule value, so fabByName(fab) can govern instead");

// non-drape lines (no rule) never had this bug — mergeLineFabric must not invent catalog re-resolution for them
const gearBase = { gear: 120 };
const gearMerge = mergeLineFabric(gearBase, { fab: overrideDesc }, null, OVERRIDE_FABRICS);
ok(gearMerge.fab === overrideDesc && gearMerge.fabResolved === undefined, "a non-rule (Electric/Shell) line's fab override is passed through, never re-resolved from the catalog — there is no rule behind it to protect");

/* --- cut allowance is inches, not feet (Decision B, Jeff approved 2026-07-24) ---
 * computeSetWeight's cut allowance (def.cut) is documented and labelled "(in)".
 * The goods math adds it to a height in FEET, so it must be divided by 12. The
 * test is value-independent: 12 inches of cut IS one foot, so bumping def.cut by
 * 12 must move the weight exactly as much as adding 1 ft of finished height.
 * Under the old bug (cut added as feet) those two diverge by a factor of 12. */
const cutFab = fabricFromPart({ desc: "21 oz Marvel Velour", oz: 21, ozBasis: "lin-yd", boltWidthIn: 54 })!;
const cutLine = { name: "t", fabResolved: cutFab, w: 10, full: 50, qty: 1 };
const cutBase = computeSetWeight({ ...cutLine, h: 20 }, { ...DEFAULT_WEIGHTS, cut: 6 });
const cutViaCut = computeSetWeight({ ...cutLine, h: 20 }, { ...DEFAULT_WEIGHTS, cut: 18 }); // +12 in
const cutViaHeight = computeSetWeight({ ...cutLine, h: 21 }, { ...DEFAULT_WEIGHTS, cut: 6 }); // +1 ft
ok(Math.abs(cutViaCut.goods - cutViaHeight.goods) < 1e-6, `+12in of cut == +1ft of height — cut is inches (got ${cutViaCut.goods.toFixed(2)} vs ${cutViaHeight.goods.toFixed(2)})`);
ok(cutViaCut.goods > cutBase.goods, "more cut allowance still adds weight (sanity: fix didn't invert the sign)");

/* --- The Grid BOM math (D108) --- */
import { bomLines, bomTotals, type PartLite } from "@/lib/design/grid-bom";

const gridParts: PartLite[] = [
  { id: "S4LED", sku: "S4LED", desc: "ETC Source Four LED", category: "Lighting", unit: "ea", list: 1200, cost: 800 },
  { id: "CYC1", sku: "CYC1", desc: "Cyc fixture", category: "Lighting", unit: "ea", list: 900, cost: 600 },
];
const place = (partId: string) => ({ partId });
const gLines = bomLines([place("S4LED"), place("CYC1"), place("S4LED"), place("S4LED")], gridParts);
ok(gLines.length === 2, `BOM groups placements by part (${gLines.length} lines)`);
ok(gLines[0].partId === "S4LED" && gLines[0].qty === 3, "biggest line first: 3× S4LED");
ok(gLines[0].ext === 3600, `extended price = qty × list (${gLines[0].ext})`);
const gTot = bomTotals([place("S4LED"), place("CYC1")], gridParts);
ok(gTot.value === 2100 && gTot.cost === 1400, `totals sum value/cost (${gTot.value}/${gTot.cost})`);
ok(Math.abs(gTot.margin - (2100 - 1400) / 2100) < 1e-9, "margin = (value-cost)/value");
const gGhost = bomLines([place("GONE")], gridParts);
ok(gGhost.length === 1 && gGhost[0].ext === 0 && /removed/i.test(gGhost[0].desc),
  "a placement whose part left the catalog stays visible at $0, flagged removed");
ok(bomTotals([], gridParts).margin === 0, "empty project has margin 0, not NaN");

/* --- The Grid geometry (D109) --- */
import { pointInPolygon, polygonArea, polygonCentroid, spaceOf } from "@/lib/design/grid-geometry";

const square = [
  { x: 0.2, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.6, y: 0.6 }, { x: 0.2, y: 0.6 },
];
ok(pointInPolygon({ x: 0.4, y: 0.4 }, square), "point inside a square is in");
ok(!pointInPolygon({ x: 0.7, y: 0.4 }, square), "point right of the square is out");
ok(!pointInPolygon({ x: 0.4, y: 0.4 }, square.slice(0, 2)), "a 2-vertex 'polygon' contains nothing");
// Concave L: the notch (upper-right quadrant of the bounding box) is OUTSIDE.
const ell = [
  { x: 0, y: 0 }, { x: 0.4, y: 0 }, { x: 0.4, y: 0.2 },
  { x: 0.2, y: 0.2 }, { x: 0.2, y: 0.4 }, { x: 0, y: 0.4 },
];
ok(pointInPolygon({ x: 0.1, y: 0.3 }, ell), "L-shape: point in the lower arm is in");
ok(!pointInPolygon({ x: 0.3, y: 0.3 }, ell), "L-shape: point in the notch is out");
ok(Math.abs(polygonArea(square) - 0.16) < 1e-9, `shoelace area of the square (${polygonArea(square)})`);
const cen = polygonCentroid(square);
ok(Math.abs(cen.x - 0.4) < 1e-9 && Math.abs(cen.y - 0.4) < 1e-9, "centroid of the square is its middle");
// Nested spaces: the smallest containing polygon wins (booth inside a hall).
const hall = { id: "sp-hall", sheetId: "s1", page: 1, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
const booth = { id: "sp-booth", sheetId: "s1", page: 1, points: square };
const otherSheet = { id: "sp-other", sheetId: "s2", page: 1, points: square };
ok(spaceOf({ sheetId: "s1", page: 1, x: 0.4, y: 0.4 }, [hall, booth])?.id === "sp-booth",
  "nested spaces: smallest containing polygon wins");
ok(spaceOf({ sheetId: "s1", page: 1, x: 0.9, y: 0.9 }, [hall, booth])?.id === "sp-hall",
  "outside the booth but inside the hall → the hall");
ok(spaceOf({ sheetId: "s2", page: 2, x: 0.4, y: 0.4 }, [hall, booth, otherSheet]) === null,
  "wrong sheet/page matches nothing");

/* --- The Grid per-space rollups (D109) --- */
import { bomBySpace } from "@/lib/design/grid-bom";

const stageSp = { id: "sp-stage", sheetId: "s1", page: 1, name: "Stage", points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.4 }, { x: 0, y: 0.4 }] };
const houseSp = { id: "sp-house", sheetId: "s1", page: 1, name: "House", points: [{ x: 0, y: 0.4 }, { x: 1, y: 0.4 }, { x: 1, y: 0.9 }, { x: 0, y: 0.9 }] };
const gp = (x: number, y: number, partId: string) => ({ sheetId: "s1", page: 1, x, y, partId });
const roll = bomBySpace(
  [gp(0.5, 0.2, "S4LED"), gp(0.6, 0.2, "S4LED"), gp(0.5, 0.6, "CYC1"), gp(0.5, 0.95, "S4LED")],
  gridParts,
  [stageSp, houseSp]
);
ok(roll.length === 3, `rollups: Stage, House, Unassigned (${roll.length})`);
ok(roll[0].name === "Stage" && roll[0].count === 2 && roll[0].value === 2400,
  `Stage rolls up 2× S4LED = $2400 (${roll[0].count}, ${roll[0].value})`);
ok(roll[1].name === "House" && roll[1].count === 1 && roll[1].value === 900,
  "House rolls up the CYC1");
ok(roll[2].spaceId === null && roll[2].count === 1, "the stray device lands in Unassigned");
ok(bomBySpace([gp(0.5, 0.2, "S4LED")], gridParts, []).length === 1
  && bomBySpace([gp(0.5, 0.2, "S4LED")], gridParts, [])[0].spaceId === null,
  "no spaces → a single Unassigned rollup");
ok(bomBySpace([gp(0.5, 0.2, "S4LED")], gridParts, [stageSp, houseSp]).length === 1,
  "spaces with no devices are omitted");

/* --- The Grid wire routing (D110) --- */
import { distToPolyline, polylineLength } from "@/lib/design/grid-geometry";
import { isPerLengthUnit, routeLengthFt, routeLines } from "@/lib/design/grid-bom";

// Aspect 2 (page twice as tall as wide): a vertical hop of 0.25 in y is
// 0.5 page-widths of real distance.
const zig = [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }, { x: 0.4, y: 0.35 }];
ok(Math.abs(polylineLength(zig, 2) - 0.8) < 1e-9, `polyline length sums segments with aspect (${polylineLength(zig, 2)})`);
ok(polylineLength([zig[0]], 2) === 0, "a single point has no length");
ok(Math.abs(distToPolyline({ x: 0.25, y: 0.2 }, zig, 1) - 0.1) < 1e-9, "distance to the nearest segment (perpendicular)");
ok(Math.abs(distToPolyline({ x: 0.5, y: 0.35 }, zig, 1) - 0.1) < 1e-9, "distance past a segment end clamps to the endpoint");
ok(isPerLengthUnit("ft") && isPerLengthUnit("Lin Ft") && isPerLengthUnit("/ft") && isPerLengthUnit("linear ft"), "per-length units accepted");
ok(!isPerLengthUnit("ea") && !isPerLengthUnit("sq ft") && !isPerLengthUnit("hr"), "per-each/area/time units are not wire units");

const wireCal = { docId: "s1", page: 1, scale: 100, unit: "ft" as const, refLength: 60, by: "t", at: 0 };
const soRoute = { id: "wr-1", sheetId: "s1", page: 1, points: zig, aspect: 2, partId: "WIRE-SO" };
const dmxRoute = { id: "wr-2", sheetId: "s1", page: 1, points: [zig[0], zig[1]], aspect: 2, partId: "WIRE-SO" };
const coldRoute = { id: "wr-3", sheetId: "s2", page: 1, points: zig, aspect: 2, partId: "WIRE-SO" };
ok(Math.abs((routeLengthFt(soRoute, [wireCal]) || 0) - 80) < 1e-9, `route length = polyline × scale (${routeLengthFt(soRoute, [wireCal])})`);
ok(routeLengthFt(coldRoute, [wireCal]) === null, "uncalibrated page → null length");
const wireParts = [
  { id: "WIRE-SO", sku: "WIRE-SO", desc: "12/3 SO cable", category: "Wire", unit: "ft", list: 2, cost: 1 },
] as PartLite[];
const wl = routeLines([soRoute, dmxRoute, coldRoute], wireParts, [wireCal]);
ok(wl.lines.length === 1 && wl.lines[0].qty === 110, `routes of one part sum then ceil (80 + 30 = ${wl.lines[0]?.qty})`);
ok(wl.lines[0].ext === 220 && wl.value === 220 && wl.cost === 110, "wire ext/value/cost from qty × list|cost");
ok(wl.unmeasured === 1, "the uncalibrated route is counted, not silently dropped");

/* --- The Grid riser sketch (D112) --- */
import { riserGraph } from "@/lib/design/grid-riser";

const rSpaces = [stageSp, houseSp]; // from the rollup tests above (s1/page 1)
const rPlacements = [gp(0.5, 0.2, "S4LED"), gp(0.6, 0.2, "S4LED"), gp(0.5, 0.6, "CYC1"), gp(0.5, 0.95, "S4LED")];
const rRoutes = [
  { id: "wr-a", sheetId: "s1", page: 1, partId: "WIRE-SO", aspect: 1, points: [{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.6 }] }, // stage → house
  { id: "wr-b", sheetId: "s1", page: 1, partId: "WIRE-SO", aspect: 1, points: [{ x: 0.5, y: 0.6 }, { x: 0.5, y: 0.95 }] }, // house → outside
];
const rg = riserGraph(rPlacements, rRoutes, rSpaces, [...gridParts, ...wireParts], [wireCal]);
ok(rg.nodes.length === 3, `riser: Stage, House, Unassigned nodes (${rg.nodes.length})`);
ok(rg.nodes[0].name === "Stage" && rg.nodes[0].groups[0].qty === 2 && rg.nodes[0].groups[0].partId === "S4LED",
  "riser: Stage groups its 2× S4LED");
ok(rg.nodes[2].spaceId === null && rg.nodes[2].groups.length === 1, "riser: stray device lands in the Unassigned node");
ok(rg.edges.length === 2, `riser: two wire edges (${rg.edges.length})`);
ok(rg.edges[0].fromName === "Stage" && rg.edges[0].toName === "House", "riser: edge endpoints resolve to spaces");
ok(rg.edges[1].fromName === "House" && rg.edges[1].toName === "Unassigned", "riser: an endpoint outside every space maps to Unassigned");
ok(rg.edges[0].lengthFt !== null && Math.abs((rg.edges[0].lengthFt || 0) - 40) < 1e-9,
  `riser: edge carries the measured length (${rg.edges[0].lengthFt})`);

/* --- The Grid labor auto-suggest (D114) --- */
import { suggestLabor } from "@/lib/design/grid-labor";

const laborCat = [
  { id: "LIG-LBR", sku: "LIG-LBR", desc: "Lighting — install labor", category: "Labor", unit: "hr", list: 68, cost: 45, role: "labor", discipline: "LIG" },
  { id: "RIG-LBR", sku: "RIG-LBR", desc: "Rigging — install labor", category: "Labor", unit: "hr", list: 75, cost: 50, role: "labor", discipline: "RIG" },
  { id: "AUD-LBR", sku: "AUD-LBR", desc: "Audio — install labor", category: "Labor", unit: "hr", list: 72, cost: 48, role: "labor", discipline: "AUD" },
];
const deviceCat = [
  { id: "S4LED", sku: "S4LED", desc: "Source Four LED", category: "Lighting", unit: "ea", list: 1200, cost: 800 },
  { id: "SPKR", sku: "SPKR", desc: "Loudspeaker", category: "Audio", unit: "ea", list: 900, cost: 600 },
  { id: "HOIST", sku: "HOIST", desc: "Chain hoist", category: "Rigging Hardware", unit: "ea", list: 2000, cost: 1400 },
  { id: "WIRE-X", sku: "WIRE-X", desc: "Cable", category: "Wire & Cable", unit: "ft", list: 2, cost: 1 },
];
const sug = suggestLabor(
  [{ partId: "S4LED" }, { partId: "S4LED" }, { partId: "S4LED" }, { partId: "SPKR" }, { partId: "HOIST" }, { partId: "WIRE-X" }],
  deviceCat as PartLite[],
  laborCat as any[],
  0.5
);
ok(sug.length === 3, `one suggestion per discipline present (${sug.length})`);
const ligSug = sug.find((s) => s.partId === "LIG-LBR");
ok(!!ligSug && ligSug.hours === 1.5, `3 lighting devices × 0.5h = 1.5h (${ligSug?.hours})`);
const rigSug = sug.find((s) => s.partId === "RIG-LBR");
ok(!!rigSug && rigSug.hours === 0.5, "the hoist maps to rigging labor");
ok(sug.find((s) => s.partId === "AUD-LBR")?.hours === 0.5, "the speaker maps to audio labor");
ok(!sug.some((s) => s.hours === 0), "no zero-hour suggestions");
// Wire parts don't count as devices; hours round UP to the half hour.
const sugOdd = suggestLabor([{ partId: "S4LED" }], deviceCat as PartLite[], laborCat as any[], 0.34);
ok(sugOdd[0].hours === 0.5, `hours round up to the half hour (${sugOdd[0].hours})`);
ok(suggestLabor([{ partId: "WIRE-X" }], deviceCat as PartLite[], laborCat as any[], 0.5).length === 0,
  "wire-only placements suggest no labor");
ok(suggestLabor([{ partId: "S4LED" }], deviceCat as PartLite[], [], 0.5).length === 0,
  "no labor parts in the catalog → no suggestions (never invent rates)");

/* --- repairs crew fan-out on Schedule (D115, overrides the D100 hold) --- */
const crewJob = {
  id: "RJ-1", customer: "Lakeside", venue: "Sanctuary", stage: "scheduled",
  scheduledDate: "2026-08-01", assignedTo: "Jack Hamilton",
  crew: ["Nic Trapani", "Jack Hamilton", " ", "Isaac Mittlesteadt"],
};
const soloJob = {
  id: "RJ-2", customer: "Bayfront", venue: "Arena", stage: "scheduled",
  scheduledDate: "2026-08-02", assignedTo: "", crew: [],
};
const fan = serviceToWorkItems([crewJob, soloJob] as any[], "repair", (id) => "/repairs/results?job=" + id);
const rj1 = fan.filter((w) => w.href.includes("RJ-1"));
ok(rj1.length === 3, `crew fans out to one bar per distinct person (${rj1.length})`);
ok(new Set(rj1.map((w) => w.assignee)).size === 3, "duplicate lead/crew names collapse to one bar each");
ok(new Set(rj1.map((w) => w.id)).size === 3, "fanned bars get distinct ids (React keys / crew lanes)");
ok(rj1.every((w) => w.href === "/repairs/results?job=RJ-1"), "every fanned bar links to the same record");
const rj2 = fan.filter((w) => w.href.includes("RJ-2"));
ok(rj2.length === 1 && rj2[0].assignee === "" && rj2[0].id === "RJ-2",
  "no lead + no crew stays a single unassigned bar with the stable id");

/* --- delivered engagements stay open (D113.11) --- */
import { isOpenEngagement } from "@/lib/consulting-review";
ok(isOpenEngagement({ status: "active" }) && isOpenEngagement({ status: "delivered" }) && isOpenEngagement({ status: "bid_supported" }),
  "active, delivered, and bid_supported all count as open");
ok(!isOpenEngagement({ status: "oversight_complete" }), "only oversight_complete closes an engagement");

/* --- curtain pricing: reconcile Rose Brand quote 423939 (task 1) --- */
// Rose Brand rates (NOT the +10% make-it seeds): Charisma area 3.313, Encore-22 area 2.582, making 8.661.
const RB_CHAR = { fabricRate: 3.313, makingRate: 8.661 };
const RB_EN22 = { fabricRate: 2.582, makingRate: 8.661 };
const border = curtainCost({ finishedWidthFt: 50, finishedHeightFt: 3, fullnessPct: 50, qty: 1 }, RB_CHAR);
ok(Math.abs(border.costEach - 1395) < 2, `RB line 1 border ≈ $1,395 (got ${border.costEach.toFixed(2)})`);
const main = curtainCost({ finishedWidthFt: 23, finishedHeightFt: 15 + 7 / 12, fullnessPct: 50, qty: 1 }, RB_CHAR);
ok(Math.abs(main.costEach - 2080) < 2, `RB line 2 main ≈ $2,080 (got ${main.costEach.toFixed(2)})`);
const legs = curtainCost({ finishedWidthFt: 9.5, finishedHeightFt: 10 + 11 / 12, fullnessPct: 50, qty: 1 }, RB_EN22);
ok(Math.abs(legs.costEach - 525) < 2, `RB line 3 legs ≈ $525 (got ${legs.costEach.toFixed(2)})`);

// sewn geometry
ok(border.sewnWidthFt === 75 && Math.abs(border.sewnAreaSqft - 225) < 1e-6, "sewnWidth = W×(1+fullness); sewnArea = sewnWidth×H");
// qty multiplies the total, not the unit
ok(Math.abs(curtainCost({ finishedWidthFt: 9.5, finishedHeightFt: 10 + 11 / 12, fullnessPct: 50, qty: 4 }, RB_EN22).costTotal - legs.costEach * 4) < 1e-6, "costTotal = costEach × qty");

// vendor override replaces the make cost and flags the line
const ov = curtainCost({ finishedWidthFt: 23, finishedHeightFt: 15, fullnessPct: 50, qty: 2, vendorCostOverride: 2080 }, RB_CHAR);
ok(ov.costEach === 2080 && ov.overridden === true && ov.costTotal === 4160, "vendorCostOverride replaces make cost, flags overridden, ×qty");
ok(curtainCost({ finishedWidthFt: 10, finishedHeightFt: 10, fullnessPct: 50, qty: 1 }, RB_CHAR).overridden === false, "no override → overridden false");

// cyc flatness: 0% fullness → sewn area equals finished face
const cyc = curtainCost({ finishedWidthFt: 40, finishedHeightFt: 20, fullnessPct: 0, qty: 1 }, { fabricRate: 0.9, makingRate: DEFAULT_CYC_MAKING_RATE });
ok(cyc.sewnAreaSqft === 800 && cyc.sewnWidthFt === 40, "cyc at 0% fullness: sewn area = finished face, no 1.5× applied");

// making rate selector
ok(makingRateFor(50) === DEFAULT_MAKING_RATE && makingRateFor(0) === DEFAULT_CYC_MAKING_RATE, "flat goods use the lower cyc making rate");

// margin
ok(Math.abs(curtainPrice(700) - 1000) < 1e-6, "price = cost / (1 − 0.30)");

// make-it rate constants pinned to their dollar values — the reconciliation
// above hardcodes the Rose Brand rate (8.661) and never touches these, so a
// fat-finger to either would silently shift every make-it price with nothing
// above to catch it.
ok(DEFAULT_MAKING_RATE === 9.53, `DEFAULT_MAKING_RATE is 9.53 (got ${DEFAULT_MAKING_RATE})`);
ok(DEFAULT_CYC_MAKING_RATE === 4.75, `DEFAULT_CYC_MAKING_RATE is 4.75 (got ${DEFAULT_CYC_MAKING_RATE})`);

// SEED_FABRIC_RATES: all five SKUs pinned to their dollar values, plus the
// key count pinned too so an added-but-unused fabric rate is caught as well.
ok(SEED_FABRIC_RATES["RB-CHAR-25"] === 3.64, `RB-CHAR-25 seed rate is 3.64 (got ${SEED_FABRIC_RATES["RB-CHAR-25"]})`);
ok(SEED_FABRIC_RATES["RB-EN-22"] === 2.84, `RB-EN-22 seed rate is 2.84 (got ${SEED_FABRIC_RATES["RB-EN-22"]})`);
ok(SEED_FABRIC_RATES["RB-EN-16"] === 2.1, `RB-EN-16 seed rate is 2.1 (got ${SEED_FABRIC_RATES["RB-EN-16"]})`);
ok(SEED_FABRIC_RATES["RB-MV-MN"] === 4.37, `RB-MV-MN (Memorable, premium) seed rate is 4.37 (got ${SEED_FABRIC_RATES["RB-MV-MN"]})`);
ok(SEED_FABRIC_RATES["RB-MUS"] === 0.9, `RB-MUS seed rate is 0.9 (got ${SEED_FABRIC_RATES["RB-MUS"]})`);
ok(Object.keys(SEED_FABRIC_RATES).length === 5, `SEED_FABRIC_RATES has exactly 5 SKUs (got ${Object.keys(SEED_FABRIC_RATES).length})`);
// best-main (Memorable) must price ABOVE better-main (Charisma) so the "best" tier is not a no-op — both are 25oz
// so they weigh the same (correct), but Memorable is Rose Brand's premium velour and carries a premium rate.
ok(SEED_FABRIC_RATES["RB-MV-MN"] > SEED_FABRIC_RATES["RB-CHAR-25"], "best-main Memorable prices above better-main Charisma (premium 25oz velour, not a cloned rate)");

// seed-rate analog of the RB reconciliation above: exercises the make-it
// (non-Rose-Brand) rates end to end through curtainCost, so a regression in
// either make-rate constant is caught by an actual computed cost — unlike
// makingRateFor(50) === DEFAULT_MAKING_RATE above, which only checks branch
// selection, not the value.
const seedBorder = curtainCost({ finishedWidthFt: 50, finishedHeightFt: 3, fullnessPct: 50, qty: 1 }, { fabricRate: SEED_FABRIC_RATES["RB-CHAR-25"], makingRate: DEFAULT_MAKING_RATE });
ok(seedBorder.costEach === 1533.75, `seed-rate border = sewnArea(225)×3.64 + sewnWidth(75)×9.53 = 1533.75 (got ${seedBorder.costEach})`);

/* --- curtain seed rates cover exactly the five used fabrics (task 2) --- */
ok(SEED_FABRIC_RATES["RB-CHAR-25"] === 3.64 && SEED_FABRIC_RATES["RB-EN-22"] === 2.84, "anchor fabrics carry their reconciled +10% seed rates");
ok(SEED_FABRIC_RATES["RB-EN-16"] === 2.1 && SEED_FABRIC_RATES["RB-MV-MN"] === 4.37 && SEED_FABRIC_RATES["RB-MUS"] === 0.9, "the three seed fabrics carry their flagged rates");
ok(Object.keys(SEED_FABRIC_RATES).length === 5, "exactly five fabrics have curtain rates — no unused fabrics carry one");

/* --- computeCurtain rebuilt on the two-term model (task 4) --- */
import { computeCurtain as computeCurtainQuote } from "@/app/(app)/estimator/pricing";
{
  const fabrics = [{ sku: "RB-CHAR-25", name: "25 oz Charisma Velour", costPerSqft: 4.2, curtainAreaRate: 3.64 }];
  // main-ish drape at the make-it (seeded) rate
  const cc = computeCurtainQuote(
    { name: "Main", hang: "", fabric: "RB-CHAR-25", qty: "2", height: "19", width: "20", fullness: "50", bottom: "" } as any,
    fabrics as any,
    0.3
  );
  // make cost = sewnArea(30×19=570)×3.64 + sewnWidth(30)×9.53 = 2074.8 + 285.9 = 2360.7
  ok(Math.abs(cc.costEach - 2360.7) < 1, `computeCurtain uses the two-term make-it cost (got ${cc.costEach})`);
  ok(Math.abs(cc.priceEach - cc.costEach / 0.7) < 0.02, "price = cost / (1 − 0.30)");
  // Rose Brand override wins
  const ov = computeCurtainQuote(
    { name: "Main", hang: "", fabric: "RB-CHAR-25", qty: "2", height: "19", width: "20", fullness: "50", bottom: "", vendorCostOverride: "2080" } as any,
    fabrics as any,
    0.3
  );
  ok(ov.costEach === 2080, "a Rose Brand cost override replaces the make cost in the quote");
}

/* --- Quick Design budget curtain block on the shared model (task 6) --- */
import { compute as computeQuick, defaultAState, tierSystems, curtainMakeCost, tierDefsDefault } from "@/app/(app)/design/quick/engine";
import { drapeRule as drapeRuleQ } from "@/lib/design/goods";
import { curtainCost as curtainCostQ, SEED_FABRIC_RATES as RATES_Q, makingRateFor as makingForQ } from "@/lib/design/curtain-pricing";
{
  const base = defaultAState(0);
  const s = { ...base, venue: "school", width: 40, ph: 20, depth: 30, tier: "better" as const, sys: { ...base.sys, curtains: true }, drape: { draw: true, legs: false, border: false, scenerytrack: false, fullstage: false } };
  const res = computeQuick(s);
  const curtains = res.systems.find((x) => x.key === "curtains")!;
  const drawItem = curtains.items.find((it) => it.desc === "Draw")!;
  // Expected unit cost = one Draw (a pair) priced through the shared model at the venue geometry.
  const dims = { proWidthFt: 40, proHeightFt: 20, stageWidthFt: 64, stageDepthFt: 30 };
  const rule = drapeRuleQ("Draw", dims, "better")!;
  const expected = curtainCostQ(
    { finishedWidthFt: rule.w, finishedHeightFt: rule.h, fullnessPct: rule.fullness, qty: rule.qty },
    { fabricRate: RATES_Q[rule.fabricSku], makingRate: makingForQ(rule.fullness) }
  ).costTotal;
  ok(Math.abs(drawItem.cost - Math.round(expected)) < 1, `Quick Design Draw cost = shared model make cost (got ${drawItem.cost}, expected ${Math.round(expected)})`);
}

/* --- the tier pipeline (what the screen renders) uses the two-term curtain
 * cost, not tierDefs.fabrics + area × costPerSqft (task 6 integration fix) ---
 * The assertion above only inspects compute()'s raw output. The Quick Design
 * SCREEN never reads that directly — it renders tierSystems/tierSystemsBase,
 * which run compute()'s systems through applyFabrics per tier column. Before
 * this fix, applyFabrics silently overwrote every curtain item's cost with
 * the old one-term formula, so the budget and the rendered tier grid priced
 * curtains two different ways. This drives the SAME "Draw" item through the
 * full tier pipeline and checks it against curtainMakeCost directly. */
{
  const base2 = defaultAState(0);
  const s2 = { ...base2, venue: "school", width: 40, ph: 20, depth: 30, tier: "better" as const, sys: { ...base2.sys, curtains: true }, drape: { draw: true, legs: false, border: false, scenerytrack: false, fullstage: false } };
  const tiered = tierSystems(computeQuick(s2), s2, "better", tierDefsDefault(), []);
  const dims2 = { proWidthFt: 40, proHeightFt: 20, stageWidthFt: 60, stageDepthFt: 30 };
  const expected2 = curtainMakeCost("draw", dims2, "better")!.cost;
  const cur = tiered.find((x) => x.key === "curtains")!.items.find((it) => it.desc === "Draw")!;
  ok(Math.abs(cur.cost - expected2) < 1, `tier-pipeline Draw cost = two-term make cost, not the old area×costPerSqft (got ${cur.cost}, expected ${expected2})`);
}

/* --- budget and quote agree on the same drape (task 7) --- */
{
  // A Draw at a 40×20 proscenium, better tier, priced both ways must match per unit.
  // stageWidthFt: 60, not the venue's default 50 — mirrors defaultAState's wing:10
  // (40 + 2×10 = 60) from the task 6 test above. drapeRule("Draw") never reads
  // stage width (only proWidthFt), so this has no effect on the assertion below.
  const dims = { proWidthFt: 40, proHeightFt: 20, stageWidthFt: 60, stageDepthFt: 30 };
  const rule = drapeRuleQ("Draw", dims as any, "better")!;
  const budget = curtainCostQ(
    { finishedWidthFt: rule.w, finishedHeightFt: rule.h, fullnessPct: rule.fullness, qty: rule.qty },
    { fabricRate: RATES_Q[rule.fabricSku], makingRate: makingForQ(rule.fullness) }
  ).costTotal;
  // Quote: same geometry typed into computeCurtain, one panel × qty summed.
  const fabrics = [{ sku: rule.fabricSku, name: "x", costPerSqft: 0, curtainAreaRate: RATES_Q[rule.fabricSku] }];
  const quotePanel = computeCurtainQuote(
    { name: "d", hang: "", fabric: rule.fabricSku, qty: String(rule.qty), height: String(rule.h), width: String(rule.w), fullness: String(rule.fullness), bottom: "" } as any,
    fabrics as any,
    0.3
  ).costEach;
  ok(Math.abs(budget - quotePanel * rule.qty) < 1, "budget and quote agree on the same drape's make cost");
}

/* --- an unrated curtain fabric falls back to costPerSqft, never $0 (final-review finding 1) --- */
{
  const marvelFab = [{ sku: "RB-MARVEL", name: "21 oz Marvel Velour", costPerSqft: 3.45 }];
  const cc = computeCurtainQuote({ name: "x", hang: "", fabric: "RB-MARVEL", qty: "1", height: "20", width: "40", fullness: "50", bottom: "" } as any, marvelFab as any, 0.3);
  // fabricRate falls back to costPerSqft 3.45: sewnArea 40×1.5×20=1200, making 60×9.53=571.8 → 1200×3.45+571.8=4711.8
  ok(Math.abs(cc.costEach - 4711.8) < 1, `unrated fabric prices via costPerSqft, not $0 (got ${cc.costEach})`);
}

import { curtainCost as portalCurtainCost, sellCoeffs as portalSellCoeffs, fabricSellPerSqft as portalFabricSell } from "@/lib/curtain-pricing";
import { curtainPriceEach as portalPriceEach } from "@/lib/curtain-geom";
/* --- portal curtain pricing unified onto the two-term model + cent-match invariant --- */
{
  const spec = (fab: string, w: string, h: string, full: string) => ({ name: "d", hang: "Pipe", fabric: fab, qty: "1", width: w, height: h, fullness: full, bottom: "Chain" });
  const AREA_RATE = 3.64; // Charisma
  const margin = 0.30;
  // server two-term cost: sewnW = 20×1.5=30, sewnA=30×19=570, cost=570×3.64+30×9.53=2360.7
  const sv = portalCurtainCost(spec("RB-CHAR-25", "20", "19", "50"), AREA_RATE, margin);
  ok(Math.abs(sv.costEach - 2360.7) < 0.01, `portal server cost = two-term make cost (got ${sv.costEach})`);
  ok(Math.abs(sv.priceEach - 2360.7 / 0.7) < 0.02, "portal price = cost / (1 − 0.30)");
  // CENT-MATCH: client preview equals server priceEach exactly
  const coeffs = portalSellCoeffs(margin);
  const px = portalFabricSell(AREA_RATE, margin);
  const clientPrice = portalPriceEach(spec("RB-CHAR-25", "20", "19", "50"), px, coeffs);
  ok(Math.abs(clientPrice - sv.priceEach) < 0.01, `client preview == server price to the cent (client ${clientPrice}, server ${sv.priceEach})`);
  // flat cyc uses the lower making rate on both sides
  const svFlat = portalCurtainCost(spec("RB-MUS", "40", "20", "0"), 0.9, margin);
  const clientFlat = portalPriceEach(spec("RB-MUS", "40", "20", "0"), portalFabricSell(0.9, margin), coeffs);
  ok(Math.abs(clientFlat - svFlat.priceEach) < 0.01, "flat cyc: client == server (uses cyc making rate both sides)");
}

/* --- Blob helpers (D116) --- */
import { dataUrlToBytes, safeName } from "@/lib/blob";
const dub = dataUrlToBytes("data:image/png;base64," + Buffer.from("hello").toString("base64"));
ok(dub.mime === "image/png" && dub.bytes.toString("utf8") === "hello", "data-URL decodes to bytes + mime");
ok(dataUrlToBytes("data:,plain%20text").bytes.toString("utf8") === "plain text", "non-base64 data-URLs decode too");
ok(/^[a-zA-Z0-9._-]+$/.test(safeName("Stage Plan (rev 3).pdf")), `unsafe filename characters are stripped (${safeName("Stage Plan (rev 3).pdf")})`);
ok(safeName("///") === "file", "a name with nothing usable falls back to 'file'");

/* --- Quartzite-6 rebrand (D117): gold default accent --- */
ok(DEFAULT_SETTINGS.accent === "#b08d4a", "default accent is Q-6 gold (D117)");

/* --- Quartzite-6 rebrand (D117): adaptive accent-contrast text --- */
ok(accentContrast("#b08d4a") === "#16181b", "gold accent carries near-black text (D117)");
ok(accentContrast("#7b3f8a") === "#fff" && accentContrast("#3d4eb0") === "#fff", "dark accents (purple/blue) carry white text");
ok(accentContrast("#b4543a") === "#fff", "red accent carries white text");

/* --- Quartzite-6 rebrand (D117): nav chips --- */
const d117Est = NAV.find((e) => e.kind === "group" && e.key === "est");
ok(
  !!(d117Est && d117Est.kind === "group" &&
    d117Est.children.map((c) => c.key).join(",") === "quotes,estimator,reviews"),
  "EST = Quotes, Estimator, Reviews in order",
);
ok(activeKeyFor("/estimator") === "estimator", "/estimator lights its own EST child");
ok(activeKeyFor("/") === "home", "root still resolves to home (drawer link + mark)");
ok(
  parentGroupOf("quotes") === "est" && parentGroupOf("estimator") === "est" && parentGroupOf("reviews") === "est",
  "quotes, estimator, reviews report EST as parent",
);
ok(
  parentGroupOf("leads") === "crm" && parentGroupOf("venues") === "crm" && parentGroupOf("field") === "crm",
  "relationship children report CRM as parent",
);
ok(NAV.every((e) => e.kind === "group"), "every top-level entry is a group — the mark handles Home");

/* --- Sign-on email pattern (D118): firstname + last initial --- */
ok(emailFor("Jeff Chesebro") === "jeffc@peaksystemsgroup.com", "emailFor is firstname+lastinitial (D118)");
ok(emailFor("Isaac Mittlesteadt") === "isaacm@peaksystemsgroup.com", "long last names contribute just their initial");
ok(emailFor("Cher") === "cher@peaksystemsgroup.com", "single-word names keep the whole-name fallback");
ok(legacyEmailFor("Jeff Chesebro") === "jchesebro@peaksystemsgroup.com", "legacy derivation preserved for the migration + collision fallback");

/* ============ TASKS (#17) — store pure logic ============ */
import {
  isOverdue, taskFromLegacy, expandTemplate, taskBellItems,
  STATUSES, type TaskRecord, type TaskTemplateItem,
} from "@/lib/stores/tasks";

{
  const NOW = 1_800_000_000_000;
  const DAY = 86400000;
  ok(STATUSES.length === 4 && STATUSES.includes("blocked"), "tasks: 4-state status includes blocked");

  ok(isOverdue({ dueAt: NOW - DAY, status: "open" }, NOW) === true, "tasks: past-due open task is overdue");
  ok(isOverdue({ dueAt: NOW - DAY, status: "done" }, NOW) === false, "tasks: done task is never overdue");
  ok(isOverdue({ dueAt: null, status: "open" }, NOW) === false, "tasks: no due date, never overdue");
  ok(isOverdue({ dueAt: NOW + DAY, status: "blocked" }, NOW) === false, "tasks: future due date not overdue");

  const legacy = taskFromLegacy("P-3001", { id: "tk-abc", title: "Hang truss", section: "Install", assignee: "Sam Rivera", done: true, doneAt: NOW - DAY }, NOW);
  ok(legacy.id === "tk-abc", "tasks: migration preserves legacy tk- id");
  ok(legacy.projectId === "P-3001" && legacy.quoteId === null, "tasks: migration sets project parent pointer");
  ok(legacy.status === "done" && legacy.doneAt === NOW - DAY, "tasks: legacy done maps to status done with doneAt kept");
  ok(legacy.assigneeName === "Sam Rivera" && legacy.assigneeUserId === null, "tasks: legacy name kept, no user id");
  const legacyOpen = taskFromLegacy("P-3001", { id: "tk-def", title: "Pull cable", section: "Install", assignee: "", done: false }, NOW);
  ok(legacyOpen.status === "open" && legacyOpen.doneAt === null, "tasks: legacy undone maps to open");

  const tmpl: TaskTemplateItem[] = [
    { key: "walkthrough", title: "Walk the room with the customer" },
    { key: "punch", title: "Write the punch list", section: "Closeout" },
  ];
  const fresh = expandTemplate(tmpl, "signoff", new Set());
  ok(fresh.length === 2 && fresh[0].coverageKey === "signoff:walkthrough", "tasks: template expands with stage-scoped coverage keys");
  ok(fresh[1].section === "Closeout" && fresh[0].section === "Install", "tasks: template section defaults to Install");
  const rerun = expandTemplate(tmpl, "signoff", new Set(["signoff:walkthrough"]));
  ok(rerun.length === 1 && rerun[0].coverageKey === "signoff:punch", "tasks: coverage-key de-dup skips existing on re-entry");

  const mk = (o: Partial<TaskRecord>): TaskRecord => ({
    id: "T-6000", title: "t", section: "Install", projectId: null, quoteId: null,
    coverageKey: null, assigneeUserId: null, assigneeName: "", dueAt: null,
    status: "open", notes: "", createdBy: "x", createdAt: NOW, updatedAt: NOW, doneAt: null, ...o,
  });
  const bell = taskBellItems([
    mk({ id: "a", assigneeName: "Jeff Chesebro" }),                       // mine, open
    mk({ id: "b", assigneeName: "Someone Else", dueAt: NOW - DAY }),      // overdue, not mine
    mk({ id: "c", assigneeName: "Someone Else" }),                        // not mine, not overdue
    mk({ id: "d", assigneeName: "Jeff Chesebro", status: "done" }),       // mine but done
  ], "Jeff Chesebro", NOW);
  ok(bell.map(t => t.id).join(",") === "a,b", "tasks: bell = open assigned-to-me + overdue, done excluded");
}

console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
process.exit(fail ? 1 : 0);
