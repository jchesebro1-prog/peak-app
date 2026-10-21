/**
 * Estimator handoff — `npm run handoff:verify -- --assemblies` (PR 2 Task 9): the Assembly Builder walk, in headless
 * Chrome over the built package. Split out of verify.ts (which loads it on demand and owns the shared page helpers).
 *
 * What it proves, in order: `#/assemblies` mounts the app's real builder and lists exactly the slice's fixtures (the dev
 * slice may hold none: the list then reads "No assemblies yet", and a second page with two fixtures injected into
 * window.PEAK_FIXTURES shows them, each at the sell resolveFixture gives over the slice catalog); a new fixture built
 * from two catalog parts (light engine + lens, picked through the builder's server-search pickers) saves to the overlay
 * with its "was $X when built" snapshot and shows in the list at its sell; the Estimator then lists it under
 * "+ Add assembly", and the line it adds — saved and read back from the store — prices at the fixture's sell (cost at
 * its cost); a new rack with one device placed on its elevation saves, and its Submittal link opens
 * `#/assemblies/rack/<id>` with the elevation SVG (and the device in the schedule); a delete soft-deletes and the
 * Estimator stops listing it; Reset puts the snapshot back. No page errors, foreign requests, failed local files or unregistered actions.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as vm from "node:vm";
import { pathToFileURL } from "node:url";
import type { Page } from "puppeteer-core";
import { chromeLaunch } from "@/lib/quote-pdf/render";
import { rankCatalogParts } from "@/lib/estimating-core/catalog-rank";
import { resolveFixture, type FixtureRecord } from "@/lib/fixture-assemblies";
import { money } from "../runtime/catalog-model";
import { clickButton, estimateUrl, newPage, newSink, openUrl, pageHasText, ROOT, SMOKE_ALLOWED_UNREGISTERED, unregisteredOn, VERIFY_DIR, waitFor, waitMounted, type EditH, type PageSink } from "../verify";

type SlicePart = { id: string; sku: string; desc?: string; category?: string; unit?: string; cost?: number; list?: number; mfr?: string; renamedTo?: string; ruHeight?: number };
type AssembliesResult = { pass: boolean; sliceFixtures: number; steps: Array<{ step: string; ok: boolean; detail?: string }>; screenshots: string[]; unexpectedUnregistered: string[] } & PageSink;

/** Runs the slice's data files in a sandbox: the live catalog (renamed stubs out) and PEAK_FIXTURES. */
function loadSlice(pkgDir: string): { catalog: SlicePart[]; fixtures: Array<{ id: string }> } {
  const window: Record<string, unknown> = {};
  const ctx = vm.createContext({ window });
  const dir = path.join(pkgDir, "data");
  const files = readdirSync(dir)
    .filter((f) => /^catalog-\d+\.js$/.test(f) || f === "fixtures.js")
    .sort();
  for (const f of files) vm.runInContext(readFileSync(path.join(dir, f), "utf8"), ctx, { filename: f });
  const all = (Array.isArray(window.PEAK_CATALOG) ? window.PEAK_CATALOG : []) as SlicePart[];
  const catalog = all.filter((p) => !(typeof p.renamedTo === "string" && p.renamedTo !== "")).map((p) => (p.sku ? p : { ...p, sku: p.id }));
  return { catalog, fixtures: (Array.isArray(window.PEAK_FIXTURES) ? window.PEAK_FIXTURES : []) as Array<{ id: string }> };
}

const near = (a: number | undefined | null, b: number) => typeof a === "number" && Math.abs(a - b) < 0.005;

