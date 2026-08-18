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
import { venueDimsFromEstimator, venueDimsFromLineset, DEFAULT_VENUE_DIMS, battenLenFt, BATTEN_OVERHANG_FT } from "@/lib/design/venue-dims";
import { curtainCost, curtainPrice, makingRateFor, DEFAULT_MAKING_RATE, DEFAULT_CYC_MAKING_RATE, SEED_FABRIC_RATES } from "@/lib/design/curtain-pricing";
<<<<<<< HEAD
import { DEFAULT_SETTINGS, GO_LIVE_RESET_COLLECTIONS } from "@/db/seed-data";
=======
import { DEFAULT_SETTINGS, DEMO_COLLECTIONS } from "@/db/seed-data";
>>>>>>> 4be1233 (feat(assessments): venue class model — 6 classes, subtypes, per-class field sets, migration maps)
import { DOC_TABLES } from "@/db/doc-tables";
import { accentContrast } from "@/lib/color";
import { emailFor, legacyEmailFor } from "@/lib/team";
import { gridProjectsSeed } from "@/db/seeds/grid-projects";
import { quotesSeed } from "@/db/seeds/quotes";
import ExcelJS from "exceljs";
import { xlsxToCsv } from "@/lib/import/xlsx-to-csv";
import { getTypeMeta } from "@/app/(app)/import/types";
import {
  autoMap,
  parseCsv as parseImportCsv,
  prepareRows,
} from "@/app/(app)/import/parse";
// Pure (no store access, no DB) — see the note on catalogPatch itself.
import { catalogPatch } from "@/app/(app)/import/registry";
import {
  VENUE_CLASSES, SUBTYPES, VISIT_PURPOSES, classMeasureFields,
  venueClassFor, venueSubtypeFor, visitPurposeFor,
  TIER1_WIDTH_BY_CLASS, TIER1_DEPTH_BY_CLASS,
} from "@/lib/stores/venue-classes";
import { venueDirectoryPage } from "@/lib/venue-directory-page";
import {
  defaultInstallLeadWeeks,
  projectScheduleFromQuote,
  projectScheduleFromTargetDate,
} from "@/lib/project-target-date";
import { nextPendingDeliveryEta, scheduleBookingSeed } from "@/lib/schedule-booking";
import {
  buildFieldPacketScopeGroups,
  buildFieldPacketVisitSummaries,
  buildFieldWorkPacket,
} from "@/lib/field-work-packet";
import { applyProjectSignoff } from "@/lib/project-signoff";
import { applyExistingCustomerToLeadForm } from "@/app/(app)/leads/new-lead-prefill";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// The async checks exercise real stores. Keep them off the single-writer dev
// database and make their seed state deterministic instead of racing the
// background seed kicked off by getDb().
const specScratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "peak-specs-"));
process.env.PGLITE_PATH = path.join(specScratchDir, "pglite");
process.env.SEED_DEMO = "true";
const cleanupSpecDb = () => fs.rmSync(specScratchDir, { recursive: true, force: true });

import {
  VENUE_CLASSES, SUBTYPES, VISIT_PURPOSES, classMeasureFields,
  venueClassFor, venueSubtypeFor, visitPurposeFor,
  TIER1_WIDTH_BY_CLASS, TIER1_DEPTH_BY_CLASS,
} from "@/lib/stores/venue-classes";

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };

<<<<<<< HEAD
/* --- go-live reset coverage (#94) ---
 * Break caught: adding or using a no-seed document collection without making
 * the go-live reset clear it leaves demo-era rows pointing at re-minted IDs. */
const resetCollections = [...GO_LIVE_RESET_COLLECTIONS].sort();
const businessDocumentCollections = Object.keys(DOC_TABLES).sort();
ok(
  JSON.stringify(resetCollections) === JSON.stringify(businessDocumentCollections),
  `go-live reset covers every business document collection (${resetCollections.length}/${businessDocumentCollections.length})`,
);

/* --- scalable Venues directory (#92) ---
 * Break caught: returning the entire filtered directory instead of a bounded
 * page recreates the multi-megabyte server-component payload. */
const venueRows = Array.from({ length: 121 }, (_, i) => ({ id: `v-${i + 1}` }));
const venuePage3 = venueDirectoryPage(venueRows, 3, 50);
ok(venuePage3.page === 3, "venues pagination keeps a valid requested page");
ok(venuePage3.totalPages === 3, "venues pagination reports three pages for 121 rows");
ok(
  venuePage3.rows.length === 21 && venuePage3.rows[0].id === "v-101" && venuePage3.rows[20].id === "v-121",
  "venues pagination returns only the final 21 rows on page three",
);
const venuePastEnd = venueDirectoryPage(venueRows, 99, 50);
ok(
  venuePastEnd.page === 3 && venuePastEnd.rows[0].id === "v-101",
  "venues pagination clamps an out-of-range page to the last page",
);
const emptyVenuePage = venueDirectoryPage([], -4, 50);
ok(
  emptyVenuePage.page === 1 && emptyVenuePage.totalPages === 1 && emptyVenuePage.rows.length === 0,
  "venues pagination has a stable empty-directory page",
);

/* --- new lead customer prefill (#12) ---
 * Break caught: selecting an existing customer in the New Lead form still
 * creates an unlinked lead because the form never stamps customerId or reuses
 * the customer's primary contact/location fields. */
const linkedLead = applyExistingCustomerToLeadForm(
  {
    org: "",
    contact: "",
    contactRole: "",
    email: "",
    phone: "",
    city: "",
    state: "WI",
    source: "phone",
    interest: "",
    owner: "",
    value: "",
    customerId: null,
  },
  {
    id: "lakefront",
    name: "Lakefront Performing Arts Center",
    locations: [
      { label: "Main", city: "Milwaukee", state: "WI", primary: true },
      { label: "Annex", city: "Waukesha", state: "WI", primary: false },
    ],
    contacts: [
      { name: "Morgan Hall", email: "morgan@lakefront.org", phone: "555-0100", primary: true },
    ],
  },
);
ok(linkedLead.customerId === "lakefront", "new lead selection stamps the existing customer id");
ok(
  linkedLead.org === "Lakefront Performing Arts Center" &&
    linkedLead.contact === "Morgan Hall" &&
    linkedLead.email === "morgan@lakefront.org" &&
    linkedLead.phone === "555-0100" &&
    linkedLead.city === "Milwaukee" &&
  linkedLead.state === "WI",
  "new lead selection prefills the primary customer contact and location snapshot",
);

/* --- PUNCHLIST #44: field-work install packet includes the handoff essentials ---
 * Break caught: the Field Work surface only exposes tasks/notes/time/BOM, so
 * the installer does not get one packet with venue/contact info, crew,
 * recent notes, material status, and the signoff checklist. */
{
  const packet = buildFieldWorkPacket(
    {
      crew: [
        { id: "cw-2", person: "Alex Roe", role: "Programmer", start: new Date(2026, 7, 20).getTime(), end: new Date(2026, 7, 21).getTime() },
        { id: "cw-1", person: "Jamie Fox", role: "Installer", start: new Date(2026, 7, 18).getTime(), end: new Date(2026, 7, 19).getTime() },
      ],
      installStart: new Date(2026, 7, 18).getTime(),
      installEnd: new Date(2026, 7, 21).getTime(),
      signoff: { signedBy: "Jeff Chesebro", signedAt: new Date(2026, 7, 22).getTime(), scopeChecks: { Lighting: true, Audio: true } },
      notes: [
        { id: "n1", by: "Jeff Chesebro", at: new Date(2026, 7, 18, 9).getTime(), text: "Load-in through stage left.", photo: null },
        { id: "n2", by: "Morgan Hall", at: new Date(2026, 7, 19, 14).getTime(), text: "House opens at 6pm.", photo: null },
        { id: "n3", by: "Jeff Chesebro", at: new Date(2026, 7, 20, 11).getTime(), text: "Client added two cue lights.", photo: null },
        { id: "n4", by: "Jamie Fox", at: new Date(2026, 7, 21, 8).getTime(), text: "Rigging inspection complete.", photo: null },
      ],
      procurement: [
        { id: "pl-1", sku: "ETC-S4", desc: "Source Four", vendor: "ETC", qty: 4, unit: "ea", cost: 1200, leadDays: 14, status: "received", orderedAt: null, po: "PO-1" },
        { id: "pl-2", sku: "CBL-01", desc: "Cable loom", vendor: "TMB", qty: 2, unit: "ea", cost: 300, leadDays: 7, status: "ordered", orderedAt: null, po: "PO-2" },
      ],
    } as any,
    {
      label: "Main Stage",
      address: "123 Main St",
      city: "Milwaukee",
      state: "WI",
      primary: true,
      venueKind: "proscenium",
      travelMiles: null,
      travelMin: null,
    },
    [
      { name: "Pat Venue", role: "TD", email: "pat@example.com", phone: "555-0100", primary: false },
      { name: "Morgan Hall", role: "Client", email: "morgan@example.com", phone: "555-0111", primary: true },
    ]
  );
  ok(packet.installWindowLabel === "Aug 18 – Aug 21", "#44 packet carries the install window summary");
  ok(
    packet.venueLabel === "Main Stage" && packet.venueAddress === "123 Main St · Milwaukee, WI",
    "#44 packet carries venue name and address",
  );
  ok(
    packet.crew.map((c) => c.person).join("|") === "Jamie Fox|Alex Roe",
    "#44 packet sorts crew in install order",
  );
  ok(
    packet.contacts[0]?.name === "Morgan Hall" && packet.contacts[1]?.name === "Pat Venue",
    "#44 packet surfaces the primary contact first",
  );
  ok(
    packet.recentNotes.map((n) => n.id).join("|") === "n4|n3|n2",
    "#44 packet shows the three most recent notes first",
  );
  ok(
    packet.materials.total === 2 && packet.materials.onSite === 1 && packet.materials.awaiting === 1,
    "#44 packet summarizes on-site versus awaiting materials",
  );
  ok(
    packet.checklist.find((c) => c.scope === "Lighting")?.accepted === true &&
      packet.checklist.find((c) => c.scope === "Rigging")?.accepted === false,
    "#44 packet carries the full signoff checklist with unchecked scopes still visible",
  );
  const scopeGroups = buildFieldPacketScopeGroups([
    { name: "Lighting", kind: "materials", items: [{ id: 1 }, { id: 2 }] },
    { name: "Labor", kind: "labor", items: [{ id: 3 }] },
    { name: "Empty", kind: "materials", items: [] },
  ]);
  ok(
    scopeGroups.map((g) => `${g.name}:${g.sectionKind}:${g.itemCount}`).join("|") ===
      "Lighting:materials:2|Labor:labor:1",
    "#44 packet carries saved scope groups from the source quote and drops empty sections",
  );
  const visitRows = buildFieldPacketVisitSummaries(
    [
      {
        id: "SV-1",
        reason: "Punch walk",
        locationId: "loc1",
        startAt: new Date(2026, 7, 8).getTime(),
        createdAt: new Date(2026, 7, 1).getTime(),
        assignedTo: "Jeff Chesebro",
        stage: "scheduled",
        engagementId: "CE-1001",
      },
      {
        id: "SV-2",
        reason: "Sales call",
        locationId: "loc2",
        startAt: new Date(2026, 7, 9).getTime(),
        createdAt: new Date(2026, 7, 2).getTime(),
        assignedTo: "",
        stage: "done",
        engagementId: null,
      },
      {
        id: "SV-3",
        reason: "Install check-in",
        locationId: "loc1",
        startAt: null,
        createdAt: new Date(2026, 7, 10).getTime(),
        assignedTo: "Jamie Fox",
        stage: "claimed",
        engagementId: null,
      },
    ],
    "loc1",
    new Date(2026, 7, 12).getTime(),
  );
  ok(
    visitRows.map((v) => v.id).join("|") === "SV-3|SV-1",
    "#44 packet visit history filters to the venue and sorts newest first",
  );
  ok(
    visitRows[0]?.status === "claimed" &&
      visitRows[0]?.href === "/calendar" &&
      visitRows[1]?.status === "Done" &&
      visitRows[1]?.href === "/design/engagements/CE-1001",
    "#44 packet visit history keeps the right status/href for unscheduled and past visits",
  );
}

/* --- PUNCHLIST #44: field-side signoff applies the same normalized project mutation offline ---
 * Break caught: Field Work can save project docs offline, but signoff needs
 * the same normalized signoff payload and stage-history write as the server
 * path or the phone capture diverges from the office record. */
{
  const stampedAt = new Date(2026, 7, 12, 10, 30).getTime();
  const signed = applyProjectSignoff(
    {
      stage: "training",
      stageHistory: [{ at: new Date(2026, 7, 10).getTime(), from: "install", to: "training", by: "Jeff Chesebro" }],
      signoff: null,
      updatedAt: new Date(2026, 7, 10).getTime(),
    },
    {
      name: " Morgan Hall ",
      role: " Client ",
      signatureBlobKey: "  data:image/png;base64,abc  ",
      signedByName: "",
      capturedBy: "",
      scopeChecks: { Lighting: true, Fake: true } as any,
      note: "  Final cue-light adjustment pending. ",
    } as any,
    "Jeff Chesebro",
    stampedAt,
  );
  ok(signed.stage === "signoff", "#44 field-side signoff advances the local project stage to Sign-off");
  ok(
    signed.stageHistory?.[signed.stageHistory.length - 1]?.to === "signoff" &&
      signed.stageHistory?.[signed.stageHistory.length - 1]?.from === "training",
    "#44 field-side signoff appends the matching stage-history entry",
  );
  const signedSignoff = (signed as { signoff?: any }).signoff;
  ok(
    signedSignoff?.name === "Morgan Hall" &&
      signedSignoff?.role === "Client" &&
      signedSignoff?.signatureBlobKey === "data:image/png;base64,abc",
    "#44 field-side signoff trims signer fields and the signature payload",
  );
  ok(
    signedSignoff?.signedByName === "Morgan Hall" &&
      signedSignoff?.capturedBy === "Jeff Chesebro" &&
      signedSignoff?.scopeChecks?.Lighting === true &&
      !("Fake" in (signedSignoff?.scopeChecks || {})),
    "#44 field-side signoff keeps the same fallback and scope-normalization rules offline",
  );
}
const unlinkedLead = applyExistingCustomerToLeadForm(linkedLead, null);
ok(unlinkedLead.customerId === null, "switching back to Add new clears the customer link");

/* --- estimator install timeframe → project goal (#15) ---
 * Break caught: quote conversion ignoring the quote timeframe and falling back
 * to a hardcoded date guess detached from the win date. */
ok(defaultInstallLeadWeeks({ value: 12000, spec: { sections: [], mobs: [] } } as any) === 12,
  "install timeframe defaults to the 12-week minimum for a small quote");
ok(defaultInstallLeadWeeks({
  value: 180000,
  spec: { sections: [{ id: "s1", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, items: [] }], mobs: [] },
} as any) === 16, "install timeframe stretches for larger quote value bands");
ok(defaultInstallLeadWeeks({
  value: 45000,
  spec: { sections: [], mobs: [{ type: "Install", days: 8, crew: 4, discipline: "Install" }] },
} as any) === 16, "install timeframe stretches for heavy mobilization scope");

const wonAt = Date.UTC(2026, 7, 11, 12, 0, 0); // Aug 11 2026
const targetOnly = projectScheduleFromTargetDate(wonAt + 12 * 7 * 86400000, false);
ok(targetOnly.targetDate === wonAt + 12 * 7 * 86400000 && targetOnly.installStart === null && targetOnly.installEnd === null,
  "order schedule keeps only the completion target");

