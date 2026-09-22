# Client Package Generator Implementation Plan (PUNCHLIST #40)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One click on a Grid project or a quote walks its bill of materials and emits a client package: catalog-anchored datasheets (attached ones verbatim, missing ones as named "datasheet pending" pages), the D94 specification as `.docx`, and rough drawings (derived riser + device schedule + the plan sheets), stored per D116 and downloadable through an authenticated proxy. Every part that could not be fully documented is listed on the cover as a gap and surfaced in the app as a chip linking to the catalog editor.

**Architecture:** Two pure modules (`lib/zip.ts`, `lib/client-package.ts`) plus a generic report compositor added to the existing zero-dependency `lib/pdf.ts`; one server-side builder (`lib/client-package-build.ts`) that assembles bytes from the existing D94 engine (`matchBom` / `assemble` / `buildSpecDocx`), the D112 riser derivation and the D116 blob seam; one new doc collection (`client_packages`) with a download proxy; two thin UI entry points (Grid editor sidebar panel, Quotes selected-row card). Spec: `docs/superpowers/specs/2026-07-25-client-package-generator-design.md`. Related: `docs/superpowers/specs/2026-07-20-design-module-consolidation-design.md` (publishable package), PUNCHLIST #39/#40/#51/#52, DECISIONS D94/D94a/D111/D112/D116/D117.

**Tech Stack:** Next.js 16 App Router (server actions + route handlers), Drizzle on Postgres/PGlite (`db:generate` migrations), doc-store (`listDocs`/`getDoc`/`insertWithPrefixedId`), `docx` (already a dependency), `@vercel/blob` via `src/lib/blob.ts`, `tsx` harnesses (`test:specs` pure, `test:review:regressions` scratch DB, `test:smoke` real server).

## Decisions taken

Logged here so the executor does not re-litigate them; they become D144 in Task 8.

