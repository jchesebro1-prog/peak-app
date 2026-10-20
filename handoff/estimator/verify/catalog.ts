/**
 * Estimator handoff — `npm run handoff:verify -- --catalog` (PR 2 Task 8): the Catalog screen walk, in headless Chrome over
 * the built package. Split out of verify.ts (which loads it on demand and owns the shared page helpers). See verify.ts's header.
 *
 * What it proves, in order: the first page of `#/catalog` paints within 2 s over the whole slice (logged), never more than
 * 100 rows; the facets (category, manufacturer) count what they filter; the search ranks exactly like the Estimator's
 * picker (the first page against rankCatalogParts run here over the slice); a known SKU is the first result; editing a
 * part's list price saves to the overlay, survives a reload, and the Estimator then adds the part at the edited price —
 * a part with NO cost sells at its list price, a part WITH a cost sells at cost ÷ (1 − margin) and its list does not
 * move the line (catalogAddPrice); a new part's SKU is unique (case-insensitively); a Reviewer can look but not edit;
 * Reset to production snapshot puts the edits back.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as vm from "node:vm";
import { pathToFileURL } from "node:url";
import type { Page } from "puppeteer-core";
import { chromeLaunch } from "@/lib/quote-pdf/render";
import { isFabricPart } from "@/lib/fabric-part";
import { rankCatalogParts } from "@/lib/estimating-core/catalog-rank";
import { catalogAddPrice, seedMarginOf } from "@/lib/estimating-core/tier-reprice";
import { CURRENT_USER_KEY } from "../runtime/ports";
import { money } from "../runtime/catalog-model";
import { clickButton, estimateUrl, newPage, newSink, openUrl, pageHasText, ROOT, SMOKE_ALLOWED_UNREGISTERED, unregisteredOn, VERIFY_DIR, waitFor, waitMounted, type EditH, type PageSink } from "../verify";
import { VERIFY_REVIEWER } from "./shell";

type SlicePart = { id: string; sku?: string; desc?: string; category?: string; unit?: string; cost?: number; list?: number; mfr?: string; manufacturerModelNumber?: string; formerSkus?: string[]; renamedTo?: string; pricedAt?: number; curtainAreaRate?: number; oz?: number; ozBasis?: string; flameRating?: string };
type CatalogResult = { pass: boolean; parts: number; firstPaintMs: number | null; steps: Array<{ step: string; ok: boolean; detail?: string }>; screenshots: string[]; unexpectedUnregistered: string[] } & PageSink;

/** The slice's live catalog parts (retired-SKU stubs left out, as the store does). */
function loadSliceCatalog(pkgDir: string): SlicePart[] {
  const window: Record<string, unknown> = {};
  const ctx = vm.createContext({ window });
  const dir = path.join(pkgDir, "data");
  const files = readdirSync(dir)
    .filter((f) => /^catalog-\d+\.js$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  for (const f of files) vm.runInContext(readFileSync(path.join(dir, f), "utf8"), ctx, { filename: f });
  const all = (Array.isArray(window.PEAK_CATALOG) ? window.PEAK_CATALOG : []) as SlicePart[];
  return all.filter((p) => !(typeof p.renamedTo === "string" && p.renamedTo !== "")).map((p) => (p.sku ? p : { ...p, sku: p.id }));
}

const sku = (p: SlicePart) => p.sku as string;
const count = <T,>(rows: T[], key: (r: T) => string) => {
  const m = new Map<string, number>();
  for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return m;
};

export async function catalogCheck(pkgDir: string): Promise<CatalogResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  const catalog = loadSliceCatalog(pkgDir);
  if (catalog.length < 200) throw new Error(`the slice's catalog has only ${catalog.length} parts — --catalog needs the full slice`);
  // Known parts: A has no cost (its list price drives an estimate line), B has a cost. Both are the #1 hit for their own SKU.
  const firstHit = (p: SlicePart) => rankCatalogParts(catalog as Array<SlicePart & { sku: string }>, sku(p))[0]?.p.sku === sku(p);
  const partA = catalog.find((p) => !(p.cost && p.cost > 0) && (p.list ?? 0) > 0 && firstHit(p));
  const partB = catalog.find((p) => (p.cost ?? 0) > 0 && (p.list ?? 0) > 0 && p !== partA && firstHit(p));
  if (!partA || !partB) throw new Error("the slice has no cost-less and costed parts that rank first for their own SKU");
  // A fabric part carrying fabric facts (rate / weight / flame rating), if the slice has one that ranks first for its SKU.
  const partF = catalog.find((p) => isFabricPart(p) && (p.curtainAreaRate || p.oz || p.flameRating) && firstHit(p) && p !== partA && p !== partB);
  const listA = partA.list as number;
  const newListA = Math.round((listA + 123) * 100) / 100;
  const costB = partB.cost as number;
  const newCostB = Math.round((costB + 40) * 100) / 100;
  const newListB = Math.round(((partB.list as number) + 777) * 100) / 100;
  const quoteId = "Q-G001";

  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const sink = newSink();
  const steps: CatalogResult["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ step: name, ok, ...(detail ? { detail } : {}) });
  const screenshots: string[] = [];
  const shot = async (page: Page, name: string) => {
    const file = path.join(VERIFY_DIR, `catalog-${name}.png`);
    await page.screenshot({ path: file as `${string}.png` });
    screenshots.push(file);
  };
  const allowed = new Set(SMOKE_ALLOWED_UNREGISTERED);
  const unexpected = new Set<string>();
  const noteUnregistered = async (page: Page) => (await unregisteredOn(page)).filter((x) => !allowed.has(x)).forEach((x) => unexpected.add(x));
  const base = pathToFileURL(index).href;
  const catalogUrl = `${base}#/catalog`;
  let firstPaintMs: number | null = null;

  const rowSkus = (page: Page) => page.evaluate(() => [...document.querySelectorAll("[data-catalog-rows] tr[data-catalog-sku]")].map((r) => r.getAttribute("data-catalog-sku") as string));
  const cell = (page: Page, s: string, col: string) =>
    page.evaluate((i, c) => (document.querySelector(`tr[data-catalog-sku="${CSS.escape(i)}"] td[data-col="${c}"]`) as HTMLElement | null)?.innerText.trim() ?? null, s, col);
  const text = (page: Page, sel: string) => page.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText.trim() ?? null, sel);
  const probe = (page: Page) => page.evaluate(() => (window as unknown as { __peakHandoff: { catalogFirstPaintMs?: number; catalogMountMs?: number; catalogSearchMs?: number } }).__peakHandoff);
  const search = async (page: Page, q: string) => {
    await page.click("input[data-catalog-search]", { count: 3 });
    await page.keyboard.press("Backspace");
    if (q) await page.type("input[data-catalog-search]", q);
  };
  /** Waits until the results settle on a state `ok` accepts (typing is deferred, so the rows lag the box). */
  const settle = (page: Page, ok: (skus: string[]) => boolean) => waitFor(async () => ok(await rowSkus(page)), 8000, 100);
  const field = (name: string) => `[data-catalog-drawer] [data-catalog-field="${name}"]`;
  const setField = async (page: Page, name: string, value: string) => {
    try {
      await page.click(field(name), { count: 3 });
      await page.keyboard.press("Backspace");
      if (value) await page.type(field(name), value);
    } catch (e) {
      throw new Error(`setField(${name}): ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const openPart = async (page: Page, s: string) => {
    await page.click(`tr[data-catalog-sku="${s}"] [data-catalog-open]`);
    // The drawer slides in (0.22 s): wait until it has stopped, or a click would land off-screen.
    return waitFor(() => page.evaluate(() => (document.querySelector("[data-catalog-drawer] aside")?.getBoundingClientRect().right ?? Infinity) <= window.innerWidth + 1), 3000, 50);
  };
  const stored = (page: Page, s: string) =>
    page.evaluate(async (i) => JSON.stringify((await (window as unknown as EditH).__peakHandoff.store.get("catalog", i)) ?? null), s).then((j) => JSON.parse(j) as SlicePart | null);
  const rosterInject = `(() => {
    let team;
    const extra = ${JSON.stringify(VERIFY_REVIEWER)};
    Object.defineProperty(window, "PEAK_TEAM", {
      configurable: true,
      get: () => team,
      set: (v) => { team = Array.isArray(v) ? v.filter((u) => u && u.id !== extra.id).concat([extra]) : v; },
    });
  })();`;

  try {
    mkdirSync(VERIFY_DIR, { recursive: true });
    const page = await newPage(browser, sink);
    await openUrl(page, base);
    await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
    await page.evaluate(async () => (window as unknown as EditH).__peakHandoff.store.reset());

    // 1 — first paint, row cap, count
    const t0 = Date.now();
    await openUrl(page, catalogUrl);
    const painted = await waitFor(() => page.evaluate(() => !!document.querySelector("[data-catalog-painted]")), 15_000, 50);
    const wall = Date.now() - t0;
    const pr = await probe(page);
    firstPaintMs = pr?.catalogFirstPaintMs ?? null;
    console.log(`  catalog first paint: ${firstPaintMs} ms from navigation start (route mount → rows ${pr?.catalogMountMs} ms; goto + paint ${wall} ms wall)`);
    step("#/catalog paints its first page of rows", painted && (await rowSkus(page)).length > 0, `${(await rowSkus(page)).length} rows`);
    step("…within 2 s of navigation start on the full slice (logged above)", firstPaintMs !== null && firstPaintMs <= 2000, `${firstPaintMs} ms`);
    const rows0 = await rowSkus(page);
    step("the table never renders more than 100 rows", rows0.length === 100, `${rows0.length}`);
    const countText = (await text(page, "[data-catalog-count]")) ?? "";
    step(`the header counts the slice's ${catalog.length.toLocaleString("en-US")} parts`, countText.startsWith(`${catalog.length.toLocaleString("en-US")} parts`), countText);
    const rangeText = (await text(page, "[data-catalog-range]")) ?? "";
    step("…and the pager reads Showing 1–100 of N", rangeText === `Showing 1–100 of ${catalog.length.toLocaleString("en-US")}`, rangeText);
    const expectedPage1 = rankCatalogParts(catalog as Array<SlicePart & { sku: string }>, "").slice(0, 100).map((s) => s.p.sku);
    step("with no search the order is the picker's ranking (alphabetical by description)", JSON.stringify(rows0) === JSON.stringify(expectedPage1));
    const thumbSrc = await page.evaluate(() => (document.querySelector("[data-catalog-thumb]") as HTMLImageElement | null)?.getAttribute("src") ?? "");
    step("every row has a thumbnail (the packaged “coming soon” placeholder until Task 11 ships photos)", /app\/assets\/placeholders\/coming-soon\.webp$/.test(thumbSrc) || /^images\//.test(thumbSrc), thumbSrc);
    const cols = await page.evaluate(() => [...document.querySelectorAll("thead th")].map((t) => (t.textContent ?? "").trim()));
    step("columns: photo · SKU / model · Description · Manufacturer · Category · Unit · Cost · List", cols.join("|") === "|SKU / model|Description|Manufacturer|Category|Unit|Cost|List", cols.join("|"));
    await shot(page, "1-browse");

    // 2 — paging
    await page.click("[data-catalog-next]");
    await waitFor(async () => (await text(page, "[data-catalog-range]")) === `Showing 101–200 of ${catalog.length.toLocaleString("en-US")}`, 3000);
    const rows1 = await rowSkus(page);
    const expectedPage2 = rankCatalogParts(catalog as Array<SlicePart & { sku: string }>, "").slice(100, 200).map((s) => s.p.sku);
    step("Next shows rows 101–200, still at most 100", rows1.length === 100 && JSON.stringify(rows1) === JSON.stringify(expectedPage2), `${rows1.length}`);
    await page.click("[data-catalog-prev]");
    step("Previous returns to page 1", await waitFor(async () => (await text(page, "[data-catalog-page]"))?.startsWith("Page 1 of ") === true, 3000));

    // 3 — facets
    const catCounts = [...count(catalog, (p) => p.category || "")].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const mfrCounts = [...count(catalog, (p) => p.mfr || "")].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const catOptions = await page.evaluate(() => [...document.querySelectorAll("select[data-catalog-facet-category] option")].map((o) => (o as HTMLOptionElement).text));
    step("the Category facet lists every category with its count, biggest first", catOptions.length === catCounts.length + 1 && catOptions[1] === `${catCounts[0][0] || "(none)"} (${catCounts[0][1].toLocaleString("en-US")})`, `${catOptions.length - 1} categories; top ${catOptions[1]}`);
    const mfrOptions = await page.evaluate(() => [...document.querySelectorAll("select[data-catalog-facet-mfr] option")].map((o) => (o as HTMLOptionElement).text));
    step("the Manufacturer facet likewise", mfrOptions.length === mfrCounts.length + 1 && mfrOptions[1] === `${mfrCounts[0][0] || "(none)"} (${mfrCounts[0][1].toLocaleString("en-US")})`, `${mfrOptions.length - 1} manufacturers; top ${mfrOptions[1]}`);
    const [topCat, topCatN] = catCounts[0];
    await page.select("select[data-catalog-facet-category]", `v:${topCat}`);
    await waitFor(async () => ((await text(page, "[data-catalog-range]")) ?? "").endsWith(`of ${topCatN.toLocaleString("en-US")}`), 3000);
    const catRows = await page.evaluate(() => [...document.querySelectorAll("[data-catalog-rows] td[data-col=category]")].map((c) => (c as HTMLElement).innerText.trim()));
    step(`picking Category “${topCat}” narrows to exactly its ${topCatN.toLocaleString("en-US")} parts, all in that category`, ((await text(page, "[data-catalog-range]")) ?? "").endsWith(`of ${topCatN.toLocaleString("en-US")}`) && catRows.length > 0 && catRows.every((c) => c === (topCat || "—")), (await text(page, "[data-catalog-range]")) ?? "");
    // crossed: the manufacturer counts now describe only this category
    const inCat = catalog.filter((p) => (p.category || "") === topCat);
    const mfrInCat = [...count(inCat, (p) => p.mfr || "")].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const mfrOptions2 = await page.evaluate(() => [...document.querySelectorAll("select[data-catalog-facet-mfr] option")].map((o) => (o as HTMLOptionElement).text));
    step("…and the Manufacturer counts follow (crossed facets)", mfrOptions2.length === mfrInCat.length + 1 && mfrOptions2[1] === `${mfrInCat[0][0] || "(none)"} (${mfrInCat[0][1].toLocaleString("en-US")})`, `${mfrOptions2[1]}`);
    const [topMfr, topMfrN] = mfrInCat[0];
    await page.select("select[data-catalog-facet-mfr]", `v:${topMfr}`);
    await waitFor(async () => ((await text(page, "[data-catalog-range]")) ?? "").endsWith(`of ${topMfrN.toLocaleString("en-US")}`), 3000);
    step(`…then Manufacturer “${topMfr}” narrows to the ${topMfrN.toLocaleString("en-US")} parts in both`, ((await text(page, "[data-catalog-range]")) ?? "").endsWith(`of ${topMfrN.toLocaleString("en-US")}`));
    await page.click("[data-catalog-clear]");
    step("Clear filters restores the whole catalog", await waitFor(async () => ((await text(page, "[data-catalog-range]")) ?? "").endsWith(`of ${catalog.length.toLocaleString("en-US")}`), 3000));

    // 4 — search ranks like the picker
    for (const q of ["colorsource", "cable", partB.manufacturerModelNumber || sku(partB).split(":")[1] || "case"]) {
      const want = rankCatalogParts(catalog as Array<SlicePart & { sku: string }>, q);
      const expected = want.slice(0, 100).map((s) => s.p.sku);
      await search(page, q);
      const ok = await settle(page, (s) => JSON.stringify(s) === JSON.stringify(expected));
      step(`searching “${q}” lists the picker's ranking (${want.length.toLocaleString("en-US")} matches, first ${expected.length} rows identical)`, ok, ok ? `search ${(await probe(page)).catalogSearchMs} ms` : `got ${(await rowSkus(page)).slice(0, 3).join(",")}… want ${expected.slice(0, 3).join(",")}…`);
    }
    await search(page, "zzzz-no-such-part-zzzz");
    step("a search with no match says so", await waitFor(() => page.evaluate(() => !!document.querySelector("[data-catalog-empty]")), 5000));

    // 5 — a known SKU is first; edit its list price
    await search(page, sku(partA));
    step(`searching the SKU ${sku(partA)} puts it first`, await settle(page, (s) => s[0] === sku(partA)), (await rowSkus(page)).slice(0, 3).join(","));
    step("…its row shows cost $0.00 and the slice's list", (await cell(page, sku(partA), "cost")) === money(0) && (await cell(page, sku(partA), "list")) === money(listA), `${await cell(page, sku(partA), "cost")} / ${await cell(page, sku(partA), "list")}`);
    step("opening it shows the part editor", await openPart(page, sku(partA)));
    step("…with the slice's values", (await page.$eval(field("list"), (i) => (i as HTMLInputElement).value)) === String(listA) && (await page.$eval(field("sku"), (i) => (i as HTMLInputElement).value)) === sku(partA) && (await page.$eval(field("sku"), (i) => (i as HTMLInputElement).disabled)));
    await shot(page, "2-editor");
    await page.keyboard.press("Escape");
    step("Escape closes the editor and focus returns to the row", (await waitFor(() => page.evaluate(() => !document.querySelector("[data-catalog-drawer]")), 3000)) && (await page.evaluate(() => document.activeElement?.hasAttribute("data-catalog-open") ?? false)));
    await openPart(page, sku(partA));
    step("Save is off until something changes", await page.$eval("[data-catalog-save]", (b) => (b as HTMLButtonElement).disabled));
    await setField(page, "list", "-5");
    await page.click("[data-catalog-save]");
    step("a negative list price is refused with a message", await waitFor(() => page.evaluate(() => !!document.querySelector("[data-catalog-drawer] [data-catalog-error]")), 3000));
    await setField(page, "list", String(newListA));
    await setField(page, "desc", "");
    await page.click("[data-catalog-save]");
    step("an empty description is refused", await waitFor(() => page.evaluate(() => /description is required/i.test(document.querySelector("[data-catalog-drawer]")?.textContent ?? "")), 3000));
    await setField(page, "desc", `${partA.desc} (edited)`);
    await page.click("[data-catalog-save]");
    step("Save closes the editor and flashes “Saved ✓”", (await waitFor(() => page.evaluate(() => !document.querySelector("[data-catalog-drawer]")), 5000)) && (await waitFor(async () => ((await text(page, "[data-catalog-saved]")) ?? "").startsWith("Saved ✓"), 3000)));
    step(`…and the row now shows the new list price ${money(newListA)}`, await waitFor(async () => (await cell(page, sku(partA), "list")) === money(newListA), 3000), (await cell(page, sku(partA), "list")) ?? "");
    const sA = await stored(page, sku(partA));
    step("the overlay holds the edit: list, description, updatedAt, and pricedAt moved with the price", !!sA && sA.list === newListA && sA.desc === `${partA.desc} (edited)` && typeof (sA as { updatedAt?: number }).updatedAt === "number" && (sA.pricedAt ?? 0) > (partA.pricedAt ?? 0), JSON.stringify({ list: sA?.list, pricedAt: sA?.pricedAt }));
    step("…and the cost it never touched is still 0", !!sA && (sA.cost ?? 0) === 0);
    // narrative + rack through the editor
    await openPart(page, sku(partA));
    await setField(page, "narrativeText", "A verify-written paragraph.");
    await page.evaluate(() => ((document.querySelector("[data-catalog-rack]") as HTMLDetailsElement).open = true));
    await setField(page, "rack_ruHeight", "2");
    await page.select(field("rack_rackMount"), "rack");
    await page.click("[data-catalog-save]");
    await waitFor(() => page.evaluate(() => !document.querySelector("[data-catalog-drawer]")), 5000);
    const sA2 = (await stored(page, sku(partA))) as (SlicePart & { narrativeText?: string; narrativeUpdatedBy?: string; ruHeight?: number; rackMount?: string }) | null;
    step("the narrative paragraph and rack data save too (stamped with who wrote the paragraph)", !!sA2 && sA2.narrativeText === "A verify-written paragraph." && !!sA2.narrativeUpdatedBy && sA2.ruHeight === 2 && sA2.rackMount === "rack", JSON.stringify({ n: sA2?.narrativeText, by: sA2?.narrativeUpdatedBy, ru: sA2?.ruHeight, m: sA2?.rackMount }));
    await openPart(page, sku(partA));
    await page.evaluate(() => ((document.querySelector("[data-catalog-rack]") as HTMLDetailsElement).open = true));
    await setField(page, "rack_ruHeight", "0.3");
    await page.click("[data-catalog-save]");
    step("an RU height that isn't in half-RU steps is refused", await waitFor(() => page.evaluate(() => /RU height/.test(document.querySelector("[data-catalog-drawer]")?.textContent ?? "")), 3000));
    await setField(page, "rack_ruHeight", "2");
    for (const [raw, label] of [["1e3", "an exponent"], ["0x10", "a hex number"], ["1,23,4", "garbled commas"]] as const) {
      await setField(page, "list", raw);
      await page.click("[data-catalog-save]");
      step(`a list price of ${label} ("${raw}") is refused`, await waitFor(() => page.evaluate(() => /Enter a number, zero or more/.test(document.querySelector("[data-catalog-drawer]")?.textContent ?? "")), 3000));
    }
    await setField(page, "list", "12.345");
    await page.click("[data-catalog-save]");
    step("a list price with more than 2 decimals is refused, not rounded", (await waitFor(() => page.evaluate(() => /Use at most 2 decimal places/.test(document.querySelector("[data-catalog-drawer]")?.textContent ?? "")), 3000)) && ((await stored(page, sku(partA)))?.list === newListA));
    await page.click("[data-catalog-cancel]");
    if (partF) {
      await search(page, sku(partF));
      await settle(page, (s) => s[0] === sku(partF));
      await openPart(page, sku(partF));
      await setField(page, "category", "Cable");
      await page.click("[data-catalog-save]");
      step(`a fabric part (${sku(partF)}) moved out of Fabric is refused with the app's message`, await waitFor(() => page.evaluate(() => /Only a fabric part/.test(document.querySelector("[data-catalog-drawer]")?.textContent ?? "")), 3000));
      const fStored = await stored(page, sku(partF));
      step("…and the stored fabric facts are untouched", !fStored || (fStored.category === partF.category && fStored.curtainAreaRate === partF.curtainAreaRate && fStored.oz === partF.oz && fStored.flameRating === partF.flameRating));
      await page.click("[data-catalog-cancel]");
    } else {
      step("fabric guard in the browser: the slice has no fabric part with fabric facts that ranks first — unit test only", true, "see scripts/test-handoff-runtime.ts");
    }

    // the edit to part B: cost and list both move
    await search(page, sku(partB));
    await settle(page, (s) => s[0] === sku(partB));
    await openPart(page, sku(partB));
    await setField(page, "cost", String(newCostB));
    await setField(page, "list", String(newListB));
    await page.click("[data-catalog-save]");
    await waitFor(async () => (await cell(page, sku(partB), "cost")) === money(newCostB), 5000);
    const sB = await stored(page, sku(partB));
    step("a costed part's cost and list save to the overlay", !!sB && sB.cost === newCostB && sB.list === newListB, JSON.stringify({ cost: sB?.cost, list: sB?.list }));
    await noteUnregistered(page);

    // 6 — survives a reload
    await openUrl(page, catalogUrl);
    await waitFor(() => page.evaluate(() => !!document.querySelector("[data-catalog-painted]")), 15_000);
    await search(page, sku(partA));
    await settle(page, (s) => s[0] === sku(partA));
    step("after a reload the edited list price is still there", (await cell(page, sku(partA), "list")) === money(newListA), (await cell(page, sku(partA), "list")) ?? "");
    // an open drawer is not rebuilt under the user; Save notices a change made since it opened. (The store keeps each window's
    // overlay in memory, so another WINDOW's write is invisible until a reload — the changes here come from the same store
    // object through the page, standing in for any other writer.)
    await search(page, sku(partB));
    await settle(page, (s) => s[0] === sku(partB));
    await openPart(page, sku(partB));
    await setField(page, "desc", "Typed in window 1");
    await page.evaluate(async (s) => {
      const st = (window as unknown as EditH).__peakHandoff.store;
      const cur = (await st.get("catalog", s)) as Record<string, unknown>;
      await st.put("catalog", { ...cur, desc: "Written by another writer", updatedAt: Date.now() + 1 } as unknown as { id: string });
    }, sku(partB));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await new Promise((r) => setTimeout(r, 400));
    step("a change elsewhere does not rewrite the open form (your typing and Save stay)", (await page.$eval(field("desc"), (i) => (i as HTMLTextAreaElement).value)) === "Typed in window 1" && !(await page.$eval("[data-catalog-save]", (b) => (b as HTMLButtonElement).disabled)));
    await page.click("[data-catalog-save]");
    step("Save then refuses: “This part changed in another window — reload it?”", await waitFor(() => page.evaluate(() => /changed in another window — reload it\?/.test(document.querySelector("[data-catalog-stale]")?.textContent ?? "")), 3000));
    step("…and the other writer's description is still what is stored", (await stored(page, sku(partB)))?.desc === "Written by another writer");
    await page.click("[data-catalog-reload]");
    step("Reload brings the stored version into the form and clears the notice", (await waitFor(() => page.evaluate(() => !document.querySelector("[data-catalog-stale]")), 3000)) && (await page.$eval(field("desc"), (i) => (i as HTMLTextAreaElement).value)) === "Written by another writer" && (await page.$eval("[data-catalog-save]", (b) => (b as HTMLButtonElement).disabled)));
    await page.click("[data-catalog-cancel]");
    await page.close();

    // 7 — the Estimator adds both parts at the edited prices
    const ep = await newPage(browser, sink);
    await openUrl(ep, estimateUrl(base, quoteId));
    step("the Estimator opens on the default estimate", await waitMounted(ep, sink));
    const addFromPicker = async (s: string) => {
      const input = await ep.$('input[placeholder^="Search the catalog"]');
      if (!input) return false;
      await input.click({ count: 3 });
      await ep.keyboard.press("Backspace");
      await input.type(s);
      const clicked = await waitFor(
        () =>
          ep.evaluate((want) => {
            const row = [...document.querySelectorAll(".est-sug")].find((r) => (r.textContent ?? "").includes(want));
            const b = [...(row?.querySelectorAll("button") ?? [])].find((x) => x.textContent?.trim() === "Add");
            if (!b) return false;
            b.click();
            return true;
          }, s),
        6000,
        150,
      );
      return clicked && (await waitFor(() => pageHasText(ep, "✓ Added"), 3000));
    };
    const opened = await clickButton(ep, "+ Add part from catalog");
    step("+ Add part from catalog opens the picker", opened && (await waitFor(() => ep.evaluate(() => !!document.querySelector('input[placeholder^="Search the catalog"]')), 3000)));
    step(`the picker finds the edited ${sku(partA)} and adds it`, await addFromPicker(sku(partA)));
    await new Promise((r) => setTimeout(r, 2200)); // the “✓ Added” note clears itself
    step(`…and the edited ${sku(partB)}`, await addFromPicker(sku(partB)));
    await clickButton(ep, "Save");
    step("Save shows Saved ✓", await waitFor(() => pageHasText(ep, "Saved ✓"), 10_000));
    const quote = await ep.evaluate(async (id) => JSON.stringify((await (window as unknown as EditH).__peakHandoff.store.get("quotes", id)) ?? null), quoteId).then((j) => JSON.parse(j) as { tierMargin?: number | null; spec?: { sections?: Array<{ items?: Array<{ sku?: string; cost?: number; price?: number; qty?: number }> }> } });
    const lines = (quote.spec?.sections ?? []).flatMap((s) => s.items ?? []);
    const lineA = lines.find((l) => l.sku === sku(partA));
    const lineB = lines.find((l) => l.sku === sku(partB));
    const margin = quote.tierMargin ?? null;
    const wantA = catalogAddPrice(0, newListA, margin);
    const wantB = catalogAddPrice(newCostB, newListB, margin);
    console.log(`  estimate ${quoteId}: tierMargin ${margin} → seed margin ${seedMarginOf(margin)}; ${sku(partA)} cost 0 list ${newListA} → line ${lineA?.price}; ${sku(partB)} cost ${newCostB} list ${newListB} → line ${lineB?.price}`);
    step(`a part with NO cost sells at its edited LIST price: ${sku(partA)} line = ${money(newListA)}`, !!lineA && lineA.cost === 0 && lineA.price === newListA && wantA === newListA, JSON.stringify(lineA));
    step(`a part WITH a cost sells at cost ÷ (1 − ${seedMarginOf(margin)}) = ${money(wantB)}, and its list ${money(newListB)} does not drive the line`, !!lineB && lineB.cost === newCostB && lineB.price === wantB && wantB !== newListB, JSON.stringify(lineB));
    await noteUnregistered(ep);
    await ep.close();

    // 8 — a new part: unique SKU
    const np = await newPage(browser, sink);
    await openUrl(np, catalogUrl);
    await waitFor(() => np.evaluate(() => !!document.querySelector("[data-catalog-painted]")), 15_000);
    await np.click("[data-catalog-new]");
    step("New part opens a blank editor", await waitFor(() => np.evaluate(() => (document.querySelector("[data-catalog-drawer] aside")?.getBoundingClientRect().right ?? Infinity) <= window.innerWidth + 1), 3000, 50));
    await np.type(field("sku"), sku(partA).toUpperCase() === sku(partA) ? sku(partA).toLowerCase() : sku(partA).toUpperCase());
    step("a SKU that differs from an existing one only by case is refused as already in the catalog", await waitFor(() => np.evaluate(() => /already in the catalog/.test(document.querySelector("[data-catalog-drawer]")?.textContent ?? "")), 3000));
    await setField(np, "desc", "Verify new part");
    await np.click("[data-catalog-save]");
    step("…and Add part won't save it", (await waitFor(() => np.evaluate(() => /already in the catalog/.test(document.querySelector("[data-catalog-drawer]")?.textContent ?? "")), 3000)) && (await np.evaluate(() => !!document.querySelector("[data-catalog-drawer]"))));
    const NEW_SKU = "ZZ-VERIFY-PART-1";
    await setField(np, "sku", NEW_SKU);
    await setField(np, "cost", "10");
    await setField(np, "list", "25");
    await setField(np, "mfr", "Verify Mfr");
    await np.click("[data-catalog-save]");
    step("a unique SKU saves", (await waitFor(() => np.evaluate(() => !document.querySelector("[data-catalog-drawer]")), 5000)) && (await waitFor(async () => ((await text(np, "[data-catalog-saved]")) ?? "").startsWith("Added ✓"), 3000)));
    const sN = await stored(np, NEW_SKU);
    step("…as a catalog doc with id = sku, the default category and unit", !!sN && sN.id === NEW_SKU && sN.cost === 10 && sN.list === 25 && sN.category === "Uncategorized" && sN.unit === "ea" && sN.mfr === "Verify Mfr", JSON.stringify(sN));
    await search(np, NEW_SKU);
    step("…and search finds it first", await settle(np, (s) => s[0] === NEW_SKU));
    await noteUnregistered(np);
    await np.close();

    // 9 — a Reviewer can look, not edit
    const rv = await newPage(browser, sink);
    await rv.evaluateOnNewDocument(rosterInject);
    await rv.evaluateOnNewDocument((k, id) => localStorage.setItem(k, id), CURRENT_USER_KEY, VERIFY_REVIEWER.id);
    await openUrl(rv, catalogUrl);
    await waitFor(() => rv.evaluate(() => !!document.querySelector("[data-catalog-painted]")), 15_000);
    step("a Reviewer-only role has no New part button", !(await rv.evaluate(() => !!document.querySelector("[data-catalog-new]"))));
    await search(rv, sku(partA));
    await settle(rv, (s) => s[0] === sku(partA));
    await openPart(rv, sku(partA));
    step("…and its editor is read-only: a notice, disabled fields, no Save", (await rv.evaluate(() => !!document.querySelector("[data-catalog-readonly]"))) && (await rv.$eval(field("list"), (i) => (i as HTMLInputElement).disabled)) && !(await rv.evaluate(() => !!document.querySelector("[data-catalog-save]"))));
    await rv.evaluate((k) => localStorage.removeItem(k), CURRENT_USER_KEY);
    await rv.close();

    // 9b — a part removed under an open drawer (the same store object stands in for a reset elsewhere)
    const dw = await newPage(browser, sink);
    await openUrl(dw, catalogUrl);
    await waitFor(() => dw.evaluate(() => !!document.querySelector("[data-catalog-painted]")), 15_000);
    await search(dw, NEW_SKU);
    await settle(dw, (s) => s[0] === NEW_SKU);
    await openPart(dw, NEW_SKU);
    await setField(dw, "desc", "Typed under a doomed drawer");
    await dw.evaluate(async (s) => {
      await (window as unknown as EditH).__peakHandoff.store.remove("catalog", s);
      window.dispatchEvent(new Event("focus"));
    }, NEW_SKU);
    step("a drawer whose part disappears says “This part was reset or removed”, still titled as the part, and cannot save", (await waitFor(() => dw.evaluate(() => /This part was reset or removed/.test(document.querySelector("[data-catalog-removed]")?.textContent ?? "")), 5000)) && (await dw.$eval("[data-catalog-save]", (b) => (b as HTMLButtonElement).disabled)) && (await dw.evaluate(() => document.querySelector("#catalog-drawer-title")?.textContent === "ZZ-VERIFY-PART-1")));
    await dw.close();

    // 10 — Reset puts the snapshot back
    const rp = await newPage(browser, sink);
    await openUrl(rp, catalogUrl);
    await waitFor(() => rp.evaluate(() => !!document.querySelector("[data-catalog-painted]")), 15_000);
    await rp.click("[data-handoff-reset]");
    await waitFor(() => rp.evaluate(() => !!document.querySelector("[data-handoff-reset-confirm]")), 3000);
    await Promise.all([rp.waitForNavigation({ waitUntil: "load", timeout: 20_000 }), rp.click("[data-handoff-reset-confirm]")]);
    await waitFor(() => rp.evaluate(() => !!document.querySelector("[data-catalog-painted]")), 15_000);
    step("Reset reloads onto the Catalog", (await rp.evaluate(() => location.hash)) === "#/catalog");
    await search(rp, sku(partA));
    await settle(rp, (s) => s[0] === sku(partA));
    step(`…the edited list price is the slice's ${money(listA)} again`, (await cell(rp, sku(partA), "list")) === money(listA), (await cell(rp, sku(partA), "list")) ?? "");
    const rA = await stored(rp, sku(partA));
    step("…the description, narrative and rack data are back to the slice's", !!rA && rA.desc === partA.desc && !("narrativeText" in rA) && !("ruHeight" in rA));
    step("…the costed part's cost is the slice's again", ((await stored(rp, sku(partB)))?.cost ?? null) === costB);
    step("…and the new part is gone", (await stored(rp, NEW_SKU)) === null);
    await noteUnregistered(rp);
    await rp.close();
  } catch (e) {
    // A step that cannot run (a missing element) is a failure with a reason, not a crash that hides the steps before it.
    step("the walk completed", false, e instanceof Error ? (e.stack ?? e.message).split("\n").slice(0, 4).join(" | ") : String(e));
  } finally {
    await browser.close();
  }
  const unexpectedUnregistered = [...unexpected];
  const pass = steps.every((s) => s.ok) && unexpectedUnregistered.length === 0 && sink.pageErrors.length === 0 && sink.foreignRequests.length === 0 && sink.failedLocal.length === 0;
  return { pass, parts: catalog.length, firstPaintMs, steps, screenshots, unexpectedUnregistered, ...sink };
}

export function printCatalog(r: CatalogResult): void {
  console.log(`handoff:verify --catalog  ${r.pass ? "PASS" : "FAIL"} (${r.parts.toLocaleString("en-US")} parts; first paint ${r.firstPaintMs} ms)`);
  for (const s of r.steps) console.log(`  ${s.ok ? "ok  " : "FAIL"} ${s.step}${s.detail ? ` (${s.detail})` : ""}`);
  console.log(`  unexpected unregistered: ${r.unexpectedUnregistered.length}`);
  for (const x of r.unexpectedUnregistered) console.log(`    ${x}`);
  console.log(`  page errors: ${r.pageErrors.length}`);
  for (const e of r.pageErrors) console.log(`    ${e.split("\n").slice(0, 4).join("\n    ")}`);
  console.log(`  foreign requests: ${r.foreignRequests.length}; failed local files: ${r.failedLocal.length}`);
  for (const u of [...r.foreignRequests, ...r.failedLocal]) console.log(`    ${u}`);
  if (r.consoleErrors.length) {
    console.log(`  console errors (informational): ${r.consoleErrors.length}`);
    for (const e of r.consoleErrors.slice(0, 10)) console.log(`    ${e.slice(0, 200)}`);
  }
  console.log(`  screenshots: ${r.screenshots.map((f) => path.relative(ROOT, f)).join(", ")}`);
}