const installSched = projectScheduleFromQuote({
  value: 45000,
  installLeadWeeks: 14,
  spec: {
    sections: [{ id: "labor", name: "Install", kind: "labor", mfr: "", freightPct: 0, items: [{ id: 1 }] }],
    mobs: [{ type: "Install", days: 2, crew: 3, discipline: "Install" }],
  },
} as any, wonAt);
ok(installSched.targetDate === wonAt + 14 * 7 * 86400000, "project target is anchored to the win date plus quote weeks");
ok(
  installSched.installStart === installSched.targetDate - 4 * 86400000 &&
    installSched.installEnd === installSched.targetDate + 2 * 86400000,
  "install window shifts with the completion target",
=======
/* --- Go-live reset coverage (PUNCHLIST #94) --- */
const resetCollections = [...DEMO_COLLECTIONS].sort();
const documentCollections = Object.keys(DOC_TABLES).sort();
ok(
  resetCollections.join("\n") === documentCollections.join("\n"),
  "go-live reset covers every business-document collection"
);
ok(
  resetCollections.includes("equipment_bookings") &&
    resetCollections.includes("grid_sheets") &&
    resetCollections.includes("tasks") &&
    resetCollections.includes("notes"),
  "go-live reset covers no-seed child collections"
>>>>>>> 4be1233 (feat(assessments): venue class model — 6 classes, subtypes, per-class field sets, migration maps)
);

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


/* --- Task 1: catalog taxonomy — groups/trades + category map (#39) --- */
import { GROUP_TRADES, DEFAULT_CATEGORY_MAP, resolveCategoryMap, groupOf, tradeOf } from "@/lib/catalog-taxonomy";

ok(groupOf({ category: "Fixtures" }, DEFAULT_CATEGORY_MAP) === "Fixtures", "taxonomy: groupOf resolves a mapped category");
ok(groupOf({ category: "Some Unmapped Category" }, DEFAULT_CATEGORY_MAP) === null, "taxonomy: groupOf returns null for an unmapped category");

ok(tradeOf({ category: "Fixtures", trade: "Rigging" }, DEFAULT_CATEGORY_MAP) === "Rigging", "taxonomy: tradeOf honors the part-level trade override");
ok(tradeOf({ category: "Video Controls" }, DEFAULT_CATEGORY_MAP) === GROUP_TRADES["Video Controls"], "taxonomy: tradeOf falls back group->trade via GROUP_TRADES");
ok(tradeOf({ category: "Fixtures", trade: "Bogus" }, DEFAULT_CATEGORY_MAP) === "Lighting", "taxonomy: tradeOf ignores an invalid part-level trade and falls through to the map");
ok(tradeOf({ category: "Nonexistent" }, DEFAULT_CATEGORY_MAP) === null, "taxonomy: tradeOf returns null for a genuinely unmapped category");

const storedMap = resolveCategoryMap({
  Fixtures: { group: "Curtains", trade: "Rigging" },
  "Brand New Category": { trade: "AV" },
});
ok(storedMap.Fixtures.group === "Curtains" && storedMap.Fixtures.trade === "Rigging", "taxonomy: resolveCategoryMap lets a stored entry override a default");
ok(storedMap["Brand New Category"].trade === "AV", "taxonomy: resolveCategoryMap lets a stored entry add a brand-new category key");
ok(resolveCategoryMap().Fixtures.trade === "Lighting", "taxonomy: resolveCategoryMap with no stored map returns the defaults untouched");


/* --- Task 3: ports + wire-type registry + compatibility rule (#39) --- */
import {
  CONNECTION_TYPES,
  DEFAULT_WIRE_TYPES,
  resolveWireTypes,
  canConnect,
  compatibleWireTypes,
  type Port,
} from "@/lib/catalog-connect";

const portOut = (connectionType: string): Port => ({ name: "out", direction: "out", connectionType });
const portIn = (connectionType: string): Port => ({ name: "in", direction: "in", connectionType });
const portIo = (connectionType: string): Port => ({ name: "io", direction: "io", connectionType });

ok(canConnect(portOut("DMX512 (5-pin XLR)"), portIn("DMX512 (5-pin XLR)")), "connect: out->in same type connects");
ok(!canConnect(portOut("DMX512 (5-pin XLR)"), portOut("DMX512 (5-pin XLR)")), "connect: out->out same type does not connect");
ok(!canConnect(portIn("DMX512 (5-pin XLR)"), portIn("DMX512 (5-pin XLR)")), "connect: in->in same type does not connect");
ok(canConnect(portIo("DMX512 (5-pin XLR)"), portIn("DMX512 (5-pin XLR)")), "connect: io->in connects");
ok(canConnect(portIo("DMX512 (5-pin XLR)"), portIo("DMX512 (5-pin XLR)")), "connect: io->io same type connects");
ok(!canConnect(portOut("DMX512 (5-pin XLR)"), portIn("HDMI")), "connect: different connection types never connect");

const dmxCompat = compatibleWireTypes("DMX512 (5-pin XLR)", DEFAULT_WIRE_TYPES);
ok(dmxCompat.length > 0, "connect: compatibleWireTypes finds at least one DMX wire type in the defaults");

const hdmiCompat = compatibleWireTypes("HDMI", DEFAULT_WIRE_TYPES);
ok(hdmiCompat.length === 1 && hdmiCompat[0].id === "hdmi", "connect: compatibleWireTypes filters out non-matching wire types (HDMI -> only the hdmi entry)");

ok(compatibleWireTypes("RDM", DEFAULT_WIRE_TYPES).length === 0, "connect: compatibleWireTypes returns an empty array for a connectionType no wire type carries");

const allKnownConnTypes = DEFAULT_WIRE_TYPES.every((wt) =>
  wt.connectionTypes.every((ct) => CONNECTION_TYPES.includes(ct))
);
ok(allKnownConnTypes, "connect: every DEFAULT_WIRE_TYPES connectionType is a member of CONNECTION_TYPES");

ok(resolveWireTypes() !== DEFAULT_WIRE_TYPES, "connect: resolveWireTypes with no stored value returns a fresh copy, not the shared singleton");
ok(JSON.stringify(resolveWireTypes()) === JSON.stringify(DEFAULT_WIRE_TYPES), "connect: resolveWireTypes with no stored value is equal in content to the defaults");
const storedWireTypes = [{ id: "custom", label: "Custom", connectionTypes: ["Edison"] }];
ok(resolveWireTypes(storedWireTypes) === storedWireTypes, "connect: resolveWireTypes returns the stored array when provided");


/* --- Task 4: validateDeviceWire — grid device-wire compatibility gate (#39) --- */
import { validateDeviceWire } from "@/lib/catalog-connect";

const okPair = validateDeviceWire(
  { ports: [portOut("DMX512 (5-pin XLR)")] },
  { ports: [portIn("DMX512 (5-pin XLR)")] }
);
ok(okPair.ok === true, "wire: a compatible port pair validates ok");
if (okPair.ok) ok(okPair.connectionType === "DMX512 (5-pin XLR)", "wire: ok result stamps the shared connectionType");

const refusedPair = validateDeviceWire(
  { ports: [portOut("HDMI")] },
  { ports: [portOut("DMX512 (5-pin XLR)")] }
);
ok(refusedPair.ok === false, "wire: both parts have ports but no compatible pair -> refused");
if (!refusedPair.ok) ok(refusedPair.reason.length > 0, "wire: a refusal always carries a non-empty reason");

const missingBoth = validateDeviceWire({}, {});
ok(
  missingBoth.ok === false && missingBoth.reason === "no connection metadata",
  "wire: neither part has ports -> 'no connection metadata' (the caller's allowed-case, not a hard error)"
);

const missingOne = validateDeviceWire({ ports: [] }, { ports: [portIn("HDMI")] });
ok(
  missingOne.ok === false && missingOne.reason === "no connection metadata",
  "wire: one part has no ports -> same 'no connection metadata' reason"
);

const multiFrom = validateDeviceWire(
  { ports: [portOut("HDMI"), portOut("XLR line/mic")] },
  { ports: [portIn("XLR line/mic"), portIn("HDMI")] }
);
ok(
  multiFrom.ok === true && multiFrom.ok && multiFrom.connectionType === "HDMI",
  "wire: first canConnect-satisfying port pair (fromPart order, then toPart order) wins"
);


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
// Punch #55 (D124) REVERSES the D117 shape: Jeff asked for Home back as a real tab
// on web and mobile, so the header is five groups and Home is the first. The five
// hub routes stay CHILDREN of that group (they are not top-level links).
ok(NAV.length === 5, "the header has 5 top-level items: Home joined the chips (#55, D124)");
ok(!NAV.some((e) => e.kind === "link" && e.key === "queue"), "My Queue is not top-level");
ok(!NAV.some((e) => e.kind === "link" && e.key === "calendar"), "Calendar is not top-level");
ok(!NAV.some((e) => e.kind === "link" && e.key === "inbox"), "Inbox is not top-level");
const homeGroup = NAV.find((e) => e.kind === "group" && e.key === "home");
ok(!!homeGroup, "Home is a top-level GROUP again (#55) — the mark links there too");
ok(
  !!(homeGroup && homeGroup.kind === "group" && homeGroup.children.length === HOME_TABS.length),
  "the Home group carries the five HOME_TABS as children, not a duplicated list",
);
// activeKeyFor now returns the CHILD key: parentGroupOf only matches child keys, so
// returning "home" would have left the pill dark on the app's most important route.
ok(activeKeyFor("/") === "dashboard", "root lights the Dashboard child (#55)");
ok(activeKeyFor("/queue") === "queue", "queue lights its own child key (#55)");
ok(activeKeyFor("/calendar") === "calendar", "calendar lights its own child key (#55)");
ok(activeKeyFor("/inbox") === "inbox", "inbox lights its own child key (#55)");
ok(activeKeyFor("/reports") === "reports", "Reports lights its own child key (#55)");
ok(
  parentGroupOf(activeKeyFor("/")) === "home" &&
    parentGroupOf(activeKeyFor("/queue")) === "home" &&
    parentGroupOf(activeKeyFor("/calendar")) === "home" &&
    parentGroupOf(activeKeyFor("/inbox")) === "home" &&
    parentGroupOf(activeKeyFor("/reports")) === "home",
  "all five hub routes still resolve UP to the Home group, so the chip lights (#55)",
);

// ---- General dissolution (D99): Companies/People/Field Survey → Sales (now CRM, D117) ----
// Opportunities joined as the first child (#18) — six children as of plan 02.
const d99Sales = NAV.find((e) => e.kind === "group" && e.key === "crm");
ok(
  !!(d99Sales && d99Sales.kind === "group" && d99Sales.children.length === 7),
  "CRM has seven children — Quotes and Reviews moved to EST (D117), Opportunities added (#18), My Leads added (#22)",
);
ok(
  !!(
    d99Sales &&
    d99Sales.kind === "group" &&
    d99Sales.children.map((c) => c.key).join(",") ===
      "opportunities,leads,myleads,companies,people,venues,field"
  ),
  "CRM children are opportunities, leads, myleads, companies, people, venues, field in order",
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
const topGroups = NAV.filter(
  (e): e is Extract<(typeof NAV)[number], { kind: "group" }> => e.kind === "group",
);
ok(
  topGroups.map((e) => e.label).join(" · ") === "Home · Sales · Installs · Customers · Design",
  "desktop nav labels are the full words Jeff asked for in #45(b)",
);
ok(
  topGroups.map((e) => e.shortLabel || e.label).join(" · ") === "Home · EST · PM · CRM · DESIGN",
  "compact nav labels stay abbreviated for narrow layouts in #45(b)",
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
  NAV.map((e) => e.key).join(",") === "home,est,pm,crm,design",
  "the top-level chips are Home, EST, PM, CRM, DESIGN in order (#55 put Home back, D124)",
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
  !!(d100Ops && d100Ops.kind === "group" && d100Ops.children.length === 8),
  "PM has eight children (My Projects added, #22; Rentals added, #93)",
);
ok(
  !!(
    d100Ops &&
    d100Ops.kind === "group" &&
    d100Ops.children.map((c) => c.key).join(",") ===
      "projects,myprojects,schedule,fieldwork,flametests,inspections,repairs,rentals"
  ),
  "PM children are projects, myprojects, schedule, fieldwork, flametests, inspections, repairs, rentals in order",
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
const vdEst = venueDimsFromEstimator({ width: 36, ph: 18, depth: 26, grid: 24, wing: 12, proscenium: true });
ok(vdEst.proWidthFt === 36, "estimator `width` maps to PRO width, not stage width");
ok(vdEst.proHeightFt === 18, "estimator `ph` maps to PRO height");
ok(vdEst.stageWidthFt === 60, `a real proscenium house: stage width = opening + 2 wings, one outside each side of the opening (got ${vdEst.stageWidthFt})`);
ok(vdEst.proWidthFt !== vdEst.stageWidthFt, "pro and stage width stay distinct — the collision guard");
ok(vdEst.stageDepthFt === 26, `estimator depth maps straight through to stage depth (got ${vdEst.stageDepthFt})`);
ok(vdEst.gridHeightFt === 24, `estimator grid maps straight through to grid height (got ${vdEst.gridHeightFt})`);

/* --- wing double-count fix (#66): a non-proscenium `width` is ALREADY wall to
 * wall (DIMSCHEMA: church/flat/blackbox "wall to wall", gym "sideline to
 * sideline"), so the wings it carries are already inside it. Adding `2*wing`
 * on top — the old, unconditional behavior — double-counted that space. Same
 * inputs as `vdEst` above except `proscenium: false`, so this isolates the
 * ONE line that changed. */
const vdEstNonPro = venueDimsFromEstimator({ width: 36, ph: 18, depth: 26, grid: 24, wing: 12, proscenium: false });
ok(vdEstNonPro.stageWidthFt === 36, `a non-proscenium room: stage width stays the source width, wing is NOT added again — it's already wall-to-wall (got ${vdEstNonPro.stageWidthFt}, the old unconditional formula would have given 60)`);
ok(vdEstNonPro.proWidthFt === vdEstNonPro.stageWidthFt, "for a non-proscenium room, PRO width and stage width now agree — both ARE the same wall-to-wall number, so there is nothing left to double-count");

const vdLine = venueDimsFromLineset({ proWidthFt: 40, proHeightFt: 20, stageWidthFt: 50, stageDepthFt: 30 });
ok(vdLine.proWidthFt === 40 && vdLine.stageWidthFt === 50, "lineset inputs keep pro and stage width separate");
ok(vdLine.proHeightFt === 20, `lineset proHeightFt lands on its own value, not swapped with stage depth (got ${vdLine.proHeightFt})`);
ok(vdLine.stageDepthFt === 30, `lineset stageDepthFt lands on its own value, not swapped with pro height (got ${vdLine.stageDepthFt})`);

ok(DEFAULT_VENUE_DIMS.proWidthFt === 40, `DEFAULT_VENUE_DIMS proWidthFt is 40 (got ${DEFAULT_VENUE_DIMS.proWidthFt})`);
ok(DEFAULT_VENUE_DIMS.proHeightFt === 20, `DEFAULT_VENUE_DIMS proHeightFt is 20 (got ${DEFAULT_VENUE_DIMS.proHeightFt})`);
ok(DEFAULT_VENUE_DIMS.stageWidthFt === 50, `DEFAULT_VENUE_DIMS stageWidthFt is 50 (got ${DEFAULT_VENUE_DIMS.stageWidthFt})`);
ok(DEFAULT_VENUE_DIMS.stageDepthFt === 30, `DEFAULT_VENUE_DIMS stageDepthFt is 30 (got ${DEFAULT_VENUE_DIMS.stageDepthFt})`);

/* --- batten / pipe length, the one shared rule (punch #50) ---
 * Jeff: "It is Pro Width, plus 2ft on each side, so 4ft total. Track that into
 * the estimator and anywhere else where pipe width is calculated." */
ok(BATTEN_OVERHANG_FT === 2, `batten overhang is 2 ft per side (got ${BATTEN_OVERHANG_FT})`);
ok(battenLenFt(40) === 44, `a 40 ft opening gets a 44 ft batten (got ${battenLenFt(40)})`);
ok(battenLenFt(36) === 40, `a 36 ft opening gets a 40 ft batten (got ${battenLenFt(36)})`);
ok(battenLenFt(0) === 4, "a zero opening still returns the overhang, never a negative length");
ok(battenLenFt(-10) === 4, "a negative opening is clamped, not propagated as a negative pipe");

/* --- fabric catalog weight join (task 2) --- */
import { isTierPriced } from "@/lib/tier-pricing";
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
ok(wLine.fabricUnresolved === false && wLine.goods !== null && wLine.goods > 0, "a catalog-only fabric (Marvel is NOT in FABLIB) still produces goods weight");
// F1 hard-fail (punch #64): a name-only lookup of a catalog desc (not in FABLIB)
// used to weigh a silent ZERO — the OLD assertion here literally pinned that
// bug as "the fix". The product-owner decision reverses it: an unresolved
// fabric must refuse to produce a weight number at all (null + a flag),
// never a wrong LOW number that looks like a real total.
const nameOnlyMiss = computeSetWeight({ name: "t", fab: "21 oz Marvel Velour", w: 20, h: 19, full: 50, qty: 2 }, DEFAULT_WEIGHTS);
ok(nameOnlyMiss.fabricUnresolved === true, "a name-only lookup of a catalog desc (not a FABLIB name) hard-fails: fabricUnresolved, not a silent resolve (#64)");
ok(nameOnlyMiss.goods === null && nameOnlyMiss.trackWt === null && nameOnlyMiss.onBatten === null && nameOnlyMiss.setTotal === null, "hard-fail masks goods/track/onBatten/setTotal to null — never the 0 the old bug produced (#64)");
ok(nameOnlyMiss.cwLoad === null && nameOnlyMiss.combo === null && nameOnlyMiss.beamLoad === null && nameOnlyMiss.hoistUtil === null && nameOnlyMiss.battenUtil === null && nameOnlyMiss.capUtil === null, "hard-fail masks every capacity/utilization figure derived from the unresolved goods too, not just the headline total (#64)");
ok(nameOnlyMiss.over === false, "an unresolved line never reports 'over' — that would assert a false pass/fail verdict on an unknown number (#64)");
ok(nameOnlyMiss.battenWt !== null && nameOnlyMiss.battenWt >= 0, "battenWt (pipe self-weight) is NOT fabric-derived, so it stays a real number even on an unresolved-fabric line");

// A gear-only line (no finished w/h) must never be flagged — Electric/Shell
// carry no soft goods at all, so "no fabric" is correct, not unresolved.
const gearOnlyWeight = computeSetWeight({ name: "t", gear: 120 }, DEFAULT_WEIGHTS);
ok(gearOnlyWeight.fabricUnresolved === false && gearOnlyWeight.onBatten !== null, "a gear-only line (no w/h) is never fabricUnresolved — it never expected a fabric (#64)");

/* --- lineFabricIssue matches computeSetWeight's hard-fail exactly (task 2, #64) --- */
import { lineFabricIssue } from "@/lib/design/goods";
ok(lineFabricIssue({ w: 20, h: 19 }, null, []) !== null, "a custom line with real dimensions but no fab picked yet DOES get a diagnostic now — it matches computeSetWeight's own expectsFabric (w>0 && h>0), so a fabricUnresolved line is never left unexplained on screen");
ok(lineFabricIssue({ gear: 1 } as never, null, []) === null, "a gear-only shape (no w/h) still gets no diagnostic — nothing to explain");
ok(lineFabricIssue({ w: 20, h: 19, fab: "21 oz Marvel Velour" }, null, []) !== null, "the pre-existing name-only-miss diagnostic still fires unchanged");

// #50: the schedule default is the derived rule, and a per-line value still beats it.
ok(DEFAULT_WEIGHTS.battenlen === battenLenFt(DEFAULT_VENUE_DIMS.proWidthFt), `the weight defaults' batten length IS the derived rule (got ${DEFAULT_WEIGHTS.battenlen})`);
ok(computeSetWeight({ name: "t" }, DEFAULT_WEIGHTS).battenLen === 44, "a blank line inherits the derived batten length");
ok(computeSetWeight({ name: "t", batten: 30 }, DEFAULT_WEIGHTS).battenLen === 30, "a per-line manual batten length still overrides the derived rule");

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
// Punch #50 reduced the venue inputs to three: PRO width, PRO height, depth.
// Wall-to-wall stage width is gone from the model, not just from the screen.
ok(!("stageWidthFt" in DEFAULT_LINESET_INPUTS), "stage width is no longer a lineset input");
ok(!("stageWidthIn" in DEFAULT_LINESET_INPUTS), "stage width inches is no longer a lineset input");
ok(Object.keys(DEFAULT_LINESET_INPUTS).filter((k) => k.startsWith("stage")).length === 2, "the only stage dimension left is depth (ft + in)");

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
const wlDrawWeight = computeSetWeight({ name: "t", ...wlDraw }, DEFAULT_WEIGHTS);
ok(wlDrawWeight.goods !== null && wlDrawWeight.goods > 0, "a rule-built line actually weighs something — the end-to-end join");

const merged = { ...wlDraw, h: 24 };
ok(merged.h === 24 && merged.w === 20, "a hand-entered height overrides the rule; untouched fields keep it");

const wlCyc = ruleToWeightLine(drapeRule("CYC", DIMS36, "better")!, [
  { sku: "RB-MUS", desc: "Seamless Muslin", oz: 6, ozBasis: "sq-yd" as const, boltWidthIn: 120 },
]);
ok(wlCyc.full === 0, "the cyc reaches computeSetWeight at 0% fullness, not the 50% default");

/* --- hard-fail against an EMPTY Fabric catalog (#64) ---
 * The task description's real-world case: the production dealer catalog
 * seeds ZERO rows in category "Fabric" (only the demo seed has any), so
 * every rule-derived line's fab/fabResolved come back undefined from
 * ruleToWeightLine — not because of a bad name lookup, but because there is
 * nothing to look up. This is the NORMAL case on a live DB, not an edge case,
 * and it must hard-fail exactly like the name-only miss above. */
const emptyRuleLine = ruleToWeightLine(drapeRule("Draw", DIMS36, "better")!, []);
ok(emptyRuleLine.fab === undefined && emptyRuleLine.fabResolved === undefined, "an empty Fabric catalog leaves a rule-derived line's fab/fabResolved both undefined (ruleToWeightLine)");
const emptyCatalogWeight = computeSetWeight({ name: "t", ...emptyRuleLine }, DEFAULT_WEIGHTS);
ok(emptyCatalogWeight.fabricUnresolved === true && emptyCatalogWeight.onBatten === null, "a rule line against an EMPTY Fabric catalog hard-fails too — the production-DB case, not just a bad name lookup (#64)");

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
ok(
  ruleWeight.goods !== null && overriddenWeight.goods !== null && overriddenWeight.goods < ruleWeight.goods,
  `lighter override lowers goods weight end-to-end through mergeLineFabric (rule ${ruleWeight.goods?.toFixed(1)} -> override ${overriddenWeight.goods?.toFixed(1)})`
);

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
ok(
  cutBase.goods !== null && cutViaCut.goods !== null && cutViaHeight.goods !== null,
  "a resolved fabric with real dimensions never comes back fabricUnresolved"
);
ok(
  cutViaCut.goods !== null && cutViaHeight.goods !== null && Math.abs(cutViaCut.goods - cutViaHeight.goods) < 1e-6,
  `+12in of cut == +1ft of height — cut is inches (got ${cutViaCut.goods?.toFixed(2)} vs ${cutViaHeight.goods?.toFixed(2)})`
);
ok(cutViaCut.goods !== null && cutBase.goods !== null && cutViaCut.goods > cutBase.goods, "more cut allowance still adds weight (sanity: fix didn't invert the sign)");

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

// Review fix (#39): the connectionType suffix requires EVERY contributing
// route to carry a matching stamp — a part-group with one unstamped
// (free-drawn) route must suppress the suffix exactly like a disagreeing
// one would, rather than letting the stamped routes' type leak onto the
// whole combined quantity.
const dmxA = { id: "wr-4", sheetId: "s1", page: 1, points: [zig[0], zig[1]], aspect: 2, partId: "WIRE-DMX", connectionType: "DMX512 (5-pin XLR)" };
const dmxB = { id: "wr-5", sheetId: "s1", page: 1, points: [zig[1], zig[2]], aspect: 2, partId: "WIRE-DMX", connectionType: "DMX512 (5-pin XLR)" };
const dmxParts = [{ id: "WIRE-DMX", sku: "WIRE-DMX", desc: "5-pin DMX cable", category: "Wire", unit: "ft", list: 3, cost: 1.5 }] as PartLite[];
const wlAgree = routeLines([dmxA, dmxB], dmxParts, [wireCal]);
ok(wlAgree.lines[0]?.connectionType === "DMX512 (5-pin XLR)",
  "connectionType suffix applies when every route in the group is stamped and agrees");

const mixA = { id: "wr-6", sheetId: "s1", page: 1, points: [zig[0], zig[1]], aspect: 2, partId: "WIRE-MIX", connectionType: "HDMI" };
const mixB = { id: "wr-7", sheetId: "s1", page: 1, points: [zig[1], zig[2]], aspect: 2, partId: "WIRE-MIX" }; // untyped free route, same part
const mixParts = [{ id: "WIRE-MIX", sku: "WIRE-MIX", desc: "HDMI cable", category: "Wire", unit: "ft", list: 4, cost: 2 }] as PartLite[];
const wlMixed = routeLines([mixA, mixB], mixParts, [wireCal]);
ok(wlMixed.lines[0]?.connectionType === undefined,
  "review fix: a part-group mixing a stamped device-wire route with an untyped free route gets no connectionType suffix");

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

/* --- engagements stay open until Closed (D113.11 carried into the
   six-stage lifecycle, spec §1). The legacy literals below exercise
   normalizeEngagementStatus through isOpenEngagement. --- */
import { isOpenEngagement } from "@/lib/consulting-review";
ok(isOpenEngagement({ status: "active" }) && isOpenEngagement({ status: "delivered" }) && isOpenEngagement({ status: "bid_supported" }),
  "legacy active/delivered/bid_supported map to open stages");
ok(!isOpenEngagement({ status: "oversight_complete" }), "legacy oversight_complete maps to closed");

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
    d117Est.children.map((c) => c.key).join(",") === "quotes,myquotes,estimator,reviews"),
  "EST = Quotes, My Quotes, Estimator, Reviews in order (#22)",
);
ok(activeKeyFor("/estimator") === "estimator", "/estimator lights its own EST child");
ok(
  parentGroupOf(activeKeyFor("/")) === "home",
  "root still resolves to the Home group (drawer section + the mark link, #55)",
);
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
  isOverdue, taskFromLegacy, expandTemplate, taskBellItems, autoTaskId,
  STATUSES, tasksForProject, type TaskRecord, type TaskTemplateItem,
} from "@/lib/stores/tasks";
import { CATEGORIES } from "@/lib/stores/notif-prefs";

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
  const fresh = expandTemplate(tmpl, "P-3001:signoff", new Set());
  ok(fresh.length === 2 && fresh[0].coverageKey === "P-3001:signoff:walkthrough", "tasks: template expands with record-scoped coverage keys");
  ok(fresh[1].section === "Closeout" && fresh[0].section === "Install", "tasks: template section defaults to Install");
  const rerun = expandTemplate(tmpl, "P-3001:signoff", new Set(["P-3001:signoff:walkthrough"]));
  ok(rerun.length === 1 && rerun[0].coverageKey === "P-3001:signoff:punch", "tasks: coverage-key de-dup skips existing on re-entry");

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

  ok(autoTaskId("item16:sold:P-3001") === "t-auto-item16-sold-p-3001".replace("t-auto", "T-auto"), "tasks: autoTaskId is deterministic and sanitized");
  ok(autoTaskId("item16:sold:P-3001") === autoTaskId("item16:sold:P-3001"), "tasks: same coverage key, same id");
  ok(autoTaskId("signoff:Walk-Through!!") === "T-auto-signoff-walk-through-", "tasks: autoTaskId strips non-alphanumerics and lowercases");

  ok(CATEGORIES.some((c) => c.key === "tasks"), "tasks: bell category registered in notif-prefs");
}

