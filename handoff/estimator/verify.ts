/**
 * handoff:verify — headless-Chrome checks of the built prototype, opened from file://.
 *
 *   npm run handoff:verify -- --smoke [--out <package dir>]
 *
 * --smoke  opens index.html, waits for [data-handoff-ready] and the Estimator root, lets
 *          mount-time effects settle, then fails on: any pageerror; any request that is not
 *          local (file:, data:, blob:, about:) or Google Fonts; any local file that failed to
 *          load; any unregistered server action outside SMOKE_ALLOWED_UNREGISTERED.
 *          Screenshot: output/verify/smoke-build.png; result: output/verify/smoke.json.
 *
 * Later tasks add modes (--estimator, --shell, --parity, --full). Plan: PR 2 Task 2.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromeLaunch } from "@/lib/quote-pdf/render";

const ROOT = path.resolve(__dirname, "..", "..");
const VERIFY_DIR = path.join(ROOT, "output", "verify");

/** Actions the Build step calls on mount that have no browser implementation yet (spike
 *  REPORT "Stubs hit"). Later tasks register them and this list empties. */
export const SMOKE_ALLOWED_UNREGISTERED: readonly string[] = [
  "src/app/(app)/parties/actions.ts#listPartiesAction",
  "src/app/(app)/estimator/bid-actions.ts#bidPanelAction",
  "src/app/(app)/estimator/review-actions.ts#listReviewCommentsAction",
  "src/app/(app)/estimator/narrative-actions.ts#keyProductLibraryAction",
];

const LOCAL_SCHEMES = new Set(["file:", "data:", "blob:", "about:"]);
const FONT_HOSTS = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);

/** "local" | "fonts" | "foreign" for one request URL. */
export function classifyRequest(url: string): "local" | "fonts" | "foreign" {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "foreign";
  }
  if (LOCAL_SCHEMES.has(u.protocol)) return "local";
  if (u.protocol === "https:" && FONT_HOSTS.has(u.hostname)) return "fonts";
  return "foreign";
}

type SmokeResult = {
  pass: boolean;
  url: string;
  readyMs: number | null;
  estimatorMounted: boolean;
  pageErrors: string[];
  foreignRequests: string[];
  failedLocal: string[];
  fontRequests: number;
  unregistered: string[];
  unexpectedUnregistered: string[];
  consoleErrors: string[];
  screenshot: string;
};

async function smoke(pkgDir: string): Promise<SmokeResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const url = pathToFileURL(index).href;
  const pageErrors: string[] = [];
  const foreignRequests: string[] = [];
  const failedLocal: string[] = [];
  const consoleErrors: string[] = [];
  let fontRequests = 0;
  mkdirSync(VERIFY_DIR, { recursive: true });
  const screenshot = path.join(VERIFY_DIR, "smoke-build.png");
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => pageErrors.push(e instanceof Error ? e.stack || e.message : String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("request", (r) => {
      const kind = classifyRequest(r.url());
      if (kind === "foreign") foreignRequests.push(r.url());
      else if (kind === "fonts") fontRequests++;
    });
    page.on("requestfailed", (r) => {
      if (classifyRequest(r.url()) === "local") failedLocal.push(`${r.url()} (${r.failure()?.errorText ?? "failed"})`);
    });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: "load" });
    let readyMs: number | null = null;
    try {
      await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
      readyMs = Date.now() - t0;
    } catch {
      pageErrors.push("[verify] [data-handoff-ready] never appeared within 15 s");
    }
    // Mount-time effects (server-action calls) run after the first render; let them settle.
    await new Promise((r) => setTimeout(r, 1500));
    const estimatorMounted = await page.evaluate(() => !!document.querySelector(".est-root"));
    await page.screenshot({ path: screenshot as `${string}.png` });
    const unregistered = await page.evaluate(
      () => (window as unknown as { __peakHandoff?: { calledUnregistered?: () => string[] } }).__peakHandoff?.calledUnregistered?.() ?? [],
    );
    const allowed = new Set(SMOKE_ALLOWED_UNREGISTERED);
    const unexpectedUnregistered = unregistered.filter((id) => !allowed.has(id));
    const pass = pageErrors.length === 0 && foreignRequests.length === 0 && failedLocal.length === 0 && unexpectedUnregistered.length === 0 && estimatorMounted;
    return { pass, url, readyMs, estimatorMounted, pageErrors, foreignRequests, failedLocal, fontRequests, unregistered, unexpectedUnregistered, consoleErrors, screenshot };
  } finally {
    await browser.close();
  }
}

function printSmoke(r: SmokeResult): void {
  console.log(`handoff:verify --smoke  ${r.pass ? "PASS" : "FAIL"}`);
  console.log(`  ${r.url}`);
  console.log(`  ready after ${r.readyMs ?? "—"} ms; Estimator mounted: ${r.estimatorMounted ? "yes" : "NO"}`);
  console.log(`  page errors: ${r.pageErrors.length}`);
  for (const e of r.pageErrors) console.log(`    ${e.split("\n").slice(0, 4).join("\n    ")}`);
  console.log(`  foreign requests: ${r.foreignRequests.length}${r.foreignRequests.length ? "" : ` (Google Fonts requests: ${r.fontRequests})`}`);
  for (const u of r.foreignRequests) console.log(`    ${u}`);
  console.log(`  failed local files: ${r.failedLocal.length}`);
  for (const u of r.failedLocal) console.log(`    ${u}`);
  console.log(`  unregistered server actions called: ${r.unregistered.length} (unexpected: ${r.unexpectedUnregistered.length})`);
  for (const id of r.unregistered) console.log(`    ${r.unexpectedUnregistered.includes(id) ? "UNEXPECTED " : "allowed    "}${id}`);
  if (r.consoleErrors.length) {
    console.log(`  console errors (informational): ${r.consoleErrors.length}`);
    for (const e of r.consoleErrors.slice(0, 10)) console.log(`    ${e.slice(0, 200)}`);
  }
  console.log(`  screenshot: ${path.relative(ROOT, r.screenshot)}`);
}

async function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--out");
  const pkgDir = path.resolve(ROOT, i >= 0 ? argv[i + 1] : "output/peak-estimator-handoff");
  if (!argv.includes("--smoke")) {
    console.error("usage: npm run handoff:verify -- --smoke [--out <package dir>]");
    process.exit(2);
  }
  const r = await smoke(pkgDir);
  mkdirSync(VERIFY_DIR, { recursive: true });
  writeFileSync(path.join(VERIFY_DIR, "smoke.json"), JSON.stringify(r, null, 2) + "\n");
  printSmoke(r);
  if (!r.pass) process.exit(1);
}

if (/handoff[\\/]estimator[\\/]verify\.ts$/.test(path.resolve(process.argv[1] ?? ""))) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
