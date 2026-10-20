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
 *   npm run handoff:verify -- --estimator-edit [quoteId] [--out <package dir>]
 *
 * --estimator-edit  the Build step's real work (Task 4): a qty edit, a catalog add and a brand-new
 *          estimate (`?new=1`) each Save, survive a reload, and the new one gets the next EST number.
 *          Result: output/verify/estimator-edit.json.
 *
 * Later tasks add modes (--shell, --parity, --full). Plan: PR 2 Tasks 2–4.
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

/* ------------------------------------------------------------------ --estimator-edit */

type EditResult = { pass: boolean; id: string; steps: Array<{ step: string; ok: boolean; detail?: string }>; unexpectedUnregistered: string[] } & PageSink;

type EditH = { __peakHandoff: { store: { get(c: string, id: string): Promise<unknown>; all(c: string): Promise<unknown[]>; reset(): Promise<void> } } };

/** Clicks the first visible button whose trimmed text is `text` (or starts with it, `prefix`). */
const clickButton = (page: Page, text: string, prefix = false) =>
  page.evaluate(
    (t, pre) => {
      const b = [...document.querySelectorAll("button")].find((x) => {
        const s = x.textContent?.trim() ?? "";
        return (pre ? s.startsWith(t) : s === t) && (x as HTMLElement).offsetParent !== null && !(x as HTMLButtonElement).disabled;
      });
      if (!b) return false;
      (b as HTMLButtonElement).click();
      return true;
    },
    text,
    prefix,
  );

async function waitFor(fn: () => Promise<boolean>, ms = 10_000, every = 150): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, every));
  }
}

/** Body text plus every input's value (line descriptions can live in inputs). */
const pageHasTextOrValue = (page: Page, text: string) =>
  page.evaluate((t) => document.body.innerText.includes(t) || [...document.querySelectorAll("input,textarea")].some((i) => (i as HTMLInputElement).value.includes(t)), text);

/** The first priced line's qty input — the est-input with no aria-label in the row that holds the first "Unit sell for …" input. */
async function firstQtyInput(page: Page) {
  const handle = await page.evaluateHandle(() => {
    const unit = document.querySelector('input[aria-label^="Unit sell for "]');
    let row: Element | null = unit?.parentElement ?? null;
    while (row && row.querySelectorAll('input[aria-label^="Unit sell for "]').length === 1) {
      const qty = [...row.querySelectorAll("input.est-input")].find((i) => !i.getAttribute("aria-label"));
      if (qty) return qty;
      row = row.parentElement;
    }
    return null;
  });
  return handle.asElement() as import("puppeteer-core").ElementHandle<HTMLInputElement> | null;
}

/**
 * The Build step really saves (PR 2 Task 4): qty +1 → Save → reload keeps the qty and the header total;
 * "+ Add part from catalog" → search → Add → Save → reload keeps the line; `?new=1` → add a system →
 * Save → the header shows an EST number above every seed estimate's.
 */