/* ============ #32 — venue address picker fallback ============ */
import { addressFromHit } from "@/app/(app)/companies/lib";
ok(addressFromHit({ street: "123 Main St", title: "Overture Center" }) === "123 Main St", "#32: street wins when present");
ok(addressFromHit({ street: "", title: "Overture Center" }) === "Overture Center", "#32: POI without street falls back to display title");

/* ============ Task 3 — inbox conversation participants (#42) ============ */
import { participantsFor } from "@/lib/stores/comms";
const msgsThread = (authors: Array<string | undefined>): any => ({
  messages: authors.map((author, i) => ({
    id: `m${i}`, at: i, direction: "in", channel: "email", author: author || "", body: "",
  })),
});
ok(participantsFor(msgsThread(["Jeff"])) === "", "#42: single author -> no participants string");
ok(participantsFor(msgsThread(["Jeff", "Jeff"])) === "", "#42: repeated author de-dupes to a single author");
ok(participantsFor(msgsThread(["Jeff", "Sarah"])) === "Jeff, Sarah", "#42: two authors joined with comma");
ok(participantsFor(msgsThread(["Jeff", "Sarah", "Amy", "Ben"])) === "Jeff, Sarah +2", "#42: 4 authors -> first two plus overflow count");
ok(participantsFor(msgsThread(["Jeff", "", "Sarah", undefined])) === "Jeff, Sarah", "#42: blank/undefined authors filtered out");

/* ============ Review fix — sort=date must be representable in CRM mode (#42) ============ */
import { isModeDefaultSort } from "@/app/(app)/inbox/sort-defaults";
ok(isModeDefaultSort("date", false), "#42 fix: plain mode's default is date, so sort=date can be stripped from the URL");
ok(!isModeDefaultSort("date", true), "#42 fix: CRM mode's default is waiting-first, so sort=date must stay explicit on the URL");
ok(!isModeDefaultSort("from", false), "#42 fix: sort=from is never a mode default, in either mode");
ok(!isModeDefaultSort("subject", true), "#42 fix: sort=subject is never a mode default, in either mode");

/* ============ OPPORTUNITIES (#18) — merged pipeline pure model ============ */
import {
  OPP_COLUMNS, OPEN_OPP_COLUMNS, leadColumn, quoteColumn, leadStageForCol,
  canSetPoReceived, buildOpportunities, allowedMoves, applyOppFilters,
  openTotals, ageLabel as oppAge,
  type OppLeadInput, type OppQuoteInput, type OppRow, type CompanyFacts,
} from "@/lib/opportunities";

{
  const NOW = 1_800_000_000_000;
  const DAY = 86400000;

  ok(
    OPP_COLUMNS.map((c) => c.key).join(",") === "new,collect,estimate,estimate_sent,closed,po_received",
    "#18: column keys are the locked bid-stage set"
  );
  ok(
    OPP_COLUMNS.map((c) => c.label).join("|") === "New|Collect Info|Estimate|Estimate Sent|Won / Lost|PO Received",
    "#18: column labels match the Daylite vocabulary"
  );
  ok(OPEN_OPP_COLUMNS.join(",") === "new,collect,estimate,estimate_sent", "#18: four open columns");

  // lead stage → column
  ok(leadColumn("new") === "new" && leadColumn("contacted") === "collect", "#18: lead new/contacted map to new/collect");
  ok(leadColumn("qualified") === "estimate" && leadColumn("quoted") === "estimate_sent", "#18: lead qualified/quoted map to estimate/estimate_sent");
  ok(leadColumn("won") === "closed" && leadColumn("lost") === "closed", "#18: lead won + lost share the closed column");
  ok(leadColumn("bogus") === null, "#18: unknown lead stage maps to no column");

  // quote status → column (incl. the poReceivedAt fork)
  ok(quoteColumn({ status: "draft", poReceivedAt: null }) === "estimate", "#18: draft quote sits in Estimate");
  ok(quoteColumn({ status: "sent", poReceivedAt: null }) === "estimate_sent", "#18: sent quote sits in Estimate Sent");
  ok(quoteColumn({ status: "lost", poReceivedAt: null }) === "closed", "#18: lost quote sits in closed");
  ok(quoteColumn({ status: "won", poReceivedAt: null }) === "closed", "#18: won quote without a PO sits in closed");
  ok(quoteColumn({ status: "won", poReceivedAt: NOW }) === "po_received", "#18: won quote with poReceivedAt sits in PO Received");

  // column → lead stage writeback
  ok(leadStageForCol("new") === "new" && leadStageForCol("collect") === "contacted", "#18: new/collect map back to lead new/contacted");
  ok(leadStageForCol("estimate") === "qualified" && leadStageForCol("estimate_sent") === "quoted", "#18: estimate columns map back to qualified/quoted");
  ok(leadStageForCol("closed") === null && leadStageForCol("po_received") === null, "#18: closed columns never map to a lead stage write");

  ok(canSetPoReceived("won") && !canSetPoReceived("sent") && !canSetPoReceived("draft") && !canSetPoReceived("lost"), "#18: PO toggle allowed on won quotes only");

  // union build: converted-lead exclusion + forecast inheritance
  const mkL = (o: Partial<OppLeadInput>): OppLeadInput => ({
    id: "L-1050", org: "Org", interest: "Rigging", stage: "new", owner: "Jeff Chesebro",
    value: 1000, createdAt: NOW - 3 * DAY, updatedAt: NOW, customerId: null,
    convertedCustomerId: null, convertedQuoteId: null, forecastAt: null, ...o,
  });
  const mkQ = (o: Partial<OppQuoteInput>): OppQuoteInput => ({
    id: "Q-2041", name: "Quote", customer: "Org", status: "draft", owner: "Jeff Chesebro",
    value: 2000, createdAt: NOW - 10 * DAY, updatedAt: NOW, customerId: null,
    poReceivedAt: null, ...o,
  });
  const rows = buildOpportunities(
    [
      mkL({ id: "L-1", stage: "quoted", convertedQuoteId: "Q-9", convertedCustomerId: "acme", forecastAt: NOW + 20 * DAY }),
      mkL({ id: "L-2", stage: "contacted", customerId: "lakefront" }),
    ],
    [mkQ({ id: "Q-9", status: "sent", customerId: "acme" }), mkQ({ id: "Q-8" })]
  );
  ok(rows.map((r) => r.id).join(",") === "L-2,Q-9,Q-8", "#18: converted lead drops out — its quote carries the opportunity");
  ok(rows.find((r) => r.id === "Q-9")!.forecastAt === NOW + 20 * DAY, "#18: quote card inherits forecastAt from its originating lead");
  ok(rows.find((r) => r.id === "Q-8")!.forecastAt === null, "#18: un-linked quote has no forecast date");
  ok(rows.find((r) => r.id === "L-2")!.col === "collect" && rows.find((r) => r.id === "L-2")!.companyId === "lakefront", "#18: lead row carries its column + company link");

  // drag policy
  ok(allowedMoves({ kind: "lead", col: "new", srcStage: "new" }).join(",") === "collect,estimate,estimate_sent", "#18: open lead moves among the other three open columns");
  ok(allowedMoves({ kind: "lead", col: "estimate_sent", srcStage: "quoted" }).join(",") === "new,collect,estimate", "#18: estimate_sent lead moves back among open columns");
  ok(allowedMoves({ kind: "lead", col: "closed", srcStage: "won" }).length === 0, "#18: closed lead cards never drag (convert / markLost keep their paths)");
  ok(allowedMoves({ kind: "quote", col: "closed", srcStage: "won" }).join(",") === "po_received", "#18: won quote drags closed → po_received");
  ok(allowedMoves({ kind: "quote", col: "po_received", srcStage: "won" }).join(",") === "closed", "#18: won quote drags back po_received → closed");
  ok(allowedMoves({ kind: "quote", col: "estimate", srcStage: "draft" }).length === 0, "#18: draft quote cards are not draggable");
  ok(allowedMoves({ kind: "quote", col: "estimate_sent", srcStage: "sent" }).length === 0, "#18: sent quote cards are not draggable");
  ok(allowedMoves({ kind: "quote", col: "closed", srcStage: "lost" }).length === 0, "#18: lost quote cards are not draggable");

  // filters (who / created / forecast / kw / vt)
  const facts: CompanyFacts = new Map([
    ["acme", { type: "Education", keywords: ["fire curtain", "Rigging"] }],
    ["lakefront", { type: "Performing arts", keywords: [] }],
  ]);
  const frows: OppRow[] = [
    { id: "a", kind: "lead", col: "new", title: "", sub: "", value: 100, owner: "Jeff Chesebro", createdAt: NOW - 2 * DAY, updatedAt: NOW, companyId: "acme", forecastAt: NOW + 10 * DAY, srcStage: "new" },
    { id: "b", kind: "lead", col: "estimate", title: "", sub: "", value: 200, owner: "Sam Rivera", createdAt: NOW - 40 * DAY, updatedAt: NOW, companyId: "lakefront", forecastAt: NOW - DAY, srcStage: "qualified" },
    { id: "c", kind: "quote", col: "closed", title: "", sub: "", value: 400, owner: "Jeff Chesebro", createdAt: NOW - 100 * DAY, updatedAt: NOW, companyId: null, forecastAt: null, srcStage: "won" },
  ];
  const none = { who: "", created: "" as const, forecast: "" as const, kw: "", vt: "" };
  ok(applyOppFilters(frows, none, facts, NOW).length === 3, "#18: no filters keeps every card");
  ok(applyOppFilters(frows, { ...none, who: "Sam Rivera" }, facts, NOW).map((r) => r.id).join(",") === "b", "#18: who filter matches by owner name");
  ok(applyOppFilters(frows, { ...none, created: "7d" }, facts, NOW).map((r) => r.id).join(",") === "a", "#18: created=7d keeps only fresh cards");
  ok(applyOppFilters(frows, { ...none, created: "90d" }, facts, NOW).map((r) => r.id).join(",") === "a,b", "#18: created=90d widens the window");
  ok(applyOppFilters(frows, { ...none, forecast: "30d" }, facts, NOW).map((r) => r.id).join(",") === "a", "#18: forecast=30d keeps in-horizon cards and EXCLUDES no-forecast cards");
  ok(applyOppFilters(frows, { ...none, forecast: "past" }, facts, NOW).map((r) => r.id).join(",") === "b", "#18: forecast=past keeps only overdue forecasts");
  ok(applyOppFilters(frows, { ...none, kw: "rigging" }, facts, NOW).map((r) => r.id).join(",") === "a", "#18: kw is a case-insensitive EXACT tag match; company-less cards excluded");
  ok(applyOppFilters(frows, { ...none, kw: "rig" }, facts, NOW).length === 0, "#18: kw does not substring-match");
  ok(applyOppFilters(frows, { ...none, vt: "Performing arts" }, facts, NOW).map((r) => r.id).join(",") === "b", "#18: vt filters via the linked company's type; unlinked cards excluded");

  // header total: the four open columns only
  const tot = openTotals(frows);
  ok(tot.count === 2 && tot.value === 300, "#18: open-pipeline total sums the four open columns (closed excluded)");
  const tot2 = openTotals([...frows, { ...frows[2], id: "d", col: "po_received" }]);
  ok(tot2.count === 2 && tot2.value === 300, "#18: po_received also excluded from the open total");

  // age chip (the #18 ask)
  ok(oppAge(NOW - 3 * DAY, NOW) === "3d", "#18: age chip renders days under two weeks");
  ok(oppAge(NOW - 20 * DAY, NOW) === "2w", "#18: age chip switches to weeks at 14 days");
  ok(oppAge(NOW, NOW) === "0d", "#18: brand-new card reads 0d");
}

/* ============ PROJECTS BOARD (#19) ============ */
import { boardProjects, dueChipLabel } from "@/app/(app)/projects/board-lib";
import { PROJECT_STAGES, ORDER_STAGES, canCompleteProject } from "@/lib/stores/projects";

ok(
  PROJECT_STAGES.map((s) => s.key).join(",") === "procurement,delivery,scheduled,install,training,signoff,complete",
  "#19: board columns are the 7-stage installs pipeline"
);
ok(
  ORDER_STAGES.map((s) => s.key).join(",") === "procurement,delivery,signoff,complete",
  "#19: orders carry a different 4-stage vocabulary — excluded from the board"
);
ok(!canCompleteProject({ stage: "install", signoff: null }), "#19: project cannot complete before sign-off exists");
ok(canCompleteProject({ stage: "install", signoff: { signedBy: "Jeff", signedAt: NOW } }), "#19: sign-off unlocks completion");
ok(canCompleteProject({ stage: "complete", signoff: null }), "#19: already-complete records stay valid during migration");
{
  const mix: Array<{ kind: "project" | "order" }> = [
    { kind: "project" },
    { kind: "order" },
    { kind: "project" },
  ];
  ok(boardProjects(mix).length === 2, "#19: boardProjects keeps kind === project only");
}
ok(dueChipLabel("complete", -3, "Jul 20") === "Closed Jul 20", "#19: complete cards read Closed <date>");
ok(dueChipLabel("install", -3, "") === "3d overdue", "#19: past-due cards read Nd overdue");
ok(dueChipLabel("install", 0, "") === "Due today", "#19: due-today wording preserved");
ok(dueChipLabel("procurement", 12, "") === "Due in 12d", "#19: future cards read Due in Nd");

/* ============ LEAD THREAD (#34) — visit lifecycle + convert gate ============ */
import {
  VISIT_STAGES, VISIT_STAGE_META, deriveVisitStage, requestStageFor, canConvertLead,
} from "@/lib/lead-thread";

