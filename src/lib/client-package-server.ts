import { dataUrlToBytes, getBlobStream, putBlob, safeName, blobEnabled } from "@/lib/blob";
import { assemble, matchBom, type AssembledSpec, type SpecCatalogPart } from "@/lib/bid-spec";
import { buildSpecDocx } from "@/lib/bid-spec-docx";
import { buildClientPackageManifest, type ClientPackageGap } from "@/lib/client-package";
import { renderLetterPdf, type FieldSheetDoc, type LetterDoc } from "@/lib/pdf";
import { riserGraph } from "@/lib/design/grid-riser";
import { list as listCatalog } from "@/lib/stores/catalog";
import { listSheets, type GridProject } from "@/lib/stores/grid-projects";
import { allSections } from "@/lib/stores/spec-sections";
import { saveClientPackage, type ClientPackageRecord } from "@/lib/stores/client-packages";
import { createStoredZip, type ZipFile } from "@/lib/zip";

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

export async function createClientPackage(
  project: GridProject,
  by: string,
  requestedOptionId?: string | null,
): Promise<BuiltClientPackage> {
  if (!blobEnabled()) throw new Error("Client packages require Blob storage on this deployment.");
  const catalog = (await listCatalog()) as SpecCatalogPart[];
  const manifest = buildClientPackageManifest(project, catalog, requestedOptionId);
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
  for (const item of manifest.items) {
    if (!item.datasheet) continue;
    const part = catalog.find((candidate) => candidate.id === item.catalogId || candidate.sku === item.sku);
    if (!part?.datasheetBlobKey) continue;
    const stream = await getBlobStream(part.datasheetBlobKey);
    if (!stream) {
      gaps.push({ kind: "missing-datasheet", sku: item.sku, description: item.description, qty: item.qty, catalogId: item.catalogId });
      continue;
    }
    files.push({ name: `datasheets/${safeName(item.sku)}-${safeName(item.datasheet.name)}`, data: await bytesFromStream(stream) });
  }
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
  const publicManifest = {
    ...manifest,
    datasheets: manifest.datasheets.map(({ sku, name }) => ({ sku, name })),
    items: manifest.items.map(({ datasheet, ...item }) => ({ ...item, datasheet: datasheet ? { name: datasheet.name } : null })),
    gaps,
  };
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
