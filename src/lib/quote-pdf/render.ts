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

/**
 * Chrome's per-step caps in production (#222 T5 review). A render's worst case
 * is their sum: launch, navigation, the fonts wait, print. The fonts wait is
 * raced, not awaited bare — a font that never settles prints with its
 * fallback instead of hanging the render past the function's maxDuration.
 * generate.ts adds the coalescing wait and the upload allowance on top and the
 * spec harness asserts the total stays inside the rendering pages' 120 s.
 */
export const RENDER_LAUNCH_TIMEOUT_MS = 20_000;
export const RENDER_STEP_TIMEOUT_MS = 30_000;
export const RENDER_FONTS_TIMEOUT_MS = 10_000;
export const RENDER_WORST_CASE_MS = RENDER_LAUNCH_TIMEOUT_MS + 2 * RENDER_STEP_TIMEOUT_MS + RENDER_FONTS_TIMEOUT_MS;
/** #301 slice C (R8c) — the longest a `waitFor` render waits for its selector
 *  to stop matching. Only the Grid drawing set passes `waitFor`, with 25 s
 *  steps, so its worst case stays inside 120 s (grid-set-print.ts). */
export const RENDER_WAIT_FOR_TIMEOUT_MS = 30_000;

/** The URL's path for a log line — never the query, which carries the print token. */
function printPathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === "data:" ? "data:" : u.pathname;
  } catch {
    return "";
  }
}

/** #301 slice C: a figure on the print page settled in its error state (opt-in `failIf` matched). */
export class PrintFigureFailed extends Error {
  constructor() {
    super("A figure on the print page failed to draw — the PDF wasn’t made.");
    this.name = "PrintFigureFailed";
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** A render given up by its caller (#292: a client package past its cut-sheet deadline). */
export class RenderAborted extends Error {
  constructor() {
    super("The render was cancelled.");
    this.name = "AbortError";
  }
}
const abortErrorOf = (signal: AbortSignal): Error => (signal.reason instanceof Error ? signal.reason : new RenderAborted());

/**
 * The one Chrome queue: tasks run one at a time, in order. Without a signal
 * this is exactly the pre-#292 queue. With one (#292 final review #3): a task
 * aborted before its turn never runs (its slot passes straight on, so nothing
 * launches Chrome for it) and its caller is rejected at once, not at its
 * turn; a running task gets the signal to stop early. Exported for the spec
 * harness, which drives it with fake tasks.
 */
export function enqueueRender<T>(task: (signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    const run = () => task();
    const next = queue.then(run, run);
    queue = next.catch(() => undefined);
    return next;
  }
  const run = () => (signal.aborted ? Promise.reject(abortErrorOf(signal)) : task(signal));
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortErrorOf(signal));
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    next.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * `signal` (optional — every pre-#292 caller passes none and behaves exactly
 * as before): aborted before its turn, the render never launches Chrome;
 * aborted while running, the browser is closed at once, so the queue moves on.
 */
export function renderPrintRouteToPdf(url: string, opts: { timeoutMs?: number; signal?: AbortSignal; waitFor?: string; failIf?: string } = {}): Promise<Buffer> {
  // `next dev` compiles /print on first hit, which can take far longer than a
  // warm production render.
  const timeout = opts.timeoutMs ?? (process.env.NODE_ENV === "development" ? 90_000 : RENDER_STEP_TIMEOUT_MS);
  // #301 slice C: only the Grid drawing set passes `waitFor`; every other
  // caller keeps the two pre-existing dispatch lines below, untouched (#292).
  // `failIf` (also Grid-only) fails the render when it still matches after the wait.
  const waitFor = opts.waitFor;
  if (waitFor) return enqueueRender((signal) => renderOnce(url, timeout, signal, waitFor, opts.failIf), opts.signal);
  if (!opts.signal) return enqueueRender(() => renderOnce(url, timeout));
  return enqueueRender((signal) => renderOnce(url, timeout, signal), opts.signal);
}

async function renderOnce(url: string, timeout: number, signal?: AbortSignal, waitFor?: string, failIf?: string): Promise<Buffer> {
  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new PdfRenderUnavailable(launch.unavailable);
  if (signal?.aborted) throw abortErrorOf(signal);
  const puppeteer = (await import("puppeteer-core")).default;
  if (signal?.aborted) throw abortErrorOf(signal);
  const browser = await puppeteer.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    headless: launch.headless,
    defaultViewport: { width: 1100, height: 1400 },
    timeout: RENDER_LAUNCH_TIMEOUT_MS,
  });
  // Aborted mid-render: close Chrome now — the in-flight step fails and the queue moves on.
  const closeOnAbort = () => {
    browser.close().catch(() => undefined);
  };
  if (signal) {
    if (signal.aborted) closeOnAbort();
    else signal.addEventListener("abort", closeOnAbort, { once: true });
  }
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
    const fontsCapMs = Math.min(timeout, RENDER_FONTS_TIMEOUT_MS);
    const fontsCapped = await page.evaluate(async (capMs: number) => {
      const cap = new Promise<boolean>((resolve) => setTimeout(() => resolve(true), capMs));
      return Promise.race([document.fonts.ready.then(() => false), cap]);
    }, fontsCapMs);
    // Never fails the render — a font that never settles prints with its
    // fallback — but say so, so a PDF in the wrong typeface can be traced.
    if (fontsCapped) console.warn(`[quote-pdf] fonts still loading after ${fontsCapMs} ms — printing with fallback fonts`, printPathOf(url));
    // #301 slice C (R8c): a page that paints asynchronously (the Grid drawing
    // set's plan sheets flip data-ready) prints only once nothing matches
    // `waitFor`. Still matching at the cap fails the render. A figure that
    // settled by FAILING (data-error="1") also stops the wait, so `failIf`
    // (opt-in, Grid only) then refuses the print — a failed plan is never
    // stored as a finished sheet.
    if (waitFor) {
      await page.waitForFunction((sel: string) => !document.querySelector(sel), { timeout: Math.min(timeout, RENDER_WAIT_FOR_TIMEOUT_MS), polling: 250 }, waitFor);
      if (failIf && (await page.$(failIf))) throw new PrintFigureFailed();
    }
    // Re-check where the page IS right before printing (#222 final wave B): a
    // client-side redirect after "load" (a login bounce, a script navigating
    // away) must be refused, not printed as the customer's quote.
    if (!landedOnRequested(url, page.url())) {
      throw new Error("The print page navigated away before printing — the PDF wasn’t made.");
    }
    const pdf = await page.pdf({ format: "letter", printBackground: true, preferCSSPageSize: true, timeout });
    return Buffer.from(pdf);
  } finally {
    signal?.removeEventListener("abort", closeOnAbort);
    await browser.close().catch(() => undefined);
  }
}