{
  const NOW = 1_800_000_000_000;
  const DAY = 86400000;

  ok(
    VISIT_STAGES.join(",") === "requested,open,claimed,scheduled,done",
    "#34: visit lifecycle is the locked five-stage set"
  );
  ok(
    VISIT_STAGE_META.requested.label === "Requested" &&
      VISIT_STAGE_META.open.label === "Open — unclaimed" &&
      VISIT_STAGE_META.claimed.label === "Claimed" &&
      VISIT_STAGE_META.scheduled.label === "Scheduled" &&
      VISIT_STAGE_META.done.label === "Done",
    "#34: visit stage labels"
  );

  // deriveVisitStage — legacy stage-less records read from their times
  ok(
    deriveVisitStage({ startAt: NOW - 2 * DAY, endAt: NOW - 2 * DAY + 3600000 }, NOW) === "done",
    "#34: legacy stage-less past visit reads done"
  );
  ok(
    deriveVisitStage({ startAt: NOW + DAY, endAt: NOW + DAY + 3600000 }, NOW) === "scheduled",
    "#34: legacy stage-less future visit reads scheduled"
  );
  // stored "scheduled" past its (endAt ?? startAt) reads done
  ok(
    deriveVisitStage({ stage: "scheduled", startAt: NOW - DAY, endAt: NOW - DAY + 3600000 }, NOW) === "done",
    "#34: stored scheduled with a past end reads done"
  );
  ok(
    deriveVisitStage({ stage: "scheduled", startAt: NOW - DAY, endAt: null }, NOW) === "done",
    "#34: endAt ?? startAt — null end falls back to start"
  );
  ok(
    deriveVisitStage({ stage: "scheduled", startAt: NOW + DAY, endAt: NOW + 2 * DAY }, NOW) === "scheduled",
    "#34: stored scheduled in the future stays scheduled"
  );
  // stored requested/open/claimed/done pass through untouched
  ok(deriveVisitStage({ stage: "requested", startAt: null, endAt: null }, NOW) === "requested", "#34: requested passes through");
  ok(deriveVisitStage({ stage: "open", startAt: null, endAt: null }, NOW) === "open", "#34: open passes through");
  ok(deriveVisitStage({ stage: "claimed", startAt: null, endAt: null }, NOW) === "claimed", "#34: claimed passes through");
  ok(deriveVisitStage({ stage: "done", startAt: NOW + DAY, endAt: null }, NOW) === "done", "#34: stored done never resurrects");

  // assign-or-open stage choice
  ok(requestStageFor("Sam Rivera") === "claimed", "#34: request with an assignee lands claimed");
  ok(requestStageFor("") === "requested" && requestStageFor("   ") === "requested", "#34: open — anyone can claim lands requested");

  // convert gate — all four branches
  const missing = canConvertLead(null, false);
  ok(!missing.ok && missing.reason === "survey-missing", "#34: no linked survey blocks convert");
  const openGate = canConvertLead({ stage: "onsite" }, false);
  ok(!openGate.ok && openGate.reason === "survey-open", "#34: un-completed survey blocks convert");
  ok(canConvertLead({ stage: "completed" }, false).ok, "#34: completed survey passes the gate");
  ok(canConvertLead(null, true).ok && canConvertLead({ stage: "requested" }, true).ok, "#34: explicit skip always passes");
}

/* #34 — the auto-created survey's link fields ride blank()'s whitelist
   (fields not in the def object are SILENTLY DROPPED — this proves the def
   carries them). blank() is pure — no DB touched. */
import { blank as surveyBlank } from "@/lib/stores/surveys";

{
  const b = surveyBlank();
  ok(b.leadId === null && b.visitId === null, "#34: blank survey defaults null lead/visit links");
  ok(b.stage === "requested", "#34: blank survey is born requested");
  const linked = surveyBlank({ leadId: "L-1050", visitId: "SV-5001" });
  ok(linked.leadId === "L-1050" && linked.visitId === "SV-5001", "#34: blank() whitelist passes leadId/visitId through");
}

/* ============ ACTIVITY TIMELINE (#21) ============ */
/* notes collection — normalize-on-read defaults. normalizeNote is pure
   (no DB touched by importing the store module). */
import { normalizeNote, type NoteRecord } from "@/lib/stores/notes";

{
  const T = new Date(2026, 5, 30, 10).getTime();
  const bare = {
    id: "N-7001",
    parentKind: "customer",
    parentId: "lakefront",
    by: "Jeff Chesebro",
    at: T,
    createdAt: T,
    updatedAt: T,
  } as unknown as NoteRecord;
  const n = normalizeNote(bare);
  ok(n.customerId === null, "#21: normalizeNote backfills a missing customerId to null");
  ok(n.text === "", "#21: normalizeNote backfills missing text to ''");

  const full = normalizeNote({
    id: "N-7002",
    parentKind: "lead",
    parentId: "L-1051",
    customerId: "lakefront",
    by: "Dana Whitmer",
    at: T,
    text: "Called about the valance",
    createdAt: T,
    updatedAt: T,
  });
  ok(
    full.customerId === "lakefront" && full.text === "Called about the valance",
    "#21: normalizeNote passes populated fields through"
  );
  ok(
    full.parentKind === "lead" && full.parentId === "L-1051",
    "#21: parentKind/parentId — attachable by design (the v1 composer only writes 'customer')"
  );
}

/* #21 — date buckets. House rule (see the queueDueLabel note above): never
   assert locale/TZ-dependent literals from raw epoch numbers — every
   timestamp below is built from LOCAL Date parts, so the assertions hold in
   any runner timezone. Weeks start Monday. */
import { bucketFor, groupRows } from "@/lib/feed-buckets";
import {
  commFeedRows,
  FEED_META,
  jobFeedRows,
  noteFeedRows,
  projectFeedRows,
  quoteFeedRows,
  surveyFeedRows,
  visitFeedRows,
} from "@/lib/customer-feed-rows";

{
  const NOW = new Date(2026, 6, 24, 12, 0, 0).getTime(); // Fri Jul 24 2026, noon local

  ok(bucketFor(new Date(2026, 6, 24, 0, 0, 0).getTime(), NOW) === "Today", "#21: local midnight today is Today");
  ok(bucketFor(new Date(2026, 6, 24, 18).getTime(), NOW) === "Today", "#21: later today (even future of now) is Today");
  ok(
    bucketFor(new Date(2026, 6, 24, 13).getTime(), NOW) === "Today",
    "#21: later today (now + 1h, same local day) is Today, not Upcoming"
  );
  ok(
    bucketFor(new Date(2026, 6, 26, 9).getTime(), NOW) === "Upcoming",
    "#21: now + 2 days (e.g. a scheduled site visit's future startAt) is Upcoming"
  );
  ok(
    bucketFor(new Date(2026, 6, 23, 23, 59, 59).getTime(), NOW) === "Yesterday",
    "#21: 23:59:59 yesterday is Yesterday — the day edge is local midnight"
  );
  ok(bucketFor(new Date(2026, 6, 23, 0).getTime(), NOW) === "Yesterday", "#21: yesterday start is Yesterday");
  ok(bucketFor(new Date(2026, 6, 22, 9).getTime(), NOW) === "This week", "#21: Wednesday of the current Mon-start week is This week");
  ok(bucketFor(new Date(2026, 6, 20, 0).getTime(), NOW) === "This week", "#21: Monday 00:00 opens This week");
  ok(bucketFor(new Date(2026, 6, 19, 23).getTime(), NOW) === "Last week", "#21: Sunday night before rolls over to Last week");
  ok(bucketFor(new Date(2026, 6, 13, 0).getTime(), NOW) === "Last week", "#21: last Monday 00:00 opens Last week");
  ok(bucketFor(new Date(2026, 6, 12, 12).getTime(), NOW) === "This month", "#21: older than last week but this month is This month");
  ok(bucketFor(new Date(2026, 6, 1, 0).getTime(), NOW) === "This month", "#21: the 1st opens This month");
  ok(bucketFor(new Date(2026, 5, 30, 12).getTime(), NOW) === "June 2026", "#21: last month labels '<Month Year>'");
  ok(bucketFor(new Date(2025, 11, 25).getTime(), NOW) === "December 2025", "#21: older years keep the month-year label");

  // groupRows — ordering + stability (rows pre-sorted ts desc)
  const rows = [
    { id: "a", ts: new Date(2026, 6, 24, 11).getTime() },
    { id: "b", ts: new Date(2026, 6, 24, 9).getTime() },
    { id: "c", ts: new Date(2026, 6, 23, 15).getTime() },
    { id: "d", ts: new Date(2026, 6, 21, 8).getTime() },
    { id: "e", ts: new Date(2026, 6, 15, 8).getTime() },
    { id: "f", ts: new Date(2026, 5, 2, 8).getTime() },
  ];
  const groups = groupRows(rows, NOW);
  ok(
    groups.map((g) => g.bucket).join("|") === "Today|Yesterday|This week|Last week|June 2026",
    "#21: groupRows walks the buckets in feed order"
  );
  ok(groups[0].rows.map((r) => r.id).join(",") === "a,b", "#21: same-bucket rows keep their pre-sorted order (stable)");
  ok(groups[3].rows.length === 1 && groups[3].rows[0].id === "e", "#21: single-row buckets survive intact");
}

/* #21 — pure row builders, exact literals. */
{
  const T1 = new Date(2026, 6, 20, 9).getTime();
  const T2 = new Date(2026, 6, 22, 14).getTime();
  const T3 = new Date(2026, 6, 23, 10).getTime();

  // quotes — one row per history entry + PO / portal-acceptance annex rows
  const q = quoteFeedRows({
    id: "Q-2041",
    name: "Riverside PAC rigging",
    history: [
      { at: T1, to: "draft" },
      { at: T2, to: "sent" },
    ],
    poReceivedAt: T3,
    portalAcceptance: { at: T3, by: "Dana Whitmer" },
  });
  ok(q.length === 4, "#21: quote history + PO + portal acceptance = 4 rows");
  ok(
    q[0].title === "Quote Q-2041 drafted" && q[1].title === "Quote Q-2041 sent",
    "#21: history rows verb the stage vocab (draft/sent/won/lost)"
  );
  ok(q[2].title === "Quote Q-2041 PO received" && q[2].ts === T3, "#21: poReceivedAt annex row (setPoReceived writes NO history)");
  ok(
    q[3].title === "Quote Q-2041 accepted in portal" && q[3].by === "Dana Whitmer",
    "#21: portal-acceptance annex row carries the actor"
  );
  ok(
    q[0].href === "/quotes?id=Q-2041" && q[0].kind === "quote" && q[0].sub === "Riverside PAC rigging",
    "#21: quote rows deep-link /quotes?id= and sub the quote name"
  );
  ok(
    quoteFeedRows({ id: "Q-2042", name: "x", history: [{ at: T1, to: "draft" }] }).length === 1,
    "#21: absent annex fields add no rows"
  );

  // comms — one row per message; draft threads and Deleted-folder threads skipped
  const c = commFeedRows({
    id: "C-1032",
    subject: "Valance quote follow-up",
    status: "waiting_us",
    messages: [
      { id: "m1-aaaa", at: T1, direction: "in", channel: "email", author: "Sarah Chen" },
      { id: "m2-bbbb", at: T2, direction: "out", channel: "call", author: "Jeff Chesebro" },
    ],
  });
  ok(c.length === 2 && c[0].title === "Valance quote follow-up", "#21: comm rows title the thread subject");
  ok(c[0].sub === "Received · email" && c[1].sub === "Sent · call", "#21: comm sub is direction · channel");
  ok(c[0].href === "/inbox?thread=C-1032" && c[1].by === "Jeff Chesebro", "#21: comm rows deep-link the inbox thread");
  ok(
    commFeedRows({
      id: "C-1",
      subject: "s",
      status: "draft",
      messages: [{ id: "m", at: T1, direction: "out", channel: "email", author: "x" }],
    }).length === 0,
    "#21: draft threads are skipped"
  );
  ok(
    commFeedRows({
      id: "C-2",
      subject: "s",
      status: "closed",
      deleted: true,
      messages: [{ id: "m", at: T1, direction: "out", channel: "email", author: "x" }],
    }).length === 0,
    "#21: Deleted-folder threads are skipped (thread flag, distinct from the row tombstone)"
  );

  // visits — ts = startAt ?? createdAt; sub = VISIT_STAGE_META label
  const v = visitFeedRows({
    id: "SV-5001",
    reason: "Site survey / measure",
    stage: "scheduled",
    startAt: T2,
    createdAt: T1,
    assignedTo: "Mike Torres",
  });
  ok(v.length === 1 && v[0].ts === T2 && v[0].title === "Site visit — Site survey / measure", "#21: visit row at startAt");
  ok(v[0].sub === "Scheduled" && v[0].href === "/field-survey" && v[0].by === "Mike Torres", "#21: visit sub is the stage label");
  const vr = visitFeedRows({ id: "SV-5002", reason: "Punch walk", stage: "requested", startAt: null, createdAt: T1, assignedTo: "" });
  ok(vr[0].ts === T1 && vr[0].sub === "Requested", "#21: unscheduled request falls back to createdAt");

  // jobs — point stamps; null completion adds no row; legacy zero requestedAt skipped
  const fj = jobFeedRows("flame", {
    id: "FT-3001",
    venue: "Auditorium",
    openedAt: T1,
    openedBy: "Jeff Chesebro",
    completedAt: T2,
    completedBy: "Mike Torres",
  });
  ok(
    fj.length === 2 && fj[0].title === "Flame test FT-3001 approved" && fj[1].title === "Flame test FT-3001 completed",
    "#21: flame approved + completed rows"
  );
  ok(
    jobFeedRows("repair", { id: "RP-4001", venue: "", openedAt: T1, openedBy: "", completedAt: null, completedBy: "" }).length === 1,
    "#21: null completedAt adds no completion row"
  );
  const ij = jobFeedRows("inspection", {
    id: "RI-2042",
    venue: "Main stage",
    openedAt: 0,
    openedBy: "",
    completedAt: T2,
    completedBy: "Dana Whitmer",
  });
  ok(ij.length === 1 && ij[0].title === "Inspection RI-2042 completed", "#21: zero requestedAt (legacy default) adds no request row");
  ok(
    jobFeedRows("inspection", { id: "RI-2043", venue: "", openedAt: T1, openedBy: "Sarah Chen", completedAt: null, completedBy: "" })[0]
      .title === "Inspection RI-2043 requested",
    "#21: the inspection open verb is 'requested'"
  );

  // surveys — one row at updatedAt with the stage label
  const s = surveyFeedRows({ id: "FS-1054", stage: "completed", venue: "Black box", updatedAt: T3 });
  ok(s.length === 1 && s[0].title === "Survey FS-1054 — Completed" && s[0].ts === T3, "#21: survey row titles id + stage label");
  ok(s[0].href === "/field-survey?id=FS-1054", "#21: survey row deep-links the survey");

  // projects — stage-history rows (loader-passed short labels) + newest-first notes handled
  const pj = projectFeedRows(
    {
      id: "P-3001",
      name: "Westfield HS auditorium",
      stageHistory: [
        { at: T1, to: "procurement", by: "Jeff Chesebro" },
        { at: T2, to: "install", by: "Mike Torres" },
      ],
      notes: [
        { id: "nt-b", at: T3, by: "Mike Torres", text: "Crew on site, linesets 1-8 done. " + "x".repeat(90) },
        { id: "nt-a", at: T1, by: "Jeff Chesebro", text: "Kickoff scheduled" },
      ],
    },
    { procurement: "Materials", install: "Install" }
  );
  ok(pj.length === 4, "#21: stage-history + project-note rows all present");
  ok(
    pj[0].title === "Project P-3001 → Materials" && pj[1].title === "Project P-3001 → Install" && pj[1].by === "Mike Torres",
    "#21: stage rows use the passed short labels + actor (D83 anchors an opening from:null entry — renders the same way)"
  );
  ok(pj[2].title.length === 80, "#21: project-note titles clamp to 80 chars");
  ok(pj[2].ts === T3 && pj[3].ts === T1, "#21: NEWEST-FIRST ProjectNote order passes through untouched — the loader sorts by ts");
  ok(pj[2].kind === "project-note" && pj[0].kind === "project-stage", "#21: project row kinds");

  // notes — the real record rows
  const nr = noteFeedRows({ id: "N-7001", at: T2, by: "Jeff Chesebro", text: "Board approved the budget" });
  ok(nr.length === 1 && nr[0].kind === "note" && nr[0].title === "Board approved the budget", "#21: note rows title the full text (the UI clamps display)");
  ok(nr[0].href === null && nr[0].by === "Jeff Chesebro", "#21: note rows have no deep link");
  ok(FEED_META.note.letter === "N" && FEED_META.quote.letter === "Q", "#21: letter-dot glyphs");
}

/* #21 — timeAgo future branch (reviewer fix: scheduled/Upcoming timestamps,
   e.g. a future site-visit startAt). TZ-safe: offsets are relative to
   Date.now(), no calendar construction, so these hold in any timezone. */
import { timeAgo } from "@/lib/format";

{
  ok(timeAgo(Date.now() + 45_000) === "just now", "#21: timeAgo future within 60s still reads 'just now'");
  ok(timeAgo(Date.now() + 5 * 60_000 + 2_000) === "in 5m", "#21: timeAgo future minutes renders 'in Nm'");
  ok(timeAgo(Date.now() + 3 * 86_400_000 + 60_000) === "in 3d", "#21: timeAgo future days renders 'in Nd'");
}

/* ============ CUSTOMER FIELDS + MINE/ALL (#23/#22) ============ */
/* #23 — pure custom-field helpers. Dependency-free module, exact literals.
   The only timestamp is an epoch-ms passthrough built from LOCAL Date parts
   (TZ house rule, see the queueDueLabel note above). */
import {
  defsForType,
  resolveFieldDefs,
  slugifyFieldId,
  validateFieldDefs,
  validateFieldValues,
  type CustomFieldDef,
} from "@/lib/customer-fields";

