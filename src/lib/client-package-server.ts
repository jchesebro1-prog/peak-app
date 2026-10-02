import { dataUrlToBytes, getBlobStream, putBlob, safeName, blobEnabled } from "@/lib/blob";
import { assemble, matchBom, type AssembledSpec, type RackSpecSection, type SpecCatalogPart } from "@/lib/bid-spec";
import { buildSpecDocx } from "@/lib/bid-spec-docx";
import { buildClientPackageManifest, coveredNote, packageNeedsFixtures, type ClientPackageGap } from "@/lib/client-package";
import { placementQty } from "@/lib/design/grid-bom";
import { listFixtures } from "@/lib/stores/fixtures";
import { renderLetterPdf, type FieldSheetDoc, type LetterDoc } from "@/lib/pdf";
import { riserGraph } from "@/lib/design/grid-riser";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listSheets, type GridProject } from "@/lib/stores/grid-projects";
import { allSections } from "@/lib/stores/spec-sections";
import { saveClientPackage, type ClientPackageRecord } from "@/lib/stores/client-packages";
import type { Quote } from "@/lib/stores/quotes";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { createStoredZip, type ZipFile } from "@/lib/zip";
import type { CoverageIndex } from "@/lib/part-docs/coverage";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { packageEntryName, resolvePackageDocs, type PackageDocument } from "@/lib/part-docs/package";
import { isRewardCreditItem } from "@/lib/rewards/credit-line";
import { addCutSheets, cutSheetDeadline, NO_PRINT_ORIGIN, type CutSheetsAdded, type PrintWhere } from "@/lib/curtain-cut-sheets/package-sheets";
import { ensureOptions, optionSlice, resolveOptionId } from "@/lib/design/grid-options";
import type { FixtureRecord, FixtureResolvable } from "@/lib/fixture-assemblies";
import { gridSpecBomRows, internalSkuCheck } from "@/lib/design/grid-virtual-parts";
import { emptyRackLayout } from "@/lib/rack/layout";
import { loadRackForSheets } from "@/lib/rack/load";
import { rackPackageEntries, type RackIndexEntry, type RackRun } from "@/lib/rack/package";
import { rackElevationPng } from "@/lib/rack/raster";
import { racksInGrid, racksInQuote, scheduleCsv } from "@/lib/rack/submittal";
import { RACK_MIN_RENDER_MS, rackSubmittalFiles } from "@/lib/rack/submittal-server";

export type BuiltClientPackage = {
  record: ClientPackageRecord;
  gaps: ClientPackageGap[];
  spec: AssembledSpec;
  /** #292 — staff-only: includes the unreadable curtains the zip's index leaves out. */
  cutSheets: CutSheetsAdded;
};

async function bytesFromStream(stream: ReadableStream): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