async function estimatorEditCheck(pkgDir: string, which: string | undefined): Promise<EditResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  const data = loadSliceData(pkgDir);
  const q = (which && which !== "all" ? data.estimates.find((x) => x.id === which) : data.estimates.find((x) => x.id === "Q-G001") ?? data.estimates[0]) ?? null;
  if (!q) throw new Error(`no estimate${which ? ` "${which}"` : ""} in the slice`);
  const maxSeedEstNo = Math.max(0, ...data.estimates.map((e) => (typeof e.estNo === "number" ? e.estNo : 0)));
  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const sink = newSink();
  const steps: EditResult["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ step: name, ok, ...(detail ? { detail } : {}) });
  const allowed = new Set(SMOKE_ALLOWED_UNREGISTERED);
  const unexpected = new Set<string>();
  const noteUnregistered = async (page: Page) => (await unregisteredOn(page)).filter((x) => !allowed.has(x)).forEach((x) => unexpected.add(x));
  const base = pathToFileURL(index).href;
  const url = `${base}?id=${encodeURIComponent(q.id)}`;
  const savedFlash = (page: Page) => waitFor(() => pageHasText(page, "Saved ✓"), 10_000);
  const saveError = (page: Page) => page.evaluate(() => /Not available in the prototype|did not go through/.test(document.body.innerText));
  try {
    const page = await newPage(browser, sink);
    await page.goto(url, { waitUntil: "load" });
    await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
    // A clean overlay: this profile is fresh, but reset anyway so a rerun never builds on old edits.
    await page.evaluate(async () => (window as unknown as EditH).__peakHandoff.store.reset());
    await page.goto(url, { waitUntil: "load" });
    step("estimate mounted", await waitMounted(page, sink));

    // 1 — qty +1, Save, reload
    const qtyEl = await firstQtyInput(page);
    const qty0 = qtyEl ? Number(await qtyEl.evaluate((i) => i.value)) : NaN;
    step("found the first line's qty", !!qtyEl && Number.isFinite(qty0), String(qty0));
    const total0 = await readHeaderTotal(page);
    if (qtyEl) {
      await qtyEl.click({ count: 3 });
      await qtyEl.type(String(qty0 + 1));
      await page.keyboard.press("Tab");
    }
    const changed = await waitFor(async () => (await readHeaderTotal(page)) !== total0, 5000);
    // The bonus lines and the $25 round re-derive in effects after the edit — wait for the figure to settle.
    let total1 = await readHeaderTotal(page);
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const t = await readHeaderTotal(page);
      if (t === total1 && i >= 3) break;
      total1 = t;
    }
    step("the header total moved with the qty", changed, `${total0} → ${total1}`);
    const refreshes = () => page.evaluate(() => (window as unknown as { __peakHandoff?: { propsRefreshes?: number } }).__peakHandoff?.propsRefreshes ?? 0);
    const refreshesBefore = await refreshes();
    await clickButton(page, "Save");
    const saved1 = await savedFlash(page);
    step("Save shows Saved ✓", saved1, (await saveError(page)) ? "save refused (Not available in the prototype)" : undefined);
    step("the save refreshed the props (router.refresh → buildEstimatorProps)", await waitFor(async () => (await refreshes()) > refreshesBefore, 3000), `${refreshesBefore} → ${await refreshes()}`);
    await noteUnregistered(page);
    await page.goto(url, { waitUntil: "load" });
    await waitMounted(page, sink);
    const qtyAfter = await firstQtyInput(page);
    const qty1 = qtyAfter ? Number(await qtyAfter.evaluate((i) => i.value)) : NaN;
    step("after a reload the qty is the saved one", qty1 === qty0 + 1, `${qty1} vs ${qty0 + 1}`);
    const totalAfter = await readHeaderTotal(page);
    step("after a reload the header total is the saved one", totalAfter === total1 && total1 !== total0, `${totalAfter} vs ${total1}`);
    const storedValue = await page.evaluate(async (id) => ((await (window as unknown as EditH).__peakHandoff.store.get("quotes", id)) as { value?: number } | undefined)?.value ?? null, q.id);
    const shown = Number(String(totalAfter ?? "").replace(/[^0-9.-]/g, ""));
    step("the stored value is the header total (server-reconciled)", storedValue !== null && Math.round(shown) === storedValue, `${storedValue} vs ${totalAfter}`);

    // 2 — + Add part from catalog → search → Add → Save → reload
    const opened = await clickButton(page, "+ Add part from catalog");
    step("+ Add part from catalog opens the picker", opened && (await waitFor(() => page.evaluate(() => !!document.querySelector('input[placeholder^="Search the catalog"]')), 3000)));
    const search = await page.$('input[placeholder^="Search the catalog"]');
    await search?.type("ColorSource");
    const hit = await waitFor(() => page.evaluate(() => document.querySelectorAll(".est-sug").length > 0), 5000);
    const hitInfo = await page.evaluate(() => {
      const row = document.querySelector(".est-sug");
      const desc = row?.querySelector("span span")?.textContent?.trim() ?? "";
      const sku = (row?.querySelector("span span + span")?.textContent ?? "").split(" · ")[0].trim();
      return { desc, sku };
    });
    step('searching "ColorSource" lists catalog parts', hit, `${hitInfo.desc} (${hitInfo.sku})`);
    const added = await page.evaluate(() => {
      const b = [...(document.querySelector(".est-sug")?.querySelectorAll("button") ?? [])].find((x) => x.textContent?.trim() === "Add");
      b?.click();
      return !!b;
    });
    step("Add puts the part on the system", added && (await waitFor(() => pageHasText(page, "✓ Added"), 3000)));
    await clickButton(page, "Save");
    step("Save shows Saved ✓ (catalog line)", await savedFlash(page));
    await noteUnregistered(page);
    await page.goto(url, { waitUntil: "load" });
    await waitMounted(page, sink);
    const stored = await page.evaluate(async (id) => JSON.stringify((await (window as unknown as EditH).__peakHandoff.store.get("quotes", id)) ?? null), q.id);
    step("after a reload the added line is in the store", !!hitInfo.sku && stored.includes(`"sku":${JSON.stringify(hitInfo.sku)}`), hitInfo.sku);
    step("after a reload the added line is on the page", !!hitInfo.desc && (await pageHasTextOrValue(page, hitInfo.desc)), hitInfo.desc);
    await noteUnregistered(page);
    await page.close();

    // 3 — ?new=1 → add a system → Save → EST-<n> above the seed
    const np = await newPage(browser, sink);
    await np.goto(`${base}?new=1`, { waitUntil: "load" });
    step("?new=1 opens a new, unsaved estimate (no EST number yet)", (await waitMounted(np, sink)) && !(await np.evaluate(() => /EST-\d+/.test(document.body.innerText))));
    const hasSystem = await np.evaluate(() => !!document.querySelector("input.est-secname"));
    if (!hasSystem) {
      await clickButton(np, "+ Add system");
      await waitFor(() => pageHasText(np, "Blank system"), 3000);
      await clickButton(np, "Blank system", true);
    }
    step(hasSystem ? "the new estimate has a system (it opens with one)" : "the new estimate has a system (+ Add system → Blank system)", await waitFor(() => np.evaluate(() => !!document.querySelector("input.est-secname")), 3000));
    await clickButton(np, "Save");
    step("Save shows Saved ✓ (new estimate)", await savedFlash(np), (await saveError(np)) ? "save refused" : undefined);
    const nums = await np.evaluate(() => [...document.body.innerText.matchAll(/EST-(\d+)/g)].map((m) => Number(m[1])));
    const newNo = nums.find((n) => n > maxSeedEstNo);
    step(`the header shows an EST number above the seed's max (${maxSeedEstNo})`, newNo !== undefined, newNo ? `EST-${newNo}` : nums.join(","));
    const newUrl = await np.evaluate(() => window.location.search);
    const newId = new URLSearchParams(newUrl).get("id");
    const seedIds = new Set(data.estimates.map((e) => e.id));
    step("the URL moved to the new estimate's id", !!newId && !seedIds.has(newId), newUrl);
    if (newId && !seedIds.has(newId)) {
      await np.goto(`${base}${newUrl}`, { waitUntil: "load" });
      await waitMounted(np, sink);
      step("after a reload the new estimate reopens with its number", newNo !== undefined && (await pageHasText(np, `EST-${newNo}`)));
    }
    await noteUnregistered(np);
    await np.close();
  } finally {
    await browser.close();
  }
  const unexpectedUnregistered = [...unexpected];
  const pass = steps.every((s) => s.ok) && unexpectedUnregistered.length === 0 && sink.pageErrors.length === 0 && sink.foreignRequests.length === 0 && sink.failedLocal.length === 0;
  return { pass, id: q.id, steps, unexpectedUnregistered, ...sink };
}