{
  ok(
    resolveFieldDefs(undefined).length === 0 && resolveFieldDefs(null).length === 0,
    "#23: resolveFieldDefs(stored) = stored ?? [] — there are NO code defaults"
  );

  // slugifyFieldId — stable ids from labels, collision-suffixed
  ok(slugifyFieldId("Referred By", new Set()) === "referred-by", "#23: slug lowercases and dashes the label");
  ok(
    slugifyFieldId("Referred By", new Set(["referred-by"])) === "referred-by-2",
    "#23: a taken slug suffixes -2"
  );
  ok(
    slugifyFieldId("Referred By", new Set(["referred-by", "referred-by-2"])) === "referred-by-3",
    "#23: suffixes keep counting"
  );
  ok(slugifyFieldId("!!!", new Set()) === "field", "#23: an all-symbol label falls back to 'field'");

  const DEFS: CustomFieldDef[] = [
    { id: "referred-by", label: "Referred by", kind: "text", appliesTo: [] },
    { id: "annual-budget", label: "Annual budget", kind: "number", appliesTo: ["Education"] },
    { id: "last-inspection", label: "Last inspection", kind: "date", appliesTo: [] },
    { id: "region", label: "Region", kind: "select", options: ["North", "South"], appliesTo: [] },
    { id: "tax-exempt", label: "Tax exempt", kind: "checkbox", appliesTo: ["Education", "Worship"] },
  ];

  // defsForType — empty appliesTo means EVERY type
  ok(
    defsForType(DEFS, "Performing arts").map((d) => d.id).join(",") === "referred-by,last-inspection,region",
    "#23: empty appliesTo applies to every type; typed defs stay out"
  );
  ok(defsForType(DEFS, "Education").length === 5, "#23: a listed type gets its typed defs too");
  ok(
    defsForType(DEFS, "Worship").map((d) => d.id).join(",") === "referred-by,last-inspection,region,tax-exempt",
    "#23: appliesTo is a per-def allowlist, order preserved"
  );

  // validateFieldValues — kind-checked, unknown ids stripped, null clears
  const T = new Date(2026, 6, 20).getTime();
  const vals = validateFieldValues(DEFS, {
    "referred-by": "  Patrick Strain  ",
    "annual-budget": "125000",
    "last-inspection": T,
    region: "North",
    "tax-exempt": true,
    ghost: "dropped",
  });
  ok(vals["referred-by"] === "Patrick Strain", "#23: text values trim");
  ok(vals["annual-budget"] === 125000, "#23: numeric strings coerce to numbers");
  ok(vals["last-inspection"] === T, "#23: dates are epoch-ms numbers, passed through untouched");
  ok(vals["region"] === "North" && vals["tax-exempt"] === true, "#23: select/checkbox values pass when valid");
  ok(!("ghost" in vals), "#23: ids with no matching def are stripped");

  const bad = validateFieldValues(DEFS, {
    "annual-budget": "a lot",
    region: "West",
    "tax-exempt": "yes",
    "last-inspection": "2026-07-20",
    "referred-by": null,
  });
  ok(!("annual-budget" in bad), "#23: uncoercible numbers are dropped");
  ok(!("region" in bad), "#23: a select value outside options is dropped");
  ok(!("tax-exempt" in bad), "#23: non-boolean checkbox values are dropped");
  ok(!("last-inspection" in bad), "#23: ISO date strings are dropped — dates are epoch-ms ONLY");
  ok(bad["referred-by"] === null, "#23: null clears a value");
  ok(
    validateFieldValues(DEFS, { "referred-by": "   " })["referred-by"] === null,
    "#23: whitespace-only text clears like null"
  );

  // validateFieldDefs — dup ids, caps, select-without-options
  ok(validateFieldDefs(DEFS).ok === true, "#23: the sample defs validate");
  ok(
    validateFieldDefs([...DEFS, { id: "region", label: "Region 2", kind: "text", appliesTo: [] }]).ok === false,
    "#23: duplicate ids fail validation"
  );
  ok(
    validateFieldDefs([{ id: "s", label: "S", kind: "select", appliesTo: [] }]).ok === false,
    "#23: a select def with no options fails"
  );
  ok(
    validateFieldDefs(
      Array.from({ length: 31 }, (_, i) => ({ id: "f" + i, label: "F" + i, kind: "text" as const, appliesTo: [] }))
    ).ok === false,
    "#23: the 30-def cap holds"
  );
  ok(
    validateFieldDefs([{ id: "x", label: "x".repeat(61), kind: "text", appliesTo: [] }]).ok === false,
    "#23: labels cap at 60 chars"
  );
}

/* #22 — Mine/All literals. NAV / activeKeyFor / parentGroupOf are already
   imported by the D98/D117 nav sections above — reuse, never re-import. */
import { SEG_KEYS } from "@/app/(app)/leads/segs";

{
  ok(
    SEG_KEYS.join("|") === "all|follow|unassigned|new|open|won|lost",
    "#22: leads segments — the closed bundle is split into won|lost"
  );
  ok(
    !(SEG_KEYS as string[]).includes("closed"),
    "#22: legacy ?seg=closed is off the allowlist — deep links fall back to 'all'"
  );

  const childPairs = (key: string): string[] => {
    const g = NAV.find((e) => e.kind === "group" && e.key === key);
    return g && g.kind === "group" ? g.children.map((c) => `${c.key}:${c.href}`) : [];
  };
  ok(childPairs("est").includes("myquotes:/quotes?who=mine"), "#22: EST carries My Quotes → /quotes?who=mine");
  ok(childPairs("crm").includes("myleads:/leads?who=mine"), "#22: CRM carries My Leads → /leads?who=mine");
  ok(childPairs("pm").includes("myprojects:/projects?who=mine"), "#22: PM carries My Projects → /projects?who=mine");
  ok(
    activeKeyFor("/leads") === "leads" && parentGroupOf("myleads") === "crm",
    "#22: activeKeyFor stays pathname-only — a My-X child never lights its own key (known cosmetic limitation, base child lights for both)"
  );
}

/* ============ CONSULTING REBUILD (#35/#25 — spec §1, D123) ============ */
/* Six-stage lifecycle. Pure module, exact literals, no DB. */
import {
  ENGAGEMENT_STAGES,
  ENGAGEMENT_STAGE_KEYS,
  ENGAGEMENT_STATUS_LABEL as CONSULTING_STAGE_LABEL,
  LEGACY_STATUS_MAP,
  normalizeEngagementStatus,
  OPEN_ENGAGEMENT_STAGES,
  stageIndex,
} from "@/lib/consulting-stages";

{
  ok(
    ENGAGEMENT_STAGE_KEYS.join(",") ===
      "proposal_sent,awarded,design,out_to_bid,construction_admin,closed",
    "#35: six stages, in lifecycle order (spec §1)"
  );
  ok(
    ENGAGEMENT_STAGES.map((s) => CONSULTING_STAGE_LABEL[s.key]).join(" → ") ===
      "Proposal sent → Awarded → Design → Out to bid → Construction admin → Closed",
    "#35: stage labels match the spec ladder verbatim"
  );
  ok(stageIndex("awarded") === 1, "#35: stageIndex pins ladder position (ordering only, never a gate)");

  // Legacy mapping — COMPLETE over the old 4-status vocabulary
  ok(normalizeEngagementStatus("active") === "design", "#35: legacy active → design");
  ok(normalizeEngagementStatus("delivered") === "out_to_bid", "#35: legacy delivered → out_to_bid");
  ok(
    normalizeEngagementStatus("bid_supported") === "construction_admin",
    "#35: legacy bid_supported → construction_admin"
  );
  ok(
    normalizeEngagementStatus("oversight_complete") === "closed",
    "#35: legacy oversight_complete → closed"
  );
  ok(
    Object.keys(LEGACY_STATUS_MAP).sort().join(",") ===
      "active,bid_supported,delivered,oversight_complete",
    "#35: the legacy map covers exactly the four old literals — no more, no fewer"
  );
  ok(
    ENGAGEMENT_STAGE_KEYS.every((k) => normalizeEngagementStatus(k) === k),
    "#35: new stage keys pass through normalization untouched"
  );
  ok(
    normalizeEngagementStatus("???") === "design",
    "#35: unknown statuses land on design (safe middle of the ladder)"
  );

  // D113 item-11 carry-over: every pre-closed stage counts as open
  ok(
    OPEN_ENGAGEMENT_STAGES.length === 5 &&
      OPEN_ENGAGEMENT_STAGES.every((s) => isOpenEngagement({ status: s })),
    "#35: all five pre-closed stages count as open (D113.11 carries over)"
  );
  ok(!isOpenEngagement({ status: "closed" }), "#35: closed is the only closed stage");

  // venue-match duplicates the open list on purpose (zero-import module) —
  // pin the two modules in agreement so they can never drift apart.
  ok(
    OPEN_ENGAGEMENT_STAGES.every((s) => isOpenStage("engagement", s)) &&
      !isOpenStage("engagement", "closed") &&
      !isOpenStage("engagement", "active"),
    "#35: venue-match OPEN_STAGES.engagement agrees with the stage module (and dropped the legacy literals)"
  );
}

/* --- #35 spawn model: the pure sweep rules (spec §1) --- */
import { engagementSyncAction } from "@/lib/consulting-stages";
{
  const j = (x: unknown) => JSON.stringify(x);
  ok(
    j(engagementSyncAction("sent", null)) === j({ kind: "create", stage: "proposal_sent" }),
    "#35: sent consulting quote with no engagement → create at proposal_sent"
  );
  ok(
    j(engagementSyncAction("won", null)) === j({ kind: "create", stage: "awarded" }),
    "#35: won with no engagement → create straight at awarded"
  );
  ok(
    j(engagementSyncAction("won", "proposal_sent")) === j({ kind: "advance", stage: "awarded" }),
    "#35: won advances proposal_sent → awarded"
  );
  ok(
    engagementSyncAction("won", "design") === null &&
      engagementSyncAction("won", "closed") === null,
    "#35: won never moves a stage a human already advanced past proposal_sent"
  );
  ok(
    j(engagementSyncAction("lost", "proposal_sent")) === j({ kind: "close", stage: "closed" }),
    "#35: lost while still proposal_sent → closed"
  );
  ok(
    j(engagementSyncAction("sent", "closed")) === j({ kind: "reopen", stage: "proposal_sent" }),
    "#35: re-sending a proposal after Proposal lost reopens the engagement to proposal_sent (deliberate reopen rule)"
  );
  ok(
    engagementSyncAction("lost", "design") === null,
    "#35: losing a later-stage engagement is a human call, never the sweep's"
  );
  ok(
    engagementSyncAction("draft", null) === null &&
      engagementSyncAction("sent", "design") === null &&
      engagementSyncAction("lost", null) === null,
    "#35: drafts spawn nothing; sent/lost are no-ops without work to do (idempotence)"
  );
}

/* --- #35 structured scopes: totals + milestone seeding --- */
import {
  milestoneSeeds,
  scopesTotal,
  type ConsultingScope,
} from "@/lib/consulting-stages";
{
  const scopes: ConsultingScope[] = [
    { id: "sc-a", title: "Theatrical rigging design", description: "Drawings + specifications", fee: 8500 },
    { id: "sc-b", title: "Bid support", description: "", fee: 2000 },
  ];
  ok(scopesTotal(scopes) === 10500, "#35: the proposal total assembles from scope fees");
  ok(scopesTotal([]) === 0 && scopesTotal(undefined) === 0 && scopesTotal(null) === 0,
    "#35: no scopes → zero, tolerant of absent payloads");

  const seeded = milestoneSeeds({ scopes, feeMode: "milestones", fees: [{ name: "legacy", amount: 1 }] });
  ok(
    seeded.map((m) => `${m.name}:${m.amount}`).join("|") ===
      "Theatrical rigging design:8500|Bid support:2000",
    "#35: scopes seed milestones (name=title, amount=fee) and beat legacy fees"
  );
  ok(
    milestoneSeeds({ feeMode: "milestones", fees: [{ name: "SD complete", amount: 4000 }, { amount: 500 }] })
      .map((m) => `${m.name}:${m.amount}`).join("|") === "SD complete:4000|Milestone:500",
    "#35: legacy milestone quotes still seed from fees (nameless rows fall back)"
  );
  ok(
    milestoneSeeds({ feeMode: "fixed", fees: [{ name: "Fixed fee", amount: 9000 }] }).length === 0,
    "#35: legacy fixed-fee quotes seed no milestones (pre-rebuild behavior preserved)"
  );
  ok(
    milestoneSeeds({ scopes: [{ id: "sc-x", title: "", description: "d", fee: 0 }] })
      .map((m) => `${m.name}:${m.amount}`).join("|") === "Scope:0",
    "#35: a titleless scope still seeds, named 'Scope'"
  );
}

/* --- #35 assumptions library + the additive template field --- */
import {
  DEFAULT_CONSULTING_ASSUMPTIONS,
  mergedConsultingAssumptions,
} from "@/lib/consulting-stages";
import { getTemplateDef } from "@/lib/templates";
{
  ok(
    DEFAULT_CONSULTING_ASSUMPTIONS.length >= 8 && DEFAULT_CONSULTING_ASSUMPTIONS.length <= 12,
    "#35: the DRAFT assumption seed stays 8-12 lines (Jeff replaces from the real letter)"
  );
  ok(
    mergedConsultingAssumptions(undefined).join("|") === DEFAULT_CONSULTING_ASSUMPTIONS.join("|"),
    "#35: absent settings → the default library"
  );
  ok(
    mergedConsultingAssumptions([]).join("|") === DEFAULT_CONSULTING_ASSUMPTIONS.join("|"),
    "#35: an EMPTY stored list falls back to defaults (the visitReasons idiom)"
  );
  ok(
    mergedConsultingAssumptions(["  Owner provides access.  ", "", "Backgrounds by others."]).join("|") ===
      "Owner provides access.|Backgrounds by others.",
    "#35: a stored list wins whole, trimmed and de-blanked"
  );
  const cp = getTemplateDef("consulting_proposal");
  ok(
    !!cp && cp.fields.some((f) => f.id === "assumptionsLead"),
    "#35: consulting_proposal carries the assumptionsLead field (additive — ids are override keys)"
  );
  ok(
    cp!.fields.map((f) => f.id).join(",") ===
      "intro,scopeLead,feeLineFixed,feeLineMilestones,termsBlock,assumptionsLead,signoff,taxNote",
    "#35: no pre-existing field id was renamed (renames orphan stored overrides)"
  );
}

/* --- punch #60: send/won require an approval RECORD, not just a hidden
 * button (D84 review workflow was UI-only enforced — sendToCustomerAction and
 * setStatusAction("won") called nothing but requireUser()). These are the
 * pure guard functions both server actions consult; testing them directly
 * here (no DB) proves the rejection logic without needing a live quote doc. */
import {
  hasApproval,
  requireApprovalToAdvance,
  validateAttestationNote,
  canAttestApproval,
  type QuoteReview,
} from "@/lib/stores/quotes";

function review(over: Partial<QuoteReview> = {}): QuoteReview {
  return {
    state: "none",
    reviewer: null,
    submittedBy: null,
    submittedAt: null,
    decidedBy: null,
    decidedAt: null,
    note: "",
    method: null,
    ...over,
  };
}

{
  // No review at all (null) — the "requireUser() only" hole this closes.
  /* Attestation cannot override an in-app "request changes" (Jeff 2026-08-01).
     Attestation records an OFF-platform review; it is not a way around one
     that happened in the app. */
  ok(
    !canAttestApproval(review({ state: "changes" })).ok,
    "#60: a formal 'changes requested' BLOCKS self-attestation — a reviewer's explicit decision can't be overruled by the author's own note"
  );
  ok(
    canAttestApproval(review({ state: "none" })).ok,
    "#60: attestation is available on a quote that has never been reviewed — that is the whole point of the path"
  );
  ok(
    canAttestApproval(review({ state: "in_review" })).ok,
    "#60: attestation is available while merely awaiting a reviewer (the call may have already happened)"
  );
  ok(canAttestApproval(null).ok, "#60: attestation is available with no review record at all");

  /* The CSV importer records a status the quote already reached elsewhere.
     Without a bypass the gate throws on the first won/sent row of a history
     import — a legitimate flow, already gated behind manage_users. */
  ok(
    resolveStatusGate("won", review({ state: "none" }), { bypassApprovalGate: "historical-import" }).ok,
    "#60: the CSV importer may record an already-won quote with no approval record — imported history is not an approval decision made in this app"
  );
  ok(
    resolveStatusGate("sent", review({ state: "none" }), { bypassApprovalGate: "historical-import" }).ok,
    "#60: the same applies to an imported quote that was already sent"
  );
  ok(
    !resolveStatusGate("won", review({ state: "none" })).ok,
    "#60: but WITHOUT a bypass reason the gate still refuses won — the importer's exemption must not leak to ordinary callers"
  );


  ok(!hasApproval(null), "#60: hasApproval is false with no review record");
  ok(!hasApproval(undefined), "#60: hasApproval is false with an undefined review record");
  ok(!hasApproval(review({ state: "none" })), "#60: hasApproval is false for state 'none'");
  ok(!hasApproval(review({ state: "in_review" })), "#60: hasApproval is false while merely 'in_review'");
  ok(!hasApproval(review({ state: "changes" })), "#60: hasApproval is false after 'changes' was requested — a stale approval does not carry forward");
  ok(hasApproval(review({ state: "approved", method: "in_app" })), "#60: hasApproval is true for an in-app approval");
  ok(hasApproval(review({ state: "approved", method: "attested" })), "#60: hasApproval is true for an attested approval");
  ok(hasApproval(review({ state: "approved", method: null })), "#60: hasApproval is true for a legacy approval with no method stamped (pre-punch-60 seed/decision) — preserves existing behavior");

  // sendToCustomerAction's gate — rejected with no approval record.
  const sendNoRecord = requireApprovalToAdvance(null, "send");
  ok(sendNoRecord.ok === false, "#60: send is rejected when no approval record exists");
  if (!sendNoRecord.ok) ok(sendNoRecord.error.length > 0, "#60: the send rejection carries a non-empty typed error, not a raw exception");
  const sendInReview = requireApprovalToAdvance(review({ state: "in_review" }), "send");
  ok(sendInReview.ok === false, "#60: send is rejected while only 'in_review' (submitted but not decided)");
  const sendOk = requireApprovalToAdvance(review({ state: "approved", method: "attested" }), "send");
  ok(sendOk.ok === true, "#60: send is allowed once an approval record (either method) exists");

  // setStatusAction("won")'s gate — rejected with no approval record, same predicate.
  const wonNoRecord = requireApprovalToAdvance(null, "won");
  ok(wonNoRecord.ok === false, "#60: marking won is rejected when no approval record exists");
  if (!wonNoRecord.ok) ok(wonNoRecord.error.length > 0, "#60: the won rejection carries a non-empty typed error, not a raw exception");
  ok(
    requireApprovalToAdvance(review({ state: "approved", method: "in_app" }), "won").ok === true,
    "#60: marking won is allowed once an in-app approval exists"
  );

  // Attested-approval note validation — MANDATORY, rejected empty/whitespace.
  const emptyNote = validateAttestationNote("");
  ok(emptyNote.ok === false, "#60: an empty attestation note is rejected");
  const whitespaceNote = validateAttestationNote("   \n\t  ");
  ok(whitespaceNote.ok === false, "#60: a whitespace-only attestation note is rejected");
  const nullNote = validateAttestationNote(null);
  ok(nullNote.ok === false, "#60: a null attestation note is rejected");
  const undefinedNote = validateAttestationNote(undefined);
  ok(undefinedNote.ok === false, "#60: an undefined attestation note is rejected");
  if (!emptyNote.ok) ok(emptyNote.error.length > 0, "#60: the empty-note rejection carries a non-empty typed error");
  const goodNote = validateAttestationNote("  Reviewed by Jeff on a Teams call, 2026-08-01  ");
  ok(goodNote.ok === true, "#60: a real attestation note is accepted");
  if (goodNote.ok) ok(goodNote.note === "Reviewed by Jeff on a Teams call, 2026-08-01", "#60: the accepted note is trimmed");
}

