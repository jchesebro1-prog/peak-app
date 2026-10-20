/**
 * Estimator handoff — `npm run handoff:verify -- --photos` (PR 2 Task 11): packaged product photos, in headless Chrome
 * over a COPY of the built package (the real one is never touched).
 *
 * The harness plays handoff:photos + handoff:slice: it writes two tiny PNGs into the copy's images/, an
 * images/manifest.json, and the data/photos.js the slicer would emit from it (photosScript), and adds the script tag the
 * build would (dataScripts order: before meta.js). It proves, from file://:
 *   - the Catalog thumbnail of a part WITH a photo loads images/<file> (request is file:, naturalWidth > 0);
 *   - the Catalog thumbnail of a part with NO photo, and of one whose manifest entry has no file, show the
 *     "Image coming soon" placeholder (loads, naturalWidth > 0, not from images/);
 *   - the quote document's key-product photo (Customer review → Document) loads the same images/ file;
 *   - nothing foreign is requested and no packaged file fails to load.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as vm from "node:vm";
import { deflateSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "puppeteer-core";
import { chromeLaunch } from "@/lib/quote-pdf/render";
import { photosScript, PHOTO_MANIFEST_VERSION, type PhotoManifest } from "../photo-select";
import { loadSliceData, newPage, newSink, openUrl, ROOT, VERIFY_DIR, waitFor, waitMounted, estimateUrl, type EditH, type PageSink } from "../verify";

type PhotosResult = { pass: boolean; steps: Array<{ step: string; ok: boolean; detail?: string }>; screenshots: string[] } & PageSink;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type: string, body: Buffer): Buffer {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, body])));
  return Buffer.concat([len, t, body, crc]);
}
/** A real, decodable solid-colour PNG (so the browser reports naturalWidth = w). */
export function solidPng(w: number, h: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG_2X2 = solidPng(2, 2, [200, 40, 40]);

const DOC_WITH = "PD-VERIFY1";
const DOC_ORPHAN = "PD-VERIFY2";

type CatalogRow = { sku?: string; id: string; renamedTo?: string };

function loadCatalogSkus(pkgDir: string): string[] {
  // The catalog chunks are plain scripts pushing into window.PEAK_CATALOG; read them the way verify/catalog.ts does.
  const window: Record<string, unknown> = {};
  const ctx = vm.createContext({ window });
  const dir = path.join(pkgDir, "data");
  for (const f of readdirSync(dir).filter((x) => /^catalog-\d+\.js$/.test(x)).sort()) vm.runInContext(readFileSync(path.join(dir, f), "utf8"), ctx, { filename: f });
  const all = (Array.isArray(window.PEAK_CATALOG) ? window.PEAK_CATALOG : []) as CatalogRow[];
  return all.filter((p) => !p.renamedTo).map((p) => p.sku ?? p.id);
}

export async function photosCheck(pkgDir: string): Promise<PhotosResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  const data = loadSliceData(pkgDir);
  const estimate = data.estimates.find((q) => q.id === "Q-G001") ?? data.estimates[0];
  if (!estimate) throw new Error("the slice has no estimate");
  const catalog = loadCatalogSkus(pkgDir);
  // withSku gets a photo (and a starred line on the estimate); orphanSku is mapped but its file is missing; plainSku is unmapped.
  const [withSku, orphanSku, plainSku] = catalog;
  if (!withSku || !orphanSku || !plainSku) throw new Error("the slice's catalog is too small");

  // --- the scratch copy: package + fake images + the data/photos.js the slicer would write ---
  const copy = path.join(VERIFY_DIR, "photos-pkg");
  rmSync(copy, { recursive: true, force: true });
  mkdirSync(VERIFY_DIR, { recursive: true });
  cpSync(pkgDir, copy, { recursive: true });
  mkdirSync(path.join(copy, "images"), { recursive: true });
  writeFileSync(path.join(copy, "images", `${DOC_WITH}.png`), PNG_2X2);
  const manifest: PhotoManifest = {
    version: PHOTO_MANIFEST_VERSION,
    bySku: { [withSku]: DOC_WITH, [orphanSku]: DOC_ORPHAN },
    // PD-VERIFY2 is mapped for a sku but has no file in byDoc (as when a download failed): the sku shows the placeholder.
    byDoc: { [DOC_WITH]: `${DOC_WITH}.png` },
    linkOnly: [],
    failed: [{ docId: DOC_ORPHAN, error: "verify: no file" }],
  };
  writeFileSync(path.join(copy, "images", "manifest.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(path.join(copy, "data", "photos.js"), photosScript(manifest));
  const html = readFileSync(path.join(copy, "index.html"), "utf8");
  const metaTag = '<script src="./data/meta.js"></script>';
  if (!html.includes(metaTag)) throw new Error("index.html has no meta.js script tag to put photos.js before");
  writeFileSync(path.join(copy, "index.html"), html.replace(metaTag, `<script src="./data/photos.js"></script>\n    ${metaTag}`));

  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const sink = newSink();
  const steps: PhotosResult["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ step: name, ok, ...(detail ? { detail } : {}) });
  const screenshots: string[] = [];
  const shot = async (page: Page, name: string) => {
    const file = path.join(VERIFY_DIR, `photos-${name}.png`);
    await page.screenshot({ path: file as `${string}.png` });
    screenshots.push(file);
  };
  const base = pathToFileURL(path.join(copy, "index.html")).href;
  const imageRequests: string[] = [];
  try {
    const page = await newPage(browser, sink);
    page.on("request", (r) => {
      if (r.resourceType() === "image") imageRequests.push(r.url());
    });

    // 1 — the Catalog thumbnails
    await openUrl(page, `${base}#/catalog`);
    await page.waitForSelector("[data-catalog-painted]", { timeout: 15_000 });
    const thumb = (sku: string) =>
      page.evaluate((s) => {
        const img = document.querySelector(`tr[data-catalog-sku="${CSS.escape(s)}"] img[data-catalog-thumb]`) as HTMLImageElement | null;
        return img ? { src: img.currentSrc || img.src, natural: img.naturalWidth, complete: img.complete } : null;
      }, sku);
    const search = async (q: string) => {
      await page.click("input[data-catalog-search]", { count: 3 });
      await page.keyboard.press("Backspace");
      await page.type("input[data-catalog-search]", q);
    };
    const settled = async (sku: string) => {
      let t = await thumb(sku);
      await waitFor(async () => {
        t = await thumb(sku);
        return !!t && t.complete && t.natural > 0;
      }, 8000, 100);
      return t;
    };
    await search(withSku);
    await waitFor(async () => !!(await thumb(withSku)), 8000, 100);
    const withT = await settled(withSku);
    step(`Catalog: ${withSku}'s thumbnail loads the packaged photo from images/ (file:, naturalWidth > 0)`, !!withT && withT.src.startsWith("file:") && withT.src.endsWith(`/images/${DOC_WITH}.png`) && withT.natural > 0, JSON.stringify(withT));
    await shot(page, "catalog-photo");

    await search(orphanSku);
    await waitFor(async () => !!(await thumb(orphanSku)), 8000, 100);
    const orphanT = await settled(orphanSku);
    step(`Catalog: ${orphanSku} (mapped, but its file is missing) shows the placeholder`, !!orphanT && orphanT.src.includes("/app/assets/placeholders/coming-soon.webp") && orphanT.natural > 0, JSON.stringify(orphanT));
    await search(plainSku);
    await waitFor(async () => !!(await thumb(plainSku)), 8000, 100);
    const plainT = await settled(plainSku);
    step(`Catalog: ${plainSku} (no photo at all) shows the placeholder`, !!plainT && plainT.src.includes("/app/assets/placeholders/coming-soon.webp") && plainT.natural > 0, JSON.stringify(plainT));

    // 2 — the quote document's key-product photo: star the line as a key product on a narrative system, open Customer review → Document
    const injected = await page.evaluate(async (id, sku0) => {
      const s = (window as unknown as EditH).__peakHandoff.store;
      const qd = (await s.get("quotes", id)) as { spec?: { sections?: Array<Record<string, unknown> & { items?: Array<Record<string, unknown>> }> } } | null;
      const sec = qd?.spec?.sections?.[0];
      const first = sec?.items?.[0];
      if (!qd || !sec || !first) return null;
      // a priced line for the photo part, in the first system (so it prints in the document body)
      const lineId = Math.max(...(sec.items ?? []).map((i) => Number(i.id) || 0)) + 1;
      sec.items = [...(sec.items ?? []), { ...first, id: lineId, sku: sku0, desc: "Verify photo part", components: undefined, curtain: undefined, curtainInputs: undefined }];
      sec.presentation = "narrative";
      sec.keyProducts = [{ lineKey: String(lineId), sku: sku0, text: "Verify paragraph for the packaged photo.", photo: true }];
      await s.put("quotes", qd as { id: string });
      return sku0;
    }, estimate.id, withSku);
    step("a key product is starred on the first system (injected into the overlay)", injected === withSku, String(injected));
    await openUrl(page, estimateUrl(base, estimate.id, "step=review"));
    await waitMounted(page, sink);
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="tab"]')].find((x) => x.textContent?.trim() === "Document") as HTMLElement | undefined;
      b?.click();
    });
    const docPhoto = () =>
      page.evaluate((file) => {
        const doc = document.querySelector(".est-doc");
        const img = [...(doc?.querySelectorAll("img") ?? [])].find((i) => (i.currentSrc || i.src).endsWith(file)) as HTMLImageElement | undefined;
        return img ? { src: img.currentSrc || img.src, natural: img.naturalWidth, complete: img.complete } : null;
      }, `/images/${DOC_WITH}.png`);
    let docT = await docPhoto();
    await waitFor(async () => {
      docT = await docPhoto();
      return !!docT && docT.complete && docT.natural > 0;
    }, 10_000, 150);
    step("Customer review → Document: the key product's photo loads the packaged file (file:, naturalWidth > 0)", !!docT && docT.src.startsWith("file:") && docT.natural > 0, JSON.stringify(docT));
    await shot(page, "document-photo");
    step("every image request was local (file:/data:)", imageRequests.every((u) => u.startsWith("file:") || u.startsWith("data:")), imageRequests.filter((u) => !u.startsWith("file:") && !u.startsWith("data:")).slice(0, 3).join(", "));
    await page.evaluate(async () => (window as unknown as EditH).__peakHandoff.store.reset());
    await page.close();
  } finally {
    await browser.close();
  }
  const pass = steps.every((s) => s.ok) && sink.pageErrors.length === 0 && sink.foreignRequests.length === 0 && sink.failedLocal.length === 0;
  return { pass, steps, screenshots, ...sink };
}

export function printPhotos(r: PhotosResult): void {
  console.log(`handoff:verify --photos  ${r.pass ? "PASS" : "FAIL"}`);
  for (const s of r.steps) console.log(`  ${s.ok ? "ok  " : "FAIL"} ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
  console.log(`  page errors: ${r.pageErrors.length}`);
  for (const e of r.pageErrors) console.log(`    ${e.split("\n").slice(0, 4).join("\n    ")}`);
  console.log(`  foreign requests: ${r.foreignRequests.length}; failed local files: ${r.failedLocal.length}`);
  for (const u of [...r.foreignRequests, ...r.failedLocal]) console.log(`    ${u}`);
  console.log(`  screenshots: ${r.screenshots.map((f) => path.relative(ROOT, f)).join(", ")}`);
}
