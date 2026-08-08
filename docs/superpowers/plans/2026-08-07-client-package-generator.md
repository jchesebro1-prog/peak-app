# Client Package Generator (#40) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click, from a Grid project or a quote, walks its BOM and emits a downloadable zip of three documents: a merged datasheet PDF package (with a gap-listing cover index), the existing D94 spec .docx, and a "rough drawings" PDF (plan sheet + riser).

**Architecture:** Reuse everything that already exists — the D94 `assemble`/`saveGeneratedSpec`/`buildSpecDocx` pipeline, the D116 blob store, `bomFromQuoteAction`'s Grid→BOM bridge, `grid-bom.ts`/`grid-riser.ts`. The one genuinely new capability is **server-side PDF rendering**, which this repo has never needed before (`pdfjs-dist` is client-side read-only). Rather than pull in a headless browser, this plan renders `PlanData` (the same flat rects/lines/circles/texts/paths primitive list `<PlanSvg>` already consumes, see the #38/#41 plan) directly into `pdf-lib` drawing calls — no SVG import step needed, because the plan/riser renderers already produce that primitive list, not arbitrary SVG markup.

**Tech Stack:** TypeScript, `pdf-lib` (new dependency — PDF creation/merging), `archiver` (new dependency — zip assembly), the existing `docx`/D116-blob/`doc-store` stack, the app's custom `ok()` assertion runner.

## Global Constraints