1. **Bundle = one `.zip`, not a merged PDF.** Merging arbitrary vendor PDFs needs a PDF parser; the app has none and adding one on the eve of the beta is avoidable risk (same reasoning as D94's shipping-day call). A zip preserves each manufacturer's datasheet byte-for-byte. The spec's own default was "zip of three".
2. **Zip writer is hand-rolled, STORE-only (`src/lib/zip.ts`).** Zero new npm dependencies, same rationale as `lib/pdf.ts` (D36/D39). Contents are PDFs and a `.docx`, already deflated. No ZIP64, no encryption.
3. **Datasheet index PDF = cover + placeholder pages.** `00-package-index.pdf` carries the ordered index, the gap list, and one "Datasheet pending" page per catalog part without a datasheet (names part, manufacturer, SKU, quantity). Nothing is silently skipped.
4. **Spec source precedence.** Newest frozen `GeneratedSpec` whose `source === "quote:<quoteId>"` wins (human-curated, waives honoured). Otherwise the builder auto-assembles from `matchBom` ready rows; `no-spec` / `no-match` rows go on the cover as spec gaps. The auto-assembled spec is **not** saved as a `GeneratedSpec`.
5. **Rough drawings v1.** `03-drawings/riser-and-schedule.pdf` (derived riser boxes + wire-run table + per-space device schedule, from `riserGraph`) plus every plan sheet file passed through verbatim (`03-drawings/plan-NN-<name>.<ext>`). The server cannot rasterise a PDF, so the painted-device overlay is **deferred** (upgrade path: client-side pdf.js canvas capture → JPEG → `jpeg` report block, which Task 2 already supports). The cover says so.
6. **Storage degrades like sheets do.** New `client_packages` docTable; `blobPath` when `BLOB_READ_WRITE_TOKEN` is set (`client-packages/<sourceId>/<file>`), else the zip is kept in-doc as a base64 data-URL with a 32 MB cap and a clear error above it. Download only via `/api/client-packages/<id>` (requireUser), mirroring `/api/vendor-quote-attachments`.
7. **Item resolution mirrors `partForGrid`:** catalog id first, then Grid symbol → `pricingPartId` / `modelNumber`. Curtain drop-ins become `CURTAIN` rows classed "custom goods". Duplicate SKUs merge (qty summed). Order: six beta groups in `GROUPS` order, then "Other", then by description.
8. **Permissions.** Building a package is `requireUser` (any team member, like `saveSpecAction`). Gap chips link to `/catalog?edit=<sku>`; attaching a datasheet there remains `manage_users`-gated (unchanged).
9. **Ids.** Packages are `PKG-####` from 1001 via `insertWithPrefixedId`. Decision entry is **D144** (D141 is reserved by the #96 Wave B plan).

## Global Constraints

- Node at `~/.local/node/bin`: `export PATH=$HOME/.local/node/bin:$PATH` first.
- **PGlite is single-process.** `test:specs` is pure. `test:review:regressions` and `test:smoke` each open their own throwaway DB — run them one at a time, never alongside `next dev` or any other `tsx` script; `ps aux | grep -E 'tsx|next dev'` must be empty first. Never run `db:*` scripts against `.data/` during this plan.
- After editing `src/db/doc-tables.ts`: `npm run db:generate`, then hand-append the `_seq_bump` trigger to the generated `drizzle/0020_*.sql` (pattern: `drizzle/0018_clever_maverick.sql` lines 42-52) and commit the `.sql` + `drizzle/meta/*`.
- Timestamps are epoch-ms. Ids: `PKG-####`, Grid projects `GRD-####`, quotes `Q-####`, generated specs `gs-…`. Keep prototype field names.
- No emoji in UI copy or documents (#3). No hardcoded accent colour in the app UI; documents use `settings.accent` like the letters do.
- **Blob must degrade gracefully** when `BLOB_READ_WRITE_TOKEN` is unset (dev): the package still builds, is stored in-doc, and downloads; attached datasheets that cannot be streamed become `storage-unavailable` gaps, never an exception.
- No new npm dependencies. Server-only modules (`lib/blob.ts`, `lib/bid-spec-docx.ts`, `lib/client-package-build.ts`, stores) are never imported by a `"use client"` component; client components import types only.
- `git add` only the files each task names. Never `git add .`.
- Spec harness helper: `ok(cond, msg)` in `scripts/test-review-and-spec.ts`; pure modules only, in the synchronous section (before `asyncChecks()`), each block headed `/* ---- #40 Task N — … ---- */`. Regression harness: `assert` from `node:assert/strict` inside `main()` in `scripts/test-review-regressions.ts`, runs against the `PGLITE_PATH` scratch DB (`tsx` does not load `.env.local`, so Blob is off there by construction).
- Expected harness output shape: every check prints `PASS …`/`FAIL …`; `test:specs` ends with `ALL PASSED`; `test:review:regressions` ends with `review regression checks passed`.

## Blocked on Jeff (data, not code)

The generator ships complete; its **output** is only as complete as the catalog behind it. None of these are stubbed: each shows up as a named gap on the cover and as a chip in the app.

- **Starter-set import (#39).** `scripts/starter-import-data.json` is staged and waiting on "import the starter set". Until then local dev has ~29 demo catalog rows and most package rows are placeholders.
- **Datasheet PDFs per part (#40(a)).** Infra exists (`datasheetBlobKey`, upload/replace/remove in the part modal, `/api/part-datasheet/<sku>`); the files are Jeff's to attach (D111: "per-part file authoring, data work not code").
- **Spec language per part (#40(b)).** Parts without `specBody` land under "Spec language pending" until Part 2 paragraphs are authored across the six beta categories.
- **ETC light-engine / lens SKUs (#52).** Estimator fixture presets do not carry catalog part ids until that list lands, so packages built from estimator quotes will show "not a catalog part" for fixtures.
- **Manufacturer symbols / accessories (D112).** Not needed by the generator; listed so nobody waits on it.
- **Open questions carried, not blocking:** attaching the package to the CRM thread/customer for send-out; whether #51's "publish" is this bundle or four generators. The bundle default is taken and is reversible.

## Deferred (code, queued — not blocked on Jeff)

- Painted plan render (device markers over the sheet) via client-side pdf.js capture → JPEG pages. Task 2's `jpeg` block is the seam.
- Blob orphan sweep when packages are regenerated (parity with datasheet/sheet removal, which never deletes storage).

---

### Task 1: Zero-dependency zip writer

**Files:**
- Create: `src/lib/zip.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces (pure): `crc32(buf: Buffer): number`, `type ZipEntry = { name: string; bytes: Buffer }`, `buildZip(entries: ZipEntry[], mtimeMs?: number): Buffer` (STORE method, UTF-8 names, one central directory, EOCD).

- [ ] **Step 1: Failing spec tests** (synchronous section; add `import { buildZip, crc32 } from "@/lib/zip";` near the `renderLetterPdf` import)

```ts
/* ---- #40 Task 1 — zip writer ---- */
ok(crc32(Buffer.from("123456789")) === 0xcbf43926, "#40 crc32 matches the standard check value");
{
  const z = buildZip(
    [{ name: "a/one.txt", bytes: Buffer.from("hello") }, { name: "two.bin", bytes: Buffer.alloc(3) }],
    Date.UTC(2026, 8, 21, 12)
  );
  ok(z.readUInt32LE(0) === 0x04034b50, "#40 zip starts with a local file header");
  ok(z.length === 214, `#40 zip length is exact for STORE (${z.length})`);
  const eocd = z.length - 22;
  ok(z.readUInt32LE(eocd) === 0x06054b50 && z.readUInt16LE(eocd + 10) === 2, "#40 end record counts two entries");
  ok(z.readUInt32LE(eocd + 16) === 84, "#40 central directory offset follows the local entries");
  ok(z.readUInt32LE(14) === crc32(Buffer.from("hello")), "#40 local header carries the entry crc");
  ok(z.subarray(30, 39).toString("utf8") === "a/one.txt", "#40 entry names are stored verbatim");
  ok(buildZip([]).length === 22, "#40 an empty zip is just the end record");
}
```
(214 = local 30+9+5 + 30+7+3, central 46+9 + 46+7, EOCD 22; 84 = the two local records.)

- [ ] **Step 2: Run** `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -3` → import error for `@/lib/zip`.

- [ ] **Step 3: Implement** `src/lib/zip.ts`

```ts
/**
 * Zero-dependency ZIP writer (PUNCHLIST #40) — STORE only, same rationale as
 * lib/pdf.ts (D36/D39): no native toolchain on the build machine and a tiny
 * dependency surface. The client package holds PDFs and a .docx, which are
 * already deflated, so compressing again costs CPU for nothing. Not a
 * general library: no ZIP64 (>4 GB), no encryption, no streaming.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipEntry = { name: string; bytes: Buffer };

/** MS-DOS date/time pair from epoch ms (2-second resolution, local time). */
function dosDateTime(ms: number): { date: number; time: number } {
  const d = new Date(ms);
  const year = Math.max(1980, d.getFullYear());
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { date, time };
}

/** Build a complete .zip. Entry names use forward slashes; folders are
 *  implied by the names (no explicit directory records). */
export function buildZip(entries: ZipEntry[], mtimeMs = Date.now()): Buffer {
  const { date, time } = dosDateTime(mtimeMs);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name.replace(/\\/g, "/"), "utf8");
    const crc = crc32(e.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(0, 8); // method: STORE
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.bytes.length, 18);
    local.writeUInt32LE(e.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.bytes.length, 20);
    central.writeUInt32LE(e.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, e.bytes);
    centrals.push(central, name);
    offset += local.length + name.length + e.bytes.length;
  }
  const cdSize = centrals.reduce((a, b) => a + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, ...centrals, eocd]);
}
```

- [ ] **Step 4: Verify** `npx tsx scripts/test-review-and-spec.ts | grep -E '#40|ALL PASSED'` → 8 PASS + `ALL PASSED`; `npx tsc --noEmit -p . | tail -3` → empty. Manual sanity: `node -e 'require("tsx/cjs"); const {buildZip}=require("./src/lib/zip.ts"); process.stdout.write(buildZip([{name:"x.txt",bytes:Buffer.from("hi")}]))' > "$TMPDIR/t.zip" && unzip -l "$TMPDIR/t.zip"` → lists `x.txt` (2 bytes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/zip.ts scripts/test-review-and-spec.ts
git commit -m "feat(package): zero-dependency STORE zip writer (#40 Task 1)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Generic report compositor in `lib/pdf.ts`

**Files:**
- Modify: `src/lib/pdf.ts` (class `Pdf` footer support; append `renderReportPdf`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces (pure):
```ts
export type ReportBlock =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string; muted?: boolean }
  | { kind: "bullets"; items: string[] }
  | { kind: "table"; widths: number[]; header: string[]; rows: string[][] }
  | { kind: "boxes"; nodes: Array<{ title: string; lines: string[] }> }
  | { kind: "jpeg"; bytes: Buffer; caption?: string }
  | { kind: "pagebreak" };
export type ReportDoc = { companyName: string; accent: string; tag: string; title: string; subtitle: string; footer: string; blocks: ReportBlock[] };
export function renderReportPdf(doc: ReportDoc): Buffer;
```

- [ ] **Step 1: Failing spec tests** (synchronous section; extend the existing import to `import { renderLetterPdf, renderReportPdf } from "@/lib/pdf";`)

```ts
/* ---- #40 Task 2 — report compositor ---- */
{
  const rep = renderReportPdf({
    companyName: "Peak", accent: "#b08d4a", tag: "Client package", title: "Test PAC",
    subtitle: "GRD-5001 · generated for the harness", footer: "Peak · Client package",
    blocks: [
      { kind: "h1", text: "Datasheets" },
      { kind: "table", widths: [0.3, 0.5, 0.2], header: ["SKU", "Description", "Qty"], rows: [["S4LED", "Source Four LED", "12"]] },
      { kind: "pagebreak" },
      { kind: "h1", text: "Datasheet pending" },
      { kind: "p", text: "ETC Source Four LED — datasheet pending." },
      { kind: "boxes", nodes: [{ title: "Stage", lines: ["12 × Source Four LED"] }, { title: "FOH / control", lines: [] }] },
    ],
  });
  const txt = rep.toString("latin1");
  ok(rep.subarray(0, 8).toString("latin1") === "%PDF-1.4", "#40 report renders PDF bytes");
  ok((txt.match(/\/Type \/Page \/Parent/g) || []).length === 2, "#40 pagebreak yields exactly two pages");
  ok(txt.includes("/Count 2"), "#40 page tree count matches");
  ok(renderReportPdf({ companyName: "Peak", accent: "#b08d4a", tag: "t", title: "t", subtitle: "", footer: "", blocks: [] }).length > 300, "#40 an empty report is still a one-page document");
}
```

- [ ] **Step 2: Run** → `renderReportPdf` is not exported.

- [ ] **Step 3: Footer support in class `Pdf`.** After `y = PAGE_H - MARGIN_T;` (line 223) add:

```ts
  /** Printed at the foot of every page, with the page index (report mode). */
  footer: string | null = null;
```
Replace the start of `private flushPage()` (line 353) with:

```ts
  private flushPage(): void {
    if (!this.ops.length) return;
    if (this.footer) {
      const t = winAnsi(`${this.footer} · Page ${this.pageIds.length + 1}`);
      this.ops.push(
        `BT /F1 8 Tf ${rgb(LABEL_INK)} rg 1 0 0 1 ${MARGIN_L} 40 Tm (${esc(t)}) Tj ET`
      );
    }
```
(the rest of the method is unchanged).

- [ ] **Step 4: Append the compositor** at the end of `src/lib/pdf.ts`:

```ts
/* ---------------- generic report compositor (#40 client package) ---------- */

export type ReportBlock =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string; muted?: boolean }
  | { kind: "bullets"; items: string[] }
  /** Column widths are fractions of the content width (sum <= 1); cells are
   *  single-line and truncated with an ellipsis to fit their column. */
  | { kind: "table"; widths: number[]; header: string[]; rows: string[][] }
  /** Riser sketch: one box per node (title + lines), three boxes per row. */
  | { kind: "boxes"; nodes: Array<{ title: string; lines: string[] }> }
  /** A JPEG scaled to the content width (DCTDecode pass-through, like the
   *  letterhead). The seam for painted-plan captures later. */
  | { kind: "jpeg"; bytes: Buffer; caption?: string }
  | { kind: "pagebreak" };

export type ReportDoc = {
  companyName: string;
  accent: string;
  /** Right-aligned tag under the letterhead rule, e.g. "Client package". */
  tag: string;
  title: string;
  subtitle: string;
  /** Printed at the foot of every page with the page index ("" = none). */
  footer: string;
  blocks: ReportBlock[];
};

function truncate(s: string, size: number, bold: boolean, maxW: number): string {
  if (measure(s, size, bold) <= maxW) return s;
  const ell = "\x85"; // … in WinAnsi
  let cut = s;
  while (cut.length && measure(cut + ell, size, bold) > maxW) cut = cut.slice(0, -1);
  return cut + ell;
}

function textAt(pdf: Pdf, text: string, x: number, y: number, size: number, bold: boolean, color: string): void {
  pdf.op(
    `BT /${bold ? "F2" : "F1"} ${size} Tf ${rgb(color)} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${esc(text)}) Tj ET`
  );
}

/** Render a multi-page report (cover/index pages, placeholder pages, the
 *  riser + schedule) to PDF bytes. Same page geometry and fonts as the
 *  letters; blocks flow with automatic page breaks. */
export function renderReportPdf(doc: ReportDoc): Buffer {
  const pdf = initPdf();
  pdf.footer = doc.footer || null;

  pdf.space(6);
  pdf.line(doc.companyName, { size: 18, bold: true, leading: 22 });
  pdf.space(6);
  pdf.hairline(pdf.y, "#16181d", 1.4);
  pdf.space(7);
  const tag = winAnsi(doc.tag.toUpperCase());
  pdf.y -= 9;
  textAt(pdf, tag, PAGE_W - MARGIN_R - measure(tag, 9, true), pdf.y, 9, true, doc.accent);
  pdf.space(16);
  pdf.line(doc.title, { size: 16, bold: true, leading: 22 });
  if (doc.subtitle) pdf.para(doc.subtitle, { size: 10, color: SOFT_INK, after: 6 });
  pdf.space(8);

  for (const b of doc.blocks) {
    if (b.kind === "pagebreak") {
      pdf.newPage();
    } else if (b.kind === "h1") {
      pdf.ensure(40);
      pdf.space(8);
      pdf.line(b.text, { size: 13, bold: true, leading: 20 });
      pdf.hairline(pdf.y - 3, "#e4e7ec", 0.7);
      pdf.space(6);
    } else if (b.kind === "h2") {
      pdf.ensure(30);
      pdf.space(4);
      pdf.line(b.text.toUpperCase(), { size: 9, bold: true, color: LABEL_INK, leading: 16 });
      pdf.space(2);
    } else if (b.kind === "p") {
      pdf.para(b.text, { size: b.muted ? 9.5 : 10.5, color: b.muted ? SOFT_INK : INK, after: 6 });
    } else if (b.kind === "bullets") {
      for (const it of b.items) pdf.para("•  " + it, { size: 10.5, after: 1 });
      pdf.space(6);
    } else if (b.kind === "table") {
      const size = 9.5;
      const xs: number[] = [];
      let x = MARGIN_L;
      for (const w of b.widths) {
        xs.push(x);
        x += w * CONTENT_W;
      }
      const row = (cells: string[], bold: boolean) => {
        pdf.ensure(14);
        pdf.y -= 13;
        cells.forEach((c, i) => {
          const maxW = (b.widths[i] || 0) * CONTENT_W - 6;
          textAt(pdf, truncate(winAnsi(c), size, bold, maxW), xs[i] ?? MARGIN_L, pdf.y, size, bold, bold ? LABEL_INK : INK);
        });
      };
      row(b.header, true);
      pdf.hairline(pdf.y - 3, "#e4e7ec", 0.7);
      for (const r of b.rows) row(r, false);
      pdf.space(8);
    } else if (b.kind === "boxes") {
      const perRow = 3;
      const gap = 10;
      const boxW = (CONTENT_W - gap * (perRow - 1)) / perRow;
      const lineH = 12;
      for (let i = 0; i < b.nodes.length; i += perRow) {
        const rowNodes = b.nodes.slice(i, i + perRow);
        const maxLines = Math.max(1, ...rowNodes.map((n) => n.lines.length));
        const boxH = 22 + maxLines * lineH + 8;
        pdf.ensure(boxH + 10);
        const top = pdf.y;
        rowNodes.forEach((n, j) => {
          const x = MARGIN_L + j * (boxW + gap);
          pdf.rect(x, top - boxH, boxW, boxH, "#f6f7f9");
          pdf.rect(x, top - 1, boxW, 1, "#16181d");
          pdf.rect(x, top - boxH, boxW, 1, "#16181d");
          pdf.rect(x, top - boxH, 1, boxH, "#16181d");
          pdf.rect(x + boxW - 1, top - boxH, 1, boxH, "#16181d");
          let y = top - 15;
          textAt(pdf, truncate(winAnsi(n.title), 9.5, true, boxW - 14), x + 7, y, 9.5, true, INK);
          for (const l of n.lines) {
            y -= lineH;
            textAt(pdf, truncate(winAnsi(l), 8.5, false, boxW - 14), x + 7, y, 8.5, false, SOFT_INK);
          }
        });
        pdf.y = top - boxH - 10;
      }
      pdf.space(4);
    } else if (b.kind === "jpeg") {
      const info = jpegInfo(b.bytes);
      if (info && info.w > 0 && info.h > 0) {
        const name = pdf.addJpeg(b.bytes, info);
        let w = CONTENT_W;
        let h = (w * info.h) / info.w;
        const maxH = PAGE_H - MARGIN_T - MARGIN_B - 30;
        if (h > maxH) {
          h = maxH;
          w = (h * info.w) / info.h;
        }
        pdf.ensure(h + 16);
        pdf.image(name, MARGIN_L, w, h);
        if (b.caption) pdf.line(b.caption, { size: 8.5, color: LABEL_INK, leading: 14 });
        pdf.space(6);
      } else {
        pdf.para(b.caption ? `${b.caption} (image could not be embedded)` : "(image could not be embedded)", { size: 9.5, color: SOFT_INK, after: 6 });
      }
    }
  }
  return pdf.build();
}
```

- [ ] **Step 5: Verify** `npx tsx scripts/test-review-and-spec.ts | grep -E '#40|ALL PASSED'` → 12 PASS + `ALL PASSED` (the field-sheet `renders to PDF bytes` checks still pass — the letter paths are untouched); tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pdf.ts scripts/test-review-and-spec.ts
git commit -m "feat(pdf): generic report compositor with tables, boxes, jpeg pages and page footers (#40 Task 2)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Pure package walker

**Files:**
- Create: `src/lib/client-package.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Produces (pure):
```ts
export const CUSTOM_SKU = "CURTAIN";
export const OTHER_GROUP = "Other";
export type GapReason = "no-datasheet" | "not-in-catalog" | "custom-goods" | "no-spec" | "storage-unavailable";
export const GAP_LABEL: Record<GapReason, string>;
export type PackageItem = { sku: string; desc: string; qty: number; unit: string; group: string; mfr: string };
export type DatasheetEntry = PackageItem & { blobKey: string; fileName: string };
export type PackageGap = PackageItem & { reason: GapReason };
export type PackageWalk = { items: PackageItem[]; datasheets: DatasheetEntry[]; gaps: PackageGap[]; specGaps: PackageGap[]; specRows: MatchedRow[] };
export function fileSafe(s: string): string;
export function packageSlug(name: string): string;
export function bomRowsFromQuoteSpec(spec: unknown): BomRow[];
export function bomRowsFromGrid(project, parts: PartLite[], fabricNames: ReadonlyMap<string, string>): BomRow[];
export function walkPackage(rows: BomRow[], catalog: SpecCatalogPart[], map: CategoryMap): PackageWalk;
```

- [ ] **Step 1: Failing spec tests** (synchronous section; add `import { bomRowsFromGrid, bomRowsFromQuoteSpec, walkPackage } from "@/lib/client-package";` and `import { resolveCategoryMap } from "@/lib/catalog-taxonomy";` if not already imported)

```ts
/* ---- #40 Task 3 — package walker ---- */
{
  const map = resolveCategoryMap();
  const cat = [
    { id: "S4LED", sku: "S4LED", desc: "ETC Source Four LED Series 2", category: "Fixtures", unit: "ea", list: 1200, cost: 800, mfr: "ETC", datasheetBlobKey: "part-datasheets/S4LED/s4.pdf", datasheetName: "s4.pdf", specSectionId: "ss-light", specBody: "Provide LED ellipsoidal." },
    { id: "ION", sku: "ION", desc: "ETC Ion Xe console", category: "Lighting Controls", unit: "ea", list: 9000, cost: 7000, mfr: "ETC" },
    { id: "WIRE-DMX", sku: "WIRE-DMX", desc: "DMX cable", category: "Wire", unit: "ft", list: 1, cost: 0.5 },
  ] as any[];
  const w = walkPackage(
    [
      { sku: "S4LED", desc: "Source Four LED", qty: 6 },
      { sku: "S4LED", desc: "Source Four LED", qty: 6 },
      { sku: "ION", desc: "Ion", qty: 1 },
      { sku: "WIRE-DMX", desc: "DMX", qty: 120 },
      { sku: "NOPE-1", desc: "Mystery bracket", qty: 2 },
      { sku: "CURTAIN", desc: "Main (Draw) · 40×20 ft · flat · velour", qty: 1 },
    ],
    cat,
    map
  );
  ok(w.items.length === 5 && w.items.find((i) => i.sku === "S4LED")?.qty === 12, "#40 walker merges duplicate SKUs and sums qty");
  ok(w.items.map((i) => i.group).join("|") === "Lighting Controls|Fixtures|Other|Other|Other", "#40 items order by beta group, then Other");
  ok(w.datasheets.length === 1 && w.datasheets[0].fileName === "01-S4LED.pdf", "#40 one attached datasheet with a numbered file name");
  ok(
    w.gaps.map((g) => `${g.sku}:${g.reason}`).sort().join(",") === "CURTAIN:custom-goods,ION:no-datasheet,NOPE-1:not-in-catalog,WIRE-DMX:no-datasheet",
    "#40 every part without a datasheet is a named gap"
  );
  ok(
    w.specGaps.map((g) => `${g.sku}:${g.reason}`).sort().join(",") === "ION:no-spec,NOPE-1:not-in-catalog,WIRE-DMX:no-spec",
    "#40 spec gaps mirror the match report"
  );
  ok(w.specRows.filter((r) => r.bucket === "ready").length === 1, "#40 only rows with spec language feed the assembled spec");

  const qrows = bomRowsFromQuoteSpec({ sections: [{ items: [{ sku: "A", desc: "a", qty: 1 }, { sku: "B", desc: "b", qty: 2, option: true }] }], lines: [{ sku: "C", desc: "c", qty: 3 }] });
  ok(qrows.map((r) => r.sku).join(",") === "A,C", "#40 quote rows skip optional-scope lines and read both spec shapes");

  const parts = [
    { id: "S4LED", sku: "S4LED", desc: "ETC Source Four LED Series 2", category: "Fixtures", unit: "ea", list: 1200, cost: 800 },
    { id: "WIRE-DMX", sku: "WIRE-DMX", desc: "DMX cable", category: "Wire", unit: "ft", list: 1, cost: 0.5 },
  ];
  const grows = bomRowsFromGrid(
    {
      placements: [
        { partId: "S4LED" }, { partId: "S4LED" },
        { partId: "RB-MV-MN", curtain: { type: "Draw", name: "Main", widthFt: 40, heightFt: 20, fullnessPct: 0, fabricSku: "RB-MV-MN" } },
      ],
      routes: [{ id: "wr-1", sheetId: "gs-1", page: 1, points: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }], aspect: 0.75, partId: "WIRE-DMX" }],
      calibrations: [{ docId: "gs-1", page: 1, scale: 100, unit: "ft", refLength: 100, by: "t", at: 0 }],
    },
    parts,
    new Map([["RB-MV-MN", "25 oz Memorable Velour"]])
  );
  ok(grows.map((r) => `${r.sku}:${r.qty}`).join(",") === "S4LED:2,CURTAIN:1,WIRE-DMX:50", "#40 grid rows: devices counted, curtain as custom goods, wire in measured feet");
  ok(grows[1].desc.includes("Memorable Velour"), "#40 curtain row carries the human description");
}
```

- [ ] **Step 2: Run** → import error for `@/lib/client-package`.

- [ ] **Step 3: Implement** `src/lib/client-package.ts`

```ts
import type { Calibration } from "@/lib/annotations";
import { matchBom, type BomRow, type MatchedRow, type SpecCatalogPart } from "@/lib/bid-spec";
import { GROUPS, groupOf, type CategoryMap } from "@/lib/catalog-taxonomy";
import { curtainDesc, routeLines, type GridCurtain, type PartLite, type RouteLite } from "@/lib/design/grid-bom";

/* ------------------------------------------------------------------ *
 * Client package walker (PUNCHLIST #40). Pure and dependency-free like
 * grid-bom: an item set in, a manifest out — which datasheets to fetch,
 * which parts are gaps and why, and the D94 match rows the spec is
 * assembled from. The server builder (client-package-build.ts) does the
 * I/O. Nothing is dropped: every BOM row lands in `items`, and every row
 * that cannot be fully documented lands in a gap list with a reason.
 * ------------------------------------------------------------------ */

/** Curtain drop-ins mint this SKU on quotes (grid/[id]/actions.ts) — they
 *  are made-to-order goods, not stocked parts. */
export const CUSTOM_SKU = "CURTAIN";
export const OTHER_GROUP = "Other";

export type GapReason = "no-datasheet" | "not-in-catalog" | "custom-goods" | "no-spec" | "storage-unavailable";

export const GAP_LABEL: Record<GapReason, string> = {
  "no-datasheet": "Datasheet pending — the catalog part has no datasheet attached",
  "not-in-catalog": "Not a catalog part — no datasheet or spec language until it is",
  "custom-goods": "Custom goods — made to order, no manufacturer datasheet",
  "no-spec": "Spec language pending — the catalog part has no Part 2 paragraph",
  "storage-unavailable": "Datasheet attached, but file storage is unavailable on this deployment",
};

export type PackageItem = { sku: string; desc: string; qty: number; unit: string; group: string; mfr: string };
export type DatasheetEntry = PackageItem & { blobKey: string; fileName: string };
export type PackageGap = PackageItem & { reason: GapReason };

export type PackageWalk = {
  items: PackageItem[];
  datasheets: DatasheetEntry[];
  /** Datasheet gaps (one per item that has no datasheet file to include). */
  gaps: PackageGap[];
  /** Spec gaps (rows the D94 matcher could not turn into Part 2 text). */
  specGaps: PackageGap[];
  specRows: MatchedRow[];
};

/** Safe file/path segment (mirrors lib/blob safeName, which is server-only). */
export function fileSafe(s: string): string {
  return (
    String(s || "")
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "file"
  );
}

export function packageSlug(name: string): string {
  return (
    String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "design"
  );
}

/** Equipment list from a quote's spec subdoc — the estimator's nested
 *  sections (optional-scope lines excluded) or the flat `lines[]` The
 *  Grid mints (D111). Same rules as bomFromQuoteAction. */
export function bomRowsFromQuoteSpec(spec: unknown): BomRow[] {
  const s = (spec || {}) as {
    sections?: Array<{ items?: Array<{ sku?: string; desc?: string; qty?: number; option?: boolean }> }>;
    lines?: Array<{ sku?: string; desc?: string; qty?: number }>;
  };
  const rows: BomRow[] = [];
  const push = (sku: unknown, desc: unknown, qty: unknown) => {
    const k = String(sku || "").trim();
    const d = String(desc || "").trim();
    if (!k && !d) return;
    rows.push({ sku: k, desc: d, qty: Number(qty) || 0 });
  };
  for (const sec of s.sections || []) for (const it of sec.items || []) if (!it.option) push(it.sku, it.desc, it.qty);
  for (const it of s.lines || []) push(it.sku, it.desc, it.qty);
  return rows;
}

/** Equipment list straight from a Grid project: device placements counted
 *  per part, curtain drop-ins as custom goods, measured wire runs in feet
 *  (unmeasured runs are still listed, at qty 0, never dropped). `parts`
 *  must already be resolved to catalog SKUs (builder: catalog id first,
 *  then symbol → pricingPartId, the partForGrid rule). */
export function bomRowsFromGrid(
  project: {
    placements: Array<{ partId: string; curtain?: GridCurtain | null }>;
    routes: RouteLite[];
    calibrations: Calibration[];
  },
  parts: PartLite[],
  fabricNames: ReadonlyMap<string, string>
): BomRow[] {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const rows: BomRow[] = [];
  const counts = new Map<string, number>();
  for (const pl of project.placements) {
    if (pl.curtain) continue;
    counts.set(pl.partId, (counts.get(pl.partId) || 0) + 1);
  }
  for (const [partId, qty] of counts) {
    const p = byId.get(partId);
    rows.push({ sku: p?.sku || partId, desc: p?.desc || partId, qty });
  }
  for (const pl of project.placements) {
    if (!pl.curtain) continue;
    rows.push({ sku: CUSTOM_SKU, desc: curtainDesc(pl.curtain, fabricNames.get(pl.curtain.fabricSku)), qty: 1 });
  }
  const wires = routeLines(project.routes, parts, project.calibrations);
  for (const l of wires.lines) {
    const p = byId.get(l.partId);
    rows.push({ sku: p?.sku || l.partId, desc: l.desc, qty: l.qty });
  }
  if (wires.unmeasured > 0) {
    const seen = new Set(wires.lines.map((l) => l.partId));
    for (const r of project.routes) {
      if (seen.has(r.partId)) continue;
      seen.add(r.partId);
      const p = byId.get(r.partId);
      rows.push({ sku: p?.sku || r.partId, desc: `${p?.desc || r.partId} (unmeasured — page not calibrated)`, qty: 0 });
    }
  }
  return rows;
}

function groupRank(group: string): number {
  const i = (GROUPS as readonly string[]).indexOf(group);
  return i < 0 ? GROUPS.length : i;
}

function byGroupThenDesc(a: PackageItem, b: PackageItem): number {
  return groupRank(a.group) - groupRank(b.group) || a.desc.localeCompare(b.desc) || a.sku.localeCompare(b.sku);
}

/** Merge rows that share a SKU (estimator sections repeat parts); custom
 *  goods are never merged — two curtains are two different goods. */
function mergeRows(rows: BomRow[]): BomRow[] {
  const out: BomRow[] = [];
  const idx = new Map<string, number>();
  for (const r of rows) {
    const key = r.sku.trim().toLowerCase();
    if (!key || key === CUSTOM_SKU.toLowerCase()) {
      out.push({ ...r });
      continue;
    }
    const at = idx.get(key);
    if (at === undefined) {
      idx.set(key, out.length);
      out.push({ ...r });
    } else out[at].qty += r.qty;
  }
  return out;
}

export function walkPackage(rows: BomRow[], catalog: SpecCatalogPart[], map: CategoryMap): PackageWalk {
  const rep = matchBom(mergeRows(rows), catalog);
  const items: PackageItem[] = [];
  const datasheets: DatasheetEntry[] = [];
  const gaps: PackageGap[] = [];
  const specGaps: PackageGap[] = [];

  for (const r of rep.rows) {
    const part = r.part;
    const item: PackageItem = {
      sku: r.row.sku,
      desc: part?.desc || r.row.desc,
      qty: r.row.qty,
      unit: part?.unit || "ea",
      group: part ? groupOf(part, map) || OTHER_GROUP : OTHER_GROUP,
      mfr: part?.mfr || "",
    };
    items.push(item);
    if (r.row.sku === CUSTOM_SKU) {
      gaps.push({ ...item, reason: "custom-goods" });
      continue;
    }
    if (!part) {
      gaps.push({ ...item, reason: "not-in-catalog" });
      specGaps.push({ ...item, reason: "not-in-catalog" });
      continue;
    }
    if (part.datasheetBlobKey) datasheets.push({ ...item, blobKey: part.datasheetBlobKey, fileName: "" });
    else gaps.push({ ...item, reason: "no-datasheet" });
    if (r.bucket === "no-spec") specGaps.push({ ...item, reason: "no-spec" });
  }

  items.sort(byGroupThenDesc);
  datasheets.sort(byGroupThenDesc);
  gaps.sort(byGroupThenDesc);
  specGaps.sort(byGroupThenDesc);
  datasheets.forEach((d, i) => {
    d.fileName = `${String(i + 1).padStart(2, "0")}-${fileSafe(d.sku)}.pdf`;
  });
  return { items, datasheets, gaps, specGaps, specRows: rep.rows };
}
```

- [ ] **Step 4: Verify** `npx tsx scripts/test-review-and-spec.ts | grep -E '#40|ALL PASSED'` → 21 PASS + `ALL PASSED`; tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-package.ts scripts/test-review-and-spec.ts
git commit -m "feat(package): pure BOM walker — datasheets, named gaps, spec rows, group ordering (#40 Task 3)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `client_packages` collection, store, migration, download proxy

**Files:**
- Modify: `src/db/doc-tables.ts` (new docTable + `DOC_TABLES` entry)
- Create: `drizzle/0020_*.sql` (generated, then trigger appended) + `drizzle/meta/*`
- Create: `src/lib/stores/client-packages.ts`
- Create: `src/app/api/client-packages/[id]/route.ts`
- Test: `scripts/test-review-regressions.ts`

**Interfaces:**
- Produces (store):
```ts
export type PackageSource = { kind: "grid" | "quote"; id: string };
export type PackageManifest = { itemCount: number; datasheets: Array<{ sku; desc; qty; group; fileName }>; gaps: PackageGap[]; specGaps: PackageGap[]; specSource: string; drawings: string[] };
export type ClientPackage = { id: string; source: PackageSource; gridProjectId: string | null; quoteId: string | null; customerId: string | null; customer: string; name: string; fileName: string; bytes: number; blobPath?: string; dataUrl?: string; manifest: PackageManifest; createdAt: number; createdBy: string };
export type ClientPackageSummary = Omit<ClientPackage, "dataUrl">;
export async function getPackage(id: string): Promise<ClientPackage | null>;
export async function packagesFor(ref: { gridProjectId?: string | null; quoteId?: string | null }): Promise<ClientPackageSummary[]>; // newest first, matches either id
export async function insertPackage(input: Omit<ClientPackage, "id">): Promise<ClientPackage>; // PKG-#### from 1001
```

- [ ] **Step 1: Failing regression test** — append inside `main()` in `scripts/test-review-regressions.ts` (before the final `console.log`):

```ts
  // #40 Task 4 — client_packages store round trip
  {
    const { getPackage, insertPackage, packagesFor } = await import("@/lib/stores/client-packages");
    const manifest = { itemCount: 0, datasheets: [], gaps: [], specGaps: [], specSource: "none", drawings: [] };
    const a = await insertPackage({
      source: { kind: "grid", id: "GRD-t40" }, gridProjectId: "GRD-t40", quoteId: "Q-t40", customerId: "billing-company", customer: "Billing company",
      name: "Store regression", fileName: "GRD-t40-store-regression-client-package.zip", bytes: 22,
      dataUrl: "data:application/zip;base64,UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==", manifest, createdAt: 1000, createdBy: "Tester",
    });
    assert.match(a.id, /^PKG-\d{4}$/, "#40 package ids are PKG-####");
    const byGrid = await packagesFor({ gridProjectId: "GRD-t40" });
    const byQuote = await packagesFor({ quoteId: "Q-t40" });
    assert.equal(byGrid.length, 1, "#40 packagesFor finds by grid project");
    assert.equal(byQuote.length, 1, "#40 packagesFor finds by quote");
    assert.equal((byGrid[0] as { dataUrl?: string }).dataUrl, undefined, "#40 summaries never carry the zip bytes");
    assert.ok((await getPackage(a.id))?.dataUrl?.startsWith("data:application/zip"), "#40 getPackage returns the bytes for the proxy");
    assert.equal(await getPackage("PKG-0000"), null, "#40 unknown package is null");
  }
```

- [ ] **Step 2: Run** `TEST_DB=$(mktemp -d) && PGLITE_PATH="$TEST_DB" npx tsx scripts/test-review-regressions.ts 2>&1 | tail -3` → module not found.

- [ ] **Step 3: doc-tables.ts** — after the `equipmentBookings` line add:

```ts
export const clientPackages = docTable("client_packages"); // #40 — generated client packages: manifest + Blob pathname (zip bytes in-doc only when Blob is off, D116 degradation)
```
and in `DOC_TABLES` after `equipment_bookings: equipmentBookings,` add `client_packages: clientPackages,`. (`DEMO_COLLECTIONS` derives from `DOC_TABLES`, so the go-live reset check in `test:specs` stays green with no edit.)

- [ ] **Step 4: Migration.** `npm run db:generate` → `drizzle/0020_<name>.sql`. Open it: exactly one `CREATE TABLE "client_packages"` plus its two indexes. Append, following `0018_clever_maverick.sql` lines 42-52:

```sql
--> statement-breakpoint
-- Hand-added, per the NOTE in 0012_seq_bump_trigger.sql: drizzle-kit does not
-- know about bump_doc_seq(), so every new docTable() gets its trigger here.
CREATE TRIGGER client_packages_seq_bump BEFORE UPDATE ON "client_packages" FOR EACH ROW EXECUTE FUNCTION bump_doc_seq();
```

- [ ] **Step 5: Store** `src/lib/stores/client-packages.ts`

```ts
import { getDoc, insertWithPrefixedId, listDocs } from "@/db/doc-store";
import type { DatasheetEntry, PackageGap } from "@/lib/client-package";

/**
 * Client packages (PUNCHLIST #40) — one record per generation, frozen like
 * a GeneratedSpec: regenerating writes a new record so what went to a
 * customer stays retrievable. The zip's bytes live in Vercel Blob
 * (`blobPath`, D116); only when Blob is not configured (dev) do they sit
 * in-doc as `dataUrl`, which is why list reads strip that field.
 */

export type PackageSource = { kind: "grid" | "quote"; id: string };

export type PackageManifest = {
  itemCount: number;
  datasheets: Array<Pick<DatasheetEntry, "sku" | "desc" | "qty" | "group" | "fileName">>;
  gaps: PackageGap[];
  specGaps: PackageGap[];
  /** "generated:<gs-id>" (frozen D94 spec reused) | "assembled" | "none". */
  specSource: string;
  /** Zip entry names under 03-drawings/, or a "(unavailable)" note. */
  drawings: string[];
};

export type ClientPackage = {
  id: string; // PKG-#### from 1001
  source: PackageSource;
  /** Both ids when known so either screen lists the package. */
  gridProjectId: string | null;
  quoteId: string | null;
  customerId: string | null;
  customer: string;
  name: string;
  fileName: string;
  bytes: number;
  blobPath?: string;
  /** Dev-only fallback when Blob is not configured (D116 degradation). */
  dataUrl?: string;
  manifest: PackageManifest;
  createdAt: number;
  createdBy: string;
};

export type ClientPackageSummary = Omit<ClientPackage, "dataUrl">;

export async function getPackage(id: string): Promise<ClientPackage | null> {
  return getDoc<ClientPackage>("client_packages", id);
}

/** Packages for a Grid project and/or a quote, newest first. */
export async function packagesFor(ref: {
  gridProjectId?: string | null;
  quoteId?: string | null;
}): Promise<ClientPackageSummary[]> {
  const all = await listDocs<ClientPackage>("client_packages");
  return all
    .filter(
      (p) =>
        (ref.gridProjectId && p.gridProjectId === ref.gridProjectId) ||
        (ref.quoteId && p.quoteId === ref.quoteId)
    )
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ dataUrl: _bytes, ...rest }) => rest);
}

export async function insertPackage(input: Omit<ClientPackage, "id">): Promise<ClientPackage> {
  return insertWithPrefixedId<ClientPackage>("client_packages", "PKG", 1000, (id) => ({ ...input, id }));
}
```

- [ ] **Step 6: Proxy** `src/app/api/client-packages/[id]/route.ts`

```ts
import { requireUser } from "@/lib/session";
import { dataUrlToBytes, getBlobStream } from "@/lib/blob";
import { getPackage } from "@/lib/stores/client-packages";

/**
 * Authenticated client-package download (#40, D116 pattern — same shape as
 * /api/vendor-quote-attachments). The Blob store is PRIVATE, so the zip is
 * streamed here behind a signed-in session; the dev-only in-doc fallback
 * is served from the same route so links never change shape.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const pkg = await getPackage(decodeURIComponent(id));
  if (!pkg) return new Response("Not found", { status: 404 });
  const headers = {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="${pkg.fileName}"`,
    "cache-control": "private, max-age=86400",
  };
  if (pkg.blobPath) {
    const stream = await getBlobStream(pkg.blobPath);
    if (!stream) return new Response("File missing from storage", { status: 404 });
    return new Response(stream, { headers });
  }
  if (pkg.dataUrl) {
    try {
      const { bytes } = dataUrlToBytes(pkg.dataUrl);
      return new Response(bytes as unknown as BodyInit, { headers });
    } catch {
      return new Response("Package is unreadable", { status: 422 });
    }
  }
  return new Response("File not found", { status: 404 });
}
```

- [ ] **Step 7: Verify** (one at a time, nothing else running): `TEST_DB=$(mktemp -d) && PGLITE_PATH="$TEST_DB" npx tsx scripts/test-review-regressions.ts 2>&1 | tail -2` → `review regression checks passed`; `npx tsx scripts/test-review-and-spec.ts | grep -E 'go-live|ALL PASSED'` → both go-live checks PASS; tsc clean.

- [ ] **Step 8: Commit**

```bash
git add src/db/doc-tables.ts drizzle/ src/lib/stores/client-packages.ts "src/app/api/client-packages/[id]/route.ts" scripts/test-review-regressions.ts
git commit -m "feat(package): client_packages collection, store and authenticated download proxy (#40 Task 4)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Server-side package builder

**Files:**
- Modify: `src/lib/stores/generated-specs.ts` (add `latestSpecForSource`)
- Create: `src/lib/client-package-build.ts`
- Test: `scripts/test-review-regressions.ts`

**Interfaces:**
- Produces (generated-specs.ts): `latestSpecForSource(source: string): Promise<GeneratedSpec | null>`.
- Produces (client-package-build.ts, server-only): `buildClientPackage(source: PackageSource, by: string): Promise<{ ok: true; pkg: ClientPackage } | { ok: false; error: string }>`.
- Zip layout: `00-package-index.pdf`, `01-datasheets/NN-<sku>.pdf`, `02-spec/<slug>-specification.docx`, `03-drawings/riser-and-schedule.pdf`, `03-drawings/plan-NN-<name>.<ext>`.

- [ ] **Step 1: Failing regression test** — append inside `main()`:

```ts
  // #40 Task 5 — builder over a Grid project with no Blob token (tsx never
  // loads .env.local, so this is the D116 degradation path by construction)
  {
    const { blobEnabled } = await import("@/lib/blob");
    assert.equal(blobEnabled(), false, "#40 regression harness runs without a Blob token");
    await upsertDoc("catalog_parts", { id: "PKG-S4", sku: "PKG-S4", desc: "Source Four LED", category: "Fixtures", unit: "ea", list: 1200, cost: 800, mfr: "ETC", specSectionId: "ss-pkg", specBody: "Provide LED ellipsoidal." });
    await upsertDoc("catalog_parts", { id: "PKG-ION", sku: "PKG-ION", desc: "Ion Xe", category: "Lighting Controls", unit: "ea", list: 9000, cost: 7000 });
    await upsertDoc("spec_sections", { id: "ss-pkg", number: "26 55 61", title: "Theatrical Lighting", sort: 40, part1: "", part3: "", updatedAt: Date.now(), updatedBy: "t" });
    const { createProject, addPlacement } = await import("@/lib/stores/grid-projects");
    const project = await createProject({ name: "Package regression PAC", customer: "Billing company", customerId: "billing-company", by: "Tester" });
    const sheetId = project.sheetIds[0];
    for (let i = 0; i < 3; i++) await addPlacement(project.id, { sheetId, page: 1, x: 0.3 + i * 0.1, y: 0.2, partId: "PKG-S4", by: "Tester" });
    await addPlacement(project.id, { sheetId, page: 1, x: 0.5, y: 0.5, partId: "PKG-ION", by: "Tester" });

    const { buildClientPackage } = await import("@/lib/client-package-build");
    const r = await buildClientPackage({ kind: "grid", id: project.id }, "Tester");
    assert.ok(r.ok, `#40 package builds: ${r.ok ? "" : r.error}`);
    if (r.ok) {
      assert.match(r.pkg.id, /^PKG-\d{4}$/, "#40 package id minted");
      assert.equal(r.pkg.blobPath, undefined, "#40 no blobPath without a token");
      assert.ok(r.pkg.dataUrl?.startsWith("data:application/zip;base64,"), "#40 without a Blob token the zip is kept in-doc");
      const zip = Buffer.from(r.pkg.dataUrl!.slice("data:application/zip;base64,".length), "base64");
      assert.equal(zip.readUInt32LE(0), 0x04034b50, "#40 stored bytes are a zip");
      const names = zip.toString("latin1");
      for (const n of ["00-package-index.pdf", "02-spec/", "03-drawings/riser-and-schedule.pdf", "03-drawings/plan-01-"])
        assert.ok(names.includes(n), `#40 zip carries ${n}`);
      assert.equal(r.pkg.manifest.itemCount, 2, "#40 two items");
      assert.deepEqual(r.pkg.manifest.gaps.map((g) => `${g.sku}:${g.reason}`).sort(), ["PKG-ION:no-datasheet", "PKG-S4:no-datasheet"], "#40 both parts are datasheet gaps (none attached)");
      assert.deepEqual(r.pkg.manifest.specGaps.map((g) => g.sku), ["PKG-ION"], "#40 the part without spec language is a spec gap");
      assert.equal(r.pkg.manifest.specSource, "assembled", "#40 spec assembled from the one ready row");
      assert.equal(r.pkg.gridProjectId, project.id, "#40 package remembers its Grid project");
    }
    const missing = await buildClientPackage({ kind: "quote", id: "Q-does-not-exist" }, "Tester");
    assert.ok(!missing.ok && /not found/i.test(missing.error), "#40 a missing quote is a clean error");
  }
