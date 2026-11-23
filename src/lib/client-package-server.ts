import { getBlobStream, putBlob, safeName, blobEnabled } from "@/lib/blob";
import type { SpecCatalogPart } from "@/lib/specs/part-spec";
import { coveredNote, type ClientPackageGap } from "@/lib/client-package";
import { listFixtures } from "@/lib/stores/fixtures";
import { renderLetterPdf, type LetterDoc } from "@/lib/pdf";
import { list as listCatalog } from "@/lib/stores/catalog";
import { saveClientPackage, type ClientPackageRecord } from "@/lib/stores/client-packages";
import type { Quote } from "@/lib/stores/quotes";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { createStoredZip, type ZipFile } from "@/lib/zip";
import type { CoverageIndex } from "@/lib/part-docs/coverage";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { datasheetEntryName, packageEntryName, resolvePackageDocs, type PackageDocument } from "@/lib/part-docs/package";
import { BOOK_FILE_NAME, BOOK_REASON, bookByteBudget, bookDate, bookPartOf, planDatasheetBook, withCanonicalMfrs, type BookPart, type BookPlan, type CanonicalMfr } from "@/lib/part-docs/datasheet-book";
import { BOOK_SKIPPED_REASON, buildDatasheetBook, loadCanonicalMfr, type BookDoc } from "@/lib/part-docs/datasheet-book-server";
import type { BookCover } from "@/lib/part-docs/datasheet-book-cover";
import { quoteBookCover } from "@/lib/part-docs/datasheet-book-cover-server";
import { addCutSheets, cutSheetDeadline, NO_PRINT_ORIGIN, type CutSheetsAdded, type PrintWhere } from "@/lib/curtain-cut-sheets/package-sheets";
import type { FixtureRecord } from "@/lib/fixture-assemblies";
import { internalSkuCheck } from "@/lib/quote-line-ids";
import { expandLine, needsFixtureLookup, specItems, type FixtureLookup, type MemberLine } from "@/lib/quote-line-members";
import { loadRackForSheets } from "@/lib/rack/load";
import { rackPackageEntries, type RackIndexEntry, type RackRun } from "@/lib/rack/package";
import { racksInQuote, scheduleCsv } from "@/lib/rack/submittal";
import { RACK_MIN_RENDER_MS, rackSubmittalFiles } from "@/lib/rack/submittal-server";
import type { Letterhead } from "@/lib/letterhead";
import { loadDocumentLetterhead, loadEstimateBookLetterhead } from "@/lib/letterhead-server";
import { isBonusItem } from "@/lib/estimate-bonus/flags";
import { normalizePackageSelection } from "@/lib/estimate-output/package-selection";
import { liveRenameRefs } from "@/lib/stores/catalog-renames";

export type BuiltClientPackage = {
  record: ClientPackageRecord;
  gaps: ClientPackageGap[];
  /** #292 — staff-only: includes the unreadable curtains the zip's index leaves out. */
  cutSheets: CutSheetsAdded;
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
  /** #329 — a package document's bytes (Blob in production). */
  readDoc: (blobKey: string) => Promise<ReadableStream | null>;
  /** #329b — the #298 manufacturer merges for the datasheet book (null = each part's own manufacturer). */
  canonicalMfr: () => Promise<CanonicalMfr | null>;
  /** Grid notes #8 — the datasheet book's job cover (customer logo, job, venue, Prepared for / by). */
  bookCover: (src: BookCoverSource) => Promise<BookCover>;
};

/** Grid notes #8 — whose job cover the package's datasheet book prints. */
export type BookCoverSource = { kind: "quote"; quote: Quote };

/** The job cover, or null (logged) when it can't be read — the book then keeps its plain cover; never fails the package. */
async function safeBookCover(d: ClientPackageDeps, src: BookCoverSource): Promise<BookCover | null> {
  try {
    return await d.bookCover(src);
  } catch (e) {
    console.warn("[package] datasheet book job cover not loaded", e instanceof Error ? e.message : e);
    return null;
  }
}

const livePackageDeps: ClientPackageDeps = {
  blobOn: blobEnabled,
  put: putBlob,
  save: saveClientPackage,
  readDoc: (blobKey) => getBlobStream(blobKey),
  canonicalMfr: () => loadCanonicalMfr(undefined, "[package]"),
  bookCover: (src) => quoteBookCover(src.quote),
};