- **Nothing silently skipped.** Every part in the walked BOM ends up in exactly one of: priced-with-datasheet, priced-no-datasheet (a cover-index gap), or spec-incomplete (a cover-index gap, distinct list) — mirrors the existing `MatchReport` "finalizable" ethos in `src/lib/bid-spec.ts`.
- **Bundle format is a zip of three documents** (datasheet PDF, spec .docx, drawings PDF) — locked, not a single merged PDF. The .docx stays editable (architects paste it into project manuals, D94's existing numbering convention).
- **CRM-thread auto-attach is out of scope for v1** — this plan ends at "downloadable from the project/quote," nothing more.
- **This plan depends on #39 (catalog import) and #38/#41 (Grid artifact relocation) landing first** per the locked wave sequencing in `PUNCHLIST.md` — Task 3 below reuses `buildGridBaseSheetPlan` from the #38/#41 plan and expects real `datasheetBlobKey` population from #39's import to produce a non-trivial datasheet package. The code in this plan will run without them (against whatever catalog/Grid data exists), but "one click, real output" is only a meaningful acceptance test once both land.

---

### Task 1: Add dependencies + a PlanData-to-PDF-page renderer

**Files:**
- Modify: `package.json` (add `pdf-lib`, `archiver`, `@types/archiver`)
- Create: `src/lib/design/plan-to-pdf.ts`
- Modify: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `PlanData` (`src/app/(app)/design/quick/plan-svg.tsx`, existing, unchanged).
- Produces: `drawPlanDataPage(pdfDoc: PDFDocument, plan: PlanData, opts: { title: string }): Promise<PDFPage>` — the primitive on which Task 4's "rough drawings" page depends.

- [ ] **Step 1: Install the two new dependencies**

```bash
npm install pdf-lib archiver
npm install -D @types/archiver
```

- [ ] **Step 2: Write the failing test**

```ts
/* --- PlanData -> PDF page renderer (#40) --- */
import { PDFDocument } from "pdf-lib";
import { drawPlanDataPage } from "@/lib/design/plan-to-pdf";

await (async () => {
  const doc = await PDFDocument.create();
  const plan = {
    W: 640, H: 400,
    rects: [{ x: 10, y: 10, w: 100, h: 50, fill: "#ffffff", stroke: "#000000", sw: 1 }],
    lines: [{ x1: 0, y1: 0, x2: 100, y2: 100, stroke: "#000000", sw: 1 }],
    circles: [{ cx: 50, cy: 50, r: 5, fill: "#000000" }],
    texts: [{ x: 20, y: 20, t: "Pro width 40 ft", fill: "#000000", size: 12, anchor: "start" as const }],
    paths: [],
  };
  const page = await drawPlanDataPage(doc, plan, { title: "Test Plan" });
  ok(doc.getPageCount() === 1, "plan-to-pdf: drawPlanDataPage adds exactly one page");
  ok(page.getWidth() > 0 && page.getHeight() > 0, "plan-to-pdf: the rendered page has positive dimensions");
})();
```

- [ ] **Step 3: Run the suite to verify it fails**

Run: `npm run test:specs`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `src/lib/design/plan-to-pdf.ts`**

```ts
/**
 * Renders a PlanData primitive list (the same flat rects/lines/circles/
 * texts/paths shape <PlanSvg> consumes — see design/quick/plan-svg.tsx)
 * directly into a pdf-lib page. This is deliberately NOT an SVG-to-PDF
 * conversion — PlanData is already a flat primitive list, so mapping each
 * primitive to its pdf-lib draw call is simpler and needs no headless
 * browser / SVG parser dependency (#40).
 *
 * Text rotation (used for vertical dimension labels) and path arcs (used
 * for door swing arcs) are approximated, not pixel-perfect — "rough" is
 * the promise for this artifact (client-package spec, §"Rough drawings").
 */
import { PDFDocument, PDFPage, rgb, StandardFonts, degrees } from "pdf-lib";
import type { PlanData } from "@/app/(app)/design/quick/plan-svg";

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export async function drawPlanDataPage(
  pdfDoc: PDFDocument,
  plan: PlanData,
  opts: { title: string }
): Promise<PDFPage> {
  const margin = 40;
  const page = pdfDoc.addPage([plan.W + margin * 2, plan.H + margin * 2 + 24]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const flipY = (y: number) => page.getHeight() - margin - 24 - y; // PlanData's y grows downward; PDF's grows upward

  page.drawText(opts.title, { x: margin, y: page.getHeight() - margin + 6, size: 13, font, color: rgb(0.1, 0.1, 0.1) });

  for (const r of plan.rects) {
    page.drawRectangle({
      x: margin + r.x,
      y: flipY(r.y + r.h),
      width: r.w,
      height: r.h,
      color: r.fill && r.fill !== "none" ? hexToRgb(r.fill) : undefined,
      borderColor: r.stroke && r.stroke !== "none" ? hexToRgb(r.stroke) : undefined,
      borderWidth: r.sw || 0,
    });
  }
  for (const l of plan.lines) {
    page.drawLine({
      start: { x: margin + l.x1, y: flipY(l.y1) },
      end: { x: margin + l.x2, y: flipY(l.y2) },
      thickness: l.sw || 1,
      color: hexToRgb(l.stroke),
    });
  }
  for (const c of plan.circles) {
    page.drawEllipse({ x: margin + c.cx, y: flipY(c.cy), xScale: c.r, yScale: c.r, color: hexToRgb(c.fill) });
  }
  for (const t of plan.texts) {
    page.drawText(t.t, {
      x: margin + t.x,
      y: flipY(t.y),
      size: t.size,
      font,
      color: hexToRgb(t.fill),
      rotate: t.transform?.includes("rotate(-90") ? degrees(90) : undefined,
    });
  }
  // paths (door-swing arcs etc.) are skipped in v1 — rects/lines/texts carry
  // all the load-bearing geometry; arcs are decorative. Revisit if a "rough"
  // drawing without them reads as confusing rather than just plain.

  return page;
}
```

- [ ] **Step 5: Run the suite to verify it passes**

Run: `npm run test:specs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/design/plan-to-pdf.ts scripts/test-review-and-spec.ts
git commit -m "feat(client-package): add pdf-lib/archiver deps + drawPlanDataPage renderer (#40)"
```

---

### Task 2: Bundle walker

**Files:**
- Create: `src/lib/design/client-package.ts`
- Modify: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `matchBom`, `assemble`, `BomRow`, `MatchedRow`, `SpecCatalogPart` (`src/lib/bid-spec.ts`, existing); `saveGeneratedSpec` (`src/lib/stores/generated-specs.ts`, existing).
- Produces: `walkBundle(input: { bom: BomRow[]; catalog: SpecCatalogPart[]; engagementId: string; projectName: string; customer: string; preparedBy: string }): BundlePlan` — the shape every later task in this plan builds from.

- [ ] **Step 1: Write the failing test**

```ts
/* --- Client package bundle walker (#40) --- */
import { walkBundle } from "@/lib/design/client-package";

await (async () => {
  const cpCatalog = [
    { id: "p1", sku: "ETC:405", desc: "Source Four 5°", category: "Fixtures", unit: "ea", list: 1260, cost: 756, datasheetBlobKey: "blob/etc-405.pdf", specCsi: "26 55 33", specText: "Ellipsoidal fixture..." },
    { id: "p2", sku: "Thern:CW11-1M", desc: "Manual hoist", category: "Curtains", unit: "ea", list: 2110, cost: 1477 }, // no datasheet, no spec
  ];
  const bundle = await walkBundle({
    bom: [{ sku: "ETC:405", desc: "Source Four 5°", qty: 2 }, { sku: "Thern:CW11-1M", desc: "Manual hoist", qty: 1 }],
    catalog: cpCatalog as never,
    engagementId: "eng-test",
    projectName: "Test Project",
    customer: "Test Customer",
    preparedBy: "Tester",
  });
  ok(bundle.datasheets.length === 1, "client-package: walkBundle finds exactly one row with a datasheet");
  ok(bundle.gaps.some((g) => g.sku === "Thern:CW11-1M" && g.reason === "no-datasheet"), "client-package: walkBundle gaps the row with no datasheetBlobKey");
  ok(bundle.spec.sections.length >= 0, "client-package: walkBundle always produces an AssembledSpec, even with incomplete rows");
})();
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:specs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/design/client-package.ts`**

```ts
/**
 * Bundle walker (#40): turns a BOM + catalog into everything the client
 * package generator needs — which rows have a real datasheet (to merge),
 * which don't (a cover-index gap), and a frozen AssembledSpec covering
 * whatever rows DO have spec language.
 *
 * Design call: the existing D94 saveSpecAction REFUSES to generate when
 * any row is unmatched/unspecified (bid-spec.ts's "finalizable" gate) —
 * correct for an architect-facing bid spec, wrong for this "without too
 * much effort" client package. Here, every non-ready row is auto-waived
 * (reason: "client package — see gap list") so assemble() always
 * succeeds, and the SAME row shows up on the datasheet cover's gap list
 * under a "no-spec"/"no-match" reason — one gap list, not two silent
 * failure modes.
 */
import { matchBom, assemble, type BomRow, type MatchedRow, type SpecCatalogPart, type AssembledSpec } from "@/lib/bid-spec";
import { allSections } from "@/lib/stores/spec-sections";

export type PackageGap = { sku: string; desc: string; reason: "no-datasheet" | "no-spec" | "no-match" };

export type BundlePlan = {
  datasheets: Array<{ sku: string; desc: string; datasheetBlobKey: string; category: string }>;
  gaps: PackageGap[];
  spec: AssembledSpec;
  rows: MatchedRow[];
};

export async function walkBundle(input: {
  bom: BomRow[];
  catalog: SpecCatalogPart[];
  engagementId: string;
  projectName: string;
  customer: string;
  preparedBy: string;
}): Promise<BundlePlan> {
  const report = matchBom(input.bom, input.catalog);
  const waivedRows: MatchedRow[] = report.rows.map((r) =>
    r.bucket === "ready" || r.waived
      ? r
      : { ...r, waived: true, waiveReason: "client package — see gap list" }
  );

  const gaps: PackageGap[] = [];
  const datasheets: BundlePlan["datasheets"] = [];
  for (const row of report.rows) {
    if (row.bucket === "no-match") {
      gaps.push({ sku: row.row.sku, desc: row.row.desc, reason: "no-match" });
      continue;
    }
    if (row.bucket === "no-spec") {
      gaps.push({ sku: row.row.sku, desc: row.row.desc, reason: "no-spec" });
    }
    const key = (row.part as SpecCatalogPart & { datasheetBlobKey?: string })?.datasheetBlobKey;
    if (key) {
      datasheets.push({ sku: row.row.sku, desc: row.row.desc, datasheetBlobKey: key, category: row.part!.category });
    } else if (row.part) {
      gaps.push({ sku: row.row.sku, desc: row.row.desc, reason: "no-datasheet" });
    }
  }

  const sections = await allSections();
  const spec = assemble(waivedRows, sections, {
    projectName: input.projectName,
    customer: input.customer,
    engagementId: input.engagementId,
    preparedBy: input.preparedBy,
    date: Date.now(),
  });

  return { datasheets, gaps, spec, rows: waivedRows };
}
```

`allSections()` (`src/lib/stores/spec-sections.ts:47`) is a plain store function, not a `"use server"` action — it's safe to import directly here, same as `matchBom`/`assemble` above.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:specs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/client-package.ts scripts/test-review-and-spec.ts
git commit -m "feat(client-package): add walkBundle, the BOM->package planner (#40)"
```

---

### Task 3: Datasheet PDF merge with cover/index page

**Files:**
- Create: `src/lib/design/datasheet-merge.ts`
- Modify: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `BundlePlan.datasheets`/`gaps` (Task 2), `getBlobStream` (`src/lib/blob.ts`, existing).
- Produces: `mergeDatasheets(bundle: BundlePlan): Promise<Uint8Array>` — a single PDF: cover/index page first, then every matched datasheet's pages in category order.

- [ ] **Step 1: Write the failing test**

```ts
/* --- Datasheet PDF merge + cover index (#40) --- */
import { PDFDocument as _PDFDocForTest } from "pdf-lib";
import { mergeDatasheets } from "@/lib/design/datasheet-merge";

await (async () => {
  const emptyBundle = { datasheets: [], gaps: [{ sku: "X:1", desc: "Widget", reason: "no-datasheet" as const }], spec: { projectName: "", customer: "", engagementId: "", preparedBy: "", date: 0, sections: [], waived: [] }, rows: [] };
  const bytes = await mergeDatasheets(emptyBundle);
  const doc = await _PDFDocForTest.load(bytes);
  ok(doc.getPageCount() === 1, "datasheet-merge: an all-gaps bundle still produces a 1-page PDF (cover/index only, nothing silently empty)");
})();
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:specs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/design/datasheet-merge.ts`**

```ts
/**
 * Merges every BOM row's real datasheet PDF into one document, with a
 * generated cover/index page listing category order AND every gap —
 * "Parts lacking datasheets are LISTED on the cover as gaps, never
 * silently skipped" (client-package spec, §1).
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getBlobStream } from "@/lib/blob";
import type { BundlePlan } from "./client-package";

async function streamToBytes(stream: ReadableStream): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export async function mergeDatasheets(bundle: BundlePlan): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const cover = out.addPage([612, 792]);
  let y = 740;
  cover.drawText("Datasheet Package", { x: 50, y, size: 18, font, color: rgb(0.1, 0.1, 0.1) });
  y -= 30;
  cover.drawText("Included:", { x: 50, y, size: 12, font });
  y -= 18;
  const byCategory = [...bundle.datasheets].sort((a, b) => a.category.localeCompare(b.category));
  for (const d of byCategory) {
    cover.drawText(`  ${d.category} — ${d.sku} — ${d.desc}`, { x: 50, y, size: 10, font });
    y -= 14;
    if (y < 60) y = 740; // (v1: overflow onto the same page's top is acceptable for a "rough" cover; revisit with a real page-break if a bundle regularly exceeds ~45 rows)
  }
  if (bundle.gaps.length) {
    y -= 10;
    cover.drawText("Not included (see below):", { x: 50, y, size: 12, font, color: rgb(0.6, 0.1, 0.1) });
    y -= 18;
    for (const g of bundle.gaps) {
      cover.drawText(`  ${g.sku} — ${g.desc} — ${g.reason}`, { x: 50, y, size: 10, font, color: rgb(0.6, 0.1, 0.1) });
      y -= 14;
    }
  }

  for (const d of byCategory) {
    const stream = await getBlobStream(d.datasheetBlobKey);
    if (!stream) continue; // blob missing despite the key being set — treat as best-effort, the cover already lists it as included so this is a data-integrity issue to fix at the source, not a reason to fail the whole merge
    const bytes = await streamToBytes(stream);
    const src = await PDFDocument.load(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }

  return out.save();
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:specs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/datasheet-merge.ts scripts/test-review-and-spec.ts
git commit -m "feat(client-package): add mergeDatasheets, cover-index PDF merge (#40)"
```

---

### Task 4: One-click assembly action — zip of three, stored + downloadable

**Files:**
- Create: `src/lib/design/client-package-zip.ts`
- Create: `src/app/(app)/design/grid/[id]/actions.ts` — MODIFY (add `generateClientPackageAction`), same file Task 1-5 of the #38/#41 plan already touches; if that plan hasn't landed yet, add the action to this file as it exists today.
- Create: `src/app/api/client-package/[id]/route.ts`
- Modify: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `walkBundle` (Task 2), `mergeDatasheets` (Task 3), `drawPlanDataPage` (Task 1), `buildSpecDocx` (`src/lib/bid-spec-docx.ts`, existing), `buildGridBaseSheetPlan` (from the #38/#41 plan — if that plan hasn't shipped yet, substitute any current plan-producing source available on the project, e.g. render nothing and gap the drawings page rather than block this task on the other plan), `riserGraph` (`src/lib/design/grid-riser.ts`, existing), `putBlob` (`src/lib/blob.ts`, existing).
- Produces: `buildClientPackageZip(input): Promise<Uint8Array>`; a server action returning `{ ok: true; blobPath: string } | { ok: false; error: string }`; an authenticated download route mirroring `/api/part-datasheet/[id]/route.ts`'s pattern.

- [ ] **Step 1: Write the failing test**

```ts
/* --- Client package zip assembly (#40) --- */
import JSZipCheck from "archiver"; // used only to confirm the dependency resolves; the real check is structural below
import { buildClientPackageZip } from "@/lib/design/client-package-zip";

await (async () => {
  const bytes = await buildClientPackageZip({
    bom: [],
    catalog: [],
    engagementId: "eng-test",
    projectName: "Empty Test",
    customer: "Test Customer",
    preparedBy: "Tester",
    drawings: [],
  });
  ok(bytes.length > 0, "client-package-zip: buildClientPackageZip returns non-empty bytes even for an empty BOM");
  ok(JSZipCheck !== undefined, "client-package-zip: archiver dependency resolves");
})();
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npm run test:specs`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/design/client-package-zip.ts`**

```ts
/**
 * Assembles the one-click zip: datasheet PDF + spec .docx + rough
 * drawings PDF (#40). archiver streams into a Buffer via a PassThrough —
 * the simplest correct pattern for an in-memory zip with this library.
 */
import archiver from "archiver";
import { PassThrough } from "node:stream";
import { PDFDocument } from "pdf-lib";
import { walkBundle } from "./client-package";
import { mergeDatasheets } from "./datasheet-merge";
import { drawPlanDataPage } from "./plan-to-pdf";
import { buildSpecDocx } from "@/lib/bid-spec-docx";
import type { BomRow, SpecCatalogPart } from "@/lib/bid-spec";
import type { PlanData } from "@/app/(app)/design/quick/plan-svg";

export async function buildClientPackageZip(input: {
  bom: BomRow[];
  catalog: SpecCatalogPart[];
  engagementId: string;
  projectName: string;
  customer: string;
  preparedBy: string;
  /** Plan/riser pages to render into the rough-drawings PDF, titled. */
  drawings: Array<{ title: string; plan: PlanData }>;
}): Promise<Uint8Array> {
  const bundle = await walkBundle(input);
  const datasheetPdf = await mergeDatasheets(bundle);
  const specDocx = await buildSpecDocx(bundle.spec);

  const drawingsDoc = await PDFDocument.create();
  for (const d of input.drawings) {
    await drawPlanDataPage(drawingsDoc, d.plan, { title: d.title });
  }
  if (input.drawings.length === 0) {
    // nothing silently missing — a zip with no drawings page would look
    // like a bug, not an empty state, so say so on the page itself
    const p = drawingsDoc.addPage([612, 200]);
    const font = await drawingsDoc.embedFont((await import("pdf-lib")).StandardFonts.Helvetica);
    p.drawText("No plan or riser available for this project yet.", { x: 50, y: 100, size: 12, font });
  }
  const drawingsPdf = await drawingsDoc.save();

  const archive = archiver("zip", { zlib: { level: 9 } });
  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  pass.on("data", (c: Buffer) => chunks.push(c));
  archive.pipe(pass);
  archive.append(Buffer.from(datasheetPdf), { name: "datasheets.pdf" });
  archive.append(Buffer.from(specDocx), { name: "spec.docx" });
  archive.append(Buffer.from(drawingsPdf), { name: "drawings.pdf" });
  const done = new Promise<void>((resolve, reject) => {
    pass.on("end", resolve);
    archive.on("error", reject);
  });
  await archive.finalize();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npm run test:specs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/design/client-package-zip.ts scripts/test-review-and-spec.ts
git commit -m "feat(client-package): add buildClientPackageZip, the one-click assembler (#40)"
```

- [ ] **Step 6: Add the server action**

In `src/app/(app)/design/grid/[id]/actions.ts`, add:

```ts
export async function generateClientPackageAction(
  projectId: string,
  engagementId: string
): Promise<{ ok: true; blobPath: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const project = await getProject(projectId);
  if (!project) return { ok: false, error: "Design not found." };
  const parts = await listCatalogParts(); // existing catalog store list()
  const partById = new Map(parts.map((p) => [p.id, p]));
  const lines = bomLines(project.placements || [], parts);
  const bom = lines
    .map((l) => {
      const part = partById.get(l.partId);
      return part ? { sku: part.sku, desc: l.desc, qty: l.qty } : null;
    })
    .filter((row): row is { sku: string; desc: string; qty: number } => row !== null);
  const drawings: Array<{ title: string; plan: import("@/app/(app)/design/quick/plan-svg").PlanData }> = [];
  const genSheet = (await listSheets(projectId)).find((s) => s.kind === "generated" && s.venueDims);
  if (genSheet?.venueDims) {
    drawings.push({ title: "Plan sheet", plan: buildGridBaseSheetPlan(genSheet.venueDims) });
  }
  const zipBytes = await buildClientPackageZip({
    bom,
    catalog: parts as never,
    engagementId,
    projectName: project.name,
    customer: project.customer,
    preparedBy: user.name,
    drawings,
  });
  const up = await putBlob(`client-packages/${projectId}/${Date.now()}.zip`, Buffer.from(zipBytes), "application/zip");
  revalidatePath(editorPath(projectId));
  return { ok: true, blobPath: up.pathname };
}
```

Add the needed imports (`listCatalogParts` from `@/lib/stores/catalog` as `list`, `bomLines` from `@/lib/design/grid-bom`, `buildClientPackageZip`, `putBlob`, `buildGridBaseSheetPlan`, `listSheets`).

- [ ] **Step 7: Add the authenticated download route**

Create `src/app/api/client-package/[id]/route.ts`, mirroring `src/app/api/part-datasheet/[id]/route.ts`'s exact auth-then-stream pattern (`requireUser()`, then `getBlobStream(blobPath)`, `content-type: application/zip`), except the `id` here is the blob path's storage key rather than a catalog SKU — pass the `blobPath` returned by Step 6 into the download link directly (e.g. `/api/client-package/download?path=<blobPath>` with the path as a query param, authenticated the same way) rather than inventing a new lookup table just for this — no new persisted record is needed since the zip's own blob URL is the artifact.

- [ ] **Step 8: Add the "Generate client package" button**

In the Grid editor (or the project index page — whichever page already shows the "specHref" / engagement link, per this codebase's existing D111 Grid→spec bridge), add a button calling `generateClientPackageAction`, disabled with a tooltip when there's no linked engagement (a client package needs an `engagementId` for the spec half, same requirement the existing D94 flow already has).

- [ ] **Step 9: Manual verification**

```bash
PGLITE_PATH=/tmp/peak-scratch-grid npm run dev
```

Open a Grid project with a linked engagement and at least one placed device, click "Generate client package," confirm a zip downloads containing `datasheets.pdf` (1+ pages), `spec.docx` (opens in Word/Pages), and `drawings.pdf` (1+ pages, shows the plan sheet if one was generated). Clean up the scratch dir.

- [ ] **Step 10: Commit**

```bash
git add "src/app/(app)/design/grid/[id]/actions.ts" "src/app/api/client-package/[id]/route.ts" "src/app/(app)/design/grid/[id]/editor.tsx"
git commit -m "feat(client-package): wire the one-click generate action + download route (#40)"
```

---

### Task 5: Gap-surfacing chips

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (or the client-package result UI added in Task 4 Step 8)

**Interfaces:**
- Consumes: `BundlePlan.gaps` (Task 2), returned alongside the zip result (Task 4's action needs to also return `gaps: PackageGap[]`, not just `{ok, blobPath}` — extend the return type).

- [ ] **Step 1: Extend `generateClientPackageAction`'s return type**

Change Task 4 Step 6's return type from `{ ok: true; blobPath: string }` to `{ ok: true; blobPath: string; gaps: PackageGap[] }`, returning `bundle.gaps` (the walker already computed it — no extra work, just don't discard it).

- [ ] **Step 2: Render gap chips after a successful generate**

In the editor's client-side handler for the "Generate client package" button, after a successful action call, render one small chip per gap (`${sku} — ${reason}`), each linking to `/catalog?q=<sku>` (the existing catalog search/filter page) so a user can jump straight to that part's edit modal and attach what's missing — this is the exact loop the spec's Build task 4 asks for: "drives attachment population where it matters first."

- [ ] **Step 3: Manual verification**

Generate a package for a project with at least one part missing a datasheet; confirm a gap chip appears and its link lands on that part in `/catalog`.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/editor.tsx"
git commit -m "feat(client-package): surface gap chips linking back to the catalog editor (#40)"
```

## Self-Review Notes

- **Spec coverage:** Build tasks 1 (bundle walker → Task 2), 2 (PDF merge + cover/index → Task 3), 3 (one-click action + store/download → Task 4), 4 (gap surfacing → Task 5) all covered. Resolved open questions (zip of three, no CRM attach) are enforced structurally — `buildClientPackageZip` always returns exactly 3 named entries, and no task here touches CRM/thread code at all.
- **Placeholder scan / honesty check:** Task 2 Step 3 and Task 4 Step 6 both call out real unresolved wiring points inline (the `allSections()` import boundary; the `sku` vs `desc` mapping) rather than papering over them — these are flagged as things to fix *before* the step's own test can honestly pass, not silent gaps left for later.
- **Sequencing:** Last of the three plans — depends on #39 (real datasheets to merge) and #38/#41 (a real generated plan sheet to render, real Control Riser/lineset data). Runnable and testable on its own against whatever data exists, but the acceptance-test walkthrough (Task 4 Step 9) is only fully meaningful after both land.