export async function assembliesCheck(pkgDir: string): Promise<AssembliesResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  const { catalog, fixtures: sliceFixtures } = loadSlice(pkgDir);
  // Parts the pickers find first for their own SKU (searchCatalog lower-cases the query), each with a list price, never Labor.
  const firstHit = (p: SlicePart) => rankCatalogParts(catalog, p.sku.toLowerCase())[0]?.p.sku === p.sku;
  const usable = (p: SlicePart) => (p.list ?? 0) > 0 && p.category !== "Labor" && /^[\w.:-]+$/.test(p.sku) && firstHit(p);
  const partA = catalog.find((p) => usable(p) && (p.cost ?? 0) > 0);
  const partB = catalog.find((p) => usable(p) && p !== partA);
  const partC = catalog.find((p) => usable(p) && p !== partA && p !== partB && (p.ruHeight ?? 0) > 0) ?? catalog.find((p) => usable(p) && p !== partA && p !== partB);
  if (!partA || !partB || !partC) throw new Error("the slice has no three listed parts that rank first for their own SKU");
  const bySku = new Map(catalog.map((p) => [p.sku, { sku: p.sku, desc: p.desc ?? "", unit: p.unit, cost: Number(p.cost) || 0, list: Number(p.list) || 0 }] as const));
  const wantSell = (partA.list ?? 0) + (partB.list ?? 0);
  const wantCost = (partA.cost ?? 0) + (partB.cost ?? 0);
  const FIXTURE_LABEL = "Verify fixture — two parts";
  const RACK_LABEL = "Verify rack";
  const quoteId = "Q-G001";

  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const sink = newSink();
  const steps: AssembliesResult["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ step: name, ok, ...(detail ? { detail } : {}) });
  const screenshots: string[] = [];
  const shot = async (page: Page, name: string) => {
    const file = path.join(VERIFY_DIR, `assemblies-${name}.png`);
    await page.screenshot({ path: file as `${string}.png`, fullPage: false });
    screenshots.push(file);
  };
  const allowed = new Set(SMOKE_ALLOWED_UNREGISTERED);
  const unexpected = new Set<string>();
  const noteUnregistered = async (page: Page) => (await unregisteredOn(page)).filter((x) => !allowed.has(x)).forEach((x) => unexpected.add(x));
  const base = pathToFileURL(index).href;
  const assembliesUrl = `${base}#/assemblies`;

  /** The list rows as rendered: label and the sell figure. */
  const listRows = (page: Page) =>
    page.evaluate(() => {
      const h = [...document.querySelectorAll("[data-handoff-assemblies] h2")].find((x) => x.textContent?.trim() === "Assemblies");
      const section = h?.closest("section");
      const grid = section?.querySelector(':scope > div[style*="grid"]');
      return [...(grid?.children ?? [])].map((row) => ({
        label: row.querySelector("span")?.textContent?.trim() ?? "",
        sell: (row.children[1]?.children[0] as HTMLElement | undefined)?.innerText.trim() ?? "",
        text: (row as HTMLElement).innerText,
      }));
    });
  const mountedBuilder = (page: Page) => waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-assemblies]") && [...document.querySelectorAll("h1")].some((h) => h.textContent === "Assembly Builder")), 15_000);
  const storedFixtures = (page: Page) =>
    page.evaluate(async () => JSON.stringify(await (window as unknown as EditH).__peakHandoff.store.all("fixtures"))).then((j) => JSON.parse(j) as Array<FixtureRecord & { deleted?: boolean }>);
  /** Types `q` into the combobox labelled `label` and clicks the option that shows `sku`. */
  const pickPart = async (page: Page, label: string, sku: string) => {
    const sel = `input[role="combobox"][aria-label="${label}"]`;
    await page.click(sel, { count: 3 });
    await page.keyboard.press("Backspace");
    await page.type(sel, sku);
    return waitFor(
      () =>
        page.evaluate((s) => {
          const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent ?? "").includes(s)) as HTMLElement | undefined;
          if (!opt) return false;
          opt.click();
          return true;
        }, sku),
      8000,
      150,
    );
  };
  /** Sets a <select> (React-controlled) found by one of its option's text. */
  const selectByOption = (page: Page, optionText: string, value: string) =>
    page.evaluate(
      (t, v) => {
        const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.textContent === t)) as HTMLSelectElement | undefined;
        if (!sel) return false;
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
        setter.call(sel, v);
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return sel.value === v;
      },
      optionText,
      value,
    );
  const typeLabel = async (page: Page, placeholderStart: string, text: string) => {
    const sel = `input[placeholder^="${placeholderStart}"]`;
    await page.click(sel, { count: 3 });
    await page.type(sel, text);
  };

  try {
    mkdirSync(VERIFY_DIR, { recursive: true });
    const page = await newPage(browser, sink);
    // The builder asks before leaving an unsaved draft (beforeunload): a failed step must not hang the walk on it.
    page.on("dialog", (d) => void d.accept());
    await openUrl(page, base);
    await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
    await page.evaluate(async () => (window as unknown as EditH).__peakHandoff.store.reset());

    // 1 — the real builder lists the slice's fixtures
    await openUrl(page, assembliesUrl);
    step("#/assemblies mounts the app's Assembly Builder", await mountedBuilder(page));
    step("…under the Assemblies nav tab", (await page.evaluate(() => document.querySelector('[data-handoff-nav="assemblies"]')?.getAttribute("aria-current"))) === "page");
    const rows0 = await listRows(page);
    step(`the list shows the slice's fixtures (${sliceFixtures.length})`, rows0.length === sliceFixtures.length && (sliceFixtures.length > 0 || (await pageHasText(page, "No assemblies yet"))), `${rows0.length} rows`);
    step(`the All tab counts them (${sliceFixtures.length})`, await page.evaluate((n) => [...document.querySelectorAll('[role="tab"]')].some((t) => /^All\s*\d+$/.test(t.textContent?.trim() ?? "") && t.textContent!.trim().endsWith(String(n))), sliceFixtures.length));
    await shot(page, "1-list");

    // 1b — fixtures in the slice render with their live sell (two injected into PEAK_FIXTURES on a second page)
    const injected = [
      { id: "SA-VERIFY-1", kind: "fixture", label: "Injected fixture", description: "", lightEngineSku: partA.sku, lensSku: partB.sku, lines: { data: [], power: [], mounting: [], accessories: [] }, createdAt: 1, updatedAt: 1, createdBy: "Verify", updatedBy: "Verify" },
      { id: "SA-VERIFY-2", kind: "system", label: "Injected system", description: "", scope: "Audio", lightEngineSku: "", lensSku: null, lines: { data: [], power: [], mounting: [], accessories: [] }, parts: [{ sku: partA.sku, qty: 2 }, { sku: partC.sku, qty: 1 }], createdAt: 1, updatedAt: 1, createdBy: "Verify", updatedBy: "Verify" },
    ];
    const ip = await newPage(browser, sink);
    // A string, not a function: tsx's keepNames would wrap a function's inner arrows in __name, which the page lacks.
    await ip.evaluateOnNewDocument(`(() => {
      let fx;
      const extra = ${JSON.stringify(injected)};
      Object.defineProperty(window, "PEAK_FIXTURES", { configurable: true, get: () => fx, set: (v) => { fx = Array.isArray(v) ? v.concat(extra) : v; } });
    })();`);
    await openUrl(ip, assembliesUrl);
    await mountedBuilder(ip);
    const irows = await listRows(ip);
    const wantInjected = injected.map((f) => ({ label: f.label, sell: money(resolveFixture(f as unknown as FixtureRecord, bySku).sell) }));
    step(
      "slice fixtures render in the list at the sell resolveFixture gives over the slice catalog",
      irows.length === sliceFixtures.length + 2 && wantInjected.every((w) => irows.some((r) => r.label === w.label && r.sell === w.sell)),
      `${JSON.stringify(irows.map((r) => [r.label, r.sell]))} want ${JSON.stringify(wantInjected.map((w) => [w.label, w.sell]))}`,
    );
    await shot(ip, "1b-slice-fixtures");
    await noteUnregistered(ip);
    await ip.close();

    // 2 — build a fixture from two catalog parts
    step("+ New assembly → Fixture opens the form", (await clickButton(page, "+ New assembly")) && (await clickButton(page, "Fixture")) && (await waitFor(() => pageHasText(page, "New fixture"), 3000)));
    await typeLabel(page, "e.g. ETC Source Four", FIXTURE_LABEL);
    step(`the Light engine picker finds ${partA.sku} through the builder's search`, await pickPart(page, "Light engine", partA.sku));
    step(`the Lens picker finds ${partB.sku}`, await pickPart(page, "Lens (optional)", partB.sku));
    const footer = await page.evaluate(() => [...document.querySelectorAll("div")].find((d) => d.textContent?.startsWith("Included: cost") && d.children.length >= 2)?.textContent ?? "");
    step(`the form prices it live: cost ${money(wantCost)} · sell ${money(wantSell)}`, footer.includes(`cost ${money(wantCost)}`) && footer.includes(`sell ${money(wantSell)}`), footer.slice(0, 120));
    await shot(page, "2-form");
    step("Build fixture saves", (await clickButton(page, "Build fixture")) && (await waitFor(async () => (await listRows(page)).some((r) => r.label === FIXTURE_LABEL), 8000)));
    const rowF = (await listRows(page)).find((r) => r.label === FIXTURE_LABEL);
    step(`…and the list shows it at ${money(wantSell)}`, rowF?.sell === money(wantSell), rowF?.sell);
    const savedF = (await storedFixtures(page)).find((f) => f.label === FIXTURE_LABEL);
    step(
      "…stored in the overlay: SA- id, kind fixture, both parts, the snapshot at its cost/sell, stamped",
      !!savedF && /^SA-[0-9A-Z]+$/.test(savedF.id) && savedF.kind === "fixture" && savedF.lightEngineSku === partA.sku && savedF.lensSku === partB.sku && near(savedF.snapshot?.cost, wantCost) && near(savedF.snapshot?.price, wantSell) && !!savedF.createdBy && savedF.createdBy === savedF.updatedBy && typeof savedF.createdAt === "number",
      JSON.stringify(savedF ? { id: savedF.id, snapshot: savedF.snapshot, by: savedF.createdBy } : null),
    );
    step("…resolveFixture over the slice catalog agrees with the stored record", !!savedF && near(resolveFixture(savedF, bySku).sell, wantSell) && near(resolveFixture(savedF, bySku).cost, wantCost));
    await shot(page, "3-saved");

    // 3 — the Estimator prices it at the fixture's sell
    const ep = await newPage(browser, sink);
    await openUrl(ep, estimateUrl(base, quoteId));
    step(`the Estimator opens ${quoteId}`, await waitMounted(ep, sink));
    step("+ Add assembly opens the modal", (await clickButton(ep, "+ Add assembly")) && (await waitFor(() => ep.evaluate(() => [...document.querySelectorAll("option")].some((o) => o.textContent === "— Select an assembly —")), 3000)));
    const listed = await ep.evaluate((id) => [...document.querySelectorAll("option")].some((o) => (o as HTMLOptionElement).value === id), savedF?.id ?? "");
    step("…and lists the fixture just saved in the builder", listed);
    step("picking it fills the components", (await selectByOption(ep, "— Select an assembly —", savedF?.id ?? "")) && (await waitFor(() => pageHasText(ep, partA.sku), 3000)));
    const modalSell = await ep.evaluate(() => /sell \/ ea\s*(\$[\d,.]+)/i.exec(document.body.innerText)?.[1] ?? "");
    step(`the modal's Sell / ea reads $${wantSell.toFixed(2)}`, modalSell === `$${wantSell.toFixed(2)}`, modalSell);
    await shot(ep, "4-estimator-modal");
    step("Add assembly adds the line", await clickButton(ep, "Add assembly"));
    await clickButton(ep, "Save");
    step("Save shows Saved ✓", await waitFor(() => pageHasText(ep, "Saved ✓"), 10_000));
    const quote = await ep.evaluate(async (id) => JSON.stringify((await (window as unknown as EditH).__peakHandoff.store.get("quotes", id)) ?? null), quoteId).then((j) => JSON.parse(j) as { spec?: { sections?: Array<{ items?: Array<{ sku?: string; cost?: number; price?: number; qty?: number; fixture?: boolean; components?: unknown[] }> }> } });
    const line = (quote.spec?.sections ?? []).flatMap((s) => s.items ?? []).find((l) => l.sku === savedF?.id);
    step(`the saved line prices at the fixture's sell ${money(wantSell)} (cost ${money(wantCost)}), as a fixture line with its 2 components`, !!line && line.fixture === true && near(line.price, wantSell) && near(line.cost, wantCost) && (line.components?.length ?? 0) === 2, JSON.stringify(line && { price: line.price, cost: line.cost, qty: line.qty }));
    await shot(ep, "5-estimator-line");
    await noteUnregistered(ep);
    await ep.close();

    // 4 — a rack: one device on the elevation, then its submittal sheets
    await openUrl(page, assembliesUrl);
    await mountedBuilder(page);
    step("+ New assembly → Rack opens the rack form with its RU sidebar", (await clickButton(page, "+ New assembly")) && (await clickButton(page, "Rack")) && (await waitFor(() => page.evaluate(() => !!document.querySelector("[data-rack-elevation] svg")), 5000)));
    await typeLabel(page, "e.g. AV head-end rack", RACK_LABEL);
    step("pick a scope", await selectByOption(page, "— Pick a scope —", "Audio"));
    await page.click("#rack-part-search", { count: 3 });
    await page.type("#rack-part-search", partC.sku);
    const armed = await waitFor(
      () =>
        page.evaluate((s) => {
          const b = [...document.querySelectorAll('ul[aria-label="Matching parts"] button')].find((x) => (x.textContent ?? "").includes(s)) as HTMLElement | undefined;
          if (!b) return false;
          b.click();
          return true;
        }, partC.sku),
      8000,
      150,
    );
    step(`the tray finds ${partC.sku} and arms it`, armed);
    const box = await page.evaluate(() => {
      const fig = document.querySelector("[data-rack-elevation] figure > div");
      fig?.scrollIntoView({ block: "center" });
      const r = fig?.getBoundingClientRect();
      return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
    });
    if (box) await page.mouse.click(box.x, box.y);
    await new Promise((r) => setTimeout(r, 400));
    await shot(page, "6-rack-form");
    step("Build rack saves", (await clickButton(page, "Build rack")) && (await waitFor(async () => (await listRows(page)).some((r) => r.label === RACK_LABEL), 8000)));
    const savedR = (await storedFixtures(page)).find((f) => f.label === RACK_LABEL);
    const placed = savedR?.rack?.placements ?? [];
    step(`…stored as a rack (scope Audio) with ${partC.sku} placed on the elevation`, !!savedR && savedR.kind === "rack" && savedR.scope === "Audio" && placed.some((p) => p.sku === partC.sku), JSON.stringify(placed.map((p) => ({ sku: p.sku, ruStart: p.ruStart, ruHeight: p.ruHeight }))));
    const rowR = (await listRows(page)).find((r) => r.label === RACK_LABEL);
    step("…and its list row shows the rack's scope and RU line", !!rowR && /Rack · Audio/i.test(rowR.text) && /RU/.test(rowR.text), rowR?.text.replace(/\s+/g, " ").slice(0, 160));
    // 4b — the form's own Submittal link (target="_blank") opens a new tab, so an unsaved draft survives
    const rackRowButton = (text: string) =>
      page.evaluate(
        (label, t) => {
          const h = [...document.querySelectorAll("[data-handoff-assemblies] span")].find((x) => x.textContent?.trim() === label);
          let row: Element | null | undefined = h;
          while (row && ![...row.querySelectorAll("button")].some((b) => b.textContent?.trim() === t)) row = row.parentElement;
          const b = [...(row?.querySelectorAll("button") ?? [])].find((x) => x.textContent?.trim() === t) as HTMLButtonElement | undefined;
          b?.click();
          return !!b;
        },
        RACK_LABEL,
        text,
      );
    const FORM_LINK = 'a[title^="Opens the saved rack"]';
    const opened = (await rackRowButton("Edit")) && (await waitFor(() => page.evaluate((sel) => !!document.querySelector(sel), FORM_LINK), 5000));
    step("Edit opens the saved rack in the form, with its Submittal link", opened);
    const labelSel = 'input[placeholder^="e.g. AV head-end rack"]';
    await page.click(labelSel);
    await page.keyboard.press("End");
    await page.type(labelSel, " (unsaved)");
    const dirtyBefore = () =>
      page.evaluate(() => {
        const ev = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(ev);
        return ev.defaultPrevented;
      });
    step("…the edit makes the draft dirty (a beforeunload would ask first)", await waitFor(dirtyBefore, 3000));
    const hashBefore = await page.evaluate(() => location.hash);
    const newTarget = new Promise<string | null>((resolve) => {
      const t = setTimeout(() => resolve(null), 5000);
      browser.once("targetcreated", (tg) => {
        clearTimeout(t);
        resolve(tg.url());
      });
    });
    const linkClicked = await page.evaluate((sel) => {
      const a = document.querySelector(sel) as HTMLAnchorElement | null;
      a?.click();
      return !!a && a.target === "_blank";
    }, FORM_LINK);
    const openedUrl = await newTarget;
    // The new tab's url may still be about:blank when the target is created: look it up once it has navigated.
    const tabUrls = async () => (await browser.pages()).map((p) => p.url());
    const wantHash = `#/assemblies/rack/${encodeURIComponent(savedR?.id ?? "")}`;
    const gotTab = linkClicked && (await waitFor(async () => (await tabUrls()).some((u) => u.endsWith(wantHash)), 6000));
    step("clicking the form's Submittal link (target=_blank) opens a NEW tab at #/assemblies/rack/<id>", !!gotTab && openedUrl !== null, JSON.stringify({ created: openedUrl, tabs: await tabUrls() }).slice(0, 300));
    step("…the original page is still on #/assemblies", (await page.evaluate(() => location.hash)) === hashBefore && hashBefore === "#/assemblies", hashBefore);
    step("…and its draft is still dirty (edit kept, beforeunload still asks)", (await dirtyBefore()) && (await page.evaluate((sel) => (document.querySelector(sel) as HTMLInputElement | null)?.value.endsWith("(unsaved)") ?? false, labelSel)));
    for (const p of await browser.pages()) if (p !== page && p.url().endsWith(wantHash)) await p.close().catch(() => {});
    // discard the draft (Cancel), back to the list
    await clickButton(page, "Cancel");
    await waitFor(() => page.evaluate((sel) => !document.querySelector(sel), FORM_LINK), 4000);

    const clicked = await page.evaluate((label) => {
      const h = [...document.querySelectorAll("[data-handoff-assemblies] span")].find((s) => s.textContent?.trim() === label);
      let row: Element | null | undefined = h;
      while (row && !row.querySelector("a")) row = row.parentElement;
      const a = [...(row?.querySelectorAll("a") ?? [])].find((x) => x.textContent?.trim() === "Submittal") as HTMLAnchorElement | undefined;
      a?.click();
      return !!a;
    }, RACK_LABEL);
    step("its Submittal link routes to #/assemblies/rack/<id>", clicked && (await waitFor(() => page.evaluate((id) => location.hash === `#/assemblies/rack/${encodeURIComponent(id)}`, savedR?.id ?? ""), 5000)));
    const elev = await waitFor(() => page.evaluate(() => !!document.querySelector('[data-sheet="elevation"] .rk-elev-svg svg')), 8000);
    step("the rack sheets render the elevation SVG", elev);
    const sheet = await page.evaluate(() => ({
      svg: document.querySelector('[data-sheet="elevation"] .rk-elev-svg svg')?.outerHTML.length ?? 0,
      title: document.body.innerText.includes("Rack submittal — Verify rack"),
      schedule: (document.querySelector('[data-sheet="schedule"]') as HTMLElement | null)?.innerText ?? "",
      sheets: [...document.querySelectorAll("[data-sheet]")].map((s) => s.getAttribute("data-sheet")),
    }));
    step("…under the page's title, with the schedule and power sheets, the device in the schedule", sheet.title && sheet.svg > 200 && ["elevation", "schedule", "power"].every((k) => sheet.sheets.includes(k)) && [partC.sku, partC.sku.split(":").pop() ?? partC.sku].some((t) => sheet.schedule.includes(t)), `${sheet.sheets.join(",")}; svg ${sheet.svg} chars; schedule: ${sheet.schedule.replace(/\s+/g, " ").slice(0, 200)}`);
    const links = await page.evaluate(() => ({
      hrefs: [...document.querySelectorAll("[data-handoff-rack] a[href]")].map((a) => a.getAttribute("href") ?? ""),
      downloads: (document.querySelector("[data-handoff-rack-downloads]") as HTMLElement | null)?.innerText ?? "",
    }));
    step("the rack page has no dead link: Back is #/assemblies, the .zip / .csv downloads say “not part of the prototype” inline",
      links.hrefs.every((h) => h.startsWith("#/")) && links.hrefs.includes("#/assemblies") && /not part of the prototype/i.test(links.downloads), `${links.hrefs.join(", ")} · ${links.downloads}`);
    await shot(page, "7-rack-sheets");
    step("the Assemblies tab stays current on a rack's sheets", (await page.evaluate(() => document.querySelector('[data-handoff-nav="assemblies"]')?.getAttribute("aria-current"))) === "page");
    // an unknown rack id reads as the page's notFound
    await openUrl(page, `${base}#/assemblies/rack/SA-NOPE`);
    step("an unknown rack id shows Rack not found", await waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-missing]")), 8000));

    // 5 — delete soft-deletes; the Estimator stops listing it
    await openUrl(page, assembliesUrl);
    await mountedBuilder(page);
    const del = async () =>
      page.evaluate((label) => {
        const h = [...document.querySelectorAll("[data-handoff-assemblies] span")].find((s) => s.textContent?.trim() === label);
        let row: Element | null | undefined = h;
        while (row && ![...row.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Delete")) row = row.parentElement;
        const b = [...(row?.querySelectorAll("button") ?? [])].find((x) => x.textContent?.trim() === "Delete") as HTMLButtonElement | undefined;
        b?.click();
        return !!b;
      }, FIXTURE_LABEL);
    step("Delete asks to confirm", (await del()) && (await waitFor(() => pageHasText(page, `Delete ${FIXTURE_LABEL}?`), 3000)));
    await clickButton(page, `Delete ${FIXTURE_LABEL}?`);
    step("…and the fixture leaves the list", await waitFor(async () => !(await listRows(page)).some((r) => r.label === FIXTURE_LABEL), 6000));
    const after = (await storedFixtures(page)).find((f) => f.id === savedF?.id);
    step("…soft-deleted in the overlay (a marker row, so its id is never minted again)", after?.deleted === true);
    await noteUnregistered(page);
    const ep2 = await newPage(browser, sink);
    await openUrl(ep2, estimateUrl(base, quoteId));
    await waitMounted(ep2, sink);
    await clickButton(ep2, "+ Add assembly");
    const stillListed = await waitFor(() => ep2.evaluate(() => [...document.querySelectorAll("option")].some((o) => o.textContent === "— Select an assembly —")), 3000).then(() =>
      ep2.evaluate((id) => [...document.querySelectorAll("option")].some((o) => (o as HTMLOptionElement).value === id), savedF?.id ?? ""),
    );
    const rackListed = await ep2.evaluate((id) => [...document.querySelectorAll("option")].some((o) => (o as HTMLOptionElement).value === id), savedR?.id ?? "");
    step("…and the Estimator's + Add assembly no longer lists it (the rack still is, under Racks)", !stillListed && rackListed);
    await noteUnregistered(ep2);
    await ep2.close();

    // 6 — Reset puts the snapshot back
    await page.click("[data-handoff-reset]");
    await waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-reset-confirm]")), 3000);
    await Promise.all([page.waitForNavigation({ waitUntil: "load", timeout: 20_000 }), page.click("[data-handoff-reset-confirm]")]);
    await mountedBuilder(page);
    step("Reset reloads onto #/assemblies with the slice's fixtures only", (await page.evaluate(() => location.hash)) === "#/assemblies" && (await listRows(page)).length === sliceFixtures.length && (await storedFixtures(page)).length === sliceFixtures.length);
    await noteUnregistered(page);
    await page.close();
  } catch (e) {
    step("the walk completed", false, e instanceof Error ? (e.stack ?? e.message).split("\n").slice(0, 4).join(" | ") : String(e));
  } finally {
    await browser.close();
  }
  const unexpectedUnregistered = [...unexpected];
  const pass = steps.every((s) => s.ok) && unexpectedUnregistered.length === 0 && sink.pageErrors.length === 0 && sink.foreignRequests.length === 0 && sink.failedLocal.length === 0;
  return { pass, sliceFixtures: sliceFixtures.length, steps, screenshots, unexpectedUnregistered, ...sink };
}

export function printAssemblies(r: AssembliesResult): void {
  console.log(`handoff:verify --assemblies  ${r.pass ? "PASS" : "FAIL"} (${r.sliceFixtures} slice fixtures)`);
  for (const s of r.steps) console.log(`  ${s.ok ? "ok  " : "FAIL"} ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
  console.log(`  unexpected unregistered: ${r.unexpectedUnregistered.length}`);
  for (const x of r.unexpectedUnregistered) console.log(`    ${x}`);
  console.log(`  page errors: ${r.pageErrors.length}`);
  for (const e of r.pageErrors) console.log(`    ${e.split("\n").slice(0, 4).join("\n    ")}`);
  console.log(`  foreign requests: ${r.foreignRequests.length}; failed local files: ${r.failedLocal.length}`);
  for (const u of [...r.foreignRequests, ...r.failedLocal]) console.log(`    ${u}`);
  if (r.consoleErrors.length) {
    console.log(`  console errors (all but the benign ones are page errors too): ${r.consoleErrors.length}`);
    for (const e of r.consoleErrors.slice(0, 10)) console.log(`    ${e.slice(0, 200)}`);
  }
  console.log(`  screenshots: ${r.screenshots.map((f) => path.relative(ROOT, f)).join(", ")}`);
}