```

- [ ] **Step 2: Run** → module not found for `@/lib/client-package-build`.

- [ ] **Step 3: generated-specs.ts** — append:

```ts
/** Newest frozen spec generated from a given source ("quote:Q-2043"), for
 *  the client package (#40): a human-curated spec beats an auto-assembly. */
export async function latestSpecForSource(source: string): Promise<GeneratedSpec | null> {
  const all = await listDocs<GeneratedSpec>("generated_specs");
  return all.filter((s) => s.source === source).sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}
```

- [ ] **Step 4: Builder** `src/lib/client-package-build.ts`

```ts
import { assemble, type BomRow, type SpecCatalogPart } from "@/lib/bid-spec";
import { buildSpecDocx } from "@/lib/bid-spec-docx";
import { blobEnabled, dataUrlToBytes, getBlobStream, putBlob, safeName } from "@/lib/blob";
import { resolveCategoryMap } from "@/lib/catalog-taxonomy";
import {
  GAP_LABEL,
  bomRowsFromGrid,
  bomRowsFromQuoteSpec,
  packageSlug,
  walkPackage,
  type PackageGap,
  type PackageWalk,
} from "@/lib/client-package";
import type { PartLite } from "@/lib/design/grid-bom";
import { isFabricRow } from "@/lib/design/grid-curtains";
import { riserGraph } from "@/lib/design/grid-riser";
import { renderReportPdf, type ReportBlock } from "@/lib/pdf";
import { getSettings } from "@/lib/settings";
import { list as listCatalog, type CatalogPart } from "@/lib/stores/catalog";
import { insertPackage, type ClientPackage, type PackageManifest, type PackageSource } from "@/lib/stores/client-packages";
import { latestSpecForSource } from "@/lib/stores/generated-specs";
import { listGridSymbols } from "@/lib/stores/grid-catalog";
import { getProject, listSheets, type GridProject, type GridSheet } from "@/lib/stores/grid-projects";
import { get as getQuote } from "@/lib/stores/quotes";
import { allSections } from "@/lib/stores/spec-sections";
import { buildZip, type ZipEntry } from "@/lib/zip";