/* --- punch 60-67: the approval gate moved INTO setStatus() so every caller
 * inherits it (D84's gate only lived in two of eight-plus callers — the
 * quotes-list "Won" button, the create-with-status estimator path, and the
 * renewal-outreach auto-send in inbox/actions.ts were all still wide open).
 * `resolveStatusGate` is the exact pure decision `setStatus` consults before
 * writing — testing it directly here proves the gate holds/bypasses
 * correctly for every call path without touching a DB, so a future refactor
 * of setStatus can silently drop the check only if it also breaks this file. */
import { resolveStatusGate, type SetStatusOpts } from "@/lib/stores/quotes";
{
  const noRecord: QuoteReview | null = null;
  const inReview = review({ state: "in_review" });
  const changesRequested = review({ state: "changes" });
  const approvedInApp = review({ state: "approved", method: "in_app" });
  const approvedAttested = review({ state: "approved", method: "attested" });
  const engineBypass: SetStatusOpts = { bypassApprovalGate: "engine-owned-flow" };

  // unapproved -> won: refused (the exact hole reproduced from the quotes list).
  ok(resolveStatusGate("won", noRecord).ok === false, "#60-67: setStatus gate refuses unapproved -> won (no review record)");
  ok(resolveStatusGate("won", inReview).ok === false, "#60-67: setStatus gate refuses unapproved -> won (merely in_review)");
  ok(resolveStatusGate("won", changesRequested).ok === false, "#60-67: setStatus gate refuses unapproved -> won (changes requested — a stale/reverted decision doesn't authorize it)");

  // unapproved -> sent: refused (the renewal-outreach auto-send + setStatusAction("sent") hole).
  ok(resolveStatusGate("sent", noRecord).ok === false, "#60-67: setStatus gate refuses unapproved -> sent (no review record)");
  ok(resolveStatusGate("sent", inReview).ok === false, "#60-67: setStatus gate refuses unapproved -> sent (merely in_review)");

  // approved (either method) -> won / sent: allowed.
  ok(resolveStatusGate("won", approvedInApp).ok === true, "#60-67: setStatus gate allows won with an in-app approval");
  ok(resolveStatusGate("won", approvedAttested).ok === true, "#60-67: setStatus gate allows won with an attested approval");
  ok(resolveStatusGate("sent", approvedInApp).ok === true, "#60-67: setStatus gate allows sent with an in-app approval");
  ok(resolveStatusGate("sent", approvedAttested).ok === true, "#60-67: setStatus gate allows sent with an attested approval");

  // draft/lost: always open, approval record or not — the punch spec leaves
  // every OTHER transition exactly as open as it always was.
  ok(resolveStatusGate("draft", noRecord).ok === true, "#60-67: setStatus gate never blocks -> draft, even with no review record");
  ok(resolveStatusGate("lost", noRecord).ok === true, "#60-67: setStatus gate never blocks -> lost, even with no review record");
  ok(resolveStatusGate("draft", changesRequested).ok === true, "#60-67: setStatus gate never blocks -> draft regardless of review state");
  ok(resolveStatusGate("lost", inReview).ok === true, "#60-67: setStatus gate never blocks -> lost regardless of review state");

  // The engine bypass (repairs/quote, inspections/quote, flame-tests/quote
  // ONLY) — permitted through even with zero approval record, because that
  // opt-out is exactly what those three self-contained accept flows pass.
  ok(resolveStatusGate("won", noRecord, engineBypass).ok === true, "#60-67: the engine-owned-flow bypass permits won with NO approval record at all — this is what repairs/inspections/flame-tests quote actions rely on");
  ok(resolveStatusGate("sent", noRecord, engineBypass).ok === true, "#60-67: the engine-owned-flow bypass also covers sent, not just won");
  ok(resolveStatusGate("won", changesRequested, engineBypass).ok === true, "#60-67: the engine-owned-flow bypass overrides even an explicit 'changes requested' review state — it is a full opt-out by design, scoped to exactly three call sites");

  // Without the bypass opt-in, the default is ALWAYS gated for won/sent —
  // this is the regression the punch spec calls "impossible to reintroduce
  // silently": a bare `resolveStatusGate(status, review)` call (no third
  // arg) must refuse an unapproved won/sent exactly like the explicit-{}
  // form above, so a future caller that forgets the options argument stays
  // safe automatically instead of accidentally landing on an open gate.
  ok(resolveStatusGate("won", noRecord).ok === resolveStatusGate("won", noRecord, {}).ok, "#60-67: omitting opts entirely behaves identically to passing {} — the gate is ON by default, not opt-in");
}

/* --- punch #77: the quotes-list "approved" banner used to hardcode "Approved
 * by X — ready to send" regardless of `method`/`note`, silently dropping the
 * attribution punch #60's attested path exists to preserve. `approvedReviewLine`
 * is the exact pure formatter both the Estimator banner and the quotes-list
 * panel now render — asserting it here (no DB) covers in_app, attested, and
 * the legacy method-absent/null case without a browser. */
import { approvedReviewLine } from "@/lib/stores/quotes";
{
  const inApp = review({ state: "approved", method: "in_app", decidedBy: "Jeff Chesebro", reviewer: "Nic" });
  ok(
    approvedReviewLine(inApp) === "Approved by Jeff — ready to send to the customer",
    `#77: an in-app approval renders "Approved by <first name>" (got "${approvedReviewLine(inApp)}")`
  );

  const attested = review({
    state: "approved",
    method: "attested",
    decidedBy: "Jeff Chesebro",
    note: "Reviewed by Nic on a Teams call, 2026-08-01",
  });
  ok(
    approvedReviewLine(attested) ===
      "Attested by Jeff — “Reviewed by Nic on a Teams call, 2026-08-01” — ready to send to the customer",
    `#77: an attested approval names who recorded it AND quotes the mandatory note (got "${approvedReviewLine(attested)}")`
  );

  const attestedNoNote = review({ state: "approved", method: "attested", decidedBy: "Jeff Chesebro", note: "" });
  ok(
    approvedReviewLine(attestedNoNote) === "Attested by Jeff — ready to send to the customer",
    `#77: an attested approval with no note still reads as attested but omits the empty quote (got "${approvedReviewLine(attestedNoNote)}")`
  );

  // Legacy docs decided before punch #60 added `method` — absent/null, but
  // still a valid approval. Must render exactly like an in-app approval
  // (never as attested, never broken) so pre-#60 history doesn't regress.
  const legacyAbsent = review({ state: "approved", decidedBy: "Jeff Chesebro", reviewer: "Nic" });
  delete (legacyAbsent as Partial<QuoteReview>).method;
  ok(
    approvedReviewLine(legacyAbsent) === "Approved by Jeff — ready to send to the customer",
    `#77: a legacy approval with method absent renders as a plain in-app approval, not attested (got "${approvedReviewLine(legacyAbsent)}")`
  );

  const legacyNull = review({ state: "approved", method: null, decidedBy: null, reviewer: "Nic" });
  ok(
    approvedReviewLine(legacyNull) === "Approved by Nic — ready to send to the customer",
    `#77: a legacy approval with method null and no decidedBy falls back to the reviewer, same as the in-app branch (got "${approvedReviewLine(legacyNull)}")`
  );
}

/* --- punch 60-67: travel / catalog / fixture Estimating Rules groups are
   now live (store/key, not ref) and pull from a single rates table --- */
import {
  GROUPS as PRICING_GROUPS,
  FIXTURE_RATE_DEFAULTS,
  TRAVEL_RATE_DEFAULTS,
  CATALOG_RATE_DEFAULTS,
  type RateEntry,
  type PricingGroup,
} from "@/lib/stores/pricing";
{
  const groupOf = (key: string): PricingGroup =>
    PRICING_GROUPS.find((g) => g.key === key)!;
  const travelG = groupOf("travel");
  const catalogG = groupOf("catalog");
  const fixtureG = groupOf("fixture");
  ok(travelG.live === true, "#60-67: travel group flips to live: true");
  /* catalog stays NOT live on purpose: the value is persisted, but nothing in the
     codebase consumes it — a part with no list price is skipped, never defaulted
     through this margin. Tagging it "live" would claim an edit reprices something
     when it cannot (the punch #70 / #14 failure mode). Flip this the same day a
     real consumer lands. */
  ok(catalogG.live === false, "#60-67: catalog group stays NOT live — the rate persists but no pricing path reads it yet, so claiming 'live' would be false");
  ok(fixtureG.live === true, "#60-67: fixture group flips to live: true");

  const rateRows = (g: PricingGroup): RateEntry[] =>
    g.items.filter((it): it is RateEntry => it.kind === "rate");
  ok(
    rateRows(travelG).every((it) => it.ref === false && it.store === "travel"),
    "#60-67: every travel rate row carries store:'travel' and ref:false"
  );
  ok(
    rateRows(catalogG).every((it) => it.store === "catalog" && it.ref === true),
    "#60-67: the catalog rate is wired to store:'catalog' (so it persists) but stays ref:true (so the UI still calls it reference, honestly)"
  );
  ok(
    rateRows(fixtureG).every((it) => it.ref === false && it.store === "fixture"),
    "#60-67: every fixture rate row carries store:'fixture' and ref:false"
  );
  ok(
    rateRows(fixtureG).length === 19,
    `#60-67: all 19 fixture rate rows survived the conversion (got ${rateRows(fixtureG).length})`
  );

  const byId = (g: PricingGroup, id: string): RateEntry =>
    rateRows(g).find((it) => it.id === id)!;
  // No default VALUE changed by the conversion — the rate()'s display default
  // still matches the seed constant it now proxies to.
  ok(
    byId(travelG, "travel.roadFactor").def === TRAVEL_RATE_DEFAULTS.roadFactor,
    "#60-67: travel.roadFactor default is still 1.25"
  );
  ok(byId(travelG, "travel.mph").def === TRAVEL_RATE_DEFAULTS.mph, "#60-67: travel.mph default is still 50");
  ok(
    byId(catalogG, "catalog.defaultMargin").def === 30 && CATALOG_RATE_DEFAULTS.defaultMargin === 0.3,
    "#60-67: catalog.defaultMargin default is still 30% (stored as the 0.30 fraction, pctStored)"
  );
  ok(
    byId(fixtureG, "fixture.mountCclamp").def === FIXTURE_RATE_DEFAULTS.mountCclamp &&
      FIXTURE_RATE_DEFAULTS.mountCclamp === 18,
    "#60-67: fixture.mountCclamp default is still $18"
  );
  ok(
    byId(fixtureG, "fixture.customCostFactor").def === FIXTURE_RATE_DEFAULTS.customCostFactor &&
      FIXTURE_RATE_DEFAULTS.customCostFactor === 0.66,
    "#60-67: fixture.customCostFactor default is still 0.66×"
  );
}

/* --- punch 60-67: estimator-data.ts fixture add-ons source PRICE from the
   Estimating Rules "fixture" store (no third copy); COST is untouched --- */
import { fixtureAddOns } from "@/app/(app)/estimator/estimator-data";
import { computeFixture as computeFixtureRules } from "@/app/(app)/estimator/pricing";
{
  const def = fixtureAddOns(); // no override — must equal today's hardcoded numbers
  ok(
    def.mounts["C-clamp"].price === 18 && def.mounts["C-clamp"].cost === 11,
    "#60-67: default C-clamp mount price/cost unchanged (18 / 11)"
  );
  ok(def.customCostFactor === 0.66, "#60-67: default manual-entry cost factor unchanged (0.66×)");

  const draft = {
    model: "ETC-S4-26",
    custom: false,
    name: "",
    price: "",
    qty: "2",
    mount: "C-clamp",
    accessories: ["Safety cable"],
    power: ["Edison"],
    lamp: "LED",
    position: "",
    circuit: "",
  } as Parameters<typeof computeFixtureRules>[0];

  const base = computeFixtureRules(draft); // default add-ons (no Estimating Rules override)
  // ETC-S4-26 list 520/cost 340; C-clamp 18/11; Safety cable 12/7; Edison 22/13; LED 0/0
  ok(base.unit === 520 + 18 + 12 + 22, `#60-67: unit price matches the pre-existing hardcoded add-on rates (got ${base.unit})`);
  ok(base.cost === 340 + 11 + 7 + 13, `#60-67: cost still comes from estimator-data.ts's local cost table (got ${base.cost})`);

  const overridden = fixtureAddOns({ ...FIXTURE_RATE_DEFAULTS, mountCclamp: 25 });
  const priced = computeFixtureRules(draft, overridden);
  ok(
    priced.unit === base.unit + 7,
    `#60-67: an Estimating Rules override to fixture.mountCclamp reprices the Estimator fixture configurator (got +${priced.unit - base.unit}, want +7)`
  );
  ok(
    priced.cost === base.cost,
    "#60-67: overriding price in Estimating Rules does not change cost — cost has no row there and stays put"
  );
}

/* --- punch 60-67: flametest-engine's travel fallback (roadFactor/mph) now
   takes an explicit param sourced from Estimating Rules → "travel"; the
   default preserves today's exact 1.25 / 50 values and live-route/OSRM
   precedence upstream (geo.ts / companies location.travelMiles) is untouched --- */
import { compute as computeFlameQuote, type FlameTestVenueInput as FTVenue } from "@/lib/flametest-engine";
{
  const rates = {
    mileageRate: 0.7,
    laborRate: 30,
    curtainMinutes: 5,
    baseFee: 150,
    margin: 0.3,
    travelRoundMin: 15,
  };
  const office = { lat: 43.039, lng: -87.906, name: "Milwaukee office" }; // Milwaukee, WI
  const venue: FTVenue = {
    id: "v1",
    label: "Venue",
    curtains: 2,
    coords: { lat: 43.073, lng: -89.401 }, // Madison, WI (~80mi straight-line)
  };

  const implicitDefault = computeFlameQuote({ office, venues: [venue] }, rates);
  const explicitDefault = computeFlameQuote({ office, venues: [venue] }, rates, TRAVEL_RATE_DEFAULTS);
  ok(
    implicitDefault.trip.miles === explicitDefault.trip.miles &&
      implicitDefault.trip.minutesRaw === explicitDefault.trip.minutesRaw,
    "#60-67: omitting the travel param defaults to the exact 1.25 / 50 fallback numbers used before this change"
  );
  ok(implicitDefault.trip.method === "route", "#60-67: full-coords trips still take the (offline) route-leg branch, unchanged");

  const doubledRoad = computeFlameQuote({ office, venues: [venue] }, rates, { roadFactor: 2.5, mph: 50 });
  ok(
    Math.abs(doubledRoad.trip.miles - implicitDefault.trip.miles * 2) <= 2,
    `#60-67: doubling travel.roadFactor (1.25 → 2.5) ~doubles the offline fallback road miles (base ${implicitDefault.trip.miles}, got ${doubledRoad.trip.miles})`
  );

  const halfSpeed = computeFlameQuote({ office, venues: [venue] }, rates, { roadFactor: 1.25, mph: 25 });
  ok(
    Math.abs(halfSpeed.trip.minutesRaw - implicitDefault.trip.minutesRaw * 2) <= 4,
    `#60-67: halving travel.mph (50 → 25) ~doubles the offline fallback drive-time estimate (base ${implicitDefault.trip.minutesRaw}, got ${halfSpeed.trip.minutesRaw})`
  );
}

/* --- punch 60-67: geo.ts's own offline fallback (driveMiles/driveMinutes/
   minutesFromMiles) now takes an explicit `travel` param sourced from
   Estimating Rules -> "travel" (TRAVEL_RATE_DEFAULTS), same pattern as
   flametest-engine.ts above. The default preserves the exact 1.25 / 50
   values used before this change; live/cached OSRM routing in estimate()
   still wins ahead of this tier (untouched — this DB-free suite can't
   reach estimate() itself, which is asserted by inspection instead). ---
*/
import {
  driveMiles as geoDriveMiles,
  driveMinutes as geoDriveMinutes,
  minutesFromMiles as geoMinutesFromMiles,
} from "@/lib/geo";
{
  const office = { lat: 43.039, lng: -87.906 }; // Milwaukee, WI
  const venue = { lat: 43.073, lng: -89.401 }; // Madison, WI (~80mi straight-line)

  const defaultMiles = geoDriveMiles(office, venue);
  const explicitDefaultMiles = geoDriveMiles(office, venue, TRAVEL_RATE_DEFAULTS);
  ok(
    defaultMiles === explicitDefaultMiles,
    "#60-67: geo.driveMiles omitting travel defaults to the exact TRAVEL_RATE_DEFAULTS fallback"
  );

  const defaultMinutes = geoDriveMinutes(office, venue);
  const explicitDefaultMinutes = geoDriveMinutes(office, venue, TRAVEL_RATE_DEFAULTS);
  ok(
    defaultMinutes === explicitDefaultMinutes,
    "#60-67: geo.driveMinutes omitting travel defaults to the exact TRAVEL_RATE_DEFAULTS fallback"
  );

  const doubledRoad = geoDriveMiles(office, venue, { roadFactor: 2.5, mph: 50 });
  ok(
    defaultMiles !== null &&
      doubledRoad !== null &&
      Math.abs(doubledRoad - defaultMiles * 2) <= 2,
    `#60-67: doubling travel.roadFactor (1.25 -> 2.5) ~doubles geo.driveMiles' fallback road miles (base ${defaultMiles}, got ${doubledRoad})`
  );

  const halfSpeed = geoDriveMinutes(office, venue, { roadFactor: 1.25, mph: 25 });
  ok(
    defaultMinutes !== null &&
      halfSpeed !== null &&
      Math.abs(halfSpeed - defaultMinutes * 2) <= 4,
    `#60-67: halving travel.mph (50 -> 25) ~doubles geo.driveMinutes' fallback drive-time estimate (base ${defaultMinutes}, got ${halfSpeed})`
  );

  const mfmDefault = geoMinutesFromMiles(100);
  ok(
    mfmDefault === Math.round((100 / 50) * 60),
    `#60-67: geo.minutesFromMiles defaults to mph=50 (got ${mfmDefault})`
  );
  const mfmOverride = geoMinutesFromMiles(100, { roadFactor: 1.25, mph: 25 });
  ok(
    mfmOverride === Math.round((100 / 25) * 60),
    `#60-67: geo.minutesFromMiles honors an overridden travel.mph (got ${mfmOverride})`
  );
}

/* --- #76: tier-catalog fallback classification --- */
// #76: the real predicate, IMPORTED from its dependency-free module rather than
// copied. It used to live in the "use server" actions.ts, which forced this test
// to keep a hand-synced duplicate — a test that validates its own copy and keeps
// passing once the two drift. Moving it to @/lib/tier-pricing fixed that AND an
// illegal non-async export from a "use server" module.
{

  ok(isTierPriced(500, 0.3) === true, "#76: cost > 0 and margin in (0,1) -> tier-priced");
  ok(isTierPriced(0, 0.3) === false, "#76: cost = 0 -> fallback to list, not tier-priced");
  ok(isTierPriced(500, 0) === false, "#76: margin = 0 (outside open interval) -> fallback");
  ok(isTierPriced(500, 1) === false, "#76: margin = 1 (outside open interval) -> fallback");
  ok(isTierPriced(500, 1.2) === false, "#76: margin > 1 -> fallback");
  ok(isTierPriced(500, -0.1) === false, "#76: negative margin -> fallback");
}

