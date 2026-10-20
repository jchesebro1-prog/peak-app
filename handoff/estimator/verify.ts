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
 *   npm run handoff:verify -- --estimator <quoteId|all> [--out <package dir>]
 *
 * --estimator  opens index.html?id=<quoteId> (each slice estimate for `all`) and compares the
 *          header's "Quoted total" with the total the Estimator must show: the quote's sections
 *          after the canonicalization it applies on load (system order, then the hidden 5 % / 2 %
 *          bonus lines for an eligible draft — expectedEstimatorTotals). The raw golden
 *          (core:golden, .data-handoff/golden or docs/estimating-core/golden) is reported beside
 *          it. Fails on a mismatch, a pageerror, a foreign request or an unexpected unregistered
 *          action. Then, on the first estimate, the IndexedDB overlay: persistent, a quote edit
 *          survives a reload and shows in the header, a tombstone survives a reload, and Reset
 *          brings the snapshot back. Result: output/verify/estimator.json.
 *
 * Later tasks add modes (--shell, --parity, --full). Plan: PR 2 Tasks 2–3.
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import * as vm from "node:vm";
import { pathToFileURL } from "node:url";
import type { Browser, Page } from "puppeteer-core";
import { chromeLaunch } from "@/lib/quote-pdf/render";
import { fmt, totals, withPriceRound } from "@/lib/estimating-core/pricing";
import type { SpecSection } from "@/lib/estimating-core/types";
import { normalizeSystemOrder, sanitizeGroups } from "@/lib/estimate-groups/groups";
import { sourceForSave } from "@/lib/portal-quote-mode";
import { bonusRatesFor, bonusRulesApply, idCounterFrom, withBonusLines } from "@/lib/estimate-bonus/rules";
import { bonusRatesFrom, BONUS_ESTIMATOR_RATE_ID, BONUS_PACKAGE_RATE_ID } from "@/lib/estimate-bonus/flags";
import { displayQuoteNumber } from "@/lib/estimate-number";

const ROOT = path.resolve(__dirname, "..", "..");
const VERIFY_DIR = path.join(ROOT, "output", "verify");

/** Actions the Build step calls on mount that have no browser implementation yet (spike
 *  REPORT "Stubs hit"). Later tasks register them and this list empties. */
