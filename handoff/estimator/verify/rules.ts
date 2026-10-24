/**
 * Estimator handoff — `npm run handoff:verify -- --rules` (PR 2 Task 10): the Estimating Rules walk, in headless Chrome
 * over the built package. Split out of verify.ts (which loads it on demand and owns the shared page helpers).
 *
 * The dev slice carries no pricing_rules blob, no track series and no companies, so one page gets a Gold-tier company
 * (window.PEAK_CUSTOMERS) and an active track series (window.PEAK_RULES.blobs.track_series) injected before any script
 * runs — they are part of that page's snapshot, so a reload or Reset keeps them.
 *
 * What it proves, in order: `#/rules` mounts the app's real Estimating Rules editor (RulesActions + RulesEditor) with
 * its four sub-page cards; a new estimate for the Gold customer adds a catalog part at cost × (1 + 25 %); the Gold
 * markup edited to 30 in the editor saves to the `pricing_rules` blob, survives a reload, and the next new estimate for
 * that customer adds the same part at cost × (1 + 30 %); ↓ CSV exports the edited rate; the Track series card opens
 * `#/rules/track-series` (the app's TrackSeriesClient), its part picker searches the catalog, and a stick length edited
 * 16 → 20 saves to the `track_series` blob — the Estimator's track configurator then picks the 20' stick; Curtain
 * mounts and System categories mount (a typical part added through the categories' search saves); the venue doctrine
 * saves to the settings row; Conduit sizes is "Not part of the prototype"; a non-admin sees "Admin access required";
 * the editor's own Reset puts every rate back (Gold 25 %); and the banner's Reset to production snapshot restores both
 * the markup and the stick length — the Estimator prices at 25 % and picks the 16' stick again. No page errors, foreign
 * requests, failed local files or unregistered actions.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import * as vm from "node:vm";
import { pathToFileURL } from "node:url";
import type { Page } from "puppeteer-core";
import { chromeLaunch } from "@/lib/quote-pdf/render";
import { rankCatalogParts } from "@/lib/estimating-core/catalog-rank";
import { catalogAddPrice } from "@/lib/estimating-core/tier-reprice";
import { sanitizeTrackSeries } from "@/lib/track-series";
import { CURRENT_USER_KEY } from "../runtime/ports";
import { clickButton, newEstimateUrl, newPage, newSink, openUrl, pageHasText, ROOT, sliceTeam, SMOKE_ALLOWED_UNREGISTERED, unregisteredOn, VERIFY_DIR, waitFor, waitMounted, type EditH, type PageSink } from "../verify";

type SlicePart = { id: string; sku: string; desc?: string; category?: string; unit?: string; cost?: number; list?: number; renamedTo?: string };
type RulesResult = { pass: boolean; steps: Array<{ step: string; ok: boolean; detail?: string }>; screenshots: string[]; unexpectedUnregistered: string[] } & PageSink;

/** The slice's live catalog (renamed stubs out), run in a sandbox. */
function loadCatalog(pkgDir: string): SlicePart[] {
  const window: Record<string, unknown> = {};
  const ctx = vm.createContext({ window });
  const dir = path.join(pkgDir, "data");
  for (const f of readdirSync(dir).filter((f) => /^catalog-\d+\.js$/.test(f)).sort()) vm.runInContext(readFileSync(path.join(dir, f), "utf8"), ctx, { filename: f });
  const all = (Array.isArray(window.PEAK_CATALOG) ? window.PEAK_CATALOG : []) as SlicePart[];
  return all.filter((p) => !(typeof p.renamedTo === "string" && p.renamedTo !== "")).map((p) => (p.sku ? p : { ...p, sku: p.id }));
}

export const GOLD_CO = { id: "co-verify-gold", name: "Verify Gold Co", pricingTier: "gold" } as const;
const SERIES_ID = "verify-280";
const SERIES_NAME = "Verify 280";