function roughDrawings(project: GridProject, catalog: SpecCatalogPart[], packageName: string): Buffer {
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
    companyName: "Peak Systems Group",
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

function roughQuoteDrawing(quote: Quote, packageName: string): Buffer {
  const doc: LetterDoc = {
    companyName: "Peak Systems Group",
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
 */
async function addDocuments(
  documents: PackageDocument[],
  index: CoverageIndex,
  describe: (sku: string) => { description: string; qty: number; catalogId: string | null },
  files: ZipFile[],
  gaps: ClientPackageGap[],
): Promise<void> {
  const used = new Set<string>();
  for (const doc of documents) {
    const blobKey = index.docsById.get(doc.documentId)?.blobKey;
    const stream = blobKey ? await getBlobStream(blobKey) : null;
    if (!stream) {
      if (doc.kind === "datasheet") for (const sku of doc.skus) gaps.push({ kind: "missing-datasheet", sku, ...describe(sku) });
      continue;
    }
    files.push({ name: packageEntryName(doc, used, safeName), data: await bytesFromStream(stream) });
  }
}

export async function createClientPackage(
  project: GridProject,
  by: string,
  requestedOptionId?: string | null,
  opts: { printWhere?: PrintWhere } = {},
): Promise<BuiltClientPackage> {
  const cutSheetsBy = cutSheetDeadline(Date.now()); // #292 — measured from the start of the build
  if (!blobEnabled()) throw new Error("Client packages require Blob storage on this deployment.");
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
  const files: ZipFile[] = [specFile, { name: "drawings/rough-drawings.pdf", data: roughDrawings(project, catalog, packageName) }];
  const gaps = [...manifest.gaps];
  const itemBySku = new Map(manifest.items.map((item) => [item.sku, item]));
  await addDocuments(manifest.documents, docIndex, (sku) => {
    const item = itemBySku.get(sku);
    return { description: item?.description ?? sku, qty: item?.qty ?? 0, catalogId: item?.catalogId ?? null };
  }, files, gaps);
  for (const [index, sheet] of (await listSheets(project.id)).entries()) {
    let bytes: Buffer | null = null;
    if (sheet.dataUrl) {
      try { bytes = dataUrlToBytes(sheet.dataUrl).bytes; } catch { bytes = null; }
    } else if (sheet.blobPath) {
      const stream = await getBlobStream(sheet.blobPath);
      if (stream) bytes = await bytesFromStream(stream);
    }
    if (bytes) files.push({ name: `drawings/plan-${String(index + 1).padStart(2, "0")}-${safeName(sheet.name)}`, data: bytes });
  }
  // #292 — cut sheets for the option's quote; a design with curtains but no quote gets one gap.
  const optId = resolveOptionId(project, requestedOptionId);
  const optQuoteId = ensureOptions(project).options.find((o) => o.id === optId)?.quoteId ?? null;
  let cutSheets: CutSheetsAdded = { sheets: [], unreadable: [] };
  if (optQuoteId) cutSheets = await addCutSheets(optQuoteId, opts.printWhere ?? NO_PRINT_ORIGIN, files, gaps, { deadline: cutSheetsBy });
  else if (optionSlice(project, optId).placements.some((p) => !!p.curtain))
    gaps.push({ kind: "missing-cutsheet", sku: "CS", description: "Add this design to Quotes to include cut sheets", qty: 0, catalogId: null });
  // #296 — racks placed on this option (`asm:<id>` of kind rack), after the cut sheets on the same deadline.
  const gridRacks = racksInGrid(optionSlice(project, optId).placements.map((p) => p.partId), (id) => fixtures?.get(id));
  const rackRun = await addRacks(gridRacks, [], (id) => fixtures?.get(id)?.label || "Rack", opts.printWhere ?? NO_PRINT_ORIGIN, files, gaps, cutSheetsBy);
  const specWithRacks: AssembledSpec = rackRun.spec.length ? { ...spec, racks: rackRun.spec } : spec;
  specFile.data = await buildSpecDocx({ ...spec, racks: rackRun.spec });
  const publicManifest = { ...manifest, gaps };
  files.unshift({ name: "00-package-index.json", data: Buffer.from(JSON.stringify({ ...publicManifest, cutSheets: { sheets: cutSheets.sheets }, racks: rackRun.index, generatedAt: Date.now(), specSections: spec.sections.length }, null, 2), "utf8") });
  const zip = createStoredZip(files);
  const fileName = `${packageName}.zip`;
  const stored = await putBlob(`client-packages/${safeName(project.id)}/${fileName}`, zip, "application/zip");
  const record = await saveClientPackage({
    projectId: project.id,
    fileName,
    blobPath: stored.pathname,
    createdBy: by,
    itemCount: manifest.counts.items,
    datasheetCount: files.filter((file) => file.name.startsWith("datasheets/")).length,
    gapCount: gaps.length,
  });
  return { record, gaps, spec: specWithRacks, cutSheets };
}

/** Build the same package from a quote when it has not yet become a Grid project. */
export async function createQuoteClientPackage(quote: Quote, by: string, opts: { printWhere?: PrintWhere } = {}): Promise<BuiltClientPackage> {
  const cutSheetsBy = cutSheetDeadline(Date.now()); // #292 — measured from the start of the build
  if (!blobEnabled()) throw new Error("Client packages require Blob storage on this deployment.");
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const { index: docIndex } = await loadPartDocsState(catalog);
  const bySku = new Map(catalog.map((part) => [part.sku, part]));
  // #296 — fixtures once, before the BOM: rack lines expand into their members (live, D578).
  const qItems = quoteItems(quote);
  const rackFixtures = qItems.some((it) => it.rackId || it.fixtureId) ? new Map((await listFixtures()).map((f) => [f.id, f] as const)) : new Map<string, FixtureRecord>();
  const bom = quoteBom(quote, (id) => rackFixtures.get(id), internalSkuCheck(catalog));
  const matched = matchBom(bom, catalog);
  const sections = await allSections();
  const spec = assemble(matched.rows, sections, {
    projectName: quote.name,
    customer: quote.customer,
    engagementId: `quote:${quote.id}`,
    preparedBy: by,
    date: Date.now(),
  });
  // #207: the quote's own SKUs are the coverage context — an accessory rides
  // on a fixture only when that fixture is on this quote.
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
  const packageName = `${safeName(quote.name || quote.id)}-${safeName(displayQuoteNumber(quote))}`;
  // The docx is written once the racks are known (#296); it keeps its place in the zip.
  const specFile: ZipFile = { name: "specification.docx", data: Buffer.alloc(0) };
  const files: ZipFile[] = [specFile, { name: "drawings/quote-equipment-summary.pdf", data: roughQuoteDrawing(quote, packageName) }];
  const itemBySku = new Map(items.map((item) => [item.sku, item]));
  await addDocuments(packageDocs.documents, docIndex, (sku) => {
    const item = itemBySku.get(sku);
    return { description: item?.description ?? sku, qty: item?.qty ?? 0, catalogId: item?.catalogId ?? null };
  }, files, gaps);
  const cutSheets = await addCutSheets(quote.id, opts.printWhere ?? NO_PRINT_ORIGIN, files, gaps, { deadline: cutSheetsBy });
  // #296 — rack lines (`rackId`, D578; or a rack `fixtureId`), read live, after the cut sheets on the same deadline.
  const quoteRacks = racksInQuote(qItems, (id) => rackFixtures.get(id));
  // A well-formed rackId that no longer resolves to a rack (deleted) is an on-request gap, named by its line.
  const rackLineName = new Map<string, string>();
  for (const it of qItems) if (typeof it.rackId === "string" && !rackLineName.has(it.rackId)) rackLineName.set(it.rackId, String(it.desc || "") || "Rack");
  const goneRacks = racksInQuote(qItems.map((it) => ({ rackId: it.rackId })), () => ({ kind: "rack" })).filter((id) => rackFixtures.get(id)?.kind !== "rack");
  const rackRun = await addRacks(quoteRacks, goneRacks, (id) => rackFixtures.get(id)?.label || rackLineName.get(id) || "Rack", opts.printWhere ?? NO_PRINT_ORIGIN, files, gaps, cutSheetsBy);
  const specWithRacks: AssembledSpec = rackRun.spec.length ? { ...spec, racks: rackRun.spec } : spec;
  specFile.data = await buildSpecDocx({ ...spec, racks: rackRun.spec });
  files.unshift({ name: "00-package-index.json", data: Buffer.from(JSON.stringify({ quoteId: quote.id, quoteName: quote.name, items, documents: packageDocs.documents, covered, gaps, cutSheets: { sheets: cutSheets.sheets }, racks: rackRun.index, generatedAt: Date.now(), specSections: spec.sections.length }, null, 2), "utf8") });
  const fileName = `${packageName}.zip`;
  const stored = await putBlob(`client-packages/quote-${safeName(quote.id)}/${fileName}`, createStoredZip(files), "application/zip");
  const record = await saveClientPackage({ projectId: `quote:${quote.id}`, fileName, blobPath: stored.pathname, createdBy: by, itemCount: items.length, datasheetCount: files.filter((file) => file.name.startsWith("datasheets/")).length, gapCount: gaps.length });
  return { record, gaps, spec: specWithRacks, cutSheets };
}