/* ---- punch #79: demo seed reaches the dynamic routes ---- */
const gridSeeded = gridProjectsSeed();
ok(gridSeeded.length >= 1, "#79 grid seed produces at least one design");
ok(gridSeeded[0].id === "GRD-5001", "#79 grid seed id is GRD-5001 (base 5001 floor)");
ok(
  typeof gridSeeded[0].customer === "string" && gridSeeded[0].customer.length > 0,
  "#79 grid seed carries a customer name"
);

const consultingQuotes = quotesSeed().filter(
  (q) => (q as { quoteType?: string }).quoteType === "consulting"
);
ok(consultingQuotes.length === 1, "#79 exactly one consulting quote is seeded");
ok(
  consultingQuotes[0].status === "won",
  "#79 the consulting quote is won, so syncEngagementsFromQuotes mints an engagement"
);

/* ---- punch #81: xlsx → CSV conversion ----
 * The file's first ASYNC assertions. This script is CommonJS (no top-level
 * await), so every async check lives inside asyncChecks() below, invoked
 * once at the very end; the summary/exit-code block is chained onto its
 * settlement (.then/.catch) instead of running as bare top-level statements,
 * so it can no longer report a false "ALL PASSED" while these are still
 * in flight. Task 5 appends its catalog checks into this same function
 * rather than adding a second one. */
/* --- Rentals module, Task 1: equipment items + locations data layer ---
 * Real await (list()/byCategory() hit the doc-store, not a pure function),
 * so this is asserted from inside asyncChecks() below, same as the #81
 * catalog-import checks it sits next to. */
import { list as listEquipmentItems, byCategory as equipmentByCategory } from "../src/lib/stores/equipment-items";
import { equipmentItemsSeed } from "../src/db/seeds/equipment";

/* --- Rentals module, Task 2: equipment bookings + availability logic ---
 * overlaps() is pure, so it's asserted here at top level; availableQty()/
 * create() hit the doc-store and are asserted from inside asyncChecks()
 * below, next to the Task 1 checks. */
import { overlaps, availableQty, create as createBooking, byQuote as bookingsByQuote } from "../src/lib/stores/equipment-bookings";
import { qtyOwned as equipmentQtyOwned } from "../src/lib/stores/equipment-items";

/* --- PUNCHLIST #13: service-linked project dual-write ---
 * createFromQuote() reads the quote doc directly via doc-store (not the
 * quotes.ts store module — InspectionQuoteLike/RepairQuoteLike are
 * deliberately minimal structural views), so a fake quote written the same
 * way is a faithful, isolated way to exercise the spawn without going
 * through the real quote builder UI/actions. Asserted inside asyncChecks(). */
import { upsertDoc } from "../src/db/doc-store";
import { createFromQuote as createInspectionFromQuote, byQuote as inspectionsByQuote } from "../src/lib/stores/inspections";
import { createFromQuote as createRepairFromQuote, byQuote as repairByQuote } from "../src/lib/stores/repair-jobs";
import { createProject, getProject, getProjectByQuote, setDeliveryStatus, setProjectStage, setSignoff } from "../src/lib/stores/projects";
import { addQuoteRevision, create as createQuote, get as getQuote, restoreQuoteRevision, update as updateQuote } from "../src/lib/stores/quotes";

ok(overlaps(1000, 2000, 1500, 2500) === true, "overlaps: partial overlap detected");
ok(overlaps(1000, 2000, 2000, 3000) === true, "overlaps: touching boundary counts as overlap");
ok(overlaps(1000, 2000, 2001, 3000) === false, "overlaps: adjacent non-touching is not overlap");
ok(overlaps(1000, 5000, 2000, 3000) === true, "overlaps: fully contained overlap detected");

/* --- Rentals module, Task 5: rental pricing formula --- pure, asserted here at top level. */
import { priceRental } from "../src/lib/pricing/rental";

{
  const rentalRates = { dayRate: 50, weekRate: 200, monthRate: 600 };
  ok(priceRental(3, rentalRates) === 150, "priceRental: 3 days bills at day rate (150)");
  ok(priceRental(10, rentalRates) === 400, "priceRental: 10 days bills at week rate (2 weeks = 400)");
  ok(priceRental(30, rentalRates) === 600, "priceRental: 30 days bills at month rate (600)");
  ok(priceRental(0, rentalRates) === 0, "priceRental: 0 days bills 0");

  // Punch review fix: a blank/zero rate period must never win the min() and
  // silently price the whole rental free — it must be excluded from the
  // candidate set, falling back to whichever positive rate is cheapest.
  const blankWeek = { dayRate: 50, weekRate: 0, monthRate: 600 };
  ok(
    priceRental(10, blankWeek) === 500,
    "priceRental: blank weekRate (0) doesn't collapse a 10-day rental to $0 — falls back to day rate (10 * 50 = 500, cheaper than the 600 month rate)"
  );
  const blankMonth = { dayRate: 50, weekRate: 200, monthRate: 0 };
  ok(
    priceRental(30, blankMonth) === 1000,
    "priceRental: blank monthRate (0) doesn't collapse a 30-day rental to $0 — falls back to cheaper of day (1500) / week (ceil(30/7)=5 weeks * 200 = 1000)"
  );
  const blankDay = { dayRate: 0, weekRate: 200, monthRate: 600 };
  ok(
    priceRental(3, blankDay) === 200,
    "priceRental: blank dayRate (0) doesn't collapse a 3-day rental to $0 — falls back to week rate (200)"
  );
  const allZero = { dayRate: 0, weekRate: 0, monthRate: 0 };
  ok(priceRental(10, allZero) === 0, "priceRental: all-zero rates (no usable rate data) still returns 0, not a crash");
}

/* --- #88: rate-limit refund primitive --- pure in-memory module, asserted here at top level. */
import { rateLimit, rateLimitRefund } from "../src/lib/rate-limit";

{
  const k = "test:88:basic";
  ok(rateLimit(k, 1, 60_000).ok, "#88 rateLimit: first hit within a fresh window is ok");
  ok(!rateLimit(k, 1, 60_000).ok, "#88 rateLimit: second hit against a limit of 1 is refused");
  rateLimitRefund(k);
  ok(rateLimit(k, 1, 60_000).ok, "#88 rateLimitRefund: refunding the spent token lets the next hit through");
  ok(!rateLimit(k, 1, 60_000).ok, "#88 rateLimitRefund: the refund itself doesn't grant a second extra hit");

  const k2 = "test:88:refund-preserves-others";
  ok(rateLimit(k2, 2, 60_000).ok, "#88 rateLimitRefund setup: hit 1 of 2 ok");
  ok(rateLimit(k2, 2, 60_000).ok, "#88 rateLimitRefund setup: hit 2 of 2 ok");
  ok(!rateLimit(k2, 2, 60_000).ok, "#88 rateLimitRefund setup: hit 3 of 2 refused");
  rateLimitRefund(k2);
  ok(
    rateLimit(k2, 2, 60_000).ok,
    "#88 rateLimitRefund: refunding one of two spent tokens frees exactly one slot, not the whole window"
  );

  const k3 = "test:88:refund-empty-key";
  rateLimitRefund(k3); // must not throw on a key with no recorded hits
  ok(rateLimit(k3, 1, 60_000).ok, "#88 rateLimitRefund: refunding an untouched key is a safe no-op");
}

/* --- #14: catalog price-book age pills --- pure, asserted here at top level. */
import { priceBooks } from "../src/lib/catalog-books";

{
  const now = Date.now();
  const DAY = 86400000;

  const fullyFresh = priceBooks([
    { mfr: "Acme", updatedAt: now - 3 * DAY },
    { mfr: "Acme", updatedAt: now - 5 * DAY },
  ]);
  ok(
    fullyFresh[0]?.ageDays === Math.floor((Date.now() - (now - 5 * DAY)) / DAY),
    "#14 priceBooks: age pill is the OLDEST updatedAt in a fully-covered book, not the newest"
  );

  const partialCoverage = priceBooks([
    { mfr: "Beta", updatedAt: now },
    { mfr: "Beta" }, // never touched
  ]);
  ok(
    partialCoverage[0]?.count === 2 && partialCoverage[0]?.ageDays === undefined,
    "#14 priceBooks: one touched row out of two does NOT produce an age pill for the whole book " +
      "(a partial edit must not make a mostly-untouched book read as fresh)"
  );

  const neverTouched = priceBooks([{ mfr: "Gamma" }, { mfr: "Gamma" }]);
  ok(
    neverTouched[0]?.ageDays === undefined,
    "#14 priceBooks: a book with no updatedAt anywhere gets no pill (honest unknown, not a fake 0d)"
  );

  const unbranded = priceBooks([{ updatedAt: now }, { mfr: "  " }]);
  ok(
    unbranded.some((b) => b.name === "Unbranded" && b.count === 2),
    "#14 priceBooks: blank/whitespace-only mfr groups under 'Unbranded'"
  );

  const capped = priceBooks(
    Array.from({ length: 8 }, (_, i) => ({ mfr: `Mfr${i}`, updatedAt: now })).flatMap((p, i) =>
      Array.from({ length: 8 - i }, () => p)
    )
  );
  ok(capped.length === 6, `#14 priceBooks: caps at the top 6 books by count (got ${capped.length})`);
  ok(
    capped[0]?.name === "Mfr0" && capped[0]?.count === 8,
    "#14 priceBooks: sorted by count descending"
  );
}