function printEdit(r: EditResult): void {
  console.log(`handoff:verify --estimator-edit  ${r.pass ? "PASS" : "FAIL"} (${r.id})`);
  for (const s of r.steps) console.log(`  ${s.ok ? "ok  " : "FAIL"} ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
  console.log(`  unexpected unregistered: ${r.unexpectedUnregistered.length}`);
  for (const x of r.unexpectedUnregistered) console.log(`    ${x}`);
  console.log(`  page errors: ${r.pageErrors.length}`);
  for (const e of r.pageErrors) console.log(`    ${e.split("\n").slice(0, 4).join("\n    ")}`);
  console.log(`  foreign requests: ${r.foreignRequests.length}; failed local files: ${r.failedLocal.length}`);
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
  const editAt = argv.indexOf("--estimator-edit");
  const edit = editAt >= 0 ? (argv[editAt + 1] && !argv[editAt + 1].startsWith("--") ? argv[editAt + 1] : "") : undefined;
  if (!argv.includes("--smoke") && !est && edit === undefined) {
    console.error("usage: npm run handoff:verify -- --smoke | --estimator <quoteId|all> | --estimator-edit [quoteId] [--out <package dir>]");
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
  if (edit !== undefined) {
    const r = await estimatorEditCheck(pkgDir, edit || undefined);
    writeFileSync(path.join(VERIFY_DIR, "estimator-edit.json"), JSON.stringify(r, null, 2) + "\n");
    printEdit(r);
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
