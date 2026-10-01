// SERVER ONLY — the datasheet page-1 thumbnail render (#245, spec §5/§1.1).
// Headless Chrome loads a signed /print/part-thumb/[id] route (a client
// component that opens the datasheet PDF with pdf.js and paints page 1 to a
// canvas), screenshots the canvas, stores the PNG and links it as a new
// `kind: "image"` document — same shape/ordering as any other image
// (compareImages always sorts a datasheet-render thumbnail after a real
// photo). One PDF renders once and attaches to every SKU that shares it
// (see thumbnail-plan.ts's grouping) — never one render per SKU.
import { headers } from "next/headers";
import { deleteBlob, putBlob } from "@/lib/blob";
import { printOriginFor } from "@/lib/quote-pdf/origin";
import { carriesBypass, chromeLaunch, landedOnRequested, RENDER_LAUNCH_TIMEOUT_MS, RENDER_STEP_TIMEOUT_MS } from "@/lib/quote-pdf/render";
import { signPrintToken } from "@/lib/quote-pdf/token";
import { attachDocument, createDocument, getDocument } from "@/lib/stores/part-documents";
import { shrinkImage } from "./shrink";
import { isDocumentId, newDocumentId, partDocBlobPath, safeDocFileName } from "./types";

export type RenderThumbnailResult = { ok: true; documentId: string } | { ok: false; error: string };

/** Test seam: a DB-backed check passes a fixed `origin` (headers() has no
 *  request to read outside an actual server request, which a plain script
 *  never has) plus a fake screenshot (a tiny PNG buffer) and, if it likes, a
 *  fake blob writer — headless Chrome itself can't run in the harness.
 *  Production passes none of these: `renderThumbnailsAction` resolves the
 *  origin once (it has real request headers) and hands it down here. */
export type RenderThumbnailDeps = {
  origin?: string;
  /** Same seam as generate.ts's GenerateInput.secret — lets a DB check sign
   *  a real token without AUTH_SECRET set in the harness's environment. */
  secret?: string;
  renderScreenshot?: (url: string) => Promise<Buffer>;
  putFile?: (pathname: string, bytes: Buffer, contentType: string) => Promise<{ pathname: string }>;
};

/** Headless-Chrome element screenshot (#245) — sibling to
 *  render.ts's renderPrintRouteToPdf, but for one <canvas id="thumb"> instead
 *  of a whole page.pdf(): the client renderer flags `body[data-ready="1"]`
 *  once pdf.js has painted page 1, and that's the only thing waited on. */
async function renderPartThumbPng(url: string): Promise<Buffer> {
  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    headless: launch.headless,
    defaultViewport: { width: 900, height: 1200 },
    timeout: RENDER_LAUNCH_TIMEOUT_MS,
  });
  try {
    const page = await browser.newPage();
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypass) {
      const printOrigin = new URL(url).origin;
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        if (req.isInterceptResolutionHandled()) return;
        const go = carriesBypass(req.url(), printOrigin)
          ? req.continue({ headers: { ...req.headers(), "x-vercel-protection-bypass": bypass } })
          : req.continue();
        go.catch(() => undefined);
      });
    }
    const res = await page.goto(url, { waitUntil: "load", timeout: RENDER_STEP_TIMEOUT_MS });
    if (res && (res.request().redirectChain().length > 0 || !landedOnRequested(url, res.url()))) {
      throw new Error("The print page redirected instead of rendering — the thumbnail wasn’t made.");
    }
    if (res ? !res.ok() : true) {
      throw new Error(`The print page answered ${res ? res.status() : "nothing"}.`);
    }
    await page.waitForSelector('body[data-ready="1"]', { timeout: 30_000 });
    const el = await page.$("#thumb");
    if (!el) throw new Error("The thumbnail canvas never appeared.");
    const png = await el.screenshot({ type: "png" });
    return Buffer.from(png);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

/**
 * Render one datasheet's page 1 to a PNG and attach it to every SKU in
 * `skus` (spec §5, §1.1). Refuses (renders nothing) when the datasheet id
 * is malformed, has no stored file, or `skus` is empty. A render/store
 * failure is reported, never thrown — the batch action moves on to the next
 * datasheet (§6 — one bad file must not stop the whole run).
 */
export async function renderDatasheetThumbnail(
  datasheetId: string,
  skus: readonly string[],
  by: string,
  deps: RenderThumbnailDeps = {}
): Promise<RenderThumbnailResult> {
  if (!isDocumentId(datasheetId)) return { ok: false, error: "Not a document id." };
  if (!skus.length) return { ok: false, error: "No parts to attach this thumbnail to." };
  const datasheet = await getDocument(datasheetId);
  if (!datasheet || datasheet.kind !== "datasheet" || !datasheet.blobKey) {
    return { ok: false, error: "That datasheet has no stored file to render." };
  }

  let origin = deps.origin;
  if (!origin) {
    let h: Awaited<ReturnType<typeof headers>> | null = null;
    try {
      h = await headers();
    } catch {
      h = null;
    }
    if (!h) return { ok: false, error: "No request to render the thumbnail from." };
    const where = printOriginFor(process.env, h.get("x-forwarded-host") || h.get("host"), h.get("x-forwarded-proto"));
    if ("error" in where) return { ok: false, error: where.error };
    origin = where.origin;
  }

  const secret = deps.secret ?? process.env.AUTH_SECRET ?? "";
  if (!secret) return { ok: false, error: "AUTH_SECRET is not set — the print page can’t be signed." };
  const now = Date.now();
  const token = signPrintToken(secret, "part-thumb", datasheetId, now);
  const url = `${origin}/print/part-thumb/${encodeURIComponent(datasheetId)}?t=${encodeURIComponent(token)}`;

  const renderScreenshot = deps.renderScreenshot ?? renderPartThumbPng;
  const putFile = deps.putFile ?? putBlob;

  let png: Buffer;
  try {
    png = await renderScreenshot(url);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not render the thumbnail." };
  }

  // #283 — store the thumbnail as WebP like every other image; a shrink
  // failure (never expected for Chrome's own PNG) falls back to the PNG.
  const shrunk = await shrinkImage(png);
  const outBytes = shrunk.ok ? shrunk.bytes : png;
  const outType = shrunk.ok ? shrunk.contentType : "image/png";
  const newId = newDocumentId();
  const fileName = `${safeDocFileName(datasheet.title || "datasheet")}-thumb.${shrunk.ok ? "webp" : "png"}`;
  let stored: { pathname: string };
  try {
    stored = await putFile(partDocBlobPath(newId, fileName), outBytes, outType);
  } catch {
    return { ok: false, error: "Could not store the file." };
  }
  const created = await createDocument({
    id: newId,
    kind: "image",
    title: `${datasheet.title} (page 1)`,
    fileName,
    contentType: outType,
    size: outBytes.byteLength,
    blobKey: stored.pathname,
    sourceUrl: null,
    source: "datasheet-render",
    sourceRef: datasheetId,
    by,
  });
  if (!created) {
    try {
      await deleteBlob(stored.pathname);
    } catch {
      /* best effort — the refusal stands either way */
    }
    return { ok: false, error: "Could not record the document." };
  }
  await attachDocument(created.id, skus, by);
  return { ok: true, documentId: created.id };
}
