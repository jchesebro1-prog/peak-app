import { existsSync } from "node:fs";

/**
 * URL → PDF bytes with headless Chrome (#222). On Vercel: @sparticuz/chromium's
 * bundled headless shell (its brotli'd binary is traced in via next.config's
 * outputFileTracingIncludes). Elsewhere: the installed Google Chrome
 * (CHROME_PATH, default the macOS app). No Chrome → PdfRenderUnavailable with a
 * reason the PDF state shows; the save that scheduled it has already succeeded.
 * Renders are serialized per server instance so two quick saves never run two
 * Chromiums side by side. Server-only; both packages load lazily. The Chrome
 * probe opts out of file tracing (a runtime path would trace the whole project).
 *
 * Versions are exact-pinned as a pair: puppeteer-core drives the Chrome major
 * it was built for (node_modules/puppeteer-core/lib/puppeteer/revisions.js),
 * and @sparticuz/chromium's major must be that same number.
 */

export const MAC_CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export type ChromeLaunch = { executablePath: string; args: string[]; headless: true | "shell" };

export class PdfRenderUnavailable extends Error {}

export async function chromeLaunch(): Promise<ChromeLaunch | { unavailable: string }> {
  if (process.env.QUOTE_PDF_DISABLED === "1") {
    return { unavailable: "PDF rendering is switched off on this server (QUOTE_PDF_DISABLED=1)." };
  }
  if (process.env.VERCEL) {
    try {
      const chromium = (await import("@sparticuz/chromium")).default;
      return { executablePath: await chromium.executablePath(), args: chromium.args, headless: "shell" };
    } catch (e) {
      return { unavailable: "Chromium isn't available on this deployment (" + (e instanceof Error ? e.message : String(e)) + ")." };
    }
  }
  const path = process.env.CHROME_PATH || MAC_CHROME_PATH;
  if (!existsSync(/*turbopackIgnore: true*/ path)) return { unavailable: `No Chrome found at ${path} — install Google Chrome or set CHROME_PATH.` };
  return {
    executablePath: path,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars"],
    headless: true,
  };
}

/**
 * The print page is only trusted when Chrome landed exactly where it was sent:
 * a redirect (to a login page, another host, anything) is refused rather than
 * printed as the customer's quote. Compares origin + pathname — the query is
 * the token and may legitimately be re-encoded. data: URLs (the smoke render)
 * have no origin to compare and are only checked for "not redirected".
 */
export function landedOnRequested(requested: string, final: string): boolean {
  let a: URL, b: URL;
  try {
    a = new URL(requested);
    b = new URL(final);
  } catch {
    return false;
  }
  if (a.protocol === "data:") return b.protocol === "data:";
  return a.origin === b.origin && a.pathname === b.pathname;
}

/** The Vercel protection-bypass secret rides only on requests to the print
 *  origin itself — never a font CDN, an image host or a redirect target. */
export function carriesBypass(requestUrl: string, printOrigin: string): boolean {
  if (!printOrigin || printOrigin === "null") return false;
  try {
    return new URL(requestUrl).origin === printOrigin;
  } catch {
    return false;
  }
}

let queue: Promise<unknown> = Promise.resolve();

export function renderPrintRouteToPdf(url: string, opts: { timeoutMs?: number } = {}): Promise<Buffer> {
  // `next dev` compiles /print on first hit, which can take far longer than a
  // warm production render.
  const timeout = opts.timeoutMs ?? (process.env.NODE_ENV === "development" ? 90_000 : 30_000);
  const run = () => renderOnce(url, timeout);
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

async function renderOnce(url: string, timeout: number): Promise<Buffer> {
  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new PdfRenderUnavailable(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    headless: launch.headless,
    defaultViewport: { width: 1100, height: 1400 },
  });
  try {
    const page = await browser.newPage();
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypass) {
      // Per request, not setExtraHTTPHeaders: that would send the secret to
      // every host the page (or a redirect) touches.
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
    const res = await page.goto(url, { waitUntil: "load", timeout });
    if (res && (res.request().redirectChain().length > 0 || !landedOnRequested(url, res.url()))) {
      throw new Error("The print page redirected instead of rendering — the PDF wasn’t made.");
    }
    if (res ? !res.ok() : !url.startsWith("data:")) {
      throw new Error(`The print page answered ${res ? res.status() : "nothing"}.`);
    }
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const pdf = await page.pdf({ format: "letter", printBackground: true, preferCSSPageSize: true, timeout });
    return Buffer.from(pdf);
  } finally {
    await browser.close().catch(() => undefined);
  }
}