/* ------------------------------------------------------------------ *
 * Client package builder (PUNCHLIST #40). Server-only: streams Blob,
 * runs the docx Packer, writes the package record. Assembles, never
 * re-derives — the D94 engine, the D112 riser derivation and the D116
 * blob seam are called as-is. The walker (client-package.ts) decides what
 * is a gap; this file only fetches bytes and lays the zip out.
 * ------------------------------------------------------------------ */

/** In-doc cap when Blob is not configured (dev). Plan sheets are <= 8 MB
 *  each and datasheets cannot be attached without Blob, so real packages
 *  stay far below this; the cap exists so a prod-DB copy in dev fails
 *  loudly instead of stuffing a huge jsonb row. */
const MAX_INDB_PACKAGE_BYTES = 32 * 1024 * 1024;

type Loaded = {
  sourceId: string;
  name: string;
  customer: string;
  customerId: string | null;
  gridProjectId: string | null;
  quoteId: string | null;
  project: GridProject | null;
  rows: BomRow[];
  catalog: CatalogPart[];
  parts: PartLite[];
};

function lite(p: CatalogPart): PartLite {
  return { id: p.id, sku: p.sku, desc: p.desc, category: p.category, unit: p.unit, list: p.list, cost: p.cost };
}

/** Catalog rows first, then Grid symbols the catalog does not know (custom
 *  assemblies) resolved to their pricing SKU — the partForGrid rule. */