/** Production deps with the caller's overrides — an override left `undefined` never blanks a live dep. */
function packageDeps(overrides: Partial<ClientPackageDeps> | undefined): ClientPackageDeps {
  const defined = Object.fromEntries(Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined)) as Partial<ClientPackageDeps>;
  return { ...livePackageDeps, ...defined };
}

/** Grid notes #9 — a plain-name PDF's letterhead: the Peak letterhead when
 *  given, else the company name in type (as before #9). */
function letterheadFields(letterhead: Letterhead | null | undefined): Pick<LetterDoc, "companyName" | "headerJpeg" | "headerFull"> {
  if (!letterhead) return { companyName: "Peak Systems Group" };
  return { companyName: letterhead.companyName, headerJpeg: letterhead.image?.jpeg ?? null, headerFull: letterhead.image?.full ?? false };
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
 * #332: every assembly line expands the same way (quote-line-members.ts) —
 * an Estimator assembly / portal fixture / track line into its `components`,
 * an `asm:` / `fixtureId` line into its live members — so its parts' datasheets
 * reach the package instead of one SA- row nobody can cover.
 */
export function quoteBom(
  quote: Pick<Quote, "spec">,
  rackOf?: FixtureLookup,
  /** #296: rack members this flags (internal catalog rows — labor) stay out of the BOM. */
  isInternal?: (sku: string) => boolean,
): Array<{ sku: string; desc: string; qty: number }> {
  const spec = quote.spec as { sections?: Array<{ kind?: string; items?: Array<MemberLine & { sku?: string; desc?: string; qty?: number; labor?: boolean; bonus?: string }> }> } | null | undefined;
  const rows = new Map<string, { sku: string; desc: string; qty: number }>();
  for (const section of spec?.sections || []) {
    for (const item of section.items || []) {
      // A "labor" kind section is already skipped; a non-labor section can
      // still carry individual labor lines (mobilizations, shop &
      // engineering, allowance, performance bonus) — they're not equipment
      // and don't belong in the BOM/client package either.
      if (section.kind === "labor" || item.labor || isBonusItem(item) || item.qty == null || item.qty <= 0) continue;
      const members = expandLine(item, rackOf, isInternal);
      if (members) {
        for (const m of members) {
          const current = rows.get(m.sku);
          if (current) current.qty += m.qty;
          else rows.set(m.sku, { sku: m.sku, desc: m.desc, qty: m.qty });
        }
        continue;
      }
      const sku = String(item.sku || item.desc || "Unspecified line");
      const current = rows.get(sku);
      if (current) current.qty += item.qty;
      else rows.set(sku, { sku, desc: String(item.desc || sku), qty: item.qty });
    }
  }
  return [...rows.values()];
}

type RacksAdded = { index: RackIndexEntry[] };

/**
 * #296 — each rack's sheets + schedule CSV under `racks/<folder>/` (no
 * datasheets.pdf: the package's own datasheets/ already covers the members).
 * Runs AFTER the cut sheets on the same render deadline
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
  if (!found.length && !missing.length) return { index: [] };
  const runs: RackRun[] = [];
  for (const id of found) {
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
  }
  for (const id of missing) runs.push({ id, name: nameOf(id), outcome: "missing" });
  const entries = rackPackageEntries(runs);
  for (const w of entries.warnings) console.warn(`[rack] client package ${w}`);
  files.push(...entries.files);
  gaps.push(...entries.gaps);
  return { index: entries.index };
}

/** A quote's line items, every section. */
function quoteItems(quote: Quote): MemberLine[] {
  return specItems(quote.spec);
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
async function packageBook(parts: BookPart[], docs: Map<string, BookDoc>, subtitleLines: string[], deadline: number, tag: string, letterhead: Letterhead | null, cover: BookCover | null = null): Promise<PackageBookResult> {
  // Nothing read (no datasheets, or Blob lost every one — each already a missing-datasheet gap): no book.
  if (![...docs.values()].some((d) => d.bytes)) return null;
  // #329 review: the loose datasheets + the book stay under BOOK_ZIP_CEILING_BYTES (skip = "package size limit").
  const loose = [...docs.values()].reduce((n, d) => n + (d.bytes?.byteLength ?? 0), 0);
  return buildDatasheetBook({ subtitleLines, parts, docs, letterhead, deadline, logTag: tag, maxBytes: bookByteBudget(loose), cover });
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
 * #301 slice C — one quote BOM's package documents, items and gaps, from a
 * given catalog slice and coverage index. No record, no zip, no Blob. The
 * staff quote package (below) and the estimate package zip
 * (estimate-output/package-zip-server.ts) both use it. (It was
 * `quoteSpecParts` while packages carried a specification file.)
 * #207: the quote's own SKUs are the coverage context — an accessory rides
 * on a fixture only when that fixture is on this quote.
 * #333: `excludedDatasheets` (the project's left-out datasheets, live SKUs)
 * leaves those datasheets out: no document, no missing-datasheet gap, no
 * "covered by" note; items carry `datasheetExcluded`. Absent = as before.
 */
export function quotePackageParts(input: {
  bom: Array<{ sku: string; desc: string; qty: number }>;
  catalog: SpecCatalogPart[];
  docIndex: CoverageIndex;
  excludedDatasheets?: ReadonlySet<string>;
}) {
  const { bom, catalog, docIndex } = input;
  const bySku = new Map(catalog.map((part) => [part.sku, part]));
  // A BOM row names a catalog part when its SKU matches one, case and outer spaces aside (the old spec matcher's rule).
  const norm = (v: string) => String(v || "").trim().toLowerCase();
  const known = new Set(catalog.filter((part) => part.sku).map((part) => norm(part.sku)));
  const ex = input.excludedDatasheets?.size ? { excludedDatasheets: input.excludedDatasheets } : undefined;
  const packageDocs = resolvePackageDocs(docIndex, bom.filter((row) => bySku.has(row.sku)).map((row) => row.sku), ex);
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
      ...(docs?.datasheetExcluded ? { datasheetExcluded: docs.datasheetExcluded } : {}),
    };
  });
  const gaps: ClientPackageGap[] = bom.filter((row) => !known.has(norm(row.sku))).map((row) => ({ kind: "missing-catalog", sku: row.sku, description: row.desc, qty: row.qty, catalogId: null }));
  for (const item of items) {
    if (item.catalogId && !packageDocs.bySku.get(item.sku)?.datasheetOk) gaps.push({ kind: "missing-datasheet", sku: item.sku, description: item.description, qty: item.qty, catalogId: item.catalogId });
  }
  const covered = items.filter((item) => item.datasheetCoveredBy.length && !item.datasheetExcluded).map((item) => coveredNote(item.sku, item.datasheetCoveredBy));
  return { packageDocs, items, gaps, covered };
}

