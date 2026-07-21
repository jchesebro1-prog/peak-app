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
ok(!!(designGroup && designGroup.kind === "group" && designGroup.children.length === 6),
  "Design has six children: Overview, Engagements, Designs, Steel, Lineset, Motors");

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
ok(NAV.length === 4, "the header is down to 4 top-level items (Operations merge, D100)");
ok(!NAV.some((e) => e.kind === "link" && e.key === "queue"), "My Queue is no longer top-level");
ok(!NAV.some((e) => e.kind === "link" && e.key === "calendar"), "Calendar is no longer top-level");
ok(!NAV.some((e) => e.kind === "link" && e.key === "inbox"), "Inbox is no longer top-level");
ok(activeKeyFor("/") === "home", "root lights Home");
ok(activeKeyFor("/queue") === "home", "queue lights Home");
ok(activeKeyFor("/calendar") === "home", "calendar lights Home — this path had NO map entry before");
ok(activeKeyFor("/inbox") === "home", "inbox lights Home");
ok(activeKeyFor("/reports") === "home", "Reports lights Home now that it is a Home tab (D99)");

// ---- General dissolution (D99): Companies/People/Field Survey → Sales ----
const d99Sales = NAV.find((e) => e.kind === "group" && e.key === "sales");
ok(
  !!(d99Sales && d99Sales.kind === "group" && d99Sales.children.length === 7),
  "Sales has seven children after Venues joins (D101)",
);
ok(
  !!(
    d99Sales &&
    d99Sales.kind === "group" &&
    d99Sales.children.map((c) => c.key).join(",") ===
      "leads,quotes,reviews,companies,people,venues,field"
  ),
  "Sales children are leads, quotes, reviews, companies, people, venues, field in order",
);
ok(
  parentGroupOf("companies") === "sales" &&
    parentGroupOf("people") === "sales" &&
    parentGroupOf("field") === "sales",
  "companies, people, field now report Sales as their parent group",
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
ok(parentGroupOf("venues") === "sales", "venues reports Sales as its parent group");

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
  NAV.map((e) => e.key).join(",") === "home,design,sales,operations",
  "the four top-level items are Home, Design, Sales, Operations in order",
);
ok(
  activeKeyFor("/catalog") === "settings" &&
    activeKeyFor("/templates") === "settings" &&
    activeKeyFor("/estimating-rules") === "settings" &&
    activeKeyFor("/import") === "settings",
  "catalog, templates, estimating-rules, import all light Settings",
);

// ---- Operations merge (D100): Installs + Service → Operations ----
const d100Ops = NAV.find((e) => e.kind === "group" && e.key === "operations");
ok(
  !!(d100Ops && d100Ops.kind === "group" && d100Ops.children.length === 6),
  "Operations has six children",
);
ok(
  !!(
    d100Ops &&
    d100Ops.kind === "group" &&
    d100Ops.children.map((c) => c.key).join(",") ===
      "projects,schedule,fieldwork,flametests,inspections,repairs"
  ),
  "Operations children are projects, schedule, fieldwork, flametests, inspections, repairs in order",
);
ok(!NAV.some((e) => e.kind === "group" && e.key === "installs"), "the Installs group is gone");
ok(!NAV.some((e) => e.kind === "group" && e.key === "service"), "the Service group is gone");
ok(
  parentGroupOf("projects") === "operations" &&
    parentGroupOf("schedule") === "operations" &&
    parentGroupOf("fieldwork") === "operations" &&
    parentGroupOf("flametests") === "operations" &&
    parentGroupOf("inspections") === "operations" &&
    parentGroupOf("repairs") === "operations",
  "all six work children report Operations as their parent group",
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

console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
process.exit(fail ? 1 : 0);