async function gridParts(catalog: CatalogPart[]): Promise<PartLite[]> {
  const byId = new Map(catalog.map((p) => [p.id, p]));
  const parts = catalog.map(lite);
  for (const s of await listGridSymbols()) {
    if (byId.has(s.id)) continue;
    const priced = s.pricingPartId ? byId.get(s.pricingPartId) : undefined;
    parts.push({
      id: s.id,
      sku: priced?.sku || s.modelNumber || s.id,
      desc: s.name,
      category: priced?.category || s.category || "Other",
      unit: priced?.unit || "ea",
      list: priced?.list || 0,
      cost: priced?.cost || 0,
    });
  }
  return parts;
}

async function loadSource(source: PackageSource): Promise<Loaded | { error: string }> {
  const catalog = await listCatalog();
  if (source.kind === "grid") {
    const project = await getProject(source.id);
    if (!project) return { error: `Design ${source.id} not found.` };
    const parts = await gridParts(catalog);
    const fabricNames = new Map(catalog.filter(isFabricRow).map((p) => [p.id, p.desc] as const));
    const rows = bomRowsFromGrid(
      { placements: project.placements || [], routes: project.routes || [], calibrations: project.calibrations || [] },
      parts,
      fabricNames
    );
    if (!rows.length) return { error: "Place a device or route a wire first." };
    return {
      sourceId: project.id, name: project.name, customer: project.customer, customerId: project.customerId,
      gridProjectId: project.id, quoteId: project.quoteId, project, rows, catalog, parts,
    };
  }
  const quote = await getQuote(source.id);
  if (!quote) return { error: `Quote ${source.id} not found.` };
  const rows = bomRowsFromQuoteSpec(quote.spec);
  if (!rows.length) return { error: `Quote ${quote.id} has no equipment lines to package.` };
  const spec = (quote.spec || {}) as { gridProjectId?: string };
  const project = spec.gridProjectId ? await getProject(spec.gridProjectId) : null;
  return {
    sourceId: quote.id, name: quote.name, customer: quote.customer, customerId: quote.customerId,
    gridProjectId: project?.id || null, quoteId: quote.id, project, rows, catalog,
    parts: project ? await gridParts(catalog) : catalog.map(lite),
  };
}