/** #333 — the live quote's left-out datasheet SKUs, followed through the #304 rename log (null = none). */
async function liveExcludedDatasheets(quote: Quote): Promise<ReadonlySet<string> | undefined> {
  const list = normalizePackageSelection(quote.packageSelection).excludedDatasheets;
  if (!list.length) return undefined;
  const { m } = await liveRenameRefs();
  return new Set(list.map((s) => m.get(s) ?? s));
}

/** The Quotes-hub client package for one quote: datasheets (+ the combined book), cut sheets, rack sheets and an equipment summary. No specification file. */
export async function createQuoteClientPackage(quote: Quote, by: string, opts: { printWhere?: PrintWhere; deps?: Partial<ClientPackageDeps>; peakHeader?: boolean | null } = {}): Promise<BuiltClientPackage> {
  const cutSheetsBy = cutSheetDeadline(Date.now()); // #292 — measured from the start of the build
  const d = packageDeps(opts.deps);
  if (!d.blobOn()) throw new Error("Client packages require Blob storage on this deployment.");
  // Grid notes #9 — this build's choice ?? the estimate's own (staff package panel) ?? the company default.
  const letterhead = await loadDocumentLetterhead(typeof opts.peakHeader === "boolean" ? opts.peakHeader : quote.packagePeakHeader);
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const { index: docIndex } = await loadPartDocsState(catalog);
  // #296 — fixtures once, before the BOM: rack lines expand into their members (live, D578).
  const qItems = quoteItems(quote);
  // #332: an assembly line with no components of its own (`asm:`, a bare fixture line) reads its members live too.
  const rackFixtures = qItems.some((it) => it.rackId || it.fixtureId || needsFixtureLookup(it)) ? new Map((await listFixtures()).map((f) => [f.id, f] as const)) : new Map<string, FixtureRecord>();
  const bom = quoteBom(quote, (id) => rackFixtures.get(id), internalSkuCheck(catalog));
  // #333 (Q3): the estimate's own datasheet choices, moved onto renamed parts (the live spec follows renames too).
  const excludedDatasheets = await liveExcludedDatasheets(quote);
  const { packageDocs, items, gaps, covered } = quotePackageParts({ bom, catalog, docIndex, excludedDatasheets });
  const packageName = `${safeName(quote.name || quote.id)}-${safeName(displayQuoteNumber(quote))}`;
  const where = opts.printWhere ?? NO_PRINT_ORIGIN;
  const files: ZipFile[] = [{ name: "drawings/quote-equipment-summary.pdf", data: roughQuoteDrawing(quote, packageName, letterhead) }];
  const itemBySku = new Map(items.map((item) => [item.sku, item]));
  // #329 — the datasheet book: one row per BOM part, manufacturer A→Z.
  const partBySku = new Map(catalog.map((part) => [part.sku, part] as const));
  // #329b — the #298 manufacturer merges, read once for this build.
  // #333 (Q2/Q3): a left-out product is not in the book.
  const bookParts = withCanonicalMfrs(bom.filter((row) => !packageDocs.bySku.get(row.sku)?.datasheetExcluded).map((row) => bookPartOf(row, partBySku.get(row.sku), packageDocs.bySku.get(row.sku))), await d.canonicalMfr());
  const bookPlan = planDatasheetBook(bookParts);
  const bookDocs = await addDocuments(packageDocs.documents, docIndex, (sku) => {
    const item = itemBySku.get(sku);
    return { description: item?.description ?? sku, qty: item?.qty ?? 0, catalogId: item?.catalogId ?? null };
  }, files, gaps, bookPlan, d.readDoc);
  // Grid notes #8 — the book's job cover.
  const bookCover = await safeBookCover(d, { kind: "quote", quote });
  // Jeff 2026-10-15 #12: the estimate's Datasheets.pdf cover takes the full baked Peak letterhead .
  const bookLetterhead = await loadEstimateBookLetterhead(typeof opts.peakHeader === "boolean" ? opts.peakHeader : quote.packagePeakHeader);
  const bookP = packageBook(bookParts, bookDocs, [quote.name, quote.customer, `Estimate ${displayQuoteNumber(quote)}`, bookDate(Date.now())], cutSheetsBy, `[package] quote ${quote.id}`, bookLetterhead, bookCover);
  const cutSheets = await addCutSheets(quote.id, where, files, gaps, { deadline: cutSheetsBy });
  // #296 — rack lines (`rackId`, D578; or a rack `fixtureId`), read live, after the cut sheets on the same deadline.
  const quoteRacks = racksInQuote(qItems, (id) => rackFixtures.get(id));
  // A well-formed rackId that no longer resolves to a rack (deleted) is an on-request gap, named by its line.
  const rackLineName = new Map<string, string>();
  for (const it of qItems) if (typeof it.rackId === "string" && !rackLineName.has(it.rackId)) rackLineName.set(it.rackId, String(it.desc || "") || "Rack");
  const goneRacks = racksInQuote(qItems.map((it) => ({ rackId: it.rackId })), () => ({ kind: "rack" })).filter((id) => rackFixtures.get(id)?.kind !== "rack");
  const rackRun = await addRacks(quoteRacks, goneRacks, (id) => rackFixtures.get(id)?.label || rackLineName.get(id) || "Rack", where, files, gaps, cutSheetsBy);
  const datasheetBook = addBook(await bookP, files, gaps, bookDocs, (sku) => itemBySku.get(sku)?.catalogId ?? null);
  files.unshift({ name: "00-package-index.json", data: Buffer.from(JSON.stringify({ quoteId: quote.id, quoteName: quote.name, items, documents: packageDocs.documents, covered, gaps, cutSheets: { sheets: cutSheets.sheets }, racks: rackRun.index, ...(datasheetBook ? { datasheetBook: BOOK_FILE_NAME } : {}), generatedAt: Date.now() }, null, 2), "utf8") });
  const fileName = `${packageName}.zip`;
  const stored = await d.put(`client-packages/quote-${safeName(quote.id)}/${fileName}`, createStoredZip(files), "application/zip");
  const record = await d.save({ projectId: `quote:${quote.id}`, fileName, blobPath: stored.pathname, createdBy: by, itemCount: items.length, datasheetCount: files.filter((file) => file.name.startsWith("datasheets/")).length, gapCount: gaps.length });
  return { record, gaps, cutSheets };
}