export async function rulesCheck(pkgDir: string): Promise<RulesResult> {
  const index = path.join(pkgDir, "index.html");
  if (!existsSync(index)) throw new Error(`${index} not found — run npm run handoff:build first`);
  const catalog = loadCatalog(pkgDir);
  // Parts the pickers find first for their own SKU (lower-cased, as searchCatalog does), never Labor.
  const firstHit = (p: SlicePart) => rankCatalogParts(catalog, p.sku.toLowerCase())[0]?.p.sku === p.sku;
  const usable = (p: SlicePart) => p.category !== "Labor" && /^[\w.:-]+$/.test(p.sku) && firstHit(p);
  const priced = catalog.find((p) => usable(p) && (p.cost ?? 0) > 0 && (p.list ?? 0) > 0);
  const trackSkus = catalog.filter((p) => p !== priced && /^[\w.:-]+$/.test(p.sku)).slice(0, 6).map((p) => p.sku);
  const catPart = catalog.find((p) => usable(p) && p !== priced);
  if (!priced || trackSkus.length < 6 || !catPart) throw new Error("the slice has too few usable catalog parts");
  // The dev slice's only non-admin is inactive: a verify-only Estimator persona joins the roster on the lock-out page.
  const nonAdmin = { id: "u-verify-rules", name: "Rita Verify", roles: ["Estimator"], status: "active" } as const;
  const sliceHasPersona = sliceTeam(pkgDir).some((u) => u.id === nonAdmin.id);

  // An active series: one 16' stick, every always-required role and a batten clamp mapped (sanitizes to active).
  const series = {
    id: SERIES_ID,
    name: SERIES_NAME,
    manufacturer: "Verify",
    sticks: [{ lengthFt: 16, sku: trackSkus[0] }],
    carrierSpacingIn: 12,
    hangerSpacingFt: 5,
    overlapFt: 0,
    parts: { splice: { sku: trackSkus[1] }, carrier: { sku: trackSkus[2] }, masterCarrier: { sku: trackSkus[3] }, endStop: { sku: trackSkus[4] }, battenClamp: { sku: trackSkus[5] } },
    active: true,
  };
  if (!sanitizeTrackSeries(series)?.active) throw new Error("the injected track series does not sanitize to an active series");
  // A string, not a function: tsx's keepNames would wrap a function's inner arrows in __name, which the page lacks.
  const INJECT = `(() => {
    let rules, cust;
    const series = ${JSON.stringify({ [SERIES_ID]: series })};
    const co = ${JSON.stringify(GOLD_CO)};
    Object.defineProperty(window, "PEAK_RULES", { configurable: true, get: () => rules, set: (v) => {
      rules = v && typeof v === "object" ? { ...v, blobs: { ...(v.blobs || {}), track_series: { ...((v.blobs || {}).track_series || {}), ...series } } } : v;
    } });
    Object.defineProperty(window, "PEAK_CUSTOMERS", { configurable: true, get: () => cust, set: (v) => {
      cust = v && typeof v === "object" ? { ...v, companies: (v.companies || []).filter((c) => c && c.id !== co.id).concat([co]) } : v;
    } });
  })();`;

  const launch = await chromeLaunch();
  if ("unavailable" in launch) throw new Error(launch.unavailable);
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ executablePath: launch.executablePath, args: launch.args, headless: true, defaultViewport: { width: 1440, height: 900 } });
  const sink = newSink();
  const steps: RulesResult["steps"] = [];
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ step: name, ok, ...(detail ? { detail } : {}) });
  const screenshots: string[] = [];
  const shot = async (page: Page, name: string) => {
    const file = path.join(VERIFY_DIR, `rules-${name}.png`);
    await page.screenshot({ path: file as `${string}.png`, fullPage: false });
    screenshots.push(file);
  };
  const allowed = new Set(SMOKE_ALLOWED_UNREGISTERED);
  const unexpected = new Set<string>();
  const noteUnregistered = async (page: Page) => (await unregisteredOn(page)).filter((x) => !allowed.has(x)).forEach((x) => unexpected.add(x));
  const base = pathToFileURL(index).href;
  const rulesUrl = `${base}#/rules`;
  const goldEstimateUrl = newEstimateUrl(base).replace("?new=1", `?new=1&customer=${encodeURIComponent(GOLD_CO.id)}`);

  const mountedRules = (page: Page) => waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-rules]") && document.body.innerText.includes("Estimating rules")), 15_000);
  const blob = (page: Page, id: string) =>
    page.evaluate(async (b) => JSON.stringify(((await (window as unknown as EditH).__peakHandoff.store.get("blobs", b)) as { data?: unknown } | undefined)?.data ?? null), id).then((j) => JSON.parse(j) as Record<string, unknown> | null);
  /** Opens a rules group by its label (groups start collapsed). */
  const openGroup = (page: Page, label: string) =>
    page.evaluate((l) => {
      const head = [...document.querySelectorAll('[role="button"][aria-expanded]')].find((h) => h.querySelector("span + span")?.textContent?.trim() === l || (h.textContent ?? "").includes(l)) as HTMLElement | undefined;
      if (!head) return false;
      if (head.getAttribute("aria-expanded") !== "true") head.click();
      return true;
    }, label);
  /** The rate row labelled `label`: its input's value and whether it shows the "↺ default" reset. */
  const rateRow = (page: Page, label: string) =>
    page.evaluate((l) => {
      const row = [...document.querySelectorAll(".er-rate")].find((r) => r.querySelector("span")?.textContent?.trim() === l);
      const input = row?.querySelector('input[type="number"]') as HTMLInputElement | null | undefined;
      const reset = [...(row?.querySelectorAll("button") ?? [])].find((b) => (b.textContent ?? "").startsWith("↺"))?.textContent?.trim() ?? null;
      return input ? { value: input.value, reset } : null;
    }, label);
  const setRate = async (page: Page, label: string, v: string) => {
    const handle = await page.evaluateHandle((l) => [...document.querySelectorAll(".er-rate")].find((r) => r.querySelector("span")?.textContent?.trim() === l)?.querySelector('input[type="number"]') ?? null, label);
    const el = handle.asElement() as import("puppeteer-core").ElementHandle<HTMLInputElement> | null;
    if (!el) return false;
    await el.click({ count: 3 });
    await page.keyboard.press("Backspace");
    await el.type(v);
    await page.keyboard.press("Enter"); // blur → commit (setValueAction → router.refresh)
    return true;
  };
  /** A new estimate for the Gold customer: + Add part from catalog → `sku` → Add; the added line's unit sell. */
  const newEstimateSell = async (sku: string): Promise<number | null> => {
    const ep = await newPage(browser, sink);
    try {
      await ep.evaluateOnNewDocument(INJECT);
      await openUrl(ep, goldEstimateUrl);
      if (!(await waitMounted(ep, sink))) return null;
      if (!(await ep.evaluate(() => !!document.querySelector("input.est-secname")))) {
        await clickButton(ep, "+ Add system");
        await waitFor(() => pageHasText(ep, "Blank system"), 3000);
        await clickButton(ep, "Blank system", true);
        await waitFor(() => ep.evaluate(() => !!document.querySelector("input.est-secname")), 3000);
      }
      if (!(await clickButton(ep, "+ Add part from catalog"))) return null;
      await waitFor(() => ep.evaluate(() => !!document.querySelector('input[placeholder^="Search the catalog"]')), 3000);
      await ep.type('input[placeholder^="Search the catalog"]', sku);
      const added = await waitFor(
        () =>
          ep.evaluate((want) => {
            const row = [...document.querySelectorAll(".est-sug")].find((r) => (r.textContent ?? "").includes(want));
            const b = [...(row?.querySelectorAll("button") ?? [])].find((x) => x.textContent?.trim() === "Add");
            if (!b) return false;
            b.click();
            return true;
          }, sku),
        6000,
      );
      if (!added) return null;
      await waitFor(() => ep.evaluate(() => !!document.querySelector('input[aria-label^="Unit sell for "]')), 3000);
      const raw = await ep.evaluate(() => (document.querySelector('input[aria-label^="Unit sell for "]') as HTMLInputElement | null)?.value ?? "");
      await noteUnregistered(ep);
      const n = Number(raw.replace(/[^0-9.-]/g, ""));
      return raw && Number.isFinite(n) ? n : null;
    } finally {
      await ep.close();
    }
  };
  /** The Estimator's track configurator on a new estimate: pick the series, a 30' run → the track row's label. */
  const trackStickLabel = async (): Promise<string | null> => {
    const ep = await newPage(browser, sink);
    try {
      await ep.evaluateOnNewDocument(INJECT);
      await openUrl(ep, newEstimateUrl(base));
      if (!(await waitMounted(ep, sink))) return null;
      if (!(await ep.evaluate(() => !!document.querySelector("input.est-secname")))) {
        await clickButton(ep, "+ Add system");
        await waitFor(() => pageHasText(ep, "Blank system"), 3000);
        await clickButton(ep, "Blank system", true);
        await waitFor(() => ep.evaluate(() => !!document.querySelector("input.est-secname")), 3000);
      }
      if (!(await clickButton(ep, "+ Configure track"))) return null;
      if (!(await waitFor(() => ep.evaluate(() => !!document.querySelector('select[aria-label="Track series"]')), 3000))) return null;
      await ep.select('select[aria-label="Track series"]', SERIES_ID);
      await ep.type('input[aria-label="Run length (ft)"]', "30");
      const ok = await waitFor(() => ep.evaluate(() => /Track \(\d+(\.\d+)?' stick\)/.test(document.body.innerText)), 4000);
      const label = ok ? await ep.evaluate(() => /Track \(\d+(\.\d+)?' stick\)/.exec(document.body.innerText)?.[0] ?? null) : null;
      await shot(ep, `estimator-track-${label?.match(/\d+/)?.[0] ?? "none"}`);
      await noteUnregistered(ep);
      return label;
    } finally {
      await ep.close();
    }
  };

  try {
    mkdirSync(VERIFY_DIR, { recursive: true });
    const page = await newPage(browser, sink);
    await page.evaluateOnNewDocument(INJECT);
    // A download stand-in: the editor's ↓ CSV / ↓ JSON click a blob: anchor — record its file name instead.
    await page.evaluateOnNewDocument(`(() => {
      window.__downloads = [];
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__downloads.push(this.download); return; } return click.call(this); };
    })();`);
    page.on("dialog", (d) => void d.accept());
    await openUrl(page, base);
    await page.waitForSelector("[data-handoff-ready]", { timeout: 15_000 });
    await page.evaluate(async () => (window as unknown as EditH).__peakHandoff.store.reset());

    // 1 — the real editor
    await openUrl(page, rulesUrl);
    step("#/rules mounts the app's Estimating Rules editor", await mountedRules(page));
    step("…under the Estimating Rules nav tab", (await page.evaluate(() => document.querySelector('[data-handoff-nav="rules"]')?.getAttribute("aria-current"))) === "page");
    step("…with its four sub-page cards and the export / Reset actions", await page.evaluate(() => ["Track series", "Curtain mounts", "Conduit sizes", "System categories", "↓ CSV", "↓ JSON", "Reset"].every((t) => document.body.innerText.includes(t))));
    step('…and the "Customer tiers" group', await openGroup(page, "Customer tiers"));
    const gold0 = await rateRow(page, "Gold markup");
    step("Gold markup reads its default 25 (no override in the slice)", gold0?.value === "25" && gold0.reset === null, JSON.stringify(gold0));
    await shot(page, "1-editor");

    // 2 — the Gold customer prices at 25 % before the edit
    const cost = Number(priced.cost);
    const list = Number(priced.list);
    const sell20 = await newEstimateSell(priced.sku);
    step(`a new Gold estimate adds ${priced.sku} at cost × (1 + 25 %) = ${catalogAddPrice(cost, list, 0.25)}`, sell20 === catalogAddPrice(cost, list, 0.25), `got ${sell20}`);

    // 3 — edit Gold → 30
    step("Gold markup → 30 (Enter commits)", await setRate(page, "Gold markup", "30"));
    step("…the row shows 30 and its ↺ 25 reset", await waitFor(async () => (await rateRow(page, "Gold markup"))?.value === "30" && (await rateRow(page, "Gold markup"))?.reset === "↺ 25", 5000), JSON.stringify(await rateRow(page, "Gold markup")));
    step("…saved to the pricing_rules blob (tiers.gold = 30)", (await blob(page, "pricing_rules"))?.["tiers.gold"] === 30, JSON.stringify(await blob(page, "pricing_rules")));
    await openUrl(page, rulesUrl);
    await mountedRules(page);
    await openGroup(page, "Customer tiers");
    step("…and survives a reload", await waitFor(async () => (await rateRow(page, "Gold markup"))?.value === "30", 5000));
    await shot(page, "2-gold-25");
    const sell25 = await newEstimateSell(priced.sku);
    step(`the next new Gold estimate adds ${priced.sku} at cost × (1 + 30 %) = ${catalogAddPrice(cost, list, 0.30)}`, sell25 === catalogAddPrice(cost, list, 0.30) && sell25 !== sell20, `got ${sell25}`);

    // 4 — export
    await clickButton(page, "↓ CSV");
    const csvName = await waitFor(() => page.evaluate(() => ((window as unknown as { __downloads: string[] }).__downloads ?? []).some((n) => n.endsWith(".csv"))), 4000);
    step("↓ CSV downloads Peak_estimating_rules_<date>.csv", csvName && (await page.evaluate(() => (window as unknown as { __downloads: string[] }).__downloads.some((n) => /^Peak_estimating_rules_\d{8}\.csv$/.test(n)))));

    // 5 — Track series
    await page.evaluate(() => {
      const a = [...document.querySelectorAll("a")].find((x) => x.textContent?.includes("Track series") && x.textContent.includes("Open →")) as HTMLElement | undefined;
      a?.click();
    });
    step("the Track series card opens #/rules/track-series", await waitFor(() => page.evaluate(() => location.hash === "#/rules/track-series" && !!document.querySelector("[data-handoff-rules-page]")), 8000));
    step(`…listing the series (${SERIES_NAME}, Stick 16')`, await waitFor(() => page.evaluate((n) => document.body.innerText.includes(n) && document.body.innerText.includes("Stick 16'"), SERIES_NAME), 5000));
    step("…under the Estimating Rules nav tab", (await page.evaluate(() => document.querySelector('[data-handoff-nav="rules"]')?.getAttribute("aria-current"))) === "page");
    await clickButton(page, "Edit");
    step("Edit opens the series editor", await waitFor(() => page.evaluate(() => !!document.querySelector('input[aria-label="Stick length (ft)"]')), 3000));
    await clickButton(page, "Change");
    const picker = 'input[placeholder="Search SKU, description, maker…"]';
    await waitFor(() => page.evaluate((s) => !!document.querySelector(s), picker), 3000);
    await page.type(picker, trackSkus[0].toLowerCase());
    step("its part picker searches the catalog (searchEquipmentPartsAction)", await waitFor(() => page.evaluate((s) => document.body.innerText.includes(s) && /\d+ match(es)?/.test(document.body.innerText), trackSkus[0]), 5000));
    await clickButton(page, "Done");
    const stick = await page.$('input[aria-label="Stick length (ft)"]');
    await stick?.click({ count: 3 });
    await page.keyboard.press("Backspace");
    await stick?.type("20");
    await clickButton(page, "Save series");
    step("Stick 16 → 20, Save series → the list reads Stick 20'", await waitFor(() => page.evaluate(() => document.body.innerText.includes("Stick 20'") && !document.querySelector('input[aria-label="Stick length (ft)"]')), 5000));
    const ts = (await blob(page, "track_series"))?.[SERIES_ID] as { sticks?: Array<{ lengthFt: number }>; active?: boolean; updatedBy?: string } | undefined;
    step("…saved to the track_series blob (one 20' stick, still active, stamped)", ts?.sticks?.length === 1 && ts.sticks[0].lengthFt === 20 && ts.active === true && !!ts.updatedBy, JSON.stringify(ts));
    await shot(page, "3-track-series");
    step("the Estimator's track configurator now picks the 20' stick", (await trackStickLabel()) === "Track (20' stick)");

    // 6 — Curtain mounts, System categories, Conduit sizes
    await openUrl(page, `${base}#/rules/curtain-mounts`);
    step("#/rules/curtain-mounts mounts the app's Curtain mounts editor", await waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-rules-page]") && document.body.innerText.includes("The hardware each curtain mount uses")), 8000));
    await shot(page, "4-curtain-mounts");
    await openUrl(page, `${base}#/rules/system-categories`);
    step("#/rules/system-categories mounts the app's System categories editor (the seven default categories)", await waitFor(() => page.evaluate(() => !!document.querySelector('[data-handoff-rules-page="system-categories"]') && document.body.innerText.includes("pre-fill a new system on the Estimator") && /Categories \(7\)/i.test(document.body.innerText)), 8000));
    await page.type(picker, catPart.sku.toLowerCase());
    const pickedCat = await waitFor(
      () =>
        page.evaluate((s) => {
          const b = [...document.querySelectorAll("button")].find((x) => (x.textContent ?? "").startsWith(s + " — "));
          (b as HTMLButtonElement | undefined)?.click();
          return !!b;
        }, catPart.sku),
      5000,
    );
    step(`its search finds ${catPart.sku} and adds it as a typical part`, pickedCat && (await waitFor(() => pageHasText(page, catPart.sku), 3000)));
    await clickButton(page, "Save");
    const cats = await waitFor(async () => JSON.stringify((await blob(page, "system_categories")) ?? {}).includes(catPart.sku), 5000);
    step("…and Save writes the system_categories blob", cats);
    await shot(page, "5-system-categories");
    await openUrl(page, rulesUrl);
    await mountedRules(page);
    await page.evaluate(() => {
      const a = [...document.querySelectorAll("a")].find((x) => x.textContent?.includes("Conduit sizes") && x.textContent.includes("Open →")) as HTMLElement | undefined;
      a?.click();
    });
    step("Conduit sizes (a Grid concern) shows the “Not part of the prototype” notice and stays on #/rules", (await waitFor(() => page.evaluate(() => ((document.querySelector("[data-handoff-notice]") as HTMLElement | null)?.innerText ?? "").includes("Not part of the prototype")), 5000)) && (await page.evaluate(() => location.hash)) === "#/rules");

    // 7 — the venue doctrine
    await openUrl(page, rulesUrl);
    await mountedRules(page);
    /** Theatre's doctrine row: clicks its Confirmed checkbox or its Save class button; answers the checkbox state. */
    const theatre = (what: "toggle" | "save" | "read") =>
      page.evaluate((w) => {
        const row = [...document.querySelectorAll("div")].find((d) => d.children[0]?.children[0]?.textContent === "Theatre" && d.querySelector('input[type="checkbox"]'));
        const cb = row?.querySelector('input[type="checkbox"]') as HTMLInputElement | null | undefined;
        if (w === "toggle") cb?.click();
        if (w === "save") ([...(row?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === "Save class") as HTMLButtonElement | undefined)?.click();
        return cb ? cb.checked : null;
      }, what);
    const settingsDoc = () =>
      page.evaluate(async () => JSON.stringify(((await (window as unknown as EditH).__peakHandoff.store.get("settings", "main")) as { data?: { venueDoctrine?: Record<string, { confirmed?: boolean }> } } | undefined)?.data?.venueDoctrine ?? null));
    const confirmed0 = await theatre("read");
    await theatre("toggle");
    const toggled = await waitFor(async () => (await theatre("read")) === !confirmed0, 2000);
    await theatre("save");
    const stored = await waitFor(async () => (JSON.parse(await settingsDoc()) as Record<string, { confirmed?: boolean }> | null)?.theatre?.confirmed === !confirmed0, 5000);
    step(`Venue class doctrine → Theatre's Confirmed ${confirmed0} → ${!confirmed0}, Save class writes the settings row and says Saved`, confirmed0 !== null && toggled && stored && (await waitFor(() => pageHasText(page, "Saved"), 3000)), await settingsDoc());

    // 8 — a non-admin sees the page's own lock
    if (!sliceHasPersona) {
      const np = await newPage(browser, sink);
      await np.evaluateOnNewDocument(`(() => {
        let team;
        const extra = ${JSON.stringify(nonAdmin)};
        Object.defineProperty(window, "PEAK_TEAM", { configurable: true, get: () => team, set: (v) => { team = Array.isArray(v) ? v.concat([extra]) : v; } });
        try { localStorage.setItem(${JSON.stringify(CURRENT_USER_KEY)}, extra.id); } catch { /* about:blank has no storage */ }
      })();`);
      await openUrl(np, rulesUrl);
      step(`a non-admin (${nonAdmin.name}) sees “Admin access required” and no editor`, await waitFor(() => np.evaluate(() => document.body.innerText.includes("Admin access required") && !document.querySelector(".er-rate") && !document.body.innerText.includes("↓ CSV")), 8000));
      await openUrl(np, `${base}#/rules/track-series`);
      step("…and on Track series", await waitFor(() => np.evaluate(() => document.body.innerText.includes("Admin access required") && !document.body.innerText.includes("+ New series")), 8000));
      await noteUnregistered(np);
      await np.evaluate((k) => localStorage.removeItem(k), CURRENT_USER_KEY);
      await np.close();
    } else step("the verify persona's id is free in the slice", false, nonAdmin.id);

    // 9 — the editor's own Reset puts every rate back
    await openUrl(page, rulesUrl);
    await mountedRules(page);
    await openGroup(page, "Customer tiers");
    await clickButton(page, "Reset");
    step("Reset asks “Reset every rate?”", await waitFor(() => pageHasText(page, "Reset every rate?"), 3000));
    await clickButton(page, "Reset every rate?");
    const afterReset = await blob(page, "pricing_rules");
    // the markup-basis bookkeeping a converted blob carries (_pricingBasis, _marginBackup, #367) is not a rate override
    const overrides = Object.entries(afterReset ?? {}).filter(([k, v]) => v !== null && !k.startsWith("_"));
    step("…and Gold reads 25 again — every general rate cleared (null), none left overridden", (await waitFor(async () => (await rateRow(page, "Gold markup"))?.value === "25", 5000)) && (await blob(page, "pricing_rules"))?.["tiers.gold"] === null && overrides.length === 0, `tiers.gold ${JSON.stringify(afterReset?.["tiers.gold"])}; ${Object.keys(afterReset ?? {}).length} keys; overridden ${JSON.stringify(overrides)}`);
    step("…the track series is a separate store and keeps its 20' stick", ((await blob(page, "track_series"))?.[SERIES_ID] as { sticks?: Array<{ lengthFt: number }> } | undefined)?.sticks?.[0]?.lengthFt === 20);

    // 10 — Reset to production snapshot restores both
    step("Gold → 30 again", (await setRate(page, "Gold markup", "30")) && (await waitFor(async () => (await blob(page, "pricing_rules"))?.["tiers.gold"] === 30, 5000)));
    await page.click("[data-handoff-reset]");
    await waitFor(() => page.evaluate(() => !!document.querySelector("[data-handoff-reset-confirm]")), 3000);
    await Promise.all([page.waitForNavigation({ waitUntil: "load", timeout: 20_000 }), page.click("[data-handoff-reset-confirm]")]);
    await mountedRules(page);
    await openGroup(page, "Customer tiers");
    step("Reset to production snapshot reloads onto #/rules with Gold at 25 and no pricing_rules override", (await page.evaluate(() => location.hash)) === "#/rules" && (await waitFor(async () => (await rateRow(page, "Gold markup"))?.value === "25", 5000)) && (await blob(page, "pricing_rules").then((b) => b === null || b?.["tiers.gold"] !== 30)));
    step("…and the snapshot's 16' stick", ((await blob(page, "track_series"))?.[SERIES_ID] as { sticks?: Array<{ lengthFt: number }> } | undefined)?.sticks?.[0]?.lengthFt === 16);
    await shot(page, "6-after-reset");
    const sellReset = await newEstimateSell(priced.sku);
    step(`after Reset a new Gold estimate prices at 25 % again (${catalogAddPrice(cost, list, 0.25)})`, sellReset === catalogAddPrice(cost, list, 0.25), `got ${sellReset}`);
    step("…and the track configurator picks the 16' stick again", (await trackStickLabel()) === "Track (16' stick)");
    await noteUnregistered(page);
    await page.close();
  } catch (e) {
    step("the walk completed", false, e instanceof Error ? (e.stack ?? e.message).split("\n").slice(0, 4).join(" | ") : String(e));
  } finally {
    await browser.close();
  }
  const unexpectedUnregistered = [...unexpected];
  const pass = steps.every((s) => s.ok) && unexpectedUnregistered.length === 0 && sink.pageErrors.length === 0 && sink.foreignRequests.length === 0 && sink.failedLocal.length === 0;
  return { pass, steps, screenshots, unexpectedUnregistered, ...sink };
}

export function printRules(r: RulesResult): void {
  console.log(`handoff:verify --rules  ${r.pass ? "PASS" : "FAIL"} (${r.steps.length} steps)`);
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