async function xlsxFixture(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Price List");
  ws.addRow(["Part Number", "Description", "MSRP", "Dealer", "Manufacturer"]);
  ws.addRow(["S4LED-S2", "Source Four LED Series 2", 1899.5, 1139.7, "ETC"]);
  ws.addRow(["CS-40", 'Curtain track, 40" carrier, "heavy" duty', 42, 25.2, "ADC"]);
  ws.addRow(["CS-41", "Multi-line\ndescription", 10, 5, "ADC"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function asyncChecks(): Promise<void> {
  const { seedDemoCollections } = await import("../src/db/seed-data");
  await seedDemoCollections();
  const xr = await xlsxToCsv(await xlsxFixture());
  ok(xr.ok, "#81 a well-formed .xlsx converts");
  if (xr.ok) {
    const lines = xr.csv.split("\n");
    ok(lines[0] === "Part Number,Description,MSRP,Dealer,Manufacturer", "#81 header row survives");
    ok(lines[1] === "S4LED-S2,Source Four LED Series 2,1899.5,1139.7,ETC", "#81 numbers keep full precision");
    ok(
      lines[2] === 'CS-40,"Curtain track, 40"" carrier, ""heavy"" duty",42,25.2,ADC',
      "#81 commas and quotes are CSV-escaped"
    );
    ok(
      xr.csv.includes('CS-41,"Multi-line\ndescription",10,5,ADC'),
      "#81 an embedded newline is quoted so it can't be misread as a row break"
    );
    ok(xr.rows === 3, "#81 row count excludes the header");
    ok(xr.sheetName === "Price List", "#81 the sheet name comes back for the UI");
  }

  const notAWorkbook = await xlsxToCsv(Buffer.from("this is not a spreadsheet"));
  ok(!notAWorkbook.ok, "#81 garbage input fails cleanly instead of throwing");

  /* ---- punch #81: catalog import type maps a real vendor sheet ---- */
  const catType = getTypeMeta("catalog");
  ok(!!catType, "#81 a catalog import type is registered");
  if (catType) {
    const vendorCsv = [
      "Part Number,Description,MSRP,Dealer Net,Manufacturer",
      "S4LED-S2,Source Four LED Series 2,1899.50,1139.70,ETC",
      ",Row with no SKU,10,5,ETC",
    ].join("\n");
    const vp = parseImportCsv(vendorCsv);
    ok(vp.ok, "#81 vendor CSV parses");
    const vmap = autoMap(vp.headers, catType.fields);
    ok(vmap.sku === 0, "#81 'Part Number' auto-maps to sku");
    ok(vmap.list === 2, "#81 'MSRP' auto-maps to list");
    ok(vmap.cost === 3, "#81 'Dealer Net' auto-maps to cost");
    ok(vmap.mfr === 4, "#81 'Manufacturer' auto-maps to mfr");

    const vprep = prepareRows(vp.rows, vmap, catType.fields);
    ok(vprep.stats.valid === 1, "#81 the row with no SKU is not importable");
    ok(vprep.stats.invalid === 1, "#81 …and is counted as needing attention");
    ok(Number(vprep.rows[0].values.list) === 1899.5, "#81 list price coerces to a number");

    /* ---- punch #81: re-importing a price sheet must not zero stored prices ----
     * The writer itself (commitImport → WRITERS.catalog.update → mergeUpsert)
     * needs a database, and this script never opens one. `catalogPatch` is the
     * pure half of that writer — the exact object the update path hands
     * mergeUpsert — so the merge semantics are exercised for real here, fed by
     * real prepareRows output rather than hand-built values. */
    const stored = {
      id: "S4LED-S2",
      sku: "S4LED-S2",
      desc: "Source Four LED Series 2",
      category: "Lighting",
      unit: "ea",
      list: 1899.5,
      cost: 1139.7,
      mfr: "ETC",
    };
    const prepOf = (csv: string) => {
      const p2 = parseImportCsv(csv);
      return prepareRows(p2.rows, autoMap(p2.headers, catType.fields), catType.fields);
    };

    // The #81 workflow: an updated vendor sheet carrying List but no Cost column.
    const noCost = prepOf(
      ["Part Number,Description,List Price", "S4LED-S2,Source Four LED Series 2,1999.00"].join("\n")
    );
    ok(
      noCost.rows[0].values.cost === 0,
      "#81 an absent Cost column prepares as 0 — the writer can't read it as 'leave alone'"
    );
    const upd = catalogPatch(noCost.rows[0].values, stored, "S4LED-S2");
    ok(upd.list === 1999, "#81 re-import takes the new list price from the sheet");
    ok(upd.cost === 1139.7, "#81 …and does NOT zero the stored cost the sheet omits");
    ok(upd.mfr === "ETC", "#81 …and keeps the stored manufacturer");
    ok(
      upd.category === "Lighting" && upd.unit === "ea",
      "#81 …and keeps the other columns the sheet doesn't carry"
    );

    // Column present, single cell blank — same protection.
    const blankCell = prepOf(
      ["Part Number,Description,List Price,Cost", "S4LED-S2,Source Four LED Series 2,1999.00,"].join("\n")
    );
    ok(
      catalogPatch(blankCell.rows[0].values, stored, "S4LED-S2").cost === 1139.7,
      "#81 a blank Cost cell doesn't zero the stored cost either"
    );

    // …but a cost the sheet DOES carry still wins.
    const realCost = prepOf(
      ["Part Number,Description,List Price,Cost", "S4LED-S2,Source Four LED Series 2,1999.00,1200.00"].join("\n")
    );
    ok(
      catalogPatch(realCost.rows[0].values, stored, "S4LED-S2").cost === 1200,
      "#81 a Cost the sheet does carry still overwrites the stored one"
    );

    // Create path (no existing part): mergeUpsert reads an explicitly-passed
    // undefined as "clear this field", so an absent Manufacturer omits the key.
    const created = catalogPatch(noCost.rows[0].values, null, "S4LED-S2");
    ok(!("mfr" in created), "#81 create omits mfr rather than passing an explicit undefined");
    ok(
      created.category === "Uncategorized" && created.unit === "ea",
      "#81 create still applies its own defaults for absent columns"
    );
  }

  /* --- Rentals module, Task 1: equipment items + locations data layer ---
   * Derive expectations from equipmentItemsSeed() rather than hardcoding a
   * total count: the shared dev DB accumulates extra items from manual
   * testing and CSV imports across later tasks, so an exact-length assert
   * breaks the moment anyone adds one. Instead assert every seeded item is
   * present (>= seed count, plus each seeded id specifically found), same
   * "derive from live state" pattern as Task 2's booking checks below. */
  const seedItems = equipmentItemsSeed();
  const eqItems = await listEquipmentItems();
  ok(eqItems.length >= seedItems.length, "equipment-items: at least the seeded items are present");
  ok(
    seedItems.every((seed) => eqItems.some((item) => item.id === seed.id)),
    "equipment-items: every seeded item id is present"
  );
  const lighting = await equipmentByCategory("lighting");
  const seededLighting = seedItems.filter((seed) => seed.category === "lighting");
  ok(
    seededLighting.every((seed) => lighting.some((item) => item.id === seed.id)) &&
      lighting.every((item) => item.category === "lighting"),
    "equipment-items: byCategory filters correctly"
  );

  /* --- Rentals module, Task 2: equipment bookings + availability logic ---
   * This is the first state-mutating write in the whole script — everything
   * else here is read-only against seed/fixture data or pure functions —
   * and it lands in the real persistent PGlite dev DB, so it must be safe
   * to run any number of times without a manual DB reset (AGENTS.md is
   * explicit about not casually reaching for `db:reset-local`).
   *
   * Two things make repeat runs safe:
   *   1. A fixed, dedicated quoteId + a fixed far-future date window
   *      (not Date.now()-based) so a booking created by a prior run always
   *      lands in exactly the same window a later run checks — no drift
   *      from "how long ago was the last run".
   *   2. Dedup via byQuote(): if that booking already exists, skip
   *      creating a duplicate, and derive expectations from qtyOwned()
   *      instead of hardcoding 8/5, so the assertions hold whether this is
   *      the first run ever or the hundredth. */
  const TEST_BOOKING_QUOTE_ID = "test-quote-task2-lifecycle";
  const TEST_WINDOW_START = new Date("2031-01-01T00:00:00Z").getTime();
  const TEST_WINDOW_END = TEST_WINDOW_START + 86400000;

  const owned = await equipmentQtyOwned("eq-1", "loc-1");
  const priorTestBookings = await bookingsByQuote(TEST_BOOKING_QUOTE_ID);
  if (priorTestBookings.length === 0) {
    const before = await availableQty("eq-1", "loc-1", TEST_WINDOW_START, TEST_WINDOW_END);
    ok(before === owned, "equipment-bookings: eq-1 starts fully available at loc-1 in the test window");
    await createBooking({
      itemId: "eq-1",
      locationId: "loc-1",
      qty: 3,
      quoteId: TEST_BOOKING_QUOTE_ID,
      startDate: TEST_WINDOW_START,
      endDate: TEST_WINDOW_END,
      status: "confirmed",
      rate: 45,
    });
  } else {
    ok(
      priorTestBookings.length === 1,
      "equipment-bookings: at most one test booking exists from prior runs (no duplicate created)"
    );
  }
  const after = await availableQty("eq-1", "loc-1", TEST_WINDOW_START, TEST_WINDOW_END);
  ok(after === owned - 3, "equipment-bookings: confirmed booking reduces availability");

  /* --- PUNCHLIST #13: service-linked project dual-write ---
   * Fixed test ids + idempotency checks (same "safe to run any number of
   * times" requirement as the equipment-bookings test above) since this
   * writes to the real persistent dev DB, not a scratch one. A fake quote
   * written directly via doc-store is a faithful, isolated way to exercise
   * the spawn without the real quote builder UI/actions — createFromQuote()
   * reads the quote the same way (InspectionQuoteLike/RepairQuoteLike are
   * deliberately minimal structural views, not the quotes.ts store). */
  const TEST_INSPECTION_QUOTE_ID = "test-quote-punch13-inspection";
  const TEST_REPAIR_QUOTE_ID = "test-quote-punch13-repair";

  {
    const priorInspections = await inspectionsByQuote(TEST_INSPECTION_QUOTE_ID);
    if (!priorInspections.length) {
      await upsertDoc("quotes", {
        id: TEST_INSPECTION_QUOTE_ID,
        name: "PUNCHLIST #13 test inspection quote",
        quoteType: "inspection",
        status: "won",
        customer: "Test Customer #13",
        customerId: null,
        locationId: null,
        value: 500,
        owner: "Jeff Chesebro",
      });
    }
    const recs = await createInspectionFromQuote(TEST_INSPECTION_QUOTE_ID);
    ok(!!recs && recs.length === 1, "#13 inspection createFromQuote spawns a record for the test quote");
    const projectId = recs?.[0]?.projectId;
    ok(!!projectId, "#13 inspection record carries a projectId");
    if (projectId) {
      const proj = await getProject(projectId);
      ok(!!proj, "#13 the linked project actually exists");
      ok(proj?.projectType === "inspection", `#13 linked project projectType is 'inspection' (got ${proj?.projectType})`);
      ok(proj?.stage === "complete", `#13 linked project starts at stage 'complete' (got ${proj?.stage})`);
      ok(
        proj?.value === 0,
        `#13 linked project carries no value (got ${proj?.value}) — the real $ lives on the quote/inspection, never doubled here`
      );
      ok(proj?.kind === "order", `#13 linked project kind is 'order' (got ${proj?.kind})`);
      ok(proj?.quoteId === TEST_INSPECTION_QUOTE_ID, "#13 linked project's quoteId matches the originating quote");
    }
    // Idempotency: re-running createFromQuote must not spawn a second project or duplicate records.
    const recs2 = await createInspectionFromQuote(TEST_INSPECTION_QUOTE_ID);
    ok(recs2?.length === 1, "#13 inspection createFromQuote is idempotent (no duplicate records on re-run)");
    ok(recs2?.[0]?.projectId === projectId, "#13 re-running createFromQuote returns the SAME linked project id");
  }

  {
    const priorRepair = await repairByQuote(TEST_REPAIR_QUOTE_ID);
    if (!priorRepair) {
      await upsertDoc("quotes", {
        id: TEST_REPAIR_QUOTE_ID,
        name: "PUNCHLIST #13 test repair quote",
        quoteType: "repair",
        status: "won",
        customer: "Test Customer #13",
        customerId: null,
        locationId: null,
        value: 750,
        owner: "Jeff Chesebro",
      });
    }
    const rec = await createRepairFromQuote(TEST_REPAIR_QUOTE_ID);
    ok(!!rec, "#13 repair createFromQuote spawns a record for the test quote");
    ok(!!rec?.projectId, "#13 repair record carries a projectId");
    if (rec?.projectId) {
      const proj = await getProject(rec.projectId);
      ok(proj?.projectType === "repair", `#13 linked project projectType is 'repair' (got ${proj?.projectType})`);
      ok(proj?.stage === "complete", "#13 linked project starts at stage 'complete'");
      ok(proj?.value === 0, "#13 linked project carries no value");
    }
    const rec2 = await createRepairFromQuote(TEST_REPAIR_QUOTE_ID);
    ok(
      rec2?.id === rec?.id && rec2?.projectId === rec?.projectId,
      "#13 repair createFromQuote is idempotent (same record, same linked project on re-run)"
    );
  }

  {
    const p1 = await getProjectByQuote(TEST_INSPECTION_QUOTE_ID);
    const p2 = await getProjectByQuote(TEST_REPAIR_QUOTE_ID);
    ok(!!p1 && !!p2 && p1.id !== p2.id, "#13 the inspection and repair test quotes get DISTINCT linked projects");
  }

  /* --- PUNCHLIST #16: completion requires sign-off ---
   * Break caught: the direct stage-change path could mark a project complete
   * without a recorded signoff, which contradicted the project lifecycle and
   * made the completion follow-up task fire too early. */
  {
    const project = await createProject({
      name: "PUNCHLIST #16 completion gate",
      kind: "project",
      stage: "install",
      signoff: null,
    });
    const blocked = await setProjectStage(project.id, "complete", "Jeff Chesebro");
    ok(blocked?.stage === "install", "#16 direct completion is blocked until sign-off exists");
    await setSignoff(project.id, { name: "Morgan Hall", role: "Client" }, "Jeff Chesebro");
    const completed = await setProjectStage(project.id, "complete", "Jeff Chesebro");
    ok(completed?.stage === "complete", "#16 completion succeeds once sign-off is recorded");
    ok(!!completed?.signoff?.name, "#16 sign-off data persists through completion");
  }

  /* --- PUNCHLIST #36: estimator assumptions/exceptions/attachments survive quote revisions ---
   * Break caught: saving a revision and later restoring it can currently
   * revert priced content while silently dropping quote-side assumptions,
   * exceptions, and internal vendor attachments. */
  {
    const quote = await createQuote({
      name: "PUNCHLIST #36 revision payload",
      customer: "Test Customer #36",
      owner: "Jeff Chesebro",
      source: "estimator",
      quoteType: "system",
    });
    await updateQuote(quote.id, {
      estimatorAssumptions: ["Existing power remains by owner", "Final dimmer counts confirmed at field measure"],
      estimatorExceptions: ["Permitting excluded", "Patch/paint by others"],
      estimatorOutputMode: "both",
      estimatorNarrative:
        "This proposal includes a complete theatrical lighting package plus installation and commissioning.",
      internalAttachments: [
        {
          id: "att-1",
          name: "ETC dealer quote.pdf",
          mime: "application/pdf",
          size: 12345,
          dataUrl: "data:application/pdf;base64,AAA",
          addedAt: 1,
          addedBy: "Jeff Chesebro",
        },
      ],
    } as any);
    await addQuoteRevision(quote.id, { by: "Jeff Chesebro", note: "Captured estimator extras" });
    await updateQuote(quote.id, {
      estimatorAssumptions: ["CHANGED"],
      estimatorExceptions: ["CHANGED"],
      estimatorOutputMode: "bom",
      estimatorNarrative: "CHANGED",
      internalAttachments: [],
    } as any);
    const restored = await restoreQuoteRevision(quote.id, 1, "Jeff Chesebro");
    ok(restored.ok, "#36 quote revision restore succeeds");
    const live = await getQuote(quote.id);
    ok(
      Array.isArray((live as any)?.estimatorAssumptions) &&
        (live as any).estimatorAssumptions.join("|") ===
          "Existing power remains by owner|Final dimmer counts confirmed at field measure",
      "#36 restoring a revision restores estimator assumptions",
    );
    ok(
      Array.isArray((live as any)?.estimatorExceptions) &&
        (live as any).estimatorExceptions.join("|") === "Permitting excluded|Patch/paint by others",
      "#36 restoring a revision restores estimator exceptions",
    );
    ok(
      Array.isArray((live as any)?.internalAttachments) &&
        (live as any).internalAttachments.length === 1 &&
        (live as any).internalAttachments[0].name === "ETC dealer quote.pdf",
      "#36 restoring a revision restores internal quote attachments",
    );
    ok(
      (live as any)?.estimatorOutputMode === "both",
      "#36 restoring a revision restores the quote output mode",
    );
    ok(
      (live as any)?.estimatorNarrative ===
        "This proposal includes a complete theatrical lighting package plus installation and commissioning.",
      "#36 restoring a revision restores the estimator narrative",
    );
  }

  /* --- PUNCHLIST #44: project completion creates a due walkthrough task ---
   * Break caught: the completion auto-task fires, but without the ~7 day due
   * date the spec calls for, so the sales follow-up never lands in the right
   * reminder window. */
  {
    const before = Date.now();
    const project = await createProject({
      name: "PUNCHLIST #44 walkthrough task",
      kind: "project",
      stage: "install",
      signoff: null,
      quoteId: "Q-test-44",
    });
    await createQuote({
      id: "Q-test-44",
      name: "Quote for #44",
      customer: "Test Customer #44",
      owner: "Sam Rivera",
      source: "estimator",
      quoteType: "system",
    });
    await setSignoff(project.id, { name: "Morgan Hall", role: "Client" }, "Jeff Chesebro");
    await setProjectStage(project.id, "complete", "Jeff Chesebro");
    const after = Date.now();
    const tasks = await tasksForProject(project.id);
    const walkthrough = tasks.find((t) => t.coverageKey === `item16:completed:${project.id}`);
    ok(!!walkthrough, "#44 completion creates the walkthrough follow-up task");
    ok(
      !!walkthrough?.dueAt &&
        walkthrough.dueAt >= before + 6 * 86400000 &&
        walkthrough.dueAt <= after + 8 * 86400000,
      "#44 completion walkthrough task is due about 7 days out",
    );
  }

  /* --- PUNCHLIST #44: final delivery auto-advances the project to Scheduled ---
   * Break caught: marking the last delivery received updates only the line,
   * leaving the project stuck in Delivery instead of moving the install
   * workflow forward. Reversing that received status must also undo the
   * automatic stage bump. */
  {
    const project = await createProject({
      name: "PUNCHLIST #44 delivery auto-stage",
      kind: "project",
      stage: "delivery",
      deliveries: [
        { id: "dl-1", label: "Rigging package", vendor: "JR Clancy", eta: Date.now(), status: "received", receivedAt: Date.now() },
        { id: "dl-2", label: "Soft goods", vendor: "Rose Brand", eta: Date.now(), status: "in_transit" },
      ],
    });
    const stillDelivery = await setDeliveryStatus(project.id, "dl-2", "in_transit");
    ok(stillDelivery?.stage === "delivery", "#44 non-final delivery updates do not advance the project");
    const autoScheduled = await setDeliveryStatus(project.id, "dl-2", "received");
    ok(autoScheduled?.stage === "scheduled", "#44 the final received delivery auto-advances the project to Scheduled");
    ok(
      autoScheduled?.stageHistory?.[autoScheduled.stageHistory.length - 1]?.via === "auto-deliveries",
      "#44 auto-scheduled delivery transitions are tagged in stage history",
    );
    const reverted = await setDeliveryStatus(project.id, "dl-2", "scheduled");
    ok(reverted?.stage === "delivery", "#44 undoing the last received delivery reverts the auto-scheduled stage");
    ok(
      reverted?.stageHistory?.[reverted.stageHistory.length - 1]?.via === "auto-deliveries",
      "#44 undoing the auto-stage keeps the same delivery-history tag",
    );
  }

  /* --- PUNCHLIST #44: schedule booking seeds from the next pending delivery ETA ---
   * Break caught: the schedule board can book crew for a pre-received project,
   * but the booking flow anchors to today instead of the expected ship date,
   * so the delivery-driven pre-booking view never materializes. */
  {
    const jan12 = new Date(2026, 0, 12).getTime();
    const jan20 = new Date(2026, 0, 20).getTime();
    const jan15 = new Date(2026, 0, 15).getTime();
    const jan18 = new Date(2026, 0, 18).getTime();
    const jan22 = new Date(2026, 0, 22).getTime();
    const jan5 = new Date(2026, 0, 5).getTime();
    ok(
      nextPendingDeliveryEta({
        deliveries: [
          { id: "dl-1", label: "Soft goods", vendor: "Rose Brand", eta: jan20, status: "in_transit" },
          { id: "dl-2", label: "Lighting package", vendor: "ETC", eta: jan15, status: "scheduled" },
          { id: "dl-3", label: "Rigging", vendor: "JR Clancy", eta: jan18, status: "received", receivedAt: jan18 },
        ],
      } as any) === jan15,
      "#44 nextPendingDeliveryEta picks the earliest not-yet-received ship date",
    );
    const deliverySeed = scheduleBookingSeed(
      {
        deliveries: [
          { id: "dl-1", label: "Soft goods", vendor: "Rose Brand", eta: jan20, status: "in_transit" },
          { id: "dl-2", label: "Lighting package", vendor: "ETC", eta: jan15, status: "scheduled" },
        ],
        installStart: jan22,
      } as any,
      jan12,
    );
    ok(
      deliverySeed.start === jan15 && deliverySeed.reason === "delivery_eta",
      "#44 booking seeds from the pending delivery ETA before the install window",
    );
    const installSeed = scheduleBookingSeed(
      { deliveries: [], installStart: jan22 } as any,
      jan12,
    );
    ok(
      installSeed.start === jan22 && installSeed.reason === "install_start",
      "#44 booking falls back to the install start when there is no pending delivery ETA",
    );
    const todaySeed = scheduleBookingSeed(
      { deliveries: [], installStart: null } as any,
      jan5,
    );
    ok(
      todaySeed.start === jan5 && todaySeed.reason === "today",
      "#44 booking falls back to today when neither delivery ETA nor install start exists",
    );
  }

  /* --- PUNCHLIST #44: signoff persists explicit scope checks and signature metadata ---
   * Break caught: the signoff record only stores free-text name/role/note, so
   * the lifecycle cannot prove which install scopes were accepted or that a
   * signature was actually captured. */
  {
    const project = await createProject({
      name: "PUNCHLIST #44 explicit signoff record",
      kind: "project",
      stage: "training",
      signoff: null,
    });
    const signed = await setSignoff(
      project.id,
      {
        name: "Morgan Hall",
        role: "Facilities Director",
        scopeChecks: {
          Lighting: true,
          Rigging: false,
          Curtains: true,
          Audio: true,
          Video: false,
          Fake: true,
        },
        signatureBlobKey: "  data:image/png;base64,signature-demo  ",
        signedByName: "",
        capturedBy: "",
        note: "Curtains punch item remains open.",
      } as any,
      "Jeff Chesebro",
    );
    ok(signed?.stage === "signoff", "#44 recording signoff still advances the project into Sign-off");
    ok(
      !!signed?.signoff?.scopeChecks &&
        signed.signoff.scopeChecks.Lighting === true &&
        signed.signoff.scopeChecks.Curtains === true &&
        signed.signoff.scopeChecks.Video === false &&
        !("Fake" in signed.signoff.scopeChecks),
      "#44 signoff stores per-scope acceptance checks",
    );
    ok(
      signed?.signoff?.signatureBlobKey === "data:image/png;base64,signature-demo",
      "#44 signoff stores the captured signature reference",
    );
    ok(
      signed?.signoff?.signedByName === "Morgan Hall" &&
        signed?.signoff?.capturedBy === "Jeff Chesebro",
      "#44 signoff stores signer identity separately from the recorder",
    );
  }
}

/* --- Venue Assessments: class model --- */
ok(VENUE_CLASSES.length === 6, `six venue classes (got ${VENUE_CLASSES.length})`);
ok(
  VENUE_CLASSES.map((c) => c.key).join(",") ===
    "theatre,auditorium,church,gym,convention,other",
  "venue classes in spec order"
);
ok(venueClassFor("Proscenium theater") === "theatre", "proscenium theater -> theatre");
ok(venueClassFor("Black box") === "theatre", "black box -> theatre");
ok(venueClassFor("Worship / sanctuary") === "church", "worship -> church");
ok(venueClassFor("Gymnasium / gym stage") === "gym", "gym stage -> gym");
ok(venueClassFor("Arena") === "theatre", "arena -> theatre");
ok(venueClassFor("Multipurpose room") === "convention", "multipurpose -> convention");
ok(venueClassFor("Outdoor / amphitheater") === "other", "outdoor -> other");
ok(venueClassFor("") === "theatre", "empty venue type falls back to theatre");
ok(venueClassFor("Nonsense") === "theatre", "unknown venue type falls back to theatre");
ok(venueSubtypeFor("Black box") === "Black box / flexible", "black box carries its subtype");
ok(venueSubtypeFor("Outdoor / amphitheater") === "", "outdoor has no subtype");
ok(
  VENUE_CLASSES.every((c) => SUBTYPES[c.key] !== undefined),
  "every class has a subtype list (other may be empty)"
);
ok(
  VENUE_CLASSES.filter((c) => c.key !== "other").every((c) => SUBTYPES[c.key].length > 0),
  "every class but 'other' has at least one subtype"
);
ok(
  Object.values(SUBTYPES).every((list) => list.every((s) => typeof s === "string" && s.length > 0)),
  "no empty subtype strings"
);
ok(visitPurposeFor("Budgetary walk-through") === "Bid walk", "budgetary -> bid walk");
ok(visitPurposeFor("Service call") === "Repair / service", "service call -> repair/service");
ok(visitPurposeFor("Design verification") === "New system design", "design verification -> new system design");
ok(visitPurposeFor("") === "", "empty visit type stays empty");
ok(VISIT_PURPOSES.length === 6, `six visit purposes (got ${VISIT_PURPOSES.length})`);
ok(VISIT_PURPOSES[0] === "New system design", "sheet order preserved");

// Every class resolves to at least one width key and one depth key, and every
// such key must actually exist in that class's field set. This is the hard
// invariant that keeps the Tier-1 gate satisfiable on every class.
ok(
  VENUE_CLASSES.every((c) => {
    const keys = classMeasureFields(c.key).map((f) => f.key);
    const w = TIER1_WIDTH_BY_CLASS[c.key];
    const d = TIER1_DEPTH_BY_CLASS[c.key];
    return !!w && !!d && keys.includes(w) && keys.includes(d);
  }),
  "every class has a width+depth key present in its own field set"
);
ok(classMeasureFields("gym").some((f) => f.key === "courtLength"), "gym asks court length");
ok(classMeasureFields("gym").some((f) => f.key === "dividerSpan"), "gym asks divider curtain span");
ok(classMeasureFields("gym").some((f) => f.key === "bleacherType"), "gym asks bleacher type");
ok(classMeasureFields("auditorium").some((f) => f.key === "pinRail"), "auditorium asks pin rail location");
ok(classMeasureFields("auditorium").some((f) => f.key === "loadingGallery"), "auditorium asks loading gallery");
ok(classMeasureFields("theatre").some((f) => f.key === "proW"), "theatre reuses the existing proW key");
ok(classMeasureFields("church").some((f) => f.key === "centerAisleW"), "church reuses the existing centerAisleW key");
ok(classMeasureFields("convention").some((f) => f.key === "rigPointCapacity"), "convention asks rigging point capacity");
ok(
  classMeasureFields("other").length > 0,
  "the 'other' class has a generic field set, not an empty one"
);
// No class may invent a key that duplicates an existing one under a new name.
const RESERVED = ["proW","proH","stageDepth","gridH","wingSL","wingSR","houseH","seating","boothLoc","boothWD","apron","centerAisleW","platformWidth","platformDepth","roomWidth","roomDepth","pitDepth"];
ok(
  VENUE_CLASSES.every((c) =>
    classMeasureFields(c.key).every((f) => !/^(prosceniumWidth|stageW|ceilingHeight|houseHeight)$/.test(f.key))
  ),
  "no class re-invents a reserved dimension under a new key name"
);
ok(RESERVED.length === 17, "reserved key list is the spec's list");


asyncChecks()
  .then(() => {
    cleanupSpecDb();
    console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
    process.exit(fail ? 1 : 0);
  })
  .catch((err) => {
    cleanupSpecDb();
    console.error(err);
    process.exit(1);
  });