async function streamToBuffer(stream: ReadableStream): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

/** Attached datasheets → zip entries. A datasheet that cannot be streamed
 *  (no token, missing blob) becomes a storage-unavailable gap — listed on
 *  the cover, never thrown, never silently absent. */
async function fetchDatasheets(walk: PackageWalk): Promise<{ files: ZipEntry[]; gaps: PackageGap[] }> {
  const files: ZipEntry[] = [];
  const gaps: PackageGap[] = [];
  for (const d of walk.datasheets) {
    const { blobKey: _k, fileName: _f, ...item } = d;
    if (!blobEnabled()) {
      gaps.push({ ...item, reason: "storage-unavailable" });
      continue;
    }
    try {
      const stream = await getBlobStream(d.blobKey);
      if (!stream) throw new Error("blob missing");
      files.push({ name: `01-datasheets/${d.fileName}`, bytes: await streamToBuffer(stream) });
    } catch (e) {
      console.error("[client-package] datasheet fetch failed:", d.sku, e);
      gaps.push({ ...item, reason: "storage-unavailable" });
    }
  }
  return { files, gaps };
}

async function specEntry(
  loaded: Loaded,
  walk: PackageWalk,
  by: string
): Promise<{ entry: ZipEntry | null; specSource: string }> {
  const name = `02-spec/${packageSlug(loaded.name)}-specification.docx`;
  const frozen = loaded.quoteId ? await latestSpecForSource(`quote:${loaded.quoteId}`) : null;
  if (frozen) return { entry: { name, bytes: await buildSpecDocx(frozen.spec) }, specSource: `generated:${frozen.id}` };
  const ready = walk.specRows.filter((r) => r.bucket === "ready");
  if (!ready.length) return { entry: null, specSource: "none" };
  const spec = assemble(ready, await allSections(), {
    projectName: loaded.name,
    customer: loaded.customer,
    engagementId: loaded.gridProjectId || loaded.quoteId || "",
    preparedBy: by,
    date: Date.now(),
  });
  return { entry: { name, bytes: await buildSpecDocx(spec) }, specSource: "assembled" };
}

function extOf(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/svg+xml") return "svg";
  return "bin";
}

async function sheetBytes(s: GridSheet): Promise<Buffer | null> {
  try {
    if (s.blobPath) {
      if (!blobEnabled()) return null;
      const stream = await getBlobStream(s.blobPath);
      return stream ? await streamToBuffer(stream) : null;
    }
    return s.dataUrl ? dataUrlToBytes(s.dataUrl).bytes : null;
  } catch (e) {
    console.error("[client-package] sheet fetch failed:", s.id, e);
    return null;
  }
}

async function drawingEntries(
  project: GridProject | null,
  parts: PartLite[],
  head: { companyName: string; accent: string; title: string; footer: string }
): Promise<{ entries: ZipEntry[]; names: string[] }> {
  if (!project) return { entries: [], names: [] };
  const skuOf = new Map(parts.map((p) => [p.id, p.sku]));
  const graph = riserGraph(project.placements || [], project.routes || [], project.spaces || [], parts, project.calibrations || []);
  const blocks: ReportBlock[] = [
    { kind: "h1", text: "Riser sketch (derived one-line)" },
    { kind: "p", muted: true, text: "Derived from the plan at generation time: spaces are nodes, wire runs are edges. Rough by design — not a stamped drawing." },
    { kind: "boxes", nodes: graph.nodes.map((n) => ({ title: n.name, lines: n.groups.map((g) => `${g.qty} × ${g.desc}`) })) },
    { kind: "h2", text: "Wire runs" },
    graph.edges.length
      ? {
          kind: "table",
          widths: [0.28, 0.28, 0.28, 0.16],
          header: ["From", "To", "Cable", "Length"],
          rows: graph.edges.map((e) => [e.fromName, e.toName, skuOf.get(e.partId) || e.partId, e.lengthFt === null ? "unmeasured" : `${Math.ceil(e.lengthFt)} ${e.unit}`]),
        }
      : { kind: "p", muted: true, text: "No wire runs routed." },
    { kind: "pagebreak" },
    { kind: "h1", text: "Device schedule by space" },
  ];
  for (const n of graph.nodes) {
    const total = n.groups.reduce((a, g) => a + g.qty, 0);
    blocks.push({ kind: "h2", text: `${n.name} — ${total} device${total === 1 ? "" : "s"}` });
    blocks.push({
      kind: "table",
      widths: [0.25, 0.6, 0.15],
      header: ["SKU", "Description", "Qty"],
      rows: n.groups.map((g) => [skuOf.get(g.partId) || g.partId, g.desc, String(g.qty)]),
    });
  }
  const entries: ZipEntry[] = [
    {
      name: "03-drawings/riser-and-schedule.pdf",
      bytes: renderReportPdf({ ...head, tag: "Rough drawings", subtitle: `${project.name} · ${project.id}`, blocks }),
    },
  ];
  const names = [entries[0].name];
  const sheets = await listSheets(project.id);
  for (const [i, s] of sheets.entries()) {
    const bytes = await sheetBytes(s);
    if (!bytes) {
      names.push(`${s.name} (unavailable on this deployment)`);
      continue;
    }
    const base = safeName(s.name).replace(/\.[a-z0-9]+$/i, "");
    const name = `03-drawings/plan-${String(i + 1).padStart(2, "0")}-${base}.${extOf(s.mime)}`;
    entries.push({ name, bytes });
    names.push(name);
  }
  return { entries, names };
}

