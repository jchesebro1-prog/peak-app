import {
  generateSchedule, overrunsEnd, phaseWindows, placeTask, selectLines, shiftForMilestone, shiftTasksByIds, validateSpan,
  withEngagementPhaseIds, defaultMilestonePhaseId, phaseIdsByName, startOfLocalDay,
  type PhaseWeight, type ScheduleLine,
} from "@/lib/consulting-schedule";
import { barRect, dateFromX, dayColumns, packTracks, snapToDay } from "@/components/gantt/gantt-lib";
import { normalizeSku } from "@/lib/davinci/sku";
import { PROTOCOL_MAP, DIRECTION_MAP, mapProtocol, PASSTHROUGH_TYPES } from "@/lib/davinci/protocol-map";
import { extractLibrary } from "@/lib/davinci/extract";
import { buildIndex, buildIndexWithStats, matchSku } from "@/lib/davinci/match";
import { matchBom, assemble, renderSpecHtml, report, type MatchedRow } from "@/lib/bid-spec";
import { parseCsv } from "@/app/(app)/design/engagements/spec/parse-bom";
import { TABS } from "@/app/(app)/design/engagements/tabs";
import { approvalIsStale, openChecklistItems } from "@/lib/consulting-review";
import { safeCallbackPath, resolveSignInRedirect } from "@/lib/auth-redirect";
import {
  redirectHostMismatch,
  IMPORT_BATCH_PER_RUN,
  IMPORT_MAX_CHUNKS_PER_RUN,
  isRateLimit,
  domainOf,
  isPublicDomain,
} from "@/lib/gmail/config";
import {
  pickSessionCookies,
  challengeFor,
  isChallenge,
  mintHandoffCode,
  redeemHandoffCode,
  HANDOFF_TTL_MS,
} from "@/lib/native-auth";
import { resolveSender } from "@/lib/gmail/resolve";
import { parsePeakLabel, desiredPeakLabels, diffLabels, labelForStatus, currentPeakLabelNames } from "@/lib/gmail/peak-labels";
import { planLabelCommands, collapseLabelEventsByThread } from "@/lib/gmail/label-interpret";
import {
  normalizeEngagementRecord, getEngagement, type EngagementPhase, createManualEngagement, allEngagements,
  setMilestonePhase, patchEngagement,
} from "@/lib/stores/engagements";
import { TEMPLATE_RECORD_KINDS, TEMPLATE_RECORD_LABEL } from "@/lib/task-template-kinds";
import {
  normalizeLine as normalizeTemplateLine,
  applyTaskTemplate, createTaskTemplateSet, updateTaskTemplateSet, allTaskTemplateSets, removeTaskTemplateSet,
  type ApplyTemplateSchedule, type TaskTemplateLine,
} from "@/lib/stores/task-templates";
import { activeUsers } from "@/lib/users";
import { groupByPerson, mergeBookingsIntoPersonRows, UNASSIGNED_LABEL, type PersonBooking } from "@/app/(app)/schedule/people-lib";
import { parseAssignTarget } from "@/app/(app)/import/registry";
import { softDeleteDoc } from "@/db/doc-store";
import {
  msOf as opMsOf,
  serviceToWorkItems,
  WORK_TYPE_META,
  startOfDay as opStartOfDay,
} from "@/lib/operations-work";
import { venueDimsFromEstimator, venueDimsFromLineset, DEFAULT_VENUE_DIMS, battenLenFt, BATTEN_OVERHANG_FT } from "@/lib/design/venue-dims";
import { curtainCost, curtainPrice, makingRateFor, DEFAULT_MAKING_RATE, DEFAULT_CYC_MAKING_RATE, SEED_FABRIC_RATES } from "@/lib/design/curtain-pricing";
import {
  DEFAULT_OPTION_ID,
  DEFAULT_OPTION_NAME,
  copyOptionMembers,
  defaultOptionId,
  ensureOptions,
  hasOption,
  optionSlice,
  resolveOptionId,
  syncQuoteMirror,
} from "@/lib/design/grid-options";
import { DEFAULT_SETTINGS, DEMO_COLLECTIONS } from "@/db/seed-data";
import { DOC_TABLES, SYNCABLE_COLLECTIONS } from "@/db/doc-tables";
import { PARTNER_TYPES, baseVenueKind } from "@/lib/identity/venue-defaults";
import { VENDOR_COMPANY_TYPE, isVendorType } from "@/lib/identity/config";
import {
  catalogEffectiveAtFor, groupCompanyOptions, manufacturerDirectory, partCountFor, resolveCatalogOwner, unclaimedManufacturers,
  vendorStatus, vendorTasks, type PriceListEntry as VendorPriceListEntry,
} from "@/lib/vendor-status";
import { VENDOR_TABS, resolveVendorTab } from "@/app/(app)/vendors/tabs";
import {
  fromDateInput as vendorFromDateInput,
  parseLedgerDates as vendorParseLedgerDates,
  toDateInput as vendorToDateInput,
} from "@/app/(app)/vendors/dates";
import { FIELD_COLLECTIONS } from "@/lib/sync/engine";
import { canRecord, mergedConsultingDisciplines, phaseWeightsFor } from "@/lib/settings";
import {
  blankAudio, blankKrisp, isArchivable, mergeActionItems, needsKrispCheck, normalizeRecording,
  recordingParentLabel, recordingStatusChip,
  type AudioState, type KrispNoteBlock, type KrispStatus, type RecordingActionItem, type RecordingRecord,
} from "@/lib/stores/recordings";
import {
  buildRecordingTitle, extensionForMime, formatElapsed, recordingBlobPathname, uploadBackoffMs,
  RECORDING_TITLE_MAX, UPLOAD_BACKOFF_MAX_MS,
} from "@/lib/recorder/helpers";
import {
  actionItemKey, deriveSummary, matchAssignee, prefillInsertText, routePrefill, summarySearchText, summarySectionKey,
} from "@/lib/krisp/derive";
import {
  createKrispClient, krispErrorFor, krispMeetingUrl, putToPresignedUrl,
  KrispApiError, KrispAuthError, KrispBusyError, KrispForbiddenError, KrispNotReadyError, KrispRateLimitError,
  type KrispTransport,
} from "@/lib/krisp/client";
import { hasDriveScope, DRIVE_SCOPE } from "@/lib/gmail/config";
import {
  DriveApiError, DRIVE_API_BASE, DRIVE_UPLOAD_BASE, driveFileLink, driveQuote, ensureFolder, folderQuery,
  uploadFileResumable, type DriveFetch,
} from "@/lib/google/drive";
import {
  engagementFolderPath, fileRefHref, fileRefKey, fileRefName, isOwnedBlobPathname, isValidDataRef, ownsEngagementFile, safeMime,
  type FileRef,
} from "@/lib/consulting-files";
import {
  archiveDateStamp, archiveFileName, archiveFolderKey, archiveRecordings, archiveSafeName, extForMime,
  ARCHIVE_MAX_PER_RUN, ARCHIVE_MIN_AGE_MS, ARCHIVE_SKIP_NO_SCOPE, ARCHIVE_SKIP_NOT_CONFIGURED, ARCHIVE_SKIP_NOT_CONNECTED,
  type ArchiveDeps,
} from "@/lib/krisp/archive";
import { INTEGRATION_CARDS } from "@/app/(app)/settings/settings-sections";
import { applyPrefillToRecord, feedNoteText, summarySectionsWithKeys } from "@/lib/krisp/write-back";
import { pollKrispImport, readyPayloadFromMeeting } from "@/lib/krisp/check";
import { selectForReconcile } from "@/lib/krisp/reconcile";
import { accentContrast } from "@/lib/color";
import { emailFor, legacyEmailFor } from "@/lib/team";
import { gridProjectsSeed } from "@/db/seeds/grid-projects";
import { quotesSeed } from "@/db/seeds/quotes";
import { customersSeed } from "@/db/seeds/customers";
import { vendorProfilesSeed } from "@/db/seeds/vendors";
import ExcelJS from "exceljs";
import { xlsxToCsv } from "@/lib/import/xlsx-to-csv";
import { IMPORT_TYPES, getTypeMeta, type ImportTypeMeta } from "@/app/(app)/import/types";
import {
  autoMap,
  normalizeZip,
  parseCsv as parseImportCsv,
  prepareRows,
  visibleColumns,
} from "@/app/(app)/import/parse";
import {
  linksCustomer,
  matchContact,
  matchLocation,
  mergeContact,
  mergeLocation,
  parseYesNo,
  previewLinks,
  resolveCustomerForRow,
  venueKindFromCategory,
} from "@/app/(app)/import/link";
import type { CustomerContact, CustomerLocation } from "@/lib/stores/customers";
// catalogPatch/templateCsv are pure (no store access, no DB) — see the note
// on catalogPatch itself. commitImport/exportCsv are NOT — #145 D169 review
// (Important 1) exercises the task_templates writer for real, DB-backed,
// with cleanup (see asyncChecks()).
import { catalogPatch, templateCsv as importTemplateCsv, commitImport, exportCsv } from "@/app/(app)/import/registry";
import { toContactInput, toLocationInput } from "@/app/(app)/companies/lib";

import {
  VENUE_CLASSES, SUBTYPES, VISIT_PURPOSES, classMeasureFields,
  venueClassFor, venueSubtypeFor, visitPurposeFor, venueArchetype,
  TIER1_WIDTH_BY_CLASS, TIER1_DEPTH_BY_CLASS,
} from "@/lib/stores/venue-classes";

import {
  LINESET_TYPES, LINESET_CONDS, blankLinesetRow, newLinesetId,
  linesetTypeLabel, linesetCondLabel, nextLinesetPosition,
} from "@/lib/stores/linesets";

import {
  CONDITION_CATEGORIES, CONDITION_RATINGS, BUDGET_TIERS, FINDING_BUCKETS,
  CONDITION_GROUPS,
  EVENT_TYPES, EVENT_FREQUENCIES, STAFF_TIERS, GROWTH_GOALS,
  blankAssessment, seedFindings, newFindingId, toggleEventType, toggleGrowthGoal,
  mergeFindings, splitFindingCategory,
} from "@/lib/stores/assessment";

import {
  TIER1_WIDTH_KEYS,
  TIER1_DEPTH_KEYS,
  tier1Complete,
  DISCIPLINE_GROUPS,
  visibleFields,
  presentOptionsFor,
} from "@/lib/stores/survey-intake";
import { resolveCertsFromRecords } from "@/lib/venue-assessment-certs";
import {
  DEFAULT_VENUE_DOCTRINE,
  resolveVenueDoctrine,
} from "@/lib/venue-doctrine";
import { buildAssessmentSheet } from "@/lib/venue-assessment-sheet";
import { renderLetterPdf, type LetterBlock, type LetterDoc, type FieldSheetPage } from "@/lib/pdf";
import { inflateSync } from "node:zlib";
import {
  assemblyDescription,
  assemblyUnitTotals,
  resolveFixtureAssemblies,
} from "@/lib/fixture-assemblies";
import { MATERIAL_CSV_TEMPLATE, VENDOR_CSV_TEMPLATE, parseMaterialCsv, parseMoney } from "@/app/(app)/estimator/material-csv";
import { ownsVendorQuoteBlobPath } from "@/lib/vendor-quote-file";
import {
  GRID_SHEET_MAX_BYTES,
  GRID_SHEET_MAX_LABEL,
  isAllowedSheetMime,
  sheetMimeVerdict,
} from "@/lib/grid-sheet-file";
import { defaultLaborMobs, disciplineForSystemTitle } from "@/app/(app)/estimator/labor-defaults";
import { computeLabor, computeMob, lineMarginOf, repricedAtLineMargin, round2, systemFreight, systemFreightBase, systemItemsCost, systemItemsRev, vendorTotalSeed } from "@/app/(app)/estimator/pricing";
import type { SpecSection as EstimatorSpecSection } from "@/app/(app)/estimator/types";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadExtract } from "@/lib/davinci/load";
import type { DavinciExtract, DavinciRecord } from "@/lib/davinci/types";
import { requireHostedConfirmation } from "./db-target";
import { planEnrichment, applyEnrichment } from "@/lib/catalog-davinci-apply";
import { upsert as upsertPart, get as getPart } from "@/lib/stores/catalog";
import { mergeActivity, prefillFromMeeting } from "@/lib/engagement-activity";
import { performCapture, type CaptureDeps } from "@/lib/engagement-activity-write";

/**
 * THIS SUITE WRITES TO THE DATABASE. It creates and deletes catalog parts,
 * grid projects and other real rows, so it must only ever be pointed at a
 * throwaway PGlite datadir — never `.data/pglite` (the real book, 14,725
 * parts) and never a hosted `DATABASE_URL` (preview and production share one
 * Neon database).
 *
 * Same guard as scripts/test-grid-options.ts. `npm run test:specs` supplies
 * the scratch datadir itself, so the documented gate is safe on its own; this
 * throw is what stops a bare `tsx scripts/test-review-and-spec.ts` from
 * resolving whatever the ambient environment points at.
 */
if (!process.env.PGLITE_PATH) {
  throw new Error(
    "Refusing to run: this suite WRITES to the database and PGLITE_PATH is unset,\n" +
      "so it would resolve .data/pglite — the real catalog.\n" +
      "Run it on a throwaway datadir:\n" +
      "  npm run test:specs\n" +
      'or, by hand:  TEST_DB=$(mktemp -d) && PGLITE_PATH="$TEST_DB" tsx scripts/test-review-and-spec.ts'
  );
}

// PGLITE_PATH alone does NOT make this safe. getDb() (src/db/index.ts) returns
// the postgres-js client whenever DATABASE_URL is set and never consults
// PGLITE_PATH — and `npm run test:specs` always sets PGLITE_PATH, so the guard
// above can never fire for this case. On a shell that exported DATABASE_URL
// (a hosted db:export, a CI job) the repo's own mandated gate would otherwise
// write its fixtures into the shared production Neon database. Preview and
// production share one database here, so there is no safe hosted target.
if (process.env.DATABASE_URL) {
  throw new Error(
    "Refusing to run: DATABASE_URL is set, so this suite would write to the\n" +
      "HOSTED database (preview and production share one Neon instance).\n" +
      "Unset it for this command:\n" +
      "  env -u DATABASE_URL npm run test:specs"
  );
}

let fail = 0;
const ok = (c: boolean, m: string) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) fail++; };

/* --- Estimator labor defaults and cost rules --- */
ok(disciplineForSystemTitle("Lighting control") === "LIG", "labor scope defaults from the system title");
ok(disciplineForSystemTitle("Video projection") === "AUD", "audio and video share one labor scope");
ok(disciplineForSystemTitle("General conditions") === "OTH", "an unmatched system defaults to Other");
const defaultMobs = defaultLaborMobs(null);
ok(defaultMobs.length === 1 && defaultMobs[0]?.people === "1" && defaultMobs[0]?.days === "1", "labor opens with one mobilization");
const testRate = ((sku: string) => ({ "RIG-LBR": 50, "RIG-OT": 75, "RIG-SUP": 75, "DRF-SUB": 50 }[sku] || 0)) as any;
const day10 = computeMob({ ...defaultMobs[0], people: "4", days: "5", hoursPerDay: "10" }, "RIG", testRate);
ok(day10.reg === 160 && day10.otHrs === 40, "hours beyond 8 per day become crew overtime");
ok(day10.supHrs === 40 && day10.regCost === 9000, "the first person is the supervisor within the crew, not an added worker");
const laborCalc = computeLabor({ discipline: "RIG", margin: "30", mobs: [{ ...defaultMobs[0], people: "4", days: "5" }], pmHrs: "", pmAuto: true, shopHrs: "", drfHrs: "", drfAuto: true, misc: "" }, testRate);
ok(laborCalc.drfAutoHrs === 3.2, "drafting defaults to 2% of total regular hours");
ok(laborCalc.performanceBonus === laborCalc.baseCost * 0.05, "labor adds a 5% performance bonus based on base cost");

/* --- Estimator material/vendor quote CSV --- */
const materialCsv = parseMaterialCsv(`sku,description,quantity,unit,unit_cost,unit_sell,link
ETC-1,Fixture body,2,ea,$100.25,$150.50,https://example.com/fixture
,Custom bracket,1,ea,25,40,`);
ok(materialCsv.errors.length === 0, "material CSV accepts the downloadable-template columns");
ok(materialCsv.items.length === 2, "material CSV batch parses every valid row");
ok(
  materialCsv.items[0]?.cost === 100.25 && materialCsv.items[0]?.price === 150.5,
  "material CSV treats cost and sell as currency fields"
);
ok(
  materialCsv.items[0]?.link === "https://example.com/fixture",
  "material CSV preserves an optional product link"
);
const badMaterialCsv = parseMaterialCsv("description,quantity,unit_sell\nNo price,1,\nBad qty,zero,10");
ok(badMaterialCsv.items.length === 0 && badMaterialCsv.errors.length === 2, "material CSV rejects custom rows without a sell price or valid quantity");
// #112: a catalog row needs only sku + quantity — description/unit/cost/sell
// stay blank/0 for the estimator to fill from the catalog.
const skuOnlyCsv = parseMaterialCsv("sku,quantity\nabc-100,4\nXYZ-9,zero");
ok(skuOnlyCsv.errors.length === 1 && skuOnlyCsv.items.length === 1, "material CSV accepts a sku + quantity row and still rejects a bad quantity");
ok(
  skuOnlyCsv.items[0]?.sku === "abc-100" && skuOnlyCsv.items[0]?.qty === 4 && skuOnlyCsv.items[0]?.desc === "" &&
    skuOnlyCsv.items[0]?.unit === "" && skuOnlyCsv.items[0]?.cost === 0 && skuOnlyCsv.items[0]?.price === 0,
  "material CSV leaves description, unit, cost and sell blank on a sku-only row"
);
const templateCsv = parseMaterialCsv(MATERIAL_CSV_TEMPLATE);
ok(templateCsv.errors.length === 0 && templateCsv.items.length === 2, "material CSV example template parses both its catalog and custom rows");
ok(templateCsv.items[0]?.sku === "ABC-100" && templateCsv.items[0]?.price === 0 && templateCsv.items[1]?.price === 142.86, "material CSV example template: catalog row unpriced, custom row priced");

/* --- #143 (D162): the vendor quote form's own CSV mode --- */
const vendorTemplateCsv = parseMaterialCsv(VENDOR_CSV_TEMPLATE, { costOnly: true });
ok(
  vendorTemplateCsv.errors.length === 0 && vendorTemplateCsv.items.length === 2 &&
    vendorTemplateCsv.items[0]?.cost === 222 && vendorTemplateCsv.items[0]?.qty === 120,
  "#143 vendor CSV template parses through the form's own costOnly mode"
);
// #143: Amount is the line's EXTENDED total, never a per-unit price — the
// aliases it accepts ("line total", "extended", "ext cost") all say so, and
// vendorLinesTotal sums the column rather than multiplying it by qty. This
// pins the template against a regression back to per-unit reads, which
// inflated a 12 x $3,480 line to $41,760 in the form.
ok(
  vendorTemplateCsv.items.reduce((a, it) => a + it.cost, 0) === 390,
  "#143 vendor CSV template amounts sum as extended totals, not qty x unit"
);
const vendorAmountCsv = parseMaterialCsv('description,quantity,unit,amount\nTruss corner,4,ea,"1,250.00"', { costOnly: true });
ok(
  vendorAmountCsv.errors.length === 0 && vendorAmountCsv.items[0]?.cost === 1250,
  "#143 costOnly maps an Amount column — the header the form's own grid shows — to cost"
);
ok(
  parseMaterialCsv("description,quantity,unit,amount\nTruss corner,4,ea,1250").items.length === 0,
  "#143 the Amount alias is costOnly-only: a #112 catalog import still needs unit_cost/unit_sell"
);
const vendorZeroCsv = parseMaterialCsv("part number,description,quantity,unit_cost\nP-1,Yoke,12,4.50\nP-2,TBD bundle,2,", { costOnly: true });
ok(
  vendorZeroCsv.items.length === 1 && vendorZeroCsv.errors.length === 1,
  "#143 a SKU cannot stand in for a missing amount in costOnly mode — a $0 row would deflate the vendor total"
);
ok(parseMoney("$12,450.00") === 12450 && !Number.isFinite(parseMoney("abc")), "#143 money parses as printed on a vendor quote");
const freightSec: EstimatorSpecSection = {
  id: "sys1", name: "Rigging", kind: "materials", mfr: "", freightPct: 10,
  items: [
    { id: 1, sku: "A", desc: "Catalog part", qty: 2, unit: "ea", cost: 100, price: 150 },
    { id: 2, sku: "V-1", desc: "Vendor quote", qty: 1, unit: "lot", cost: 1000, price: 1428.57, vendorQuoteId: "vq1", noFreight: true },
  ],
};
ok(
  systemItemsCost(freightSec) === 1200 && systemFreightBase(freightSec) === 200 && systemFreight(freightSec) === 20,
  "#143 (D162) a vendor quote that includes freight leaves the freight base but still counts as cost"
);
/* D162, settled by Jeff 2026-09-22: "Vendor quotes should be affected by margin
   the same as a catalog and manual item." So `noFreight` must stay a
   FREIGHT-only flag — the moment it (or vendorQuoteId) is consulted by revenue
   or cost, an exempt vendor line stops being marked up like everything else and
   the blended margin silently drifts. This pins the asymmetry: freight sees
   only the freight base, revenue and cost see every line. The repricing
   handlers themselves (setMarginAll / setSystemMargin, estimator-client.tsx)
   map over s.items with no filter and are covered by the UI walkthrough. */
ok(
  systemItemsRev(freightSec) === 1728.57 && systemItemsCost(freightSec) === 1200,
  "#143 (D162) margin and cost count a freight-exempt vendor line exactly like a catalog line"
);

/* #143 re-review — `blobPath` reaches the server from the BROWSER (the upload
   route hands it back, the save carries it), so it is untrusted: unchecked, a
   crafted save would point a vendor quote at any object in the private Blob
   store and the authenticated download proxy would stream it. Both the save
   action and the proxy gate on ownsVendorQuoteBlobPath, so these cases pin the
   whole guard. The last two matter most and are the easiest to regress: a
   prefix that merely STARTS with "vendor-quotes" is not inside it, and an id
   that is a prefix of another id must not borrow its file. */
const blobPathCases: [string, string | null, string, boolean][] = [
  ["upload route shape", "vendor-quotes/vqabc123-quote.pdf", "vqabc123", true],
  ["save action shape", "vendor-quotes/Q-2044/vqabc123-quote.pdf", "vqabc123", true],
  ["another module's store", "recordings/2026-09-22/meeting.m4a", "vqabc123", false],
  ["a grid plan sheet", "grid_sheets/GRD-5001/plan.pdf", "vqabc123", false],
  ["a parent-dir escape", "vendor-quotes/../recordings/meeting.m4a", "vqabc123", false],
  ["a deeper walk", "vendor-quotes/a/b/vqabc123-quote.pdf", "vqabc123", false],
  ["another vendor quote's file", "vendor-quotes/vqother99-quote.pdf", "vqabc123", false],
  ["a look-alike prefix", "vendor-quotes-evil/vqabc123-quote.pdf", "vqabc123", false],
  ["no path", "", "vqabc123", false],
  ["a null path", null, "vqabc123", false],
  ["no record id", "vendor-quotes/vqabc123-quote.pdf", "", false],
  ["an id that is a prefix of another", "vendor-quotes/vqabc1234-quote.pdf", "vqabc123", false],
];
ok(
  blobPathCases.every(([, path, id, want]) => ownsVendorQuoteBlobPath(path, id) === want),
  "#143 a vendor quote may claim only its own file under the vendor-quotes prefix"
);

/* --- #144 (D163): editing a stored vendor quote ---

   Two pure rules carry the whole feature's money, and both are easy to regress
   into something that looks right in the form and writes something else.

   1. repricedAtLineMargin — an edited quote's new total reprices the line at
      the margin it is ALREADY carrying, not the tier seed. The user may have
      dragged the system margin slider or typed a sell price since the quote was
      added; re-seeding would silently undo that. The vendor form's "Sell" stat
      is handed the same margin (vendorFormMargin, estimator-client.tsx), so
      these cases also pin the stat against the number the save commits.
   2. vendorTotalSeed — a quote whose total came from its material lines must
      still come from them after an edit, or the line a vendor's revision adds
      rides in the itemized breakdown without being in the price. */
ok(
  repricedAtLineMargin(10000, 16666.67, 10000, 0.3) === 16666.67,
  "#144 an unchanged cost leaves the line's price untouched, to the cent"
);
// A 40% line (the slider's doing) stays 40% when the vendor's total moves.
ok(
  repricedAtLineMargin(10000, 16666.67, 12000, 0.3) === 20000 &&
    Math.abs((lineMarginOf(10000, 16666.67) ?? 0) - 0.4) < 1e-6,
  "#144 a line dragged to 40% is repriced at 40%, not re-seeded from the tier"
);
/* The regression this exists to catch: the tier seed would write 12000/0.7 =
   $17,142.86 over a line the user had set to 40% — $2,857 of margin gone with
   no control touched. */
ok(
  repricedAtLineMargin(10000, 16666.67, 12000, 0.3) !== round2(12000 / 0.7),
  "#144 the tier seed is NOT what an edited line reprices at"
);
ok(
  repricedAtLineMargin(10000, 18181.82, 12000, 0.3) === 21818.18,
  "#144 a 45% line reprices at 45% (the all-systems slider's margin survives an edit)"
);
/* The Sell stat and the commit read the same margin, so the form can never
   quote a price the save does not write (#144 re-review). */
const statMargin = lineMarginOf(10000, 18181.82) ?? 0.3;
ok(
  round2(12000 / (1 - statMargin)) === repricedAtLineMargin(10000, 18181.82, 12000, 0.3),
  "#144 the form's Sell stat and the saved price come out of one margin"
);
// No usable margin on the line — a $0 sell, or a $0 cost whose margin is
// exactly 1 and would divide by zero — falls back to the seed rule.
ok(lineMarginOf(1000, 0) === null && lineMarginOf(0, 500) === null, "#144 a $0 price and a $0 cost carry no rescalable margin");
ok(
  repricedAtLineMargin(1000, 0, 2000, 0.3) === 2857.14 &&
    repricedAtLineMargin(0, 500, 2000, 0.3) === 2857.14,
  "#144 a line with no usable margin reprices at the tier-else-30% seed"
);
// A line hand-priced BELOW its cost is carrying a real, if unhappy, margin:
// preserved (100/50 is half cost, so $200 of cost stays $100 of sell), never
// quietly corrected up to the seed.
ok(repricedAtLineMargin(100, 50, 200, 0.3) === 100, "#144 a line priced below its cost keeps that ratio");
// A nonsense seed cannot reach the division either.
ok(
  repricedAtLineMargin(1000, 0, 2000, 1) === 2857.14 && repricedAtLineMargin(1000, 0, 2000, 0) === 2857.14,
  "#144 an out-of-range seed margin falls back to 30% rather than dividing by zero"
);
const repriceGrid: [number, number, number, number][] = [
  [0, 0, 0, 0.3], [0, 0, 1000, 0.3], [-100, -50, 500, 0.3], [1000, 1000, 2000, 0.3],
  [1000, 1e9, 2000, 0.3], [1000, 500, 0, 0.3], [1000, 2000, -500, 0.3], [0.01, 0.02, 0.03, 0.3],
];
ok(
  repriceGrid.every(([c, p, nc, s]) => Number.isFinite(repricedAtLineMargin(c, p, nc, s))),
  "#144 repricing never emits NaN or Infinity, whatever the line carries"
);
ok(
  vendorTotalSeed(3000, 3000) === "" && vendorTotalSeed(12450, 12450) === "",
  "#144 a quote priced off its material lines seeds a BLANK total, so the lines still drive it"
);
ok(
  vendorTotalSeed(12450, 13450) === "12450" && vendorTotalSeed(3000, 0) === "3000",
  "#144 a total that genuinely disagrees with its lines round-trips as typed"
);

/* #146 (D173) — the plan-sheet upload cap must stay an HONEST number. It was
   not: the server action advertised 8 MB while next.config.ts's 1200kb
   `serverActions.bodySizeLimit` and base64's 4/3 inflation put the real
   ceiling near 900 kB, so an over-limit sheet had its whole request body
   rejected by Next before the action ran — an unhandled rejection in place of
   the action's own sentence. The upload is a route handler now, which carries
   no such cap, but a route on Vercel still cannot receive a body over ~4.5 MB.
   These pin both ends: the number must clear the old server-action ceiling by
   a wide margin (or the move bought nothing) and must sit under the platform
   ceiling with envelope room (or it is the same lie one layer up). */
const SERVER_ACTION_BODY_LIMIT = 1200 * 1024;
const VERCEL_FUNCTION_BODY_LIMIT = 4.5 * 1024 * 1024;
ok(
  GRID_SHEET_MAX_BYTES > SERVER_ACTION_BODY_LIMIT * 3 &&
    GRID_SHEET_MAX_BYTES + 64 * 1024 < VERCEL_FUNCTION_BODY_LIMIT,
  "#146 the plan-sheet cap clears the old server-action limit and stays under the function body limit"
);
ok(
  GRID_SHEET_MAX_LABEL === `${GRID_SHEET_MAX_BYTES / (1024 * 1024)} MB`,
  "#146 the cap the picker advertises is the cap the route enforces"
);

/* A sheet is streamed back INLINE under its stored mime with no
   content-disposition (the editor paints it as a canvas background), so an
   accepted `image/svg+xml` would run its own script in the app's origin
   against the signed-in session. The vendor-quote proxy escapes this by
   forcing `attachment`; a background image cannot, so the refusal has to live
   at upload time. The parameter and uppercase rows are the easy regressions —
   a browser may hand over `image/svg+xml; charset=utf-8`. */
const sheetMimeCases: [string, string, "ok" | "svg" | "other"][] = [
  ["a printed drawing", "application/pdf", "ok"],
  ["a scan", "image/png", "ok"],
  ["a photo of the plan", "image/jpeg", "ok"],
  ["a mime with parameters", "image/png; charset=binary", "ok"],
  ["an uppercase mime", "APPLICATION/PDF", "ok"],
  ["a scriptable vector", "image/svg+xml", "svg"],
  ["a vector with parameters", "image/svg+xml; charset=utf-8", "svg"],
  ["the short svg spelling", "image/svg", "svg"],
  ["a page", "text/html", "other"],
  ["a CAD file", "application/acad", "other"],
  ["a mime that merely starts with pdf", "application/pdfx", "other"],
  ["no mime at all", "", "other"],
  ["the unknown-type default", "application/octet-stream", "other"],
];
ok(
  sheetMimeCases.every(([, mime, want]) => sheetMimeVerdict(mime) === want),
  "#146 plan sheets accept PDFs and raster images, never a scriptable SVG"
);
ok(
  sheetMimeCases.every(([, mime, want]) => isAllowedSheetMime(mime) === (want === "ok")),
  "#146 isAllowedSheetMime agrees with the verdict it wraps"
);

/* D173's other half: unlike the vendor-quote route, the plan-sheet route
   writes the grid_sheets doc itself and returns only a sheet id, so no
   `blobPath` ever round-trips through the browser and the sheet proxy keeps
   reading a value only the server wrote. Source-level like the sw.js contract
   below, because the property being protected is "this value never crosses
   the wire" — which no unit test of a pure function can observe. */
const gridUploadRoute = readFileSync(
  join(process.cwd(), "src/app/api/grid-sheets/upload/route.ts"),
  "utf8"
);
const gridEditorSource = readFileSync(
  join(process.cwd(), "src/app/(app)/design/grid/[id]/editor.tsx"),
  "utf8"
);
ok(
  !/NextResponse\.json\(\s*\{[^}]*blobPath/.test(gridUploadRoute),
  "#146 the plan-sheet upload route never hands a blobPath back to the browser"
);
ok(
  !gridEditorSource.includes("blobPath") && !gridEditorSource.includes("addSheetAction"),
  "#146 the editor uploads through the route and never names a stored path"
);
ok(
  gridUploadRoute.includes('req.headers.get("content-length")'),
  "#146 an oversize plan sheet is refused before its body is read into memory"
);

/* --- Offline navigation contract --- */
const serviceWorkerSource = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
ok(serviceWorkerSource.includes('req.mode === "navigate"'), "offline cache treats document navigation separately");
ok(serviceWorkerSource.includes('caches.match("/offline.html")'), "an uncached offline route gets an explicit back-capable fallback");
ok(!serviceWorkerSource.includes('caches.match("/") ||'), "an uncached route never masquerades as the dashboard");
ok(serviceWorkerSource.includes('url.searchParams.has("_rsc")'), "RSC payloads cannot overwrite cached HTML pages");
ok(serviceWorkerSource.includes('event.data.type !== "CACHE_ROUTE"'), "client-side navigations can snapshot their rendered route for offline reload");

/* --- Fixture assemblies --- */
const fixtureAssemblies = resolveFixtureAssemblies(
  [{ id: "fa-test", name: "House fixture", components: [
    { sku: "BODY-1", label: "Light engine", role: "fixture", defaultQty: 1 },
    { sku: "CABLE-1", label: "25 ft power cable", role: "cable", defaultQty: 0 },
    { sku: "SAFE-1", label: "Safety", role: "accessory", defaultQty: 1 },
  ] }],
  [
    { sku: "BODY-1", desc: "Fixture body", unit: "ea", cost: 100, list: 150 },
    { sku: "CABLE-1", desc: "Cable", unit: "ea", cost: 10, list: 20 },
    { sku: "SAFE-1", desc: "Safety cable", unit: "ea", cost: 5, list: 8 },
  ] as any
);
ok(fixtureAssemblies[0].components.length === 3, "assembly keeps zero-default components as selectable options");
ok(assemblyUnitTotals(fixtureAssemblies[0]).sell === 158, "assembly totals include only positive default quantities");
ok(
  assemblyDescription(fixtureAssemblies[0]) === "House fixture — Light engine; Safety",
  "assembly description uses the assembly name and user-defined component labels"
);

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

/* --- #159 gate review FIX 2: interchangeable connector families --- */
// The shapes shipped by #159 do not compose under exact equality: amplifiers
// emit speakON NL4 OUT, passive cabinets present speakON NL2 IN, 70V devices
// present a 70V pair IN. Nothing in the catalog could drive a ported speaker
// (854 of 1,390 proposals affected), and it was a regression — both sides
// portless meant the Grid allowed the route. `speaker-pair` is flagged
// `interchangeable`; every other wire type is NOT, deliberately.
ok(canConnect(portOut("speakON NL4"), portIn("speakON NL2")), "connect: an NL4 out connects to an NL2 in — the speaker family interoperates");
ok(canConnect(portOut("speakON NL4"), portIn("70V pair")), "connect: a 70V pair in accepts an NL4 out");
ok(canConnect(portOut("speakON NL8"), portIn("speakON NL2")), "connect: NL8 out to NL2 in connects — the whole speaker family, not a pair of special cases");
ok(!canConnect(portOut("speakON NL4"), portOut("speakON NL2")), "connect: direction complement is still enforced INSIDE an interchangeable family (out->out refused)");
ok(!canConnect(portIn("speakON NL4"), portIn("70V pair")), "connect: in->in inside the speaker family is refused too");
ok(canConnect(portIo("speakON NL2"), portIn("speakON NL4")), "connect: io still connects across the speaker family");
// cat6 carries Dante audio AND HDBaseT video; powercon-power carries Edison
// AND Socapex. Those families describe what a cable carries, not what mates,
// and must never have become wireable.
ok(!canConnect(portOut("Dante/AES67 (Cat6)"), portIn("HDBaseT (Cat6a)")), "connect: Dante out does NOT reach an HDBaseT in — cat6 is not an interchangeable family");
ok(!canConnect(portOut("Edison"), portIn("Socapex")), "connect: Edison does NOT connect to Socapex — powercon-power is not an interchangeable family");
ok(!canConnect(portOut("motor power"), portIn("low-voltage pendant control")), "connect: motor power does NOT connect to low-voltage pendant control");
ok(
  DEFAULT_WIRE_TYPES.filter((wt) => wt.interchangeable).map((wt) => wt.id).join(",") === "speaker-pair",
  "connect: speaker-pair is the ONLY interchangeable family in the defaults"
);
// The registry is an optional defaulted parameter (lib/geo.ts driveMiles
// pattern), so a caller holding the admin-edited list gets that list's rules.
const noFamilies = DEFAULT_WIRE_TYPES.map((wt) => ({ id: wt.id, label: wt.label, connectionTypes: wt.connectionTypes }));
ok(!canConnect(portOut("speakON NL4"), portIn("speakON NL2"), noFamilies), "connect: an admin registry with no interchangeable family falls back to exact equality");
ok(canConnect(portOut("speakON NL4"), portIn("speakON NL4"), noFamilies), "connect: exact equality still connects under a custom registry");

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

/* --- #159 gate review FIX 2: validateDeviceWire across a family --- */
// A real amplifier (amplifierPorts → speakON NL4 out) against a real passive
// cabinet (passiveSpeakerPorts → speakON NL2 in).
const ampToSpeaker = validateDeviceWire(
  { ports: [portIn("XLR line/mic"), portOut("speakON NL4")] },
  { ports: [portIn("speakON NL2")] }
);
ok(ampToSpeaker.ok === true, "wire: an NL4 amplifier output validates against an NL2 passive cabinet input");
ok(
  ampToSpeaker.ok === true && ampToSpeaker.connectionType === "speakON NL4",
  "wire: a family match stamps the FROM/output side's connector (NL4), which is what the cable BOM prices"
);
const ampTo70v = validateDeviceWire({ ports: [portOut("speakON NL4")] }, { ports: [portIn("70V pair")] });
ok(ampTo70v.ok === true && ampTo70v.connectionType === "speakON NL4", "wire: a 70V pair input accepts an NL4 output, stamped NL4");
const danteToHdbaset = validateDeviceWire({ ports: [portOut("Dante/AES67 (Cat6)")] }, { ports: [portIn("HDBaseT (Cat6a)")] });
ok(danteToHdbaset.ok === false, "wire: Dante audio out to HDBaseT video in is still refused (cat6 is not interchangeable)");
const twoAmps = validateDeviceWire({ ports: [portOut("speakON NL4")] }, { ports: [portOut("speakON NL2")] });
ok(twoAmps.ok === false, "wire: two outputs in the same family are still refused");


/* --- #158 Task 1: catalog-ports parse/validate/serialize --- */
import { parsePortsField, serializePorts, PORT_DIRECTIONS } from "@/lib/catalog-ports";

const pOk = parsePortsField(JSON.stringify([{ name: "DMX In", direction: "in", connectionType: "DMX512 (5-pin XLR)" }]));
ok(pOk.ok === true, "ports: a well-formed row parses");
if (pOk.ok) ok(pOk.ports[0].connectionType === "DMX512 (5-pin XLR)", "ports: connectionType survives the round trip");
if (pOk.ok) ok(pOk.ports[0].count === undefined, "ports: an omitted count stays undefined (1 is implicit)");

const pEmpty = parsePortsField("[]");
ok(pEmpty.ok === true && pEmpty.ports.length === 0, "ports: an empty array is valid and means 'no ports'");

const pBlank = parsePortsField("");
ok(pBlank.ok === true && pBlank.ports.length === 0, "ports: a blank field is an empty list, not an error");

const pBadType = parsePortsField(JSON.stringify([{ name: "x", direction: "in", connectionType: "DMX512 5 pin XLR" }]));
ok(pBadType.ok === false, "ports: a connectionType outside CONNECTION_TYPES is REFUSED");
if (!pBadType.ok) ok(pBadType.error.includes("DMX512 5 pin XLR"), "ports: the refusal names the offending connection type");

const pBadDir = parsePortsField(JSON.stringify([{ name: "x", direction: "sideways", connectionType: "HDMI" }]));
ok(pBadDir.ok === false, "ports: an unknown direction is refused");

const pBadCount = parsePortsField(JSON.stringify([{ name: "x", direction: "out", connectionType: "HDMI", count: 0 }]));
ok(pBadCount.ok === false, "ports: a count below 1 is refused");

const pCount = parsePortsField(JSON.stringify([{ name: "Dimmed Power Out", direction: "out", connectionType: "stage pin", count: 12 }]));
ok(pCount.ok === true && pCount.ports[0].count === 12, "ports: a multi-port row keeps its count");

const pNotArray = parsePortsField(JSON.stringify({ name: "x" }));
ok(pNotArray.ok === false, "ports: a non-array payload is refused");

const pGarbage = parsePortsField("{not json");
ok(pGarbage.ok === false, "ports: unparseable JSON is refused, never silently dropped");

const pNoName = parsePortsField(JSON.stringify([{ direction: "io", connectionType: "RDM" }]));
ok(pNoName.ok === true && pNoName.ports[0].name === "", "ports: a missing name defaults to empty, not a failure");

// A genuine duplicate (same name + direction + connectionType) is refused —
// the Grid's device inspector keys its port list on
// `${port.name}-${port.connectionType}`, so a duplicate would collide there.
const pDup = parsePortsField(JSON.stringify([
  { name: "Audio in", direction: "in", connectionType: "speakON NL4" },
  { name: "Audio in", direction: "in", connectionType: "speakON NL4" },
]));
ok(pDup.ok === false, "ports: a duplicate name/direction/connectionType row is refused");
if (!pDup.ok) ok(pDup.error.includes("Audio in"), "ports: the duplicate refusal names the offending port");

// ...but two rows differing only in direction describe two distinct jacks
// on the same connector family, which is a normal, legal device.
const pSameNameDiffDir = parsePortsField(JSON.stringify([
  { name: "Link", direction: "in", connectionType: "speakON NL4" },
  { name: "Link", direction: "out", connectionType: "speakON NL4" },
]));
ok(
  pSameNameDiffDir.ok === true && pSameNameDiffDir.ports.length === 2,
  "ports: two rows differing only in direction are still allowed"
);

ok(
  serializePorts([{ name: "A", direction: "in", connectionType: "HDMI" }]) === '[{"name":"A","direction":"in","connectionType":"HDMI"}]',
  "ports: serializePorts emits compact JSON with a stable key order"
);
ok(PORT_DIRECTIONS.length === 3, "ports: three directions are offered (in/out/io)");

/* --- #159 Task 1: shared port shapes --- */
import * as Shapes from "@/lib/catalog-port-shapes";

ok(Shapes.passiveSpeakerPorts()[0].connectionType === "speakON NL2", "shapes: a passive speaker takes one speakON NL2 in");
ok(Shapes.passiveSpeakerPorts()[0].direction === "in", "shapes: a passive speaker's audio port is an input");
ok(Shapes.dimmerRackPorts(12)[2].count === 12, "shapes: dimmerRackPorts carries its output count");
ok(Shapes.matrixPorts(4, 4)[1].connectionType === "HDBaseT (Cat6a)", "shapes: matrixPorts defaults its output to HDBaseT");
ok(Shapes.matrixPorts(4, 4, "HDMI")[1].connectionType === "HDMI", "shapes: matrixPorts honours an HDMI output override");
ok(Shapes.mechanicalPorts().length === 0, "shapes: a mechanical part has no ports");

// The guard that matters: a shape emitting a connectionType outside the
// vocabulary would make every part it touches silently unwireable.
const connSet = new Set(CONNECTION_TYPES);
const badShape = Object.entries(Shapes.ALL_SHAPES).find(([, make]) =>
  make().some((prt) => !connSet.has(prt.connectionType))
);
ok(!badShape, `shapes: every shape emits only known connection types${badShape ? ` (offender: ${badShape[0]})` : ""}`);

/* --- #159 Task 2: the rule matcher --- */
import { matchRule, proposeForPart, type PortRule, type RulePart } from "@/lib/catalog-port-rules";

const rpart = (desc: string, extra: Partial<RulePart> = {}): RulePart =>
  ({ sku: "X:1", desc, category: "Audio", mfr: "EAW", ...extra });

const testRules: PortRule[] = [
  { id: "acc", desc: /\b(bracket|cover)\b/i, accessory: true, shape: () => [], note: "accessory" },
  { id: "passive", mfr: "EAW", desc: /passive.*(sub|speaker)/i, shape: () => Shapes.passiveSpeakerPorts(), note: "passive box" },
  { id: "any-speaker", desc: /speaker/i, shape: () => Shapes.poweredSpeakerPorts(), note: "fallback" },
];

ok(matchRule(rpart("Passive 18\" Subwoofer"), testRules)?.id === "passive", "rules: the first matching rule wins");
ok(matchRule(rpart("Powered speaker"), testRules)?.id === "any-speaker", "rules: a later rule matches when earlier ones do not");
ok(matchRule(rpart("Mounting bracket for speaker"), testRules)?.id === "acc", "rules: the accessory layer beats a device rule");
ok(matchRule(rpart("Passive Speaker", { mfr: "RCF" }), testRules)?.id === "any-speaker", "rules: an mfr-scoped rule does not match another brand");
ok(matchRule(rpart("Widget"), testRules) === null, "rules: an unmatched part yields null, never a guess");

const acc = proposeForPart(rpart("Mounting bracket for speaker"), testRules);
ok(acc === null, "rules: an accessory proposes no ports");
const prop = proposeForPart(rpart("Passive 18\" Subwoofer"), testRules);
ok(prop?.ports[0].connectionType === "speakON NL2", "rules: a device match proposes its shape's ports");
ok(prop?.rule.id === "passive", "rules: the proposal names the rule that produced it, for the report");

const excl: PortRule[] = [
  { id: "sub-only", desc: /subwoofer/i, exclude: /passive/i, shape: () => Shapes.poweredSpeakerPorts(), note: "powered subs" },
];
ok(matchRule(rpart("Passive 18\" Subwoofer"), excl) === null, "rules: exclude suppresses an otherwise-matching rule");
ok(matchRule(rpart("Powered 18\" Subwoofer"), excl)?.id === "sub-only", "rules: exclude does not suppress a non-matching description");

const catRule: PortRule[] = [
  { id: "sb", category: /^SB$/, desc: /./, shape: () => Shapes.passiveSpeakerPorts(), note: "EAW SB line" },
];
ok(matchRule(rpart("anything", { category: "SB" }), catRule)?.id === "sb", "rules: a category pattern matches");
ok(matchRule(rpart("anything", { category: "Audio" }), catRule) === null, "rules: a category pattern that misses blocks the rule");

/* --- #159 Task 3: the shipped rule set --- */
import { PORT_RULES } from "@/lib/catalog-port-rules";

// Task 1 review follow-up: lock in the three new shapes' port names, directions
// and counts — previously only their connectionTypes were checked.
const amp4 = Shapes.amplifierPorts(4);
ok(amp4.find((p) => p.name === "Line In")?.direction === "in", "shapes: an amplifier's line input is an input");
ok(amp4.find((p) => p.name === "Speaker Out")?.direction === "out", "shapes: an amplifier's speaker output is an output");
ok(amp4.find((p) => p.name === "Speaker Out")?.count === 4, "shapes: an amplifier carries its channel count");
const rx2 = Shapes.wirelessReceiverPorts(2);
ok(rx2.find((p) => p.name === "Audio Out")?.direction === "out", "shapes: a wireless receiver's audio port is an output");
ok(rx2.find((p) => p.name === "Audio Out")?.count === 2, "shapes: a wireless receiver carries its channel count");
const dsp = Shapes.dspPorts(8, 8);
ok(dsp.find((p) => p.name === "Analog In")?.direction === "in" && dsp.find((p) => p.name === "Analog Out")?.direction === "out",
  "shapes: a DSP has analog in and analog out in the right directions");

ok(PORT_RULES.length > 0, "ruleset: rules are defined");
ok(PORT_RULES.filter((r) => r.accessory).length > 0, "ruleset: an accessory layer exists");
ok(PORT_RULES.findIndex((r) => r.accessory) < PORT_RULES.findIndex((r) => !r.accessory),
  "ruleset: the accessory layer is ordered BEFORE device rules, so a bracket never gets device ports");
ok(new Set(PORT_RULES.map((r) => r.id)).size === PORT_RULES.length, "ruleset: rule ids are unique");
ok(PORT_RULES.every((r) => r.note.trim().length > 10), "ruleset: every rule carries a real note for review");

// The vocabulary guard again, at the rule level this time.
const rConn = new Set(CONNECTION_TYPES);
const badRule = PORT_RULES.filter((r) => !r.accessory).find((r) =>
  r.shape({ sku: "T:1", desc: "4 Channel", category: "Audio", mfr: r.mfr }).some((prt) => !rConn.has(prt.connectionType))
);
ok(!badRule, `ruleset: every rule emits only known connection types${badRule ? ` (offender: ${badRule.id})` : ""}`);

// A bracket must never reach a device rule.
ok(matchRule({ sku: "RCF:X", desc: "Horizontal Bracket for MR50", category: "Audio", mfr: "RCF" })?.accessory === true,
  "ruleset: a real bracket description matches the accessory layer");
ok(matchRule({ sku: "EAW:SB1002", desc: 'Passive 18" Installation Subwoofer. Black', category: "SB", mfr: "EAW" })?.accessory !== true,
  "ruleset: a real passive subwoofer description does NOT match the accessory layer");

ok(matchRule({ sku: "QSC:X", desc: "RU 4 Channel ENERGY STAR amplifier", category: "Audio", mfr: "QSC" })?.id === "amplifier",
  "ruleset: a real QSC amplifier description matches the amplifier rule");
const ampProp = proposeForPart({ sku: "QSC:X", desc: "RU 4 Channel ENERGY STAR amplifier", category: "Audio", mfr: "QSC" });
ok(ampProp?.ports.find((prt) => prt.name === "Speaker Out")?.count === 4,
  "ruleset: the amplifier rule reads its channel count from the description");
const mtx = proposeForPart({ sku: "AV:X", desc: "8x8 HDBaseT Matrix Switcher", category: "AV Distribution", mfr: "AVPro Edge" });
ok(mtx?.ports[0].count === 8 && mtx?.ports[1].count === 8, "ruleset: a matrix reads NxM from the description");

/* ---- real-data fixes (#159 Task 3 review of scripts/*.tsv dumped from the
   live catalog, D198) — each of these is a description sampled verbatim from
   the real dev DB that the brief's draft rule set got wrong. See
   task-3-report.md for the full account. ---- */

// A passive RCF speaker that is ALSO 70V/100V-transformer-tapped must get the
// 70V pair shape, not speakON — the draft order (passive before 70V) silently
// mis-wired ~42 real EAW/RCF SKUs to the wrong connector.
ok(proposeForPart({
  sku: "RCF:X", mfr: "RCF", category: "BUSINESS AUDIO WALL MOUNTED SPEAKERS - PASSIVE",
  desc: 'Passive 160W 5" 2-Way Wall Mount Monitor Speaker w/ Transformer - 8 Ω, 70/100V',
})?.rule.id === "speaker-70v",
  "ruleset: a passive speaker that is also 70V-transformer-tapped gets the 70V shape, not speakON");

// "loudspeaker" is one token, not "speaker" preceded by "loud" — the draft's
// \bspeaker\b missed all 44 real QSC/EAW/Shure SKUs that use this word.
ok(proposeForPart({
  sku: "EAW:X", mfr: "EAW", category: "RSX",
  desc: "8\" Powered Loudspeaker. Horz: 90˚ Vert: 60˚. Dante. Black.",
})?.rule.id === "speaker-powered",
  "ruleset: 'Powered Loudspeaker' matches the powered-speaker rule, not just 'Powered Speaker'");

// AVPro Edge's "AV Distribution" catalog uses "processor" for video-wall and
// remote-control gear, and QSC sells bare "Q-SYS Core ... Software License"
// SKUs under category Audio — neither is a physical fixed-I/O audio DSP.
ok(matchRule({
  sku: "AV:X", mfr: "AVPro Edge", category: "AV Distribution",
  desc: "8K HDR 2x2 scaling video wall processor featuring VRR",
})?.id !== "dsp",
  "ruleset: an AV-Distribution video-wall processor does not match the audio DSP rule");
ok(matchRule({
  sku: "QSC:X", mfr: "QSC", category: "Audio",
  desc: "Q-SYS Core 110 Scripting Engine Software License, Perpetual.",
})?.id !== "dsp",
  "ruleset: a Q-SYS Core software license is not a physical DSP");

// Shure gooseneck mics routinely mention a status "LED" or "LED Indicator" —
// without a manufacturer scope this shipped every one of them as a lighting
// fixture. Chauvet Professional is the only lighting brand in scope.
ok(matchRule({
  sku: "SHU:X", mfr: "Shure", category: "Audio",
  desc: "Cardioid-12\" Gooseneck Condenser Microphone, Attached Preamp with XLR, Shock Mount, Flange Mount, Snap-Fit Foam Windscreen, Mute Switch, LED Indicator",
})?.id !== "fixture-led",
  "ruleset: a microphone's status LED does not make it a lighting fixture");

// RCF's install amplifiers/mixer-amps list 70/100V outputs in their own spec —
// those must stay amplifiers, not get reinterpreted as a passive 70V speaker
// INPUT.
ok(matchRule({
  sku: "RCF:X", mfr: "RCF", category: "POWER AMPLIFIERS",
  desc: "Class D Power Amplifier with Dual Input per Channel - 4 Ω, 70/100V, 2 x 250W",
})?.id === "amplifier",
  "ruleset: a 70V-capable power amplifier matches the amplifier rule, not speaker-70v");

// QSC ceiling/surface 70V speakers routinely describe their OWN bundled
// mounting hardware ("blind mount installation", "includes yoke mount") —
// the bare accessory keyword "mount" swallowed ~100 real speaker SKUs.
ok(proposeForPart({
  sku: "QSC:X", mfr: "QSC", category: "Audio",
  desc: "6.5\" Two-way ceiling speaker, 70/100V transformer with 8Ω bypass, 110° conical coverage, includes C-ring and rails for blind mount installation.",
})?.rule.id === "speaker-70v",
  "ruleset: a ceiling speaker describing its own mount hardware is not swallowed by the accessory layer");

/* ---- #159 rule-set review fixes (D199) — every description below is
   verbatim from the live catalog and was measured wrong before the fix. See
   .superpowers/sdd/rule-fix-report.md for the before/after counts. ---- */

import { channelCount, portCount } from "@/lib/catalog-port-rules";

// C1: the bare token "amp" is not the word "amplifier". 61 passive EAW/QSC/
// Fulcrum speakers say "Bi-Amp"/"Tri-amp"/"amp channels" and were being wired
// as amplifiers — one speakON NL2 INPUT turned into four speakON NL4 OUTPUTS.
const biAmp = proposeForPart({
  sku: "EAW:2039611", mfr: "EAW", category: "QX",
  desc: 'Passive 12" 3-Way Bi-Amp Speaker. 4 x 12" LF, 1 x 2" Exit 3.5" Voice Coil MF and 1 x 2" Exit 1.75" HF. Horz: 90˚ Vert: 60˚. Black',
});
ok(biAmp?.rule.id === "speaker-passive",
  "ruleset: a passive speaker that mentions bi-amping is still a passive speaker");
ok(biAmp?.ports.length === 1 && biAmp.ports[0].direction === "in" && biAmp.ports[0].connectionType === "speakON NL2",
  "ruleset: that bi-amp passive speaker gets one speakON NL2 input, not amplifier outputs");
ok(matchRule({ sku: "AV:X", mfr: "AVPro Edge", category: "AV Distribution", desc: "PS16-1, KX2, KX7 16 VCD 1 Amp Power Supply" }) === null,
  "ruleset: \"1 Amp Power Supply\" is amperes, not an amplifier");

// C3: QSC's CX/ISA power amps never use the word "amplifier" — they were
// given a 70V speaker INPUT, backwards for a device that drives the line.
const cx108v = proposeForPart({
  sku: "QSC:CX108V", mfr: "QSC", category: "Audio",
  desc: "8 channels, 100 watts/ch at 70V.",
});
ok(cx108v?.rule.id === "amplifier",
  "ruleset: \"8 channels, 100 watts/ch at 70V.\" is a power amplifier, not a 70V speaker");
ok(cx108v?.ports.find((prt) => prt.name === "Speaker Out")?.count === 8,
  "ruleset: that power amp's channel count comes from its spec line");

// C2: a device that lists its own bundled hardware is not an accessory.
ok(proposeForPart({
  sku: "AV:X", mfr: "AVPro Edge", category: "AV Distribution",
  desc: "Four Channel Dual Mode 70 Volt DSP Amplifier with Dante; includes rack mount",
})?.rule.id === "amplifier",
  "ruleset: an amplifier that includes a rack mount is an amplifier, not an accessory");
ok(matchRule({
  sku: "QSC:12x", mfr: "QSC", category: "Audio",
  desc: "Optical Zoom 80° Horizontal Field of View, PTZ Network Camera, PoE, with HDMI and SDI output. Includes PTZ-WMB1 wall mount bracket",
})?.id === "camera-ptz",
  "ruleset: a PTZ camera that bundles its own wall bracket is still a camera");
ok(matchRule({
  sku: "SHU:X", mfr: "Shure", category: "Audio",
  desc: "Four--channel receiver. Includes AD4Q, locking power and jumper cables, BNC bulkhead adapter, coaxial antenna, BNC cable assemblies, BNC cable, Ethernet cables, rackmount hardware",
})?.id === "wireless-receiver",
  "ruleset: a rack receiver whose box contains cables and an antenna is still a receiver");

// I4: the other side of the same coin — an accessory FOR a speaker is an
// accessory, and must stay out of the coverage-gap report (D195).
for (const [desc, mfr, cat] of [
  ["Cluster Bracket for P4228/P5228 (Connects (2) Speakers)", "RCF", "Audio"],
  ["Caster Wheel for Subwoofer", "EAW", "RS"],
  ["Soft padded cover for the KLA181 Subwoofer", "QSC", "Audio"],
  ["STRIKE Array Flush Bracket", "Chauvet Professional", "STRIKE Series Accessories"],
] as const) {
  ok(matchRule({ sku: "T:1", desc, category: cat, mfr })?.accessory === true,
    `ruleset: "${desc.slice(0, 40)}" is an accessory for a speaker, not a speaker`);
}

// I1: an RX-only half must not get the TX+RX kit shape — both directions
// would be inverted — and there is no receive-only shape to invent.
ok(matchRule({
  sku: "AV:X", mfr: "AVPro Edge", category: "AV Distribution",
  desc: "HDBaseT (CAT6) RECEIVER ONLY. ICT 18G, 70m 4K (100m HD) Slim Extender with I-Pass, Bi-Directional Power, RS232, IR - ICT for full HDR/HDMI Pass-Through. Full HDR, 4K60 4:4:4.",
}) === null,
  "ruleset: a receive-only HDBaseT unit is left unmatched, not given an extender kit's ports");
ok(matchRule({ sku: "AV:X", mfr: "AVPro Edge", category: "AV Distribution", desc: "Power Supply for VIP-UHD-TX/RX (only required if not using PoE)" }) === null,
  "ruleset: a power supply for an extender is not an extender");
ok(matchRule({ sku: "AV:X", mfr: "AVPro Edge", category: "AV Distribution", desc: "2Ch Audio Extender" }) === null,
  "ruleset: an audio extender is not an HDMI extender");

// I2: a bare \bmatrix\b stole a wall-plate extender kit on a NEGATION, and
// gave audio matrices HDMI ports.
ok(matchRule({
  sku: "AV:X", mfr: "AVPro Edge", category: "AV Distribution",
  desc: "HDMI Single Gang Decora Style Wall Plate (White) HDBaseT Basic Extender Kit (70M HD 1080p) **These MUST be used as a kit – not for use as a transmitter or receiver for any matrix switch.**",
})?.id === "av-extender",
  "ruleset: \"not for use ... for any matrix switch\" does not make a part a matrix");
ok(matchRule({ sku: "AV:X", mfr: "AVPro Edge", category: "AV Distribution", desc: "Audio Distribution 16x16 DSP Matrix" }) === null,
  "ruleset: an audio matrix is not given HDMI ports");

// I5: `exclude` is only ever tested against desc, so a Chauvet accessory in an
// "… Series Accessories" category was getting DMX + powerCON regardless.
ok(matchRule({
  sku: "CHV:OVE2IRIS", mfr: "Chauvet Professional", category: "Ovation Series Accessories",
  desc: "Drop-in Iris: Ovation E-2 FC",
})?.id !== "fixture-led",
  "ruleset: a Chauvet accessory-category row is not an LED fixture");
ok(matchRule({
  sku: "CHV:F2X4", mfr: "Chauvet Professional", category: "F Series",
  desc: "F2 - SMD LED Video Panel 4-Pack",
})?.id !== "fixture-led",
  "ruleset: an SMD LED video panel is fed by a processor, not DMX + powerCON");

// I6: the distribution-amplifier branch was dead while `amplifier` ran first.
ok(matchRule({ sku: "AV:X", mfr: "AVPro Edge", category: "AV Distribution", desc: "48Gbps HDMI scaling distribution amplifier with one input, and four outputs" })?.id === "av-splitter",
  "ruleset: an HDMI distribution amplifier is a splitter, not an install amplifier");

// I7: the count helpers.
ok(portCount('2 x 15" Subwoofer', "in", 4) === 4 && portCount('2 x 15" Subwoofer', "out", 4) === 4,
  "ruleset: a driver complement (2 x 15\") is never read as a port count");
ok(portCount("40Gbps 8 HDMI input, 8 HDMI output 8K Matrix Switcher", "in", 4) === 8,
  "ruleset: \"N input ... N output\" prose is read as a port count");
ok(portCount("18Gbps HDMI 16x16 Matrix w/Audio Deembedding", "out", 4) === 16,
  "ruleset: an NxM is still read as a port count");
ok(channelCount("128 Channel Dante amplifier", 4) === 4,
  "ruleset: a 3-digit channel count falls back instead of reading its last two digits");
ok(channelCount("2U Sixteen Channel 100 Watt Amplifier", 4) === 16,
  "ruleset: a word-form channel count is parsed");
ok(proposeForPart({ sku: "SHU:X", mfr: "Shure", category: "Audio", desc: "Access Point/Charger/DSP - 2 Ch." })?.ports[0].count === 2,
  "ruleset: a DSP is sized from its stated channel count, not a hardcoded 8x8");

// FIX 1 (D200): isModelish now lives in catalog-port-apply.ts and is shared
// by the report and the apply path — locked here directly so the two can
// never drift back into separate copies.
import { isModelish } from "@/lib/catalog-port-apply";
ok(isModelish("", "EAW:SB1002") === true, "isModelish: an empty description is modelish");
ok(isModelish("2039611", "EAW:2039611") === true, "isModelish: a bare digit string is modelish");
ok(isModelish("SB 1002", "EAW:SB1002") === true, "isModelish: a spaced-out repeat of the bare SKU is still modelish");
ok(isModelish('Passive 18" Installation Subwoofer. Black', "EAW:SB1002") === false,
  "isModelish: real prose is not modelish");

// M1/M2/M4: the negation and RF traps.
ok(matchRule({ sku: "SHU:UA860V", mfr: "Shure", category: "Audio", desc: "Passive Omnidirectional Antenna" })?.id !== "speaker-passive",
  "ruleset: a passive RF antenna is not a passive speaker");
ok(matchRule({ sku: "QSC:X", mfr: "QSC", category: "Audio", desc: '6.5" Two-way surface speaker, 16Ω (no transformer) , 105° conical DMT™ coverage, includes X-Mount™ and weather input cup. Color - Black.' })?.id !== "speaker-70v",
  "ruleset: \"(no transformer)\" does not make a speaker a 70V speaker");
ok(matchRule({ sku: "QSC:X", mfr: "QSC", category: "Audio", desc: '4" Full-range, low-profile ceiling-mount network loudspeaker, PoE/PoE+ powered. Includes C-ring and tile rails. Color - White.' })?.id !== "speaker-powered",
  "ruleset: a PoE-powered network loudspeaker is not given a mains inlet");

/* ---- gate review fix (D200) — speaker-70v regression ----
   The D199 fix correctly stopped evicting genuine passive speakers that
   mention "Bi-Amp"/"Tri-amp" from speaker-passive by dropping the bare
   token "amp" from its exclude — but the same change was also made to
   speaker-70v's exclude, where "amp" was doing real work. Shure's MXN-AMP
   never says the word "amplifier"; it was matching speaker-70v and getting
   a 70V speaker INPUT for a device that drives the line. Restoring the bare
   "amp" guard on speaker-70v only (not speaker-passive) fixes this without
   reopening the bi-amp regression: nothing 70V-tapped in the live catalog
   uses "amp" as part of a compound word like "Bi-Amp". */
ok(matchRule({
  sku: "Shure:MXN-AMP", mfr: "Shure", category: "Audio",
  desc: "NETWORKED DANTE LOW IMP/70V POE+ AMP",
})?.id !== "speaker-70v",
  "ruleset: a networked amplifier described only as '...POE+ AMP' does not get a 70V speaker input");

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
ok(designRedirect("/design-studio/steel", {}) === "/knowledge/steel",
  "calculators keep their leaf name — and follow the #136 move to Knowledge in ONE hop");
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
ok(designRedirect("/design/subassemblies", {}) === "/design/assemblies?tab=subassemblies",
  "#130 /design/subassemblies redirects to the Subassemblies tab of the Assembly Builder");

/* --- design module nav (D97) --- */
import { activeKeyFor, NAV, parentGroupOf } from "@/components/nav/nav-data";

ok(activeKeyFor("/design") === "designoverview",
  "the Design overview resolves to the designoverview key");
ok(activeKeyFor("/design/engagements") === "designoverview",
  "/design/engagements resolves to the designoverview key");
ok(activeKeyFor("/design/lineset") === "designoverview",
  "/design/lineset resolves to the designoverview key (segment-1 matching)");
ok(activeKeyFor("/design/assemblies") === "assemblies",
  "#130 /design/assemblies lights the Assembly Builder child");
ok(activeKeyFor("/design/subassemblies") === "assemblies",
  "#130 the old Subassemblies path lights the Assembly Builder child too");
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
/* "grid" left when The Grid became a layout mode of Designs rather than a
 * tool of its own (D-grid-merge): the "designs" child is now labelled "The
 * Grid" and the standalone index it pointed at is gone. "steel" and
 * "fixtures" moved to the KNOWLEDGE group (#136). */
/* "subassemblies" left the group when it became a tab of the Assembly
 * Builder (#130) — /design/subassemblies redirects there. */
const DESIGN_CHILDREN = [
  "designoverview", "engagements", "designs",
  "lineset", "assemblies", "motors",
];
ok(
  !!designGroup && designGroup.kind === "group" &&
    JSON.stringify(designGroup.children.map((c) => c.key)) === JSON.stringify(DESIGN_CHILDREN),
  `Design's children are exactly [${DESIGN_CHILDREN.join(", ")}]`);

/* --- Knowledge & Information tab (#136) --- */
ok(designRedirect("/design/steel", {}) === "/knowledge/steel",
  "#136: /design/steel redirects to /knowledge/steel");
ok(designRedirect("/design/fixtures", {}) === "/knowledge/fixtures",
  "#136: /design/fixtures redirects to /knowledge/fixtures");
ok(designRedirect("/design/lineset", {}) === null,
  "#136: the other Design tools are NOT redirected");
const knowledgeGroup = NAV.find((e) => e.kind === "group" && e.key === "knowledge");
const KNOWLEDGE_CHILDREN = ["knowledgeoverview", "steel", "fixtures"];
ok(
  !!knowledgeGroup && knowledgeGroup.kind === "group" &&
    JSON.stringify(knowledgeGroup.children.map((c) => c.key)) === JSON.stringify(KNOWLEDGE_CHILDREN),
  `#136: KNOWLEDGE's children are exactly [${KNOWLEDGE_CHILDREN.join(", ")}]`);
ok(NAV.findIndex((e) => e.key === "knowledge") === NAV.findIndex((e) => e.key === "design") + 1,
  "#136: KNOWLEDGE sits immediately after DESIGN");
ok(knowledgeGroup?.kind === "group" && knowledgeGroup.children.map((c) => c.href).join(",") === "/knowledge,/knowledge/steel,/knowledge/fixtures",
  "#136: KNOWLEDGE hrefs are the new routes");
ok(activeKeyFor("/knowledge") === "knowledgeoverview" && activeKeyFor("/knowledge/steel") === "knowledgeoverview" && activeKeyFor("/knowledge/fixtures") === "knowledgeoverview",
  "#136: every /knowledge route lights the KNOWLEDGE pill (segment-1 matching)");
ok(parentGroupOf("knowledgeoverview") === "knowledge" && parentGroupOf("steel") === "knowledge",
  "#136: knowledge children resolve to the knowledge group");
const NAV_KEYS = NAV.flatMap((e) => (e.kind === "group" ? [e.key, ...e.children.map((c) => c.key)] : [e.key]));
ok(new Set(NAV_KEYS).size === NAV_KEYS.length,
  `#136: no two nav entries share a key (${NAV_KEYS.length} keys)`);

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
ok(NAV.length === 6, "the header has 6 top-level items: Home joined the chips (#55, D124); KNOWLEDGE joined after DESIGN (#136)");
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
  !!(d99Sales && d99Sales.kind === "group" && d99Sales.children.length === 8),
  "CRM has eight children — Quotes and Reviews moved to EST (D117), Opportunities added (#18), My Leads added (#22), Vendors added (#122)",
);
ok(
  !!(
    d99Sales &&
    d99Sales.kind === "group" &&
    d99Sales.children.map((c) => c.key).join(",") ===
      "opportunities,leads,myleads,companies,vendors,people,venues,field"
  ),
  "CRM children are opportunities, leads, myleads, companies, vendors, people, venues, field in order",
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
ok(resolveSettingsSection(undefined) === "company", "no ?section= defaults to company");
ok(resolveSettingsSection("nope") === "company", "an unknown ?section= falls back to company");
ok(resolveSettingsSection("team") === "company", "a removed ?section=team falls back to company");
ok(resolveSettingsSection("admin") === "admin", "?section=admin is honored");
ok(resolveSettingsSection(["admin", "team"]) === "admin", "an array ?section= takes the first value");
ok(
  SETTINGS_SECTIONS.map((s) => s.key).join(",") === "company,admin",
  "Settings exposes company and admin sections in order",
);
ok(ADMIN_SCREENS.length === 4, "Admin lists exactly four screens");
ok(
  ADMIN_SCREENS.map((s) => s.href).join(",") ===
    "/templates,/estimating-rules,/task-templates,/import",
  "Admin links Templates, Estimating Rules, Task Templates, Import — by their own routes",
);

// ---- General dissolution (D99): the group is gone ----
ok(!NAV.some((e) => e.kind === "group" && e.key === "general"), "the General group is gone");
ok(
  NAV.map((e) => e.key).join(",") === "home,est,pm,crm,design,knowledge",
  "the top-level chips are Home, EST, PM, CRM, DESIGN, KNOWLEDGE in order (#55 put Home back, D124; #136 added KNOWLEDGE)",
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

ok(isOpenStage("project", "installation") === true && isOpenStage("project", "complete") === false, "project open = any stage but complete");
ok(isOpenStage("inspection", "onsite") === true, "inspection onsite counts as open work (the 4th stage)");
ok(isOpenStage("quote", "won") === false && isOpenStage("quote", "sent") === true, "quote open = draft or sent");

/* --- dashboard metrics (#43, task 4a) — openProjects/backlogProjects read the
 *  pipeline tag (isActive/isBacklog), not a hardcoded stage-literal list. --- */
import { openProjects as metricsOpenProjects, backlogProjects as metricsBacklogProjects } from "@/lib/dashboard/metrics";
const metricsProjects = [
  { kind: "project", stage: "scheduled" },
  { kind: "project", stage: "deposit" },
] as any;
ok(metricsOpenProjects(metricsProjects).length === 1, "#43: openProjects keeps only the scheduled-tag record");
ok(metricsBacklogProjects(metricsProjects).length === 1, "#43: backlogProjects keeps only the backlog-tag record");

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
import { designPatchFromIntake, manualScopeInputs } from "@/lib/design/grid-intake";
import { TRACKABLE_SYS_KEYS } from "@/lib/design/grid-scopes";
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
{
  const base = defaultAState(0);
  const state = { ...base, fixtureAssemblies: { ...base.fixtureAssemblies, par: "fa-par" } };
  const fixtures = computeQuick(state, { "fa-par": { name: "House PAR assembly", cost: 432 } })
    .systems.find((system) => system.key === "lighting")!.items;
  const par = fixtures.find((item) => item.desc === "House PAR assembly")!;
  ok(par?.cost === 432, "Quick Design BOM prices a selected fixture from Assembly Builder");
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
  normalizeTask, tasksForEngagement, createTask, tasksForProject, removeTask,
  applyMilestoneTaskShifts, getTask,
  STATUSES, type TaskRecord, type TaskTemplateItem,
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
    id: "T-6000", title: "t", section: "Install", projectId: null, quoteId: null, designId: null,
    engagementId: null, coverageKey: null, assigneeUserId: null, assigneeName: "", dueAt: null,
    startAt: null, schedule: null, handScheduled: false,
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
import { participantsFor, deriveStatus } from "@/lib/stores/comms";
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

/* ---- #96 §6 — thread status derives from the latest message ---- */
{
  const m = (direction: "in" | "out", at: number) => ({
    id: "m" + at, at, direction, channel: "email" as const, author: "", body: "",
  });
  // reply imported BEFORE the original (Gmail lists newest first) still ends "waiting_them"
  ok(
    deriveStatus({ status: "waiting_us", messages: [m("out", 200), m("in", 100)] }) === "waiting_them",
    "deriveStatus: latest-by-timestamp wins regardless of array order"
  );
  ok(
    deriveStatus({ status: "waiting_them", messages: [m("out", 100), m("in", 200)] }) === "waiting_us",
    "deriveStatus: newest inbound → waiting_us"
  );
  ok(
    deriveStatus({ status: "draft", messages: [m("in", 100)] }) === "draft",
    "deriveStatus: never overrides a draft"
  );
  ok(
    deriveStatus({ status: "closed", messages: [m("in", 100), m("out", 200)] }) === "closed",
    "deriveStatus: closed stays closed after an outbound"
  );
  ok(
    deriveStatus({ status: "closed", messages: [m("out", 100), m("in", 200)] }) === "waiting_us",
    "deriveStatus: closed reopens on a new inbound"
  );
  ok(
    deriveStatus({ status: "waiting_us", messages: [] }) === "waiting_us",
    "deriveStatus: no messages → status unchanged"
  );
  ok(
    deriveStatus({ status: "replied", messages: [m("in", 100)] }) === "waiting_us",
    "deriveStatus: replied is not a derivable state — callers that must respect it (the bulk pass) skip it"
  );
  ok(
    deriveStatus({ status: "waiting_us", messages: [m("in", 100), m("out", 100)] }) === "waiting_them",
    "deriveStatus: equal timestamps → later array element wins"
  );
}

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
import { DEFAULT_PROJECT_PIPELINES as BOARD_PIPELINES } from "@/lib/pipelines";

ok(BOARD_PIPELINES.find((p) => p.id === "install")!.stages.map((s) => s.id).join(",") === "deposit,equipment-ordered,initial-contact,scheduled,installation,invoice,complete", "#19: board columns follow the install pipeline");
ok(BOARD_PIPELINES.find((p) => p.id === "order")!.stages.map((s) => s.id).join(",") === "order-materials,deliveries,delivered,complete", "#19: orders follow the order pipeline — excluded from the board");
{
  const mix: Array<{ kind: "project" | "order" }> = [
    { kind: "project" },
    { kind: "order" },
    { kind: "project" },
  ];
  ok(boardProjects(mix).length === 2, "#19: boardProjects keeps kind === project only");
}
ok(dueChipLabel(true, -3, "Jul 20") === "Closed Jul 20", "#19: done cards read Closed <date>");
ok(dueChipLabel(false, -3, "") === "3d overdue", "#19: past-due cards read Nd overdue");
ok(dueChipLabel(false, 0, "") === "Due today", "#19: due-today wording preserved");
ok(dueChipLabel(false, 12, "") === "Due in 12d", "#19: future cards read Due in Nd");

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
import { normalizeNote, addNoteRecord, notesForEngagement, type NoteRecord } from "@/lib/stores/notes";

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
    attachments: [],
    taskIds: [],
    system: false,
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
  ok(v[0].sub === "Scheduled" && v[0].href === "/venue-assessments" && v[0].by === "Mike Torres", "#21: visit sub is the stage label");
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
  ok(s[0].href === "/venue-assessments?id=FS-1054", "#21: survey row deep-links the survey");

  // projects — stage-history rows (task 4a: labeled via stageLabelFor against
  // the loaded Pipelines, legacy pre-pipeline keys render their frozen
  // LEGACY_STAGE_LABELS name) + newest-first notes handled
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
    DEFAULT_PIPELINES
  );
  ok(pj.length === 4, "#21: stage-history + project-note rows all present");
  ok(
    pj[0].title === "Project P-3001 → Order materials" && pj[1].title === "Project P-3001 → Install" && pj[1].by === "Mike Torres",
    "#21: stage rows render legacy keys via their frozen LEGACY_STAGE_LABELS name + actor (D83 anchors an opening from:null entry — renders the same way)"
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
// #148: the dev auto-seed is fire-and-forget from getDb() — seeded() is the
// external waiter that lets this gate hold for it before anything reads
// seeded rows (equipment-items, surveys, etc. below).
import { seeded } from "@/db";

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
import { getProject, getProjectByQuote, removeProject } from "../src/lib/stores/projects";

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

/* --- #14/#133: catalog price books + price-date model --- pure, asserted at top level. */
import {
  OUTDATED_AFTER_MS,
  effectivePriceDate,
  isOutdated,
  isoDateOf,
  mfrKey,
  nextPricedAt,
  parseEffectiveDate,
  priceBooks,
} from "@/lib/catalog-books";

{
  const now = Date.now();
  const DAY = 86400000;
  const MONTH = 30.4375 * DAY;

  ok(
    mfrKey("Meyer Sound") === "meyersound" && mfrKey("meyer-sound") === "meyersound" && mfrKey(" MEYER  SOUND ") === "meyersound",
    "#133 mfrKey: case, spaces and punctuation collapse"
  );
  ok(mfrKey("") === "" && mfrKey(undefined) === "" && mfrKey("---") === "", "#133 mfrKey: blank/punctuation-only → empty key");

  ok(OUTDATED_AFTER_MS === 548 * DAY, "#133 OUTDATED_AFTER_MS is 548 days (18 months)");
  ok(!isOutdated(now - 17 * MONTH, now), "#133 isOutdated: 17 months → current");
  ok(!isOutdated(now - 547 * DAY, now), "#133 isOutdated: one day short of the boundary → current");
  ok(isOutdated(now - 548 * DAY, now), "#133 isOutdated: exactly 548 days (18 months) → outdated");
  ok(isOutdated(now - 19 * MONTH, now), "#133 isOutdated: 19 months → outdated");

  const S = { priceListEffective: { meyersound: now - 100 * DAY } };
  ok(
    effectivePriceDate({ mfr: "Meyer Sound", pricedAt: now - 10 * DAY }, S) === now - 10 * DAY,
    "#133 effectivePriceDate: a newer per-line date wins over the book date"
  );
  ok(
    effectivePriceDate({ mfr: "Meyer Sound", pricedAt: now - 400 * DAY }, S) === now - 100 * DAY,
    "#133 effectivePriceDate: a newer book date (list confirmed later) wins over an older per-line date (D156)"
  );
  ok(
    effectivePriceDate({ mfr: "meyer-sound" }, S) === now - 100 * DAY,
    "#133 effectivePriceDate: no per-line date → the book date, matched through mfrKey"
  );
  ok(effectivePriceDate({ mfr: "ETC" }, S) === null, "#133 effectivePriceDate: no date anywhere → null");
  ok(effectivePriceDate({ pricedAt: now - 5 * DAY }, S) === now - 5 * DAY, "#133 effectivePriceDate: unbranded parts still use their own date");

  const D1 = now - 200 * DAY;
  const D2 = now - 20 * DAY;
  ok(nextPricedAt(null, { list: 10, cost: 5 }, D1) === D1, "#133 nextPricedAt: a new part is stamped with the write's date");
  ok(
    nextPricedAt({ list: 10, cost: 5, pricedAt: D1 }, { list: 10, cost: 5, pricedAt: D1 }, D2) === D1,
    "#133 nextPricedAt: unchanged list+cost keep the old date"
  );
  ok(nextPricedAt({ list: 10, cost: 5, pricedAt: D1 }, { list: 12, cost: 5, pricedAt: D1 }, D2) === D2, "#133 nextPricedAt: a list change stamps the new date");
  ok(nextPricedAt({ list: 10, cost: 5, pricedAt: D1 }, { list: 10, cost: 6, pricedAt: D1 }, D2) === D2, "#133 nextPricedAt: a cost change stamps the new date");
  ok(
    nextPricedAt({ list: 10, cost: 5 }, { list: 10, cost: 5 }, D2) === undefined,
    "#133 nextPricedAt: legacy part, unchanged price → still undated (no fake date)"
  );

  ok(isoDateOf(new Date(2026, 0, 15).getTime()) === "2026-01-15", "#133 isoDateOf renders a local YYYY-MM-DD");
  ok(
    parseEffectiveDate("2026-01-15", now) === new Date(2026, 0, 15, 12, 0, 0, 0).getTime(),
    "#133 parseEffectiveDate: a date input parses to local NOON, not midnight (a UTC server's midnight renders a day early in US browsers)"
  );
  ok(isoDateOf(parseEffectiveDate("2026-01-15", now)) === "2026-01-15", "#133 parseEffectiveDate → isoDateOf round-trips the calendar day");
  ok(parseEffectiveDate("", now) === now && parseEffectiveDate("nope", now) === now, "#133 parseEffectiveDate: blank/invalid → the fallback");

  const fresh = priceBooks([{ mfr: "Acme", pricedAt: now - 3 * DAY }, { mfr: "Acme", pricedAt: now - 5 * DAY }], {}, { now });
  ok(
    fresh[0]?.effectiveAt === now - 5 * DAY && !fresh[0].outdated && !fresh[0].unknown,
    "#14/#133 priceBooks: effectiveAt is the OLDEST date in a fully-dated book, not the newest"
  );
  const partial = priceBooks([{ mfr: "Beta", pricedAt: now }, { mfr: "Beta" }], {}, { now });
  ok(
    partial[0]?.count === 2 && partial[0].effectiveAt === null && partial[0].unknown,
    "#14/#133 priceBooks: one dated row out of two does NOT date the book (unknown is older than anything — decision A)"
  );
  const covered = priceBooks([{ mfr: "Beta", pricedAt: now }, { mfr: "Beta" }], { priceListEffective: { beta: now - 30 * DAY } }, { now });
  ok(
    covered[0]?.effectiveAt === now - 30 * DAY && !covered[0].unknown,
    "#133 priceBooks: the book date covers the undated row, and oldest still wins"
  );
  const stale = priceBooks([{ mfr: "Gamma", pricedAt: now - 600 * DAY }], {}, { now });
  ok(stale[0]?.outdated && !stale[0].unknown, "#133 priceBooks: a 600-day-old book is outdated");
  const never = priceBooks([{ mfr: "Delta" }, { mfr: "Delta" }], {}, { now });
  ok(never[0]?.unknown && never[0].effectiveAt === null && !never[0].outdated, "#14/#133 priceBooks: no date anywhere → unknown, never outdated");
  const merged = priceBooks(
    [{ mfr: "Meyer Sound", pricedAt: now }, { mfr: "meyer-sound", pricedAt: now }, { mfr: "Meyer Sound" }],
    { priceListEffective: { meyersound: now - DAY } },
    { now }
  );
  ok(
    merged.length === 1 && merged[0].name === "Meyer Sound" && merged[0].key === "meyersound" && merged[0].count === 3,
    "#133 priceBooks: spellings merge by mfrKey and the most common spelling names the book"
  );
  const unbranded = priceBooks([{ pricedAt: now }, { mfr: "  " }], {}, { now });
  ok(
    unbranded.some((b) => b.name === "Unbranded" && b.key === "" && b.count === 2),
    "#14 priceBooks: blank/whitespace-only mfr groups under 'Unbranded' with an empty key"
  );
  const eight = Array.from({ length: 8 }, (_, i) => ({ mfr: `Mfr${i}`, pricedAt: now })).flatMap((p, i) =>
    Array.from({ length: 8 - i }, () => p)
  );
  ok(priceBooks(eight, {}, { now }).length === 6, "#14 priceBooks: caps at the top 6 books by count by default");
  ok(priceBooks(eight, {}, { now, limit: Infinity }).length === 8, "#133 priceBooks: limit: Infinity returns every book (the Catalog banner)");
  ok(priceBooks(eight, {}, { now })[0]?.name === "Mfr0", "#14 priceBooks: sorted by count descending");
}

/* ---- #122 §1 — a vendor is a company of the exact type; partners get no base venue ---- */
ok(VENDOR_COMPANY_TYPE === "vendor/manufacturer" && isVendorType(" vendor/manufacturer ") && !isVendorType("Vendor"), "#122 isVendorType: exact COMPANY_TYPES string (trimmed), not the legacy 'Vendor'");
ok(PARTNER_TYPES.has(VENDOR_COMPANY_TYPE), "#122 PARTNER_TYPES carries the exact vendor type string");
ok(PARTNER_TYPES.has("Vendor"), "#122 PARTNER_TYPES keeps the legacy 'Vendor' spelling");
ok(baseVenueKind(VENDOR_COMPANY_TYPE, "Rose Brand Church Supply") === null, "#122 a vendor company is never minted a base venue, whatever its name says");

/* ---- #122 §2 — vendor status + owner tasks ---- */
{
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 8, 21, 12);
  const list = (effectiveAt: number): VendorPriceListEntry => ({ id: "pl-x", receivedAt: effectiveAt, effectiveAt, note: "", loggedBy: "t" });
  ok(vendorStatus({ lastList: null, catalogEffectiveAt: now, now }) === "no-list", "#122 vendorStatus: no ledger entry → no-list (even with a fresh catalog)");
  ok(vendorStatus({ lastList: list(now - DAY), catalogEffectiveAt: null, now }) === "newer-list", "#122 vendorStatus: a list but an undated catalog → newer-list");
  ok(vendorStatus({ lastList: list(now - DAY), catalogEffectiveAt: now - 2 * DAY, now }) === "newer-list", "#122 vendorStatus: list newer than the catalog → newer-list");
  ok(vendorStatus({ lastList: list(now - 2 * DAY), catalogEffectiveAt: now - DAY, now }) === "current", "#122 vendorStatus: catalog dated after the list → current");
  ok(vendorStatus({ lastList: list(now - DAY), catalogEffectiveAt: now - DAY, now }) === "current", "#122 vendorStatus: equal dates → current, not newer (strict >)");
  const edge = now - OUTDATED_AFTER_MS;
  ok(vendorStatus({ lastList: list(edge), catalogEffectiveAt: edge, now }) === "current", "#122 vendorStatus: exactly OUTDATED_AFTER_MS old is still current (boundary is strict >)");
  ok(vendorStatus({ lastList: list(edge - 1), catalogEffectiveAt: edge - 1, now }) === "outdated", "#122 vendorStatus: one ms past the threshold → outdated");
  ok(vendorStatus({ lastList: list(edge - 1), catalogEffectiveAt: now - DAY, now }) === "current", "#122 vendorStatus: a fresh catalog keeps an old list current (max of the two dates)");
  ok(vendorStatus({ lastList: list(edge - 1), catalogEffectiveAt: null, now }) === "newer-list", "#122 vendorStatus: newer-list wins over outdated when the catalog is undated");

  const t1 = vendorTasks("newer-list", { id: "v1", name: "Rose Brand", lastList: list(now - DAY), catalogEffectiveAt: null });
  ok(!!t1 && t1.title.startsWith("Update catalog: Rose Brand price list effective ") && t1.source === `auto: vendor v1 newer-list ${now - DAY}`, "#122 vendorTasks: newer-list → 'Update catalog' keyed by the list's effectiveAt");
  const t2 = vendorTasks("outdated", { id: "v1", name: "Rose Brand", lastList: list(edge - 1), catalogEffectiveAt: edge - 5 });
  ok(!!t2 && t2.title === "Request updated price list from Rose Brand" && t2.source === `auto: vendor v1 outdated ${edge - 1}`, "#122 vendorTasks: outdated → 'Request updated price list' keyed by the newer of list/catalog");
  ok(vendorTasks("current", { id: "v1", name: "X", lastList: list(now), catalogEffectiveAt: now }) === null && vendorTasks("no-list", { id: "v1", name: "X", lastList: null, catalogEffectiveAt: null }) === null, "#122 vendorTasks: current / no-list → no task");

  // `as unknown as` — the catalog plan may type this parameter as the full AppSettingsData.
  const settings0 = { priceListEffective: {} } as unknown as Parameters<typeof catalogEffectiveAtFor>[2];
  const parts = [
    { mfr: "Rose Brand", pricedAt: now - 3 * DAY },
    { mfr: "rose-brand", pricedAt: now - DAY },
    { mfr: "Other", pricedAt: now },
    { mfr: "Rose Brand" },
  ];
  ok(catalogEffectiveAtFor(parts, ["Rose Brand"], settings0) === now - DAY, "#122 catalogEffectiveAtFor: the NEWEST effective date across the vendor's manufacturers, aliases matched by mfrKey, undated parts ignored");
  ok(catalogEffectiveAtFor(parts, ["Nobody"], settings0) === null && catalogEffectiveAtFor(parts, [], settings0) === null, "#122 catalogEffectiveAtFor: no matching parts → null");
  ok(partCountFor(parts, ["ROSE BRAND"]) === 3 && partCountFor(parts, []) === 0, "#122 partCountFor counts parts by manufacturer key");

  const users = [
    { id: "u1", name: "Jeff Chesebro", roles: ["Admin", "Estimator"], status: "active" },
    { id: "u3", name: "Jena Tolksdorf", roles: ["Estimator"], status: "active" },
    { id: "u9", name: "Gone Admin", roles: ["Admin"], status: "archived" },
  ];
  ok(resolveCatalogOwner(null, users)?.id === "u3", "#122 resolveCatalogOwner: defaults to the user named Jena Tolksdorf");
  ok(resolveCatalogOwner({ userId: "u1" }, users)?.id === "u1", "#122 resolveCatalogOwner: the Settings pick wins");
  ok(resolveCatalogOwner({ userId: "u9" }, users)?.id === "u3", "#122 resolveCatalogOwner: an archived pick falls through to the default");
  ok(resolveCatalogOwner(null, users.filter((u) => u.id !== "u3"))?.id === "u1", "#122 resolveCatalogOwner: no Jena → the first active Admin");
  ok(resolveCatalogOwner(null, []) === null, "#122 resolveCatalogOwner: nobody active → null (no task is created)");

  const dir = manufacturerDirectory(parts, [{ id: "v1", manufacturers: ["rose-brand"] }]);
  ok(dir.length === 2 && dir[0].name === "Rose Brand" && dir[0].count === 3 && dir[0].vendorId === "v1" && dir[1].name === "Other" && dir[1].vendorId === null, "#122 manufacturerDirectory: grouped by mfrKey, first spelling wins, count-desc, claim owner attached");
  ok(unclaimedManufacturers(parts, [{ id: "v1", manufacturers: ["rose-brand"] }]).map((m) => m.name).join(",") === "Other", "#122 unclaimedManufacturers: only keys no vendor claims");
  ok(manufacturerDirectory([{ mfr: "" }, { mfr: "  " }, {}], []).length === 0, "#122 manufacturerDirectory: unbranded parts are not a manufacturer");
}

/* ---- #122 §3 — tab keys + date bridge ---- */
ok(VENDOR_TABS.join(",") === "overview,contacts,prices,activity", "#122 vendor tabs are the spec's four");
ok(resolveVendorTab("prices") === "prices" && resolveVendorTab("") === "overview" && resolveVendorTab("nope") === "overview", "#122 resolveVendorTab validates ?tab= (default overview)");
ok(vendorToDateInput(new Date(2026, 8, 21, 15).getTime()) === "2026-09-21", "#122 toDateInput renders local Y-M-D");
ok(vendorFromDateInput("2026-09-21") === new Date(2026, 8, 21).getTime() && vendorFromDateInput("") === null && vendorFromDateInput("2026-09") === null, "#122 fromDateInput → local midnight, null on blank/malformed");

/* The ledger dates are validated at the ACTION boundary: logPriceList()'s
 * store normalizer DROPS an entry whose effectiveAt isn't finite, so an
 * unvalidated action would report success over a write that never happened. */
{
  const good = vendorParseLedgerDates({ receivedAt: 1_700_000_000_000, effectiveAt: 1_700_000_001_000 });
  ok(good.ok && good.receivedAt === 1_700_000_000_000 && good.effectiveAt === 1_700_000_001_000, "#122 parseLedgerDates passes two finite epoch-ms dates through");
  for (const bad of [NaN, Infinity, -Infinity, 0, -1, null, undefined, "2026-09-21", {}] as unknown[]) {
    ok(!vendorParseLedgerDates({ receivedAt: bad, effectiveAt: 1_700_000_000_000 }).ok, `#122 parseLedgerDates rejects a non-finite receivedAt (${String(bad)})`);
    ok(!vendorParseLedgerDates({ receivedAt: 1_700_000_000_000, effectiveAt: bad }).ok, `#122 parseLedgerDates rejects a non-finite effectiveAt (${String(bad)})`);
  }
  const rejected = vendorParseLedgerDates({ receivedAt: NaN, effectiveAt: NaN });
  ok(!rejected.ok && rejected.error === "Both dates are required.", "#122 parseLedgerDates returns the action's error copy");
}

/* ---- #122 §3 — inbox option groups ---- */
{
  const groups = groupCompanyOptions([
    { id: "rose-brand", name: "Rose Brand", type: "vendor/manufacturer" },
    { id: "lakefront", name: "Lakefront PAC", type: "Performing arts" },
    { id: "badger", name: "Badger Ballet", type: "" },
  ]);
  ok(groups.length === 2 && groups[0].label === "Customers" && groups[1].label === "Vendors", "#122 groupCompanyOptions: Customers first, then Vendors");
  ok(groups[0].options.map((o) => o.value).join(",") === "badger,lakefront" && groups[1].options[0].value === "rose-brand", "#122 groupCompanyOptions: name-sorted within a group, vendors by exact type");
  ok(groupCompanyOptions([{ id: "x", name: "X", type: "Civic" }]).length === 1, "#122 groupCompanyOptions: an empty group is dropped");
}

/* ---- #122 §3 — nav + seed ---- */
ok(activeKeyFor("/vendors") === "vendors" && activeKeyFor("/vendors/rose-brand") === "vendors" && parentGroupOf("vendors") === "crm", "#122 /vendors lights CRM › Vendors");
ok(NAV.some((e) => e.kind === "group" && e.key === "crm" && e.children.some((c) => c.key === "vendors" && c.href === "/vendors")), "#122 Vendors sits in the CRM group");
{
  const vendorDocs = customersSeed().filter((c) => c.type === VENDOR_COMPANY_TYPE);
  const seededProfiles = vendorProfilesSeed();
  ok(vendorDocs.length === 1 && vendorDocs[0].id === "rose-brand" && vendorDocs[0].locations.length === 0, "#122 seed: one vendor company, no venues");
  ok(seededProfiles.length === 1 && seededProfiles[0].id === "rose-brand" && seededProfiles[0].manufacturers.includes("Rose Brand"), "#122 seed: the profile claims the seeded catalog's manufacturer");
  ok(seededProfiles[0].priceLists.length === 1 && seededProfiles[0].priceLists[0].effectiveAt <= Date.now(), "#122 seed: one ledger entry in the past so the pages have content");
}

/* --- final review item 3: the Catalog page parser reports which price columns the file carried --- pure */
import { parseCatalog } from "@/app/(app)/catalog/parse";

{
  const descOnly = parseCatalog("SKU,Description\nA-1,Widget\n");
  ok(descOnly.ok && !descOnly.hasList && !descOnly.hasCost, "item 3 parseCatalog: no List/Cost header → hasList/hasCost false");
  ok(descOnly.rows[0]?.list === 0 && descOnly.rows[0]?.cost === 0 && descOnly.rows[0]?.valid, "item 3 parseCatalog: …rows still coerce to 0 and stay valid");
  const listOnly = parseCatalog("SKU,Description,List Price\nA-1,Widget,10\n");
  ok(listOnly.hasList && !listOnly.hasCost && listOnly.rows[0]?.list === 10, "item 3 parseCatalog: a List column alone → hasList only");
  const both = parseCatalog("SKU,Description,MSRP,Dealer Net\nA-1,Widget,10,6\n");
  ok(both.hasList && both.hasCost && both.rows[0]?.cost === 6, "item 3 parseCatalog: List + Cost headers (through aliases) → both flags");
  const blankCells = parseCatalog("SKU,Description,List,Cost\nA-1,Widget,,\n");
  ok(blankCells.hasList && blankCells.hasCost && blankCells.rows[0]?.list === 0, "item 3 parseCatalog: a present column with blank cells still counts as carried (cell → 0, as before)");
  const headerless2 = parseCatalog("A-1,Widget\nA-2,Gadget\n");
  ok(headerless2.ok && !headerless2.hasList && !headerless2.hasCost, "item 3 parseCatalog: headerless SKU,Description rows carry no price columns");
  const headerless6 = parseCatalog("A-1,Widget,Cat,ea,10,6\n");
  ok(headerless6.hasList && headerless6.hasCost && headerless6.rows[0]?.list === 10 && headerless6.rows[0]?.cost === 6, "item 3 parseCatalog: headerless six-column rows carry both (positional)");
  const headerless5 = parseCatalog("A-1,Widget,Cat,ea,10\n");
  ok(headerless5.hasList && !headerless5.hasCost, "item 3 parseCatalog: headerless five-column rows carry List but not Cost");
  const empty = parseCatalog("");
  ok(!empty.ok && !empty.hasList && !empty.hasCost, "item 3 parseCatalog: a failed parse reports no price columns");
}

/* --- #132 / #134: catalog import guards --- pure */
import {
  MAX_CATALOG_IMPORT_BYTES,
  checkManufacturer,
  checkManufacturerGroups,
  checkSize,
  groupRowsByManufacturer,
} from "@/lib/catalog-import-guard";

{
  const cat = [
    { sku: "ETC-1", mfr: "ETC" },
    { sku: "ETC-2", mfr: "ETC" },
    { sku: "MEY-1", mfr: "Meyer Sound" },
    { sku: "MEY-2", mfr: "Meyer Sound" },
    { sku: "MEY-3", mfr: "meyer-sound" },
    { sku: "NOB-1" },
  ];
  const missing = checkManufacturer({ mfr: "  ", fileSkus: ["X-1"], catalog: cat });
  ok(!missing.ok && missing.reason === "missing", "#132 guard: blank manufacturer → missing");

  const normalized = checkManufacturer({ mfr: "MEYER-SOUND", fileSkus: ["MEY-1", "MEY-9"], catalog: cat });
  ok(
    normalized.ok && normalized.normalizedMfr === "Meyer Sound",
    "#132 guard: a re-spelled existing manufacturer normalizes to the most common stored spelling"
  );
  ok(normalized.ok && normalized.overlap === 1 && !normalized.isNew, "#132 guard: overlap counts the file SKUs already filed under that manufacturer");

  const noOverlap = checkManufacturer({ mfr: "ETC", fileSkus: ["NEW-1", "NEW-2"], catalog: cat });
  ok(
    !noOverlap.ok && noOverlap.reason === "no-overlap" && noOverlap.detail.includes("None of the 2 SKUs in this file belong to ETC"),
    "#132 guard: existing manufacturer + zero overlap → no-overlap with the spec's message"
  );

  const foreign = checkManufacturer({ mfr: "Meyer Sound", fileSkus: ["MEY-1", "etc-1", "ETC-2"], catalog: cat });
  ok(
    !foreign.ok && foreign.reason === "foreign-skus" && foreign.total === 2 && foreign.detail.includes("etc-1 is filed under ETC"),
    "#132 guard: SKUs filed under another manufacturer are named (case-insensitive SKU match), and win over no-overlap"
  );

  const twelveForeign = Array.from({ length: 12 }, (_, i) => ({ sku: `F-${i}`, mfr: "Chauvet" }));
  const twelve = checkManufacturer({ mfr: "Meyer Sound", fileSkus: twelveForeign.map((p) => p.sku), catalog: [...twelveForeign, ...cat] });
  ok(
    !twelve.ok && twelve.reason === "foreign-skus" && twelve.examples.length === 10 && twelve.detail.includes("(+2 more)"),
    "#132 guard: foreign examples cap at 10 with a '+N more' tail"
  );

  const fresh = checkManufacturer({ mfr: "Chauvet", fileSkus: ["CH-1"], catalog: cat });
  ok(fresh.ok && fresh.isNew && fresh.normalizedMfr === "Chauvet", "#132 guard: a new manufacturer with no parts is accepted as typed");
  ok(checkManufacturer({ mfr: "Chauvet", fileSkus: ["NOB-1"], catalog: cat }).ok, "#132 guard: unbranded parts are never 'foreign' — importing them under a manufacturer brands them (D157)");
  ok(checkManufacturer({ mfr: "ETC", fileSkus: [], catalog: cat }).ok, "#132 guard: an empty SKU list is not a wrong manufacturer (the importer's own no-rows check owns that)");

  const groups = groupRowsByManufacturer([
    { mfr: "ETC", sku: "ETC-1" },
    { mfr: "etc", sku: "ETC-9" },
    { mfr: "Meyer Sound", sku: "MEY-1" },
    { mfr: "", sku: "X" },
  ]);
  ok(groups.length === 3 && groups[0].mfr === "ETC" && groups[0].skus.length === 2, "#132 groups: rows group by mfrKey, first spelling kept");
  const checks = checkManufacturerGroups(groups, cat);
  ok(
    checks.length === 3 && checks[0].result.ok && checks[1].result.ok && !checks[2].result.ok && checks[2].result.reason === "missing" && checks[0].count === 2,
    "#132 groups: each manufacturer group checks independently"
  );

  ok(checkSize(MAX_CATALOG_IMPORT_BYTES).ok, "#134 checkSize: exactly 1,048,576 bytes is allowed");
  const over = checkSize(MAX_CATALOG_IMPORT_BYTES + 1);
  ok(!over.ok && over.error.includes("1 MB"), "#134 checkSize: one byte over is refused with a message naming the 1 MB limit");
  const big = checkSize(Math.round(2.3 * 1_048_576));
  ok(!big.ok && big.error.includes("2.3 MB"), "#134 checkSize: the message renders the actual size");
}

/* --- #129: subassemblies resolve live --- pure */
import { pricesAsOf, resolveSubassembly } from "@/lib/fixture-assemblies";

{
  const now = Date.now();
  const DAY = 86400000;
  const T0 = now - 300 * DAY;
  const T1 = now - 30 * DAY;
  const T2 = now - 3 * DAY;
  const subCatalog = [
    { sku: "ENG-1", desc: "Light engine", cost: 1000, mfr: "ETC", pricedAt: T1 },
    { sku: "LENS-1", desc: "Lens tube", cost: 200, mfr: "ETC", pricedAt: T2 },
    { sku: "CLAMP-1", desc: "C-clamp", cost: 25, mfr: "Acme" },
    { sku: "DMX-1", desc: "DMX 10ft", cost: 12, mfr: "Acme" },
  ];
  const settings = { priceListEffective: { acme: T0 } };
  const r = resolveSubassembly(
    { lightEngineSku: "ENG-1", lensSku: "LENS-1", options: { mounting: [{ sku: "CLAMP-1", qty: 2 }], data: [{ sku: "DMX-1", qty: 1 }] } },
    subCatalog,
    settings
  );
  ok(r.cost === 1000 + 200 + 2 * 25 + 12, "#129 resolveSubassembly: cost = engine + lens + Σ option cost × qty (the legacy save-time formula)");
  ok(r.price === r.cost, "#129 resolveSubassembly: price equals cost, as saveFixtureAction stored it");
  ok(r.optionsCost === 62 && r.options.mounting[0].qty === 2 && r.options.mounting[0].cost === 25, "#129 resolveSubassembly: options carry qty and the live unit cost");
  ok(r.lightEngine.name === "Light engine" && r.lens.found && r.options.power.length === 0 && r.options.accessories.length === 0, "#129 resolveSubassembly: names come from the catalog; absent categories resolve to []");
  ok(r.pricesAsOf === T2 && r.missing.length === 0, "#129 resolveSubassembly: prices as of = the NEWEST effective date among its parts");
  const gone = resolveSubassembly({ lightEngineSku: "ENG-1", lensSku: "NOPE", options: { accessories: [{ sku: "GONE", qty: 1 }] } }, subCatalog, settings);
  ok(!gone.lens.found && gone.lens.cost === 0 && gone.missing.join(",") === "NOPE,GONE", "#129 resolveSubassembly: missing parts price at 0 and are listed");
  ok(pricesAsOf(["CLAMP-1", "DMX-1"], subCatalog, settings) === T0, "#129 pricesAsOf: undated parts fall back to the manufacturer's book date");
  ok(pricesAsOf(["CLAMP-1"], subCatalog) === null, "#129 pricesAsOf: no date anywhere → null");
  ok(pricesAsOf([], subCatalog, settings) === null, "#129 pricesAsOf: no parts → null");
}

/* ---- #95 — login honours a same-origin callbackUrl ---- */
const O = "https://quartzite-six.vercel.app";
ok(safeCallbackPath(undefined, O) === "/", "safeCallbackPath: missing → /");
ok(safeCallbackPath("", O) === "/", "safeCallbackPath: empty → /");
ok(
  safeCallbackPath(O + "/api/gmail/callback?code=x&state=y", O) === "/api/gmail/callback?code=x&state=y",
  "safeCallbackPath: same-origin absolute → path+query"
);
ok(
  safeCallbackPath("/settings?gmail=connected", O) === "/settings?gmail=connected",
  "safeCallbackPath: relative path kept"
);
ok(safeCallbackPath("https://evil.example/steal", O) === "/", "safeCallbackPath: foreign origin → /");
ok(safeCallbackPath("//evil.example/steal", O) === "/", "safeCallbackPath: protocol-relative → /");
ok(safeCallbackPath("/login?callbackUrl=/x", O) === "/", "safeCallbackPath: never loops back to /login");

/* ---- #95 — Auth.js redirect keeps a same-origin path (production) ---- */
const B = "https://quartzite-six.vercel.app";
ok(resolveSignInRedirect(B + "/api/gmail/callback?code=x&state=y", B) === B + "/api/gmail/callback?code=x&state=y", "signInRedirect: same-origin absolute keeps path+query");
ok(resolveSignInRedirect("http://192.168.1.20:3000/inbox", B) === B, "signInRedirect: LAN host not honoured against a production baseUrl");
ok(resolveSignInRedirect("http://peak.local:3000/", B) === B, "signInRedirect: .local host not honoured against a production baseUrl");
ok(resolveSignInRedirect("https://evil.example/x", B) === B, "signInRedirect: foreign origin → baseUrl");
ok(resolveSignInRedirect("https://quartzite-six.vercel.app.evil.com/x", B) === B, "signInRedirect: suffix-spoofed host → baseUrl");
ok(resolveSignInRedirect("/settings", B) === B + "/settings", "signInRedirect: bare path resolves to baseUrl origin");
ok(resolveSignInRedirect("/\\evil.example/x", B) === B, "signInRedirect: backslash-smuggled protocol-relative → baseUrl");
ok(resolveSignInRedirect("//evil.example/x", B) === B, "signInRedirect: protocol-relative → baseUrl");
ok(resolveSignInRedirect("https://10.evil.example/x", B) === B, "signInRedirect: numeric-prefix public host is not local");
ok(resolveSignInRedirect("https://192.168.evil.example/x", B) === B, "signInRedirect: 192.168.* prefix spoof → baseUrl");
ok(resolveSignInRedirect("http://192.168.1.20:3000/inbox", "http://localhost:3000") === "http://192.168.1.20:3000/inbox", "signInRedirect: LAN hop honoured when the app runs locally");

/* ---- #95 — Settings warns when GMAIL_REDIRECT_BASE drifts from AUTH_URL ---- */
ok(redirectHostMismatch({}) === null, "redirectHostMismatch: nothing set → null");
ok(
  redirectHostMismatch({ AUTH_URL: "https://quartzite-six.vercel.app" }) === null,
  "redirectHostMismatch: no override → null"
);
ok(
  redirectHostMismatch({
    GMAIL_REDIRECT_BASE: "https://quartzite-six.vercel.app",
    AUTH_URL: "https://quartzite-six.vercel.app/",
  }) === null,
  "redirectHostMismatch: same host (trailing slash) → null"
);
ok(
  (redirectHostMismatch({
    GMAIL_REDIRECT_BASE: "https://peak-app-six.vercel.app",
    AUTH_URL: "https://quartzite-six.vercel.app",
  }) || "").includes("peak-app-six.vercel.app"),
  "redirectHostMismatch: different host → warning names the stale host"
);
ok(
  redirectHostMismatch({
    GMAIL_REDIRECT_BASE: "http://quartzite-six.vercel.app",
    AUTH_URL: "https://quartzite-six.vercel.app",
  }) !== null,
  "redirectHostMismatch: same host, http vs https scheme drift → warning"
);

/* ---- #97 — Gmail import chunking + quota detection ---- */
ok(IMPORT_BATCH_PER_RUN * 5 < 6000 / 2, "import batch stays under half the per-minute quota (5 units per messages.get)");
ok(isRateLimit(new Error("Gmail API /messages/x?format=full → 403 { \"reason\": \"rateLimitExceeded\" }")), "isRateLimit: 403 rateLimitExceeded");
ok(isRateLimit(new Error("Gmail API /messages/x → 429 Too Many Requests")), "isRateLimit: 429");
ok(!isRateLimit(new Error("Gmail API /messages/x → 404 Not Found")), "isRateLimit: 404 is not a rate limit");
ok(!isRateLimit(new Error("Mailbox not connected: personal:u1")), "isRateLimit: unrelated error");
ok(isRateLimit(new Error('Gmail API /messages/x → 403 { "reason": "userRateLimitExceeded", "message": "User-rate limit exceeded." }')), "isRateLimit: userRateLimitExceeded");
ok(!isRateLimit(new Error("Gmail API /messages/x → 500 { \"reason\": \"backendError\" }")), "isRateLimit: backendError is not a rate limit");
ok(IMPORT_MAX_CHUNKS_PER_RUN * IMPORT_BATCH_PER_RUN * 5 <= 6000 * 0.6, "a full run of chunks stays under 60% of the per-minute quota");

/* ---- #96 §1 — domain helpers ---- */
ok(domainOf("Brenda.Gauchel@Lakefront.K12.MN.US") === "lakefront.k12.mn.us", "domainOf lowercases");
ok(domainOf("no-at-sign") === "", "domainOf: no @ → empty");
ok(isPublicDomain("gmail.com") && isPublicDomain("Yahoo.com") && isPublicDomain("icloud.com"), "isPublicDomain: webmail");
ok(!isPublicDomain("lakefront.k12.mn.us"), "isPublicDomain: district is claimable");

/* ---- #96 §3 — Peak/* label vocabulary ---- */
ok(JSON.stringify(parsePeakLabel("Peak/Customers/Lakefront ISD")) === JSON.stringify({ kind: "customer", name: "Lakefront ISD" }), "parse customer label");
ok(parsePeakLabel("Peak/Status/Needs reply")?.kind === "status", "parse status label");
ok(JSON.stringify(parsePeakLabel("Peak/Assign/Nic")) === JSON.stringify({ kind: "assign", firstName: "Nic" }), "parse assign label");
ok(parsePeakLabel("Peak/New lead")?.kind === "newLead", "parse new-lead label");
ok(JSON.stringify(parsePeakLabel("Peak/Projects/P-3001")) === JSON.stringify({ kind: "work", type: "project", id: "P-3001" }), "parse project label");
ok(parsePeakLabel("Follow up") === null && parsePeakLabel("Peak/Nonsense/x") === null, "non-Peak / unknown → null");
ok(labelForStatus("waiting_us") === "Peak/Status/Needs reply" && labelForStatus("replied") === null, "status → label");
const wantPeakLabels = desiredPeakLabels({ customer: "Lakefront ISD", status: "waiting_them", assignedTo: "Nic Trapani", link: { type: "project", id: "P-3001" } });
ok(wantPeakLabels.includes("Peak/Customers/Lakefront ISD") && wantPeakLabels.includes("Peak/Status/Waiting") && wantPeakLabels.includes("Peak/Assign/Nic") && wantPeakLabels.includes("Peak/Projects/P-3001") && wantPeakLabels.length === 4, "desired set");
const peakLabelDiff = diffLabels(wantPeakLabels, ["INBOX", "Peak/Status/Needs reply", "Peak/Customers/Lakefront ISD", "Follow up"]);
ok(peakLabelDiff.add.length === 3 && peakLabelDiff.remove.length === 1 && peakLabelDiff.remove[0] === "Peak/Status/Needs reply", "diff adds missing, removes only stale Peak/* labels");

// #96 §3 review fix (Critical 1) — "current" must be the union across every
// message that carries gmailLabelIds, not just the newest one, so a
// trailing Peak-authored message (no gmailLabelIds) never blanks it.
const cplnIdToName = new Map([
  ["L1", "Peak/Status/Waiting"],
  ["L2", "Peak/Customers/X"],
]);
const cpln = currentPeakLabelNames(
  [{ gmailLabelIds: ["L1"] }, { gmailLabelIds: ["L2", "INBOX"] }, {}],
  cplnIdToName
);
ok(
  cpln.includes("Peak/Status/Waiting") && cpln.includes("Peak/Customers/X"),
  "currentPeakLabelNames: union across every message that has gmailLabelIds, trailing Peak-only message doesn't blank it"
);

/* ---- #96 §3 — Gmail → Peak command planning (Task 11) ---- */
const plan = planLabelCommands(["INBOX", "Peak/Status/Waiting", "Peak/Status/Done", "Peak/Assign/Nic", "Peak/New lead", "Follow up"]);
ok(plan.filter((c) => c.kind === "status").length === 1 && (plan.find((c) => c.kind === "status") as any).status === "closed", "plan: last status wins");
ok(plan.some((c) => c.kind === "assign") && plan.some((c) => c.kind === "newLead") && plan.length === 3, "plan: ignores non-Peak labels, keeps one of each independent command");
const planCustomerAssign = planLabelCommands(["Peak/Customers/A", "Peak/Customers/B", "Peak/Assign/Nic", "Peak/Assign/Jill"]);
ok(
  planCustomerAssign.filter((c) => c.kind === "customer").length === 1 &&
    (planCustomerAssign.find((c) => c.kind === "customer") as any).name === "B" &&
    planCustomerAssign.filter((c) => c.kind === "assign").length === 1 &&
    (planCustomerAssign.find((c) => c.kind === "assign") as any).firstName === "Jill",
  "plan: last customer and last assign each win independently"
);
const planWork = planLabelCommands(["Peak/Projects/P-1", "Peak/Leads/L-1", "Peak/Quotes/Q-1"]);
ok(planWork.length === 3 && planWork.every((c) => c.kind === "work"), "plan: every work-link label is its own independent command");

/* ---- #96 §3 review fix (Critical) — collapse per-message history records
 * into one event per thread, so a thread-wide Gmail label doesn't plan (and
 * apply) its command once per message on a multi-message thread. ---- */
const collapsed = collapseLabelEventsByThread([
  { messageId: "m1", threadId: "T1", added: ["L-newlead"], removed: [] },
  { messageId: "m2", threadId: "T1", added: ["L-newlead", "L-done"], removed: [] },
  { messageId: "m3", threadId: "T1", added: [], removed: [] },
]);
ok(collapsed.length === 1, "collapse: three same-thread events become one");
ok(
  collapsed[0].messageIds.join(",") === "m1,m2,m3",
  "collapse: keeps every message id that contributed to the thread"
);
ok(
  [...collapsed[0].added].sort().join(",") === "L-done,L-newlead",
  "collapse: unions and dedupes added label ids across the thread's messages"
);
const collapsedPlan = planLabelCommands(
  collapsed[0].added.filter((id) => id === "L-newlead").map(() => "Peak/New lead")
);
ok(collapsedPlan.length === 1, "collapse: the New-lead command plans exactly once from a collapsed thread event");

const collapsedTwoThreads = collapseLabelEventsByThread([
  { messageId: "m1", threadId: "T1", added: ["L-a"], removed: [] },
  { messageId: "m2", threadId: "T2", added: ["L-b"], removed: [] },
]);
ok(collapsedTwoThreads.length === 2, "collapse: distinct threads never merge");

const collapsedAddWinsOverRemove = collapseLabelEventsByThread([
  { messageId: "m1", threadId: "T1", added: [], removed: ["L-x"] },
  { messageId: "m2", threadId: "T1", added: ["L-x"], removed: [] },
]);
ok(
  collapsedAddWinsOverRemove[0].added.includes("L-x") && !collapsedAddWinsOverRemove[0].removed.includes("L-x"),
  "collapse: a label id added by one message and removed by another nets to added (added wins)"
);
ok(
  collapseLabelEventsByThread([]).length === 0,
  "collapse: an empty events array collapses to no threads"
);

async function xlsxFixture(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Price List");
  ws.addRow(["Part Number", "Description", "MSRP", "Dealer", "Manufacturer"]);
  ws.addRow(["S4LED-S2", "Source Four LED Series 2", 1899.5, 1139.7, "ETC"]);
  ws.addRow(["CS-40", 'Curtain track, 40" carrier, "heavy" duty', 42, 25.2, "ADC"]);
  ws.addRow(["CS-41", "Multi-line\ndescription", 10, 5, "ADC"]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* --- Grid options (Spec 1, 2026-09-21): normalization + slicing + copy --- */
{
  const legacy = {
    quoteId: "Q-9001",
    createdAt: 1000,
    placements: [
      { id: "gp-a", sheetId: "gs-1", page: 1, x: 0.1, y: 0.1, partId: "p1", by: "t", at: 1 },
      { id: "gp-b", sheetId: "gs-1", page: 1, x: 0.2, y: 0.2, partId: "p2", by: "t", at: 1 },
    ] as Array<{ id: string; sheetId: string; page: number; x: number; y: number; partId: string; by: string; at: number; optionId?: string }>,
    routes: [
      { id: "wr-a", sheetId: "gs-1", page: 1, partId: "w1", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], aspect: 1, by: "t", at: 1, fromPlacementId: "gp-a", toPlacementId: "gp-b" },
    ] as Array<{ id: string; sheetId: string; page: number; partId: string; points: { x: number; y: number }[]; aspect: number; by: string; at: number; fromPlacementId?: string; toPlacementId?: string; optionId?: string }>,
  };
  const norm = ensureOptions(structuredClone(legacy));
  ok(norm.options.length === 1 && norm.options[0].id === DEFAULT_OPTION_ID && norm.options[0].name === DEFAULT_OPTION_NAME, "grid-options: a legacy doc normalizes to one 'Design' option with id opt-base");
  ok(norm.options[0].quoteId === "Q-9001", "grid-options: the default option inherits the project quoteId");
  ok(norm.placements!.every((p) => p.optionId === DEFAULT_OPTION_ID) && norm.routes!.every((r) => r.optionId === DEFAULT_OPTION_ID), "grid-options: untagged placements and routes read as members of the first option");

  const two = ensureOptions({
    createdAt: 1000,
    quoteId: null,
    options: [
      { id: "opt-x", name: "Good", quoteId: null, createdAt: 1 },
      { id: "opt-y", name: "Better", quoteId: "Q-2", createdAt: 2 },
    ],
    placements: [
      { id: "gp-1", optionId: "opt-x" },
      { id: "gp-2", optionId: "opt-y" },
      { id: "gp-3" },
    ] as Array<{ id: string; optionId?: string }>,
    routes: [{ id: "wr-1", optionId: "opt-y" }] as Array<{ id: string; optionId?: string }>,
  });
  ok(two.options.length === 2 && two.options[0].id === "opt-x", "grid-options: an existing options list is preserved in order");
  ok(two.placements![2].optionId === "opt-x", "grid-options: an untagged member on a multi-option doc falls to the FIRST option");
  ok(defaultOptionId(two) === "opt-x", "grid-options: defaultOptionId is the first option");
  ok(resolveOptionId(two, "opt-y") === "opt-y" && resolveOptionId(two, "opt-nope") === "opt-x" && resolveOptionId(two, null) === "opt-x", "grid-options: resolveOptionId honours a known id and falls back to the first otherwise");
  ok(hasOption(two, "opt-y") && !hasOption(two, "opt-z"), "grid-options: hasOption");
  const sliceY = optionSlice(two, "opt-y");
  ok(sliceY.placements.length === 1 && sliceY.placements[0].id === "gp-2" && sliceY.routes.length === 1, "grid-options: optionSlice returns only that option's placements and routes");
  ok(optionSlice(two, "opt-x").placements.map((p) => p.id).join(",") === "gp-1,gp-3", "grid-options: optionSlice of the first option includes formerly-untagged members");

  const mirrored = syncQuoteMirror({ ...two, quoteId: "stale" });
  ok(mirrored.quoteId === null, "grid-options: syncQuoteMirror copies options[0].quoteId onto the project (null here)");
  const mirrored2 = syncQuoteMirror({ ...two, options: [two.options[1], two.options[0]] });
  ok(mirrored2.quoteId === "Q-2", "grid-options: syncQuoteMirror follows whichever option is first");

  let n = 0;
  const copied = copyOptionMembers({
    placements: norm.placements!,
    routes: norm.routes!,
    fromOptionId: DEFAULT_OPTION_ID,
    toOptionId: "opt-new",
    makeId: (prefix) => `${prefix}c${++n}`,
    by: "copier",
    at: 5000,
  });
  ok(copied.placements.length === 2 && copied.placements.every((p) => p.optionId === "opt-new" && p.by === "copier" && p.at === 5000), "grid-options: copyOptionMembers copies every placement into the target option with new provenance");
  ok(copied.placements.map((p) => p.id).join(",") === "gp-c1,gp-c2", "grid-options: copied placements get NEW ids");
  ok(copied.routes.length === 1 && copied.routes[0].id === "wr-c3" && copied.routes[0].fromPlacementId === "gp-c1" && copied.routes[0].toPlacementId === "gp-c2", "grid-options: copied routes get new ids and remapped device-wire endpoints");
  ok(norm.placements![0].id === "gp-a" && norm.placements![0].optionId === DEFAULT_OPTION_ID, "grid-options: copyOptionMembers never mutates the source members");
}

/* --- Grid intake helpers (Spec 1, Task 6) --- */
{
  const a = { ...defaultAState(0), venue: "pac", size: "large" as const, width: 48, depth: 34, grid: 58, wing: 18, ph: 28 };
  const si = manualScopeInputs(a);
  ok(si.venue === "pac" && si.width === 48 && si.depth === 34 && si.grid === 58 && si.wing === 18 && si.ph === 28, "grid-intake: manualScopeInputs carries venue/size/dims through");
  ok(si.sys.lighting && si.sys.rigging && si.sys.curtains && si.sys.audio && si.sys.video, "grid-intake: PAC preset turns on all five trackable systems");
  ok(!si.sys.controls && !si.sys.acoustical && !si.sys.pit, "grid-intake: non-trackable systems are off even when the preset has them");
  ok(!("tier" in si) && !("placements" in si) && !("qtyOverrides" in si), "grid-intake: AState-only fields are stripped");
  const church = manualScopeInputs({ ...a, venue: "church" });
  ok(!church.sys.rigging && church.sys.video, "grid-intake: preset differences flow through (church: no rigging, video on)");
  const patch = designPatchFromIntake({ projectName: "Untitled system design", venueName: "Main Hall", locationName: "Northshore HS", a });
  ok(patch.name === "Main Hall — Northshore HS" && patch.venue === "pac" && patch.size === "large" && patch.width === 48 && patch.depth === 34 && patch.grid === 58, "grid-intake: designPatchFromIntake names an untitled design from venue + location and copies dims");
  ok(designPatchFromIntake({ projectName: "Already named", venueName: "X", locationName: "", a }).name === undefined, "grid-intake: a named design keeps its name");
  ok(designPatchFromIntake({ projectName: "Untitled system design", venueName: "", locationName: "Only campus", a }).name === "Only campus", "grid-intake: falls back to whichever cover field is filled");
  ok(TRACKABLE_SYS_KEYS.join(",") === "rigging,curtains,lighting,audio,video", "grid-scopes: TRACKABLE_SYS_KEYS is exported in the Scope panel's order");
}
/* ---- native auth hand-off (spec 2026-09-21-native-auth-handoff) ---- */
{
  const secret = "spec-secret-not-real";
  const secureSet = [
    { name: "__Secure-authjs.callback-url", value: "x" },
    { name: "__Secure-authjs.session-token.1", value: "part1" },
    { name: "authjs.session-token", value: "insecure" },
    { name: "__Secure-authjs.session-token.0", value: "part0" },
  ];
  const picked = pickSessionCookies(secureSet);
  ok(
    picked.map((c) => c.name).join(",") === "__Secure-authjs.session-token.0,__Secure-authjs.session-token.1",
    "pickSessionCookies: prefers the __Secure- family, includes chunks in order, drops the insecure twin"
  );
  ok(
    pickSessionCookies([{ name: "authjs.session-token", value: "v" }]).length === 1,
    "pickSessionCookies: falls back to the plain family on http"
  );
  ok(pickSessionCookies([{ name: "other", value: "v" }]).length === 0, "pickSessionCookies: none -> []");

  const verifier = "verifier-abc-123";
  const challenge = challengeFor(verifier);
  ok(challenge.length === 43 && /^[A-Za-z0-9_-]+$/.test(challenge), "challengeFor: 43-char base64url");
  ok(challengeFor(verifier) === challenge, "challengeFor: deterministic");
  ok(isChallenge(challenge) && !isChallenge("short") && !isChallenge(42), "isChallenge: shape check");

  const cookies = [{ name: "__Secure-authjs.session-token", value: "eyJ.session" }];
  const now = 1_800_000_000_000;
  const code = mintHandoffCode({ cookies, challenge, next: "/field-work", now }, secret);
  ok(!code.includes("eyJ.session"), "mintHandoffCode: cookie value is not visible in the code");
  const good = redeemHandoffCode(code, verifier, secret, now + 5_000);
  ok(good.ok && good.cookies[0].value === "eyJ.session" && good.next === "/field-work", "redeem: round trip returns cookies + next");
  const wrong = redeemHandoffCode(code, "not-the-verifier", secret, now + 5_000);
  ok(!wrong.ok && wrong.reason === "mismatch", "redeem: wrong verifier -> mismatch");
  const late = redeemHandoffCode(code, verifier, secret, now + HANDOFF_TTL_MS + 1);
  ok(!late.ok && late.reason === "expired", "redeem: past ttl -> expired");
  const flipped = code.slice(0, -2) + (code.endsWith("A") ? "B" : "A") + code.slice(-1);
  ok(!redeemHandoffCode(flipped, verifier, secret, now).ok, "redeem: tampered code -> not ok");
  const otherKey = redeemHandoffCode(code, verifier, "another-secret", now);
  ok(!otherKey.ok && otherKey.reason === "malformed", "redeem: different secret -> malformed");
  ok(!redeemHandoffCode("garbage", verifier, secret, now).ok, "redeem: garbage -> not ok");
}

/* --- #135 manual consulting projects (D155) --- */
import { manualMilestoneSeeds, sweepIndexesEngagement } from "@/lib/consulting-stages";

ok(JSON.stringify(manualMilestoneSeeds({ mode: "fixed", amount: 12000 })) === JSON.stringify([{ name: "Fee", targetDate: 0, amount: 12000 }]),
  "#135: a fixed fee becomes ONE unscheduled 'Fee' milestone carrying the amount");
ok(manualMilestoneSeeds({ mode: "fixed", amount: 0 }).length === 0 && manualMilestoneSeeds(null).length === 0 && manualMilestoneSeeds(undefined).length === 0,
  "#135: no fee (or a zero fixed fee) seeds no milestones");
const t135 = manualMilestoneSeeds({
  mode: "milestones",
  milestones: [
    { name: " Schematic design ", targetDate: 1700000000000, amount: 5000 },
    { name: "", targetDate: -5, amount: 2500 },
    { name: "", targetDate: 0, amount: 0 },
  ],
});
ok(t135.length === 2, `#135: rows with neither a name nor an amount are dropped (${t135.length})`);
ok(t135[0].name === "Schematic design" && t135[0].targetDate === 1700000000000 && t135[0].amount === 5000,
  "#135: milestone names are trimmed, dates and amounts kept");
ok(t135[1].name === "Milestone" && t135[1].targetDate === 0 && t135[1].amount === 2500,
  "#135: a blank name defaults to 'Milestone'; a negative date is unscheduled (0)");
ok(!sweepIndexesEngagement({ origin: "manual", quoteId: null }),
  "#135 (D155): the sweep skips a manual project that has no proposal");
ok(sweepIndexesEngagement({ origin: "manual", quoteId: "Q-1" }),
  "#135 (D155): once a proposal is attached the sweep tracks the row by that quote");
ok(sweepIndexesEngagement({ quoteId: "Q-2" }) && sweepIndexesEngagement({ origin: "quote", quoteId: "Q-3" }),
  "#135: quote-born rows (origin absent on pre-#135 docs, or 'quote') are indexed by their quote");
ok(!sweepIndexesEngagement({ quoteId: "" }) && !sweepIndexesEngagement({ quoteId: null }),
  "#135: a row with no quote id is never indexed");

/* --- #121 typeahead ranking: SKU prefix first, then description contains, then anywhere --- */
import { catalogFilter, catalogMatches, catalogRank, typeaheadMatches } from "@/lib/search/typeahead-rank";

const t121 = [
  { sku: "S4LED-S3", desc: "Source Four LED Series 3", mfr: "ETC", category: "Fixtures" },
  { sku: "LENS-26", desc: "26° lens tube for S4LED", mfr: "ETC", category: "Fixtures" },
  { sku: "CLAMP-1", desc: "Pipe clamp", mfr: "The Light Source", category: "Hardware" },
  { sku: "ZZ-1", desc: "Speaker bracket", mfr: "S4LED Mounts Co", category: "Speakers" },
];
ok(catalogMatches("s4led", t121).map((p) => p.sku).join(",") === "S4LED-S3,LENS-26,ZZ-1",
  "#121: SKU prefix first, then description contains, then a match anywhere (case-insensitive)");
ok(catalogMatches("etc lens", t121).map((p) => p.sku).join(",") === "LENS-26",
  "#121: every whitespace token must match somewhere in sku/desc/mfr/category");
ok(catalogMatches("", t121).length === 4 && catalogMatches("", t121, 2).length === 2,
  "#121: an empty query lists items in their given order, capped at max");
ok(catalogMatches("nomatch", t121).length === 0, "#121: no hits → empty list");
ok(catalogRank("S4LED", t121[0]) === 0 && catalogRank("S4LED", t121[1]) === 1 && catalogRank("S4LED", t121[3]) === 2,
  "#121: catalogRank tiers are 0/1/2");
ok(catalogFilter("", t121[2]) && !catalogFilter("etc", t121[2]) && catalogFilter("light source", t121[2]),
  "#121: catalogFilter — empty passes everything, tokens are AND-ed across fields");
ok(typeaheadMatches("b", ["b1", "a", "b2"], (q, s) => s.startsWith(q), undefined, 8).join(",") === "b1,b2",
  "#121: typeaheadMatches without a rank keeps input order");
ok(typeaheadMatches("x", ["x3", "x1", "x2"], () => true, (_q, s) => Number(s.slice(1)), 2).join(",") === "x1,x2",
  "#121: a rank sorts ascending (stable) and max slices after ranking");

/* --- #131 grid symbols (D154): shapeFor precedence + symbolGeometry snapshot --- */
import {
  DEFAULT_GRID_CATEGORY_SHAPES, GRID_SHAPES, isGridShape, markerColor, resolveCategoryShapes, shapeFor, symbolGeometry,
} from "@/lib/design/grid-symbols";

ok(GRID_SHAPES.length === 8 && GRID_SHAPES.join(",") === "rect,circle,triangle,diamond,hexagon,speaker,light,camera",
  "#131: the eight curated shapes, rect first");
ok(isGridShape("speaker") && !isGridShape("blob") && !isGridShape(null), "#131: isGridShape");
ok(shapeFor({ category: "Speakers" }, {}) === "speaker" && shapeFor({ category: "Lighting" }, {}) === "light" &&
   shapeFor({ category: "Cameras" }, {}) === "camera" && shapeFor({ category: "Rigging" }, {}) === "diamond" &&
   shapeFor({ category: "Control" }, {}) === "hexagon",
  "#131: the seeded category defaults");
ok(shapeFor({ category: "  speakers " }, {}) === "speaker", "#131: category match is trimmed + case-insensitive");
ok(shapeFor({ category: "Speakers", shape: "hexagon" }, {}) === "hexagon", "#131: the entry's own shape wins over its category default");
ok(shapeFor({ category: "Speakers" }, { gridCategoryShapes: { Speakers: "circle" } }) === "circle", "#131: a stored category map wins over the seed");
ok(shapeFor({ category: "Speakers" }, { gridCategoryShapes: {} }) === "rect", "#131: a stored map is the whole truth (full replacement) — unmapped → rect");
ok(shapeFor({ category: "Anything else" }, {}) === "rect" && shapeFor(null, {}) === "rect" && shapeFor(undefined, null) === "rect",
  "#131: unknown category / no part / no settings → rect");
ok(shapeFor({ category: "Speakers", shape: "blob" }, {}) === "speaker", "#131: an unknown stored shape falls through to the category default");
ok(JSON.stringify(resolveCategoryShapes(undefined)) === JSON.stringify(DEFAULT_GRID_CATEGORY_SHAPES) && resolveCategoryShapes(null) !== DEFAULT_GRID_CATEGORY_SHAPES,
  "#131: resolveCategoryShapes — absent → a fresh copy of the seed");
ok(resolveCategoryShapes({ Speakers: "nope", Lighting: "light" }).Speakers === undefined && resolveCategoryShapes({ Speakers: "nope", Lighting: "light" }).Lighting === "light",
  "#131: resolveCategoryShapes drops unknown shape values");
const g131 = (s: (typeof GRID_SHAPES)[number]) => symbolGeometry(s, 44, 30);
ok(g131("rect").outline.kind === "rect" && g131("rect").glyph === null, "#131: rect = rounded rect, no glyph");
ok(g131("circle").outline.kind === "circle" && (g131("circle").outline as { r: number }).r === 15, "#131: circle radius = half the short side");
ok(g131("triangle").outline.kind === "polygon" && (g131("triangle").outline as { points: string }).points.split(" ").length === 3, "#131: triangle = 3 points");
ok(g131("diamond").outline.kind === "polygon" && (g131("diamond").outline as { points: string }).points.split(" ").length === 4, "#131: diamond = 4 points");
ok(g131("hexagon").outline.kind === "polygon" && (g131("hexagon").outline as { points: string }).points.split(" ").length === 6, "#131: hexagon = 6 points");
for (const s of ["speaker", "light", "camera"] as const) {
  ok(g131(s).outline.kind === "rect" && /^M /.test(g131(s).glyph || ""), `#131: ${s} = rect + path glyph`);
}
ok(g131("speaker").glyph === symbolGeometry("speaker", 44, 30).glyph && g131("speaker").glyph !== g131("camera").glyph && g131("light").glyph !== g131("camera").glyph,
  "#131: glyph paths are deterministic and distinct per shape");
ok(symbolGeometry("speaker", 12, 9).glyph !== g131("speaker").glyph, "#131: glyphs scale with the symbol box");
ok(markerColor("Speakers") === markerColor("Speakers") && /^#[0-9a-f]{6}$/.test(markerColor("Speakers")), "#131: markerColor is a stable hex per category");

async function asyncChecks(): Promise<void> {
  /* ---- #96 §1 — resolver precedence ---- */
  {
    const L = {
      contactByEmail: async (e: string) =>
        e === "brenda@lakefront.k12.mn.us" ? { contactId: "ct-b", customerId: "lakefront" } : null,
      customersByDomain: async (d: string) =>
        d === "lakefront.k12.mn.us" ? ["lakefront"] : d === "shared.org" ? ["a", "b"] : [],
    };
    const r1 = await resolveSender("Brenda@Lakefront.K12.MN.US", L);
    ok(r1.kind === "linked" && r1.via === "contact" && r1.customerId === "lakefront", "resolve: exact contact wins");
    const r2 = await resolveSender("new.person@lakefront.k12.mn.us", L);
    ok(r2.kind === "linked" && r2.via === "domain", "resolve: domain fallback");
    const r3 = await resolveSender("x@shared.org", L);
    ok(r3.kind === "ambiguous" && r3.candidates.length === 2, "resolve: shared domain → ambiguous");
    const r4 = await resolveSender("someone@gmail.com", { ...L, customersByDomain: async () => ["oops"] });
    ok(r4.kind === "unknown", "resolve: public domain never uses the domain step");
    const r5 = await resolveSender("", L);
    ok(r5.kind === "unknown", "resolve: empty → unknown");
    const r6 = await resolveSender("dup@shared.org", {
      ...L,
      contactByEmail: async () => ({ ambiguous: ["a", "b"] }),
    });
    ok(r6.kind === "ambiguous" && r6.candidates.length === 2, "resolve: two live customers on one address → ambiguous");
  }

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

    const noMfr = parseImportCsv(["Part Number,Description,MSRP", "S4LED-S2,Source Four LED Series 2,1899.50"].join("\n"));
    const noMfrPrep = prepareRows(noMfr.rows, autoMap(noMfr.headers, catType.fields), catType.fields);
    ok(
      !noMfrPrep.rows[0].valid && noMfrPrep.rows[0].errors.includes("Missing Manufacturer"),
      "#132 a hub catalog row without a manufacturer fails validation with the per-row error"
    );

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

  /* --- #145 D170/D171: captureAction's rollback is exercised for real, not
   * just read as correct-looking code (review Important #1). A mid-capture
   * failure is FORCED by injecting a `deps.createTask` that lets the first
   * task really land in the doc-store, then throws on the second — proving
   * `performCapture` deletes the first before rethrowing, and never writes
   * the note. Fixed test id + idempotency check since this writes to the
   * real persistent dev DB, same as the #13 block above. */
  const TEST_ROLLBACK_ENG_ID = "test-eng-punch145-rollback";
  {
    if (!(await getEngagement(TEST_ROLLBACK_ENG_ID))) {
      await upsertDoc("consulting_engagements", {
        id: TEST_ROLLBACK_ENG_ID,
        name: "PUNCHLIST #145 rollback test engagement",
        customer: "Test Customer #145",
        companyId: null,
        siteIds: [],
        contactName: "",
        people: [],
        quoteId: null,
        designIds: [],
        installQuoteId: null,
        status: "design",
        phases: [],
        milestones: [],
        decisions: [],
        meetings: [],
        submittals: [],
        documents: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    const priorTasks = await tasksForEngagement(TEST_ROLLBACK_ENG_ID);
    const priorNotes = await notesForEngagement(TEST_ROLLBACK_ENG_ID);
    ok(
      priorTasks.length === 0 && priorNotes.length === 0,
      "#145 rollback test: no leftover tasks/notes from a prior run (proves the rollback actually cleans up, not just this run's assertions)"
    );

    /* Minor (round 3 re-review): the "Nothing to capture." guard had no
     * assertion of its own — only exercised incidentally by the rollback/
     * refusal tests' non-empty inputs. */
    const emptyCapture = await performCapture(
      { engagementId: TEST_ROLLBACK_ENG_ID, text: "   ", attachments: [], tasks: [] },
      { id: "u1", name: "Test Runner" }
    );
    ok(
      !emptyCapture.ok && emptyCapture.error === "Nothing to capture.",
      "#145 a capture with no text, no files, and no tasks is refused rather than writing an empty note"
    );

    let createCalls = 0;
    const flakyDeps: CaptureDeps = {
      createTask: async (taskInput, me) => {
        createCalls++;
        if (createCalls === 2) throw new Error("simulated task-write failure (#145 rollback test)");
        return createTask(taskInput, me);
      },
      addNoteRecord,
      softDeleteDoc,
    };

    let threw = false;
    try {
      await performCapture(
        {
          engagementId: TEST_ROLLBACK_ENG_ID,
          text: "This capture must not survive a mid-capture failure",
          attachments: [],
          tasks: [
            { title: "First task — created for real, then rolled back", assigneeUserId: null, dueAt: null },
            { title: "Second task — the write throws here", assigneeUserId: null, dueAt: null },
          ],
        },
        { id: "u1", name: "Test Runner" },
        flakyDeps
      );
    } catch {
      threw = true;
    }
    ok(threw, "#145 a mid-capture task-write failure rejects the whole capture rather than silently partially succeeding");
    ok(createCalls === 2, "#145 the forced failure happened on the second task write, after the first really landed in the doc-store");

    const tasksAfter = await tasksForEngagement(TEST_ROLLBACK_ENG_ID);
    ok(tasksAfter.length === 0, "#145 rollback soft-deletes the task(s) already created before the failure");

    const notesAfter = await notesForEngagement(TEST_ROLLBACK_ENG_ID);
    ok(
      notesAfter.length === 0,
      "#145 rollback leaves no note behind — a half-written capture must never persist a note pointing at deleted tasks"
    );
  }

  /* --- #145 D171: a capture carrying an unverifiable attachment writes
   * NOTHING — the Critical fix's whole point, and it belongs in this
   * task's own coverage, not only Task 9's validateFileRefsForEngagement
   * unit tests (which check the validator; this checks captureAction's
   * USE of it). A "blob" ref whose own pathname names a different
   * engagement fails the structural half of the check with no network
   * call needed, so this is hermetic. Reuses the rollback test's fixed
   * engagement, with its own before/after empty-state assertions so this
   * block proves the refusal on its own, independent of the block above. */
  {
    const priorTasks = await tasksForEngagement(TEST_ROLLBACK_ENG_ID);
    const priorNotes = await notesForEngagement(TEST_ROLLBACK_ENG_ID);
    ok(
      priorTasks.length === 0 && priorNotes.length === 0,
      "#145 attachment-refusal test: no leftover tasks/notes before this run"
    );

    const forgedRef: FileRef = {
      kind: "blob",
      pathname: "engagement-files/some-other-engagement/secret.pdf",
      name: "secret.pdf",
      mime: "application/pdf",
      size: 1,
    };
    const refused = await performCapture(
      {
        engagementId: TEST_ROLLBACK_ENG_ID,
        text: "This must never be saved",
        attachments: [forgedRef],
        tasks: [{ title: "This task must never be saved either", assigneeUserId: null, dueAt: null }],
      },
      { id: "u1", name: "Test Runner" }
    );
    ok(!refused.ok, "#145 a capture carrying an attachment that fails validateFileRefsForEngagement is refused, not silently accepted");
    ok(
      !refused.ok && !/engagement-files|Drive|storage path/i.test(refused.error),
      "#145 the refusal message is generic — it does not leak the validator's internal storage-path/Drive wording to the caller"
    );

    const tasksAfterRefusal = await tasksForEngagement(TEST_ROLLBACK_ENG_ID);
    ok(tasksAfterRefusal.length === 0, "#145 the refused capture created no task — validation runs before any write, not just before the note");

    const notesAfterRefusal = await notesForEngagement(TEST_ROLLBACK_ENG_ID);
    ok(notesAfterRefusal.length === 0, "#145 the refused capture created no note either");
  }

  /* --- Venue Assessments: record migration --- */
  {
    const { getAll } = await import("@/lib/stores/surveys");
    const all = await getAll();
    ok(all.length > 0, "seeded surveys exist to migrate");
    ok(
      all.every((s) => !!(s as Record<string, unknown>).venueClass),
      "every existing record reads with a venueClass"
    );
    ok(
      all.every((s) => typeof (s as Record<string, unknown>).visitPurpose === "string"),
      "every existing record reads with a visitPurpose"
    );
    const fs1053 = all.find((s) => s.id === "FS-1053");
    ok(!!fs1053, "FS-1053 is present in the seed");
    // The next dozen assertions (through "records stamp the template
    // revision" below) dereference `fs1053`/`fs1055`/`withMeas` directly.
    // The dev auto-seed is fire-and-forget (getDb() in src/db/index.ts does
    // not await it), so on a fresh datadir this find() can lose the race and
    // return undefined — and the unguarded deref then threw a TypeError that
    // rejected the promise chain and killed the process. Because asyncChecks()
    // is second-to-last in that chain, the crash silently skipped the
    // remaining 50 assertions here AND all of templateScheduleAsyncChecks(),
    // which had therefore never run at all. Guarding turns a lost seed race
    // back into what it should always have been: the one honest FAIL above,
    // and just these dependent assertions skipped rather than the suite
    // dying (#158). This guard closes immediately below — everything after
    // it (the #145 file-ref/milestone/task-template blocks, the #158 ports
    // blocks, etc.) has nothing to do with the survey seed and must always
    // run, guard or no guard.
    if (fs1053) {
    ok(
      (fs1053 as Record<string, unknown>).venueClass === "theatre",
      "FS-1053 (Proscenium theater) migrates to theatre"
    );
    ok(
      (fs1053 as Record<string, unknown>).venueSubtype === "Single proscenium",
      "FS-1053 gains the matching subtype"
    );
    ok(fs1053!.venueType === "Proscenium theater", "venueType is retained for existing call sites");
    const fs1055 = all.find((s) => s.id === "FS-1055");
    ok(
      (fs1055 as Record<string, unknown>).venueClass === "church",
      "FS-1055 (Worship / sanctuary) migrates to church"
    );
    // measurements must survive the class switch untouched
    ok(
      all.every((s) => s.measurements && typeof s.measurements === "object"),
      "measurements survive migration"
    );
    const withMeas = all.find((s) => Object.keys(s.measurements || {}).length > 0);
    ok(!!withMeas, "at least one seeded record carries measurements");
    ok(
      Object.values(withMeas!.measurements).every((v) => typeof v === "string" || typeof v === "boolean"),
      "measurement values are untouched primitives"
    );
    // new sub-objects default, never undefined
    ok(Array.isArray((fs1053 as Record<string, unknown>).linesets), "linesets defaults to an array");
    ok(
      (fs1053 as Record<string, unknown>).assessmentEnabled === false,
      "the assessment layer is off by default"
    );
    ok(
      typeof (fs1053 as Record<string, unknown>).assessment === "object",
      "assessment defaults to an object, never undefined"
    );
    ok(
      typeof (fs1053 as Record<string, unknown>).signoff === "object",
      "signoff defaults to an object"
    );
    ok(
      (fs1053 as Record<string, unknown>).templateRev === "1.0",
      "records stamp the template revision"
    );
  }
  }

  /* ====== #145 round 3: validateFileRefsForEngagement (consulting-files-server.ts) ======
   * The writer-side half of the ownership fix — Task 7's note-save writer
   * takes client-supplied FileRef[]; this is where each one gets proven to
   * belong to the named engagement BEFORE it's ever stored, mirroring the
   * same rules the download proxy enforces on the way back out. Exercised
   * against a real (test) engagement record and the real, unconfigured
   * test-env Drive connection — no fake fetch needed for the "no Drive
   * connected" case, since that's this environment's actual state. */
  {
    const { createManualEngagement: createEng145 } = await import("@/lib/stores/engagements");
    const { validateFileRefsForEngagement } = await import("@/lib/consulting-files-server");
    // Fixed fixture name, declared outside the try so the finally block can
    // re-look-up and tear down this engagement regardless of how far setup
    // got before a throw — same idiom as the #145 T3 cleanup below. This
    // fixture previously had no find-or-create and no teardown: every
    // test:specs run minted a fresh CE-#### with status "awarded", which
    // OPEN_ENGAGEMENT_STAGES counts as open, polluting the Consulting hub,
    // the "Active consulting" KPI, and /schedule?view=timeline in what may
    // be the one real Neon database shared across Production/Preview/
    // Development (AGENTS.md, #145 review round 4).
    const ENG_NAME_145FILES = "Test files engagement (#145)";
    try {
      const eng145 =
        (await allEngagements()).find((e) => e.name === ENG_NAME_145FILES) ||
        (await createEng145(
          { customerId: "test-customer-145files", customer: "Test Files Co", name: ENG_NAME_145FILES, phases: [] },
          { name: "test-harness" }
        ));

      const goodBlob145: FileRef = {
        kind: "blob",
        pathname: `engagement-files/${eng145.id}/plan.pdf`,
        name: "plan.pdf",
        mime: "application/pdf",
        size: 10,
      };
      const validated145 = await validateFileRefsForEngagement([goodBlob145], eng145.id);
      ok(
        validated145.length === 1 && validated145[0] === goodBlob145,
        "#145 validateFileRefsForEngagement returns a correctly-scoped blob ref unchanged"
      );

      const badBlob145: FileRef = {
        kind: "blob",
        pathname: "engagement-files/some-other-engagement/plan.pdf",
        name: "plan.pdf",
        mime: "application/pdf",
        size: 10,
      };
      let threwBadBlob145 = false;
      try {
        await validateFileRefsForEngagement([badBlob145], eng145.id);
      } catch {
        threwBadBlob145 = true;
      }
      ok(threwBadBlob145, "#145 validateFileRefsForEngagement throws on a blob ref scoped to a DIFFERENT engagement");

      const safeData145: FileRef = { kind: "data", dataUrl: "data:text/plain,hello", name: "note.txt", mime: "text/plain", size: 5 };
      const validatedData145 = await validateFileRefsForEngagement([safeData145], eng145.id);
      ok(validatedData145.length === 1, "#145 validateFileRefsForEngagement accepts a safe data-URL ref");

      const dangerousData145: FileRef = {
        kind: "data",
        dataUrl: "data:text/html,<script>alert(1)</script>",
        name: "evil.html",
        mime: "text/html",
        size: 30,
      };
      let threwDangerousData145 = false;
      try {
        await validateFileRefsForEngagement([dangerousData145], eng145.id);
      } catch {
        threwDangerousData145 = true;
      }
      ok(
        threwDangerousData145,
        "#145 validateFileRefsForEngagement refuses a data-URL ref with a renderable-as-HTML mime"
      );

      const driveRef145: FileRef = { kind: "drive", fileId: "somefile", webViewLink: "x", name: "plan.pdf", mime: "application/pdf", size: 10 };
      let threwDrive145 = false;
      try {
        await validateFileRefsForEngagement([driveRef145], eng145.id);
      } catch {
        threwDrive145 = true;
      }
      ok(
        threwDrive145,
        "#145 validateFileRefsForEngagement throws on a drive ref when there is no live Drive connection to verify it against"
      );

      ok(
        (await validateFileRefsForEngagement([], eng145.id)).length === 0,
        "#145 validateFileRefsForEngagement is a no-op on an empty ref list"
      );

      let threwMissingEngagement145 = false;
      try {
        await validateFileRefsForEngagement([goodBlob145], "CE-does-not-exist-145");
      } catch {
        threwMissingEngagement145 = true;
      }
      ok(threwMissingEngagement145, "#145 validateFileRefsForEngagement throws when the engagement itself doesn't exist");
    } finally {
      // Teardown (#145 review round 4): re-queried by the fixed fixture
      // name rather than trusting `eng145` to have survived an early throw,
      // so cleanup is complete no matter how far setup got. No tasks are
      // ever spawned against this engagement, but tasksForEngagement is
      // swept anyway for parity with the T3 idiom in case that changes.
      const engToClean145Files = (await allEngagements()).find((e) => e.name === ENG_NAME_145FILES);
      if (engToClean145Files) {
        for (const t of await tasksForEngagement(engToClean145Files.id)) await removeTask(t.id);
        await softDeleteDoc("consulting_engagements", engToClean145Files.id);
      }
    }
  }

  /* ====== #145 Task 15 review — setMilestonePhase + applyMilestoneTaskShifts ======
   * DB-backed (async, doc-store), same idiom as the block above: a fixed
   * fixture name declared outside the try, find-or-create, and a finally
   * that re-queries by that fixed name and tears down every task and the
   * engagement itself — this may be the one real Neon database shared
   * across Production/Preview/Development (AGENTS.md).
   *
   * Covers the two write paths pulled out of "use server" actions
   * specifically so they're callable here without a request context
   * (requireUser() throws "headers was called outside a request scope"
   * outside one): setMilestonePhase's reject-a-foreign-phaseId path (the
   * validate-before-write half of the milestone phase dropdown, D168),
   * and applyMilestoneTaskShifts's null-phase branch (the manual-
   * checklist half of a milestone move, D168) — moveMilestoneAction's own
   * DB-backed integration is not re-tested here; this is the unit the
   * ternary actually dispatches to. */
  {
    const ENG_NAME_145MS = "Test milestone-phase engagement (#145)";
    try {
      const eng145ms =
        (await allEngagements()).find((e) => e.name === ENG_NAME_145MS) ||
        (await createManualEngagement(
          { customerId: "test-customer-145ms", customer: "Test MS Co", name: ENG_NAME_145MS, phases: ["Assessment", "Design Development"] },
          { name: "test-harness" }
        ));
      const realPhaseId = eng145ms.phases.find((p) => p.name === "Design Development")!.id;

      /* ---- setMilestonePhase: validate-before-write ---- */
      await patchEngagement(eng145ms.id, (d) => {
        if (!d.milestones.some((m) => m.id === "ms-145-test")) {
          d.milestones.push({ id: "ms-145-test", name: "Test milestone", targetDate: 0, completedAt: null, amount: null, phaseId: null });
        }
      });

      const rejectForeign145ms = await setMilestonePhase(eng145ms.id, "ms-145-test", "ph-not-on-this-engagement");
      ok(!rejectForeign145ms.ok, "#145 setMilestonePhase refuses a phaseId that isn't one of the engagement's own phases");
      const afterReject145ms = await getEngagement(eng145ms.id);
      ok(
        afterReject145ms?.milestones.find((m) => m.id === "ms-145-test")?.phaseId == null,
        "#145 setMilestonePhase's rejected write never touched the milestone — it still reads null, not the foreign id"
      );

      const acceptReal145ms = await setMilestonePhase(eng145ms.id, "ms-145-test", realPhaseId);
      ok(acceptReal145ms.ok, "#145 setMilestonePhase accepts a phaseId that IS one of the engagement's own phases");
      const afterAccept145ms = await getEngagement(eng145ms.id);
      ok(
        afterAccept145ms?.milestones.find((m) => m.id === "ms-145-test")?.phaseId === realPhaseId,
        "#145 setMilestonePhase's accepted write actually persisted the real phaseId"
      );

      const clearBack145ms = await setMilestonePhase(eng145ms.id, "ms-145-test", null);
      ok(clearBack145ms.ok, "#145 setMilestonePhase accepts null — clearing back to \"No phase\" is always valid");

      const missingMs145 = await setMilestonePhase(eng145ms.id, "ms-does-not-exist-145", realPhaseId);
      ok(missingMs145.ok, "#145 setMilestonePhase no-ops (still {ok:true}) on a milestone id that doesn't exist, rather than throwing");

      /* ---- applyMilestoneTaskShifts: the null-phase manual-checklist branch ---- */
      const dayMs145 = 86400000;
      const tPhase145 = await createTask(
        {
          title: "#145 MS test — DD-phase task",
          engagementId: eng145ms.id,
          startAt: 1000 * dayMs145,
          dueAt: 1010 * dayMs145,
          schedule: { phaseId: realPhaseId, startPct: 0, lengthPct: 50 },
          handScheduled: false,
        },
        { id: "u1", name: "Test Harness" }
      );
      const tManual145 = await createTask(
        {
          title: "#145 MS test — no-schedule task",
          engagementId: eng145ms.id,
          startAt: 2000 * dayMs145,
          dueAt: 2010 * dayMs145,
          schedule: null,
          handScheduled: false,
        },
        { id: "u1", name: "Test Harness" }
      );

      const tasksForShift145 = await tasksForEngagement(eng145ms.id);
      const delta145 = 7 * dayMs145;
      // Only tManual145 is ticked. A null-phase milestone has no phase to
      // infer membership from — before this fix, moveMilestoneAction's own
      // shiftForMilestone({phaseId:null},...) call always returned
      // moved: [], so ticking ANY id here would have moved NOTHING.
      const movedCount145 = await applyMilestoneTaskShifts({ phaseId: null }, delta145, [tManual145.id], tasksForShift145);
      ok(movedCount145 === 1, "#145 applyMilestoneTaskShifts(null phase) moves exactly the ticked id, not zero and not every task");

      const tManualAfter145 = await getTask(tManual145.id);
      ok(
        tManualAfter145?.startAt === 2000 * dayMs145 + delta145 && tManualAfter145?.dueAt === 2010 * dayMs145 + delta145,
        "#145 applyMilestoneTaskShifts actually wrote the shifted dates onto the ticked task, not just counted it"
      );
      const tPhaseAfter145 = await getTask(tPhase145.id);
      ok(
        tPhaseAfter145?.startAt === 1000 * dayMs145 && tPhaseAfter145?.dueAt === 1010 * dayMs145,
        "#145 applyMilestoneTaskShifts(null phase) never touches an UN-ticked task, even one with a real phase schedule"
      );

      // Phase-matched branch, for the same call site: ticking the
      // schedule-matched task under a REAL phaseId still moves it (via
      // shiftForMilestone, not shiftTasksByIds) — regression check that
      // the null-phase branch didn't change this path's behavior.
      const movedPhase145 = await applyMilestoneTaskShifts({ phaseId: realPhaseId }, delta145, [tPhase145.id], tasksForShift145);
      ok(movedPhase145 === 1, "#145 applyMilestoneTaskShifts(real phase) still moves its own phase's ticked task");

      ok(
        (await applyMilestoneTaskShifts({ phaseId: null }, delta145, [], tasksForShift145)) === 0,
        "#145 applyMilestoneTaskShifts is a no-op on an empty id list, either branch"
      );
    } finally {
      const engToClean145ms = (await allEngagements()).find((e) => e.name === ENG_NAME_145MS);
      if (engToClean145ms) {
        for (const t of await tasksForEngagement(engToClean145ms.id)) await removeTask(t.id);
        await softDeleteDoc("consulting_engagements", engToClean145ms.id);
      }
    }
  }

  /* ---- #145 D169 review (Important 1) — the task_templates CSV writer,
   * for real: commitImport/exportCsv actually write and read the store, so
   * this cleans up every fixture it creates on every exit path (success OR
   * a mid-test throw) — this repo shares one database across Production,
   * Preview and Development (AGENTS.md). Fixture names are prefixed
   * "ZZ-TEST-145-T10" so they can't collide with real data or another
   * agent's fixtures in a sibling worktree. */
  {
    const ttType10 = getTypeMeta("task_templates");
    if (!ttType10) throw new Error("#145 T10 setup: task_templates import type not registered");
    const SET_A_145T10 = "ZZ-TEST-145-T10 Round Trip";
    const SET_B_145T10 = "ZZ-TEST-145-T10 Collision";
    const SET_SKIP_145T10 = "ZZ-TEST-145-T10 Skip New";
    const SET_APPLIES_145T10 = "ZZ-TEST-145-T10 Applies";
    const SET_RT_145T10 = "ZZ-TEST-145-T10 Round Trip Targets";
    const ALL_SETS_145T10 = [SET_A_145T10, SET_B_145T10, SET_SKIP_145T10, SET_APPLIES_145T10, SET_RT_145T10];
    const rowsFor145T10 = (csv: string) => {
      const parsed = parseImportCsv(csv);
      if (!parsed.ok) throw new Error("#145 T10 setup: csv did not parse — " + parsed.error);
      const mapping = autoMap(parsed.headers, ttType10.fields);
      return prepareRows(parsed.rows, mapping, ttType10.fields).rows;
    };
    try {
      /* -- replace-by-set: re-import must not double, and must shrink when a line is dropped -- */
      const csv2Lines145T10 = [
        "Template Set,Applies To,Phase,Discipline,Task,Section,Assign To,Start %,Length %",
        `${SET_A_145T10},consulting,Assessment,rigging,Line One,Assessment,team,0,50`,
        `${SET_A_145T10},consulting,Assessment,,Line Two,Assessment,team,50,50`,
      ].join("\n");
      const created145t10 = await commitImport("task_templates", rowsFor145T10(csv2Lines145T10), "create", { effectiveAt: Date.now() });
      ok(
        created145t10.created === 2 && created145t10.errored === 0,
        "#145 T10 a 2-line file for a brand-new set commits both rows through create() (row 2 finds row 1's fresh record via the in-commit accumulator, not the generic dedupe)"
      );
      const afterCreate145t10 = (await allTaskTemplateSets()).find((s) => s.name === SET_A_145T10);
      ok(!!afterCreate145t10 && afterCreate145t10.lines.length === 2, "#145 T10 the new set holds both lines");

      const updated145t10 = await commitImport("task_templates", rowsFor145T10(csv2Lines145T10), "update", { effectiveAt: Date.now() });
      ok(updated145t10.updated === 2 && updated145t10.errored === 0, "#145 T10 re-importing the identical file in update mode touches both rows");
      const afterReimport145t10 = (await allTaskTemplateSets()).find((s) => s.name === SET_A_145T10);
      ok(
        afterReimport145t10?.lines.length === 2,
        "#145 T10 replace-by-set: re-importing the SAME rows does not double the lines (still 2, not 4 — the append-on-reimport bug this decision exists to prevent)"
      );

      const csv1Line145T10 = [
        "Template Set,Applies To,Phase,Discipline,Task,Section,Assign To,Start %,Length %",
        `${SET_A_145T10},consulting,Assessment,rigging,Line One,Assessment,team,0,50`,
      ].join("\n");
      await commitImport("task_templates", rowsFor145T10(csv1Line145T10), "update", { effectiveAt: Date.now() });
      const afterDrop145t10 = (await allTaskTemplateSets()).find((s) => s.name === SET_A_145T10);
      ok(
        afterDrop145t10?.lines.length === 1 && afterDrop145t10.lines[0]?.title === "Line One",
        "#145 T10 replace-by-set: dropping a line from the file shrinks the stored set to match — wholesale replace, not merge"
      );

      /* -- create mode against an EXISTING name mints a SECOND, distinct set (Critical fix) -- */
      const csvB145T10 = [
        "Template Set,Applies To,Phase,Discipline,Task,Section,Assign To,Start %,Length %",
        `${SET_B_145T10},project,,,Original Line,,team,0,100`,
      ].join("\n");
      await commitImport("task_templates", rowsFor145T10(csvB145T10), "create", { effectiveAt: Date.now() });
      const original145t10 = (await allTaskTemplateSets()).filter((s) => s.name === SET_B_145T10);
      ok(original145t10.length === 1 && original145t10[0].lines.length === 1, "#145 T10 setup: the first Collision set exists with its one original line");

      const csvBCollide145T10 = [
        "Template Set,Applies To,Phase,Discipline,Task,Section,Assign To,Start %,Length %",
        `${SET_B_145T10},project,,,Second Set Line One,,team,0,50`,
        `${SET_B_145T10},project,,,Second Set Line Two,,team,50,50`,
      ].join("\n");
      const collideRes145t10 = await commitImport("task_templates", rowsFor145T10(csvBCollide145T10), "create", { effectiveAt: Date.now() });
      ok(
        collideRes145t10.created === 2 && collideRes145t10.errored === 0,
        "#145 T10 create mode against a colliding name still reports success for both rows (one NEW set minted, its second row appended to it — not the original)"
      );
      const afterCollide145t10 = (await allTaskTemplateSets()).filter((s) => s.name === SET_B_145T10);
      ok(
        afterCollide145t10.length === 2,
        "#145 T10 Critical fix: create mode against an existing set name mints a SECOND, distinct set — it never merges into (and so never destroys) the original"
      );
      const untouchedOriginal145t10 = afterCollide145t10.find((s) => s.lines.length === 1 && s.lines[0]?.title === "Original Line");
      ok(!!untouchedOriginal145t10, "#145 T10 the ORIGINAL Collision set's line is untouched by the colliding create");
      const newSecondSet145t10 = afterCollide145t10.find((s) => s.lines.length === 2);
      ok(
        !!newSecondSet145t10 && newSecondSet145t10.lines.every((l) => l.title.startsWith("Second Set Line")),
        "#145 T10 the newly-minted second set holds exactly the colliding file's own 2 lines"
      );

      /* -- skip mode against a BRAND-NEW multi-line set creates every row, not just the first -- */
      const csvSkipNew145T10 = [
        "Template Set,Applies To,Phase,Discipline,Task,Section,Assign To,Start %,Length %",
        `${SET_SKIP_145T10},project,,,Skip Line One,,team,0,50`,
        `${SET_SKIP_145T10},project,,,Skip Line Two,,team,50,50`,
      ].join("\n");
      const skipNewRes145t10 = await commitImport("task_templates", rowsFor145T10(csvSkipNew145T10), "skip", { effectiveAt: Date.now() });
      ok(
        skipNewRes145t10.created === 2 && skipNewRes145t10.skipped === 0,
        "#145 T10 skip mode against a BRAND-NEW multi-line set still creates every row (find() hides this-commit creations, so row 2 can't find-and-skip row 1's fresh record)"
      );
      const skipNewSet145t10 = (await allTaskTemplateSets()).find((s) => s.name === SET_SKIP_145T10);
      ok(skipNewSet145t10?.lines.length === 2, "#145 T10 ...and the set ends up holding both lines");

      const skipAgainRes145t10 = await commitImport("task_templates", rowsFor145T10(csvSkipNew145T10), "skip", { effectiveAt: Date.now() });
      ok(skipAgainRes145t10.skipped === 2 && skipAgainRes145t10.created === 0, "#145 T10 skip mode against that NOW pre-existing set skips every row on the next import");

      /* -- a blank Applies To column preserves what the set already has (Important 3) -- */
      const csvAppliesSet145T10 = [
        "Template Set,Applies To,Phase,Discipline,Task,Section,Assign To,Start %,Length %",
        `${SET_APPLIES_145T10},"consulting, project",,,Has Applies,,team,0,100`,
      ].join("\n");
      await commitImport("task_templates", rowsFor145T10(csvAppliesSet145T10), "create", { effectiveAt: Date.now() });
      const beforeBlank145t10 = (await allTaskTemplateSets()).find((s) => s.name === SET_APPLIES_145T10);
      ok(
        !!beforeBlank145t10 &&
          beforeBlank145t10.appliesTo.length === 2 &&
          beforeBlank145t10.appliesTo.includes("consulting") &&
          beforeBlank145t10.appliesTo.includes("project"),
        "#145 T10 setup: the Applies set starts out applying to both consulting and project"
      );
      const csvAppliesBlank145T10 = [
        "Template Set,Applies To,Phase,Discipline,Task,Section,Assign To,Start %,Length %",
        `${SET_APPLIES_145T10},,,,Has Applies,,team,0,100`,
      ].join("\n");
      await commitImport("task_templates", rowsFor145T10(csvAppliesBlank145T10), "update", { effectiveAt: Date.now() });
      const afterBlank145t10 = (await allTaskTemplateSets()).find((s) => s.name === SET_APPLIES_145T10);
      ok(
        !!afterBlank145t10 &&
          afterBlank145t10.appliesTo.length === 2 &&
          afterBlank145t10.appliesTo.includes("consulting") &&
          afterBlank145t10.appliesTo.includes("project"),
        "#145 T10 Important 3 fix: re-importing with a BLANK Applies To column preserves the set's existing appliesTo instead of wiping it to nothing (which would drop it from every \"Apply template\" picker)"
      );

      /* -- export -> re-import round trip reproduces role/person targets exactly (decision 4) -- */
      const users145t10 = await activeUsers();
      const person145t10 = users145t10[0];
      if (!person145t10) throw new Error("#145 T10 setup: no active user in seed data to round-trip a person target against");
      const csvRT145T10 = [
        "Template Set,Applies To,Phase,Discipline,Task,Section,Assign To,Start %,Length %",
        `${SET_RT_145T10},consulting,Assessment,rigging,Role Line,Assessment,role:Estimator,10,30`,
        `${SET_RT_145T10},consulting,Assessment,,Person Line,Assessment,person:${person145t10.name},40,60`,
      ].join("\n");
      await commitImport("task_templates", rowsFor145T10(csvRT145T10), "create", { effectiveAt: Date.now() });
      const beforeRT145t10 = (await allTaskTemplateSets()).find((s) => s.name === SET_RT_145T10);
      ok(!!beforeRT145t10 && beforeRT145t10.lines.length === 2, "#145 T10 setup: the round-trip-targets set has its 2 lines");

      const exportedAll145t10 = await exportCsv("task_templates");
      const exportedHeader145t10 = exportedAll145t10.split("\n")[0];
      const exportedRTLines145t10 = exportedAll145t10.split("\n").filter((l) => l.startsWith(SET_RT_145T10 + ","));
      ok(exportedRTLines145t10.length === 2, "#145 T10 export emits one row per line, including the role/person target lines");
      ok(
        exportedRTLines145t10.some((l) => l.includes("role:Estimator")) &&
          exportedRTLines145t10.some((l) => l.includes(`person:${person145t10.name}`)),
        "#145 T10 export reproduces the role: and person:<name> cells exactly — assignTargetToCell is the true reverse of parseAssignTarget"
      );

      const miniRT145t10 = [exportedHeader145t10, ...exportedRTLines145t10].join("\n");
      const rtRes145t10 = await commitImport("task_templates", rowsFor145T10(miniRT145t10), "update", { effectiveAt: Date.now() });
      ok(rtRes145t10.updated === 2 && rtRes145t10.errored === 0, "#145 T10 re-importing the exported round-trip rows commits cleanly");
      const afterRT145t10 = (await allTaskTemplateSets()).find((s) => s.name === SET_RT_145T10);
      const roleLineRT145t10 = afterRT145t10?.lines.find((l) => l.title === "Role Line");
      const personLineRT145t10 = afterRT145t10?.lines.find((l) => l.title === "Person Line");
      ok(
        roleLineRT145t10?.target.kind === "role" && roleLineRT145t10.target.role === "Estimator",
        "#145 T10 export -> re-import round-trips a role target to the SAME role"
      );
      ok(
        personLineRT145t10?.target.kind === "person" && personLineRT145t10.target.userId === person145t10.id,
        "#145 T10 export -> re-import round-trips a person target to the SAME user id, re-resolved by name"
      );
    } finally {
      // Teardown: re-queried by fixed fixture names rather than trusting
      // local variables to have survived an early throw, so cleanup is
      // complete no matter how far setup got — same idiom as the #145 T3
      // cleanup above, applied to every fixture this block can create
      // (including the SECOND Collision set the Critical-fix test mints).
      for (const name of ALL_SETS_145T10) {
        for (const s of (await allTaskTemplateSets()).filter((s) => s.name === name)) {
          await removeTaskTemplateSet(s.id);
        }
      }
    }
  }

  /* --- #158 Task 2: ports persist through the catalog edit form --- */
  {
    const { mergeUpsert, get: getCatalogPart } = await import("@/lib/stores/catalog");
    const { parsePortsField } = await import("@/lib/catalog-ports");

    try {
      await mergeUpsert("TEST:PORTS-1", { desc: "Ports test device", category: "Speakers", unit: "ea", list: 100, cost: 50 });

      const parsed = parsePortsField(JSON.stringify([
        { name: "Audio in", direction: "in", connectionType: "speakON NL4" },
        { name: "Link out", direction: "out", connectionType: "speakON NL4" },
      ]));
      ok(parsed.ok === true, "ports/db: the fixture rows parse");
      if (parsed.ok) await mergeUpsert("TEST:PORTS-1", { ports: parsed.ports });

      const saved = await getCatalogPart("TEST:PORTS-1");
      ok((saved?.ports || []).length === 2, "ports/db: ports persist on the part");
      ok(saved?.desc === "Ports test device", "ports/db: saving ports leaves the other fields alone");

      // The clearing contract: an explicit empty array must wipe them, because
      // mergeUpsert only overwrites keys the patch actually carries.
      await mergeUpsert("TEST:PORTS-1", { ports: [] });
      const cleared = await getCatalogPart("TEST:PORTS-1");
      ok((cleared?.ports || []).length === 0, "ports/db: an explicit empty array clears the ports");

      // …and a patch that omits `ports` must NOT disturb them.
      if (parsed.ok) await mergeUpsert("TEST:PORTS-1", { ports: parsed.ports });
      await mergeUpsert("TEST:PORTS-1", { note: "price checked" });
      const untouched = await getCatalogPart("TEST:PORTS-1");
      ok((untouched?.ports || []).length === 2, "ports/db: a save that omits ports leaves them in place");
    } finally {
      // Teardown: same idiom as the #145 T10 cleanup just above — remove the
      // fixture regardless of how far setup got, so a throw mid-block doesn't
      // leave TEST:PORTS-1 behind in the catalog store.
      await softDeleteDoc("catalog_parts", "TEST:PORTS-1");
    }
  }

  /* --- #158 Task 5: a part edited through the form is wireable in The Grid --- */
  {
    const { mergeUpsert, get: getCatalogPart } = await import("@/lib/stores/catalog");
    const { parsePortsField } = await import("@/lib/catalog-ports");
    const { validateDeviceWire } = await import("@/lib/catalog-connect");

    const amp = parsePortsField(JSON.stringify([{ name: "Speaker out", direction: "out", connectionType: "speakON NL4", count: 4 }]));
    const box = parsePortsField(JSON.stringify([{ name: "Input", direction: "in", connectionType: "speakON NL4" }]));
    const hdmi = parsePortsField(JSON.stringify([{ name: "HDMI in", direction: "in", connectionType: "HDMI" }]));
    ok(amp.ok && box.ok && hdmi.ok, "ports/wire: fixtures parse");
    if (amp.ok && box.ok && hdmi.ok) {
      try {
        await mergeUpsert("TEST:AMP", { desc: "Test amp", category: "Audio Controls", unit: "ea", list: 1, cost: 1, ports: amp.ports });
        await mergeUpsert("TEST:SPK", { desc: "Test speaker", category: "Speakers", unit: "ea", list: 1, cost: 1, ports: box.ports });
        await mergeUpsert("TEST:TV", { desc: "Test display", category: "Video", unit: "ea", list: 1, cost: 1, ports: hdmi.ports });

        const a = await getCatalogPart("TEST:AMP");
        const s = await getCatalogPart("TEST:SPK");
        const t = await getCatalogPart("TEST:TV");

        const good = validateDeviceWire({ ports: a?.ports || [] }, { ports: s?.ports || [] });
        ok(good.ok === true, "ports/wire: a part edited through the form wires to a compatible part");
        if (good.ok) ok(good.connectionType === "speakON NL4", "ports/wire: the route stamps the shared connection type");

        const bad = validateDeviceWire({ ports: a?.ports || [] }, { ports: t?.ports || [] });
        ok(bad.ok === false, "ports/wire: an incompatible pair is still refused");

        const countKept = (a?.ports || [])[0]?.count === 4;
        ok(countKept, "ports/wire: a multi-port count survives the store round trip");
      } finally {
        // Teardown: same idiom as the #158 Task 2 cleanup just above — remove
        // all three fixtures regardless of how far setup got, so a throw
        // mid-block doesn't leave them behind in the catalog store.
        await softDeleteDoc("catalog_parts", "TEST:AMP");
        await softDeleteDoc("catalog_parts", "TEST:SPK");
        await softDeleteDoc("catalog_parts", "TEST:TV");
      }
    }
  }

  /* --- #159 Task 5: applying named rules --- */
  {
    const { mergeUpsert, get: getPart } = await import("@/lib/stores/catalog");
    const { softDeleteDoc } = await import("@/db/doc-store");
    const { applyRules } = await import("@/lib/catalog-port-apply");
    try {
      await mergeUpsert("TEST:RULE-SPK", { desc: 'Passive 18" Installation Subwoofer. Black', category: "SB", unit: "ea", list: 1, cost: 1, mfr: "EAW" });
      await mergeUpsert("TEST:RULE-AMP", { desc: "RU 4 Channel ENERGY STAR amplifier", category: "Audio", unit: "ea", list: 1, cost: 1, mfr: "QSC" });
      await mergeUpsert("TEST:RULE-HAND", { desc: 'Passive 15" Installation Subwoofer. Black', category: "SB", unit: "ea", list: 1, cost: 1, mfr: "EAW",
        ports: [{ name: "Hand edited", direction: "in", connectionType: "speakON NL4" }] });
      // gate review (FIX 1, D200): a bare model number that HAPPENS to be a
      // rule keyword ("Passive") with no other prose. matchRule() alone would
      // still propose speaker-passive for it, but the REPORT never shows this
      // row (scripts/port-rules.ts's isModelish skips it), so apply must skip
      // it too — that gap (90 rows, 6%, written but never reviewed) was the
      // whole finding.
      await mergeUpsert("TEST:RULE-MODELISH", { desc: "Passive", category: "SB", unit: "ea", list: 1, cost: 1, mfr: "EAW" });

      // Every applyRules call below is scoped to exactly the four fixtures
      // above (gate review FIX 1). applyRules otherwise walks the whole
      // catalog_parts table, and `speaker-passive` matches 452 REAL parts —
      // with `commit: true` this block was one unset PGLITE_PATH away from
      // porting the live book from a test. A test may only write rows it
      // created.
      const FIXTURES = ["TEST:RULE-SPK", "TEST:RULE-AMP", "TEST:RULE-HAND", "TEST:RULE-MODELISH"] as const;

      const res = await applyRules(["speaker-passive"], { commit: true, onlySkus: FIXTURES });

      const spk = await getPart("TEST:RULE-SPK");
      ok((spk?.ports || []).length === 1 && spk?.ports?.[0].connectionType === "speakON NL2",
        "apply: a named rule ports the parts it matched");

      const amp = await getPart("TEST:RULE-AMP");
      ok((amp?.ports || []).length === 0, "apply: a rule that was NOT named leaves its parts alone");

      const hand = await getPart("TEST:RULE-HAND");
      ok(hand?.ports?.[0].name === "Hand edited", "apply: a hand-edited part is never overwritten (D196)");
      ok(res.skippedHasPorts >= 1, "apply: the result counts parts skipped for having ports");

      const modelish = await getPart("TEST:RULE-MODELISH");
      ok((modelish?.ports || []).length === 0,
        "apply: a bare model/part-number description is skipped, same as the report's isModelish filter (FIX 1, D200)");

      ok(res.applied === 1, "apply: the scoped run touched exactly the one fixture the rule matched, nothing else (gate review FIX 1)");

      // Idempotence, genuinely: the first run ported TEST:RULE-SPK, and this
      // scope contains nothing else speaker-passive can match, so a zero here
      // is the "already has ports" skip doing its job — not an empty scope.
      const again = await applyRules(["speaker-passive"], { commit: true, onlySkus: FIXTURES });
      ok(again.applied === 0, "apply: a second run is a no-op — idempotent");
      ok(again.skippedHasPorts >= 2, "apply: the second run skipped the now-ported part as well as the hand-edited one");

      const dry = await applyRules(["amplifier"], { commit: false, onlySkus: FIXTURES });
      ok(dry.applied > 0, "apply: a dry run reports what it would do");

      // The same rule + scope as `dry`, narrowed to a manufacturer the one
      // matching fixture (QSC) is not — so the drop to 0 is the filter, and
      // `--mfr=` now means the same thing in apply as it does in the report.
      const otherMfr = await applyRules(["amplifier"], { commit: false, onlySkus: FIXTURES, mfr: "EAW" });
      ok(otherMfr.applied === 0, "apply: an mfr filter excludes parts from other manufacturers (FIX 4)");
      const sameMfr = await applyRules(["amplifier"], { commit: false, onlySkus: FIXTURES, mfr: "QSC" });
      ok(sameMfr.applied === dry.applied, "apply: an mfr filter naming the matching brand changes nothing");
      const ampStill = await getPart("TEST:RULE-AMP");
      ok((ampStill?.ports || []).length === 0, "apply: a dry run writes nothing");
    } finally {
      await softDeleteDoc("catalog_parts", "TEST:RULE-SPK");
      await softDeleteDoc("catalog_parts", "TEST:RULE-AMP");
      await softDeleteDoc("catalog_parts", "TEST:RULE-HAND");
      await softDeleteDoc("catalog_parts", "TEST:RULE-MODELISH");
    }
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

// --- 3D preview archetype (regression guard) ---
// venue-3d.tsx used to pick its archetype off the flat `venueType` string via
// a ROOM_TYPES list. With the class model in place a new record's venueType is
// a class LABEL ("Gym", "Church", …), which that list never matched — so every
// new non-theatre assessment drew a proscenium. venueArchetype() replaces it.
ok(venueArchetype("theatre", "Single proscenium") === "proscenium", "theatre + proscenium -> proscenium");
ok(venueArchetype("theatre", "Studio theatre") === "proscenium", "theatre + studio -> proscenium");
ok(venueArchetype("theatre", "Black box / flexible") === "room", "theatre + black box -> room");
ok(venueArchetype("theatre", "Thrust / arena") === "room", "theatre + thrust/arena -> room");
ok(venueArchetype("auditorium", "Single proscenium") === "proscenium", "auditorium + proscenium -> proscenium");
ok(venueArchetype("auditorium", "Multi-purpose (cafetorium)") === "proscenium", "auditorium + cafetorium -> proscenium");
ok(venueArchetype("auditorium", "Black box / flexible") === "room", "auditorium + black box -> room");
ok(venueArchetype("auditorium", "Thrust / arena") === "room", "auditorium + thrust/arena -> room");
ok(venueArchetype("church", "Sanctuary — traditional") === "room", "church -> room");
ok(venueArchetype("gym", "Multi-purpose (has stage)") === "room", "gym -> room");
ok(venueArchetype("convention", "Ballroom / multi-purpose") === "room", "convention -> room");
ok(venueArchetype("other", "") === "room", "other -> room");
ok(
  VENUE_CLASSES.every((c) =>
    (SUBTYPES[c.key].length ? SUBTYPES[c.key] : [""]).every((sub) => {
      const a = venueArchetype(c.key, sub);
      return a === "room" || a === "proscenium";
    })
  ),
  "every class/subtype pair resolves to a known archetype"
);

// The assertion that actually proves no regression: for each of the seven
// legacy venue types, the class-model archetype must equal what the old
// ROOM_TYPES.includes() check produced.
{
  const LEGACY_ROOM_TYPES = [
    "Black box", "Worship / sanctuary", "Gymnasium / gym stage",
    "Arena", "Multipurpose room", "Outdoor / amphitheater",
  ];
  const LEGACY_VENUE_TYPES = ["Proscenium theater", ...LEGACY_ROOM_TYPES];
  ok(LEGACY_VENUE_TYPES.length === 7, "seven legacy venue types under trace");
  for (const legacy of LEGACY_VENUE_TYPES) {
    const before = LEGACY_ROOM_TYPES.includes(legacy) ? "room" : "proscenium";
    const after = venueArchetype(venueClassFor(legacy), venueSubtypeFor(legacy));
    ok(after === before, `legacy "${legacy}" still renders ${before} (got ${after})`);
  }
}
// No class may invent a key that duplicates an existing one under a new name.
const RESERVED = ["proW","proH","stageDepth","gridH","wingSL","wingSR","houseH","seating","boothLoc","boothWD","apron","centerAisleW","platformWidth","platformDepth","roomWidth","roomDepth","pitDepth"];
ok(
  VENUE_CLASSES.every((c) =>
    classMeasureFields(c.key).every((f) => !/^(prosceniumWidth|stageW|ceilingHeight|houseHeight)$/.test(f.key))
  ),
  "no class re-invents a reserved dimension under a new key name"
);
ok(RESERVED.length === 17, "reserved key list is the spec's list");


/* --- Venue Assessments: linesets --- */
ok(LINESET_TYPES.map((t) => t.key).join("") === "DMRLBCSETO", "type legend is the sheet's D M R L B C S E T O");
ok(LINESET_CONDS.map((c) => c.key).join("") === "GFPX", "condition legend is the sheet's G F P X");
ok(linesetTypeLabel("D") === "Draw / main", "D is draw/main");
ok(linesetTypeLabel("O") === "Open / spare", "O is open/spare");
ok(linesetCondLabel("X") === "Missing / inoperable", "X is missing/inoperable");
ok(linesetTypeLabel("Z" as never) === "", "unknown type code renders empty, never throws");
ok(linesetCondLabel("Z" as never) === "", "unknown cond code renders empty, never throws");
const lsr = blankLinesetRow(3);
ok(lsr.pos === "3", "blank row carries its position as a string");
ok(lsr.type === "" && lsr.cond === "", "blank row starts unrated and untyped");
ok(
  ["id","pos","distFromPL","setName","type","battenLength","liftLines","goods","finishedWH","arborLoad","trimLow","trimHigh","cond","notes"]
    .every((k) => k in lsr),
  "blank row has all 14 Theatre-superset columns"
);
ok(Object.keys(lsr).length === 14, `blank row has exactly 14 keys (got ${Object.keys(lsr).length})`);
ok(newLinesetId() !== newLinesetId(), "lineset ids are unique");
ok(nextLinesetPosition([]) === 1, "an empty schedule starts at physical position 1");
ok(
  nextLinesetPosition([{ ...blankLinesetRow(1), pos: "1" }, { ...blankLinesetRow(3), pos: "3" }]) === 4,
  "adding after a deletion never duplicates an existing physical position"
);


/* --- Venue Assessments: assessment layer --- */
ok(CONDITION_CATEGORIES.length === 10, `ten condition categories (got ${CONDITION_CATEGORIES.length})`);
ok(
  CONDITION_CATEGORIES.map((c) => c.key).join(",") ===
    "rigging,curtains,motors,lighting.console,lighting.dimming,lighting.fixtures,av.console,av.speakers,av.mics,av.video",
  "categories in brief order"
);
ok(
  !CONDITION_CATEGORIES.some((c) => c.key.startsWith("electrical")),
  "electrical is NOT a rated category — brief says outside Peak's lane"
);
ok(CONDITION_RATINGS.map((r) => r.key).join(",") === "good,monitor,replace", "Good/Monitor/Replace scale");
ok(CONDITION_GROUPS.length === 3, "condition ratings render under the brief's three headings");
ok(
  CONDITION_GROUPS.flatMap((group) => group.categories).sort().join(",") ===
    CONDITION_CATEGORIES.map((category) => category.key).sort().join(","),
  "the three condition headings cover every rated category exactly once"
);
ok(BUDGET_TIERS.length === 4, "four budget tiers");
ok(BUDGET_TIERS[0].key === "u5k" && BUDGET_TIERS[3].key === "over100k", "budget tiers span <$5k to $100k+");
ok(FINDING_BUCKETS.map((b) => b.key).join(",") === "now,soon,later", "Now/Soon/Later buckets");
ok(EVENT_TYPES.length === 6, "six event types incl. other");
ok(EVENT_FREQUENCIES.length === 4, "four frequencies");
ok(STAFF_TIERS.length === 4, "four staff capability tiers");
ok(GROWTH_GOALS.length === 5, "five growth goals incl. other");

const a0 = blankAssessment();
ok(Object.keys(a0.conditions).length === 10, "blank assessment has all ten categories");
ok(
  CONDITION_CATEGORIES.every((c) => a0.conditions[c.key].rating === ""),
  "blank assessment starts every category unrated"
);
ok(a0.findings.length === 0, "blank assessment has no findings");
ok(a0.electricalNotes === "", "blank assessment has an electrical notes field");
const usageWithEvent = toggleEventType(a0.usage, "theatrical", true);
ok(
  usageWithEvent.eventTypes.length === 1 && usageWithEvent.eventTypes[0].frequency === "",
  "checking an event type adds one empty frequency row"
);
ok(
  toggleEventType(usageWithEvent, "theatrical", false).eventTypes.length === 0,
  "unchecking an event type removes its frequency row"
);
ok(
  toggleGrowthGoal(a0.usage, "More community rentals").growthGoals.join("") === "More community rentals",
  "growth-goal toggles add the selected goal"
);

// good is never flagged; monitor and replace each seed one line
const a1 = blankAssessment();
a1.conditions.rigging.rating = "good";
a1.conditions.curtains.rating = "monitor";
a1.conditions.curtains.notes = "Main shows daylight at the seams";
a1.conditions["av.mics"].rating = "replace";
const r1 = seedFindings(a1);
ok(r1.seeded.length === 2, `two flagged categories seed two findings (got ${r1.seeded.length})`);
ok(!r1.seeded.some((f) => f.categories.includes("rigging")), "a 'good' category never seeds a finding");
const curtainFinding = r1.seeded.find((f) => f.categories.includes("curtains"));
ok(!!curtainFinding, "curtains seeded a finding");
ok(curtainFinding!.title === "Curtains / Soft Goods", "seeded title is the category label");
ok(curtainFinding!.detail === "Main shows daylight at the seams", "seeded detail is the category notes");
ok(curtainFinding!.bucket === "", "seeded finding starts with no bucket — the assessor decides");
ok(curtainFinding!.budgetTier === "", "seeded finding starts with no budget tier");
ok(r1.unresolved.length === 0, "freshly seeded findings leave nothing unresolved");

// already-covered categories are not re-seeded, and merging is honoured
const a2 = blankAssessment();
a2.conditions["lighting.console"].rating = "replace";
a2.conditions["lighting.dimming"].rating = "replace";
a2.findings = [{
  id: "f1", categories: ["lighting.console", "lighting.dimming"], bucket: "now",
  title: "Lighting system replacement", detail: "", budgetTier: "25to100k", photoIds: [],
}];
const r2 = seedFindings(a2);
ok(r2.seeded.length === 0, "a merged finding suppresses re-seeding of both its categories");
ok(r2.unresolved.length === 0, "a merged finding leaves nothing unresolved");

// a flagged category with no covering finding is reported as a gap
const a3 = blankAssessment();
a3.conditions.motors.rating = "monitor";
a3.conditions.curtains.rating = "replace";
a3.findings = [{
  id: "f9", categories: ["curtains"], bucket: "soon",
  title: "Curtain replacement", detail: "", budgetTier: "5to25k", photoIds: [],
}];
ok(seedFindings(a3).unresolved.join(",") === "motors", "an uncovered flagged category is unresolved");
ok(seedFindings(a3).seeded.length === 0, "no silent re-seeding once the assessor is driving");

const mergedFindings = mergeFindings([
  { id: "m1", categories: ["lighting.console"], bucket: "now", title: "Controls", detail: "", budgetTier: "u5k", photoIds: [] },
  { id: "m2", categories: ["lighting.dimming"], bucket: "soon", title: "Dimming", detail: "", budgetTier: "5to25k", photoIds: [] },
], "m1", "m2");
ok(
  mergedFindings.length === 1 && mergedFindings[0].categories.join(",") === "lighting.console,lighting.dimming",
  "merging combines category coverage without duplicates"
);
const splitFindings = splitFindingCategory(mergedFindings, "m1", "lighting.dimming");
ok(
  splitFindings.length === 2 && splitFindings.some((finding) => finding.categories.join("") === "lighting.dimming"),
  "splitting removes one category into its own editable finding"
);

// seedFindings must not mutate its input
const a4 = blankAssessment();
a4.conditions.rigging.rating = "replace";
seedFindings(a4);
ok(a4.findings.length === 0, "seedFindings is pure — it never mutates the assessment");
ok(newFindingId() !== newFindingId(), "finding ids are unique");


/* --- Venue Assessments: Tier-1 keys cover the new classes --- */
ok(TIER1_WIDTH_KEYS.includes("courtWidth"), "Tier-1 width accepts the gym's court width");
ok(TIER1_WIDTH_KEYS.includes("sanctuaryWidth"), "Tier-1 width accepts the church's sanctuary width");
ok(TIER1_DEPTH_KEYS.includes("courtLength"), "Tier-1 depth accepts the gym's court length");
ok(TIER1_DEPTH_KEYS.includes("sanctuaryLength"), "Tier-1 depth accepts the church's sanctuary length");
ok(
  tier1Complete({
    venue: "Lincoln HS Gym", contact: "Pat Lee",
    contactEmail: "p@x.org", contactPhone: "555-0100",
    measurements: { courtWidth: "50", courtLength: "84" },
  }),
  "a gym record completes Tier 1 on court dimensions alone"
);
ok(
  !tier1Complete({
    venue: "Lincoln HS Gym", contact: "Pat Lee",
    contactEmail: "p@x.org", contactPhone: "555-0100",
    measurements: { courtWidth: "50" },
  }),
  "a gym record missing court length does NOT complete Tier 1"
);

/* --- Venue Assessments: systems gating --- */
ok(DISCIPLINE_GROUPS.length === 4, "still four system sections");
ok(
  DISCIPLINE_GROUPS.every((g) => presentOptionsFor(g.key, "theatre").length > 0),
  "every system section has a PRESENT row on theatre"
);
ok(
  presentOptionsFor("curtain", "gym").includes("Divider curtain"),
  "gym curtains offer the sheet's divider curtain option"
);
ok(
  presentOptionsFor("curtain", "auditorium").includes("Main / act curtain"),
  "auditorium curtains offer the full soft-goods row"
);
ok(
  !presentOptionsFor("curtain", "gym").includes("Main / act curtain"),
  "gym does NOT offer auditorium-only soft goods"
);
ok(
  visibleFields(DISCIPLINE_GROUPS.find((g) => g.key === "lighting")!, "auditorium")
    .some((f) => f.key === "dmxUniverses"),
  "auditorium lighting asks DMX universes"
);
ok(
  !visibleFields(DISCIPLINE_GROUPS.find((g) => g.key === "lighting")!, "gym")
    .some((f) => f.key === "dmxUniverses"),
  "gym lighting does not ask DMX universes"
);
ok(
  visibleFields(DISCIPLINE_GROUPS.find((g) => g.key === "rigging")!, "auditorium")
    .some((f) => f.key === "fireCurtainPresent"),
  "auditorium rigging carries the fire curtain block"
);
ok(
  visibleFields(DISCIPLINE_GROUPS.find((g) => g.key === "lighting")!, "gym")
    .some((f) => f.key === "consoleMfr"),
  "every class asks console mfr/model"
);

/* --- Venue Assessments: certification auto-resolution --- */
const resolvedCerts = resolveCertsFromRecords(
  [
    { id: "FT-old", customerId: "c1", locationId: "l1", stage: "completed", completedAt: 1000 },
    { id: "FT-new", customerId: "c1", locationId: "l1", stage: "completed", completedAt: 2000 },
    { id: "FT-other", customerId: "c2", locationId: "l1", stage: "completed", completedAt: 3000 },
  ],
  [
    { id: "IN-old", customerId: "c1", locationId: "l1", stage: "completed", surveyDate: "2025-01-01", reportDate: "", updatedAt: 1000, level: 1 },
    { id: "IN-new", customerId: "c1", locationId: "l1", stage: "completed", surveyDate: "2026-01-01", reportDate: "", updatedAt: 2000, level: 2 },
  ],
  "c1",
  "l1"
);
ok(resolvedCerts.curtains?.recordId === "FT-new", "latest completed flame test resolves for the exact venue");
ok(resolvedCerts.rigging?.recordId === "IN-new", "latest completed inspection resolves for the exact venue");
ok(
  resolvedCerts.curtains?.source === "auto" && resolvedCerts.rigging?.onFile === "yes",
  "resolved references are attributable auto records, never inferred no-file answers"
);
ok(
  Object.keys(resolveCertsFromRecords([], [], null, "l1")).length === 0,
  "missing canonical customer identity resolves no certifications"
);

/* --- Venue Assessments: venue-class doctrine --- */
ok(
  DEFAULT_VENUE_DOCTRINE.theatre.confirmed === false &&
    DEFAULT_VENUE_DOCTRINE.church.confirmed === false,
  "theatre and church doctrine defaults retain the source-sheet caveat"
);
ok(
  DEFAULT_VENUE_DOCTRINE.gym.curtains ===
    "Encore 22 oz main + valance, Encore rest" &&
    DEFAULT_VENUE_DOCTRINE.gym.confirmed === true,
  "gym doctrine carries the confirmed Encore default"
);
const doctrineOverride = resolveVenueDoctrine({
  theatre: { curtains: "Custom theatre soft goods", lighting: "Custom desk", confirmed: true },
});
ok(
  doctrineOverride.theatre.curtains === "Custom theatre soft goods" &&
    doctrineOverride.theatre.confirmed === true,
  "stored venue doctrine overrides its class default"
);
ok(
  doctrineOverride.gym.curtains === DEFAULT_VENUE_DOCTRINE.gym.curtains,
  "a sparse doctrine override preserves defaults for the other classes"
);

/* --- Venue Assessments: printable field sheets --- */
for (const venueClass of VENUE_CLASSES.map((item) => item.key)) {
  const sheet = buildAssessmentSheet({
    id: `FS-${venueClass}`,
    venueClass,
    venue: `${venueClass} room`,
    customer: "Sheet test",
    measurements: {},
    disciplines: {},
    linesets: [],
    linesetsEnabled: false,
    lifeSafety: { deluge: "", smokeVent: "", adaNotes: "", egressNotes: "" },
    signoff: {
      repName: "Rep", repSignedAt: "2026-09-20",
      contactName: "Client", contactSignedAt: "2026-09-20",
      reviewerName: "", reviewerRole: "", reviewerSignedAt: "",
    },
    assessmentEnabled: false,
    assessment: blankAssessment(),
    templateRev: "5.1",
  } as any);
  ok(!!sheet.fieldSheet?.pages.length, `${venueClass} builds a paginated field sheet`);
  ok(
    sheet.fieldSheet?.pages.at(-1)?.sections.at(-1)?.heading === "Sign-off",
    `${venueClass} puts sign-off at the end of the final page`
  );
  ok(
    !sheet.fieldSheet?.pages.some((page) => page.title.startsWith("Assessment")),
    `${venueClass} omits assessment pages when the layer is off`
  );
  ok(
    sheet.fieldSheet?.footer === "Venue Assessment Rev. 5.1",
    `${venueClass} prints the template revision footer`
  );
  const sheetPdf = renderLetterPdf(sheet);
  ok(
    sheetPdf.subarray(0, 8).toString("latin1") === "%PDF-1.4",
    `${venueClass} field sheet renders to PDF bytes`
  );
}

/* --- pdf.ts: pagination (physical page count, footers, continuation headers) --- */
{
  // The writer deflate-compresses every page's content stream, so page text
  // isn't a plain substring of the file bytes — inflate each /FlateDecode
  // stream (skips the JPEG XObject, which uses /DCTDecode) to get at it.
  const pdfPageTexts = (buf: Buffer): string[] => {
    const raw = buf.toString("latin1");
    const re = /<<[^>]*\/Filter \/FlateDecode[^>]*>>\r?\nstream\r?\n/g;
    const texts: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      const start = m.index + m[0].length;
      const end = raw.indexOf("\nendstream", start);
      if (end < 0) continue;
      texts.push(inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1"));
    }
    return texts;
  };
  const pdfPageCount = (buf: Buffer): number =>
    (buf.toString("latin1").match(/\/Type \/Page \/Parent/g) || []).length;

  const baseLetterDoc: Omit<LetterDoc, "blocks"> = {
    companyName: "Peak Systems Group",
    accent: "#7b3f8a",
    tag: "Flame Test Proposal",
    meta: [
      { label: "Date:", value: "2026-09-24" },
      { label: "Venue:", value: "Test Venue" },
    ],
    re: "Flame testing for Test Venue",
    greeting: "Jeff",
    costLine: "The above services will cost $1,234.",
    costTail: "This total covers labor and materials as scoped above.",
    taxNote: "Sales tax, if required, will be billed at the local rate.",
    signer: { name: "Jeff Chesebro", title: "Owner", email: "jeff@example.com" },
  };

  // A short letter — well within one page — must render as a single page
  // with no footer at all (requirement: single-page output is unchanged).
  const shortBlocks: LetterBlock[] = [
    { kind: "p", text: "Thanks for the opportunity to quote this work." },
    { kind: "p", text: "We look forward to getting started." },
  ];
  const shortPdf = renderLetterPdf({ ...baseLetterDoc, blocks: shortBlocks });
  const shortTexts = pdfPageTexts(shortPdf);
  ok(pdfPageCount(shortPdf) === 1, "short letter: renders exactly one physical page");
  ok(shortTexts.length === 1, "short letter: exactly one content stream");
  ok(
    !shortTexts.some((t) => t.includes("Page 1 of")),
    "short letter: no page-number footer on a single-page document"
  );

  // A long letter — many paragraphs — must overflow to 2+ pages, each with
  // a "Page n of N" footer, and continuation pages get a running header.
  const longBlocks: LetterBlock[] = Array.from({ length: 40 }, (_, i): LetterBlock => ({
    kind: "p",
    text:
      `Paragraph ${i + 1}: this is a long enough sentence of filler proposal ` +
      `copy, repeated many times over, to reliably push the rendered letter ` +
      `past a single US Letter page and force at least one real page break ` +
      `during layout so the pagination logic under test actually engages.`,
  }));
  const longPdf = renderLetterPdf({ ...baseLetterDoc, blocks: longBlocks });
  const longTexts = pdfPageTexts(longPdf);
  const longPageCount = pdfPageCount(longPdf);
  ok(longPageCount >= 2, "long letter: overflows to 2+ physical pages");
  ok(longTexts.length === longPageCount, "long letter: one content stream per physical page");
  ok(
    longTexts.some((t) => t.includes("Page 1 of")),
    "long letter: page 1 carries a \"Page 1 of N\" footer"
  );
  ok(
    longTexts.some((t) => t.includes("continued")),
    "long letter: a continuation page carries the running \"continued\" header"
  );
  ok(
    longTexts.every((t, i) => t.includes(`Page ${i + 1} of ${longPageCount}`)),
    "long letter: every physical page's footer counts pages correctly and in order"
  );
}

/* --- pdf.ts: field-sheet pagination (physical footer counts, continued header) --- */
{
  const pdfPageTexts = (buf: Buffer): string[] => {
    const raw = buf.toString("latin1");
    const re = /<<[^>]*\/Filter \/FlateDecode[^>]*>>\r?\nstream\r?\n/g;
    const texts: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      const start = m.index + m[0].length;
      const end = raw.indexOf("\nendstream", start);
      if (end < 0) continue;
      texts.push(inflateSync(Buffer.from(raw.slice(start, end), "latin1")).toString("latin1"));
    }
    return texts;
  };
  const pdfPageCount = (buf: Buffer): number =>
    (buf.toString("latin1").match(/\/Type \/Page \/Parent/g) || []).length;

  const manyRows = Array.from({ length: 90 }, (_, i) => ({
    label: `Field ${i + 1}`,
    value: `Answer ${i + 1}`,
  }));
  const overflowPage: FieldSheetPage = {
    title: "Overflow Section Test",
    sections: [{ heading: "Big section", rows: manyRows }],
  };
  const overflowDoc: LetterDoc = {
    companyName: "Peak Systems Group",
    accent: "#7b3f8a",
    tag: "Field Sheet Test",
    meta: [], re: "", greeting: "", blocks: [], costLine: "", costTail: "", taxNote: "",
    signer: { name: "", title: "" },
    fieldSheet: { job: "TEST-1", date: "2026-09-24", footer: "Test footer", pages: [overflowPage] },
  };
  const overflowPdf = renderLetterPdf(overflowDoc);
  const overflowTexts = pdfPageTexts(overflowPdf);
  const overflowPageCount = pdfPageCount(overflowPdf);
  ok(overflowPageCount >= 2, "field sheet: an oversized logical page overflows to 2+ physical pages");
  ok(
    overflowTexts.every((t) => t.includes(`OF ${overflowPageCount}`)),
    "field sheet: the PAGE n OF N footer total counts physical, not logical, pages"
  );
  ok(
    overflowTexts.some((t, i) => i > 0 && t.includes(`PAGE ${i + 1} OF`)),
    "field sheet: physical continuation pages advance the page number"
  );
  ok(
    // parens in a PDF literal string are backslash-escaped by esc(), so the
    // title reads "...\(continued\)" in the raw content stream.
    overflowTexts.slice(1).some((t) => t.includes("continued")),
    "field sheet: an overflowed physical page redraws the header band as continued"
  );
}


/* ============================================================
   Recordings (Krisp) — spec docs/superpowers/specs/2026-09-21-krisp-
   recordings-design.md §1, §4, §6, §7. Pure rules + the store's DB-free
   helpers; the REST client's error mapping runs through a fake transport
   inside recordingsAsyncChecks() below.
   ============================================================ */

/* --- registration: doc table, sync allowlist mirror, settings defaults --- */
ok("recordings" in DOC_TABLES, "recordings is a registered doc collection");
ok(SYNCABLE_COLLECTIONS.includes("recordings"), "recordings is syncable (spec §1.1)");
ok(
  [...FIELD_COLLECTIONS].sort().join(",") === [...SYNCABLE_COLLECTIONS].sort().join(","),
  "FIELD_COLLECTIONS mirrors SYNCABLE_COLLECTIONS (engine.ts ↔ doc-tables.ts)"
);
ok(
  DEFAULT_SETTINGS.recordingsArchiveMailbox === null &&
    DEFAULT_SETTINGS.recordingsArchiveFolderId === null &&
    JSON.stringify(DEFAULT_SETTINGS.recordingsArchiveFolders) === "{}" &&
    Array.isArray(DEFAULT_SETTINGS.recordingsBetaUsers) &&
    (DEFAULT_SETTINGS.recordingsBetaUsers as string[]).length === 0,
  "recordings settings defaults are declared (spec §1.3)"
);
ok(canRecord("u1", { recordingsBetaUsers: [] }), "canRecord: empty beta list → everyone");
ok(canRecord("u1", { recordingsBetaUsers: ["u1", "u3"] }), "canRecord: listed user passes the gate");
ok(!canRecord("u2", { recordingsBetaUsers: ["u1", "u3"] }), "canRecord: unlisted user is gated");

/* Capture side (spec §2.2 / §2.3) — pure helpers behind the recorder page + upload queue (lib/recorder/helpers.ts). */
{
  const at = new Date(2026, 8, 21, 14, 5).getTime(); // local 2026-09-21
  ok(
    buildRecordingTitle({ parentId: "SV-5012", venue: "Hortonville HS", customer: "Hortonville Area SD", parentLabel: "Site visit", at }) ===
      "SV-5012 · Hortonville HS · Site visit · 2026-09-21",
    "buildRecordingTitle: id · venue · label · date"
  );
  ok(
    buildRecordingTitle({ parentId: "P-7001", venue: "", customer: "Acme Theatre", parentLabel: "Project", remember: "  rigging   walkthrough ", at }) ===
      "P-7001 · Acme Theatre · Project · rigging walkthrough · 2026-09-21",
    "buildRecordingTitle: venue falls back to customer; remember is squashed and slotted before the date"
  );
  const long = buildRecordingTitle({ parentId: "INS-4001", venue: "V", customer: "C", parentLabel: "Inspection", remember: "x".repeat(400), at });
  ok(long.length === RECORDING_TITLE_MAX && long.endsWith(" · 2026-09-21"), "buildRecordingTitle: caps at 200 by trimming the remember text, never the date");
  ok(
    uploadBackoffMs(0) === 0 && uploadBackoffMs(1) === 5_000 && uploadBackoffMs(2) === 15_000 && uploadBackoffMs(3) === 45_000 &&
      uploadBackoffMs(40) === UPLOAD_BACKOFF_MAX_MS,
    "uploadBackoffMs: 5s ×3 per attempt, capped at 15 min"
  );
  ok(
    recordingBlobPathname("REC-9001", "audio/mp4") === "recordings/REC-9001/REC-9001.m4a" &&
      extensionForMime("audio/webm;codecs=opus") === "webm" && extensionForMime("audio/x-wav") === "wav" && extensionForMime("nope/x") === "bin",
    "recordingBlobPathname keeps the route's recordings/<id>/ prefix and maps mimes to extensions"
  );
  ok(formatElapsed(0) === "00:00" && formatElapsed(65) === "01:05" && formatElapsed(3725) === "1:02:05", "formatElapsed mm:ss and h:mm:ss");
}
ok(
  recordingParentLabel("site_visit") === "Site visit" &&
    recordingParentLabel("survey") === "Field survey" &&
    recordingParentLabel("inspection") === "Inspection" &&
    recordingParentLabel("flame_job") === "Flame test" &&
    recordingParentLabel("repair_job") === "Repair" &&
    recordingParentLabel("project") === "Project" &&
    recordingParentLabel("engagement") === "Engagement",
  "recordingParentLabel covers every parent kind"
);

/* --- deriveSummary on the Hortonville-shaped fixture (spec §4.1) --- */
const hortonvilleNotes: { blocks: KrispNoteBlock[] } = {
  blocks: [
    {
      type: "heading",
      text: "Venue Identification and Address",
      children: [{ type: "paragraph", text: "Hortonville High School, 246 N Olk St, Hortonville WI 54944" }],
    },
    {
      type: "heading",
      text: "Rigging System",
      children: [
        { type: "bullet", text: "Counterweight fly system, 18 linesets" },
        {
          type: "bullet",
          text: "Arbor pit accessible",
          children: [{ type: "bullet", text: "Locking rail on stage left" }],
        },
      ],
    },
    {
      type: "heading",
      text: "Stage and Room Measurements",
      children: [
        { type: "paragraph", text: "Proscenium 42' wide x 20' high" },
        { type: "paragraph", text: "Grid height 58'" },
      ],
    },
    {
      type: "heading",
      text: "Next Steps",
      children: [
        {
          type: "action_item",
          text: "Send lineset quote",
          completed: false,
          assignee: { first_name: "Jeff", last_name: "Chesebro" },
          due_date: "2026-09-28",
        },
        { type: "action_item", text: "Confirm grid load rating", completed: false },
        { type: "action_item", text: "Schedule flame test", completed: false },
      ],
    },
    {
      type: "heading",
      text: "Key Points",
      children: [
        { type: "bullet", text: "Existing curtains are 20+ years old" },
        { type: "bullet", text: "Fly system last inspected 2019" },
        { type: "bullet", text: "Budget approval expected Q1" },
      ],
    },
    { type: "mystery_block", text: "Principal mentioned a 2027 auditorium renovation bond." },
  ],
};
const derived = deriveSummary(hortonvilleNotes);
ok(derived.summary.length === 4, `deriveSummary: 4 sections (got ${derived.summary.length})`);
ok(
  derived.summary.map((s) => s.title).join("|") ===
    "Venue Identification and Address|Rigging System|Stage and Room Measurements|Notes",
  "deriveSummary: section titles in order, Next Steps + Key Points not sections"
);
ok(
  derived.summary[1].description === "Counterweight fly system, 18 linesets\nArbor pit accessible\n- Locking rail on stage left",
  "deriveSummary: children joined by newline, nested children as '- ' bullets"
);
ok(derived.keyPoints.length === 3, "deriveSummary: 3 key points");
ok(derived.keyPoints[1] === "Fly system last inspected 2019", "deriveSummary: key points carry plain text");
ok(derived.actionItems.length === 3, `deriveSummary: 3 action items (got ${derived.actionItems.length})`);
ok(
  derived.actionItems[0].title === "Send lineset quote" &&
    derived.actionItems[0].assigneeName === "Jeff Chesebro" &&
    derived.actionItems[0].dueDate === "2026-09-28",
  "deriveSummary: action item keeps Krisp's assignee name + due date"
);
ok(derived.actionItems[1].assigneeName === null, "deriveSummary: unassigned action item → null assignee");
ok(
  derived.summary[3].title === "Notes" &&
    derived.summary[3].description.includes("2027 auditorium renovation bond"),
  "deriveSummary: unknown block type lands under 'Notes' as prose"
);
ok(
  new Set(derived.actionItems.map((a) => a.key)).size === 3 &&
    derived.actionItems.every((a) => /^[0-9a-f]{10}$/.test(a.key)),
  "deriveSummary: action keys are distinct 10-hex hashes"
);
ok(
  JSON.stringify(deriveSummary(hortonvilleNotes)) === JSON.stringify(derived),
  "deriveSummary: rerun over the same notes is byte-identical (stable keys)"
);
const derivedNull = deriveSummary(null);
ok(
  derivedNull.summary.length === 0 && derivedNull.keyPoints.length === 0 && derivedNull.actionItems.length === 0,
  "deriveSummary(null) → empty arrays"
);
const derivedEmpty = deriveSummary({ blocks: [] });
ok(derivedEmpty.summary.length === 0 && derivedEmpty.actionItems.length === 0, "deriveSummary({blocks:[]}) → empty arrays");
let derivedNoThrow = true;
let derivedOdd: ReturnType<typeof deriveSummary> | null = null;
try {
  derivedOdd = deriveSummary({
    blocks: [
      { type: "divider" },
      { type: "heading" },
      { type: "heading", children: [{ type: "paragraph" }] },
      null as unknown as KrispNoteBlock,
      "junk" as unknown as KrispNoteBlock,
      { type: 42 as unknown as string, text: "typed with a number" },
      { type: "checkbox", text: "  Untyped checkbox task  ", assignee: "Sam" },
    ],
  });
} catch {
  derivedNoThrow = false;
}
ok(derivedNoThrow, "deriveSummary never throws on textless / malformed / unknown blocks");
ok(
  !!derivedOdd && derivedOdd.summary.length === 1 && derivedOdd.summary[0].title === "Notes",
  "deriveSummary: textless headings emit no section; prose still lands under Notes"
);
ok(
  !!derivedOdd &&
    derivedOdd.actionItems.length === 1 &&
    derivedOdd.actionItems[0].title === "Untyped checkbox task" &&
    derivedOdd.actionItems[0].assigneeName === "Sam",
  "deriveSummary: checkbox-typed block with a string assignee → action item"
);
const derivedCompleted = deriveSummary({
  blocks: [
    { type: "heading", text: "Rigging System", children: [{ type: "paragraph", text: "Replace arbor", completed: true }] },
  ],
});
ok(
  derivedCompleted.actionItems.length === 1 && derivedCompleted.summary.length === 1,
  "deriveSummary: `completed` defined → action item, even inside an ordinary section"
);
const derivedFlat = deriveSummary({
  blocks: [
    { type: "heading_1", text: "Stage and Room Measurements" },
    { type: "paragraph", text: "Proscenium 42' wide" },
    { type: "paragraph", text: "Grid 58'" },
    { type: "heading_1", text: "Key points" },
    { type: "bullet", text: "Only one" },
  ],
});
ok(
  derivedFlat.summary.length === 1 &&
    derivedFlat.summary[0].description === "Proscenium 42' wide\nGrid 58'" &&
    derivedFlat.keyPoints.length === 1,
  "deriveSummary: a childless heading adopts the flat siblings that follow it"
);

/* --- action-item key stability --- */
const dupTitles = deriveSummary({
  blocks: [
    { type: "task", text: "Call the principal" },
    { type: "task", text: "Call the principal" },
    { type: "task", text: "call the principal." },
  ],
});
ok(
  dupTitles.actionItems.length === 3 && new Set(dupTitles.actionItems.map((a) => a.key)).size === 3,
  "action keys: same title repeated → distinct keys by ordinal"
);
ok(
  actionItemKey("Call the principal", 0) === dupTitles.actionItems[0].key &&
    actionItemKey("CALL THE PRINCIPAL  ", 1) === dupTitles.actionItems[1].key &&
    actionItemKey("Call the principal", 2) === dupTitles.actionItems[2].key,
  "action keys: normalized (case/space/trailing punctuation) title + ordinal reproduces the key"
);
ok(actionItemKey("a", 0) !== actionItemKey("b", 0), "action keys: different titles differ");

/* --- matchAssignee (same rule as the Peak/Assign label interpreter, #96) --- */
const roster = [
  { id: "u1", name: "Jeff Chesebro" },
  { id: "u2", name: "Jack Reilly" },
  { id: "u3", name: "Jack Morgan" },
  { id: "u4", name: "Sam" },
];
ok(matchAssignee("Jeff Chesebro", roster)?.id === "u1", "matchAssignee: exact full name");
ok(matchAssignee("  jeff   chesebro ", roster)?.id === "u1", "matchAssignee: exact match is case/space-insensitive");
ok(matchAssignee("Jeff", roster)?.id === "u1", "matchAssignee: unique first-word match");
ok(matchAssignee("Jack", roster) === null, "matchAssignee: ambiguous first name → null (never guess)");
ok(matchAssignee("Jack Reilly", roster)?.id === "u2", "matchAssignee: full name disambiguates a shared first name");
ok(matchAssignee("Jack R.", roster) === null, "matchAssignee: partial surname doesn't rescue an ambiguous first name");
ok(matchAssignee("sam", roster)?.id === "u4", "matchAssignee: single-word roster name matches exactly");
ok(matchAssignee(null, roster) === null && matchAssignee("", roster) === null, "matchAssignee: null/empty → null");
ok(matchAssignee("Nobody Here", roster) === null, "matchAssignee: no match → null");

/* --- PREFILL_RULES routing (spec §4.4 table) --- */
const route = (t: string) => JSON.stringify(routePrefill(t));
const measureRoute = (t: string) =>
  JSON.stringify({
    survey: { kind: "map", field: "measurements", key: `From recording · ${t}` },
    inspection: { kind: "map", field: "measurements", key: `From recording · ${t}` },
  });
const riggingRoute = JSON.stringify({ survey: { kind: "text", field: "notes" }, inspection: { kind: "text", field: "narrative" } });
const softGoodsRoute = JSON.stringify({ survey: { kind: "text", field: "scopeOfWork" }, inspection: { kind: "text", field: "narrative" } });
const accessRoute = JSON.stringify({ survey: { kind: "text", field: "notes" }, inspection: { kind: "map", field: "venueInfo", key: "Access" } });
const skipRoute = JSON.stringify({ survey: { kind: "skip" }, inspection: { kind: "skip" } });
const defaultRoute = riggingRoute; // notes / narrative
ok(route("Stage and Room Measurements") === measureRoute("Stage and Room Measurements"), "routePrefill: Measurements → measurements map (both)");
ok(route("Proscenium Opening") === measureRoute("Proscenium Opening"), "routePrefill: Proscenium → measurements");
ok(route("Grid Height") === measureRoute("Grid Height"), "routePrefill: Grid/height → measurements");
ok(route("Rigging System") === riggingRoute, "routePrefill: Rigging → survey notes / inspection narrative");
ok(route("Lineset Schedule") === riggingRoute, "routePrefill: Lineset → notes / narrative");
ok(route("Fly System Condition") === riggingRoute, "routePrefill: Fly → notes / narrative");
ok(route("Curtain Condition") === softGoodsRoute, "routePrefill: Curtain → scopeOfWork / narrative");
ok(route("Soft Goods Inventory") === softGoodsRoute, "routePrefill: Soft goods → scopeOfWork / narrative");
ok(route("Valance and Borders") === softGoodsRoute, "routePrefill: Valance/border → scopeOfWork / narrative");
ok(route("Loading Dock Access") === accessRoute, "routePrefill: Access/dock → survey notes / inspection venueInfo[Access]");
ok(route("Parking and Hours") === accessRoute, "routePrefill: Parking/hours → access rule");
ok(route("Next Steps") === skipRoute, "routePrefill: Next Steps → skipped (handled by §4.2)");
ok(route("Follow-up Items") === skipRoute && route("Action Items") === skipRoute, "routePrefill: Follow-up / Action → skipped");
ok(route("Venue Identification and Address") === defaultRoute, "routePrefill: default → notes / narrative");
ok(route("Key Points") === defaultRoute && route("Notes") === defaultRoute, "routePrefill: Key Points / Notes fall to the default");
ok(route("Curtain Track Height") === measureRoute("Curtain Track Height"), "routePrefill: first matching rule wins (height beats track)");
ok(route("Rigging Access Door") === riggingRoute, "routePrefill: rigging rule precedes access rule");
ok(
  prefillInsertText("REC-9001", "Rigging System", "18 linesets") === "\n\n[from REC-9001] Rigging System: 18 linesets",
  "prefillInsertText format"
);
ok(
  summarySearchText({ summary: [{ title: "Rigging System", description: "18 linesets" }, { title: "Notes", description: "" }] }) ===
    "Rigging System 18 linesets Notes",
  "summarySearchText joins titles + descriptions"
);

/* --- recordingStatusChip: every audio × krisp combination (spec §6) --- */
const chipAt = 1_800_000_000_000;
const chipRec = (
  audioState: AudioState,
  krispStatus: KrispStatus,
  extra: { uploadError?: string | null; lastCheckedAt?: number | null; updatedAt?: number } = {}
) =>
  recordingStatusChip(
    {
      audio: { ...blankAudio(), state: audioState, uploadError: extra.uploadError ?? null },
      krisp: { ...blankKrisp(), status: krispStatus, lastCheckedAt: extra.lastCheckedAt === undefined ? chipAt - 60_000 : extra.lastCheckedAt },
      updatedAt: extra.updatedAt ?? chipAt - 60_000,
    },
    chipAt
  );
const chipExpect: Record<AudioState, Record<KrispStatus, string>> = {
  on_device: { pending: "Uploading", importing: "Uploading", processing: "Uploading", ready: "Uploading", failed: "Failed" },
  uploaded: { pending: "Transcribing", importing: "Transcribing", processing: "Transcribing", ready: "Ready", failed: "Failed" },
  archived: { pending: "Archived", importing: "Transcribing", processing: "Transcribing", ready: "Archived", failed: "Failed" },
};
for (const a of Object.keys(chipExpect) as AudioState[]) {
  for (const k of Object.keys(chipExpect[a]) as KrispStatus[]) {
    const got = chipRec(a, k);
    ok(got === chipExpect[a][k], `recordingStatusChip(${a}, ${k}) = ${chipExpect[a][k]} (got ${got})`);
  }
}
ok(chipRec("on_device", "pending", { uploadError: "network" }) === "On device", "recordingStatusChip: upload error while on device → On device");
ok(
  chipRec("uploaded", "processing", { lastCheckedAt: chipAt - 25 * 60 * 60_000 }) === "Stalled",
  "recordingStatusChip: processing untouched 25h → Stalled"
);
ok(
  chipRec("uploaded", "processing", { lastCheckedAt: null, updatedAt: chipAt - 25 * 60 * 60_000 }) === "Stalled",
  "recordingStatusChip: stall falls back to updatedAt when never checked"
);
ok(
  chipRec("uploaded", "processing", { lastCheckedAt: chipAt - 23 * 60 * 60_000 }) === "Transcribing",
  "recordingStatusChip: processing checked 23h ago is still Transcribing"
);
ok(
  chipRec("uploaded", "importing", { lastCheckedAt: chipAt - 25 * 60 * 60_000 }) === "Transcribing",
  "recordingStatusChip: only processing stalls, importing does not"
);

/* --- store helpers that need no DB --- */
const stale = { krisp: { ...blankKrisp(), status: "processing" as KrispStatus, lastCheckedAt: chipAt - 3 * 60_000 } };
ok(needsKrispCheck(stale, 2 * 60_000, chipAt), "needsKrispCheck: processing, checked 3 min ago, window 2 min → check");
ok(!needsKrispCheck(stale, 5 * 60_000, chipAt), "needsKrispCheck: checked inside the window → skip");
ok(needsKrispCheck({ krisp: { ...blankKrisp(), status: "importing" } }, 2 * 60_000, chipAt), "needsKrispCheck: never checked counts as stale");
ok(!needsKrispCheck({ krisp: { ...blankKrisp(), status: "ready" } }, undefined, chipAt), "needsKrispCheck: ready is never checked");
const archCandidate = {
  audio: { ...blankAudio(), state: "uploaded" as AudioState, blobPathname: "recordings/REC-9001/a.m4a" },
  krisp: { ...blankKrisp(), status: "ready" as KrispStatus, readyAt: chipAt - 7 * 60 * 60_000 },
  updatedAt: chipAt - 60_000,
};
ok(isArchivable(archCandidate, 6 * 60 * 60_000, chipAt), "isArchivable: uploaded + ready 7h ago → archive");
ok(!isArchivable({ ...archCandidate, krisp: { ...archCandidate.krisp, readyAt: chipAt - 60_000 } }, 6 * 60 * 60_000, chipAt), "isArchivable: ready 1 min ago → wait (same-day retries)");
ok(
  isArchivable({ ...archCandidate, krisp: { ...blankKrisp(), status: "failed" }, updatedAt: chipAt - 7 * 60 * 60_000 }, 6 * 60 * 60_000, chipAt),
  "isArchivable: failed import still archives its audio (via updatedAt)"
);
ok(!isArchivable({ ...archCandidate, krisp: { ...blankKrisp(), status: "processing" } }, 0, chipAt), "isArchivable: processing keeps the Blob for Retry");
ok(!isArchivable({ ...archCandidate, audio: { ...archCandidate.audio, state: "archived" } }, 0, chipAt), "isArchivable: already archived is skipped");

const bare = normalizeRecording({ id: "rec-0f3a" });
ok(
  bare.audio.state === "on_device" && bare.krisp.status === "pending" && bare.summary.length === 0 &&
    bare.actionItems.length === 0 && bare.prefill.insertedKeys.length === 0 && bare.notes === null && bare.title === "rec-0f3a",
  "normalizeRecording backfills a bare offline-minted doc"
);
ok(
  normalizeRecording({ id: "x", audio: { state: "bogus" } as unknown as RecordingRecord["audio"] }).audio.state === "on_device",
  "normalizeRecording coerces an unknown audio state"
);

/* --- markKrispReady's merge (pure helper) preserves dispositions by key (spec §4.1/§7) --- */
const existingItems: RecordingActionItem[] = [
  { key: "k-a", title: "Send lineset quote", assigneeName: "Jeff", dueDate: null, disposition: "accepted", assignmentId: "AS-3001" },
  { key: "k-b", title: "Confirm grid load rating", assigneeName: null, dueDate: null, disposition: "pending", assignmentId: null },
  { key: "k-c", title: "Old dismissed item", assigneeName: null, dueDate: null, disposition: "dismissed", assignmentId: null },
  { key: "k-e", title: "Vanished pending item", assigneeName: null, dueDate: null, disposition: "pending", assignmentId: null },
];
const mergedItems = mergeActionItems(existingItems, [
  { key: "k-a", title: "Send lineset quote", assigneeName: "Jeff Chesebro", dueDate: "2026-09-28" },
  { key: "k-b", title: "Confirm grid load rating", assigneeName: null, dueDate: null },
  { key: "k-d", title: "Schedule flame test", assigneeName: null, dueDate: null },
]);
ok(mergedItems.map((a) => a.key).join(",") === "k-a,k-b,k-d,k-c", "mergeActionItems: incoming order, then stateful leftovers");
ok(
  mergedItems[0].disposition === "accepted" && mergedItems[0].assignmentId === "AS-3001" &&
    mergedItems[0].assigneeName === "Jeff Chesebro" && mergedItems[0].dueDate === "2026-09-28",
  "mergeActionItems: accepted disposition + assignmentId survive; title fields refresh from Krisp"
);
ok(mergedItems[1].disposition === "pending" && mergedItems[2].disposition === "pending" && mergedItems[2].assignmentId === null, "mergeActionItems: new/pending items start pending");
ok(mergedItems[3].disposition === "dismissed", "mergeActionItems: a dismissed item missing from the rerun is retained");
ok(!mergedItems.some((a) => a.key === "k-e"), "mergeActionItems: a pending item missing from the rerun is dropped");
ok(
  JSON.stringify(mergeActionItems(mergedItems, mergedItems)) === JSON.stringify(mergedItems),
  "mergeActionItems is idempotent"
);

ok(
  krispMeetingUrl("abc/123") === "https://app.krisp.ai/m/abc%2F123?active_tab=ai_notes",
  "krispMeetingUrl deep-links to AI notes"
);
ok(krispErrorFor(500, "boom") instanceof KrispApiError && !(krispErrorFor(500, "boom") instanceof KrispBusyError), "krispErrorFor: unknown status → plain KrispApiError");

/** Krisp REST client against a fake transport (spec §7 "fake transports"). */
async function recordingsAsyncChecks(): Promise<void> {
  type Seen = { url: string; init: RequestInit };
  const seen: Seen[] = [];
  const fake =
    (status: number, body: unknown, contentType = "application/json"): KrispTransport =>
    async (url, init) => {
      seen.push({ url, init });
      const text = typeof body === "string" ? body : JSON.stringify(body);
      return new Response(text, { status, headers: { "Content-Type": contentType } });
    };
  const expectErr = async (p: Promise<unknown>, cls: new (...a: never[]) => Error, label: string, msgIncludes?: string) => {
    try {
      await p;
      ok(false, `${label}: expected ${cls.name}, resolved instead`);
    } catch (e) {
      const good = e instanceof cls && (!msgIncludes || (e as Error).message.includes(msgIncludes));
      ok(good, `${label}: ${cls.name}${msgIncludes ? ` carrying "${msgIncludes}"` : ""}${good ? "" : ` (got ${(e as Error).name}: ${(e as Error).message})`}`);
    }
  };

  await expectErr(createKrispClient("k", fake(401, { message: "Unauthorized" })).me(), KrispAuthError, "krisp client 401");
  await expectErr(
    createKrispClient("k", fake(403, { message: "Storage limit reached" })).startImport({ title: "t" }),
    KrispForbiddenError,
    "krisp client 403",
    "Storage limit reached"
  );
  await expectErr(
    createKrispClient("k", fake(400, { message: "Action is still in process" })).startImport({ title: "t" }),
    KrispBusyError,
    "krisp client 400 still-in-process"
  );
  await expectErr(
    createKrispClient("k", fake(400, { error: "size must be positive" })).startImport({ title: "t" }),
    KrispApiError,
    "krisp client other 400",
    "size must be positive"
  );
  try {
    await createKrispClient("k", fake(400, { error: "size must be positive" })).startImport({ title: "t" });
  } catch (e) {
    ok(!(e instanceof KrispBusyError) && (e as KrispApiError).status === 400, "krisp client other 400 is NOT busy and keeps status 400");
  }
  await expectErr(createKrispClient("k", fake(429, "Too Many Requests", "text/plain")).importStatus("imp_1"), KrispRateLimitError, "krisp client 429");
  await expectErr(createKrispClient("k", fake(409, { message: "processing" })).meeting("m_1"), KrispNotReadyError, "krisp client 409");
  await expectErr(createKrispClient("k", fake(502, "<html>bad gateway</html>", "text/html")).me(), KrispApiError, "krisp client 502 → KrispApiError", "bad gateway");

  seen.length = 0;
  const me = await createKrispClient(
    "krsp_u_test",
    fake(200, { id: 77, email: "jeff@peak.test", first_name: "Jeff", last_name: "Chesebro", team_id: 5 })
  ).me();
  ok(me.id === 77 && me.email === "jeff@peak.test" && me.name === "Jeff Chesebro" && me.teamId === 5, "krisp client me() maps snake_case fields");
  ok(
    seen[0].url === "https://meeting-api.krisp.ai/v1/me" &&
      (seen[0].init.headers as Record<string, string>).Authorization === "Bearer krsp_u_test" &&
      seen[0].init.method === "GET",
    "krisp client sends Bearer auth to the v1 base"
  );

  seen.length = 0;
  const started = await createKrispClient(
    "k",
    fake(201, { import_id: "imp_9", url: "https://s3.example/put?sig=1", expires_at: "2026-09-21T23:00:00Z" })
  ).startImport({ title: "SV-5012 · Hortonville HS", language: "auto", size: 1234 });
  ok(started.importId === "imp_9" && started.url === "https://s3.example/put?sig=1" && started.expiresAt === "2026-09-21T23:00:00Z", "krisp client startImport maps the 201 body");
  ok(
    seen[0].url.endsWith("/import") && seen[0].init.method === "POST" &&
      JSON.stringify(JSON.parse(String(seen[0].init.body))) === JSON.stringify({ title: "SV-5012 · Hortonville HS", language: "auto", size: 1234 }),
    "krisp client startImport POSTs the JSON body"
  );
  await expectErr(createKrispClient("k", fake(201, { ok: true })).startImport({}), KrispApiError, "krisp client startImport without import_id/url", "lacked");

  const st = await createKrispClient("k", fake(200, { data: { import_id: "imp_9", status: "ready", meeting_id: "m_42", error: null } })).importStatus("imp_9");
  ok(st.status === "ready" && st.meetingId === "m_42" && st.error === null, "krisp client importStatus unwraps a {data} envelope");
  const stOdd = await createKrispClient("k", fake(200, { import_id: "imp_9", status: "queued" })).importStatus("imp_9");
  ok(stOdd.status === "processing" && stOdd.meetingId === null, "krisp client importStatus: unknown status reads as processing");

  seen.length = 0;
  const mtg = await createKrispClient(
    "k",
    fake(200, {
      id: "m_42",
      title: "Hortonville",
      started_at: "2026-09-21T15:00:00Z",
      duration: 1810,
      status: "ready",
      participants: { "0": { name: "Jeff" } },
      transcript: { language: "en", speakers: { "0": { name: "Jeff" } }, segments: [{ speaker: 0, text: "hi", start: 0, end: 1 }] },
      notes: hortonvilleNotes,
    })
  ).meeting("m_42");
  ok(
    mtg.id === "m_42" && mtg.duration === 1810 && mtg.transcript?.segments.length === 1 &&
      JSON.stringify(mtg.notes) === JSON.stringify(hortonvilleNotes),
    "krisp client meeting() keeps notes RAW and maps the scalar fields"
  );
  ok(
    decodeURIComponent(seen[0].url) === "https://meeting-api.krisp.ai/v1/meetings/m_42?fields=title,started_at,duration,status,participants,transcript,notes",
    "krisp client meeting() requests the spec's field list"
  );

  seen.length = 0;
  await putToPresignedUrl("https://s3.example/put?sig=1", Buffer.from("audio"), "audio/mp4", fake(200, ""));
  ok(
    seen[0].init.method === "PUT" &&
      (seen[0].init.headers as Record<string, string>)["Content-Type"] === "audio/mp4" &&
      !("Authorization" in (seen[0].init.headers as Record<string, string>)),
    "putToPresignedUrl PUTs with the audio mime and NO Authorization header"
  );
  await expectErr(putToPresignedUrl("https://s3.example/put", Buffer.from("x"), "audio/mp4", fake(403, "<Error>SignatureDoesNotMatch</Error>", "application/xml")), KrispApiError, "putToPresignedUrl non-2xx", "SignatureDoesNotMatch");
}

/* ------------------------------------------------------------------
   Recordings Task 2A — write-back, check, reconcile (spec §3, §4, §7).
   Pure helpers + the Krisp-facing poll with a fake transport; nothing
   here opens the database.
   ------------------------------------------------------------------ */

const wbBase: RecordingRecord = normalizeRecording({
  id: "REC-9001",
  parentKind: "site_visit",
  parentId: "SV-5012",
  customerId: "c1",
  customer: "Hortonville Area School District",
  venue: "Hortonville HS",
  title: "SV-5012 · Hortonville HS · Site survey · 2026-09-21",
  recordedByUserId: "u1",
  recordedByName: "Jeff Chesebro",
  startedAt: new Date(2026, 8, 21, 12, 0, 0).getTime(),
  summary: [
    { title: "Rigging System", description: "Counterweight fly system, 18 linesets\nArbor pit accessible" },
    { title: "Stage and Room Measurements", description: "Proscenium 42' wide" },
    { title: "Loading Dock", description: "" },
  ],
});

/* --- feedNoteText (spec §4.3) --- */
const noteTxt = feedNoteText(wbBase);
ok(
  noteTxt.split("\n")[0] === "Recorded Site visit · REC-9001 · Hortonville HS · 2026-09-21",
  `feedNoteText: header line is 'Recorded <parent> · id · venue · date' (got '${noteTxt.split("\n")[0]}')`
);
ok(
  noteTxt.includes("\nRigging System: Counterweight fly system, 18 linesets\nArbor pit accessible\n") &&
    noteTxt.includes("\nStage and Room Measurements: Proscenium 42' wide\n"),
  "feedNoteText: each summary section reads 'Title: description'"
);
ok(noteTxt.includes("\nLoading Dock\n"), "feedNoteText: a section with no description is just its title");
ok(noteTxt.endsWith("\n→ /recordings/REC-9001"), "feedNoteText: ends with the → /recordings/<id> deep link");
ok(
  feedNoteText({ ...wbBase, summary: [] }) === "Recorded Site visit · REC-9001 · Hortonville HS · 2026-09-21\n\n→ /recordings/REC-9001",
  "feedNoteText: no sections → header + link only"
);
ok(
  feedNoteText({ ...wbBase, parentKind: "inspection", venue: "" }).startsWith("Recorded Inspection · REC-9001 · 2026-09-21"),
  "feedNoteText: empty venue is dropped from the header, parent label follows the kind"
);

/* --- summarySectionsWithKeys: same ordinal rule as action items --- */
const dupSections = summarySectionsWithKeys({
  summary: [
    { title: "Notes", description: "a" },
    { title: "Rigging", description: "b" },
    { title: "notes ", description: "c" },
  ],
});
ok(
  dupSections.length === 3 && new Set(dupSections.map((s) => s.key)).size === 3,
  "summarySectionsWithKeys: repeated titles get distinct keys by ordinal"
);
ok(
  dupSections[0].key === summarySectionKey("Notes", 0) && dupSections[2].key === summarySectionKey("Notes", 1),
  "summarySectionsWithKeys: keys equal summarySectionKey(title, ordinal), normalized"
);

/* --- applyPrefillToRecord (spec §4.4) on survey + inspection objects --- */
const surveyObj = { ...surveyBlank(), notes: "", scopeOfWork: "Existing scope.", measurements: { "Proscenium width": "40'" } } as Record<string, unknown>;
const surveyMapRoute = routePrefill("Stage and Room Measurements").survey;
const surveyMapPatch = applyPrefillToRecord(surveyObj, surveyMapRoute, "Stage and Room Measurements", "Proscenium 42' wide", "REC-9001");
ok(
  JSON.stringify(surveyMapPatch) ===
    JSON.stringify({ measurements: { "Proscenium width": "40'", "From recording · Stage and Room Measurements": "Proscenium 42' wide" } }),
  "applyPrefillToRecord: survey map target creates measurements['From recording · <title>'] and keeps existing keys"
);
ok(
  JSON.stringify((surveyObj as { measurements: Record<string, string> }).measurements) === JSON.stringify({ "Proscenium width": "40'" }),
  "applyPrefillToRecord: never mutates the record"
);
const surveyMapAgain = applyPrefillToRecord(
  { ...surveyObj, ...surveyMapPatch },
  surveyMapRoute,
  "Stage and Room Measurements",
  "Grid height 58'",
  "REC-9001"
) as { measurements: Record<string, string> };
ok(
  surveyMapAgain.measurements["From recording · Stage and Room Measurements"] === "Proscenium 42' wide\nGrid height 58'",
  "applyPrefillToRecord: a second insert into an existing map entry joins with a newline"
);
const surveyTextEmpty = applyPrefillToRecord(surveyObj, routePrefill("Rigging System").survey, "Rigging System", "18 linesets", "REC-9001") as { notes: string };
ok(surveyTextEmpty.notes === "[from REC-9001] Rigging System: 18 linesets", "applyPrefillToRecord: text target on an empty field has no leading blank lines");
const surveyTextAppend = applyPrefillToRecord(surveyObj, routePrefill("Curtain track").survey, "Curtain track", "Replace carriers", "REC-9001") as { scopeOfWork: string };
ok(
  surveyTextAppend.scopeOfWork === "Existing scope." + prefillInsertText("REC-9001", "Curtain track", "Replace carriers"),
  "applyPrefillToRecord: text target appends prefillInsertText to existing scopeOfWork"
);
ok(applyPrefillToRecord(surveyObj, routePrefill("Next Steps").survey, "Next Steps", "x", "REC-9001") === null, "applyPrefillToRecord: skip route → null");

const inspectionObj = { narrative: "Walkthrough complete.", venueInfo: {}, measurements: undefined } as Record<string, unknown>;
const inspAccess = applyPrefillToRecord(inspectionObj, routePrefill("Loading Dock and Access").inspection, "Loading Dock and Access", "Dock on the north side", "REC-9001");
ok(
  JSON.stringify(inspAccess) === JSON.stringify({ venueInfo: { Access: "Dock on the north side" } }),
  "applyPrefillToRecord: inspection access route lands in venueInfo['Access']"
);
const inspMeasure = applyPrefillToRecord(inspectionObj, routePrefill("Grid height").inspection, "Grid height", "58'", "REC-9001");
ok(
  JSON.stringify(inspMeasure) === JSON.stringify({ measurements: { "From recording · Grid height": "58'" } }),
  "applyPrefillToRecord: inspection map target creates the measurements map when the field is undefined"
);
const inspText = applyPrefillToRecord(inspectionObj, routePrefill("Rigging System").inspection, "Rigging System", "18 linesets", "REC-9001") as { narrative: string };
ok(
  inspText.narrative === "Walkthrough complete.\n\n[from REC-9001] Rigging System: 18 linesets",
  "applyPrefillToRecord: inspection text target appends to narrative"
);

/* --- readyPayloadFromMeeting → markKrispReady shape; merged items start pending --- */
const readyPayload = readyPayloadFromMeeting({
  id: "m_42",
  title: "Hortonville",
  startedAt: null,
  duration: 1810,
  status: "ready",
  participants: null,
  transcript: { language: "en", speakers: {}, segments: [] },
  notes: hortonvilleNotes,
});
ok(
  readyPayload.meetingId === "m_42" &&
    readyPayload.meetingUrl === krispMeetingUrl("m_42") &&
    readyPayload.summary.length === 4 &&
    readyPayload.keyPoints.length === 3 &&
    readyPayload.actionItems.length === 3 &&
    JSON.stringify(readyPayload.notes) === JSON.stringify(hortonvilleNotes),
  "readyPayloadFromMeeting: derives summary/keyPoints/actionItems and keeps notes RAW"
);
ok(
  mergeActionItems([], readyPayload.actionItems).every((a) => a.disposition === "pending" && a.assignmentId === null),
  "readyPayloadFromMeeting: merged action items land pending with no assignment (spec §4.2)"
);

/* --- selectForReconcile (spec §3.2 caps) --- */
const selAt = Date.now();
const mkSel = (id: string, user: string, krisp: Partial<RecordingRecord["krisp"]>, audio: Partial<RecordingRecord["audio"]> = {}, createdAt = selAt): RecordingRecord =>
  normalizeRecording({
    id,
    recordedByUserId: user,
    createdAt,
    audio: { ...blankAudio(), state: "uploaded", blobPathname: `recordings/${id}/a.m4a`, ...audio },
    krisp: { ...blankKrisp(), ...krisp },
  });
const selList: RecordingRecord[] = [
  ...Array.from({ length: 7 }, (_, i) => mkSel(`REC-91${i}`, "u1", { status: "processing", lastCheckedAt: selAt - (10 - i) * 60_000 })),
  mkSel("REC-920", "u1", { status: "pending" }),
  mkSel("REC-921", "u2", { status: "pending" }),
  mkSel("REC-922", "u2", { status: "pending" }, { state: "on_device", blobPathname: null }),
  mkSel("REC-923", "u2", { status: "processing", lastCheckedAt: selAt - 30_000 }),
  mkSel("REC-924", "u2", { status: "ready" }),
  mkSel("REC-925", "u2", { status: "importing", lastCheckedAt: null }),
];
const sel = selectForReconcile(selList, { staleMs: 2 * 60_000, cap: 5 }, selAt);
ok(sel.size === 2, `selectForReconcile: grouped by recorder (got ${sel.size} users)`);
ok((sel.get("u1") ?? []).length === 5, `selectForReconcile: capped at 5 per recorder (got ${(sel.get("u1") ?? []).length})`);
ok(
  (sel.get("u1") ?? []).map((r) => r.id).join(",") === "REC-910,REC-911,REC-912,REC-913,REC-914",
  "selectForReconcile: oldest-checked processing first, so a capped pass rotates"
);
ok(
  (sel.get("u2") ?? []).map((r) => r.id).sort().join(",") === "REC-921,REC-925",
  "selectForReconcile: includes pending+uploaded and never-checked importing; excludes on-device pending, recently-checked and ready"
);
ok(selectForReconcile([], {}, selAt).size === 0, "selectForReconcile: empty list → nothing");

async function writeBackAsyncChecks(): Promise<void> {
  // Scripted fake Krisp: routes by URL so one transport serves status + meeting.
  type Step = { match: RegExp; status: number; body: unknown };
  const scripted =
    (steps: Step[]): KrispTransport =>
    async (url) => {
      const s = steps.find((x) => x.match.test(url));
      if (!s) return new Response(JSON.stringify({ message: `unexpected ${url}` }), { status: 500 });
      return new Response(JSON.stringify(s.body), { status: s.status, headers: { "Content-Type": "application/json" } });
    };
  const meetingBody = {
    id: "m_42", title: "Hortonville", started_at: "2026-09-21T15:00:00Z", duration: 1810, status: "ready",
    participants: null, transcript: { language: "en", speakers: {}, segments: [] }, notes: hortonvilleNotes,
  };

  const ready = await pollKrispImport(
    createKrispClient("k", scripted([
      { match: /\/import\/imp_9\/status$/, status: 200, body: { import_id: "imp_9", status: "ready", meeting_id: "m_42", error: null } },
      { match: /\/meetings\/m_42/, status: 200, body: meetingBody },
    ])),
    "imp_9"
  );
  ok(
    ready.kind === "ready" && ready.payload.meetingId === "m_42" && ready.payload.summary.length === 4 && ready.payload.actionItems.length === 3,
    "pollKrispImport: status ready → fetches the meeting → derived payload"
  );

  const failed = await pollKrispImport(
    createKrispClient("k", scripted([{ match: /status$/, status: 200, body: { import_id: "imp_9", status: "failed", error: "Unsupported codec" } }])),
    "imp_9"
  );
  ok(failed.kind === "failed" && failed.error === "Unsupported codec", "pollKrispImport: status failed carries Krisp's error text");

  const processing = await pollKrispImport(
    createKrispClient("k", scripted([{ match: /status$/, status: 200, body: { import_id: "imp_9", status: "processing", meeting_id: null } }])),
    "imp_9"
  );
  ok(processing.kind === "processing", "pollKrispImport: status processing → processing (no meeting call)");

  const readyNoMeeting = await pollKrispImport(
    createKrispClient("k", scripted([{ match: /status$/, status: 200, body: { import_id: "imp_9", status: "ready", meeting_id: null } }])),
    "imp_9"
  );
  ok(readyNoMeeting.kind === "processing", "pollKrispImport: ready without a meeting_id is treated as still processing");

  let notReady = false;
  try {
    await pollKrispImport(
      createKrispClient("k", scripted([
        { match: /status$/, status: 200, body: { import_id: "imp_9", status: "ready", meeting_id: "m_42" } },
        { match: /\/meetings\//, status: 409, body: { message: "still processing" } },
      ])),
      "imp_9"
    );
  } catch (e) {
    notReady = e instanceof KrispNotReadyError;
  }
  ok(notReady, "pollKrispImport: meeting 409 propagates as KrispNotReadyError (checkRecording → touchChecked)");

  let rateLimited = false;
  try {
    await pollKrispImport(createKrispClient("k", scripted([{ match: /status$/, status: 429, body: {} }])), "imp_9");
  } catch (e) {
    rateLimited = e instanceof KrispRateLimitError;
  }
  ok(rateLimited, "pollKrispImport: 429 propagates as KrispRateLimitError (reconcile stops that account)");
}

/* ====== #145: the schedule tab is a real tab key ====== */
ok((TABS as readonly string[]).includes("schedule"), "#145 schedule is a valid engagement tab (?tab= validation depends on it)");
ok((TABS as readonly string[]).includes("activity"), "#145 activity is a valid engagement tab");

/* ============ PIPELINES (Daylite stages) — pure ============ */
import {
  DEFAULT_PIPELINES, DEFAULT_PROJECT_PIPELINES, DEFAULT_QUOTE_PIPELINES, validateProjectPipeline, validateQuotePipeline,
  resolvePipelines, projectPipelineFor, quotePipelineFor, firstStage, firstStageWithTag, nextStage, resolveProjectStage,
  projectStageMeta, projectTag, isDone, isOnSite, isBacklog, isActive, stageLabelFor, carriesPipeline,
  statusForQuoteStage, quoteStageForStatus, quoteStagePillLabel, slugStageId,
} from "@/lib/pipelines";
{
  const install = DEFAULT_PROJECT_PIPELINES.find((p) => p.id === "install")!;
  ok(install.stages.map((s) => s.id).join(",") === "deposit,equipment-ordered,initial-contact,scheduled,installation,invoice,complete", "pipelines: install seed ids in Daylite order");
  ok(install.stages.map((s) => s.label).join("|") === "Deposit/PO received|Equipment ordered|Initial contact|Scheduled|Installation|Invoice|Complete", "pipelines: install seed labels");
  ok(install.stages.map((s) => s.tag).join(",") === "backlog,backlog,backlog,scheduled,onsite,closeout,done", "pipelines: install seed tags");
  ok(install.stages.find((s) => s.id === "equipment-ordered")?.advanceOnDelivered === true, "pipelines: equipment-ordered advances on delivered");
  const order = DEFAULT_PROJECT_PIPELINES.find((p) => p.id === "order")!;
  ok(order.stages.map((s) => s.id + ":" + s.tag).join(",") === "order-materials:backlog,deliveries:backlog,delivered:closeout,complete:done", "pipelines: order seed");
  const ed = DEFAULT_QUOTE_PIPELINES.find((p) => p.id === "estimate-design")!;
  const bs = DEFAULT_QUOTE_PIPELINES.find((p) => p.id === "bid-spec")!;
  ok(ed.stages.map((s) => s.id + ":" + s.tag).join(",") === "first-contact:draft,design:draft,presentation:sent,acceptance:won", "pipelines: estimate-design seed");
  ok(bs.stages.map((s) => s.id + ":" + s.tag).join(",") === "collect-info:draft,create-bid:draft,bid-sent:sent,awarded:won", "pipelines: bid-spec seed");
  ok(DEFAULT_PIPELINES.defaultQuotePipelineId === "estimate-design", "pipelines: default quote pipeline");
  for (const p of DEFAULT_PROJECT_PIPELINES) ok(validateProjectPipeline(p).length === 0, `pipelines: seed ${p.id} validates`);
  for (const p of DEFAULT_QUOTE_PIPELINES) ok(validateQuotePipeline(p).length === 0, `pipelines: seed ${p.id} validates`);

  // validator
  ok(validateProjectPipeline({ id: "x", label: "X", stages: [{ id: "a", label: "A", tag: "done" }] }).length > 0, "pipelines: a done-only pipeline is refused");
  ok(validateProjectPipeline({ id: "x", label: "X", stages: [{ id: "a", label: "A", tag: "done" }, { id: "b", label: "B", tag: "backlog" }] }).length > 0, "pipelines: done must be last");
  ok(validateProjectPipeline({ id: "x", label: "X", stages: [{ id: "a", label: "A", tag: "backlog" }, { id: "a", label: "B", tag: "done" }] }).length > 0, "pipelines: duplicate stage ids refused");
  ok(validateProjectPipeline({ id: "x", label: "X", stages: [{ id: "a", label: " ", tag: "backlog" }, { id: "b", label: "B", tag: "done" }] }).length > 0, "pipelines: blank label refused");
  ok(validateQuotePipeline({ id: "q", label: "Q", stages: [{ id: "a", label: "A", tag: "sent" }, { id: "b", label: "B", tag: "won" }] }).length > 0, "pipelines: quote needs a draft stage");
  ok(validateQuotePipeline({ id: "q", label: "Q", stages: [{ id: "a", label: "A", tag: "draft" }, { id: "b", label: "B", tag: "won" }, { id: "c", label: "C", tag: "sent" }] }).length > 0, "pipelines: quote tags must not go backwards / won last");

  // resolve: absent → defaults; invalid stored list → defaults; valid stored → used
  ok(resolvePipelines(null).project.length === 2, "pipelines: absent settings resolve to seeds");
  ok(resolvePipelines({ projectPipelines: [{ id: "bad", label: "B", stages: [] }] }).project[0].id === "install", "pipelines: an invalid stored list falls back to seeds");
  const custom = resolvePipelines({ projectPipelines: [{ id: "install", label: "Install", stages: [{ id: "a", label: "A", tag: "backlog" }, { id: "z", label: "Z", tag: "done" }] }, order] });
  ok(custom.project[0].stages.length === 2, "pipelines: a valid stored list wins");
  ok(resolvePipelines({ defaultQuotePipelineId: "nope" }).defaultQuotePipelineId === "estimate-design", "pipelines: unknown default quote pipeline falls back");

  // pipeline lookup
  ok(projectPipelineFor(DEFAULT_PIPELINES, { kind: "order" }).id === "order", "pipelines: order kind → order pipeline");
  ok(projectPipelineFor(DEFAULT_PIPELINES, { kind: "project" }).id === "install", "pipelines: project kind → install pipeline");
  ok(projectPipelineFor(DEFAULT_PIPELINES, { kind: "project", pipelineId: "gone" }).id === "install", "pipelines: unknown pipelineId falls back by kind");
  ok(quotePipelineFor(DEFAULT_PIPELINES, { pipelineId: "bid-spec" }).id === "bid-spec", "pipelines: quote pipeline by id");
  ok(quotePipelineFor(DEFAULT_PIPELINES, {}).id === "estimate-design", "pipelines: quote default pipeline");
  ok(firstStage(install).id === "deposit" && firstStageWithTag(install, "closeout")?.id === "invoice", "pipelines: first / first-with-tag");
  ok(nextStage(install, "equipment-ordered")?.id === "initial-contact" && nextStage(install, "complete") === null, "pipelines: nextStage");

  // legacy conversion (spec §3.6)
  const conv = (kind: string, s: string) => resolveProjectStage(projectPipelineFor(DEFAULT_PIPELINES, { kind }), kind, s);
  ok(conv("project", "procurement") === "equipment-ordered" && conv("project", "delivery") === "equipment-ordered", "pipelines: legacy procurement/delivery → equipment-ordered");
  ok(conv("project", "scheduled") === "scheduled" && conv("project", "install") === "installation" && conv("project", "training") === "installation", "pipelines: legacy scheduled/install/training");
  ok(conv("project", "signoff") === "invoice" && conv("project", "complete") === "complete", "pipelines: legacy signoff → invoice, complete stays");
  ok(conv("order", "procurement") === "order-materials" && conv("order", "delivery") === "deliveries" && conv("order", "signoff") === "delivered" && conv("order", "complete") === "complete", "pipelines: legacy order stages");
  ok(conv("project", "") === "deposit" && conv("project", "bogus") === "deposit", "pipelines: missing/unknown → first stage");
  ok(conv("project", "invoice") === "invoice", "pipelines: a current id is kept");

  // meta + predicates
  const m = projectStageMeta(DEFAULT_PIPELINES, { kind: "project", stage: "installation" });
  ok(m.tag === "onsite" && m.label === "Installation" && m.index === 4 && m.count === 7 && m.pipelineId === "install", "pipelines: stage meta");
  ok(isOnSite({ kind: "project", stage: "installation" }) && !isDone({ kind: "project", stage: "installation" }), "pipelines: isOnSite / isDone");
  ok(isDone({ kind: "project", stage: "complete" }) && isDone({ kind: "project", stage: "complete" }, DEFAULT_PIPELINES), "pipelines: complete is done");
  ok(isDone({ kind: "project", stage: "complete-legacy-unknown", stageMeta: { pipelineId: "install", tag: "done", label: "Complete", index: 6, count: 7 } }), "pipelines: stamped stageMeta wins over recomputation");
  ok(isBacklog({ kind: "project", stage: "procurement" }), "pipelines: a legacy stage on an unconverted record still resolves (offline copies)");
  ok(isActive({ kind: "project", stage: "invoice" }) && !isActive({ kind: "project", stage: "deposit" }), "pipelines: isActive = scheduled|onsite|closeout");
  ok(projectTag({ kind: "order", stage: "delivered" }) === "closeout", "pipelines: projectTag for orders");
  ok(stageLabelFor(DEFAULT_PIPELINES, { kind: "project" }, "training") === "Training" && stageLabelFor(DEFAULT_PIPELINES, { kind: "project" }, "scheduled") === "Scheduled", "pipelines: history labels — legacy keys keep their old names");

  // quotes
  ok(carriesPipeline("system") && carriesPipeline(undefined) && !carriesPipeline("flame_test") && !carriesPipeline("consulting"), "pipelines: only system quotes carry a pipeline");
  ok(statusForQuoteStage(ed, "design") === "draft" && statusForQuoteStage(ed, "presentation") === "sent" && statusForQuoteStage(ed, "acceptance") === "won", "pipelines: stage → status");
  ok(quoteStageForStatus(ed, "sent", "first-contact") === "presentation", "pipelines: status sent snaps a draft-stage quote forward");
  ok(quoteStageForStatus(ed, "draft", "design") === "design", "pipelines: same-tag status keeps the current stage");
  ok(quoteStageForStatus(ed, "won", "presentation") === "acceptance", "pipelines: won snaps to the won stage");
  ok(quoteStageForStatus(ed, "lost", "presentation") === "presentation", "pipelines: lost leaves the stage where the deal died");
  ok(quoteStageForStatus(ed, "draft", null) === "first-contact", "pipelines: no stage + draft → first stage");
  ok(quoteStageForStatus(ed, "sent", "acceptance") === "presentation", "pipelines: a status moving backwards moves the stage back to that status's first stage");
  ok(validateQuotePipeline({ id: "q", label: "Q", stages: [{ id: "a", label: "A", tag: "draft" }, { id: "b", label: "B", tag: "won" }] }).length > 0, "pipelines: quote needs a sent stage");
  ok(quoteStageForStatus({ id: "q", label: "Q", stages: [{ id: "a", label: "A", tag: "draft" }, { id: "b", label: "B", tag: "won" }] }, "sent", "a") === "a", "pipelines: a status with no matching stage keeps the current stage");

  // quoteStagePillLabel (Quotes hub row pill, Task 6)
  ok(quoteStagePillLabel(DEFAULT_PIPELINES, { status: "draft", pipelineId: "estimate-design", stage: "design" }, "Draft") === "Design", "pipelines: pill shows the stage label for a pipeline quote");
  ok(quoteStagePillLabel(DEFAULT_PIPELINES, { status: "sent", pipelineId: "bid-spec", stage: "bid-sent" }, "Sent") === "BID Sent", "pipelines: pill works on the bid-spec pipeline too");
  ok(quoteStagePillLabel(DEFAULT_PIPELINES, { status: "lost", pipelineId: "estimate-design", stage: "presentation" }, "Lost") === "Lost", "pipelines: a lost quote's pill stays Lost, not the stage it died in");
  ok(quoteStagePillLabel(DEFAULT_PIPELINES, { quoteType: "flame_test", status: "draft", stage: "design" }, "Draft") === "Draft", "pipelines: a service quote's pill is untouched");
  ok(quoteStagePillLabel(DEFAULT_PIPELINES, { status: "draft", pipelineId: "estimate-design", stage: "gone" }, "Draft") === "Draft", "pipelines: an unresolved stage falls back to the status label");

  // slugStageId (Settings → Pipelines "+ Add stage", Task 7)
  ok(slugStageId("Punch List") === "punch-list", "slugStageId: kebab-cases a label");
  ok(slugStageId("Punch List", ["punch-list"]) === "punch-list-2", "slugStageId: collision de-dupes with -2");
  ok(slugStageId("Punch List", ["punch-list", "punch-list-2"]) === "punch-list-3", "slugStageId: -2 taken too → -3");
  ok(slugStageId("Re-Check!! #1") === "re-check-1", "slugStageId: non-alphanumerics collapse to single dashes, stripped at the edges");
  ok(slugStageId("") === "stage", "slugStageId: an empty label falls back to \"stage\"");
  ok(slugStageId("   ") === "stage", "slugStageId: a blank label falls back to \"stage\"");
}

/* ============ PIPELINES (Daylite stages) — settings storage + server loader ============ */
import { loadPipelines, savePipelines } from "@/lib/pipelines-server";

async function pipelinesServerAsyncChecks(): Promise<void> {
  const before = await loadPipelines();
  ok(before.project[0].id === "install", "pipelines-server: fresh settings load the seeds");
  const bad = await savePipelines({ project: [{ id: "install", label: "Install", stages: [{ id: "a", label: "A", tag: "done" }] }] });
  ok(!bad.ok && bad.errors.length > 0, "pipelines-server: an invalid pipeline is refused, not stored");
  const install = before.project[0];
  const renamed = { ...install, stages: install.stages.map((s) => s.id === "invoice" ? { ...s, label: "Final invoice" } : s) };
  const good = await savePipelines({ project: [renamed, before.project[1]] });
  ok(good.ok, "pipelines-server: a valid edit saves");
  ok((await loadPipelines()).project[0].stages.find((s) => s.id === "invoice")?.label === "Final invoice", "pipelines-server: the saved label reads back");
  // The in-use (idChange) assertion lives in projectsPipelineAsyncChecks — it needs createProject to accept stage ids.
  await savePipelines({ project: before.project, quote: before.quote, defaultQuotePipelineId: "estimate-design" }); // restore
}

/* ============ PIPELINES (Daylite stages) — projects store on pipelines (Task 3) ============ */
import * as ProjStore from "@/lib/stores/projects";

async function projectsPipelineAsyncChecks(): Promise<void> {
  {
    const P = ProjStore;
    const a = await P.createProject({ name: "pl-test A" });
    ok(a.pipelineId === "install" && a.stage === "deposit", "projects: a new install lands at Deposit/PO received");
    ok(a.stageHistory.length === 1 && a.stageHistory[0].to === "deposit", "projects: opening history entry at the first stage");
    const o = await P.createProject({ name: "pl-test O", kind: "order" });
    ok(o.pipelineId === "order" && o.stage === "order-materials", "projects: an order lands at Order materials");

    // legacy doc on read
    await upsertDoc("projects", { ...a, id: "P-legacy-1", stage: "training", pipelineId: undefined, stageMeta: undefined } as never);
    const leg = (await P.getProject("P-legacy-1"))!;
    ok(leg.stage === "installation" && leg.stageMeta?.tag === "onsite", "projects: a legacy 'training' record reads as Installation (onsite)");

    // manual stage + refusal
    ok(!(await P.setProjectStage(a.id, "bogus")), "projects: a stage id outside the pipeline is refused");
    const moved = await P.setProjectStage(a.id, "equipment-ordered", "Test");
    ok(moved?.stage === "equipment-ordered" && moved.stageHistory.at(-1)?.from === "deposit", "projects: stage write records history");
    const keys = (await tasksForProject(a.id)).map((t) => t.coverageKey || "");
    ok(keys.some((k) => k.startsWith(a.id + ":equipment-ordered:")), "projects: entering Equipment ordered expands its checklist");

    // delivery advance: only when ALL received and stage.advanceOnDelivered
    await P.updateProject(a.id, { deliveries: [
      { id: "d1", label: "Rigging", vendor: "JR Clancy", eta: Date.now(), status: "scheduled" },
      { id: "d2", label: "Soft goods", vendor: "Rose Brand", eta: Date.now(), status: "scheduled" },
    ] } as never);
    await P.setDeliveryStatus(a.id, "d1", "received");
    ok((await P.getProject(a.id))!.stage === "equipment-ordered", "projects: one of two deliveries received does not advance");
    await P.setDeliveryStatus(a.id, "d2", "received");
    ok((await P.getProject(a.id))!.stage === "initial-contact", "projects: last delivery received advances to the next stage");

    // sign-off → closeout, not done
    await P.setSignoff(a.id, { name: "Pat", role: "Customer" }, "Test");
    const signed = (await P.getProject(a.id))!;
    ok(signed.stage === "invoice" && !ProjStore.riskFlags(signed).length, "projects: sign-off moves to Invoice, not Complete");
    ok(ProjStore.progressPct(signed) === Math.round((5 / 6) * 100), "projects: progress from stage index");

    // service-linked spawn lands done
    const svc = await P.spawnServiceLinkedProject({ id: "Q-pl-svc", name: "svc" } as never, "repair");
    ok(svc.pipelineId === "order" && svc.stage === "complete", "projects: service-linked record is born at order/complete");

    for (const id of [a.id, o.id, "P-legacy-1", svc.id]) await P.removeProject(id);
  }
  // One post-transition hook: every path into Done mints the #16 follow-up once; auto-moves expand checklists.
  {
    const { allAssignments } = await import("@/lib/stores/assignments");
    const x = await ProjStore.createProject({ name: "pl-test done hook" });
    const doneCount = async () =>
      (await allAssignments()).filter((as) => as.source === "auto: project complete (#16)" && as.link?.kind === "project" && as.link?.id === x.id).length;
    await ProjStore.setProjectStage(x.id, "complete", "Test");
    ok((await doneCount()) === 1, "projects: entering Complete mints exactly one completion follow-up");
    await ProjStore.setProjectStage(x.id, "complete", "Test");
    ok((await doneCount()) === 1, "projects: re-entering Complete does not mint a second follow-up");
    const y = await ProjStore.createProject({ name: "pl-test signoff checklist", stage: "initial-contact" });
    await ProjStore.setSignoff(y.id, { name: "Pat", role: "Customer" }, "Test");
    const yKeys = (await tasksForProject(y.id)).map((t) => t.coverageKey || "");
    ok(yKeys.some((k) => k.startsWith(y.id + ":invoice:")), "projects: sign-off into Invoice expands the Invoice checklist");
    for (const id of [x.id, y.id]) await ProjStore.removeProject(id);
  }
  // Task 2's deferred in-use guard — a stage id a live project sits in can't be removed.
  {
    const { loadPipelines, savePipelines } = await import("@/lib/pipelines-server");
    const before = await loadPipelines();
    const install = before.project.find((p) => p.id === "install")!;
    const tmp = await ProjStore.createProject({ name: "pipelines-server tmp", stage: "invoice" });
    const idChange = await savePipelines({ project: [{ ...install, stages: install.stages.map((s) => s.id === "invoice" ? { ...s, id: "billing" } : s) }, before.project.find((p) => p.id === "order")!] });
    ok(!idChange.ok, "pipelines-server: removing a stage id that a live project sits in is refused");
    await ProjStore.removeProject(tmp.id);
    const afterRemove = await savePipelines({ project: [{ ...install, stages: install.stages.map((s) => s.id === "invoice" ? { ...s, id: "billing" } : s) }, before.project.find((p) => p.id === "order")!] });
    ok(afterRemove.ok, "pipelines-server: the same change is allowed once no live record uses the stage");
    await savePipelines({ project: before.project, quote: before.quote, defaultQuotePipelineId: "estimate-design" }); // restore seeds
  }
}

/* ============ PIPELINES (Daylite stages) — quotes carry a pipeline stage (Task 5, spec §3.4) ============ */
import * as QuoteStore from "@/lib/stores/quotes";

async function quotesPipelineAsyncChecks(): Promise<void> {
  const Q = QuoteStore;
  {
    const q = await Q.create({ name: "pl-quote", customer: "Test" });
    ok(q.pipelineId === "estimate-design" && q.stage === "first-contact", "quotes: a new system quote starts at First Contact");
    const d = await Q.setQuoteStage(q.id, "design", "Test");
    ok(d?.stage === "design" && d.status === "draft", "quotes: same-tag stage move keeps status");
    let refused = false;
    try { await Q.setQuoteStage(q.id, "presentation", "Test"); } catch { refused = true; }
    const afterRefusal = await Q.get(q.id);
    ok(refused && afterRefusal?.stage === "design" && afterRefusal.status === "draft", "quotes: moving to a Sent stage hits the approval gate like the Send button");
    const s = await Q.setStatus(q.id, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" });
    ok(s?.stage === "presentation", "quotes: status sent snaps the stage to Presentation/Delivery");
    ok((s?.history || []).every((h) => h.to !== undefined) && (s?.history || []).length === 2, "quotes: a status write pushes one history row, nothing extra for the stage");
    ok(!(await Q.setQuoteStage(q.id, "nope", "Test")), "quotes: an unknown stage id is refused");
    const back = await Q.setQuoteStage(q.id, "design", "Test");
    ok(back?.stage === "design" && back.status === "draft", "quotes: a stage move into a Draft stage runs setStatus back to draft");
    await Q.setStatus(q.id, "lost", "Test");
    ok((await Q.get(q.id))?.stage === "design", "quotes: lost leaves the stage where the deal died");
    ok(!(await Q.setQuoteStage(q.id, "first-contact", "Test")), "quotes: stage moves are refused while lost");

    const flame = await Q.create({ name: "pl-flame", quoteType: "flame_test" });
    ok(!flame.pipelineId && !flame.stage, "quotes: service quotes carry no pipeline");
    ok(!(await Q.setQuoteStage(flame.id, "design")), "quotes: stage moves on a non-pipeline quote are refused");
    ok(!(await Q.setQuotePipeline(flame.id, "bid-spec")), "quotes: pipeline switch on a non-pipeline quote is refused");

    // pipeline switch — draft only, lands on the new pipeline's first stage
    const b = await Q.create({ name: "pl-bid", customer: "Test" });
    await Q.setQuoteStage(b.id, "design", "Test");
    const sw = await Q.setQuotePipeline(b.id, "bid-spec");
    ok(sw?.pipelineId === "bid-spec" && sw.stage === "collect-info", "quotes: switching estimate-design → bid-spec lands on Collect Information");
    ok(!(await Q.setQuotePipeline(b.id, "nope")), "quotes: switching to an unknown pipeline is refused");
    const bs = await Q.setStatus(b.id, "sent", "Test", { bypassApprovalGate: "engine-owned-flow" });
    ok(bs?.stage === "bid-sent", "quotes: status snaps within the quote's own pipeline");
    ok(!(await Q.setQuotePipeline(b.id, "estimate-design")) && (await Q.get(b.id))?.pipelineId === "bid-spec", "quotes: pipeline switch is refused once sent");

    // normalize-on-read: a pre-pipeline doc reads with a pipeline + a stage matching its status
    await upsertDoc("quotes", { ...q, id: "Q-pl-legacy", status: "won", pipelineId: undefined, stage: undefined } as never);
    const leg = await Q.get("Q-pl-legacy");
    ok(leg?.pipelineId === "estimate-design" && leg.stage === "acceptance", "quotes: a pre-pipeline won quote reads at Acceptance");
    const legAll = (await Q.getAll()).find((x) => x.id === "Q-pl-legacy");
    ok(legAll?.stage === "acceptance", "quotes: getAll normalizes too");
    await upsertDoc("quotes", { ...q, id: "Q-pl-legacy-lost", status: "lost", pipelineId: undefined, stage: undefined } as never);
    const lostLeg = await Q.get("Q-pl-legacy-lost");
    ok(lostLeg?.pipelineId === "estimate-design" && !lostLeg.stage, "quotes: a pre-pipeline lost quote reads with no stage");
    ok(Q.normalizeQuotePipeline<{ quoteType: string; status: string; stage?: string | null }>({ quoteType: "repair", status: "draft" }, DEFAULT_PIPELINES).stage === undefined, "quotes: normalize leaves service quotes alone");

    for (const id of [q.id, flame.id, b.id, "Q-pl-legacy", "Q-pl-legacy-lost"]) await Q.remove(id);
  }
  // lead → quote conversion writes the pipeline onto the stored doc (not only on read)
  {
    const Leads = await import("@/lib/stores/leads");
    const { getDoc } = await import("@/db/doc-store");
    const lead = await Leads.create({ org: "pl-lead Org", contact: "Pat" }, "Test");
    const res = await Leads.convert(lead.id, {}, "Test");
    const raw = res?.quoteId ? await getDoc<{ id: string; pipelineId?: string; stage?: string }>("quotes", res.quoteId) : null;
    ok(raw?.pipelineId === "estimate-design" && raw.stage === "first-contact", "quotes: a converted lead's quote is stored at First Contact");
    if (res?.quoteId) await Q.remove(res.quoteId);
    await Leads.remove(lead.id);
  }
}

/* ============ PIPELINES (Daylite stages) — Settings "Move records" (Task 7) ============ */
async function moveStageRecordsAsyncChecks(): Promise<void> {
  const { moveStageRecords } = await import("@/lib/pipelines-server");
  const P = ProjStore;
  const Q = QuoteStore;

  // projects: two live records parked on Scheduled both move to Installation, with history recorded.
  // Seed fixtures can already have a project sitting on Scheduled, so the move count is asserted as
  // a delta over what was there before, not a hardcoded 2 (moveStageRecords moves every live record
  // on the stage, not just these two).
  {
    const before = (await P.getAllProjects()).filter((p) => p.pipelineId === "install" && p.stage === "scheduled").length;
    const a = await P.createProject({ name: "move-test A" });
    const b = await P.createProject({ name: "move-test B" });
    await P.setProjectStage(a.id, "scheduled", "Test");
    await P.setProjectStage(b.id, "scheduled", "Test");
    const res = await moveStageRecords("project", "install", "scheduled", "installation", "Test");
    ok(res.ok && res.moved === before + 2, "moveStageRecords: two live projects on Scheduled both move to Installation (plus any already there)");
    const aAfter = await P.getProject(a.id);
    const bAfter = await P.getProject(b.id);
    ok(aAfter?.stage === "installation" && bAfter?.stage === "installation", "moveStageRecords: both records land on the target stage");
    ok(aAfter?.stageHistory.at(-1)?.from === "scheduled" && aAfter.stageHistory.at(-1)?.to === "installation", "moveStageRecords: the move records stage history like a normal stage write");
    await P.removeProject(a.id);
    await P.removeProject(b.id);
    const empty = await moveStageRecords("project", "install", "scheduled", "installation", "Test");
    ok(empty.ok && empty.moved === 0, "moveStageRecords: no live records on the stage moves zero, not an error");
  }

  // quotes: same-tag moves land; a different-tag move is refused (status changes stay deliberate)
  {
    const q = await Q.create({ name: "move-test quote", customer: "Test" });
    ok(q.stage === "first-contact", "moveStageRecords setup: a new quote starts at First Contact (Draft)");
    const same = await moveStageRecords("quote", "estimate-design", "first-contact", "design", "Test");
    ok(same.ok && same.moved === 1, "moveStageRecords: a same-tag quote move (Draft → Draft) succeeds");
    ok((await Q.get(q.id))?.stage === "design", "moveStageRecords: the quote landed on the target stage");
    const diff = await moveStageRecords("quote", "estimate-design", "design", "presentation", "Test");
    ok(!diff.ok && /changes their status/.test(diff.error), "moveStageRecords: a Draft → Sent-tag quote move is refused");
    ok((await Q.get(q.id))?.stage === "design", "moveStageRecords: a refused move leaves the quote where it was");
    await Q.remove(q.id);
  }
}

// #148: wait for the dev auto-seed once, up front, before any of this async
// chain runs — asyncChecks() below reads seeded equipment items and surveys,
// and without this the gate races a cold datadir's seed intermittently
// (equipment-items x3, "seeded surveys exist to migrate", "FS-1053 is
// present in the seed"). One await here covers the whole chain rather than
// sprinkling it in front of each function that happens to read seeded data.
seeded()
  .then(() => recordingsAsyncChecks())
  .then(() => writeBackAsyncChecks())
  .then(() => archiveAsyncChecks())
  .then(() => asyncChecks())
  .then(() => templateScheduleAsyncChecks())
  .then(() => davinciWriterAsyncChecks())
  .then(() => pipelinesServerAsyncChecks())
  .then(() => projectsPipelineAsyncChecks())
  .then(() => quotesPipelineAsyncChecks())
  .then(() => moveStageRecordsAsyncChecks())
  .then(() => {
    console.log(fail ? `\n${fail} FAILED` : "\nALL PASSED");
    process.exit(fail ? 1 : 0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

/* ======================================================================
   Recordings — Drive archive (Task 2C; spec §1.3, §5, §6, §7). Pure name /
   scope rules run synchronously here; the Drive REST helpers and the whole
   archive pass run against a fake fetch inside archiveAsyncChecks().
   ====================================================================== */

ok(DRIVE_SCOPE === "https://www.googleapis.com/auth/drive.file", "DRIVE_SCOPE is drive.file — app-created files only (spec §5.1)");
ok(hasDriveScope("https://www.googleapis.com/auth/gmail.send " + DRIVE_SCOPE), "hasDriveScope: granted scope string is detected");
ok(!hasDriveScope("https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events"), "hasDriveScope: Gmail + Calendar only → false");
ok(!hasDriveScope(null) && !hasDriveScope(""), "hasDriveScope: null / empty → false");
ok(!hasDriveScope("https://www.googleapis.com/auth/drive"), "hasDriveScope: the broader drive scope is not mistaken for drive.file");

ok(extForMime("audio/mp4") === "m4a" && extForMime("audio/x-m4a") === "m4a", "extForMime: mp4 family → m4a");
ok(extForMime("audio/wav") === "wav" && extForMime("audio/webm") === "webm" && extForMime("audio/mpeg") === "mp3", "extForMime: wav / webm / mpeg");
ok(extForMime("audio/opus; codecs=opus") === "opus", "extForMime: unknown audio subtype falls back to the subtype, params stripped");
ok(extForMime("") === "bin" && extForMime("application/octet-stream") === "bin", "extForMime: non-audio → bin");
ok(archiveSafeName('Hortonville HS / Main Stage: "Gym"') === "Hortonville HS _ Main Stage_ _Gym", "archiveSafeName keeps spaces, replaces the rest like safeName, trims edge underscores");
ok(archiveSafeName("   ") === "recording", "archiveSafeName: blank → recording");
ok(archiveDateStamp(Date.UTC(2026, 8, 22, 2, 30), "America/Chicago") === "2026-09-21", "archiveDateStamp: 02:30Z on the 22nd is still the 21st in Central");
ok(archiveDateStamp(Date.UTC(2026, 8, 21, 15, 0), "UTC") === "2026-09-21", "archiveDateStamp: explicit zone honoured");
{
  const rec = { startedAt: Date.UTC(2026, 8, 21, 15, 0), parentId: "SV-5012", venue: "Hortonville HS", mime: "audio/mp4" };
  ok(archiveFileName(rec, "UTC") === "2026-09-21 SV-5012 Hortonville HS.m4a", "archiveFileName: <YYYY-MM-DD> <parentId> <venue>.<ext> (spec §5.2)");
  ok(archiveFileName({ ...rec, venue: "" }, "UTC") === "2026-09-21 SV-5012.m4a", "archiveFileName: no venue → no trailing space");
  ok(archiveFileName({ ...rec, venue: "Gym/Stage", mime: "audio/webm" }, "UTC") === "2026-09-21 SV-5012 Gym_Stage.webm", "archiveFileName sanitises the venue and follows the mime");
}
ok(archiveFolderKey({ customerId: "c1" }) === "c1" && archiveFolderKey({ customerId: null }) === "unfiled", "archiveFolderKey: customerId, else unfiled (spec §5.2)");
ok(ARCHIVE_MIN_AGE_MS === 6 * 60 * 60 * 1000 && ARCHIVE_MAX_PER_RUN === 5, "archive pass: 6 h settle window and ≤ 5 per run (spec §5.2 / §7)");
ok(driveQuote("Bob's \"Venue\"") === "'Bob\\'s \"Venue\"'", "driveQuote escapes single quotes for a Drive q literal");
ok(
  folderQuery("Peak Recordings", null) === "name = 'Peak Recordings' and mimeType = 'application/vnd.google-apps.folder' and 'root' in parents and trashed = false",
  "folderQuery: root-level folder search (name + folder mime + root parent + not trashed)"
);
ok(folderQuery("Unfiled", "root1").includes("'root1' in parents"), "folderQuery scopes to the given parent id");
ok(driveFileLink("abc 1") === "https://drive.google.com/file/d/abc%201/view", "driveFileLink builds the canonical view url");
ok(INTEGRATION_CARDS.map((c) => c.key).join(",") === "mailboxes,recordings", "Settings registers the Recordings integration card beside Mailboxes");

async function archiveAsyncChecks(): Promise<void> {
  type Req = { url: string; init: RequestInit };
  const reqs: Req[] = [];
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
  const SESSION = "https://upload.test/session/1";

  /** A Drive that has no folders yet and accepts every upload. */
  const emptyDrive: DriveFetch = async (url, init) => {
    reqs.push({ url, init });
    const method = (init.method || "GET").toUpperCase();
    if (url.startsWith(DRIVE_UPLOAD_BASE)) return new Response("", { status: 200, headers: { Location: SESSION } });
    if (url === SESSION) return json({ id: "file1", webViewLink: "https://drive.google.com/file/d/file1/view" });
    if (method === "GET") return json({ files: [] });
    if (method === "POST") {
      const body = JSON.parse(String(init.body)) as { name: string; parents?: string[] };
      return json({ id: body.name === "Peak Recordings" ? "root1" : "cust1" });
    }
    return new Response("unexpected", { status: 500 });
  };

  /* ---- ensureFolder ---- */
  reqs.length = 0;
  const hit = await ensureFolder("tok", "Peak Recordings", null, {
    fetch: async (url, init) => { reqs.push({ url, init }); return json({ files: [{ id: "existing1", name: "Peak Recordings" }] }); },
  });
  ok(hit === "existing1" && reqs.length === 1 && reqs[0].url.startsWith(DRIVE_API_BASE + "/files?"), "ensureFolder: search hit returns the existing id with one GET");
  ok(
    (reqs[0].init.headers as Record<string, string>).Authorization === "Bearer tok" &&
      (new URL(reqs[0].url).searchParams.get("q") || "").includes("'root' in parents"),
    "ensureFolder: bearer token + root-parent query"
  );

  reqs.length = 0;
  const cache = new Map<string, string>();
  const made = await ensureFolder("tok", "Hortonville Area SD", "root1", { fetch: emptyDrive, cache });
  ok(made === "cust1" && reqs.length === 2 && (reqs[1].init.method || "").toUpperCase() === "POST", "ensureFolder: miss → POST create, returns the new id");
  ok(
    JSON.parse(String(reqs[1].init.body)).parents?.[0] === "root1" &&
      JSON.parse(String(reqs[1].init.body)).mimeType === "application/vnd.google-apps.folder",
    "ensureFolder: create carries the parent + folder mime"
  );
  reqs.length = 0;
  const again = await ensureFolder("tok", "Hortonville Area SD", "root1", { fetch: emptyDrive, cache });
  ok(again === "cust1" && reqs.length === 0, "ensureFolder: per-run cache short-circuits the search");

  for (const [status, needle] of [[403, "Enable Drive archive"], [401, "reconnect the archive mailbox"]] as const) {
    try {
      await ensureFolder("tok", "X", null, { fetch: async () => new Response('{"error":{"message":"insufficient"}}', { status }) });
      ok(false, `ensureFolder ${status}: expected DriveApiError`);
    } catch (e) {
      ok(
        e instanceof DriveApiError && e.status === status && e.message.includes(needle),
        `ensureFolder ${status} → DriveApiError carrying "${needle}"`
      );
    }
  }

  /* ---- uploadFileResumable ---- */
  reqs.length = 0;
  const up = await uploadFileResumable(
    "tok",
    { name: "2026-09-21 SV-5012 Hortonville HS.m4a", mimeType: "audio/mp4", parentId: "cust1", size: 5, body: Buffer.from("audio") },
    { fetch: emptyDrive }
  );
  ok(up.id === "file1" && up.webViewLink === "https://drive.google.com/file/d/file1/view", "uploadFileResumable returns id + webViewLink");
  ok(
    reqs.length === 2 &&
      reqs[0].url.startsWith(DRIVE_UPLOAD_BASE + "/files?uploadType=resumable") &&
      (reqs[0].init.headers as Record<string, string>)["X-Upload-Content-Length"] === "5" &&
      (reqs[0].init.headers as Record<string, string>)["X-Upload-Content-Type"] === "audio/mp4",
    "uploadFileResumable: initiate POST declares the byte length + mime"
  );
  ok(
    reqs[1].url === SESSION &&
      (reqs[1].init.method || "").toUpperCase() === "PUT" &&
      (reqs[1].init.headers as Record<string, string>)["Content-Length"] === "5" &&
      (reqs[1].init.headers as Record<string, string>)["Content-Type"] === "audio/mp4",
    "uploadFileResumable: bytes PUT to the session url with Content-Length + mime"
  );
  ok(JSON.parse(String(reqs[0].init.body)).parents?.[0] === "cust1", "uploadFileResumable: metadata carries the parent folder");
  const noLink = await uploadFileResumable(
    "tok",
    { name: "x.m4a", mimeType: "audio/mp4", parentId: "cust1", size: 1, body: Buffer.from("a") },
    { fetch: async (url) => (url === SESSION ? json({ id: "f9" }) : new Response("", { status: 200, headers: { Location: SESSION } })) }
  );
  ok(noLink.webViewLink === driveFileLink("f9"), "uploadFileResumable: missing webViewLink falls back to driveFileLink");
  try {
    await uploadFileResumable(
      "tok",
      { name: "x.m4a", mimeType: "audio/mp4", parentId: "cust1", size: 1, body: Buffer.from("a") },
      { fetch: async () => new Response("forbidden", { status: 403 }) }
    );
    ok(false, "uploadFileResumable 403: expected DriveApiError");
  } catch (e) {
    ok(e instanceof DriveApiError && e.status === 403 && e.message.includes("Enable Drive archive"), "uploadFileResumable 403 → DriveApiError with the enable-scope hint");
  }

  /* ---- archiveRecordings — the whole pass against injected stores ---- */
  const readyAt = Date.UTC(2026, 8, 21, 15, 0);
  const rec: RecordingRecord = normalizeRecording({
    id: "REC-9001",
    parentKind: "site_visit",
    parentId: "SV-5012",
    customerId: "c1",
    customer: "Hortonville Area SD",
    venue: "Hortonville HS",
    startedAt: readyAt - 3_600_000,
    mime: "audio/mp4",
    sizeBytes: 5,
    audio: { ...blankAudio(), state: "uploaded", blobPathname: "recordings/REC-9001.m4a" },
    krisp: { ...blankKrisp(), status: "ready", readyAt },
    createdAt: readyAt,
    updatedAt: readyAt,
  });

  type ArchiveSettingsShape = Awaited<ReturnType<ArchiveDeps["settings"]>>;
  function harness(over: Partial<ArchiveDeps> = {}, opts: { drive?: DriveFetch; settingsOver?: Partial<ArchiveSettingsShape> } = {}) {
    const calls: string[] = [];
    const saved: Record<string, unknown>[] = [];
    const errors: Record<string, string> = {};
    const deps: ArchiveDeps = {
      settings: async () => ({
        recordingsArchiveMailbox: "personal:u1",
        recordingsArchiveFolderId: null,
        recordingsArchiveFolders: {},
        ...(opts.settingsOver || {}),
      }),
      saveSettings: async (patch) => { calls.push("saveSettings"); saved.push(patch); },
      tokenFor: async () => ({ token: "tok", scope: "https://www.googleapis.com/auth/gmail.send " + DRIVE_SCOPE }),
      candidates: async () => [rec],
      blobStream: async () => new Response("audio").body,
      deleteBlob: async () => { calls.push("deleteBlob"); },
      markArchived: async () => { calls.push("markArchived"); },
      markArchiveError: async (id, msg) => { calls.push("markArchiveError"); errors[id] = msg; },
      fetch: opts.drive ?? emptyDrive,
      now: () => 1_700_000_000_000,
      log: () => undefined,
      ...over,
    };
    return { deps, calls, saved, errors };
  }

  // happy path
  reqs.length = 0;
  {
    const h = harness();
    const r = await archiveRecordings(h.deps);
    ok(r.archived === 1 && r.failed === 0 && r.skipped === null, "archiveRecordings: one candidate archived");
    ok(
      h.calls.indexOf("markArchived") !== -1 && h.calls.indexOf("markArchived") < h.calls.indexOf("deleteBlob"),
      "archiveRecordings: markArchived happens BEFORE deleteBlob (spec §5.2 step 4 / §7)"
    );
    ok(!h.calls.includes("markArchiveError"), "archiveRecordings: no error stamped on success");
    const patch = h.saved[0] || {};
    ok(patch.recordingsArchiveFolderId === "root1", "archiveRecordings caches the root folder id in settings");
    ok(JSON.stringify(patch.recordingsArchiveFolders) === JSON.stringify({ c1: "cust1" }), "archiveRecordings caches the customer subfolder id by customerId");
    const last = patch.recordingsArchiveLastRun as { at: number; archived: number; failed: number; skipped: string | null };
    ok(last && last.at === 1_700_000_000_000 && last.archived === 1 && last.failed === 0 && last.skipped === null, "archiveRecordings records the last run on settings");
    const initiate = reqs.find((q) => q.url.startsWith(DRIVE_UPLOAD_BASE));
    ok(!!initiate && JSON.parse(String(initiate!.init.body)).name.endsWith(" SV-5012 Hortonville HS.m4a"), "archiveRecordings names the Drive file from the recording");
  }

  // cached folders → no folder lookups at all
  reqs.length = 0;
  {
    const h = harness({}, { settingsOver: { recordingsArchiveFolderId: "root1", recordingsArchiveFolders: { c1: "cust1" } } });
    const r = await archiveRecordings(h.deps);
    ok(r.archived === 1 && reqs.length === 2 && reqs.every((q) => q.url.startsWith(DRIVE_UPLOAD_BASE) || q.url === SESSION), "archiveRecordings: cached folder ids → only initiate + PUT hit Drive");
    const patch = h.saved[0] || {};
    ok(!("recordingsArchiveFolderId" in patch) && !("recordingsArchiveFolders" in patch), "archiveRecordings: unchanged folder caches are not rewritten");
  }

  // Drive failure on the PUT → blob untouched, error stamped
  {
    const failingDrive: DriveFetch = async (url, init) => (url === SESSION ? new Response("boom", { status: 500 }) : emptyDrive(url, init));
    const h = harness({}, { drive: failingDrive });
    const r = await archiveRecordings(h.deps);
    ok(r.archived === 0 && r.failed === 1 && r.skipped === null, "archiveRecordings: Drive failure counts as failed, pass continues");
    ok(!h.calls.includes("deleteBlob") && !h.calls.includes("markArchived"), "archiveRecordings: a Drive failure leaves the Blob untouched (spec §5.2 step 5)");
    ok(h.errors["REC-9001"]?.includes("500"), "archiveRecordings: the Drive error is stored as archiveError");
    ok((h.saved[0]?.recordingsArchiveLastRun as { failed: number }).failed === 1, "archiveRecordings: last run reflects the failure");
  }

  // Blob delete failure AFTER archive → stays archived, error notes it
  {
    const h = harness({ deleteBlob: async () => { throw new Error("blob gone wrong"); } });
    const r = await archiveRecordings(h.deps);
    ok(r.archived === 1 && r.failed === 0, "archiveRecordings: a failed Blob delete after Drive succeeded still counts as archived");
    ok(h.calls.includes("markArchived") && h.errors["REC-9001"]?.includes("blob gone wrong"), "archiveRecordings: the Blob-delete failure is logged onto the record without undoing the archive");
  }

  // gates
  reqs.length = 0;
  {
    const h = harness({}, { settingsOver: { recordingsArchiveMailbox: null } });
    const r = await archiveRecordings(h.deps);
    ok(r.skipped === ARCHIVE_SKIP_NOT_CONFIGURED && r.archived === 0 && r.failed === 0, "archiveRecordings: no archive mailbox → skipped 'Archive not configured'");
    ok(reqs.length === 0 && !h.calls.includes("deleteBlob"), "archiveRecordings: not configured → Drive never called, Blob kept");
    ok(h.errors["REC-9001"] === ARCHIVE_SKIP_NOT_CONFIGURED, "archiveRecordings: the gate message is stamped on the waiting record (spec §5.2 step 1)");
  }
  {
    const h = harness({ tokenFor: async () => ({ token: "tok", scope: "https://www.googleapis.com/auth/gmail.send" }) });
    const r = await archiveRecordings(h.deps);
    ok(r.skipped === ARCHIVE_SKIP_NO_SCOPE && h.errors["REC-9001"] === ARCHIVE_SKIP_NO_SCOPE, "archiveRecordings: grant without drive.file → skipped 'Archive account missing Drive scope'");
  }
  {
    const h = harness({ tokenFor: async () => null });
    const r = await archiveRecordings(h.deps);
    ok(r.skipped === ARCHIVE_SKIP_NOT_CONNECTED, "archiveRecordings: archive mailbox not connected → skipped");
  }
  // never throws
  {
    const h = harness({ candidates: async () => { throw new Error("db down"); } });
    const r = await archiveRecordings(h.deps);
    ok(r.archived === 0 && r.failed === 0 && (r.skipped || "").includes("db down"), "archiveRecordings never throws — a store failure becomes a skipped reason");
  }
  // ≤ 5 per run
  {
    const many = Array.from({ length: 7 }, (_, i) => normalizeRecording({ ...rec, id: `REC-90${10 + i}` }));
    let uploads = 0;
    const counting: DriveFetch = async (url, init) => { if (url === SESSION) uploads++; return emptyDrive(url, init); };
    const h = harness({ candidates: async () => many }, { drive: counting });
    const r = await archiveRecordings(h.deps);
    ok(r.archived === 5 && uploads === 5, "archiveRecordings caps a run at 5 uploads (spec §5.2)");
  }
}

/* ======================================================================
   #137 T2 — shared CustomerLocation / CustomerContact → input converters
   (companies/lib.ts). Every field carries through so a save that starts
   from a stored record never drops what the record holds.
   ====================================================================== */
{
  const li = toLocationInput({
    id: "lf1", locationName: "Campus", label: "Main Hall", primary: true, address: "1 Main", city: "Milwaukee", state: "WI",
    zip: "53202", kind: "theatre", lat: "43.04", lng: null, venueKind: "proscenium", travelMiles: null, travelMin: 12,
  });
  ok(li.locationName === "Campus", "#137 T2 toLocationInput keeps locationName (the #96 review follow-up)");
  ok(li.zip === "53202" && li.kind === "theatre", "#137 T2 toLocationInput carries zip + kind");
  ok(li.lat === 43.04 && li.lng === null && li.travelMin === 12, "#137 T2 toLocationInput numbers lat, nulls blank lng, keeps travel");
  const li2 = toLocationInput({ primary: false, venueKind: "church", travelMiles: null, travelMin: null });
  ok(li2.zip === undefined && li2.kind === undefined && li2.label === "" && li2.locationName === "" && li2.venueKind === "church", "#137 T2 toLocationInput: absent zip/kind stay undefined (= preserve), text fields blank");
  const ci = toContactInput({ name: "Maria Lopez", role: "TD", email: "m@x.org", phone: "1", mobile: "2", primary: true });
  ok(ci.mobile === "2" && ci.phone === "1" && ci.role === "TD" && ci.primary, "#137 T2 toContactInput carries mobile");
  ok(toContactInput({ name: "S", role: "", email: "", primary: false }).mobile === undefined, "#137 T2 toContactInput: absent mobile stays undefined");
}

/* ======================================================================
   #137 T3 — three import types: template columns, alias resolution, hidden
   legacy columns, Customer* OR Customer ID, zip cells, and the pure
   link-back helpers (import/link.ts).
   ====================================================================== */
{
  const cu = getTypeMeta("customers");
  const ct = getTypeMeta("contacts");
  const vn = getTypeMeta("venues");
  ok(!!cu && !!ct && !!vn, "#137 T3 customers / contacts / venues types are registered");
  if (cu && ct && vn) {
    const visible = (t: ImportTypeMeta) => visibleColumns(t.fields).map((f) => f.header).join(",");
    ok(visible(cu) === "Customer Name,Category,Address,City,State,Zip,Latitude,Longitude,Phone,Website", "#137 T3 customers template columns (embedded contact/venue columns gone)");
    ok(visible(ct) === "Customer,Customer ID,Name,Email,Phone,Mobile,Title,Role,Primary", "#137 T3 contacts template columns");
    ok(visible(vn) === "Customer,Customer ID,Venue Name,Address,City,State,Zip,Latitude,Longitude,Category", "#137 T3 venues template columns");
    // #137 T7 — the hub may only advertise what it honours. No customer,
    // contact or venue record has a notes field: every Notes cell was
    // dropped on import and the export wrote "". Hidden, so an old file's
    // column is still absorbed (and can't be fuzzy-claimed by another
    // field) but nothing offers it any more.
    ok(
      !visible(cu).includes("Notes") && !visible(ct).includes("Notes") && !visible(vn).includes("Notes"),
      "#137 T7 Notes is advertised nowhere — no store field holds it"
    );
    ok(autoMap(["Customer", "Name", "Notes"], ct.fields).notes === 2, "#137 T7 …but a pre-#137 file's Notes column is still absorbed");
    // The template header, the export header (both columnsOf) and the paste
    // box's placeholder (visibleFields) are ONE list.
    ok(importTemplateCsv("contacts").split("\n")[0] === visible(ct), "#137 T7 the contacts template header is exactly the visible columns");
    ok(importTemplateCsv("venues").split("\n")[0] === visible(vn), "#137 T7 the venues template header is exactly the visible columns");

    const legacy = parseImportCsv("Customer Name,Type,Contact Name,Email,Phone,Venue,Address,City,State,Notes\nRiverside Playhouse,Performing arts,Maria Lopez,maria@riverside.org,(608) 555-0110,Main Stage,215 W Main St,Madison,WI,");
    const lm = autoMap(legacy.headers, cu.fields);
    ok(lm.name === 0 && lm.type === 1 && lm.contactName === 2 && lm.email === 3 && lm.phone === 4 && lm.venue === 5 && lm.address === 6 && lm.notes === 9, "#137 T3 a pre-#137 customers file maps every column, embedded ones via hidden aliases");
    const nm = autoMap(["Customer Name", "Category", "Address", "City", "State", "Zip", "Phone", "Website"], cu.fields);
    ok(nm.type === 1 && nm.zip === 5 && nm.phone === 6 && nm.website === 7, "#137 T3 Category / Zip / Phone / Website map on the new customers template");
    const cm = autoMap(["Company", "Customer ID", "Full Name", "E-mail", "Cell", "Job Title", "Primary Contact"], ct.fields);
    ok(cm.customer === 0 && cm.customerId === 1 && cm.name === 2 && cm.email === 3 && cm.mobile === 4 && cm.title === 5 && cm.primary === 6, "#137 T3 contacts aliases: Company / Customer ID / Full Name / E-mail / Cell / Job Title / Primary Contact");
    const vm = autoMap(["Customer", "Venue", "Street", "City", "State", "Zip Code", "Type"], vn.fields);
    ok(vm.customer === 0 && vm.venue === 1 && vm.address === 2 && vm.zip === 5 && vm.kind === 6, "#137 T3 venues aliases: Venue / Street / Zip Code / Type");

    const onlyId = prepareRows([["c-1", "Pat Doe"]], autoMap(["Customer ID", "Name"], ct.fields), ct.fields);
    ok(onlyId.rows[0].valid, "#137 T3 a contacts row with only a Customer ID is valid (requiredUnless)");
    const neither = prepareRows([["", "", "Pat Doe"]], autoMap(["Customer", "Customer ID", "Name"], ct.fields), ct.fields);
    ok(!neither.rows[0].valid && neither.rows[0].errors.includes("Missing Customer"), "#137 T3 a row with neither Customer nor Customer ID fails validation");
    const z = prepareRows([["A", "V", " 53703 "], ["B", "W", "53703-1234"], ["C", "X", "2134"]], autoMap(["Customer", "Venue Name", "Zip"], vn.fields), vn.fields);
    ok(z.rows[0].values.zip === "53703" && z.rows[1].values.zip === "53703-1234" && z.rows[2].values.zip === "02134", "#137 T3 zip cells: trimmed, ZIP+4 kept as typed, Excel-stripped leading zero restored");
  }
}
ok(normalizeZip(" 53703 ") === "53703" && normalizeZip("53703-1234") === "53703-1234" && normalizeZip(2134) === "02134" && normalizeZip("") === "" && normalizeZip(null) === "", "#137 T3 normalizeZip");
ok(parseYesNo("Yes") && parseYesNo(" y ") && parseYesNo("TRUE") && parseYesNo("1") && parseYesNo("x") && !parseYesNo("no") && !parseYesNo("") && !parseYesNo("0") && !parseYesNo(undefined), "#137 T3 parseYesNo");
{
  const cache = [{ id: "lakefront", name: "Lakefront Performing Arts Center" }, { id: "c-2", name: "Cedar Grove Schools" }];
  const r1 = resolveCustomerForRow({ customerId: "c-2", customer: "Something Else" }, cache);
  ok(r1.how === "id" && r1.id === "c-2", "#137 T3 resolve: Customer ID wins over the name");
  const r2 = resolveCustomerForRow({ customer: "cedar-grove SCHOOLS" }, cache);
  ok(r2.how === "name" && r2.id === "c-2" && r2.name === "Cedar Grove Schools", "#137 T3 resolve: normalized-name match returns the stored name");
  const r3 = resolveCustomerForRow({ customerId: "nope", customer: "Brand New Org" }, cache);
  ok(r3.how === "create" && r3.id === null && r3.name === "Brand New Org", "#137 T3 resolve: unknown id + unknown name → create");
  const r4 = resolveCustomerForRow({ customerId: "", customer: "  " }, cache);
  ok(r4.how === "missing" && r4.id === null, "#137 T3 resolve: neither → missing");
  const rows = [
    { values: { customer: "Brand New Org", name: "A" }, valid: true },
    { values: { customer: "brand new org!", name: "B" }, valid: true },
    { values: { customer: "Cedar Grove Schools", name: "C" }, valid: true },
    { values: { customer: "", name: "" }, valid: false },
  ];
  const pv = previewLinks(rows, cache);
  ok(pv.links.map((l) => l.how).join(",") === "create,create,name,skip", "#137 T3 previewLinks: the second row reuses the first row's pending create; invalid rows are skipped");
  ok(pv.willCreate.length === 1 && pv.willCreate[0] === "Brand New Org", "#137 T3 previewLinks: one customer to create, counted once");
}
{
  // #137 T7 — the preview's Customer column / "will create" list and the
  // result's linked-vs-created line appear on exactly the types whose commit
  // actually links a customer. Five other types carry a plain `customer`
  // column they only copy onto their own record; `customers` IS the record.
  const linked = IMPORT_TYPES.filter((t) => linksCustomer(t.fields)).map((t) => t.key).join(",");
  ok(linked === "contacts,venues", "#137 T7 linksCustomer marks the link-back types only (not customers, not flame tests / inspections / surveys / quotes / projects)");
}
{
  const contacts: CustomerContact[] = [
    { name: "Maria Lopez", role: "TD", email: "maria@r.org", phone: "1", primary: true },
    { name: "Sam Ortiz", role: "", email: "", primary: false },
  ];
  ok(matchContact(contacts, "MARIA@R.ORG", "Somebody")?.name === "Maria Lopez", "#137 T3 matchContact: email first, case-insensitive");
  ok(matchContact(contacts, "", "sam ORTIZ")?.name === "Sam Ortiz", "#137 T3 matchContact: normalized name when no email");
  ok(matchContact(contacts, "new@r.org", "New Person") === null && matchContact(contacts, "", "") === null, "#137 T3 matchContact: no hit / nothing to match");
  const m1 = mergeContact(contacts, { name: "maria lopez", email: "maria@r.org", mobile: "9", primary: false });
  ok(!m1.created && m1.contacts[0].name === "Maria Lopez" && m1.contacts[0].mobile === "9" && m1.contacts[0].role === "TD" && m1.contacts[0].phone === "1" && m1.contacts[0].primary, "#137 T3 mergeContact: a hit keeps the stored name/title/phone/primary and gains the mobile");
  const m2 = mergeContact(contacts, { name: "Sam Ortiz", email: "sam@r.org", primary: true });
  ok(!m2.created && m2.contacts[1].email === "sam@r.org" && m2.contacts[1].primary && !m2.contacts[0].primary, "#137 T3 mergeContact: primary:true promotes the hit and demotes the previous primary");
  const m3 = mergeContact([], { name: "First Person", primary: false });
  ok(m3.created && m3.contacts[0].primary, "#137 T3 mergeContact: the first contact on a record is primary even when the file says no");
  const m4 = mergeContact(contacts, { name: "Third Person", title: "Billing", primary: false });
  ok(m4.created && m4.contacts.length === 3 && m4.contacts[2].role === "Billing" && !m4.contacts[2].primary && m4.contacts[0].primary, "#137 T3 mergeContact: a new non-primary contact appends without touching the primary");
  ok(contacts[0].mobile === undefined && contacts.length === 2 && contacts[1].email === "", "#137 T3 mergeContact never mutates its input");

  const locs: CustomerLocation[] = [
    { id: "l1", label: "", primary: true, venueKind: "proscenium", travelMiles: null, travelMin: null },
  ];
  const v1 = mergeLocation(locs, { label: "Main Stage", address: "215 W Main St", city: "Madison", state: "WI", zip: "53703", kind: "theatre" }, "l-new", { preferPrimary: false });
  ok(!v1.created && v1.locations.length === 1 && v1.locations[0].id === "l1" && v1.locations[0].label === "Main Stage" && v1.locations[0].zip === "53703" && v1.locations[0].kind === "theatre" && v1.locations[0].primary, "#137 T3 mergeLocation claims the unnamed D85 base venue instead of adding a second venue");
  ok(matchLocation(v1.locations, "main-stage")?.id === "l1" && matchLocation(v1.locations, "") === null, "#137 T3 matchLocation: normalized label; blank never matches");
  const v2 = mergeLocation(v1.locations, { label: "MAIN stage", zip: "53704" }, "l-new2", { preferPrimary: false });
  ok(!v2.created && v2.locations[0].zip === "53704" && v2.locations[0].address === "215 W Main St" && v2.locations[0].label === "MAIN stage", "#137 T3 mergeLocation: a normalized-label hit updates zip, keeps fields the row omits, takes the row's label spelling");
  const v3 = mergeLocation(v1.locations, { label: "Black Box", kind: "black box" }, "l-new3", { preferPrimary: false });
  ok(v3.created && v3.locations.length === 2 && v3.locations[1].id === "l-new3" && !v3.locations[1].primary && v3.locations[1].venueKind === "blackbox" && v3.locations[1].kind === "black box", "#137 T3 mergeLocation appends a non-primary venue whose venueKind derives from Category");
  // Revised for #137 C1b (was: the row updates the primary venue's address in
  // place) — that primary venue is NAMED, and its street address is the only
  // copy the app holds, so a customers row appends its mailing address beside
  // it instead of overwriting it.
  const v4 = mergeLocation(v1.locations, { label: "", address: "1 HQ Way", zip: "53705" }, "l-new4", { preferPrimary: true });
  ok(v4.created && v4.locations.length === 2 && v4.locations[0].label === "Main Stage" && v4.locations[0].address === "215 W Main St" && v4.locations[0].zip === "53703" && v4.locations[0].primary && !v4.locations[1].label && v4.locations[1].address === "1 HQ Way" && v4.locations[1].zip === "53705" && !v4.locations[1].primary, "#137 C1b mergeLocation preferPrimary: a customers row without a Venue column APPENDS its mailing address rather than overwriting a NAMED venue's");
  const v5 = mergeLocation([], { label: "", address: "1 HQ Way" }, "l-new5", { preferPrimary: true, venueKind: "church" });
  ok(v5.created && v5.locations[0].primary && v5.locations[0].label === "" && v5.locations[0].venueKind === "church" && v5.locations[0].id === "l-new5", "#137 T3 mergeLocation: the first venue on a new customer is primary and takes the caller's venueKind");
  ok(locs[0].label === "" && locs.length === 1, "#137 T3 mergeLocation never mutates its input");

  // #137 C1 (final review — data loss) — claimBlank. A labelled row may only
  // claim a blank-label venue that carries NO address of its own: the
  // customers template has no Venue column, so every customer it writes owns
  // an unnamed but addressed primary venue (the mailing address), and
  // claiming that slot overwrites it with the venue's address.
  const addressedBlank: CustomerLocation[] = [
    { id: "l1", label: "", primary: true, address: "215 W Main St", city: "Madison", zip: "53703", venueKind: "proscenium", travelMiles: null, travelMin: null },
  ];
  // The primary flags flipped in #137 I3 (this asserted the unnamed mailing
  // venue kept primary): primaryLoc feeds the record page, travel and quote
  // defaults, so the first NAMED venue outranks a mailing placeholder.
  const v6 = mergeLocation(addressedBlank, { label: "Main Auditorium", address: "5000 N Ballard Rd", city: "Appleton", zip: "54913" }, "l-new6", { preferPrimary: true, claimBlank: "unaddressed" });
  ok(v6.created && v6.locations.length === 2 && v6.locations[0].id === "l1" && !v6.locations[0].label && v6.locations[0].address === "215 W Main St" && v6.locations[0].city === "Madison" && !v6.locations[0].primary && v6.locations[1].label === "Main Auditorium" && v6.locations[1].address === "5000 N Ballard Rd" && v6.locations[1].primary, "#137 C1 mergeLocation claimBlank 'unaddressed': a labelled venues row APPENDS rather than claiming an addressed blank-label venue, so the customer's mailing address survives — and (#137 I3) the named venue takes primary from the unnamed mailing placeholder");
  const v7 = mergeLocation(addressedBlank, { label: "Main Stage", address: "5000 N Ballard Rd" }, "l-new7", { preferPrimary: true, claimBlank: "any" });
  ok(!v7.created && v7.locations.length === 1 && v7.locations[0].id === "l1" && v7.locations[0].label === "Main Stage" && v7.locations[0].address === "5000 N Ballard Rd", "#137 C1 mergeLocation claimBlank 'any': the customers writer still names the address venue its own row owns");
  const v8 = mergeLocation(addressedBlank, { label: "Main Auditorium", address: "5000 N Ballard Rd" }, "l-new8", { preferPrimary: true });
  ok(v8.created && v8.locations.length === 2 && v8.locations[0].address === "215 W Main St", "#137 C1 mergeLocation: the DEFAULT claimBlank is the safe one — an un-passed option never overwrites a stored address");
  const v9 = mergeLocation(locs, { label: "Main Stage", address: "215 W Main St" }, "l-new9", { preferPrimary: false, claimBlank: "unaddressed" });
  ok(!v9.created && v9.locations.length === 1 && v9.locations[0].id === "l1" && v9.locations[0].label === "Main Stage" && v9.locations[0].address === "215 W Main St", "#137 C1 mergeLocation claimBlank 'unaddressed' still claims a TRUE placeholder — the unnamed D85 base venue with no address of its own");
  ok(addressedBlank.length === 1 && !addressedBlank[0].label && addressedBlank[0].address === "215 W Main St", "#137 C1 mergeLocation never mutates its input on the append path either");

  // #137 C1b — the preferPrimary branch is the MIRROR of the claim branch: an
  // unlabelled (customers) row may only land on a blank-label venue, i.e. one
  // with no name of its own to lose. It prefers the primary such venue, falls
  // back to any other, and appends when the customer has none — so a named
  // venue's street address, the only copy the app holds, is never overwritten.
  const namedPrimary: CustomerLocation[] = [
    { id: "l1", label: "Main Auditorium", primary: true, address: "5000 N Ballard Rd", city: "Appleton", venueKind: "proscenium", travelMiles: null, travelMin: null },
    { id: "l2", label: "", primary: false, address: "215 W Main St", city: "Madison", venueKind: "proscenium", travelMiles: null, travelMin: null },
  ];
  const v10 = mergeLocation(namedPrimary, { label: "", address: "220 E Doty St" }, "l-new10", { preferPrimary: true });
  ok(!v10.created && v10.locations.length === 2 && v10.locations[0].id === "l1" && v10.locations[0].address === "5000 N Ballard Rd" && v10.locations[0].primary && v10.locations[1].id === "l2" && v10.locations[1].address === "220 E Doty St" && !v10.locations[1].primary, "#137 C1b mergeLocation preferPrimary falls back to the unnamed mailing venue when the PRIMARY venue is named — an 'Update existing' re-run updates it in place instead of growing a third venue");
  const v11 = mergeLocation([{ id: "l1", label: "Main Auditorium", primary: false, address: "5000 N Ballard Rd", venueKind: "proscenium", travelMiles: null, travelMin: null }], { label: "", address: "1 HQ Way" }, "l-new11", { preferPrimary: true });
  ok(v11.created && v11.locations.length === 2 && v11.locations[0].address === "5000 N Ballard Rd" && v11.locations[1].id === "l-new11" && v11.locations[1].address === "1 HQ Way", "#137 C1b mergeLocation preferPrimary: with no primary flag set at all it appends rather than falling back onto a NAMED list[0]");
  const v12 = mergeLocation(addressedBlank, { label: "", address: "220 E Doty St" }, "l-new12", { preferPrimary: true });
  ok(!v12.created && v12.locations.length === 1 && v12.locations[0].id === "l1" && v12.locations[0].address === "220 E Doty St" && v12.locations[0].primary, "#137 C1b mergeLocation preferPrimary still updates an ADDRESSED but unnamed primary venue in place — that venue is the customers row's own (and the #137 T6 blank-label round-trip)");
  ok(venueKindFromCategory("Church") === "church" && venueKindFromCategory("Black Box") === "blackbox" && venueKindFromCategory("Arena") === "arena" && venueKindFromCategory("Gym") === "flat" && venueKindFromCategory("theatre") === "proscenium" && venueKindFromCategory("") === "proscenium" && venueKindFromCategory("flat") === "flat", "#137 T3 venueKindFromCategory");
}

/* ====== #145 (D164–D172): consulting schedule engine ====== */
const DAY145 = 86400000;
const OCT6 = Date.UTC(2026, 9, 6);
const MAR30 = Date.UTC(2027, 2, 30);
const W145: PhaseWeight[] = [
  { phaseId: "ph-a", name: "Assessment", weight: 2 },
  { phaseId: "ph-b", name: "Schematic Design", weight: 4 },
  { phaseId: "ph-c", name: "Design Development", weight: 6 },
  { phaseId: "ph-d", name: "Final Documents", weight: 5 },
  { phaseId: "ph-e", name: "Bid Support", weight: 3 },
];
const win145 = phaseWindows(OCT6, MAR30, W145);
ok(win145.length === 5, "#145 phaseWindows returns one window per phase");
ok(win145[0].startAt === OCT6, "#145 the first window starts exactly at the project start");
ok(win145[4].endAt === MAR30, "#145 the last window ends exactly on the project end — proportional division never drifts");
ok(win145[1].startAt === win145[0].endAt, "#145 windows abut with no gap");
ok(
  Math.round((win145[2].endAt - win145[2].startAt) / DAY145) === 53,
  "#145 Design Development takes 6/20 of a 175-day span (52.5d, rounded)"
);
// Dropping a phase redistributes the remainder in proportion — the whole
// point of units over absolute days (D166).
const dropped145 = phaseWindows(OCT6, MAR30, W145.filter((p) => p.phaseId !== "ph-e"));
ok(dropped145[3].endAt === MAR30 && dropped145.length === 4, "#145 dropping a phase stretches the rest to still fill the span");
ok(dropped145[2].endAt - dropped145[2].startAt > win145[2].endAt - win145[2].startAt, "#145 every surviving window grows when a phase is dropped");

// Degenerate inputs (spec §4.2) — all handled, never thrown.
ok(phaseWindows(OCT6, OCT6 - DAY145, W145).every((w) => w.startAt === OCT6 && w.endAt === OCT6), "#145 an end before the start collapses every window onto the start");
ok(phaseWindows(OCT6, MAR30, []).length === 0, "#145 no phases means no windows");
const zeroW145 = phaseWindows(OCT6, MAR30, W145.map((p) => ({ ...p, weight: 0 })));
ok(
  zeroW145[0].endAt - zeroW145[0].startAt === zeroW145[3].endAt - zeroW145[3].startAt,
  "#145 all-zero weights divide the span equally rather than dividing by zero"
);
const negW145 = phaseWindows(OCT6, MAR30, [{ phaseId: "p1", name: "A", weight: -4 }, { phaseId: "p2", name: "B", weight: 1 }]);
ok(negW145[0].endAt - negW145[0].startAt === negW145[1].endAt - negW145[1].startAt, "#145 a negative weight is treated as 1, not as a subtraction");

// Scope gate (D165): phase must match; a BLANK discipline matches everything.
const lines145: ScheduleLine[] = [
  { key: "l1", title: "Verify grid", section: "Assessment", phase: "Assessment", discipline: "rigging", startPct: 0, lengthPct: 20 },
  { key: "l2", title: "Site photos", section: "Assessment", phase: "Assessment", discipline: "", startPct: 10, lengthPct: 15 },
  { key: "l3", title: "Fixture count", section: "Assessment", phase: "Assessment", discipline: "lighting", startPct: 0, lengthPct: 20 },
  { key: "l4", title: "Bid walk", section: "Bid", phase: "Bid Support", discipline: "", startPct: 0, lengthPct: 50 },
];
const sel145 = selectLines(lines145, ["Assessment", "Bid Support"], ["rigging", "curtain"]);
ok(sel145.map((l) => l.key).join(",") === "l1,l2,l4", "#145 selectLines keeps matching disciplines and every blank-discipline line, drops the rest");
ok(selectLines(lines145, ["Assessment"], []).map((l) => l.key).join(",") === "l2", "#145 an engagement with no disciplines still gets its blank-discipline lines");
ok(selectLines(lines145, [" assessment "], ["RIGGING"]).length === 2, "#145 selectLines matches case-insensitively and ignores surrounding space");

// Placement within a window, and the overrun clamp (spec §4.2).
const fd145 = win145[3];
const placed145 = placeTask(fd145, 60, 20);
ok(placed145.startAt > fd145.startAt && placed145.dueAt <= fd145.endAt, "#145 placeTask lands inside its own phase window");
ok(Math.round((placed145.startAt - fd145.startAt) / DAY145) === 26, "#145 startPct 60 of a 43.75-day window is 26 days in");
const spill145 = placeTask(fd145, 90, 50);
ok(spill145.dueAt === fd145.endAt, "#145 startPct + lengthPct over 100 clamps to the window end instead of spilling into the next phase");
ok(placeTask(fd145, -10, 999).startAt === fd145.startAt, "#145 out-of-range percentages clamp rather than throwing");
ok(placeTask({ phaseId: "x", name: "X", startAt: OCT6, endAt: OCT6 }, 50, 50).startAt === OCT6, "#145 a zero-length window places every task on its start");

ok(overrunsEnd({ dueAt: MAR30 + DAY145 }, MAR30), "#145 overrunsEnd flags work past the committed end date");
ok(!overrunsEnd({ dueAt: null }, MAR30), "#145 an undated task never counts as an overrun");

// Milestone shift (D168): the milestone's phase, minus hand-dragged tasks.
const tasks145 = [
  { id: "T-1", schedule: { phaseId: "ph-d" }, handScheduled: false, startAt: OCT6, dueAt: OCT6 + DAY145 },
  { id: "T-2", schedule: { phaseId: "ph-d" }, handScheduled: true, startAt: OCT6, dueAt: OCT6 + DAY145 },
  { id: "T-3", schedule: { phaseId: "ph-e" }, handScheduled: false, startAt: OCT6, dueAt: OCT6 + DAY145 },
  { id: "T-4", schedule: null, handScheduled: false, startAt: null, dueAt: null },
];
const shift145 = shiftForMilestone({ phaseId: "ph-d" }, 14 * DAY145, tasks145);
ok(shift145.moved.length === 1 && shift145.moved[0].id === "T-1", "#145 shiftForMilestone moves only its own phase's untouched tasks");
ok(shift145.moved[0].startAt === OCT6 + 14 * DAY145, "#145 a moved task shifts by exactly the milestone's delta");
ok(shift145.skipped.map((t) => t.id).join(",") === "T-2,T-3,T-4", "#145 a hand-dragged task is never moved by the app");
ok(shiftForMilestone({ phaseId: null }, DAY145, tasks145).moved.length === 0, "#145 a milestone with no phase pre-ticks nothing and degrades to the manual checklist");

// shiftTasksByIds (#145 Task 15 review): the manual-checklist half of the
// null-phase path above. Unlike shiftForMilestone it takes NO position on
// phase or handScheduled — the caller's own id list IS the membership,
// since there's no phase to infer it from.
const byIds145 = shiftTasksByIds(["T-2", "T-4", "T-does-not-exist"], 14 * DAY145, tasks145);
ok(
  byIds145.length === 2 && byIds145[0].id === "T-2" && byIds145[1].id === "T-4",
  "#145 shiftTasksByIds returns exactly the ids that exist, in the CALLER's order, silently dropping one that doesn't"
);
ok(
  byIds145[0].startAt === OCT6 + 14 * DAY145 && byIds145[0].dueAt === OCT6 + DAY145 + 14 * DAY145,
  "#145 shiftTasksByIds shifts a hand-scheduled task too — it has no phase-based opinion, only the ids it's given"
);
ok(
  byIds145[1].startAt === null && byIds145[1].dueAt === null,
  "#145 shiftTasksByIds keeps a null start/due null rather than shifting into NaN"
);
ok(shiftTasksByIds([], DAY145, tasks145).length === 0, "#145 shiftTasksByIds is a no-op on an empty id list");

// Whole-schedule generation.
const gen145 = generateSchedule({
  startAt: OCT6, endAt: MAR30, phases: W145, disciplines: ["rigging"], lines: lines145,
  milestones: [{ id: "ms-1", phaseId: "ph-d", targetDate: 0 }, { id: "ms-2", phaseId: null, targetDate: 0 }],
});
ok(gen145.tasks.length === 3, "#145 generateSchedule expands exactly the in-scope lines");
ok(gen145.tasks.every((t) => t.startAt >= OCT6 && t.dueAt <= MAR30), "#145 every generated task lands inside the project span");
ok(gen145.milestones.find((m) => m.id === "ms-1")?.targetDate === win145[3].endAt, "#145 a phase-matched milestone is dated to its phase window's end");
ok(gen145.milestones.find((m) => m.id === "ms-2")?.targetDate === 0, "#145 a milestone with no phase stays unscheduled and out of the billing forecast");
/* ====== #145: record shapes normalize absent fields ====== */
const bareEng145 = normalizeEngagementRecord({ id: "CE-1043", name: "North HS", status: "design" } as never);
ok(bareEng145.startAt === 0 && bareEng145.endAt === 0, "#145 an engagement written before this feature reads as unscheduled, not NaN");
ok(Array.isArray(bareEng145.disciplines) && bareEng145.disciplines.length === 0, "#145 absent disciplines read as an empty list");
ok(bareEng145.milestones.every((m) => m.phaseId === null), "#145 absent milestone phaseId reads as null");

const bareTask145 = normalizeTask({ id: "T-6001", title: "x" } as never);
ok(bareTask145.engagementId === null && bareTask145.startAt === null, "#145 a pre-existing task reads with null engagement and no bar start");
ok(bareTask145.schedule === null && bareTask145.handScheduled === false, "#145 a pre-existing task is not hand-scheduled and carries no template provenance");

const bareNote145 = normalizeNote({ id: "N-7001", parentKind: "customer", parentId: "c1" } as never);
ok(Array.isArray(bareNote145.attachments) && bareNote145.attachments.length === 0, "#145 a pre-existing note reads with no attachments");
ok(Array.isArray(bareNote145.taskIds) && bareNote145.taskIds.length === 0, "#145 a pre-existing note reads with no spawned tasks");

ok(TEMPLATE_RECORD_KINDS.includes("consulting"), "#145 consulting is a template target kind (D172)");
ok(TEMPLATE_RECORD_LABEL.consulting === "Consulting", "#145 the consulting kind has a label for the apply picker");

/* phase weights + disciplines merge like every other settings list */
ok(mergedConsultingDisciplines([]).join(",") === "rigging,curtain,lighting,av", "#145 disciplines default to the four intake groups");
ok(mergedConsultingDisciplines(["rigging", " AV "]).join(",") === "rigging,AV", "#145 a stored discipline list overrides wholesale and is trimmed");
const pw145 = phaseWeightsFor({ "Design Development": 6 }, ["Assessment", "Design Development"]);
ok(pw145[0].weight === 1 && pw145[1].weight === 6, "#145 phaseWeightsFor defaults an unweighted phase to 1 and honours a stored weight");
ok(pw145[0].name === "Assessment" && typeof pw145[0].phaseId === "string" && pw145[0].phaseId.length > 0, "#145 phaseWeightsFor carries a stable id per phase name");

/* tasksForEngagement is exported for the consulting side of the collection
 * (Task 3+ exercises it against real records; this only proves the store
 * compiles and exports it, with no DB touch here). */
ok(typeof tasksForEngagement === "function", "#145 tasksForEngagement is exported for the consulting side of the collection");
/* ====== #145: Gantt geometry ====== */
{
  // #145 review fix (round 2): pinned for this whole block. Under
  // TZ=UTC, "local day" and "UTC day" are the SAME day by definition —
  // no assertion phrased in terms of that distinction can discriminate
  // the bug there, because there is no bug to find (offset 0 has nothing
  // to drift across). Pinning to a real, DST-observing zone (this app's
  // actual deployment, per AGENTS.md) is what keeps these assertions
  // meaningful on a CI box that happens to run in UTC, rather than
  // silently passing against a reintroduced UTC-epoch implementation.
  // Node re-resolves `process.env.TZ` on the next Date call (verified on
  // the Node version this repo runs), so this takes effect immediately
  // and the `finally` below undoes it before any later test observes it.
  const savedTZ145 = process.env.TZ;
  process.env.TZ = "America/Chicago";
  try {
  const DAY145 = 86400000;
  // LOCAL midnight, October 6 2026 — not Date.UTC(...). #145 review fix:
  // snapToDay/dateFromX now floor to the LOCAL calendar day (see gantt-lib.ts's
  // doc comment), matching every date this app actually writes (every
  // `<input type="date">` anchors at LOCAL NOON). A UTC anchor would make
  // these assertions pass or fail depending on the test runner's timezone
  // offset instead of proving anything about the implementation.
  const OCT6 = new Date(2026, 9, 6).getTime();
  ok(dayColumns(OCT6, OCT6 + 6 * DAY145).length === 7, "#145 dayColumns is inclusive of both ends");
  const rect145 = barRect({ startAt: OCT6 + 2 * DAY145, dueAt: OCT6 + 4 * DAY145 }, OCT6, OCT6 + 10 * DAY145);
  ok(Math.round(rect145.leftPct) === 20 && Math.round(rect145.widthPct) === 20, "#145 barRect converts a span to percentages of the visible range");
  ok(barRect({ startAt: OCT6 - DAY145, dueAt: OCT6 + DAY145 }, OCT6, OCT6 + 10 * DAY145).leftPct === 0, "#145 a bar starting before the window is clipped to the left edge, not drawn off-screen");
  ok(barRect({ startAt: OCT6, dueAt: OCT6 }, OCT6, OCT6 + 10 * DAY145).widthPct > 0, "#145 a zero-length bar still renders a visible sliver rather than vanishing");
  ok(snapToDay(OCT6 + 3 * DAY145 + 3600000) === OCT6 + 3 * DAY145, "#145 a drop snaps back to the start of its day");
  ok(dateFromX(50, 100, OCT6, OCT6 + 10 * DAY145) === OCT6 + 5 * DAY145, "#145 dateFromX maps a pixel offset to a date within the range");

  /* ====== #145 review fix (live-verification round): the drag-vs-endAt
   * false-overrun bug, and the invisible-sliver bug, both surfaced by
   * actually rendering the Gantt for the first time. ====== */

  // snapToDay must floor to the LOCAL day, not the UTC one. Proven with an
  // arbitrary sub-day offset compared against a manually-computed local
  // midnight — this is the implementation's actual contract, and it is
  // the contract every caller (dateFromX, the drag handlers) depends on.
  const arbitrary145 = OCT6 + 3 * DAY145 + 7 * 3600000 + 41 * 60000; // Oct 9, some odd hour:minute
  const expectedLocalMidnight145 = new Date(arbitrary145);
  expectedLocalMidnight145.setHours(0, 0, 0, 0);
  ok(
    snapToDay(arbitrary145) === expectedLocalMidnight145.getTime(),
    "#145 review fix: snapToDay floors to the LOCAL calendar day — the day boundary every date input in this app actually uses"
  );

  // overrunsEnd compares LOCAL CALENDAR DAYS, not raw instants. endAt is
  // always local-noon-anchored (every date input in this app goes through
  // "T12:00:00"), so a task due later the SAME local day must not read as
  // an overrun just because its clock time falls after noon — this is the
  // exact false positive a live drag produced (dragged onto the
  // engagement's own end date; the drop's midnight-ish snap plus the
  // task's own sub-day-length duration landed a few hours after that
  // day's noon endAt).
  const noonOct10_145 = new Date(2026, 9, 10, 12, 0, 0).getTime();
  const eveningOct10_145 = new Date(2026, 9, 10, 19, 12, 0).getTime();
  ok(
    !overrunsEnd({ dueAt: eveningOct10_145 }, noonOct10_145),
    "#145 review fix: due later the SAME local day as endAt is not an overrun, even though its raw timestamp is after endAt's noon anchor"
  );
  const justAfterMidnightOct11_145 = new Date(2026, 9, 11, 0, 30, 0).getTime();
  ok(
    overrunsEnd({ dueAt: justAfterMidnightOct11_145 }, noonOct10_145),
    "#145 review fix: …but due on the NEXT local day is an overrun, even by only half an hour past midnight"
  );

  // #145 review fix (round 3): startOfLocalDay, now exported so the
  // milestone-reschedule dialog (schedule-tab.tsx) and moveMilestoneAction
  // can compare a milestone's stored targetDate (an arbitrary
  // phase-window-end instant — generateSchedule dates it to a
  // phaseWindow's `endAt`, never noon-anchored) against a freshly
  // re-picked, noon-anchored date at DAY granularity instead of by raw
  // instant. Without this, confirming the dialog with NO real change
  // (the ordinary case) produced a non-zero delta whenever the stored
  // instant fell after noon — a live sweep of realistic phase-window
  // ends found this on 66% of them. The reviewer's own worked case:
  const phaseWindowEnd145 = new Date(2027, 1, 23, 21, 17, 0).getTime(); // Tue Feb 23 2027 21:17
  const reconfirmedNoon145 = new Date(2027, 1, 23, 12, 0, 0).getTime(); // same local day, re-picked
  ok(
    startOfLocalDay(phaseWindowEnd145) === startOfLocalDay(reconfirmedNoon145),
    "#145 review fix: an arbitrary phase-window-end instant and a same-day noon-anchored re-pick floor to the identical local day — a no-op confirm must compute a zero delta, not a false 'moved' note"
  );
  const nextDayNoon145 = new Date(2027, 1, 24, 12, 0, 0).getTime();
  ok(
    startOfLocalDay(phaseWindowEnd145) !== startOfLocalDay(nextDayNoon145),
    "#145 review fix: …but a genuinely different local day still floors differently, so a real reschedule still registers"
  );

  // barRect: a bar ENTIRELY past the visible end used to collapse to the
  // same ~0.6%-wide sliver as a same-day zero-length bar, sitting right at
  // the container's edge — easy to miss completely. It now anchors to the
  // right edge sized by its own real duration, so it stays a legible bar.
  const farPast145 = barRect({ startAt: OCT6 + 15 * DAY145, dueAt: OCT6 + 18 * DAY145 }, OCT6, OCT6 + 10 * DAY145);
  ok(farPast145.widthPct === 30, "#145 review fix: a bar entirely past the visible end is sized by its own 3-day duration over the 10-day span (30%), not clamped to a hairline");
  ok(farPast145.leftPct === 70, "#145 review fix: …and anchored flush against the right edge (leftPct + widthPct === 100)");
  const barelyPast145 = barRect({ startAt: OCT6 + 10 * DAY145, dueAt: OCT6 + 10 * DAY145 }, OCT6, OCT6 + 10 * DAY145);
  ok(barelyPast145.leftPct + barelyPast145.widthPct === 100, "#145 review fix: even a zero-length bar exactly at the boundary stays anchored flush right, not drawn past the edge");
  // A very long overrun (duration bigger than the whole visible span) caps
  // at 100% width rather than reporting something the caller would need to
  // clamp itself.
  const massivelyPast145 = barRect({ startAt: OCT6 + 15 * DAY145, dueAt: OCT6 + 45 * DAY145 }, OCT6, OCT6 + 10 * DAY145);
  ok(massivelyPast145.widthPct === 100 && massivelyPast145.leftPct === 0, "#145 review fix: an overrun longer than the whole visible span caps at 100% width instead of overflowing it");

  // #145 review fix (found live, not in review): dayColumns must walk by
  // LOCAL CALENDAR DAY, not by adding a raw 86400000ms each step — a DST
  // transition among the walked days is 23 or 25 real hours, and adding a
  // flat 24h drifts every later "day" out of alignment with true local
  // midnight. This is what actually produced the header's overlapping
  // week labels on an 8-month span: two labels that should have been 21
  // real days apart ended up rendered only ~14 apart. Nov 1, 2026 is when
  // US clocks "fall back" — Oct 25 and Nov 8, 2026 are the Sundays a week
  // either side of it.
  const beforeDst145 = new Date(2026, 9, 25).getTime();
  const afterDst145 = new Date(2026, 10, 8).getTime();
  const spanningDst145 = dayColumns(beforeDst145, afterDst145);
  ok(
    spanningDst145.length === 15,
    "#145 review fix: dayColumns across a DST transition still returns exactly 15 days (Oct 25 – Nov 8 inclusive), not one short/long from the fall-back hour"
  );
  // Note: the LENGTH assertion above does not by itself discriminate the
  // bug on FALL-BACK — a raw-ms walk also happens to total 15 here (it
  // drifts the LAST element's clock time by the fall-back hour without
  // dropping/duplicating a day). The next assertion is the one that
  // actually catches it.
  ok(
    spanningDst145[spanningDst145.length - 1] === afterDst145,
    "#145 review fix: …and the LAST column lands exactly on the real local midnight of the end date, not an hour off"
  );

  // …and the OTHER direction: Mar 14, 2027 is when US clocks "spring
  // forward" (a 23-hour local day). Mar 7 and Mar 21, 2027 are the
  // Sundays a week either side of it. Unlike fall-back, a raw-ms walk
  // breaks the COUNT itself here (it comes up one day short — 14 instead
  // of 15 — because the 23-hour transition day makes the walk's running
  // total fall behind by an hour, and by the far end that hour is enough
  // to make the loop's `<=` cutoff exclude the real last day). Nothing
  // covered this direction before; only the fall-back case was tested.
  const beforeSpring145 = new Date(2027, 2, 7).getTime();
  const afterSpring145 = new Date(2027, 2, 21).getTime();
  const spanningSpring145 = dayColumns(beforeSpring145, afterSpring145);
  ok(
    spanningSpring145.length === 15,
    "#145 review fix: dayColumns across the SPRING-FORWARD transition also returns exactly 15 days (Mar 7 – Mar 21 inclusive), not one short from the lost hour"
  );
  ok(
    spanningSpring145[spanningSpring145.length - 1] === afterSpring145,
    "#145 review fix: …and the LAST column lands exactly on the real local midnight of the end date"
  );
  } finally {
    // #145 review fix (round 4) — `process.env.TZ = undefined` does NOT
    // delete the key: Node coerces it to the STRING "undefined", which
    // resolves as a (nonexistent) zone name and falls back to UTC. Since
    // this suite normally runs with no TZ set at all, `savedTZ145` here
    // IS `undefined`, and the naive restore silently switched every
    // assertion and async suite after this block — 53 sync assertions
    // plus all four async suites deferred to the promise chain at the
    // bottom of this file — from local time to UTC. `delete` is the only
    // way to genuinely restore "unset".
    if (savedTZ145 === undefined) delete process.env.TZ;
    else process.env.TZ = savedTZ145;
  }
}

/* ====== #145: packTracks (review fix — relocated from gantt-grid.tsx into
   gantt-lib.ts since it's pure) ====== */
{
  const DAY145 = 86400000;
  const OCT6 = Date.UTC(2026, 9, 6);
  const none = packTracks([]);
  ok(none.n === 1 && Object.keys(none.map).length === 0, "#145 packTracks: an empty list still reports at least 1 track and an empty map");
  const disjoint = packTracks([
    { s: OCT6, e: OCT6 + DAY145, k: "a" },
    { s: OCT6 + 2 * DAY145, e: OCT6 + 3 * DAY145, k: "b" },
  ]);
  ok(disjoint.n === 1 && disjoint.map.a === 0 && disjoint.map.b === 0, "#145 packTracks: non-overlapping items share a single track");
  const overlap = packTracks([
    { s: OCT6, e: OCT6 + 5 * DAY145, k: "a" },
    { s: OCT6 + 2 * DAY145, e: OCT6 + 6 * DAY145, k: "b" },
  ]);
  ok(overlap.n === 2 && overlap.map.a === 0 && overlap.map.b === 1, "#145 packTracks: two overlapping items land on distinct tracks");
  const reuse = packTracks([
    { s: OCT6, e: OCT6 + 2 * DAY145, k: "a" },
    { s: OCT6 + 1 * DAY145, e: OCT6 + 5 * DAY145, k: "b" },
    { s: OCT6 + 3 * DAY145, e: OCT6 + 4 * DAY145, k: "c" },
  ]);
  ok(
    reuse.n === 2 && reuse.map.a === 0 && reuse.map.b === 1 && reuse.map.c === 0,
    "#145 packTracks: a track is reused once its occupant has ended, instead of growing a third track"
  );
}

/* ====== #145: template lines carry scope + units ====== */
const bareLine145 = normalizeTemplateLine({ title: "Do the thing" });
ok(bareLine145.phase === "" && bareLine145.discipline === "", "#145 a pre-#145 template line reads with no phase and no discipline");
ok(bareLine145.startPct === 0 && bareLine145.lengthPct === 100, "#145 an unmeasured line defaults to spanning its whole phase window");
const clampedLine145 = normalizeTemplateLine({ title: "x", startPct: -5, lengthPct: 500 });
ok(clampedLine145.startPct === 0 && clampedLine145.lengthPct === 100, "#145 out-of-range template percentages are clamped at normalize, not at render");
ok(normalizeTemplateLine({ title: "x", discipline: " Rigging " }).discipline === "rigging", "#145 a discipline is stored lowercased and trimmed so selectLines matches it");

/* ---- #145 T3: a non-numeric percentage falls back rather than becoming NaN ---- */
ok(normalizeTemplateLine({ title: "x", startPct: "abc" }).startPct === 0, "#145 a non-numeric startPct string falls back to 0 rather than becoming NaN");

/* ====== #145 T3: applyTaskTemplate schedules + gates a consulting fan-out ======
 * DB-backed (async, doc-store), mirroring the file's own #13 idiom: fixed
 * test names + find-or-converge lookups since this writes to the real
 * persistent dev DB, not a scratch one. */
async function templateScheduleAsyncChecks(): Promise<void> {
  const ENG_START_145T3 = Date.UTC(2027, 3, 1);
  const ENG_END_145T3 = ENG_START_145T3 + 100 * DAY145;
  const PHASES_145T3: PhaseWeight[] = [
    { phaseId: "ph-assess-145t3", name: "Assessment", weight: 1 },
    { phaseId: "ph-dd-145t3", name: "Design Development", weight: 1 },
  ];
  const DISCIPLINES_145T3 = ["rigging"];

  // Fixed test names/ids, declared outside the try so the finally block
  // below can re-look-up and tear down every fixture this function writes,
  // by the SAME identifiers, regardless of how far setup got before a
  // throw — this is not a scratch DB, it may be the one real Neon instance
  // shared by Production/Preview/Development (#145 review round 3).
  const ENG_NAME_145T3 = "PUNCHLIST #145 T3 integration test engagement";
  const SET_NAME_145T3 = "PUNCHLIST #145 T3 integration test set";
  const SET_NAME_145T3_PROJECT = "PUNCHLIST #145 T3 integration test set — project";
  const PROJECT_ID_145T3 = "test-project-punch145-t3";

  try {
    const eng145t3 =
      (await allEngagements()).find((e) => e.name === ENG_NAME_145T3) ||
      (await createManualEngagement(
        {
          customerId: "test-customer-145t3",
          customer: "Test Customer #145 T3",
          name: ENG_NAME_145T3,
          phases: ["Assessment", "Design Development"],
        },
        { name: "Test Harness" }
      ));

    const linesFor145t3: TaskTemplateLine[] = [
      {
        key: "t3-person", title: "T3 in-scope person line", section: "",
        target: { kind: "person", userId: "u1" },
        phase: "Assessment", discipline: "", startPct: 0, lengthPct: 100,
      },
      {
        key: "t3-wrong-phase", title: "T3 wrong-phase line", section: "",
        target: { kind: "team" },
        phase: "Nonexistent Phase", discipline: "", startPct: 0, lengthPct: 100,
      },
      {
        key: "t3-wrong-discipline", title: "T3 wrong-discipline line", section: "",
        target: { kind: "team" },
        phase: "Assessment", discipline: "lighting", startPct: 0, lengthPct: 100,
      },
      {
        key: "t3-blank-discipline", title: "T3 blank-discipline line", section: "",
        target: { kind: "team" },
        phase: "Design Development", discipline: "", startPct: 10, lengthPct: 20,
      },
      {
        key: "t3-role", title: "T3 role line", section: "",
        target: { kind: "role", role: "Estimator" },
        phase: "Assessment", discipline: "rigging", startPct: 0, lengthPct: 100,
      },
    ];

    const found145t3 = (await allTaskTemplateSets()).find((s) => s.name === SET_NAME_145T3);
    const set145t3 = found145t3
      ? await updateTaskTemplateSet(found145t3.id, { lines: linesFor145t3 })
      : await createTaskTemplateSet({ name: SET_NAME_145T3, appliesTo: ["consulting"], lines: linesFor145t3 }, { name: "Test Harness" });
    if (!set145t3) throw new Error("#145 T3 setup: template set not found after create/update");

    const schedule145t3: ApplyTemplateSchedule = {
      startAt: ENG_START_145T3, endAt: ENG_END_145T3, phases: PHASES_145T3, disciplines: DISCIPLINES_145T3,
    };
    await applyTaskTemplate(set145t3.id, { kind: "consulting", id: eng145t3.id }, { name: "Test Harness" }, schedule145t3);

    const engTasks145t3 = await tasksForEngagement(eng145t3.id);
    const byTitle145t3 = (title: string) => engTasks145t3.filter((t) => t.title === title);

    ok(
      byTitle145t3("T3 wrong-phase line").length === 0,
      "#145 T3 a line whose phase the engagement doesn't have never produces a task for anyone"
    );
    ok(
      byTitle145t3("T3 wrong-discipline line").length === 0,
      "#145 T3 a line whose discipline the engagement didn't buy never produces a task for anyone"
    );

    const blankDiscTasks145t3 = byTitle145t3("T3 blank-discipline line");
    ok(
      blankDiscTasks145t3.length > 0,
      "#145 T3 a blank-discipline line DOES expand even when the engagement bought only some disciplines"
    );
    ok(
      blankDiscTasks145t3.every((t) => t.engagementId === eng145t3.id && t.schedule?.phaseId === "ph-dd-145t3"),
      "#145 T3 the blank-discipline line's tasks are placed in their own phase window"
    );

    const personTasks145t3 = byTitle145t3("T3 in-scope person line");
    ok(personTasks145t3.length === 1, "#145 T3 a person-target in-scope line produces exactly one task");
    ok(personTasks145t3[0]?.assigneeUserId === "u1", "#145 T3 the person-target task is assigned to the named person");
    ok(
      personTasks145t3[0]?.schedule?.phaseId === "ph-assess-145t3" &&
        personTasks145t3[0]?.startAt === ENG_START_145T3 &&
        personTasks145t3[0]?.dueAt === ENG_START_145T3 + 50 * DAY145,
      "#145 T3 the person-target task carries the phase's own placement (startPct 0 / lengthPct 100 of a 50-day window)"
    );

    const roleUsers145t3 = (await activeUsers()).filter((u) => (u.roles || []).includes("Estimator"));
    const roleTasks145t3 = byTitle145t3("T3 role line");
    ok(
      roleUsers145t3.length > 0 && roleTasks145t3.length === roleUsers145t3.length,
      "#145 T3 a role line fans out to exactly one task per active user holding that role"
    );
    ok(
      roleTasks145t3.every(
        (t) => t.schedule?.phaseId === "ph-assess-145t3" && t.startAt === ENG_START_145T3 && t.dueAt === ENG_START_145T3 + 50 * DAY145
      ),
      "#145 T3 every fanned-out role task carries the SAME placement (the ::userId suffix is stripped before the placement lookup)"
    );
    ok(
      new Set(roleTasks145t3.map((t) => t.assigneeUserId)).size === roleUsers145t3.length,
      "#145 T3 each role-line task is assigned to a distinct matching user"
    );

    /* ---- guard: a consulting target with no schedule must throw, not silently skip the gate ---- */
    let threw145t3 = false;
    let thrownMessage145t3 = "";
    try {
      await applyTaskTemplate(set145t3.id, { kind: "consulting", id: eng145t3.id }, { name: "Test Harness" });
    } catch (e) {
      threw145t3 = true;
      thrownMessage145t3 = e instanceof Error ? e.message : String(e);
    }
    ok(
      threw145t3,
      "#145 T3 applying a template to a consulting engagement with no schedule throws instead of silently skipping the scope gate"
    );
    ok(
      /schedul/i.test(thrownMessage145t3) && /consulting/i.test(thrownMessage145t3),
      "#145 T3 the no-schedule guard's error names the missing schedule and the consulting engagement"
    );

    /* ---- omitting schedule reproduces the old behaviour exactly (project target) ---- */
    if (!(await getProject(PROJECT_ID_145T3))) {
      await upsertDoc("projects", {
        id: PROJECT_ID_145T3,
        kind: "project",
        quoteId: null,
        projectType: null,
        name: "PUNCHLIST #145 T3 test project",
        customer: "Test Customer #145 T3",
        customerId: null,
        locationId: null,
        owner: "Test Harness",
        value: 0,
        stage: "procurement",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    const linesFor145t3Project: TaskTemplateLine[] = [
      {
        key: "t3-proj-line", title: "T3 project line (no schedule)", section: "",
        target: { kind: "person", userId: "u1" },
        // Deliberately garbage phase/discipline/percentages — with no schedule
        // argument the `if (schedule)` block never runs, so these must be
        // entirely ignored, exactly like every pre-#145 template line.
        phase: "Totally Made Up Phase", discipline: "not-a-real-discipline", startPct: 999, lengthPct: -50,
      },
    ];
    const foundProj145t3 = (await allTaskTemplateSets()).find((s) => s.name === SET_NAME_145T3_PROJECT);
    const set145t3Project = foundProj145t3
      ? await updateTaskTemplateSet(foundProj145t3.id, { lines: linesFor145t3Project })
      : await createTaskTemplateSet(
          { name: SET_NAME_145T3_PROJECT, appliesTo: ["project"], lines: linesFor145t3Project },
          { name: "Test Harness" }
        );
    if (!set145t3Project) throw new Error("#145 T3 setup: project template set not found after create/update");

    await applyTaskTemplate(set145t3Project.id, { kind: "project", id: PROJECT_ID_145T3 }, { name: "Test Harness" });
    const projTasks145t3 = (await tasksForProject(PROJECT_ID_145T3)).filter((t) => t.title === "T3 project line (no schedule)");
    ok(projTasks145t3.length === 1, "#145 T3 omitting schedule still applies a template to a project target exactly as before");
    ok(
      projTasks145t3[0]?.startAt === null &&
        projTasks145t3[0]?.dueAt === null &&
        projTasks145t3[0]?.schedule === null &&
        projTasks145t3[0]?.handScheduled === false,
      "#145 T3 omitting schedule produces no dates, no schedule, and handScheduled false — the old behaviour exactly"
    );
  } finally {
    // Teardown (#145 review round 3): this function must leave NO trace in
    // what may be the one real Neon database shared across Production/
    // Preview/Development — on the success path AND on a mid-test throw.
    // Re-queried by the same fixed names/ids setup used above, rather than
    // trusting local variables to have survived an early throw, so cleanup
    // is complete no matter how far setup got.
    const engToClean = (await allEngagements()).find((e) => e.name === ENG_NAME_145T3);
    if (engToClean) {
      for (const t of await tasksForEngagement(engToClean.id)) await removeTask(t.id);
      await softDeleteDoc("consulting_engagements", engToClean.id);
    }
    for (const t of await tasksForProject(PROJECT_ID_145T3)) await removeTask(t.id);
    await removeProject(PROJECT_ID_145T3);
    const setToClean = (await allTaskTemplateSets()).find((s) => s.name === SET_NAME_145T3);
    if (setToClean) await removeTaskTemplateSet(setToClean.id);
    const setProjectToClean = (await allTaskTemplateSets()).find((s) => s.name === SET_NAME_145T3_PROJECT);
    if (setProjectToClean) await removeTaskTemplateSet(setProjectToClean.id);
  }
}

/* ====== #145 D170: the Activity feed merges existing records ====== */
const feed145 = mergeActivity({
  notes: [
    { id: "N-1", at: 300, text: "Call with Dana", by: "Jeff", attachments: [], taskIds: ["T-9"], system: false },
    { id: "N-2", at: 500, text: "Milestone moved", by: "Jeff", attachments: [], taskIds: [], system: true },
  ],
  meetings: [{ id: "mt-1", at: 400, title: "Design review", attendees: "Dana, Jeff", minutes: "..." }],
  decisions: [{ id: "dc-1", at: 200, by: "Jeff", decision: "Fire curtain in scope", context: "" }],
  phaseAttachments: [{ id: "ed-1", addedAt: 100, name: "as-built.dwg", addedBy: "Chris", phaseName: "DD" }],
});
ok(feed145.length === 5, "#145 the feed merges notes, meetings, decisions and phase attachments with nothing new stored");
ok(feed145[0].at === 500 && feed145[4].at === 100, "#145 the feed is newest first");
ok(feed145[0].kind === "note" && feed145[0].system === true, "#145 a milestone-move note is marked system so the feed can style it apart");
ok(feed145.find((e) => e.id === "N-1")?.taskIds.join(",") === "T-9", "#145 a note carries the tasks it spawned so a task's origin stays answerable");
ok(feed145.filter((e) => e.kind === "meeting").length === 1, "#145 meetings appear without being copied into notes");
ok(mergeActivity({ notes: [], meetings: [], decisions: [], phaseAttachments: [] }).length === 0, "#145 an empty engagement produces an empty feed, not a crash");

/* ====== #145 D171: the file seam and its ownership check ====== */
ok(engagementFolderPath("Cedar Grove Schools", "CE-1044") === "Peak Projects/Cedar Grove Schools/CE-1044", "#145 the Drive folder path is customer then engagement id");
ok(engagementFolderPath("A/B \\ C", "CE-1") === "Peak Projects/A-B - C/CE-1", "#145 path separators in a customer name are sanitized, never used as folders");
ok(fileRefName({ kind: "drive", fileId: "f1", webViewLink: "x", name: "set.pdf", mime: "application/pdf", size: 10 }) === "set.pdf", "#145 fileRefName reads across every union member");

const ownedRefs145: FileRef[] = [
  { kind: "drive" as const, fileId: "good", webViewLink: "x", name: "a.pdf", mime: "application/pdf", size: 1 },
  { kind: "blob" as const, pathname: "engagement-files/CE-1/b.pdf", name: "b.pdf", mime: "application/pdf", size: 1 },
];
ok(ownsEngagementFile(ownedRefs145, "good", "CE-1"), "#145 a Drive id stored on the engagement is streamable (DB-level half only — the proxy's live Drive parents re-check is the other half, not spec-testable here with no network)");
ok(ownsEngagementFile(ownedRefs145, "engagement-files/CE-1/b.pdf", "CE-1"), "#145 a Blob pathname stored on the engagement, under ITS OWN engagement prefix, is streamable");
ok(!ownsEngagementFile(ownedRefs145, "someone-elses-file", "CE-1"), "#145 an id NOT stored on this engagement is refused — the vendor-quote arbitrary-read lesson");
ok(!ownsEngagementFile([], "good", "CE-1"), "#145 an engagement with no files streams nothing");
ok(!ownsEngagementFile(ownedRefs145, "", "CE-1"), "#145 an empty id is refused rather than matching a falsy field");
ok(!ownsEngagementFile(ownedRefs145, "good", ""), "#145 an empty engagementId is refused even if the key is stored somewhere");

/* The vendor-quote precedent (ownsVendorQuoteBlobPath) is TWO checks: is it
 * stored, AND does the path's own shape belong to this exact record. A
 * writer that takes client-supplied FileRef data (this seam's note
 * attachments) makes the "is it stored" half attacker-controlled, so a
 * "blob" key must ALSO structurally sit under THIS engagement's own
 * upload prefix — closing the hole a forged attachment on the attacker's
 * OWN engagement would otherwise open onto another engagement's, or
 * another feature's, private files. */
const crossEngRef145: FileRef = { kind: "blob", pathname: "engagement-files/CE-2/other.pdf", name: "other.pdf", mime: "application/pdf", size: 1 };
ok(
  !ownsEngagementFile([crossEngRef145], "engagement-files/CE-2/other.pdf", "CE-1"),
  "#145 a blob ref whose OWN pathname prefix names a DIFFERENT engagement is refused, even though the key is 'stored' on this one — the exact shape of the attack once a note-save writer takes client-supplied FileRefs"
);
const traversalRef145: FileRef = { kind: "blob", pathname: "engagement-files/CE-1/../../vendor-quotes/secret.pdf", name: "secret.pdf", mime: "application/pdf", size: 1 };
ok(
  !ownsEngagementFile([traversalRef145], "engagement-files/CE-1/../../vendor-quotes/secret.pdf", "CE-1"),
  "#145 a blob pathname containing '..' is refused even when its literal prefix matches this engagement"
);
ok(
  !ownsEngagementFile(
    [{ kind: "blob", pathname: "vendor-quotes/vq123-secret.pdf", name: "secret.pdf", mime: "application/pdf", size: 1 }],
    "vendor-quotes/vq123-secret.pdf",
    "CE-1"
  ),
  "#145 a blob pathname borrowed from an unrelated feature's own prefix (vendor-quotes/) is refused"
);

/* fileRefKey / fileRefHref — not in the brief's floor, added for coverage
 * of the two other exports consulting-files.ts produces. */
const dataRef145: FileRef = { kind: "data", dataUrl: "data:text/plain,hi", name: "c.txt", mime: "text/plain", size: 2 };
ok(fileRefKey(dataRef145) === "", "#145 a data-URL ref has no storage key");
ok(!ownsEngagementFile([dataRef145], "", "CE-1"), "#145 a data-URL ref's empty key never matches an empty request either");
ok(fileRefHref(dataRef145, "CE-1") === dataRef145.dataUrl, "#145 a data-URL ref's href is the data URL itself — no network round trip");
ok(fileRefHref(ownedRefs145[0], "CE-1044", "N-1", 0) === "/api/engagement-files/CE-1044/N-1/0", "#145 a drive ref's href routes through the ownership-checked proxy, not a raw Drive link");
ok(fileRefHref(ownedRefs145[1], "CE-1", "N-2", 1) === "/api/engagement-files/CE-1/N-2/1", "#145 a blob ref's href is proxied through the note attachment route");

/* ====== #145 round 3: positive-shape validation replaces the '..' denylist ======
 * The reviewer checked @vercel/blob's constructBlobUrl directly: it
 * interpolates the pathname RAW and UNENCODED into the blob URL, so a
 * percent-encoded traversal segment carries no literal '..' and would
 * have sailed through the old denylist while still reaching that URL
 * construction. isOwnedBlobPathname (which ownsEngagementFile now calls)
 * validates the remainder POSITIVELY instead — this is the regression
 * test for exactly that gap. */
ok(
  !isOwnedBlobPathname("engagement-files/CE-1/%2e%2e%2f%2e%2e%2fvendor-quotes/x.pdf", "CE-1"),
  "#145 a percent-encoded traversal segment carries no literal '..' but is refused by the positive shape check — a denylist alone would have let this through"
);
ok(
  !ownsEngagementFile(
    [{ kind: "blob", pathname: "engagement-files/CE-1/%2e%2e%2f%2e%2e%2fvendor-quotes/x.pdf", name: "x.pdf", mime: "application/pdf", size: 1 }],
    "engagement-files/CE-1/%2e%2e%2f%2e%2e%2fvendor-quotes/x.pdf",
    "CE-1"
  ),
  "#145 ownsEngagementFile refuses the same percent-encoded traversal case end to end"
);
ok(
  !isOwnedBlobPathname("engagement-files/CE-1/plan.pdf?x=1", "CE-1"),
  "#145 a '?' in the remainder is refused — it would turn part of the key into a query string against the raw-interpolated blob URL"
);
ok(
  !isOwnedBlobPathname("engagement-files/CE-1/plan.pdf#frag", "CE-1"),
  "#145 a '#' in the remainder is refused for the same reason"
);
ok(
  isOwnedBlobPathname("engagement-files/CE-1/My_Drawing-Set_v2.pdf", "CE-1"),
  "#145 an ordinary safeName-shaped filename — the only shape putBlob's writer ever mints — still passes the positive check"
);
ok(
  isOwnedBlobPathname("engagement-files/CE-1/sub/My_Drawing-Set_v2-Ab12Cd34.pdf", "CE-1"),
  "#145 a filename carrying putBlob's random suffix, one directory segment deep, still passes"
);
ok(!isOwnedBlobPathname("", "CE-1"), "#145 an empty pathname is refused");
ok(!isOwnedBlobPathname("engagement-files/CE-1/plan.pdf", ""), "#145 an empty engagementId is refused even with an otherwise-valid pathname");

/* safeMime — positive validation, not a CR/LF-only denylist. */
ok(safeMime("application/pdf") === "application/pdf", "#145 safeMime passes through an ordinary mime token");
ok(safeMime("application/pdf\r\nX-Injected: 1") === "application/octet-stream", "#145 safeMime clamps a value containing CR/LF");
ok(safeMime("text/plain\x00") === "application/octet-stream", "#145 safeMime clamps a value containing a control byte, not just CR/LF");
ok(safeMime("app/☺") === "application/octet-stream", "#145 safeMime clamps non-ASCII — a positive check, not a denylist of specific bad bytes");
ok(safeMime(null) === "application/octet-stream" && safeMime(undefined) === "application/octet-stream" && safeMime("") === "application/octet-stream", "#145 safeMime defaults on absent input");

/* isValidDataRef — the only place a client-supplied dataUrl is ever
 * inspected at all, since the download proxy never touches a "data" ref
 * (fileRefKey returns "" for it). */
ok(
  isValidDataRef({ kind: "data", dataUrl: "data:text/plain,hello", name: "a.txt", mime: "text/plain", size: 5 }),
  "#145 isValidDataRef accepts a plain-text data URL"
);
ok(
  isValidDataRef({ kind: "data", dataUrl: "data:application/pdf;base64,JVBERi0xLjQK", name: "a.pdf", mime: "application/pdf", size: 9 }),
  "#145 isValidDataRef accepts a base64 data URL with a benign declared mime"
);
ok(
  !isValidDataRef({ kind: "data", dataUrl: "data:text/html,<script>alert(1)</script>", name: "evil.html", mime: "text/html", size: 30 }),
  "#145 isValidDataRef refuses a data URL declaring an HTML-renderable mime — nothing else inspects this before a UI might render it"
);
ok(
  !isValidDataRef({ kind: "data", dataUrl: "data:image/svg+xml,<svg onload=alert(1)></svg>", name: "evil.svg", mime: "image/svg+xml", size: 30 }),
  "#145 isValidDataRef refuses image/svg+xml the same way — SVG executes script like HTML"
);
ok(
  !isValidDataRef({ kind: "data", dataUrl: "data:text/plain,fine", name: "sneaky.txt", mime: "text/html", size: 4 }),
  "#145 isValidDataRef checks the ref's OWN declared mime too, not only the data URL's scheme mime — a mismatched pair is refused"
);
ok(
  !isValidDataRef({ kind: "data", dataUrl: "not-a-data-url-at-all", name: "a.txt", mime: "text/plain", size: 5 }),
  "#145 isValidDataRef refuses a malformed data URL"
);
ok(
  !isValidDataRef({ kind: "data", dataUrl: "data:text/plain;base64," + "A".repeat(3_000_000), name: "a.txt", mime: "text/plain", size: 5 }),
  "#145 isValidDataRef refuses a payload far beyond the stated ceiling regardless of what a claimed size says"
);

/* initiateResumableSession itself is exercised indirectly but exactly: the
 * existing uploadFileResumable tests above assert the precise headers
 * (X-Upload-Content-Length, X-Upload-Content-Type) and body sent on the
 * initiate POST, and uploadFileResumable now calls initiateResumableSession
 * to produce that request — so those assertions passing IS the proof the
 * split preserved the recordings archive's behaviour. A direct async unit
 * test was left out here rather than threaded into the file's existing
 * recordingsAsyncChecks()-then-chain (this file has no per-block async
 * runner, and a stray top-level await breaks the tsx/esbuild cjs build). */

/* ====== #145: span validation is pure and blocks at creation ====== */
ok(validateSpan(OCT6, MAR30) === null, "#145 a normal span validates");
ok(validateSpan(0, MAR30) !== null, "#145 a missing start is rejected with a message");
ok(validateSpan(MAR30, OCT6) !== null, "#145 an end before the start is rejected rather than generating a degenerate schedule");
ok(validateSpan(OCT6, OCT6) !== null, "#145 a zero-length span is rejected — every task would land on one day");
ok((validateSpan(MAR30, OCT6) || "").toLowerCase().includes("end"), "#145 the rejection message names the field at fault");

/* ====== #145 review fix: withEngagementPhaseIds / defaultMilestonePhaseId
 * are pure and directly testable (moved out of schedule-actions.ts, a
 * "use server" module the harness can't import — same reason validateSpan
 * lives here instead of there). ====== */
{
  const weights: PhaseWeight[] = [
    { phaseId: "slug-assessment", name: "Assessment", weight: 1 },
    { phaseId: "slug-design", name: "Design", weight: 2 },
  ];
  const enginePhases = [
    { id: "ph-real-1", name: "Assessment" },
    { id: "ph-real-2", name: "Design" },
  ];
  const mapped = withEngagementPhaseIds(weights, enginePhases);
  ok(mapped[0].phaseId === "ph-real-1", "#145 withEngagementPhaseIds maps the first weight onto the engagement's own phase id");
  ok(mapped[1].phaseId === "ph-real-2", "#145 …and the second, by name — not by having guessed position");
  ok(mapped[0].name === "Assessment" && mapped[0].weight === 1, "#145 …name and weight pass through untouched");

  // A weight name absent from the engine's phases keeps its own (slug) id
  // rather than being dropped — the output is never shorter than the input.
  const orphanWeights: PhaseWeight[] = [{ phaseId: "slug-ghost", name: "Ghost Phase", weight: 1 }];
  const orphanMapped = withEngagementPhaseIds(orphanWeights, enginePhases);
  ok(orphanMapped.length === 1 && orphanMapped[0].phaseId === "slug-ghost", "#145 a weight with no matching engine phase keeps its slug id instead of being dropped");

  // An engine phase absent from the weight list has no opinion voiced for
  // it — it just never appears in the output (which is keyed off `weights`).
  const shortWeights: PhaseWeight[] = [{ phaseId: "slug-design", name: "Design", weight: 1 }];
  const shortMapped = withEngagementPhaseIds(shortWeights, enginePhases);
  ok(shortMapped.length === 1 && shortMapped[0].phaseId === "ph-real-2", "#145 an engine phase with no matching weight simply isn't in the output — nothing invents an entry for it");

  // Case-insensitive, trim-tolerant, matching phaseWindows/generateSchedule's own norm().
  const looseWeights: PhaseWeight[] = [{ phaseId: "slug-x", name: "  assessment  ", weight: 1 }];
  const looseMapped = withEngagementPhaseIds(looseWeights, enginePhases);
  ok(looseMapped[0].phaseId === "ph-real-1", "#145 withEngagementPhaseIds matches case-insensitively and trims whitespace");
}
{
  const byName = phaseIdsByName([{ id: "ph-1", name: "Assessment" }, { id: "ph-2", name: "Design Development" }]);
  ok(byName.get("assessment") === "ph-1", "#145 phaseIdsByName keys by the normalized (trimmed, lowercased) name");

  ok(
    defaultMilestonePhaseId({ name: "Assessment", phaseId: "already-set" }, byName) === "already-set",
    "#145 defaultMilestonePhaseId leaves an already-set phaseId alone even though the name would also match"
  );
  ok(
    defaultMilestonePhaseId({ name: " Design Development ", phaseId: null }, byName) === "ph-2",
    "#145 defaultMilestonePhaseId assigns by exact (trimmed/case-insensitive) name match when phaseId is unset"
  );
  ok(
    defaultMilestonePhaseId({ name: "No Such Phase", phaseId: undefined }, byName) === null,
    "#145 defaultMilestonePhaseId defaults to null rather than guessing when nothing matches"
  );
}
/* ====== #145 D169: task-template CSV ====== */
const ttType145 = IMPORT_TYPES.find((t) => t.key === "task_templates");
ok(!!ttType145, "#145 task_templates is a registered import type");
ok(ttType145!.fields.map((f) => f.header).join(",") === "Template Set,Applies To,Phase,Discipline,Task,Section,Assign To,Start %,Length %", "#145 the template CSV columns match the spec exactly");
ok(ttType145!.fields.filter((f) => f.required).map((f) => f.key).join(",") === "set,task", "#145 only the set name and the task title are required");
ok(ttType145!.fields.every((f) => f.hidden || typeof f.example === "string"), "#145 every visible column carries an example so the downloadable template is fillable");

ok(parseAssignTarget("team", []).kind === "team", "#145 'team' parses to the everyone target");
ok(parseAssignTarget("role:Estimator", []).kind === "role", "#145 'role:X' parses to a role target");
const users145 = [{ id: "u1", name: "Jeff Chesebro" }];
const person145 = parseAssignTarget("person:Jeff Chesebro", users145);
ok(person145.kind === "person" && person145.userId === "u1", "#145 'person:Name' resolves to a user id");
ok(parseAssignTarget("person:Nobody At All", users145).kind === "team", "#145 an unresolvable person falls back to team rather than minting a task nobody owns");
ok(parseAssignTarget("", users145).kind === "team", "#145 a blank Assign To defaults to team");

/* ====== #145: the By person view (schedule/people-lib.ts, D172) ====== */
{
  const ppl145 = [{ id: "u1", name: "Jeff C." }, { id: "u2", name: "Chris C." }];
  const tk145 = [
    { id: "T-1", title: "SD set", assigneeUserId: "u1", assigneeName: "Jeff C.", startAt: OCT6, dueAt: OCT6 + 5 * DAY145, engagementId: "CE-1", handScheduled: false },
    { id: "T-2", title: "QC", assigneeUserId: "u1", assigneeName: "Jeff C.", startAt: OCT6 + 2 * DAY145, dueAt: OCT6 + 6 * DAY145, engagementId: "CE-1", handScheduled: false },
    { id: "T-3", title: "Rigging", assigneeUserId: null, assigneeName: "", startAt: OCT6, dueAt: OCT6 + DAY145, engagementId: "CE-1", handScheduled: false },
  ];
  const rows145 = groupByPerson(tk145, ppl145);
  ok(rows145.length === 3, "#145 groupByPerson emits a lane per active person plus an Unassigned lane");
  ok(rows145[0].bars.length === 2, "#145 a person's lane carries every task assigned to them across projects");
  ok(rows145.find((r) => r.label === "Unassigned")?.bars.length === 1, "#145 unassigned work is visible rather than silently dropped");
  ok(rows145.find((r) => r.label === "Chris C.")?.bars.length === 0, "#145 a person with no work still gets a lane — an empty lane is the answer to 'who is free'");
  ok(rows145[0].bars.every((b) => b.draggable), "#145 consulting bars are draggable on the portfolio view");

  // Review additions beyond the brief's own fixture — tone-by-engagement,
  // the no-startAt/dueAt skip, and an empty user list still yielding the
  // Unassigned lane (no rows === "grouping didn't run", not "no one to show").
  const tk145b = [
    { id: "T-4", title: "Other CE", assigneeUserId: "u1", assigneeName: "Jeff C.", startAt: OCT6, dueAt: OCT6 + DAY145, engagementId: "CE-2", handScheduled: false },
    { id: "T-5", title: "No dates", assigneeUserId: "u1", assigneeName: "Jeff C.", startAt: null, dueAt: null, engagementId: "CE-1", handScheduled: false },
  ];
  const rows145b = groupByPerson([...tk145, ...tk145b], ppl145);
  const jeffBars145b = rows145b[0].bars;
  ok(jeffBars145b.length === 3, "#145 a task with no startAt/dueAt is skipped — it has no bar — while its dated siblings still show");
  const ce1Tone = jeffBars145b.find((b) => b.id === "T-1")!.tone;
  const ce2Tone = jeffBars145b.find((b) => b.id === "T-4")!.tone;
  ok(ce1Tone !== ce2Tone, "#145 two different engagements get two different tones");
  ok(
    jeffBars145b.find((b) => b.id === "T-2")!.tone === ce1Tone,
    "#145 two tasks on the SAME engagement (CE-1) get the SAME tone — one project reads as one colour"
  );

  const rowsNoUsers145 = groupByPerson(tk145, []);
  ok(
    rowsNoUsers145.length === 1 && rowsNoUsers145[0].label === "Unassigned" && rowsNoUsers145[0].bars.length === 3,
    "#145 with no active users at all, every dated task still surfaces in the Unassigned lane rather than vanishing"
  );

  ok(
    groupByPerson([], []).length === 1 && groupByPerson([], [])[0].label === "Unassigned" && groupByPerson([], [])[0].bars.length === 0,
    "#145 an empty task list still yields the Unassigned lane, empty"
  );
}

/* ====== #145 review fix: mergeBookingsIntoPersonRows (schedule/people-lib.ts, D172) ======
 * The By person view's other half — page.tsx merges install/service
 * bookings onto groupByPerson's rows, and until this fix that merge lived
 * only in page.tsx, exercised by nothing but a smoke-test HTTP 200 and a
 * one-off browser session. Pulled into its own pure function for exactly
 * the same reason groupByPerson was: it's the code path where an
 * independently-edited "Unassigned" sentinel would silently drop every
 * unassigned booking on the floor (#145 review — Important 1). */
{
  const baseRows145 = groupByPerson(
    [
      {
        id: "T-10", title: "Bid walk", assigneeUserId: "u1", assigneeName: "Jeff C.",
        startAt: OCT6, dueAt: OCT6 + 3 * DAY145, engagementId: "CE-9",
      },
    ],
    [{ id: "u1", name: "Jeff C." }, { id: "u2", name: "Chris C." }]
  );

  const booking145 = (over: Partial<PersonBooking>): PersonBooking => ({
    crewId: "cw-1", projectName: "Harbor Rep", person: "Jeff C.",
    start: OCT6, end: OCT6 + 2 * DAY145, color: "#123456",
    ...over,
  });

  // 1. Someone carrying BOTH a consulting task and an install booking ends
  //    up with both bars in the SAME lane.
  const merged145a = mergeBookingsIntoPersonRows(baseRows145, [booking145({ crewId: "cw-1", person: "Jeff C." })]);
  const jeffRow145a = merged145a.find((r) => r.label === "Jeff C.");
  ok(
    !!jeffRow145a && jeffRow145a.bars.length === 2 && jeffRow145a.bars.some((b) => b.id === "T-10") && jeffRow145a.bars.some((b) => b.id === "install:cw-1"),
    "#145 a person carrying both a consulting task and an install booking gets both bars in one lane"
  );
  ok(
    merged145a.length === baseRows145.length,
    "#145 a booking for someone already in a row adds a bar, not a whole new lane"
  );

  // 2. An install booking for an UNASSIGNED person lands in the Unassigned
  //    lane rather than being dropped — matched by the real UNASSIGNED_LABEL
  //    constant, not a locally re-typed "Unassigned" string.
  const merged145b = mergeBookingsIntoPersonRows(baseRows145, [booking145({ crewId: "cw-2", person: UNASSIGNED_LABEL })]);
  const unassignedRow145b = merged145b.find((r) => r.label === UNASSIGNED_LABEL);
  ok(
    !!unassignedRow145b && unassignedRow145b.bars.length === 1 && unassignedRow145b.bars[0].id === "install:cw-2",
    "#145 an install booking for an unassigned person lands in the Unassigned lane rather than vanishing"
  );
  ok(merged145b.length === baseRows145.length, "#145 an unassigned booking is folded into the existing Unassigned row, not a new one");

  // 3. A booked name with NO matching row gets its own synthesized row —
  //    never silently dropped.
  const merged145c = mergeBookingsIntoPersonRows(baseRows145, [booking145({ crewId: "cw-3", person: "Rose Brand Sub" })]);
  const extraRow145c = merged145c.find((r) => r.label === "Rose Brand Sub");
  ok(
    !!extraRow145c && extraRow145c.bars.length === 1 && extraRow145c.bars[0].id === "install:cw-3",
    "#145 a booked name with no matching user gets its own synthesized row rather than vanishing"
  );
  ok(
    merged145c.length === baseRows145.length + 1 && merged145c[merged145c.length - 1].label === UNASSIGNED_LABEL,
    "#145 the synthesized row is appended before Unassigned, which stays last"
  );

  // 4. Every merged install/service bar is draggable: false — D172 — while
  //    the consulting bars it sits beside are untouched (still draggable).
  const merged145d = mergeBookingsIntoPersonRows(baseRows145, [booking145({ crewId: "cw-4", person: "Jeff C." })]);
  const jeffRow145d = merged145d.find((r) => r.label === "Jeff C.")!;
  ok(
    jeffRow145d.bars.find((b) => b.id === "install:cw-4")?.draggable === false,
    "#145 a merged install/service bar is draggable: false"
  );
  ok(
    jeffRow145d.bars.find((b) => b.id === "T-10")?.draggable === true,
    "#145 the consulting bar sitting beside it is untouched — still draggable"
  );

  // groupByPerson's own rows/bars are never mutated by the merge.
  const beforeJeffBars = JSON.stringify(baseRows145.find((r) => r.label === "Jeff C.")?.bars);
  mergeBookingsIntoPersonRows(baseRows145, [booking145({ crewId: "cw-5", person: "Jeff C." }), booking145({ crewId: "cw-6", person: UNASSIGNED_LABEL })]);
  ok(
    JSON.stringify(baseRows145.find((r) => r.label === "Jeff C.")?.bars) === beforeJeffBars,
    "#145 mergeBookingsIntoPersonRows never mutates the rows groupByPerson returned"
  );

  // No bookings at all: the merge is a same-shape passthrough.
  const merged145e = mergeBookingsIntoPersonRows(baseRows145, []);
  ok(
    merged145e.length === baseRows145.length && merged145e.every((r, i) => r.bars.length === baseRows145[i].bars.length),
    "#145 with no bookings, the merge changes nothing"
  );
}

/* ====== #145 D170: Krisp / meeting pre-fill ====== */
const pre145 = prefillFromMeeting({ id: "mt-1", at: OCT6, title: "Design review — SD", attendees: "Dana Kim, Jeff C.", minutes: "District wants the fire curtain in scope." });
ok(pre145.text.includes("Design review — SD"), "#145 the pre-filled body leads with the meeting title");
ok(pre145.text.includes("fire curtain"), "#145 the pre-filled body carries the minutes verbatim");
ok(pre145.attendees.join("|") === "Dana Kim|Jeff C.", "#145 attendees are split for attachment to the note");
ok(prefillFromMeeting({ id: "m", at: 0, title: "", attendees: "", minutes: "" }).text === "", "#145 an empty meeting pre-fills nothing rather than a header with no content");
ok(!prefillFromMeeting({ id: "m", at: OCT6, title: "x", attendees: "", minutes: "y" }).text.includes("undefined"), "#145 a meeting with no attendees never renders the string 'undefined'");

/* ====== #162 DaVinci enrichment — SKU normalizer ====== */
ok(normalizeSku("ETC:ION XE 2K-US") === "IONXE2KUS", "#162 a MFR: prefix is stripped before normalizing");
ok(normalizeSku("ION XE 2K-US") === "IONXE2KUS", "#162 a bare production SKU normalizes to the same key");
ok(normalizeSku("ETC:ION XE 2K-US") === normalizeSku("ION XE 2K-US"), "#162 dev and prod spellings of one part agree");
ok(normalizeSku("IRWLZ-30/80-120-C-DALI-1") === "IRWLZ3080120CDALI1", "#162 slashes and dashes are dropped");
ok(normalizeSku("  arcp1s360wy  ") === "ARCP1S360WY", "#162 case and surrounding space are normalized");
ok(normalizeSku("") === "", "#162 an empty SKU normalizes to empty, not to a match-everything key");
ok(normalizeSku("::::") === "", "#162 a SKU that is only separators normalizes to empty");
// A colon INSIDE the model number must not eat the real identifier.
ok(normalizeSku("Allen & Heath:AH-DLIVE-CDM32-RUFX") === "AHDLIVECDM32RUFX", "#162 only the first prefix segment is dropped");

/* ====== #162 protocol map ====== */
ok(Object.keys(PROTOCOL_MAP).length === 56, "#162 every one of DaVinci's 56 protocols is mapped explicitly");

// An unknown protocol must fail loudly, never default to something plausible.
let threw162 = false;
try { mapProtocol("00000000-0000-0000-0000-000000000000", "RJ45 Female"); } catch { threw162 = true; }
ok(threw162, "#162 an unmapped protocol UUID throws rather than guessing a connection type");

// D2 — the four NewPortProtocol entries are four different protocols.
const arc162 = [
  "a39a614e-3592-48f8-81d5-5d26a1d09e86",
  "a9f1dd53-e35a-439a-b4d4-898408b208f4",
  "ce5efb79-1a6b-4419-b597-2883291b6fad",
].map((id) => mapProtocol(id, "Molex Thru"));
const arcTypes162 = arc162.map((r) => ("connectionType" in r ? r.connectionType : "EXCLUDED"));
ok(new Set(arcTypes162).size === 3, "#162 the three ARCSYSTEM protocols stay three distinct connection types");
ok(
  "excluded" in mapProtocol("1660207c-f71c-492e-9978-ad1e3859b8cc", "Ethercon Male"),
  "#162 the blank fourth NewPortProtocol (RouteStubPrototype only) is excluded"
);

// The ten F-DRIVE protocols must not collapse either.
const fdrive162 = [
  "e4699b60-48e4-491b-8b8d-c0c90bff073e", "3b247b12-0139-4755-9303-986fd7f147e4",
  "9f1f7378-5890-4e8f-9e0f-a746d696e0d7", "39f8e3dc-6877-4d84-81e4-8db395a72eba",
  "c6ad45b9-e2d6-4a9e-95ac-d3c4fd63dd7d", "e1c07a88-547d-43bd-9c6c-bb230ad94de7",
  "e246c0e7-39ba-47c3-9bd1-52454b6e9149", "9b6372db-22d6-4690-a41f-89cd5b752575",
  "813d35ed-b976-4c98-bfe6-00ce240b42f9", "98fd246f-8612-4545-b303-a097beaba911",
].map((id) => mapProtocol(id, "RJ45 Female")).map((r) => ("connectionType" in r ? r.connectionType : "X"));
ok(new Set(fdrive162).size === 10, "#162 the ten F-DRIVE protocols do not collapse into one connection type");

// D3/D4 — power is the only place the connector refines the answer.
const POWER162 = "aa07559e-6609-4ec6-8df3-8990d6bc9909";
const ct162 = (id: string, c: string) => { const r = mapProtocol(id, c); return "connectionType" in r ? r.connectionType : "EXCLUDED"; };
ok(ct162(POWER162, "powerCON In") === "powerCON/True1", "#162 a powerCON connector resolves power to powerCON/True1");
ok(ct162(POWER162, "powerCON TRUE1 Male") === "powerCON/True1", "#162 TRUE1 resolves to powerCON/True1");
ok(ct162(POWER162, "Terminal Block") === "bare-end", "#162 a hardwired connector resolves power to bare-end");
ok(ct162(POWER162, "Screw Terminal") === "bare-end", "#162 screw terminals are bare-end");
ok(ct162(POWER162, "Power") === "line power (unspecified)", "#162 DaVinci's generic Power connector is not guessed as Edison or stage pin");
ok(ct162(POWER162, "") === "line power (unspecified)", "#162 a power port with no connector is unspecified, not bare-end");

// Voltage classes must never share an identity — a low-voltage auxiliary bus
// validating against a 480V feeder is the exact failure this map exists to prevent.
const AUX162 = "0c508822-833d-4169-b3cf-3fc1bd667947";
const V208_162 = "ca96a25e-b72f-4bb6-a628-f83dfb1caa83";
const V480_162 = "25636fee-a970-4c76-b5cc-7de92724a664";
ok(ct162(AUX162, "Terminal Block") !== ct162(V480_162, "Terminal Block"), "#162 auxiliary power and a 480V feeder are different connection types");
ok(ct162(V208_162, "Terminal Block") !== ct162(V480_162, "Terminal Block"), "#162 208V and 480V feeders are different connection types");
ok(ct162(AUX162, "Terminal Block") !== ct162(POWER162, "Terminal Block"), "#162 auxiliary power is not the same as hardwired mains");
// The three auxiliary protocols DO share one identity — they co-occur on one device as a Bus.
ok(
  ct162("1a0f1e55-53a5-452a-8294-9f8fd5c60783", "Terminal Block") === ct162(AUX162, "Terminal Block") &&
    ct162("9c23dfb5-6ec6-4afc-818a-e6de8acf3bcc", "Terminal Block") === ct162(AUX162, "Terminal Block"),
  "#162 the three auxiliary-power protocols share one identity so the bus still connects"
);

// The connector is advisory everywhere else: DMX is DMX on any connector.
const DMX162 = "698f9701-604c-4432-902f-19866c061108";
ok(
  ct162(DMX162, "Terminal Block") === ct162(DMX162, "DMX Female") && ct162(DMX162, "DMX Female") === "DMX512 (5-pin XLR)",
  "#162 DaVinci's dirty connector data never changes a non-power protocol's type"
);

// Directions — Bus and Configurable both become io.
ok(DIRECTION_MAP["Input"] === "in" && DIRECTION_MAP["Output"] === "out", "#162 Input/Output map to in/out");
ok(DIRECTION_MAP["Bidirectional"] === "io", "#162 Bidirectional maps to io");
ok(DIRECTION_MAP["Bus"] === "io", "#162 a Bus port maps to io — it connects in either direction");
ok(DIRECTION_MAP["Configurable"] === "io", "#162 a Configurable port maps to io");
ok(Object.keys(DIRECTION_MAP).length === 5, "#162 all five DaVinci directions are mapped");

ok(PASSTHROUGH_TYPES.length > 0 && PASSTHROUGH_TYPES.every((t) => t.startsWith("ETC ")), "#162 every pass-through type is namespaced so it cannot collide with a Peak type");

/* ====== #162 taxonomy ====== */
ok(CONNECTION_TYPES.includes("line power (unspecified)"), "#162 the unspecified-power type exists");
ok(
  PASSTHROUGH_TYPES.every((t) => CONNECTION_TYPES.includes(t)),
  "#162 every pass-through type the protocol map can emit is a declared connection type"
);
// No orphans: anything the map emits must be carried by some wire type, or the
// Grid can validate the wire but offer no cable for it.
const emitted162 = [...new Set(Object.values(PROTOCOL_MAP).flatMap((m) =>
  m.kind === "peak" || m.kind === "passthrough" ? [m.connectionType] : []
).concat(["powerCON/True1", "bare-end", "line power (unspecified)"]))];
const orphans162 = emitted162.filter((t) => compatibleWireTypes(t, DEFAULT_WIRE_TYPES).length === 0);
ok(orphans162.length === 0, `#162 no connection type is left without a wire type (orphans: ${orphans162.join(", ")})`);

// D1 — pass-through mates with itself and nothing else.
const p162 = (connectionType: string, direction: "in" | "out" | "io") => ({ name: "", direction, connectionType });
ok(
  canConnect(p162("ETC EchoConnect", "out"), p162("ETC EchoConnect", "in")),
  "#162 an EchoConnect output reaches an EchoConnect input"
);
ok(
  !canConnect(p162("ETC EchoConnect", "out"), p162("contact closure", "in")),
  "#162 EchoConnect does NOT reach a contact closure — the collapse this design refuses"
);
ok(
  !canConnect(p162("ETC ArcSystem D4 driver", "out"), p162("ETC ArcSystem D2 driver", "in")),
  "#162 two different ArcSystem driver families never cross-connect"
);
ok(
  canConnect(p162("ETC ArcSystem D4 driver", "out"), p162("ETC ArcSystem D4 driver", "in")),
  "#162 one ArcSystem driver family connects to itself"
);
// D4 — unspecified power reaches unspecified power (fixture ↔ dimmer) but is
// not silently equated with a specific connector.
ok(
  canConnect(p162("line power (unspecified)", "in"), p162("line power (unspecified)", "out")),
  "#162 a Source Four's unspecified power inlet reaches a dimmer's unspecified outlet"
);
ok(
  !canConnect(p162("line power (unspecified)", "in"), p162("Edison", "out")),
  "#162 unspecified power is not silently treated as Edison"
);
// speaker-pair stays the ONLY interchangeable family.
ok(
  DEFAULT_WIRE_TYPES.filter((w) => w.interchangeable).map((w) => w.id).join(",") === "speaker-pair",
  "#162 no ETC wire type is marked interchangeable — speaker-pair remains the only one"
);

/* ====== #162 extractor ====== */
const LIB162 = {
  timestamp: "2026-09-02T01:37:52.850Z",
  constants: {
    languages: [{ languageId: "L-EN", text: "English" }, { languageId: "L-FR", text: "Francais" }],
    documentTypes: [{ documentTypeId: "T-DS", text: "Datasheet" }, { documentTypeId: "T-MN", text: "Manual" }, { documentTypeId: "T-BR", text: "Brochure" }],
    categories: [{ categoryId: "C-1", text: "ColorSource" }, { categoryId: "C-X", text: "Internal-DO NOT USE" }],
    portDirections: [{ portDirectionId: "D-IN", text: "Input" }, { portDirectionId: "D-OUT", text: "Output" }, { portDirectionId: "D-BUS", text: "Bus" }],
    connectorTypes: [{ connectorTypeId: "K-PC", text: "powerCON In" }, { connectorTypeId: "K-DMX", text: "DMX Male" }, { connectorTypeId: "K-GEN", text: "Power" }],
    manufacturers: [{ manufacturerId: "M-ETC", text: "ETC" }, { manufacturerId: "M-HES", text: "High End Systems" }],
    portProtocols: [],
  },
  documents: { documents: [
    { documentId: "DOC-1", url: "https://example.test/ds-en.pdf", metadata: { name: "CSPAR Datasheet", type: "T-DS", language: "L-EN" } },
    { documentId: "DOC-2", url: "https://example.test/ds-fr.pdf", metadata: { name: "CSPAR Datasheet FR", type: "T-DS", language: "L-FR" } },
    { documentId: "DOC-3", url: "https://example.test/br-en.pdf", metadata: { name: "CSPAR Brochure", type: "T-BR", language: "L-EN" } },
    // Same URL as DOC-1 under a second document id — 8 real records do this.
    { documentId: "DOC-4", url: "https://example.test/ds-en.pdf", metadata: { name: "CSPAR Datasheet (reissue)", type: "T-DS", language: "L-EN" } },
  ] },
  types: [
    {
      typeId: "TY-1",
      typeInformation: {
        displayName: "ColorSource PAR", categoryId: "C-1", manufacturerId: "M-ETC",
        typeActive: { legacy: false, endActiveDate: "2999-12-31 23:59:59" },
      },
      partInformation: { generatorData: { lookupData: [
        { modelNumber: "CSPAR", partNumber: "7410A1001" },
        { modelNumber: "CSPAR-X", partNumber: "7410A1002" },
        { modelNumber: "cs-par/lo 3", partNumber: "7410a1003" },
      ] } },
      documents: ["DOC-1", "DOC-2", "DOC-3", "DOC-4"],
      ports: [
        { name: "", portProtocolId: "aa07559e-6609-4ec6-8df3-8990d6bc9909", connectorTypeId: "K-PC", portDirectionId: "D-IN" },
        { name: "", portProtocolId: "698f9701-604c-4432-902f-19866c061108", connectorTypeId: "K-DMX", portDirectionId: "D-IN" },
        { name: "", portProtocolId: "aa07559e-6609-4ec6-8df3-8990d6bc9909", connectorTypeId: "K-GEN", portDirectionId: "D-BUS" },
        // Identical to the DMX port above — 62 real records carry a repeat like
        // this, and parsePortsField refuses duplicates outright.
        { name: "", portProtocolId: "698f9701-604c-4432-902f-19866c061108", connectorTypeId: "K-DMX", portDirectionId: "D-IN" },
      ],
    },
    // Excluded: internal category.
    { typeId: "TY-X", typeInformation: { displayName: "RouteStubPrototype", categoryId: "C-X", manufacturerId: "M-ETC" },
      partInformation: { generatorData: { lookupData: [{ modelNumber: "STUB", partNumber: "X" }] } },
      documents: [], ports: [{ name: "", portProtocolId: "698f9701-604c-4432-902f-19866c061108", connectorTypeId: "K-DMX", portDirectionId: "D-IN" }] },
    // No ports and no docs: nothing to contribute, must not appear.
    { typeId: "TY-0", typeInformation: { displayName: "Empty", categoryId: "C-1", manufacturerId: "M-ETC" },
      partInformation: { generatorData: { lookupData: [{ modelNumber: "EMPTY", partNumber: "E" }] } }, documents: [], ports: [] },
    // A retired type: legacy false but the end date is long past.
    { typeId: "TY-OLD",
      typeInformation: { displayName: "Discontinued PAR", categoryId: "C-1", manufacturerId: "M-HES",
        typeActive: { legacy: false, endActiveDate: "2021-01-01 00:00:00" } },
      partInformation: { generatorData: { lookupData: [{ modelNumber: "OLDPAR", partNumber: "9999" }] } },
      documents: ["DOC-1"], ports: [] },
  ],
};
const ex162 = extractLibrary(LIB162);
ok(ex162.libraryTimestamp === "2026-09-02T01:37:52.850Z", "#162 the extract stamps the library's own timestamp");
ok(ex162.records.length === 2, "#162 internal-category and contentless types are dropped from the extract");
const r162 = ex162.records[0];
const old162 = ex162.records[1];
ok(r162.modelNumbers.includes("CSPAR") && r162.modelNumbers.includes("7410A1001"), "#162 both model and part numbers are indexed");
ok(r162.modelNumbers.length === 6, "#162 all six identifiers of a three-variant type are indexed");
ok(r162.modelNumbers.every((m) => m === m.toUpperCase()), "#162 indexed identifiers are pre-normalized");
ok(
  r162.modelNumbers.includes("CSPARLO3") && r162.modelNumbers.includes("7410A1003"),
  "#162 normalizeSku actually ran: the dirty variant's separators are stripped and case is upper"
);
ok(
  !r162.modelNumbers.includes("cs-par/lo 3") && !r162.modelNumbers.includes("7410a1003"),
  "#162 the raw, un-normalized forms never survive into modelNumbers"
);
ok(r162.docs.length === 1 && r162.docs[0].kind === "datasheet", "#162 only the English Datasheet/Manual documents survive");
ok(r162.docs[0].url === "https://example.test/ds-en.pdf", "#162 the document URL is carried verbatim");
// Review finding 8 — the catalog modal keys its document list on the URL, so a
// record repeating one is a duplicate React key and a doubled link.
ok(
  r162.docs.filter((d) => d.url === "https://example.test/ds-en.pdf").length === 1,
  "#162 a document URL repeated under a second document id is emitted once"
);
ok(r162.ports.length === 3, "#162 every port of a kept type is emitted");
ok(r162.ports[0].connectionType === "powerCON/True1" && r162.ports[0].direction === "in", "#162 a powerCON input maps through");
ok(r162.ports[1].connectionType === "DMX512 (5-pin XLR)", "#162 a DMX port maps through");
ok(r162.ports[2].connectionType === "line power (unspecified)" && r162.ports[2].direction === "io", "#162 a generic-connector Bus power port becomes unspecified/io");
ok(r162.ports.every((p) => typeof p.name === "string"), "#162 every emitted port has a string name, never undefined");

// Review finding 2 (BLOCKER) — parsePortsField REFUSES two ports sharing
// name+direction+connectionType, so an un-collapsed record would make the
// enriched catalog row un-saveable: even a price change would fail validation
// and strand the row behind a partError. The repeat has to become a `count`.
ok(r162.ports[1].count === 2, "#162 a repeated port collapses into one port with count 2");
ok(r162.ports[0].count === undefined, "#162 a port that occurs once carries no count (1 is the default)");
{
  const keys162 = r162.ports.map((p) => `${p.name}|${p.direction}|${p.connectionType}`);
  ok(new Set(keys162).size === keys162.length, "#162 no emitted record carries two ports with the same name+direction+connectionType");
  const parsed162 = parsePortsField(serializePorts(r162.ports));
  ok(parsed162.ok, "#162 a DaVinci record's ports survive the catalog editor's own validator — the enriched row stays saveable");
  ok(parsed162.ok && parsed162.ports[1].count === 2, "#162 the count round-trips through serializePorts/parsePortsField");
}

// Review finding 1 (BLOCKER) — the manufacturer has to reach the enricher, or
// a match on the normalized SKU alone puts ETC ports on a Draper part.
ok(r162.manufacturer === "ETC", "#162 the record carries DaVinci's own manufacturer label");
ok(old162.manufacturer === "High End Systems", "#162 the non-ETC DaVinci manufacturers are carried verbatim, not folded into ETC");
// Review finding 3 — active/legacy is what breaks an identifier collision.
ok(r162.active === true, "#162 a type whose end date is in the future is active");
ok(old162.active === false, "#162 a type whose endActiveDate has passed is not active, even with legacy: false");
ok(
  extractLibrary({ ...LIB162, types: [{ ...LIB162.types[0], typeInformation: { ...LIB162.types[0].typeInformation, typeActive: { legacy: true, endActiveDate: "2999-12-31 23:59:59" } } }] }).records[0].active === false,
  "#162 an explicitly legacy type is inactive whatever its end date says"
);
ok(
  extractLibrary({ ...LIB162, types: [{ ...LIB162.types[0], typeInformation: { displayName: "x", categoryId: "C-1", manufacturerId: "M-ETC" } }] }).records[0].active === true,
  "#162 a type with no typeActive block at all is treated as active — missing data never demotes a live type"
);

/* ====== #162 matcher ====== */
const IDX162 = buildIndex(ex162.records);
ok(matchSku("CSPAR", IDX162)?.typeId === "TY-1", "#162 a bare production SKU matches");
ok(matchSku("ETC:CSPAR", IDX162)?.typeId === "TY-1", "#162 a prefixed dev SKU matches the same record");
ok(matchSku("7410A1001", IDX162)?.typeId === "TY-1", "#162 a part number matches as well as a model number");
ok(matchSku("cspar", IDX162)?.typeId === "TY-1", "#162 matching is case-insensitive");
ok(matchSku("NOT-A-PART", IDX162) === null, "#162 an unknown SKU returns null, never a near miss");
ok(matchSku("", IDX162) === null, "#162 an empty SKU never matches");
ok(matchSku("   ", IDX162) === null, "#162 a whitespace SKU never matches");
// Review finding 3 — 440 of the 13,633 distinct identifiers are claimed by
// more than one type, so "first wins" is not a curiosity: 25 of them resolved
// to a record with NO ports while a live alternative had some. The tie-break is
// active → more ports → first-wins, in that order.
const rec162 = (o: Partial<DavinciRecord> & { typeId: string }): DavinciRecord => ({
  displayName: o.typeId, category: "c", manufacturer: "ETC", active: true,
  modelNumbers: ["SHARED"], ports: [], docs: [], ...o,
});
const port162 = (connectionType: string): Port => ({ name: "", direction: "in", connectionType });
const dupe162 = buildIndex([rec162({ typeId: "A" }), rec162({ typeId: "B" })]);
ok(matchSku("SHARED", dupe162)?.typeId === "A", "#162 a duplicated identifier with nothing to choose between resolves to the first record, deterministically");

ok(
  matchSku("SHARED", buildIndex([
    rec162({ typeId: "DISCONTINUED", active: false, ports: [port162("DMX512 (5-pin XLR)"), port162("fiber")] }),
    rec162({ typeId: "LIVE", active: true, ports: [port162("DMX512 (5-pin XLR)")] }),
  ]))?.typeId === "LIVE",
  "#162 a live type beats a discontinued one for a contested identifier, even with fewer ports"
);
ok(
  matchSku("SHARED", buildIndex([
    rec162({ typeId: "EMPTY", ports: [] }),
    rec162({ typeId: "PORTED", ports: [port162("DMX512 (5-pin XLR)")] }),
  ]))?.typeId === "PORTED",
  "#162 between two live types the one that actually carries ports wins — the IQCI/S4WRDPAR case"
);
ok(
  matchSku("SHARED", buildIndex([
    rec162({ typeId: "FIRST", ports: [port162("fiber")] }),
    rec162({ typeId: "SECOND", ports: [port162("DMX512 (5-pin XLR)")] }),
  ]))?.typeId === "FIRST",
  "#162 an equal-standing collision still falls back to first-wins, so the result stays reproducible"
);
{
  const stats162 = buildIndexWithStats([
    rec162({ typeId: "A", modelNumbers: ["SHARED", "OWN-A"] }),
    rec162({ typeId: "B", modelNumbers: ["SHARED", "OWN-B"] }),
    rec162({ typeId: "C", modelNumbers: ["SHARED"] }),
  ]);
  ok(stats162.collisions === 1, "#162 the collision count counts contested identifiers once, not once per extra claimant");
  ok(stats162.index.size === 3, "#162 every identifier still resolves to exactly one record");
}
ok(buildIndexWithStats([rec162({ typeId: "A" })]).collisions === 0, "#162 an uncontested extract reports zero collisions");

/* ====== #162 load ====== */
{
  const dir162 = mkdtempSync(join(tmpdir(), "davinci-load-test-"));
  const fileA162 = join(dir162, "a.json");
  const fileB162 = join(dir162, "b.json");
  try {
    const extractA162: DavinciExtract = { libraryTimestamp: "2020-01-01T00:00:00.000Z", generatedAt: 1, records: [] };
    const extractB162: DavinciExtract = { libraryTimestamp: "2021-02-02T00:00:00.000Z", generatedAt: 2, records: [] };
    writeFileSync(fileA162, JSON.stringify(extractA162));
    writeFileSync(fileB162, JSON.stringify(extractB162));

    const loadedA162 = loadExtract(fileA162);
    const loadedB162 = loadExtract(fileB162);
    ok(
      loadedA162.libraryTimestamp !== loadedB162.libraryTimestamp,
      "#162 loadExtract keys its cache by file path — a second distinct file is not served the first file's contents"
    );

    const loadedAAgain162 = loadExtract(fileA162);
    ok(loadedAAgain162 === loadedA162, "#162 loadExtract still memoizes — the same path returns the identical object");

    ok(Object.isFrozen(loadedA162.records), "#162 the cached extract's records array is frozen");
  } finally {
    rmSync(dir162, { recursive: true, force: true });
  }
}

/* ====== #162 the hosted-write gate ====== */
// The gate the spec promises and nothing tested: preview and production share
// one Neon database, so `--commit` alone must never be enough against a hosted
// target. requireHostedConfirmation ends in process.exit(1), which would kill
// this suite, so exit and the console are stubbed and restored in a finally.
{
  const realExit = process.exit;
  const realError = console.error;
  const realLog = console.log;
  let exitedWith: number | null = null;
  let errorText = "";
  try {
    process.exit = ((code?: number) => { exitedWith = code ?? 0; }) as unknown as typeof process.exit;
    console.error = (...a: unknown[]) => { errorText += a.join(" "); };
    console.log = () => {};

    requireHostedConfirmation(true, ["--commit"]);
    const refusedExit = exitedWith;
    const refusedText = errorText;

    exitedWith = null;
    errorText = "";
    requireHostedConfirmation(true, ["--commit", "--yes"]);
    const allowedExit = exitedWith;

    exitedWith = null;
    requireHostedConfirmation(false, ["--commit"]);
    const localExit = exitedWith;

    process.exit = realExit;
    console.error = realError;
    console.log = realLog;

    ok(refusedExit === 1, "#162 a hosted write without --yes exits non-zero instead of writing");
    ok(/--yes/.test(refusedText) && /HOSTED/.test(refusedText), "#162 the refusal says it is the hosted database and names --yes");
    ok(allowedExit === null, "#162 --yes permits the hosted write");
    ok(localExit === null, "#162 a local PGlite target never needs --yes");
  } finally {
    process.exit = realExit;
    console.error = realError;
    console.log = realLog;
  }
}

/* ====== #162 the writer (scratch datadir only) ====== */
// Needs `await`, and this file's promise chain (see `seeded()...then(...)`
// above) is the only place a top-level await is legal — a stray one at
// module scope breaks the tsx/esbuild cjs build (see the #145 comment near
// "no per-block async runner" earlier in this file).
async function davinciWriterAsyncChecks(): Promise<void> {
  const SKU_A = "TEST162:CSPAR";       // will match DaVinci's CSPAR
  // Brief used "TEST162:HAS-PORTS", but this suite runs against the real
  // committed extract (data/davinci-extract.json), which has no such model
  // number — matchSku would return null and no plan would ever be created,
  // making the has-ports skip path indistinguishable from SKU_C's no-match
  // path. Swapped in a model number that's actually in the committed extract
  // (a real ETC dimmer type, 3 ports/5 docs) so the fixture truly matches and
  // the pre-set hand-made ports genuinely exercise the skip branch.
  const SKU_B = "TEST162:USDOCSMDIM5";
  const SKU_C = "TEST162:NO-MATCH-AT-ALL-XYZ";
  // Review finding 1 (BLOCKER): the manufacturer is now a gate, not just a
  // filter — a DaVinci record may only be written onto the Peak manufacturer
  // its own brand maps to. These fixtures therefore have to be ETC rows (the
  // `TEST162:` prefix is stripped by normalizeSku, so the SKUs still match),
  // and every plan call below is scoped by onlySkus so a seeded ETC row can
  // never widen the fixture set out from under the stats assertions.
  const ONLY = [SKU_A, SKU_B, SKU_C];
  await upsertPart({ id: SKU_A, sku: SKU_A, desc: "t", category: "Fixtures", unit: "ea", list: 1040, cost: 624, mfr: "ETC" });
  await upsertPart({ id: SKU_B, sku: SKU_B, desc: "t", category: "Fixtures", unit: "ea", list: 10, cost: 6, mfr: "ETC",
    ports: [{ name: "hand-made", direction: "in", connectionType: "Edison" }] });
  await upsertPart({ id: SKU_C, sku: SKU_C, desc: "t", category: "Fixtures", unit: "ea", list: 5, cost: 3, mfr: "ETC" });
  // The cross-manufacturer hazard itself: `450` normalizes to ETC's Source Four
  // 50 Degree, and production holds 19,326 Draper/Crestron/Legrand AV rows
  // whose part numbers look exactly like that.
  const SKU_D = "DRAPER162:450";
  await upsertPart({ id: SKU_D, sku: SKU_D, desc: "projection screen", category: "Fixtures", unit: "ea", list: 9, cost: 4, mfr: "Draper" });

  try {
    // Review finding 1: an explicitly-passed empty onlySkus must scope to
    // ZERO rows — it is not the same as "no scope" (that's `undefined`).
    // Collapsing the two is the D202 bug class: a writer that quietly widens
    // its own scope. This must not touch any of the three fixtures below.
    const scopedToNothing = await planEnrichment({ mfr: "ETC", onlySkus: [] });
    ok(
      scopedToNothing.plans.length === 0 && scopedToNothing.stats.scanned === 0,
      "#162 onlySkus: [] matches nothing, not everything"
    );

    // Review finding 1 (BLOCKER), part one: there is no unscoped mode. matchSku
    // keys on the normalized SKU alone, so a run with no manufacturer would put
    // ETC ports and ETC datasheet links on every brand whose part numbers
    // collide — and the unscoped command was the one the CLI usage block and
    // the rollout both documented.
    let unscoped162 = "";
    try {
      await planEnrichment({ mfr: "" });
    } catch (e) { unscoped162 = String((e as Error).message); }
    ok(unscoped162.includes("requires a manufacturer"), "#162 planEnrichment refuses to run without a manufacturer");
    let blankMfr162 = "";
    try { await planEnrichment({ mfr: "   " }); } catch (e) { blankMfr162 = String((e as Error).message); }
    ok(blankMfr162.includes("requires a manufacturer"), "#162 a whitespace-only manufacturer is refused too, not treated as a scope");

    // Part two: scoping the scan is necessary but not sufficient — scoping to
    // Draper still finds ETC's record behind Draper's part number `450`. The
    // record's own manufacturer has to be checked against the row's.
    const draper162 = await planEnrichment({ mfr: "Draper", onlySkus: [SKU_D] });
    ok(draper162.stats.scanned === 1, "#162 the Draper fixture is in scope for a Draper run");
    ok(
      matchSku(SKU_D, buildIndex(loadExtract().records))?.manufacturer === "ETC",
      "#162 Draper's `450` really does hit an ETC record — the hazard is not hypothetical"
    );
    ok(draper162.plans.length === 0, "#162 an ETC record is never planned onto a Draper row");
    ok(draper162.stats.matched === 0 && draper162.stats.rejectedWrongMfr === 1, "#162 the cross-manufacturer match is counted as rejected, not matched");
    // mfrKey(), not `===`: the rest of the codebase compares manufacturer names
    // case- and punctuation-insensitively, and this was the only raw `===`.
    ok(
      (await planEnrichment({ mfr: "etc.", onlySkus: [SKU_A] })).stats.writable === 1,
      "#162 manufacturers are compared with mfrKey — 'etc.' and 'ETC' are one brand"
    );

    const planned = await planEnrichment({ mfr: "ETC", onlySkus: ONLY });
    const bySku = (s: string) => planned.plans.find((p) => p.sku === s);
    ok(bySku(SKU_B)?.skip === "has-ports", "#162 a part with hand-edited ports is skipped, not overwritten");
    ok(!bySku(SKU_C), "#162 a part with no DaVinci entry produces no plan at all");
    ok((bySku(SKU_A)?.ports.length ?? 0) > 0, "#162 a matching part is planned with ports");

    // Review finding 4: pin the report's stats for this exact fixture set —
    // A and B match (C doesn't), B is the one hand-edited part so it's the
    // only skip, and A is the only writable row. Values are derived from the
    // fixtures above, not asserted as magic numbers.
    ok(planned.stats.scanned === 3, "#162 stats: scanned counts all three TEST162 fixtures");
    ok(planned.stats.matched === 2, "#162 stats: A and B match a DaVinci record, C does not");
    ok(planned.stats.writable === 1, "#162 stats: only A is writable — B is skipped, C never matched");
    ok(planned.stats.skippedHasPorts === 1, "#162 stats: B is the one part skipped for having hand-made ports");
    // Review finding 5: skippedNothingToWrite closes the gap between matched
    // and writable + skippedHasPorts, so the report never has an unexplained
    // shortfall. Neither fixture here hits that branch (extract.ts already
    // drops DaVinci types with neither ports nor docs), so it's 0 — and the
    // identity below proves matched is fully accounted for either way.
    ok(planned.stats.skippedNothingToWrite === 0, "#162 stats: no fixture matches a DaVinci entry with neither ports nor docs");
    ok(
      planned.stats.matched === planned.stats.writable + planned.stats.skippedHasPorts + planned.stats.skippedNothingToWrite,
      "#162 stats: matched is fully accounted for by writable + both skip reasons"
    );
    ok(
      planned.stats.unmatched.length === 1 && planned.stats.unmatched.includes(SKU_C),
      "#162 stats: unmatched names exactly the no-match SKU"
    );
    // Review finding 6: the report has to name the library export every written
    // row will be attributed to — applyEnrichment stamps exactly this string
    // into each row's `davinci` provenance.
    ok(
      planned.stats.libraryTimestamp === loadExtract().libraryTimestamp && !!planned.stats.libraryTimestamp,
      "#162 stats: the report carries the library timestamp the rows will be stamped with"
    );
    ok(planned.stats.libraryRecords === loadExtract().records.length, "#162 stats: the report carries the extract's record count");
    ok(planned.stats.rejectedWrongMfr === 0, "#162 stats: an in-brand run rejects nothing");
    ok(planned.stats.forcedOverHumanEdits === 0, "#162 stats: without --force nothing is written over a human's ports");

    // Dry run writes nothing.
    await applyEnrichment(planned.plans, { commit: false });
    ok(!(await getPart(SKU_A))?.ports?.length, "#162 a dry run writes nothing at all");

    const before = await getPart(SKU_A);
    const res = await applyEnrichment(planned.plans, { commit: true });
    const after = await getPart(SKU_A);
    ok(res.written === 1, "#162 exactly the planned rows are written");
    ok(res.missing === 0, "#162 nothing is missing when every planned row still exists");
    ok((after?.ports?.length ?? 0) > 0, "#162 a commit writes the ports");
    ok(after?.davinci?.typeId != null, "#162 a commit stamps provenance");
    ok(after?.list === before?.list && after?.cost === before?.cost, "#162 list and cost are byte-identical after a commit");
    ok(after?.pricedAt === before?.pricedAt, "#162 pricedAt is never moved by enrichment");

    // Review finding 2: applyEnrichment must never CREATE a row. A plan whose
    // SKU has no existing catalog row (its row was deleted between planning
    // and applying) is skipped and counted as missing, not upserted into
    // existence — reusing a real, fully-formed plan so only the SKU is stale.
    const ghostSku = "TEST162:GHOST-DELETED-BETWEEN-PLAN-AND-APPLY";
    const ghostPlan = { ...bySku(SKU_A)!, sku: ghostSku };
    const ghostRes = await applyEnrichment([ghostPlan], { commit: true });
    ok(
      ghostRes.written === 0 && ghostRes.missing === 1,
      "#162 a plan for a row that no longer exists is counted as missing, not written"
    );
    ok((await getPart(ghostSku)) === null, "#162 applying a plan for a deleted row never creates it");

    // The hand-made ports on B survived.
    ok((await getPart(SKU_B))?.ports?.[0]?.connectionType === "Edison", "#162 the hand-edited part is untouched by a commit");

    // Review finding 4: the `davinci` stamp is written AND read. After the
    // commit above A has ports, so a skip that tests `p.ports?.length` alone
    // would call A a human edit for ever — which is what made a later library
    // revision reachable only with --force, the flag that also destroys real
    // hand edits. A's ports came from the enricher, so it is not has-ports.
    const replanned = await planEnrichment({ mfr: "ETC", onlySkus: ONLY });
    const replannedA = replanned.plans.find((p) => p.sku === SKU_A);
    ok(replannedA?.skip !== "has-ports", "#162 the enricher recognises its own prior write — its own ports are not a human edit");
    // …and a second run against the SAME library is a genuine no-op rather
    // than a fresh enrichedAt on every row (the spec claims idempotence).
    ok(replannedA?.skip === "nothing-to-write", "#162 re-running against the same library plans no write for an already-enriched row");
    ok(replanned.stats.writable === 0 && replanned.stats.skippedNothingToWrite === 1, "#162 an idempotent re-run has nothing writable");
    const stampBefore = (await getPart(SKU_A))?.davinci?.enrichedAt;
    await applyEnrichment(replanned.plans, { commit: true });
    ok((await getPart(SKU_A))?.davinci?.enrichedAt === stampBefore, "#162 a no-op re-run does not restamp enrichedAt");

    // A NEW library export must still land, with no --force anywhere.
    const staleA = await getPart(SKU_A);
    await upsertPart({ ...staleA!, davinci: { ...staleA!.davinci!, libraryTimestamp: "1999-01-01T00:00:00.000Z" } });
    const revised = await planEnrichment({ mfr: "ETC", onlySkus: ONLY });
    ok(
      revised.plans.find((p) => p.sku === SKU_A)?.skip === undefined,
      "#162 a row stamped from an older library export is writable again without --force"
    );
    await applyEnrichment(revised.plans, { commit: true });
    ok(
      (await getPart(SKU_A))?.davinci?.libraryTimestamp === loadExtract().libraryTimestamp,
      "#162 the revision write re-stamps the row with the current library export"
    );

    // Review finding 3: force lets a hand-edited part be overwritten too.
    // With force: true, B is no longer skipped as has-ports, and a commit
    // then does overwrite its hand-made Edison port with DaVinci's own ports.
    const forced = await planEnrichment({ mfr: "ETC", onlySkus: ONLY, force: true });
    const forcedBySku = (s: string) => forced.plans.find((p) => p.sku === s);
    ok(forcedBySku(SKU_B)?.skip !== "has-ports", "#162 force: the hand-edited part is no longer marked has-ports");
    // Review finding 5: under --force the has-ports branch never runs, so
    // skippedHasPorts reads 0 and the hand-edited rows about to be destroyed
    // used to be folded silently into `writable`. The operator authorizing the
    // write needs that count named.
    ok(forced.stats.skippedHasPorts === 0, "#162 force: nothing is reported as skipped-for-ports, because nothing is");
    ok(forced.stats.forcedOverHumanEdits === 1, "#162 force: the one hand-edited row about to be overwritten is counted, not hidden in `writable`");
    ok(
      forced.stats.forcedOverHumanEdits <= forced.stats.writable,
      "#162 force: the forced-over count is a subset of the rows that will be written"
    );
    const bForcedPlanPorts = forcedBySku(SKU_B)?.ports ?? [];
    ok(bForcedPlanPorts.length > 0, "#162 force: the hand-edited part is planned with real DaVinci ports");
    const forcedRes = await applyEnrichment(forced.plans, { commit: true });
    ok(
      forcedRes.written === forced.stats.writable && forcedRes.missing === 0,
      "#162 force: the commit writes exactly the now-writable rows"
    );
    const bAfterForce = await getPart(SKU_B);
    ok(
      bAfterForce?.ports?.[0]?.connectionType !== "Edison",
      "#162 force: a commit overwrites the hand-made port with DaVinci's"
    );
    ok(
      bAfterForce?.ports?.length === bForcedPlanPorts.length,
      "#162 force: the written ports match exactly what was planned"
    );

    // Scope: applyEnrichment writes ONLY what it was handed (D202's lesson).
    const empty = await applyEnrichment([], { commit: true });
    ok(empty.written === 0 && empty.missing === 0, "#162 an empty plan list writes nothing — apply never queries for more rows");
  } finally {
    for (const s of [SKU_A, SKU_B, SKU_C, SKU_D]) await softDeleteDoc("catalog_parts", s);
  }
}
