import { dataUrlToBytes, getBlobStream, putBlob, safeName, blobEnabled } from "@/lib/blob";
import { assemble, matchBom, type AssembledSpec, type RackSpecSection, type SpecCatalogPart } from "@/lib/bid-spec";
import { buildSpecDocx } from "@/lib/bid-spec-docx";
import { buildClientPackageManifest, coveredNote, packageNeedsFixtures, type ClientPackageGap } from "@/lib/client-package";
import { placementQty } from "@/lib/design/grid-bom";
import { listFixtures } from "@/lib/stores/fixtures";
import { renderLetterPdf, type FieldSheetDoc, type LetterDoc } from "@/lib/pdf";
import { riserGraph } from "@/lib/design/grid-riser";
import { list as listCatalog } from "@/lib/stores/catalog";
import { gridProjectForQuote, listSheets, type GridProject } from "@/lib/stores/grid-projects";
import { allSections } from "@/lib/stores/spec-sections";
import { saveClientPackage, type ClientPackageRecord } from "@/lib/stores/client-packages";
import type { Quote } from "@/lib/stores/quotes";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { createStoredZip, type ZipFile } from "@/lib/zip";
import type { CoverageIndex } from "@/lib/part-docs/coverage";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { datasheetEntryName, packageEntryName, resolvePackageDocs, type PackageDocument } from "@/lib/part-docs/package";
import { BOOK_FILE_NAME, BOOK_REASON, bookByteBudget, bookDate, bookPartOf, planDatasheetBook, type BookPart, type BookPlan } from "@/lib/part-docs/datasheet-book";
import { BOOK_SKIPPED_REASON, buildDatasheetBook, type BookDoc } from "@/lib/part-docs/datasheet-book-server";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import { addCutSheets, CUT_SHEET_DEADLINE_MS, cutSheetDeadline, NO_PRINT_ORIGIN, type CutSheetsAdded, type PrintWhere } from "@/lib/curtain-cut-sheets/package-sheets";
import { GRID_SET_STEP_MS } from "@/lib/design/grid-set-print";
import { renderGridSetPdf, type GridSetRenderCause, type GridSetRenderFn } from "@/lib/design/grid-set-render";
import { MAX_PACKAGE_FILE_BYTES } from "@/lib/estimate-output/package-files";
import { renderPrintRouteToPdf } from "@/lib/quote-pdf/render";
import { ensureOptions, optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import type { FixtureRecord, FixtureResolvable } from "@/lib/fixture-assemblies";
import { gridSpecBomRows, internalSkuCheck } from "@/lib/design/grid-virtual-parts";
import { emptyRackLayout } from "@/lib/rack/layout";
import { loadRackForSheets } from "@/lib/rack/load";
import { rackPackageEntries, type RackIndexEntry, type RackRun } from "@/lib/rack/package";
import { rackElevationPng } from "@/lib/rack/raster";
import { racksInGrid, racksInQuote, scheduleCsv } from "@/lib/rack/submittal";
import { RACK_MIN_RENDER_MS, rackSubmittalFiles } from "@/lib/rack/submittal-server";
import type { Letterhead } from "@/lib/letterhead";
import { loadDocumentLetterhead } from "@/lib/letterhead-server";

export type BuiltClientPackage = {
  record: ClientPackageRecord;
  gaps: ClientPackageGap[];
  spec: AssembledSpec;
  /** #292 — staff-only: includes the unreadable curtains the zip's index leaves out. */
  cutSheets: CutSheetsAdded;
  /** Grid notes #7 — whether the title-blocked drawing set is in the zip; null = a quote with no Grid design. */
  drawingSet: PackageDrawingSet | null;
};

async function bytesFromStream(stream: ReadableStream): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

/**
 * The package builders' outside world, injectable for the spec harness
 * (production uses the real Blob store, record store, Chrome and secret).
 */
export type ClientPackageDeps = {
  blobOn: () => boolean;
  put: (pathname: string, bytes: Buffer, contentType: string) => Promise<{ pathname: string }>;
  save: (input: Omit<ClientPackageRecord, "id" | "createdAt">) => Promise<ClientPackageRecord>;
  /** Grid notes #7 — the drawing set's renderer (renderPrintRouteToPdf). */
  renderGridSet: GridSetRenderFn;
  secret: () => string;
  /** The Grid design a quote came from (quote packages only). */
  findGrid: (quoteId: string) => Promise<{ project: GridProject; optionId: string } | null>;
  /** #329 — a package document's bytes (Blob in production). */
  readDoc: (blobKey: string) => Promise<ReadableStream | null>;
};

const livePackageDeps: ClientPackageDeps = {
  blobOn: blobEnabled,
  put: putBlob,
  save: saveClientPackage,
  renderGridSet: renderPrintRouteToPdf,
  secret: () => process.env.AUTH_SECRET || "",
  findGrid: gridProjectForQuote,
  readDoc: (blobKey) => getBlobStream(blobKey),
};

/** Production deps with the caller's overrides — an override left `undefined` never blanks a live dep. */
function packageDeps(overrides: Partial<ClientPackageDeps> | undefined): ClientPackageDeps {
  const defined = Object.fromEntries(Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined)) as Partial<ClientPackageDeps>;
  return { ...livePackageDeps, ...defined };
}