function indexBlocks(walk: PackageWalk, gaps: PackageGap[], specSource: string, drawings: string[]): ReportBlock[] {
  const pending = gaps.filter((g) => g.reason !== "custom-goods");
  const specLine =
    specSource === "none"
      ? "Specification: none — no line on this bill of materials has spec language yet."
      : specSource === "assembled"
        ? "Specification: 02-spec/ (assembled from catalog spec language; see spec gaps below)."
        : "Specification: 02-spec/ (the saved bid specification for this quote).";
  const blocks: ReportBlock[] = [
    { kind: "h1", text: "Contents" },
    {
      kind: "bullets",
      items: [
        `Datasheets: ${walk.datasheets.length - gaps.filter((g) => g.reason === "storage-unavailable").length} attached in 01-datasheets/, ${pending.length} pending (placeholder pages follow this index).`,
        specLine,
        drawings.length
          ? `Drawings: 03-drawings/ — ${drawings.join(", ")}. Plan sheets are the uploaded backgrounds; device layout is listed in the schedule (painted-plan render is queued).`
          : "Drawings: none — this quote is not linked to a Grid design.",
      ],
    },
    { kind: "h1", text: "Datasheet index" },
    {
      kind: "table",
      widths: [0.2, 0.42, 0.2, 0.18],
      header: ["SKU", "Description", "Group", "File / status"],
      rows: walk.items.map((it) => {
        const ds = walk.datasheets.find((d) => d.sku === it.sku);
        const gap = gaps.find((g) => g.sku === it.sku && g.desc === it.desc);
        return [it.sku || "—", `${it.desc} × ${it.qty} ${it.unit}`, it.group, gap ? "PENDING" : ds ? ds.fileName : "—"];
      }),
    },
  ];
  if (gaps.length || walk.specGaps.length) {
    blocks.push({ kind: "h1", text: "Gaps — nothing was skipped silently" });
    if (gaps.length)
      blocks.push({
        kind: "table",
        widths: [0.2, 0.35, 0.45],
        header: ["SKU", "Description", "Why"],
        rows: gaps.map((g) => [g.sku || "—", g.desc, GAP_LABEL[g.reason]]),
      });
    if (walk.specGaps.length) {
      blocks.push({ kind: "h2", text: "Spec language pending" });
      blocks.push({
        kind: "table",
        widths: [0.2, 0.35, 0.45],
        header: ["SKU", "Description", "Why"],
        rows: walk.specGaps.map((g) => [g.sku || "—", g.desc, GAP_LABEL[g.reason]]),
      });
    }
  }
  for (const g of pending) {
    blocks.push({ kind: "pagebreak" });
    blocks.push({ kind: "h1", text: "Datasheet pending" });
    blocks.push({ kind: "p", text: `${g.mfr ? g.mfr + " " : ""}${g.desc}` });
    blocks.push({ kind: "p", text: `SKU ${g.sku || "—"} · quantity ${g.qty} ${g.unit}` });
    blocks.push({ kind: "p", muted: true, text: GAP_LABEL[g.reason] + ". Attach the datasheet in Catalog (edit part → Datasheet) and regenerate this package." });
  }
  return blocks;
}

export async function buildClientPackage(
  source: PackageSource,
  by: string
): Promise<{ ok: true; pkg: ClientPackage } | { ok: false; error: string }> {
  const loaded = await loadSource(source);
  if ("error" in loaded) return { ok: false, error: loaded.error };

  const settings = await getSettings();
  const walk = walkPackage(loaded.rows, loaded.catalog as SpecCatalogPart[], resolveCategoryMap(settings.catalogCategoryMap));
  const ds = await fetchDatasheets(walk);
  const gaps = [...walk.gaps, ...ds.gaps];
  const spec = await specEntry(loaded, walk, by);
  const head = {
    companyName: settings.companyName || "Peak",
    accent: settings.accent || "#b08d4a",
    title: loaded.name,
    footer: `${settings.companyName || "Peak"} · Client package · ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}`,
  };
  const drawings = await drawingEntries(loaded.project, loaded.parts, head);

  const entries: ZipEntry[] = [
    {
      name: "00-package-index.pdf",
      bytes: renderReportPdf({
        ...head,
        tag: "Client package",
        subtitle: `${loaded.customer ? loaded.customer + " · " : ""}${loaded.sourceId} · prepared by ${by}`,
        blocks: indexBlocks(walk, gaps, spec.specSource, drawings.names.filter((n) => n.startsWith("03-"))),
      }),
    },
    ...ds.files,
    ...(spec.entry ? [spec.entry] : []),
    ...drawings.entries,
  ];
  const zip = buildZip(entries);
  const fileName = `${loaded.sourceId}-${packageSlug(loaded.name)}-client-package.zip`;

  let stored: { blobPath?: string; dataUrl?: string };
  if (blobEnabled()) {
    try {
      const up = await putBlob(`client-packages/${safeName(loaded.sourceId)}/${fileName}`, zip, "application/zip");
      stored = { blobPath: up.pathname };
    } catch (e) {
      console.error("[client-package] blob upload failed:", e);
      return { ok: false, error: "Upload to file storage failed — check the Blob token, or try again." };
    }
  } else {
    if (zip.length > MAX_INDB_PACKAGE_BYTES)
      return { ok: false, error: "This package is over 32 MB and file storage isn't configured (no BLOB_READ_WRITE_TOKEN), so it can't be kept in the database." };
    stored = { dataUrl: `data:application/zip;base64,${zip.toString("base64")}` };
  }

  const manifest: PackageManifest = {
    itemCount: walk.items.length,
    datasheets: walk.datasheets
      .filter((d) => !ds.gaps.some((g) => g.sku === d.sku))
      .map((d) => ({ sku: d.sku, desc: d.desc, qty: d.qty, group: d.group, fileName: d.fileName })),
    gaps,
    specGaps: walk.specGaps,
    specSource: spec.specSource,
    drawings: drawings.names,
  };
  const pkg = await insertPackage({
    source,
    gridProjectId: loaded.gridProjectId,
    quoteId: loaded.quoteId,
    customerId: loaded.customerId,
    customer: loaded.customer,
    name: loaded.name,
    fileName,
    bytes: zip.length,
    ...stored,
    manifest,
    createdAt: Date.now(),
    createdBy: by,
  });
  return { ok: true, pkg };
}
```

- [ ] **Step 5: Verify** `TEST_DB=$(mktemp -d) && PGLITE_PATH="$TEST_DB" npx tsx scripts/test-review-regressions.ts 2>&1 | tail -2` → `review regression checks passed`; `npx tsx scripts/test-review-and-spec.ts | tail -1` → `ALL PASSED`; tsc clean; `npx eslint src/lib/client-package-build.ts src/lib/client-package.ts src/lib/zip.ts` → 0 errors. Optional manual check of the zip: in the regression block temporarily `require("node:fs").writeFileSync(process.env.PKG_OUT, zip)` is NOT to be committed — instead, verify the layout by `unzip -l` on a package downloaded in Task 6's manual step.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/generated-specs.ts src/lib/client-package-build.ts scripts/test-review-regressions.ts
git commit -m "feat(package): server builder — index+placeholders, datasheets, spec docx, riser/schedule, plan sheets, Blob-or-in-doc storage (#40 Task 5)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: One click from The Grid — action + sidebar panel with gap chips

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (append `buildClientPackageAction`)
- Create: `src/app/(app)/design/grid/[id]/package-panel.tsx`
- Modify: `src/app/(app)/design/grid/[id]/page.tsx` (load packages, pass prop)
- Modify: `src/app/(app)/design/grid/[id]/editor.tsx` (prop + render panel)

**Interfaces:**
- Produces (action): `buildClientPackageAction(projectId: string): Promise<{ ok: true; packageId: string; gaps: number } | { ok: false; error: string }>`.
- Consumes: `packagesFor`, `ClientPackageSummary` (type only in the client component), `GAP_LABEL`.

- [ ] **Step 1: Action** — append to `grid/[id]/actions.ts` (add `import { buildClientPackage } from "@/lib/client-package-build";` with the other lib imports):

```ts
/**
 * One-click client package (#40): datasheets + spec + rough drawings for
 * this design, stored per D116 and listed in the editor sidebar. Any team
 * member can build one — it is read-only over the design and the catalog.
 */
export async function buildClientPackageAction(
  projectId: string
): Promise<{ ok: true; packageId: string; gaps: number } | { ok: false; error: string }> {
  const user = await requireUser();
  const r = await buildClientPackage({ kind: "grid", id: projectId }, user.name);
  if (!r.ok) return r;
  revalidatePath(editorPath(projectId));
  return { ok: true, packageId: r.pkg.id, gaps: r.pkg.manifest.gaps.length + r.pkg.manifest.specGaps.length };
}
```

- [ ] **Step 2: Panel** `src/app/(app)/design/grid/[id]/package-panel.tsx`

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientPackageSummary } from "@/lib/stores/client-packages";
import { GAP_LABEL } from "@/lib/client-package";
import { timeAgo } from "@/lib/format";
import { buildClientPackageAction } from "./actions";

/**
 * Client package sidebar panel (#40). One button builds the bundle; each
 * package lists as a download with its gap chips. A chip is the match-
 * report ethos made clickable: it names the part that could not be fully
 * documented and opens the catalog editor on it, so attachment population
 * happens where it matters first.
 */

const BTN: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff", borderRadius: 7, padding: "5px 10px", fontSize: 12, fontWeight: 600,
  color: "#3d424e", cursor: "pointer", fontFamily: "inherit",
};

const CHIP: React.CSSProperties = {
  display: "inline-block", fontSize: 10.5, fontWeight: 600, padding: "2px 7px", borderRadius: 12,
  background: "#fdf3e3", border: "1px solid #f0d9a8", color: "#8a5a12", textDecoration: "none", marginRight: 4, marginBottom: 4,
};

export default function ClientPackagePanel({
  projectId,
  packages,
  disabled,
}: {
  projectId: string;
  packages: ClientPackageSummary[];
  /** Editor-level busy flag, or nothing placed yet. */
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? packages : packages.slice(0, 2);

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #eceef2" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#8c919c", marginBottom: 6 }}>
        Client package
      </div>
      <button
        style={{ ...BTN, width: "100%", background: "#16181d", color: "#fff", borderColor: "#16181d" }}
        disabled={busy || disabled}
        onClick={async () => {
          setErr(null);
          setBusy(true);
          const r = await buildClientPackageAction(projectId);
          setBusy(false);
          if (!r.ok) setErr(r.error);
          else router.refresh();
        }}
      >
        {busy ? "Building…" : "Build client package"}
      </button>
      <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 4, lineHeight: 1.4 }}>
        Datasheets, specification and rough drawings for this design, as one zip.
      </div>
      {err && <div style={{ marginTop: 6, fontSize: 11.5, color: "#a0442b" }}>{err}</div>}
      {shown.map((p) => {
        const gaps = [...p.manifest.gaps, ...p.manifest.specGaps];
        const linkable = gaps.filter((g) => g.reason === "no-datasheet" || g.reason === "no-spec");
        return (
          <div key={p.id} style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.45 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{p.id}</span>
              <span style={{ color: "#8c919c" }}>{timeAgo(p.createdAt)} · {p.createdBy}</span>
            </div>
            <div style={{ color: "#5b6070" }}>
              {p.manifest.datasheets.length} datasheet{p.manifest.datasheets.length === 1 ? "" : "s"} · spec {p.manifest.specSource === "none" ? "none" : "included"} · {p.manifest.drawings.length} drawing file{p.manifest.drawings.length === 1 ? "" : "s"} · {Math.round(p.bytes / 1024)} KB
            </div>
            <a href={`/api/client-packages/${encodeURIComponent(p.id)}`} style={{ color: "var(--accent)", fontWeight: 600 }}>
              Download {p.fileName}
            </a>
            {gaps.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <span style={{ color: "#8a5a12", fontWeight: 600 }}>{gaps.length} gap{gaps.length === 1 ? "" : "s"}:</span>{" "}
                {linkable.map((g) => (
                  <Link key={`${g.sku}-${g.reason}`} href={`/catalog?edit=${encodeURIComponent(g.sku)}`} style={CHIP} title={GAP_LABEL[g.reason]}>
                    {g.sku} · {g.reason === "no-spec" ? "spec" : "datasheet"}
                  </Link>
                ))}
                {gaps
                  .filter((g) => !linkable.includes(g))
                  .map((g) => (
                    <span key={`${g.sku || g.desc}-${g.reason}`} style={{ ...CHIP, background: "#f3f4f6", borderColor: "#e4e7ec", color: "#5b6070" }} title={GAP_LABEL[g.reason]}>
                      {g.sku || g.desc.slice(0, 24)} · {g.reason.replace(/-/g, " ")}
                    </span>
                  ))}
              </div>
            )}
          </div>
        );
      })}
      {packages.length > 2 && (
        <button style={{ ...BTN, marginTop: 6, fontWeight: 500 }} onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show fewer" : `Show all ${packages.length}`}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: page.tsx** — add `import { packagesFor } from "@/lib/stores/client-packages";`; after the `tier` line add `const packages = await packagesFor({ gridProjectId: project.id });`; pass `packages={packages}` to `<GridEditor …>`.

- [ ] **Step 4: editor.tsx** — add `import ClientPackagePanel from "./package-panel";` and `import type { ClientPackageSummary } from "@/lib/stores/client-packages";`; add `packages,` to the destructured props and `packages: ClientPackageSummary[];` to the props type (after `venues`). Render, immediately after the `{project.quoteId && specHref && ( … )}` block and before the `{/* revisions (D109) */}` comment (still inside the same sidebar `<div>`):

```tsx
            {/* client package (#40) — datasheets + spec + rough drawings */}
            <ClientPackagePanel
              projectId={project.id}
              packages={packages}
              disabled={busy || (lines.length === 0 && wires.lines.length === 0 && curtains.length === 0)}
            />
