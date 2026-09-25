import { dataUrlToBytes, getBlobStream, putBlob, safeName, blobEnabled } from "@/lib/blob";
import { assemble, matchBom, type AssembledSpec, type SpecCatalogPart } from "@/lib/bid-spec";
import { buildSpecDocx } from "@/lib/bid-spec-docx";
import { buildClientPackageManifest, coveredNote, type ClientPackageGap } from "@/lib/client-package";
import { renderLetterPdf, type FieldSheetDoc, type LetterDoc } from "@/lib/pdf";
import { riserGraph } from "@/lib/design/grid-riser";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listSheets, type GridProject } from "@/lib/stores/grid-projects";
import { allSections } from "@/lib/stores/spec-sections";
import { saveClientPackage, type ClientPackageRecord } from "@/lib/stores/client-packages";
import type { Quote } from "@/lib/stores/quotes";
import { createStoredZip, type ZipFile } from "@/lib/zip";
import type { CoverageIndex } from "@/lib/part-docs/coverage";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { packageEntryName, resolvePackageDocs, type PackageDocument } from "@/lib/part-docs/package";

export type BuiltClientPackage = {
  record: ClientPackageRecord;
  gaps: ClientPackageGap[];
  spec: AssembledSpec;
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
            { label: "Placed devices", value: String((project.placements || []).filter((p) => !p.curtain).length) },
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
    meta: [{ label: "Package", value: packageName }, { label: "Quote", value: quote.id }],
    re: quote.name,
    greeting: "",
    blocks: [],
    costLine: "",
    costTail: "",
    taxNote: "",
    signer: { name: "Peak Systems Group", title: "Client package" },
    fieldSheet: {
      job: quote.id,
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

function quoteBom(quote: Quote): Array<{ sku: string; desc: string; qty: number }> {
  const spec = quote.spec as { sections?: Array<{ kind?: string; items?: Array<{ sku?: string; desc?: string; qty?: number; labor?: boolean }> }> } | null | undefined;
  const rows = new Map<string, { sku: string; desc: string; qty: number }>();
  for (const section of spec?.sections || []) {
    for (const item of section.items || []) {
      // A "labor" kind section is already skipped; a non-labor section can
      // still carry individual labor lines (mobilizations, shop &
      // engineering, allowance, performance bonus) — they're not equipment
      // and don't belong in the BOM/client package either.
      if (section.kind === "labor" || item.labor || item.qty == null || item.qty <= 0) continue;
      const sku = String(item.sku || item.desc || "Unspecified line");
      const current = rows.get(sku);
      if (current) current.qty += item.qty;
      else rows.set(sku, { sku, desc: String(item.desc || sku), qty: item.qty });
    }
  }
  return [...rows.values()];
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
): Promise<BuiltClientPackage> {
  if (!blobEnabled()) throw new Error("Client packages require Blob storage on this deployment.");
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const { index: docIndex } = await loadPartDocsState(catalog);
  const manifest = buildClientPackageManifest(project, catalog, requestedOptionId, docIndex);
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
  const files: ZipFile[] = [
    { name: "specification.docx", data: await buildSpecDocx(spec) },
    { name: "drawings/rough-drawings.pdf", data: roughDrawings(project, catalog, packageName) },
  ];
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
  const publicManifest = { ...manifest, gaps };
  files.unshift({ name: "00-package-index.json", data: Buffer.from(JSON.stringify({ ...publicManifest, generatedAt: Date.now(), specSections: spec.sections.length }, null, 2), "utf8") });
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
  return { record, gaps, spec };
}

/** Build the same package from a quote when it has not yet become a Grid project. */
export async function createQuoteClientPackage(quote: Quote, by: string): Promise<BuiltClientPackage> {
  if (!blobEnabled()) throw new Error("Client packages require Blob storage on this deployment.");
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const { index: docIndex } = await loadPartDocsState(catalog);
  const bySku = new Map(catalog.map((part) => [part.sku, part]));
  const bom = quoteBom(quote);
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
    };
  });
  const gaps: ClientPackageGap[] = matched.rows.filter((row) => row.bucket !== "ready").map((row) => ({ kind: row.bucket === "no-match" ? "missing-catalog" : "missing-spec", sku: row.row.sku, description: row.row.desc, qty: row.row.qty, catalogId: row.part?.id || null }));
  for (const item of items) {
    if (item.catalogId && !packageDocs.bySku.get(item.sku)?.datasheetOk) gaps.push({ kind: "missing-datasheet", sku: item.sku, description: item.description, qty: item.qty, catalogId: item.catalogId });
  }
  const covered = items.filter((item) => item.datasheetCoveredBy.length).map((item) => coveredNote(item.sku, item.datasheetCoveredBy));
  const packageName = `${safeName(quote.name || quote.id)}-${quote.id}`;
  const files: ZipFile[] = [
    { name: "specification.docx", data: await buildSpecDocx(spec) },
    { name: "drawings/quote-equipment-summary.pdf", data: roughQuoteDrawing(quote, packageName) },
  ];
  const itemBySku = new Map(items.map((item) => [item.sku, item]));
  await addDocuments(packageDocs.documents, docIndex, (sku) => {
    const item = itemBySku.get(sku);
    return { description: item?.description ?? sku, qty: item?.qty ?? 0, catalogId: item?.catalogId ?? null };
  }, files, gaps);
  files.unshift({ name: "00-package-index.json", data: Buffer.from(JSON.stringify({ quoteId: quote.id, quoteName: quote.name, items, documents: packageDocs.documents, covered, gaps, generatedAt: Date.now(), specSections: spec.sections.length }, null, 2), "utf8") });
  const fileName = `${packageName}.zip`;
  const stored = await putBlob(`client-packages/quote-${safeName(quote.id)}/${fileName}`, createStoredZip(files), "application/zip");
  const record = await saveClientPackage({ projectId: `quote:${quote.id}`, fileName, blobPath: stored.pathname, createdBy: by, itemCount: items.length, datasheetCount: files.filter((file) => file.name.startsWith("datasheets/")).length, gapCount: gaps.length });
  return { record, gaps, spec };
}