export const SMOKE_ALLOWED_UNREGISTERED: readonly string[] = [
  "src/app/(app)/parties/actions.ts#listPartiesAction",
  "src/app/(app)/estimator/bid-actions.ts#bidPanelAction",
  "src/app/(app)/estimator/review-actions.ts#listReviewCommentsAction",
  "src/app/(app)/estimator/narrative-actions.ts#keyProductLibraryAction",
  // Task 3: called on mount once the estimate has a linked customer (the dev slice has none, so
  // Task 2's smoke never saw it); refused, the Rewards line just doesn't show.
  "src/app/(app)/rewards/actions.ts#rewardCreditInfoAction",
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

/* ------------------------------------------------------------------ --estimator */

type SliceQuote = { id: string; status?: string | null; source?: string | null; quoteType?: string | null; estNo?: number | null; estSuffix?: number | null; spec?: { sections?: unknown; groups?: unknown } };
type SliceData = { estimates: SliceQuote[]; rules: { settings?: Record<string, unknown>; blobs?: Record<string, unknown> } };

/** The slice's estimates.js + rules.js, run in a sandbox (the page loads them the same way). */
export function loadSliceData(pkgDir: string): SliceData {
  const window: Record<string, unknown> = {};
  const ctx = vm.createContext({ window });
  for (const f of ["rules.js", "estimates.js"]) {
    const file = path.join(pkgDir, "data", f);
    if (existsSync(file)) vm.runInContext(readFileSync(file, "utf8"), ctx, { filename: file });
  }
  return {
    estimates: Array.isArray(window.PEAK_ESTIMATES) ? (window.PEAK_ESTIMATES as SliceQuote[]) : [],
    rules: (window.PEAK_RULES as SliceData["rules"]) ?? {},
  };
}

/**
 * What the Estimator's header must read for a stored quote: `raw` = totals() of the stored
 * sections (the golden); `canonical` = totals() after the canonicalization the Estimator applies
 * on load — page.tsx normalizeSystemOrder; use-estimator-state's initial state (#267: a draft,
 * non-portal estimate's systems round up to the next $25 — withPriceRound); then its bonus effect
 * (bonusRulesApply → withBonusLines at bonusRatesFor(status, …, Estimating Rules' rates)).
 */
export function expectedEstimatorTotals(q: SliceQuote, rules: SliceData["rules"]): { raw: number; canonical: number; priceRound: boolean; bonusLines: boolean } {
  const stored = Array.isArray(q.spec?.sections) ? (q.spec!.sections as SpecSection[]) : [];
  const ordered = normalizeSystemOrder(stored, sanitizeGroups(q.spec?.groups));
  const status = q.status ?? "draft";
  const sections = q.source !== "portal-catalog" && status === "draft" ? withPriceRound(ordered) : ordered;
  const general = ((rules.blobs ?? {}).pricing_rules ?? {}) as Record<string, unknown>;
  const rates = bonusRatesFrom(general[BONUS_PACKAGE_RATE_ID], general[BONUS_ESTIMATOR_RATE_ID]);
  const applies = bonusRulesApply({ source: sourceForSave(q.source, "estimator"), quoteType: q.quoteType ?? "system", status }, sections);
  const canonical = applies ? withBonusLines(sections, idCounterFrom(sections), bonusRatesFor(status, sections, rates)) : sections;
  return { raw: totals(stored, 0).grand, canonical: totals(canonical, 0).grand, priceRound: sections !== ordered, bonusLines: canonical !== sections };
}

function goldenGrand(id: string): { grand: number; file: string } | null {
  for (const dir of [".data-handoff/golden", "docs/estimating-core/golden"]) {
    const file = path.join(ROOT, dir, `${id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
    if (existsSync(file)) {
      const g = JSON.parse(readFileSync(file, "utf8")) as { totals?: { grand?: number } };
      if (typeof g.totals?.grand === "number") return { grand: g.totals.grand, file: path.relative(ROOT, file) };
    }
  }
  return null;
}

type PageSink = { pageErrors: string[]; foreignRequests: string[]; failedLocal: string[]; consoleErrors: string[] };

function newSink(): PageSink {
  return { pageErrors: [], foreignRequests: [], failedLocal: [], consoleErrors: [] };
}

async function newPage(browser: Browser, sink: PageSink): Promise<Page> {
  const page = await browser.newPage();
  page.on("pageerror", (e) => sink.pageErrors.push(e instanceof Error ? e.stack || e.message : String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") sink.consoleErrors.push(m.text());
  });
  page.on("request", (r) => {
    if (classifyRequest(r.url()) === "foreign") sink.foreignRequests.push(r.url());
  });
  page.on("requestfailed", (r) => {
    if (classifyRequest(r.url()) === "local") sink.failedLocal.push(`${r.url()} (${r.failure()?.errorText ?? "failed"})`);
  });
  return page;
}

async function waitMounted(page: Page, sink: PageSink): Promise<boolean> {
  try {
    await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
  } catch {
    sink.pageErrors.push("[verify] [data-handoff-ready] never appeared within 15 s");
    return false;
  }
  await new Promise((r) => setTimeout(r, 1500));
  return page.evaluate(() => !!document.querySelector(".est-root"));
}

/** The header's "Quoted total" figure, as rendered. */
const readHeaderTotal = (page: Page) =>
  page.evaluate(() => {
    const label = [...document.querySelectorAll("div")].find((d) => d.children.length === 0 && d.textContent?.trim() === "Quoted total");
    return label?.nextElementSibling?.textContent?.trim() ?? null;
  });

const pageHasText = (page: Page, text: string) => page.evaluate((t) => document.body.innerText.includes(t), text);

const unregisteredOn = (page: Page) =>
  page.evaluate(() => (window as unknown as { __peakHandoff?: { calledUnregistered?: () => string[] } }).__peakHandoff?.calledUnregistered?.() ?? []);

type EstimateCheck = {
  id: string;
  number: string;
  pass: boolean;
  onScreen: string | null;
  expected: string;
  expectedCanonical: number;
  rawGrand: number;
  golden: { grand: number; file: string } | null;
  priceRound: boolean;
  bonusLines: boolean;
  numberShown: boolean;
  mounted: boolean;
  unexpectedUnregistered: string[];
  screenshot: string;
};

type StoreCheck = { pass: boolean; steps: Array<{ step: string; ok: boolean; detail?: string }> };

type EstimatorResult = { pass: boolean; checks: EstimateCheck[]; store: StoreCheck | null } & PageSink;

/** The overlay round trip on one estimate (put → reload → read back; tombstone; reset). */
async function storeCheck(page: Page, url: string, id: string, sink: PageSink, expectedTotal: string): Promise<StoreCheck> {
  const steps: StoreCheck["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ step: name, ok, ...(detail ? { detail } : {}) });
  type H = { __peakHandoff: { store: { persistent: boolean; get(c: string, id: string): Promise<unknown>; put(c: string, d: unknown): Promise<void>; remove(c: string, id: string): Promise<void>; reset(): Promise<void>; all(c: string): Promise<unknown[]> } } };
  const marker = `VERIFY overlay ${id}`;
  const persistent = await page.evaluate(() => (window as unknown as H).__peakHandoff.store.persistent);
  step("IndexedDB opened (persistent)", persistent === true);
  const seedCount = await page.evaluate(async () => (await (window as unknown as H).__peakHandoff.store.all("quotes")).length);
  await page.evaluate(
    async (qid, name) => {
      const s = (window as unknown as H).__peakHandoff.store;
      const q = (await s.get("quotes", qid)) as Record<string, unknown>;
      await s.put("quotes", { ...q, name });
      await s.put("meta", { id: "verify-probe", at: 1 });
      await s.put("meta", { id: "verify-tomb", at: 1 });
      await s.remove("meta", "verify-tomb");
      // put order z → a → m: a reload must keep it (IndexedDB hands rows back in id order)
      for (const k of ["verify-z", "verify-a", "verify-m"]) await s.put("meta", { id: k, at: 1 });
    },
    id,
    marker,
  );
  await page.goto(url, { waitUntil: "load" });
  await waitMounted(page, sink);
  step("a quote edit survives a reload and shows in the header", await pageHasText(page, marker));
  const after = await page.evaluate(async () => {
    const s = (window as unknown as H).__peakHandoff.store;
    const order = (await s.all("meta")).map((d) => (d as { id: string }).id).filter((i) => i.startsWith("verify-") && i !== "verify-probe" && i !== "verify-tomb");
    return { probe: !!(await s.get("meta", "verify-probe")), tomb: (await s.get("meta", "verify-tomb")) === undefined, count: (await s.all("quotes")).length, order: order.join(",") };
  });
  step("a put doc survives a reload", after.probe);
  step("a tombstone survives a reload", after.tomb);
  step("an edited seed quote is not duplicated", after.count === seedCount, `${after.count} vs ${seedCount}`);
  step("put order survives a reload (z, a, m — not id order)", after.order === "verify-z,verify-a,verify-m", after.order);
  await page.evaluate(async () => (window as unknown as H).__peakHandoff.store.reset());
  await page.goto(url, { waitUntil: "load" });
  await waitMounted(page, sink);
  const probeGone = await page.evaluate(async () => (await (window as unknown as H).__peakHandoff.store.get("meta", "verify-probe")) === undefined);
  step("Reset drops the overlay (probe gone, name back)", probeGone && !(await pageHasText(page, marker)));
  const total = await readHeaderTotal(page);
  step("after Reset the header total is the snapshot's", total === expectedTotal, `${total} vs ${expectedTotal}`);
  return { pass: steps.every((s) => s.ok), steps };
}


/**
 * Reset from a second window (same file:// origin): the other window lets go of the database and goes
 * non-persistent, the reset completes and restores the snapshot; and a window that never lets go makes
 * reset() reject with "Close other prototype windows and try again.".
 */
async function resetAcrossWindows(browser: Browser, url: string, sink: PageSink): Promise<StoreCheck["steps"]> {
  const steps: StoreCheck["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ step: name, ok, ...(detail ? { detail } : {}) });
  type S = { persistent: boolean; put(c: string, d: unknown): Promise<void>; get(c: string, id: string): Promise<unknown>; reset(): Promise<void> };
  type H = { __peakHandoff: { store: S } };
  const a = await newPage(browser, sink);
  const b = await newPage(browser, sink);
  const c = await newPage(browser, sink);
  try {
    await a.goto(url, { waitUntil: "load" });
    await b.goto(url, { waitUntil: "load" });
    await waitMounted(a, sink);
    await waitMounted(b, sink);
    await b.evaluate(async () => (window as unknown as H).__peakHandoff.store.put("meta", { id: "verify-xwin", at: 1 }));
    const aRes = await a.evaluate(async () => {
      const s = (window as unknown as H).__peakHandoff.store;
      try {
        await s.reset();
        return { ok: true, persistent: s.persistent, probe: !!(await s.get("meta", "verify-xwin")) };
      } catch (e) {
        return { ok: false, persistent: s.persistent, probe: true, error: (e as Error).message };
      }
    });
    step("Reset in one window completes while another has the data open", aRes.ok === true, aRes.error);
    step("the resetting window stays persistent and the probe is gone", aRes.persistent === true && aRes.probe === false);
    let bPersistent = true;
    for (let i = 0; i < 30 && bPersistent; i++) {
      bPersistent = await b.evaluate(() => (window as unknown as H).__peakHandoff.store.persistent);
      if (bPersistent) await new Promise((r) => setTimeout(r, 100));
    }
    step("the other window closed its connection (persistent false)", bPersistent === false);
    step('the other window shows "Changes won\'t be saved in this window"', await pageHasText(b, "Changes won't be saved in this window"));
    await a.goto(url, { waitUntil: "load" });
    await waitMounted(a, sink);
    step("after a reload the snapshot is back (probe gone)", await a.evaluate(async () => (await (window as unknown as H).__peakHandoff.store.get("meta", "verify-xwin")) === undefined));

    // a window that never answers versionchange: Reset must say so instead of pretending
    await c.goto(url, { waitUntil: "load" });
    await c.evaluate(() => new Promise<void>((resolve, reject) => {
      const r = indexedDB.open("peak-estimator-handoff");
      (window as unknown as { __rawHold?: IDBDatabase }).__rawHold = undefined;
      r.onsuccess = () => {
        (window as unknown as { __rawHold?: IDBDatabase }).__rawHold = r.result; // no onversionchange handler
        resolve();
      };
      r.onerror = () => reject(r.error);
    }));
    const blocked = await a.evaluate(async () => {
      const s = (window as unknown as H).__peakHandoff.store;
      try {
        await s.reset();
        return { ok: true, message: "" };
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
    });
    step("a blocked Reset fails with the close-other-windows message", blocked.ok === false && /Close other prototype windows/.test(blocked.message), blocked.message);
    step("…and the window reports it can't save", (await a.evaluate(() => (window as unknown as H).__peakHandoff.store.persistent)) === false);
    await c.evaluate(() => (window as unknown as { __rawHold?: IDBDatabase }).__rawHold?.close());
  } finally {
    await a.close();
    await b.close();
    await c.close();
  }
  return steps;
}

async function estimatorCheck(pkgDir: string, which: string): Promise<EstimatorResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  const data = loadSliceData(pkgDir);
  const quotes = which === "all" ? data.estimates : data.estimates.filter((q) => q.id === which);
  if (!quotes.length) throw new Error(`no estimate "${which}" in ${path.join(pkgDir, "data", "estimates.js")}`);
  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const sink = newSink();
  const checks: EstimateCheck[] = [];
  let store: StoreCheck | null = null;
  mkdirSync(VERIFY_DIR, { recursive: true });
  const allowed = new Set(SMOKE_ALLOWED_UNREGISTERED);
  try {
    for (const q of quotes) {
      const url = `${pathToFileURL(index).href}?id=${encodeURIComponent(q.id)}`;
      const page = await newPage(browser, sink);
      const errorsBefore = sink.pageErrors.length;
      await page.goto(url, { waitUntil: "load" });
      const mounted = await waitMounted(page, sink);
      const onScreen = await readHeaderTotal(page);
      const exp = expectedEstimatorTotals(q, data.rules);
      const number = displayQuoteNumber({ ...q, id: q.id });
      const numberShown = await pageHasText(page, number);
      const screenshot = path.join(VERIFY_DIR, `estimator-${q.id.replace(/[^A-Za-z0-9._-]/g, "_")}.png`);
      await page.screenshot({ path: screenshot as `${string}.png` });
      const unexpectedUnregistered = (await unregisteredOn(page)).filter((x) => !allowed.has(x));
      const expected = fmt(exp.canonical);
      checks.push({
        id: q.id, number, onScreen, expected, expectedCanonical: exp.canonical, rawGrand: exp.raw, golden: goldenGrand(q.id), priceRound: exp.priceRound, bonusLines: exp.bonusLines,
        numberShown, mounted, unexpectedUnregistered, screenshot,
        pass: mounted && numberShown && onScreen === expected && unexpectedUnregistered.length === 0 && sink.pageErrors.length === errorsBefore,
      });
      if (!store) {
        store = await storeCheck(page, url, q.id, sink, expected);
        await page.close();
        store.steps.push(...(await resetAcrossWindows(browser, url, sink)));
        store.pass = store.steps.every((s) => s.ok);
      } else await page.close();
    }
  } finally {
    await browser.close();
  }
  const pass = checks.every((c) => c.pass) && (store?.pass ?? false) && sink.pageErrors.length === 0 && sink.foreignRequests.length === 0 && sink.failedLocal.length === 0;
  return { pass, checks, store, ...sink };
}

function printEstimator(r: EstimatorResult): void {
  console.log(`handoff:verify --estimator  ${r.pass ? "PASS" : "FAIL"}`);
  for (const c of r.checks) {
    const golden = c.golden ? `golden ${fmt(c.golden.grand)} (${c.golden.file})` : "no golden file";
    console.log(`  ${c.pass ? "ok  " : "FAIL"} ${c.id} (${c.number}${c.numberShown ? "" : " NOT SHOWN"}): on screen ${c.onScreen ?? "—"} · expected ${c.expected}${[c.priceRound ? "$25 round" : "", c.bonusLines ? "bonus lines" : ""].filter(Boolean).map((x) => ` +${x}`).join("")} · raw totals() ${fmt(c.rawGrand)} · ${golden}`);
    if (c.unexpectedUnregistered.length) console.log(`       unexpected unregistered: ${c.unexpectedUnregistered.join(", ")}`);
  }
  if (r.store) {
    console.log(`  IndexedDB overlay: ${r.store.pass ? "PASS" : "FAIL"}`);
    for (const s of r.store.steps) console.log(`    ${s.ok ? "ok  " : "FAIL"} ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
  }
  console.log(`  page errors: ${r.pageErrors.length}`);
  for (const e of r.pageErrors) console.log(`    ${e.split("\n").slice(0, 4).join("\n    ")}`);
  console.log(`  foreign requests: ${r.foreignRequests.length}; failed local files: ${r.failedLocal.length}`);
  for (const u of [...r.foreignRequests, ...r.failedLocal]) console.log(`    ${u}`);
  if (r.consoleErrors.length) {
    console.log(`  console errors (informational): ${r.consoleErrors.length}`);
    for (const e of r.consoleErrors.slice(0, 10)) console.log(`    ${e.slice(0, 200)}`);
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const val = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const pkgDir = path.resolve(ROOT, val("--out") ?? "output/peak-estimator-handoff");
  const est = val("--estimator");
  if (!argv.includes("--smoke") && !est) {
    console.error("usage: npm run handoff:verify -- --smoke | --estimator <quoteId|all> [--out <package dir>]");
    process.exit(2);
  }
  mkdirSync(VERIFY_DIR, { recursive: true });
  let pass = true;
  if (argv.includes("--smoke")) {
    const r = await smoke(pkgDir);
    writeFileSync(path.join(VERIFY_DIR, "smoke.json"), JSON.stringify(r, null, 2) + "\n");
    printSmoke(r);
    pass &&= r.pass;
  }
  if (est) {
    const r = await estimatorCheck(pkgDir, est);
    writeFileSync(path.join(VERIFY_DIR, "estimator.json"), JSON.stringify(r, null, 2) + "\n");
    printEstimator(r);
    pass &&= r.pass;
  }
  if (!pass) process.exit(1);
}

if (/handoff[\\/]estimator[\\/]verify\.ts$/.test(path.resolve(process.argv[1] ?? ""))) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