```
(Confirm `busy`, `lines`, `wires`, `curtains` are in scope there — they are the same names the "Create draft quote" button uses a few lines above.)

- [ ] **Step 5: Verify** tsc clean; `npx eslint "src/app/(app)/design/grid/[id]"` → 0 errors. Manual (only with nothing else running): `npm run dev`, open a design that has placements, click "Build client package" → a `PKG-####` row appears with a download link and chips; download, `unzip -l` shows `00-package-index.pdf`, `02-spec/…docx` (if any ready row), `03-drawings/riser-and-schedule.pdf`, `03-drawings/plan-01-…`; open the index PDF → cover, index table, gap table, one "Datasheet pending" page per pending part. Click a chip → `/catalog?edit=<sku>` opens the part modal. Stop the server before any harness.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/design/grid/[id]/actions.ts" "src/app/(app)/design/grid/[id]/package-panel.tsx" "src/app/(app)/design/grid/[id]/page.tsx" "src/app/(app)/design/grid/[id]/editor.tsx"
git commit -m "feat(grid): one-click client package with download and catalog-linked gap chips (#40 Task 6)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: One click from a quote — form action + package card

**Files:**
- Modify: `src/app/(app)/quotes/actions.ts` (append `buildQuotePackage`)
- Create: `src/app/(app)/quotes/package-card.tsx` (server component)
- Modify: `src/app/(app)/quotes/page.tsx` (load packages for the selected row, `packageError` param, render card)

**Interfaces:**
- Produces (action, form-shaped like `setQuoteStatus`): `buildQuotePackage(formData: FormData): Promise<void>` — hidden `id` + `back`; on failure redirects to `back` with `packageError=<msg>`.

- [ ] **Step 1: Action** — append to `quotes/actions.ts` (add `import { buildClientPackage } from "@/lib/client-package-build";`; `redirect`, `revalidatePath`, `requireUser` are already imported there — confirm):

```ts
/** One-click client package from a quote (#40). Form-shaped like
 *  setQuoteStatus so the selected-row panel stays a server component; a
 *  refusal round-trips as ?packageError= on the same view. */
export async function buildQuotePackage(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = String(formData.get("id") || "");
  const back = String(formData.get("back") || "/quotes");
  if (!id) return;
  const r = await buildClientPackage({ kind: "quote", id }, user.name);
  if (!r.ok) redirect(back + (back.includes("?") ? "&" : "?") + "packageError=" + encodeURIComponent(r.error));
  revalidatePath("/quotes");
  redirect(back);
}
```

- [ ] **Step 2: Card** `src/app/(app)/quotes/package-card.tsx`

```tsx
import Link from "next/link";
import type { ClientPackageSummary } from "@/lib/stores/client-packages";
import { GAP_LABEL } from "@/lib/client-package";
import { timeAgo } from "@/lib/format";
import { buildQuotePackage } from "./actions";

/** Client package card on the selected quote (#40) — the same bundle The
 *  Grid builds, reachable from the quote so a consulting estimate without
 *  a Grid design still gets datasheets + spec. Server component. */
export function ClientPackageCard({
  quoteId,
  backHref,
  packages,
  error,
}: {
  quoteId: string;
  backHref: string;
  packages: ClientPackageSummary[];
  error: string | null;
}) {
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #eceef2" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".05em" }}>
          Client package
        </span>
        <form action={buildQuotePackage}>
          <input type="hidden" name="id" value={quoteId} />
          <input type="hidden" name="back" value={backHref} />
          <button type="submit" className="pk-btn-outline">Build client package</button>
        </form>
        <span style={{ fontSize: 11, color: "#8c919c" }}>datasheets + specification + drawings, one zip</span>
      </div>
      {error && <div style={{ marginTop: 6, fontSize: 12, color: "#a0442b" }}>{error}</div>}
      {packages.slice(0, 3).map((p) => {
        const gaps = [...p.manifest.gaps, ...p.manifest.specGaps];
        return (
          <div key={p.id} style={{ marginTop: 6, fontSize: 12, lineHeight: 1.45 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{p.id}</span>{" "}
            <a href={`/api/client-packages/${encodeURIComponent(p.id)}`} style={{ color: "var(--accent)", fontWeight: 600 }}>
              Download
            </a>{" "}
            <span style={{ color: "#8c919c" }}>
              {timeAgo(p.createdAt)} · {p.manifest.datasheets.length} datasheets · spec {p.manifest.specSource === "none" ? "none" : "included"} · {gaps.length} gap{gaps.length === 1 ? "" : "s"}
            </span>
            {gaps.length > 0 && (
              <div style={{ marginTop: 2 }}>
                {gaps.slice(0, 8).map((g) =>
                  g.reason === "no-datasheet" || g.reason === "no-spec" ? (
                    <Link key={`${g.sku}-${g.reason}`} href={`/catalog?edit=${encodeURIComponent(g.sku)}`} title={GAP_LABEL[g.reason]} style={{ fontSize: 10.5, fontWeight: 600, padding: "1px 6px", borderRadius: 12, background: "#fdf3e3", border: "1px solid #f0d9a8", color: "#8a5a12", textDecoration: "none", marginRight: 4 }}>
                      {g.sku} · {g.reason === "no-spec" ? "spec" : "datasheet"}
                    </Link>
                  ) : (
                    <span key={`${g.sku || g.desc}-${g.reason}`} title={GAP_LABEL[g.reason]} style={{ fontSize: 10.5, padding: "1px 6px", borderRadius: 12, background: "#f3f4f6", border: "1px solid #e4e7ec", color: "#5b6070", marginRight: 4 }}>
                      {g.sku || g.desc.slice(0, 24)} · {g.reason.replace(/-/g, " ")}
                    </span>
                  )
                )}
                {gaps.length > 8 ? <span style={{ fontSize: 10.5, color: "#8c919c" }}>+{gaps.length - 8} more on the cover</span> : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: page.tsx wiring.**
  - Imports: `import { packagesFor } from "@/lib/stores/client-packages";` and `import { ClientPackageCard } from "./package-card";`.
  - After `const selEng = …` add: `const packageError = one(sp.packageError) || null;` and `const selPackages = selectedId ? await packagesFor({ quoteId: selectedId }) : [];`.
  - Pass `packages={selPackages}` and `packageError={packageError}` to `<SelectedPanel …>`; add to its props type `packages: Awaited<ReturnType<typeof packagesFor>>; packageError: string | null;` and destructure them.
  - Render inside `SelectedPanel`, directly after the `{engagement && ( <Link …>Engagement …</Link> )}` block:

```tsx
        {(q.quoteType === undefined || q.quoteType === "system" || q.quoteType === "consulting") && (
          <ClientPackageCard quoteId={q.id} backHref={backHref} packages={packages} error={packageError} />
        )}
```
(Flame-test, repair, inspection and rental quotes have no equipment `spec`; the builder would only report "no equipment lines", so the card is not offered there.)

- [ ] **Step 4: Verify** tsc clean; eslint on the three files → 0 errors. Manual: `/quotes?id=Q-2043` (a Grid-minted quote) → card → Build → redirect back with a `PKG-####` row; `/quotes?id=<flame-test quote>` → no card. Stop the server. Then, nothing else running: `npm run test:smoke` → `ALL PASSED` (the `/quotes` and `/estimator?id=Q-2041` routes still render).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/quotes/actions.ts" "src/app/(app)/quotes/package-card.tsx" "src/app/(app)/quotes/page.tsx"
git commit -m "feat(quotes): build a client package from the selected quote (#40 Task 7)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Docs, D144, close-out

**Files:**
- Modify: `DECISIONS.md` (append D144), `PUNCHLIST.md` (#40 status), `MASTER-HOWTO.md` §9 (one paragraph: packages live under `client-packages/` in the same store; without the token they sit in the database, dev only)
- Modify: `docs/superpowers/specs/2026-07-25-client-package-generator-design.md` — resolve the two open questions (zip taken by default; CRM attachment deferred) and note the drawings v1 scope.

- [ ] **Step 1: Full gate**, one at a time: `npx tsc --noEmit -p .`, `npx eslint .` (0 errors), `npm run test:specs`, `npm run test:review:regressions`, `npm run test:smoke`.
- [ ] **Step 2: Write D144** — the nine "Decisions taken" above, in DECISIONS voice (why, not what), plus the verified-live line from Task 6/7's manual checks. Mark PUNCHLIST #40 as **BUILT — completeness Jeff-gated**: list the "Blocked on Jeff" items verbatim and the commit hashes; leave #39's import gate untouched.
- [ ] **Step 3: Commit** (no push — the branch owner pushes)

```bash
git add DECISIONS.md PUNCHLIST.md MASTER-HOWTO.md docs/superpowers/specs/2026-07-25-client-package-generator-design.md
git commit -m "docs: D144 client package generator; #40 built, completeness Jeff-gated

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```