/** Grid notes #7 — where the title-blocked drawing set lands in the zip. */
export const PACKAGE_DRAWING_SET_FILE = "drawings/drawing-set.pdf";
/** The drawing set needs at least this much of its render budget left to be started. */
export const PACKAGE_DRAWING_SET_MIN_RENDER_MS = 10_000;
/**
 * The drawing set's share of the package's 75 s render budget (CUT_SHEET_DEADLINE_MS).
 * It renders FIRST and may use up to 50 s from the start of the build; the
 * cut sheets and racks that follow always keep the last 25 s (the drawing set
 * can never spend them). Production only — see packageDrawingSetBudget.
 */
export const PACKAGE_DRAWING_SET_SHARE_MS = 50_000;
/** `next dev` compiles /print on first hit: Generate from Grid's dev budget (renderPrintRouteToPdf's 90 s steps, 360 s overall). */
export const PACKAGE_DRAWING_SET_DEV_MS = 360_000;

/**
 * The drawing set's deadline and Chrome step cap for a package whose overall
 * render deadline is `packageDeadline` (cutSheetDeadline). Production: at most
 * PACKAGE_DRAWING_SET_SHARE_MS from the build start, never past the package
 * deadline, 25 s steps (clamped to the time left at render). Dev mirrors
 * generateGridDrawingSet: the renderer's own step default and a 360 s
 * deadline (no maxDuration under `next dev`; the cut sheets then run late).
 */
export function packageDrawingSetBudget(packageDeadline: number, dev: boolean): { deadline: number; stepMs: number | undefined } {
  const startedAt = packageDeadline - CUT_SHEET_DEADLINE_MS;
  if (dev) return { deadline: startedAt + PACKAGE_DRAWING_SET_DEV_MS, stepMs: undefined };
  return { deadline: Math.min(packageDeadline, startedAt + PACKAGE_DRAWING_SET_SHARE_MS), stepMs: GRID_SET_STEP_MS };
}

/** What the zip's index says about the drawing set. `source`: it renders the LIVE Grid option, not a frozen revision. */
export type PackageDrawingSet = { included: true; file: string; source: "live design" } | { included: false; reason: string; source: "live design" };

/** Customer-safe words for why the set is missing (the zip's index is customer-facing; the raw cause goes to the server log only). */
const DRAWING_SET_REASON: Record<GridSetRenderCause | "no-origin" | "too-big", string> = {
  "no-origin": "the drawing set couldn’t be printed just now",
  "no-secret": "the drawing set couldn’t be printed just now",
  unavailable: "the drawing set couldn’t be printed just now",
  figure: "one of the plan sheets couldn’t be drawn",
  late: "it didn’t finish in time",
  failed: "the drawing renderer failed",
  "too-big": "it is over 25 MB",
};

/** The gap a package records when its drawing set isn't in the zip. */
export function drawingSetGap(reason: string, instead: string): ClientPackageGap {
  return { kind: "missing-drawing-set", sku: "DWG", description: `Drawing set couldn’t be rendered — ${reason}; ${instead} included instead.`, qty: 0, catalogId: null };
}

/** The drawing set's deadline passed: aborts the render and ends our wait on it (one owner, so late vs failed is deterministic). */
export class DrawingSetDeadlineError extends Error {
  constructor() {
    super("The drawing set's render deadline passed.");
    this.name = "DrawingSetDeadlineError";
  }
}

/**
 * Grid notes #7 — render the design option's drawing set (cover, plans with
 * devices, riser, schedules — the same PDF as Generate from Grid, through
 * renderGridSetPdf) for a client package, by `budget.deadline`
 * (packageDrawingSetBudget). Not started with less than
 * PACKAGE_DRAWING_SET_MIN_RENDER_MS left. ONE timer, set from the injected
 * clock, owns the deadline: when it fires it aborts the render's signal
 * (a queued render never launches Chrome, a running one closes its browser)
 * and then ends our wait — so a render cut there is always "late", and one
 * that fails on its own before it is "failed". Chrome's step cap is the
 * budget's step, clamped to the time left. Never throws.
 */
export async function renderPackageDrawingSet(
  project: Pick<GridProject, "id">,
  optionId: string,
  where: PrintWhere,
  budget: { deadline: number; stepMs: number | undefined },
  deps: Pick<ClientPackageDeps, "renderGridSet" | "secret">,
  now: () => number = Date.now,
): Promise<{ ok: true; pdf: Buffer } | { ok: false; reason: string }> {
  const fail = (cause: keyof typeof DRAWING_SET_REASON, detail: string) => {
    console.warn(`[package] drawing set ${project.id}~${optionId} not included (${cause}): ${detail}`);
    return { ok: false as const, reason: DRAWING_SET_REASON[cause] };
  };
  if ("error" in where) return fail("no-origin", where.error);
  const left = budget.deadline - now();
  if (left < PACKAGE_DRAWING_SET_MIN_RENDER_MS) return fail("late", `${Math.max(0, left)} ms of render budget left`);
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const e = new DrawingSetDeadlineError();
      abort.abort(e); // first: the signal is aborted before anyone sees the rejection
      reject(e);
    }, Math.max(0, budget.deadline - now()));
  });
  cut.catch(() => undefined);
  try {
    const r = await renderGridSetPdf({
      projectId: project.id,
      optionId,
      origin: where.origin,
      secret: deps.secret(),
      now,
      render: (url, o) => Promise.race([deps.renderGridSet(url, o), cut]),
      timeoutMs: budget.stepMs === undefined ? undefined : Math.max(1, Math.min(budget.stepMs, budget.deadline - now())),
      signal: abort.signal,
    });
    if (!r.ok) return fail(r.cause, r.error);
    if (r.pdf.length > MAX_PACKAGE_FILE_BYTES) return fail("too-big", `${r.pdf.length} bytes`);
    return { ok: true, pdf: r.pdf };
  } finally {
    clearTimeout(timer);
    // Anything still queued or running for this set is abandoned now, never left holding the Chrome queue.
    if (!abort.signal.aborted) abort.abort(new Error("The client package moved on."));
  }
}

/** The Grid design a quote was minted from, or null — a lookup that throws is logged and treated as "no Grid design". */
async function safeFindGrid(find: ClientPackageDeps["findGrid"], quoteId: string): Promise<{ project: GridProject; optionId: string } | null> {
  try {
    return await find(quoteId);
  } catch (e) {
    console.warn(`[package] quote ${quoteId}: Grid design lookup failed — packaging without a drawing set`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** A design's raw plan backgrounds — read only for the fallback, when the drawing set wasn't rendered. */
async function planBackgroundFiles(projectId: string): Promise<ZipFile[]> {
  const out: ZipFile[] = [];
  for (const [index, sheet] of (await listSheets(projectId)).entries()) {
    let bytes: Buffer | null = null;
    if (sheet.dataUrl) {
      try { bytes = dataUrlToBytes(sheet.dataUrl).bytes; } catch { bytes = null; }
    } else if (sheet.blobPath) {
      const stream = await getBlobStream(sheet.blobPath);
      if (stream) bytes = await bytesFromStream(stream);
    }
    if (bytes) out.push({ name: `drawings/plan-${String(index + 1).padStart(2, "0")}-${safeName(sheet.name)}`, data: bytes });
  }
  return out;
}

/** Grid notes #9 — a plain-name PDF's letterhead: the Peak letterhead when
 *  given, else the company name in type (as before #9). */
function letterheadFields(letterhead: Letterhead | null | undefined): Pick<LetterDoc, "companyName" | "headerJpeg" | "headerFull"> {
  if (!letterhead) return { companyName: "Peak Systems Group" };
  return { companyName: letterhead.companyName, headerJpeg: letterhead.image?.jpeg ?? null, headerFull: letterhead.image?.full ?? false };
}

export function roughDrawings(project: GridProject, catalog: SpecCatalogPart[], packageName: string, letterhead: Letterhead | null = null): Buffer {
  const parts = catalog.map((part) => ({
    id: part.id,
    sku: part.sku,
    desc: part.desc,
    category: part.category,
    unit: part.unit,
    list: part.list,
    cost: part.cost,
  }));
  const graph = riserGraph(
    project.placements || [],
    project.routes || [],
    project.spaces || [],
    parts,
    project.calibrations || [],
  );
  const pages: FieldSheetDoc["pages"] = [
    {
      title: `${project.name} — plan and riser package`,
      sections: [
        {
          heading: "Plan sheets",
          rows: (project.sheetIds || []).map((id) => ({ label: "Sheet", value: id })),
        },
        {
          heading: "Derived plan summary",
          rows: [
            // Units, not markers: an Auto lot marker stands for `qty` units (#211).
            { label: "Placed devices", value: String((project.placements || []).filter((p) => !p.curtain).reduce((n, p) => n + placementQty(p), 0)) },
            { label: "Curtain drops", value: String((project.placements || []).filter((p) => !!p.curtain).length) },
            { label: "Spaces", value: String((project.spaces || []).length) },
            { label: "Wire runs", value: String((project.routes || []).length) },
          ],
        },
      ],
    },
    {
      title: `${project.name} — control riser`,
      sections: [
        {
          heading: "Riser nodes",
          rows: graph.nodes.map((node) => ({
            label: node.name,
            value: node.groups.map((group) => `${group.qty} × ${group.desc}`).join("; ") || "Wire endpoint",
          })),
        },
        {
          heading: "Riser connections",
          rows: graph.edges.map((edge) => ({
            label: `${edge.fromName} → ${edge.toName}`,
            value: `${edge.partId} · ${edge.lengthFt == null ? "unmeasured" : `${edge.lengthFt.toFixed(1)} ${edge.unit}`}`,
          })),
        },
      ],
    },
  ];
  const doc: LetterDoc = {
    ...letterheadFields(letterhead),
    accent: "#b08d4a",
    tag: "Rough design drawings",
    meta: [{ label: "Package", value: packageName }, { label: "Project", value: project.id }],
    re: project.name,
    greeting: "",
    blocks: [],
    costLine: "",
    costTail: "",
    taxNote: "",
    signer: { name: "Peak Systems Group", title: "Design package" },
    fieldSheet: { job: project.id, date: new Date().toLocaleDateString("en-US"), footer: "Rough design reference — not stamped drawings.", pages },
  };
  return renderLetterPdf(doc);
}

export function roughQuoteDrawing(quote: Quote, packageName: string, letterhead: Letterhead | null = null): Buffer {
  const doc: LetterDoc = {
    ...letterheadFields(letterhead),
    accent: "#b08d4a",
    tag: "Quote package",
    meta: [{ label: "Package", value: packageName }, { label: "Quote", value: displayQuoteNumber(quote) }],
    re: quote.name,
    greeting: "",
    blocks: [],
    costLine: "",
    costTail: "",
    taxNote: "",
    signer: { name: "Peak Systems Group", title: "Client package" },
    fieldSheet: {
      job: displayQuoteNumber(quote),
      date: new Date().toLocaleDateString("en-US"),
      footer: "Quote equipment reference — verify against approved drawings.",
      pages: [{
        title: `${quote.name} — equipment summary`,
        sections: [{
          heading: "Quote scope",
          rows: [{ label: "Customer", value: quote.customer || "—" }, { label: "Value", value: `$${Math.round(quote.value || 0).toLocaleString("en-US")}` }],
        }],
      }],
    },
  };
  return renderLetterPdf(doc);
}

/**
 * The quote's equipment rows, summed by SKU. #296 (D578): a line built from a
 * rack (`rackId`) expands into the rack's members, read live through `rackOf`,
 * so the package's datasheets/ and spec cover them like a Grid rack; a rack
 * that no longer resolves (or has no members) keeps its one quoted row.
 */
export function quoteBom(
  quote: Pick<Quote, "spec">,
  rackOf?: (id: string) => FixtureResolvable | null | undefined,
  /** #296: rack members this flags (internal catalog rows — labor) stay out of the BOM. */
  isInternal?: (sku: string) => boolean,
): Array<{ sku: string; desc: string; qty: number }> {
  const spec = quote.spec as { sections?: Array<{ kind?: string; items?: Array<{ sku?: string; desc?: string; qty?: number; labor?: boolean; rackId?: unknown }> }> } | null | undefined;
  const rows = new Map<string, { sku: string; desc: string; qty: number }>();
  for (const section of spec?.sections || []) {
    for (const item of section.items || []) {
      // A "labor" kind section is already skipped; a non-labor section can
      // still carry individual labor lines (mobilizations, shop &
      // engineering, allowance, performance bonus) — they're not equipment
      // and don't belong in the BOM/client package either.
      if (section.kind === "labor" || item.labor || isRewardCreditItem(item) || item.qty == null || item.qty <= 0) continue;
      const rack = rackOf && typeof item.rackId === "string" ? rackOf(item.rackId) : null;
      if (rack?.kind === "rack") {
        const members = gridSpecBomRows([{ sku: `asm:${item.rackId}`, desc: String(item.desc || ""), qty: item.qty }], rackOf!, isInternal);
        // A rack with no members comes back as one SKU-less row; [] means every member was labor (nothing to list).
        if (members.every((m) => m.sku)) {
          for (const m of members) {
            const current = rows.get(m.sku);
            if (current) current.qty += m.qty;
            else rows.set(m.sku, { sku: m.sku, desc: m.desc, qty: m.qty });
          }
          continue;
        }
      }
      const sku = String(item.sku || item.desc || "Unspecified line");
      const current = rows.get(sku);
      if (current) current.qty += item.qty;
      else rows.set(sku, { sku, desc: String(item.desc || sku), qty: item.qty });
    }
  }
  return [...rows.values()];
}

/** A raster needs at least this much render budget left to be started. */
const RACK_MIN_RASTER_MS = 1_000;

type RacksAdded = { index: RackIndexEntry[]; spec: RackSpecSection[] };

/**
 * #296 — each rack's sheets + schedule CSV under `racks/<folder>/` (no
 * datasheets.pdf: the package's own datasheets/ already covers the members)
 * and its D94 section. Runs AFTER the cut sheets on the same render deadline
 * (so the package's finish allowance stays whole): a rack with less than
 * RACK_MIN_RENDER_MS left is not started and becomes a "missing-rack" gap, as
 * does a rack id that no longer resolves. Racks are read live (D578).
 */
async function addRacks(
  found: string[],
  missing: string[],
  nameOf: (id: string) => string,
  where: PrintWhere,
  files: ZipFile[],
  gaps: ClientPackageGap[],
  deadline: number,
): Promise<RacksAdded> {
  if (!found.length && !missing.length) return { index: [], spec: [] };
  const runs: RackRun[] = [];
  const sections = new Map<string, Omit<RackSpecSection, "folder" | "elevationPdfMissing">>();
  for (const [i, id] of found.entries()) {
    const loaded = await loadRackForSheets(id);
    if (!loaded) {
      runs.push({ id, name: nameOf(id), outcome: "missing" });
      continue;
    }
    const name = loaded.rec.label || nameOf(id);
    if (deadline - Date.now() < RACK_MIN_RENDER_MS) {
      // No Chrome: the sheets stay out (a missing-rack gap), the CSV needs no render.
      const csv = { name: "schedule.csv", data: Buffer.from(scheduleCsv(loaded.submittal), "utf8") };
      runs.push({ id, name, outcome: "late", folder: safeName(loaded.rec.label || loaded.rec.id), files: [csv] });
    } else {
      const res = await rackSubmittalFiles(id, where, { deadline, datasheets: false });
      runs.push(res.ok ? { id, name, outcome: "done", folder: res.folder, files: res.files, staffGaps: res.gaps } : { id, name, outcome: "missing" });
    }
    // The D94 section needs no Chrome; the raster is skipped once the render budget is spent (D577 pointer instead).
    const png = deadline - Date.now() >= RACK_MIN_RASTER_MS ? await rackElevationPng(loaded.rec.rack ?? emptyRackLayout(), loaded.lookup, `rk${i + 1}`) : null;
    sections.set(id, { title: name, ...(loaded.submittal.scope ? { scope: loaded.submittal.scope } : {}), schedule: loaded.submittal.schedule, ...(png ? { elevationPng: png } : {}) });
  }
  for (const id of missing) runs.push({ id, name: nameOf(id), outcome: "missing" });
  const entries = rackPackageEntries(runs);
  for (const w of entries.warnings) console.warn(`[rack] client package ${w}`);
  files.push(...entries.files);
  gaps.push(...entries.gaps);
  const spec: RackSpecSection[] = [];
  for (const id of found) {
    const section = sections.get(id);
    if (!section) continue;
    const folder = entries.folderOf.get(id) ?? "";
    spec.push({ ...section, folder, elevationPdfMissing: !folder || !entries.files.some((f) => f.name === `racks/${folder}/elevation.pdf`) });
  }
  return { index: entries.index, spec };
}

/** A quote's line items, every section. */
function quoteItems(quote: Quote): Array<{ rackId?: unknown; fixtureId?: unknown; desc?: unknown }> {
  const spec = quote.spec as { sections?: Array<{ items?: Array<{ rackId?: unknown; fixtureId?: unknown; desc?: unknown }> }> } | null | undefined;
  return (spec?.sections || []).flatMap((s) => s.items || []);
}

/**
 * Put every package document in the zip ONCE (#207): a fixture datasheet
 * that also covers its lens and clamps is one file. A document whose blob is
 * missing from storage turns into a gap for each SKU it was meant to serve.
 * #329: datasheets go first, in the book's manufacturer A→Z order, named
 * `datasheets/<Manufacturer> - <file>`; their bytes come back for the book
 * (read once, never twice).
 */
async function addDocuments(
  documents: PackageDocument[],
  index: CoverageIndex,
  describe: (sku: string) => { description: string; qty: number; catalogId: string | null },
  files: ZipFile[],
  gaps: ClientPackageGap[],
  plan: BookPlan,
  read: ClientPackageDeps["readDoc"],
): Promise<Map<string, BookDoc>> {
  const used = new Set<string>();
  const book = new Map<string, BookDoc>();
  const rank = new Map(plan.docOrder.map((id, i) => [id, i] as const));
  const ordered = [
    ...documents.filter((d) => d.kind === "datasheet").sort((a, b) => (rank.get(a.documentId) ?? 1e9) - (rank.get(b.documentId) ?? 1e9)),
    ...documents.filter((d) => d.kind !== "datasheet"),
  ];
  for (const doc of ordered) {
    const blobKey = index.docsById.get(doc.documentId)?.blobKey;
    const stream = blobKey ? await read(blobKey) : null;
    if (!stream) {
      if (doc.kind === "datasheet") {
        for (const sku of doc.skus) gaps.push({ kind: "missing-datasheet", sku, ...describe(sku) });
        book.set(doc.documentId, { bytes: null, reason: BOOK_REASON.missing });
      }
      continue;
    }
    const data = await bytesFromStream(stream);
    if (doc.kind === "datasheet") {
      const name = datasheetEntryName(doc, plan.docMfr.get(doc.documentId) ?? "", used);
      files.push({ name, data });
      book.set(doc.documentId, { bytes: data, name });
    } else {
      files.push({ name: packageEntryName(doc, used, safeName), data });
    }
  }
  return book;
}

/** The gap a package records when its combined datasheet book was skipped (#329). */
export function datasheetBookGap(cause: "too-big" | "late" | "failed"): ClientPackageGap {
  return { kind: "missing-datasheet-book", sku: "DS", description: `${BOOK_FILE_NAME} — ${BOOK_SKIPPED_REASON[cause]}; the individual datasheets are in datasheets/.`, qty: 0, catalogId: null };
}

/** #329 review — one datasheet the book couldn't read (corrupt, encrypted, a bad page box): it ships loose but isn't in the book. */
export function unmergeableDatasheetGap(file: string, sku: string, catalogId: string | null): ClientPackageGap {
  return { kind: "missing-datasheet-book", sku, description: `${file} couldn’t be read, so it isn’t in ${BOOK_FILE_NAME}; the file itself is in the package.`, qty: 0, catalogId };
}

type PackageBookResult = Awaited<ReturnType<typeof buildDatasheetBook>> | null;

/**
 * #329 — a client package's datasheet book. It merges ALONGSIDE the renders
 * (pdf-lib yields between documents) on the package's render deadline, so it
 * never eats the finish allowance. Null = no datasheet was read (no book, no gap).
 */
async function packageBook(parts: BookPart[], docs: Map<string, BookDoc>, subtitleLines: string[], deadline: number, tag: string, letterhead: Letterhead | null): Promise<PackageBookResult> {
  // Nothing read (no datasheets, or Blob lost every one — each already a missing-datasheet gap): no book.
  if (![...docs.values()].some((d) => d.bytes)) return null;
  // #329 review: the loose datasheets + the book stay under BOOK_ZIP_CEILING_BYTES (skip = "package size limit").
  const loose = [...docs.values()].reduce((n, d) => n + (d.bytes?.byteLength ?? 0), 0);
  return buildDatasheetBook({ subtitleLines, parts, docs, letterhead, deadline, logTag: tag, maxBytes: bookByteBudget(loose) });
}

/** Put the book at the zip root (plus a gap per datasheet it couldn't read), or the gap that says it was skipped. */
function addBook(book: PackageBookResult, files: ZipFile[], gaps: ClientPackageGap[], docs: Map<string, BookDoc>, catalogIdOf: (sku: string) => string | null): boolean {
  if (!book) return false;
  if (book.ok) {
    files.push({ name: BOOK_FILE_NAME, data: book.bytes });
    for (const id of book.unmergeable) {
      const sku = book.plan.parts.find((p) => p.docId === id && !p.coveredBy?.length)?.sku ?? book.plan.parts.find((p) => p.docId === id)?.sku ?? "";
      gaps.push(unmergeableDatasheetGap(docs.get(id)?.name ?? "A datasheet", sku, catalogIdOf(sku)));
    }
    return true;
  }
  console.warn(`[package] ${BOOK_FILE_NAME} skipped (${book.cause}): ${book.detail}`);
  gaps.push(datasheetBookGap(book.cause));
  return false;
}

/**
 * #301 slice C — one quote BOM's spec, package documents, items and gaps,
 * from a given catalog slice and coverage index. No record, no zip, no
 * Blob. The staff quote package (below) and the estimate package's
 * Specifications.docx (estimate-output/package-zip-server.ts) both use it.
 * #207: the quote's own SKUs are the coverage context — an accessory rides
 * on a fixture only when that fixture is on this quote.
 */
export function quoteSpecParts(input: {
  quote: Pick<Quote, "id" | "name" | "customer">;
  bom: Array<{ sku: string; desc: string; qty: number }>;
  catalog: SpecCatalogPart[];
  docIndex: CoverageIndex;
  sections: Awaited<ReturnType<typeof allSections>>;
  by: string;
  date: number;
}) {
  const { quote, bom, catalog, docIndex } = input;
  const bySku = new Map(catalog.map((part) => [part.sku, part]));
  const matched = matchBom(bom, catalog);
  const spec = assemble(matched.rows, input.sections, {
    projectName: quote.name,
    customer: quote.customer,
    engagementId: `quote:${quote.id}`,
    preparedBy: input.by,
    date: input.date,
  });
  const packageDocs = resolvePackageDocs(docIndex, bom.filter((row) => bySku.has(row.sku)).map((row) => row.sku));
  const items = bom.map((row) => {
    const part = bySku.get(row.sku);
    const docs = packageDocs.bySku.get(row.sku);
    return {
      sku: row.sku,
      description: row.desc,
      qty: row.qty,
      catalogId: part?.id || null,
      datasheet: docs?.datasheet ?? null,
      datasheetCoveredBy: docs?.datasheetCoveredBy ?? [],
      specsheet: docs?.specsheet ?? null,
      manual: docs?.manual ?? null,
    };
  });
  const gaps: ClientPackageGap[] = matched.rows.filter((row) => row.bucket !== "ready").map((row) => ({ kind: row.bucket === "no-match" ? "missing-catalog" : "missing-spec", sku: row.row.sku, description: row.row.desc, qty: row.row.qty, catalogId: row.part?.id || null }));
  for (const item of items) {
    if (item.catalogId && !packageDocs.bySku.get(item.sku)?.datasheetOk) gaps.push({ kind: "missing-datasheet", sku: item.sku, description: item.description, qty: item.qty, catalogId: item.catalogId });
  }
  const covered = items.filter((item) => item.datasheetCoveredBy.length).map((item) => coveredNote(item.sku, item.datasheetCoveredBy));
  return { matched, spec, packageDocs, items, gaps, covered };
}

export async function createClientPackage(
  project: GridProject,
  by: string,
  requestedOptionId?: string | null,
  opts: { printWhere?: PrintWhere; deps?: Partial<ClientPackageDeps>; peakHeader?: boolean | null } = {},
): Promise<BuiltClientPackage> {
  const cutSheetsBy = cutSheetDeadline(Date.now()); // #292 — measured from the start of the build; Grid notes #7: the drawing set shares it
  const d = packageDeps(opts.deps);
  if (!d.blobOn()) throw new Error("Client packages require Blob storage on this deployment.");
  // Grid notes #9 — this build's "Include Peak header" ?? the company default.
  const letterhead = await loadDocumentLetterhead(opts.peakHeader);
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const { index: docIndex } = await loadPartDocsState(catalog);
  const fixtures = packageNeedsFixtures(project.placements || []) ? new Map((await listFixtures()).map((f) => [f.id, f])) : null;
  const manifest = buildClientPackageManifest(project, catalog, requestedOptionId, docIndex, (id) => fixtures?.get(id));
  const matched = matchBom(manifest.bom, catalog);
  const sections = await allSections();
  const spec = assemble(matched.rows, sections, {
    projectName: project.name,
    customer: project.customer,
    engagementId: `grid:${project.id}`,
    preparedBy: by,
    date: Date.now(),
  });
  const packageName = `${safeName(project.name || project.id)}-${project.id}`;
  // The docx is written once the racks are known (#296); it keeps its place in the zip.
  const specFile: ZipFile = { name: "specification.docx", data: Buffer.alloc(0) };
  const files: ZipFile[] = [specFile];
  const gaps = [...manifest.gaps];
  const itemBySku = new Map(manifest.items.map((item) => [item.sku, item]));
  // #329 — the datasheet book: one row per BOM part, manufacturer A→Z.
  const partBySku = new Map(catalog.map((part) => [part.sku, part] as const));
  const noDatasheet = new Set(manifest.gaps.filter((g) => g.kind === "missing-datasheet").map((g) => g.sku));
  const bookParts = manifest.items.map((item) => bookPartOf({ sku: item.sku, desc: item.description }, item.catalogId ? partBySku.get(item.sku) : null, { ...item, datasheetOk: !noDatasheet.has(item.sku) }));
  const bookPlan = planDatasheetBook(bookParts);
  const bookDocs = await addDocuments(manifest.documents, docIndex, (sku) => {
    const item = itemBySku.get(sku);
    return { description: item?.description ?? sku, qty: item?.qty ?? 0, catalogId: item?.catalogId ?? null };
  }, files, gaps, bookPlan, d.readDoc);
  const bookP = packageBook(bookParts, bookDocs, [project.name, project.customer, project.siteName ?? "", bookDate(Date.now())], cutSheetsBy, `[package] grid ${project.id}`, letterhead);
  const optId = resolveOptionId(project, requestedOptionId);
  // Grid notes #7 — the title-blocked drawing set (plans WITH devices, riser, schedules) is the first render on the
  // package's deadline. Rendered: it replaces the rough drawings and the raw plans. Not: they stay, plus one gap.
  const where = opts.printWhere ?? NO_PRINT_ORIGIN;
  // Budget split: the set may use the first 50 s of the 75 s render budget; cut sheets + racks keep the last 25 s.
  const setBudget = packageDrawingSetBudget(cutSheetsBy, process.env.NODE_ENV === "development");
  const set = await renderPackageDrawingSet(project, optId, where, setBudget, d);
  let drawingSet: PackageDrawingSet;
  if (set.ok) {
    files.splice(1, 0, { name: PACKAGE_DRAWING_SET_FILE, data: set.pdf });
    drawingSet = { included: true, file: PACKAGE_DRAWING_SET_FILE, source: "live design" };
  } else {
    files.splice(1, 0, { name: "drawings/rough-drawings.pdf", data: roughDrawings(project, catalog, packageName, letterhead) });
    // Read only now (after the set failed): a slow read never eats the set's budget, a rendered set never pays for them.
    files.push(...(await planBackgroundFiles(project.id)));
    gaps.push(drawingSetGap(set.reason, "the rough drawings and plan backgrounds are"));
    drawingSet = { included: false, reason: set.reason, source: "live design" };
  }
  // #292 — cut sheets for the option's quote; a design with curtains but no quote gets one gap.
  const optQuoteId = ensureOptions(project).options.find((o) => o.id === optId)?.quoteId ?? null;
  let cutSheets: CutSheetsAdded = { sheets: [], unreadable: [] };
  if (optQuoteId) cutSheets = await addCutSheets(optQuoteId, where, files, gaps, { deadline: cutSheetsBy });
  else if (optionSlice(project, optId).placements.some((p) => !!p.curtain))
    gaps.push({ kind: "missing-cutsheet", sku: "CS", description: "Add this design to Quotes to include cut sheets", qty: 0, catalogId: null });
  // #296 — racks placed on this option (`asm:<id>` of kind rack), after the cut sheets on the same deadline.
  const gridRacks = racksInGrid(optionSlice(project, optId).placements.map((p) => p.partId), (id) => fixtures?.get(id));
  const rackRun = await addRacks(gridRacks, [], (id) => fixtures?.get(id)?.label || "Rack", where, files, gaps, cutSheetsBy);
  const datasheetBook = addBook(await bookP, files, gaps, bookDocs, (sku) => itemBySku.get(sku)?.catalogId ?? null);
  const specWithRacks: AssembledSpec = rackRun.spec.length ? { ...spec, racks: rackRun.spec } : spec;
  specFile.data = await buildSpecDocx({ ...spec, racks: rackRun.spec }, { letterhead });
  const publicManifest = { ...manifest, gaps };
  files.unshift({ name: "00-package-index.json", data: Buffer.from(JSON.stringify({ ...publicManifest, drawingSet, cutSheets: { sheets: cutSheets.sheets }, racks: rackRun.index, ...(datasheetBook ? { datasheetBook: BOOK_FILE_NAME } : {}), generatedAt: Date.now(), specSections: spec.sections.length }, null, 2), "utf8") });
  const zip = createStoredZip(files);
  const fileName = `${packageName}.zip`;
  const stored = await d.put(`client-packages/${safeName(project.id)}/${fileName}`, zip, "application/zip");
  const record = await d.save({
    projectId: project.id,
    fileName,
    blobPath: stored.pathname,
    createdBy: by,
    itemCount: manifest.counts.items,
    datasheetCount: files.filter((file) => file.name.startsWith("datasheets/")).length,
    gapCount: gaps.length,
  });
  return { record, gaps, spec: specWithRacks, cutSheets, drawingSet };
}

/** Build the same package from a quote when it has not yet become a Grid project. */
export async function createQuoteClientPackage(quote: Quote, by: string, opts: { printWhere?: PrintWhere; deps?: Partial<ClientPackageDeps>; peakHeader?: boolean | null } = {}): Promise<BuiltClientPackage> {
  const cutSheetsBy = cutSheetDeadline(Date.now()); // #292 — measured from the start of the build; Grid notes #7: the drawing set shares it
  const d = packageDeps(opts.deps);
  if (!d.blobOn()) throw new Error("Client packages require Blob storage on this deployment.");
  // Grid notes #9 — this build's choice ?? the estimate's own (staff package panel) ?? the company default.
  const letterhead = await loadDocumentLetterhead(typeof opts.peakHeader === "boolean" ? opts.peakHeader : quote.packagePeakHeader);
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const { index: docIndex } = await loadPartDocsState(catalog);
  // #296 — fixtures once, before the BOM: rack lines expand into their members (live, D578).
  const qItems = quoteItems(quote);
  const rackFixtures = qItems.some((it) => it.rackId || it.fixtureId) ? new Map((await listFixtures()).map((f) => [f.id, f] as const)) : new Map<string, FixtureRecord>();
  const bom = quoteBom(quote, (id) => rackFixtures.get(id), internalSkuCheck(catalog));
  const { spec, packageDocs, items, gaps, covered } = quoteSpecParts({ quote, bom, catalog, docIndex, sections: await allSections(), by, date: Date.now() });
  const packageName = `${safeName(quote.name || quote.id)}-${safeName(displayQuoteNumber(quote))}`;
  // The docx is written once the racks are known (#296); it keeps its place in the zip.
  const specFile: ZipFile = { name: "specification.docx", data: Buffer.alloc(0) };
  const files: ZipFile[] = [specFile];
  const itemBySku = new Map(items.map((item) => [item.sku, item]));
  // #329 — the datasheet book: one row per BOM part, manufacturer A→Z.
  const partBySku = new Map(catalog.map((part) => [part.sku, part] as const));
  const bookParts = bom.map((row) => bookPartOf(row, partBySku.get(row.sku), packageDocs.bySku.get(row.sku)));
  const bookPlan = planDatasheetBook(bookParts);
  const bookDocs = await addDocuments(packageDocs.documents, docIndex, (sku) => {
    const item = itemBySku.get(sku);
    return { description: item?.description ?? sku, qty: item?.qty ?? 0, catalogId: item?.catalogId ?? null };
  }, files, gaps, bookPlan, d.readDoc);
  const bookP = packageBook(bookParts, bookDocs, [quote.name, quote.customer, `Estimate ${displayQuoteNumber(quote)}`, bookDate(Date.now())], cutSheetsBy, `[package] quote ${quote.id}`, letterhead);
  // Grid notes #7 — a quote minted by a Grid design ships that option's drawing set (the first render on the
  // package's deadline) in place of the equipment summary; a failed render keeps the summary plus one gap.
  // A quote with no Grid design keeps the summary, no gap.
  const where = opts.printWhere ?? NO_PRINT_ORIGIN;
  const grid = await safeFindGrid(d.findGrid, quote.id);
  // Same split as the Grid package: the set's first 50 s, cut sheets + racks keep the last 25 s.
  const set = grid ? await renderPackageDrawingSet(grid.project, grid.optionId, where, packageDrawingSetBudget(cutSheetsBy, process.env.NODE_ENV === "development"), d) : null;
  let drawingSet: PackageDrawingSet | null = null;
  if (set?.ok) {
    files.splice(1, 0, { name: PACKAGE_DRAWING_SET_FILE, data: set.pdf });
    drawingSet = { included: true, file: PACKAGE_DRAWING_SET_FILE, source: "live design" };
  } else {
    files.splice(1, 0, { name: "drawings/quote-equipment-summary.pdf", data: roughQuoteDrawing(quote, packageName, letterhead) });
    if (set) {
      gaps.push(drawingSetGap(set.reason, "the equipment summary is"));
      drawingSet = { included: false, reason: set.reason, source: "live design" };
    }
  }
  const cutSheets = await addCutSheets(quote.id, where, files, gaps, { deadline: cutSheetsBy });
  // #296 — rack lines (`rackId`, D578; or a rack `fixtureId`), read live, after the cut sheets on the same deadline.
  const quoteRacks = racksInQuote(qItems, (id) => rackFixtures.get(id));
  // A well-formed rackId that no longer resolves to a rack (deleted) is an on-request gap, named by its line.
  const rackLineName = new Map<string, string>();
  for (const it of qItems) if (typeof it.rackId === "string" && !rackLineName.has(it.rackId)) rackLineName.set(it.rackId, String(it.desc || "") || "Rack");
  const goneRacks = racksInQuote(qItems.map((it) => ({ rackId: it.rackId })), () => ({ kind: "rack" })).filter((id) => rackFixtures.get(id)?.kind !== "rack");
  const rackRun = await addRacks(quoteRacks, goneRacks, (id) => rackFixtures.get(id)?.label || rackLineName.get(id) || "Rack", where, files, gaps, cutSheetsBy);
  const datasheetBook = addBook(await bookP, files, gaps, bookDocs, (sku) => itemBySku.get(sku)?.catalogId ?? null);
  const specWithRacks: AssembledSpec = rackRun.spec.length ? { ...spec, racks: rackRun.spec } : spec;
  specFile.data = await buildSpecDocx({ ...spec, racks: rackRun.spec }, { letterhead });
  files.unshift({ name: "00-package-index.json", data: Buffer.from(JSON.stringify({ quoteId: quote.id, quoteName: quote.name, items, documents: packageDocs.documents, covered, gaps, ...(drawingSet ? { drawingSet } : {}), cutSheets: { sheets: cutSheets.sheets }, racks: rackRun.index, ...(datasheetBook ? { datasheetBook: BOOK_FILE_NAME } : {}), generatedAt: Date.now(), specSections: spec.sections.length }, null, 2), "utf8") });
  const fileName = `${packageName}.zip`;
  const stored = await d.put(`client-packages/quote-${safeName(quote.id)}/${fileName}`, createStoredZip(files), "application/zip");
  const record = await d.save({ projectId: `quote:${quote.id}`, fileName, blobPath: stored.pathname, createdBy: by, itemCount: items.length, datasheetCount: files.filter((file) => file.name.startsWith("datasheets/")).length, gapCount: gaps.length });
  return { record, gaps, spec: specWithRacks, cutSheets, drawingSet };
}
